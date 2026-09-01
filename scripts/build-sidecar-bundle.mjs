#!/usr/bin/env node
/**
 * build-sidecar-bundle.mjs — 组装「自包含 Node 目录」sidecar 运行时（对账清单 §5-a）。
 *
 * 策略：一次性隔离 mini-workspace（injectWorkspacePackages 只在这里生效，registry 直装，
 * 不触碰仓库 lockfile）→ 装配运行时布局 → 随包 node.exe RPC 门禁 → 发布到 src-tauri/resources。
 * 弃用 pnpm deploy：legacy 会拷贝全 workspace 虚拟仓库（~770MB）且对超长 .pnpm 目录名
 * 截断+哈希，非 legacy 则要求仓库级 inject 配置破坏 frozen lockfile。
 *
 * 产物（src-tauri/resources/agent-core-runtime/，经 tauri bundle.resources 进安装包）：
 *   node.exe（附 LICENSE）+ agent-core/{package.json, dist/, node_modules/}
 *   node_modules 含 @lydell/node-pty 平台分包 .node、pi 扩展、workspace 依赖（LFP/utils/
 *   types/constants）内联真实文件。
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_TAURI = path.join(REPO_ROOT, "packages", "client", "src-tauri");
const RUNTIME_DIR = path.join(CLIENT_TAURI, "resources", "agent-core-runtime");
const IS_WIN = process.platform === "win32";
// 暂存目录：仓库 workspace 内（沙箱对 workspace 外批量写会快速终止 0xC0000409），
// gitignore；可用 SIDECAR_STAGE_DIR 覆盖
const STAGE_BASE = process.env.SIDECAR_STAGE_DIR || path.join(CLIENT_TAURI, ".sidecar-stage");
const STAGE_DIR = path.join(STAGE_BASE, "agent-core-runtime");
const STAGE_CORE = path.join(STAGE_DIR, "agent-core");

const rmrf = (p) => rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
const step = (msg) => console.log(`[bundle] ${msg}`);
const die = (msg) => {
    console.error(`[bundle] FAIL: ${msg}`);
    process.exit(1);
};
/** 递归目录复制——本环境 cpSync(recursive) 触发 0xC0000409 fast-fail（Node 22.22.3 / Win11），
 *  逐文件 copyFileSync 正常，故手写。
 *  pnpm 的 node_modules 用 Junction 链接组成（顶层 → .pnpm → 依赖），
 *  直接 rename/拷贝会把 dangling 链接带进运行时导致 sidecar 崩。
 *  故对 junction/symlink 跟随 target（lstat 识别），把真实内容物化到产物。 */
const copyDir = (src, dst) => {
    const walk = (s, d) => {
        mkdirSync(d, { recursive: true });
        for (const e of readdirSync(s, { withFileTypes: true })) {
            const sp = path.join(s, e.name), dp = path.join(d, e.name);
            // Windows Junction：Dirent.isDirectory()/isSymbolicLink() 都可能为 false，
            // 必须用 lstatSync().isSymbolicLink() 判定；否则会把链接当普通目录跳进去，
            // 或把 .pnpm 平台分包（.node）当成 dangling 链接漏掉。
            let isLink = e.isSymbolicLink();
            if (!isLink) {
                try {
                    isLink = lstatSync(sp).isSymbolicLink();
                } catch {
                    isLink = false;
                }
            }
            if (isLink) {
                // Junction/符号链接：解析真实 target 并物化复制（避免 dangling / 漏掉平台分包）
                let real;
                try {
                    real = realpathSync(sp);
                } catch {
                    continue; // 悬空链接：跳过
                }
                const st = statSync(real);
                if (st.isDirectory()) walk(real, dp);
                else copyFileSync(real, dp);
            } else if (e.isDirectory()) {
                walk(sp, dp);
            } else {
                if (e.name.endsWith(".tsbuildinfo")) continue; // TS 增量构建缓存，运行时不需要
                copyFileSync(sp, dp);
            }
        }
    };
    walk(src, dst);
};
function run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { stdio: "inherit", shell: IS_WIN, cwd: REPO_ROOT, ...opts });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} 退出码 ${r.status}`);
}
const sizeOf = (p) => {
    let n = 0;
    const walk = (dir) => {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            const fp = path.join(dir, e.name);
            if (e.isDirectory()) walk(fp);
            else {
                try {
                    n += statSync(fp).size;
                } catch {}
            }
        }
    };
    walk(p);
    return n;
};

// ── 1. 构建 agent-core（tsc 产 dist）+ 依赖链包 ──
step("构建 agent-core 与依赖链 dist…");
try {
    run("pnpm", [
        "--filter", "@buildingai/agent-core",
        "--filter", "@buildingai/llm-file-parser",
        "--filter", "@buildingai/utils",
        "--filter", "@buildingai/types",
        "--filter", "@buildingai/constants",
        "build",
    ]);
} catch (e) {
    die(e.message);
}
for (const rel of ["packages/@buildingai/agent-core/dist/index.js", "packages/@buildingai/llm-file-parser/dist/index.js"]) {
    if (!existsSync(path.join(REPO_ROOT, rel))) die(`${rel} 缺失`);
}

// ── 2. 组装隔离 mini-workspace ──
step(`清空暂存 ${STAGE_BASE}…`);
rmrf(STAGE_BASE);
mkdirSync(STAGE_BASE, { recursive: true });
const WS = path.join(STAGE_BASE, "ws");
const PKG = path.join(WS, "pkg"); // agent-core 本体
const PKGS = path.join(WS, "pkgs"); // workspace 依赖包
mkdirSync(PKG, { recursive: true });
mkdirSync(PKGS, { recursive: true });

// catalog: 协议在隔离 workspace 不可用——从仓库 pnpm-workspace.yaml 抽取具体版本内联。
// 需覆盖两层结构： `catalog:`（顶层）+ `catalogs:\n  web:\n  api:\n  dev:`（命名 catalog）。
// 引用方（如 `clsx: catalog:web`）用相对包名查版本，故汇总成「包名 → 版本」全量表，
// 不区分顶层/命名（同名冲突时顶层优先，与 pnpm 语义一致）。
const catalog = new Map();
{
    let top = true; // 是否处于顶层 catalog:
    let current = null; // 命名 catalog 正在遍历的组名；null 表示在 `catalog:` 顶层
    const raw = readFileSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8").split(/\r?\n/);
    for (let i = 0; i < raw.length; i++) {
        const line = raw[i].trim();
        if (line === "catalog:" || /^catalog:[\s]*$/.test(line)) {
            top = true;
            current = null;
            continue;
        }
        const mCats = raw[i].match(/^catalogs:[\s]*$/);
        if (mCats) {
            top = false;
            current = null;
            continue;
        }
        if (/^\s{2}\S.*:$/.test(raw[i]) && !top) {
            // 命名 catalog 分组头，如 `  web:`
            const name = raw[i].match(/^\s{2}([\w-]+):[\s]*$/);
            current = name ? name[1] : null;
            continue;
        }
        if (current) {
            // 命名 catalog 下的 包名: 版本
            const m = raw[i].match(/^\s{4}([^:#][^:]*):\s*(.+?)\s*$/);
            if (m && !catalog.has(m[1])) catalog.set(m[1], m[2]);
        } else if (top && /^\s{2}\S.*:\s*\S/.test(raw[i])) {
            const m = raw[i].match(/^\s{2}([^:]+):\s*(.+?)\s*$/);
            if (m && !catalog.has(m[1])) catalog.set(m[1], m[2]);
        }
    }
}
const rewriteDeps = (deps) => {
    for (const [k, v] of Object.entries(deps ?? {})) {
        if (typeof v === "string" && v.startsWith("catalog")) {
            const ver = catalog.get(k);
            if (!ver) die(`catalog 版本缺失: ${k}（检查仓库 pnpm-workspace.yaml）`);
            deps[k] = ver;
        }
    }
    return deps;
};
/** 只拷贝生产运行所需：package.json（catalog 内联、去 scripts/devDeps）+ dist */
const copyRuntimePkg = (srcDir, dstDir) => {
    mkdirSync(dstDir, { recursive: true });
    const pkg = JSON.parse(readFileSync(path.join(srcDir, "package.json"), "utf8"));
    rewriteDeps(pkg.dependencies);
    delete pkg.devDependencies;
    delete pkg.scripts;
    writeFileSync(path.join(dstDir, "package.json"), JSON.stringify(pkg, null, 4));
    if (existsSync(path.join(srcDir, "dist"))) {
        copyDir(path.join(srcDir, "dist"), path.join(dstDir, "dist"));
    }
};

copyRuntimePkg(path.join(REPO_ROOT, "packages/@buildingai/agent-core"), PKG);
copyDir(path.join(REPO_ROOT, "packages/@buildingai/agent-core/dist"), path.join(PKG, "dist"));
for (const name of ["llm-file-parser", "utils", "types", "constants"]) {
    copyRuntimePkg(path.join(REPO_ROOT, "packages/@buildingai", name), path.join(PKGS, name));
}

// 隔离 workspace 配置（inject 只在此目录生效）。node-linker=hoisted 让 pnpm 产出无
// Junction/符号链接的平铺 node_modules：带链接的 pnpm 布局经深拷贝/跨目录搬运后解析断裂
// （表现为 jszip 等传递依赖丢失、平台分包 .node 缺失），平铺布局物化即完整真实目录树。
writeFileSync(
    path.join(WS, "pnpm-workspace.yaml"),
    [
        "packages:",
        "  - pkg",
        "  - pkgs/*",
        "injectWorkspacePackages: true",
        "nodeLinker: hoisted",
        "onlyBuiltDependencies:",
        "  - esbuild",
        "  - msgpackr-extract",
        "  - '@swc/core'",
    ].join("\n") + "\n",
);
writeFileSync(path.join(WS, ".npmrc"), `registry=${process.env.npm_config_registry || "https://registry.npmmirror.com"}
node-linker=hoisted
`);

// ── 3. 隔离安装（生产依赖）──
step("隔离 workspace 安装（生产依赖直装）…");
try {
    run("pnpm", ["install", "--prod", "--no-frozen-lockfile", "--reporter=append-only"], { cwd: WS });
} catch (e) {
    die(e.message);
}

// ── 3.5 装配运行时布局：agent-core/{package.json, dist, node_modules} ──
// hoisted 布局下依赖平铺提升到 workspace 根 node_modules（pkg/ 自身无 node_modules），
// 所以运行时 node_modules 取 WS 根；pkg/ 只出 package.json + dist。
step("装配运行时布局…");
rmrf(STAGE_DIR);
mkdirSync(STAGE_CORE, { recursive: true });
copyFileSync(path.join(PKG, "package.json"), path.join(STAGE_CORE, "package.json"));
copyDir(path.join(PKG, "dist"), path.join(STAGE_CORE, "dist"));
{
    const nmRoot = path.join(WS, "node_modules");
    const nmPkg = path.join(PKG, "node_modules");
    if (!existsSync(nmRoot)) die("隔离安装产物缺失: ws/node_modules（hoisted 平铺根）");
    step("物化 hoisted 平铺根 node_modules…");
    copyDir(nmRoot, path.join(STAGE_CORE, "node_modules"));
    // workspace 包（LFP 等）hoisted 下仍留在 pkg/node_modules（Junction → pkgs/*），
    // 合并物化进同一运行时 node_modules（copyDir 逐文件合并，自动跟随 Junction）。
    if (existsSync(nmPkg)) {
        step("合并 pkg 级 workspace 包（物化 Junction）…");
        copyDir(nmPkg, path.join(STAGE_CORE, "node_modules"));
    }
}
// rmrf(WS) 延后到门禁通过后执行：失败时保留现场便于排查

const nm = path.join(STAGE_CORE, "node_modules");

// ── 3.7 压平 workspace 包嵌套（NSIS MAX_PATH 兼容）──
// injectWorkspacePackages 物化后产生深嵌套：LFP/node_modules/@buildingai/utils/node_modules/
// @buildingai/types/...，路径超过 NSIS 的 260 字符上限直接打崩安装包。
// Node 模块解析向上冒泡：顶层命中即可，嵌套副本可安全删除。
step("压平嵌套 workspace 包…");
{
    const topDir = path.join(nm, "@buildingai");
    mkdirSync(topDir, { recursive: true });
    let changed = true;
    let rounds = 0;
    while (changed && rounds < 10) {
        changed = false;
        rounds++;
        const found = [];
        const walk = (dir, depth) => {
            if (depth > 8) return;
            let entries;
            try {
                entries = readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const e of entries) {
                if (!e.isDirectory()) continue;
                const fp = path.join(dir, e.name);
                if (fp !== topDir && e.name === "@buildingai") {
                    found.push(fp);
                    continue;
                }
                walk(fp, depth + 1);
            }
        };
        walk(nm, 0);
        for (const bd of found) {
            for (const p of readdirSync(bd, { withFileTypes: true })) {
                const src = path.join(bd, p.name);
                const dst = path.join(topDir, p.name);
                if (!existsSync(dst)) renameSync(src, dst);
                else rmrf(src);
                changed = true;
            }
            try {
                rmSync(bd, { recursive: true, force: true });
            } catch {
                /* 空壳清理失败不影响 */
            }
        }
    }
    step(`压平完成（${rounds} 轮，顶层 @buildingai: ${readdirSync(topDir).join(", ")}）`);
}

// ── 4. 校验关键件 ──
// 压平后 workspace 包（LFP/utils/types/constants）全部在顶层 @buildingai，
// Node 解析向上冒泡命中；pi-coding-agent / node-pty 也在顶层。
for (const rel of [
    "dist/index.js",
    "package.json",
    "node_modules/@earendil-works/pi-coding-agent",
    "node_modules/@lydell/node-pty",
    "node_modules/@lydell/node-pty-win32-x64",
    "node_modules/@buildingai/llm-file-parser/dist",
    "node_modules/@buildingai/utils/dist",
    "node_modules/@buildingai/types/dist",
    "node_modules/@buildingai/constants/dist",
]) {
    if (!existsSync(path.join(STAGE_CORE, rel))) die(`随包件缺失: ${rel}`);
}
// node-pty 平台原生件检测：兼容两种布局——
//  pnpm 隔离布局：.pnpm/@lydell+node-pty-<plat>/*.node；
//  hoisted 平铺：node_modules/@lydell/node-pty-win32-x64/*.node（当前主路径）。
let ptyNative = false;
{
    const pnpmDir = path.join(nm, ".pnpm");
    if (existsSync(pnpmDir)) {
        const platformDirs = readdirSync(pnpmDir, { withFileTypes: true })
            .filter((e) => e.isDirectory() && e.name.startsWith("@lydell+node-pty-"))
            .map((e) => e.name);
        outer: for (const id of platformDirs) {
            const stack = [path.join(pnpmDir, id)];
            while (stack.length) {
                const dir = stack.pop();
                let entries;
                try {
                    entries = readdirSync(dir, { withFileTypes: true });
                } catch {
                    continue;
                }
                for (const e of entries) {
                    const fp = path.join(dir, e.name);
                    if (e.isDirectory()) stack.push(fp);
                    else if (e.name.endsWith(".node")) {
                        ptyNative = true;
                        break outer;
                    }
                }
            }
        }
    }
    if (!ptyNative) {
        const ptyPkgDir = path.join(nm, "@lydell", "node-pty-win32-x64");
        if (existsSync(ptyPkgDir)) {
            const stack = [ptyPkgDir];
            while (stack.length && !ptyNative) {
                const dir = stack.pop();
                let entries;
                try {
                    entries = readdirSync(dir, { withFileTypes: true });
                } catch {
                    continue;
                }
                for (const e of entries) {
                    const fp = path.join(dir, e.name);
                    if (e.isDirectory()) stack.push(fp);
                    else if (e.name.endsWith(".node")) ptyNative = true;
                }
            }
        }
    }
}
if (!ptyNative) step("⚠️ 未检出 node-pty 平台分包（终端面板可能降级禁用，不阻塞 sidecar）");

// ── 5. 嵌入 node.exe（+ LICENSE 合规）──
step("嵌入 Node 运行时…");
const nodeSrc = process.execPath;
copyFileSync(nodeSrc, path.join(STAGE_DIR, IS_WIN ? "node.exe" : "node"));
let licenseSrc = path.join(path.dirname(nodeSrc), "LICENSE");
if (!existsSync(licenseSrc)) {
    licenseSrc = path.join(path.dirname(nodeSrc), "node_modules", "node", "LICENSE"); // nvm/安装器布局兜底
}
if (existsSync(licenseSrc)) {
    copyFileSync(licenseSrc, path.join(STAGE_DIR, "node-LICENSE.txt"));
} else {
    step("⚠️ 未找到 Node LICENSE 文件（合规：发布前请补随包 Node 许可文本）");
}

// ── 6. 门禁：随包 node.exe 启动 sidecar 并 initialize（异步读帧——sidecar 常驻不退出）──
// 门禁前清理运行时垃圾：*.d.ts/*.d.mts/*.map/*.md/*.pdb/.tsbuildinfo —— Node 运行时完全
// 不需要类型声明/源映射/文档/调试符号，且 @mistralai 等包的超长自动生成文件名会超
// NSIS 路径上限直接打崩安装包。
step("清理运行时垃圾（d.ts/map/md/pdb/tsbuildinfo）…");
{
    const PRUNE = [".d.ts", ".d.mts", ".d.cts", ".tsbuildinfo", ".map", ".md", ".pdb"];
    let pruned = 0;
    const walk = (dir) => {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            const fp = path.join(dir, e.name);
            if (e.isDirectory()) {
                walk(fp);
            } else if (PRUNE.some((suf) => e.name.endsWith(suf))) {
                try {
                    rmSync(fp, { force: true });
                    pruned++;
                } catch {
                    /* 忽略 */
                }
            }
        }
    };
    walk(STAGE_CORE);
    step(`已清理 ${pruned} 个运行时垃圾文件`);
}
// ── 5.5 裁剪不可用/不用包 + 超长路径守卫 ──
// @mistralai/mistralai 仅被 pi-ai 的 lazy 动态 import 引用（mistral-conversations.lazy.js），
// 网关模式（国内部署）不直连 Mistral；其自动生成的超长 operation 文件名（~100 字符）
// 会超 NSIS 260 字符路径上限打崩安装包。裁剪后仅在选择 Mistral 会话模型时才会报缺包。
{
    const mistral = path.join(nm, "@mistralai");
    if (existsSync(mistral)) {
        rmrf(mistral);
        step("已裁剪 @mistralai（lazy 动态依赖，网关模式不使用）");
    }
    // 守卫：剩余任一文件路径 > 245 字符（预留安装目录余量）→ 明确报错而非 NSIS 谜语
    let offender = null;
    const walk2 = (dir) => {
        if (offender) return;
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            if (offender) return;
            const fp = path.join(dir, e.name);
            if (e.isDirectory()) walk2(fp);
            else if (fp.length > 245) offender = fp;
        }
    };
    walk2(STAGE_DIR);
    if (offender) die(`存在超长路径（>245 字符），会打崩 NSIS：${offender}`);
    step("超长路径守卫通过");
}
step("门禁：随包 node.exe 启动 sidecar 并 initialize…");
await new Promise((resolveGate) => {
    const child = spawn(path.join(STAGE_DIR, IS_WIN ? "node.exe" : "node"), [path.join(STAGE_CORE, "dist", "index.js")], {
        cwd: STAGE_CORE,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
    });
    let buf = "";
    let settled = false;
    const finish = (ok, msg) => {
        if (settled) return;
        settled = true;
        child.kill();
        if (ok) {
            console.log(`[bundle] PASS — initialize ok（${msg}）`);
            rmrf(WS); // 门禁通过后才清理安装缓存
            resolveGate();
        } else {
            die(`随包 sidecar 门禁失败: ${msg}`);
        }
    };
    child.stdout.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (!line.trim()) continue;
            let msg;
            try {
                msg = JSON.parse(line);
            } catch {
                continue;
            }
            if (msg.id === 1) {
                finish(!msg.error, `capabilities=${msg.result?.capabilities?.methods?.length ?? 0} 项`);
            }
        }
    });
    child.stderr.on("data", () => {}); // 启动日志静默
    child.on("error", (e) => finish(false, `spawn: ${e.message}`));
    child.on("exit", (code) => finish(false, `sidecar 提前退出（code=${code}）`));
    child.stdin.write(`${JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: {
            serverUrl: "http://127.0.0.1:9", // 门禁不依赖服务端，审计上报失败静默
            token: "bundle-gate",
            workspaces: [],
            policy: { mode: "trust" },
        },
    })}\n`);
    setTimeout(() => finish(false, "30s 内未收到 initialize 响应"), 30_000);
});

// ── 7. 发布到 src-tauri/resources ──
step(`发布到 ${path.relative(REPO_ROOT, RUNTIME_DIR)}…`);
rmrf(RUNTIME_DIR);
copyDir(STAGE_DIR, RUNTIME_DIR);

const total = sizeOf(STAGE_DIR);
console.log(`[bundle] PASS — 运行时总体积 ${(total / 1024 / 1024).toFixed(1)} MB`);
console.log(`[bundle] 产物：${path.relative(REPO_ROOT, RUNTIME_DIR)}（暂存保留于 ${STAGE_DIR}）`);
