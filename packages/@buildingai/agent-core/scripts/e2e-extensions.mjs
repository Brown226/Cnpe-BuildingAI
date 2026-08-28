/**
 * Pi 扩展集成 E2E（两层）：
 *  1) 默认（离线）：验证 5 个官方扩展经 jiti 加载并注册工具，无错误。
 *     不需要模型端点，可进 CI。
 *  2) --live（在线，需 DEV_MODEL_BASE_URL）：真实对话驱动
 *     todo 工具（创建→完成）并断言 tool_call_end 携带 details.tasks 快照。
 *
 * 用法：node scripts/e2e-extensions.mjs [--live]
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const LIVE = process.argv.includes("--live");
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 与 src/index.ts 的 BUNDLED_PI_EXTENSIONS 保持一致（含 pi.extensions 入口） */
const BUNDLED = [
    ["@juicesharp/rpiv-todo", "index.ts", ["todo"]],
    ["@juicesharp/rpiv-ask-user-question", "index.ts", ["ask_user_question"]],
    ["@narumitw/pi-plan-mode", "dist/index.ts", ["plan_mode_question", "plan_mode_complete"]],
    ["@tintinweb/pi-subagents", "src/index.ts", ["Agent", "get_subagent_result", "steer_subagent"]],
    ["@ff-labs/pi-fff", "src/index.ts", ["ffgrep", "fffind"]],
];

// ─────────────────────────── 离线层：扩展注册 ───────────────────────────

async function offlineCheck() {
    const { DefaultResourceLoader } = await import("@earendil-works/pi-coding-agent");
    const paths = [];
    for (const [pkg, entry] of BUNDLED) {
        const file = join(PKG_ROOT, "node_modules", pkg, entry);
        if (!existsSync(file)) throw new Error(`扩展缺失: ${pkg}/${entry}`);
        paths.push(file);
    }
    const cwd = mkdtempSync(join(tmpdir(), "pi-e2e-off-"));
    const loader = new DefaultResourceLoader({
        cwd,
        agentDir: mkdtempSync(join(tmpdir(), "pi-e2e-agent-")),
        systemPrompt: "e2e",
        additionalExtensionPaths: paths,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
    });
    await loader.reload();
    const result = loader.getExtensions();
    if (result.errors.length > 0) {
        for (const err of result.errors) console.error("  扩展错误:", JSON.stringify(err).slice(0, 200));
        throw new Error(`扩展加载错误 ${result.errors.length} 个`);
    }
    const registered = new Map(
        result.extensions.map((e) => [e.path.replace(/\\/g, "/"), [...e.tools.keys()]]),
    );
    for (const [pkg, , expectedTools] of BUNDLED) {
        const entry = [...registered.entries()].find(([path]) => path.includes(pkg));
        if (!entry) throw new Error(`扩展未注册: ${pkg}`);
        const missing = expectedTools.filter((t) => !entry[1].includes(t));
        if (missing.length > 0) throw new Error(`${pkg} 缺少工具: ${missing.join(", ")}`);
        console.log(`  ✓ ${pkg} → ${entry[1].join(", ")}`);
    }
}

// ──────────────────── RPC sidecar 驱动（离线 + live 共用） ────────────────────

function startSidecar(workDir) {
    const child = spawn(process.execPath, [join(PKG_ROOT, "dist", "index.js")], {
        cwd: workDir,
        stdio: ["pipe", "pipe", "inherit"],
    });
    let id = 0;
    const pending = new Map();
    const notifications = [];
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
        if (!line.trim()) return;
        const frame = JSON.parse(line);
        if (frame.id !== undefined && pending.has(frame.id)) {
            pending.get(frame.id)(frame);
            pending.delete(frame.id);
        } else if (frame.method) notifications.push(frame);
    });
    return {
        child,
        notifications,
        request(method, params, timeoutMs = 150_000) {
            return new Promise((resolve, reject) => {
                const fid = ++id;
                pending.set(fid, (frame) =>
                    frame.error ? reject(new Error(JSON.stringify(frame.error))) : resolve(frame.result),
                );
                child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: fid, method, params })}\n`);
                setTimeout(() => {
                    if (pending.has(fid)) {
                        pending.delete(fid);
                        reject(new Error(`timeout: ${method}`));
                    }
                }, timeoutMs);
            });
        },
        kill() {
            child.kill();
        },
    };
}

async function collectUntil(workDir, predicate, timeoutMs = 180_000) {
    const sidecar = startSidecar(workDir);
    try {
        await sidecar.request("initialize", {
            serverUrl: "https://placeholder.local",
            token: "e2e",
            workspaces: [workDir],
            policy: { mode: "trust" },
        });
        // 等引擎就绪（.env.local 开发直连）；live 缺端点时直接跳过
        await new Promise((r) => setTimeout(r, 5000));
        const { sessionId } = await sidecar.request("session.create", { mode: "work" });
        const before = sidecar.notifications.length;
        await predicate.send?.(sidecar, sessionId);
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const fresh = sidecar.notifications.splice(before);
            for (const n of fresh) {
                const ev = n.params?.event;
                if (!ev) continue;
                if (await predicate.onEvent?.(ev)) return { sidecar, ok: true };
                if (ev.type === "done" || ev.type === "error") return { sidecar, ok: false, ev };
            }
            await new Promise((r) => setTimeout(r, 300));
        }
        return { sidecar, ok: false, ev: { type: "timeout" } };
    } catch (err) {
        sidecar.kill();
        throw err;
    }
}

// ─────────────────────────── live 层：todo 快照 ───────────────────────────

async function liveTodoCheck() {
    if (!process.env.DEV_MODEL_BASE_URL && !existsSync(join(PKG_ROOT, ".env.local"))) {
        console.log("  ⊘ 跳过 live：无 DEV_MODEL_BASE_URL / .env.local");
        return true;
    }
    const workDir = mkdtempSync(join(tmpdir(), "pi-e2e-live-"));
    let sawTaskCompleted = false;
    const { sidecar, ok } = await collectUntil(workDir, {
        async send(sidecar, sessionId) {
            await sidecar.request("session.send", {
                sessionId,
                text: "请立即调用 todo 工具创建任务『E2E 验证』，再调用一次将其状态改为 completed。完成后简短确认。",
            });
        },
        async onEvent(ev) {
            if (ev.type === "tool_call_start")
                console.log(`  start: ${ev.name} (${ev.callId})`);
            if (ev.type === "tool_call_end" && ev.name === "todo" && ev.resultPreview) {
                try {
                    const parsed = JSON.parse(ev.resultPreview);
                    const tasks = parsed?.details?.tasks;
                    if (Array.isArray(tasks))
                        console.log(`  end: tasks=${JSON.stringify(tasks.map((t) => ({ id: t.id, status: t.status })))}`);
                    if (tasks?.some((t) => t.status === "completed")) sawTaskCompleted = true;
                } catch {
                    /* 截断容错 */
                }
            }
            return false;
        },
    });
    sidecar.kill();
    if (!ok && !sawTaskCompleted) throw new Error("live todo 流程未观察到 completed 快照");
    if (!sawTaskCompleted) throw new Error("未观察到 completed 快照");
    return true;
}

// ─────────────────────────────── 主流程 ───────────────────────────────

console.log("== 离线：扩展注册检查 ==");
await offlineCheck();
console.log("离线检查通过 ✓");

if (LIVE) {
    console.log("== live：todo 快照流（真实对话，依赖 DEV_MODEL_BASE_URL） ==");
    await liveTodoCheck();
    console.log("live 检查通过 ✓");
} else {
    console.log("（--live 可追加真实对话验证）");
}
process.exit(0);