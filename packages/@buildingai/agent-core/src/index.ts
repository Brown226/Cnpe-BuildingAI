/**
 * Agent Sidecar 主入口（设计文档 §3.1 Node Agent Sidecar 层）。
 * 由 Tauri Rust Core 以子进程方式拉起；stdin/stdout 承载行分隔 JSON-RPC。
 * stdout 只输出协议帧——任何日志必须走 stderr。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
// 开发期密钥从包根 .env.local 加载（被 .gitignore 覆盖）；生产由 Tauri 注入环境
// quiet 必须：stdout 是唯一 RPC 出口，任何库不得向 stdout 打印
import dotenv from "dotenv";
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(PKG_ROOT, ".env.local"), quiet: true, override: false });
dotenv.config({ quiet: true });
// stdout 协议帧保护：第三方依赖（pdf.js 等）会经 console.* 向 stdout 打 warning，
// 任何非 JSON 行都会破坏 stdio JSON-RPC 流——统一改道 stderr（帧由 process.stdout.write 直写，不受影响）。
for (const level of ["log", "info", "warn", "debug"] as const) {
    console[level] = ((...args: unknown[]) => console.error(...args)) as typeof console.log;
}
import { RpcServer, logStderr } from "./protocol/server.js";
import { RpcError, RpcErrorCodes } from "./protocol/messages.js";
import { WorkspaceStore } from "./workspace/store.js";
import { PolicyEngine, assertAllowed } from "./policy/engine.js";
import type { PermissionMode } from "./policy/types.js";
import { ApprovalBroker } from "./approval/broker.js";
import { AuditCollector } from "./audit/collector.js";
import { UsageReporter } from "./audit/usage-reporter.js";
import { FileTools } from "./tools/file-tools.js";
import { CommandExecutor } from "./tools/command-exec.js";
import { OfficeTools } from "./tools/office-tools.js";
import type { PlatformTool } from "./tools/types.js";
import { runtimeConfig } from "./state/runtime-config.js";
import type { ConfigPack } from "./state/runtime-config.js";
import { getDatasetSelection, setDatasetSelection } from "./state/dataset-selection.js";
import { PiEngine } from "./engine/pi-engine.js";
import type { EngineEvent } from "./engine/types.js";
import { SessionJsonlStore } from "./session/jsonl-store.js";
import { AutomationScheduler } from "./schedule/scheduler.js";
import { assertAutomationTimezone } from "./schedule/schedules.js";
import { BrowserBridge } from "./browser/bridge.js";
import { TerminalManager } from "./terminal/pty.js";

const rpc = new RpcServer();
const audit = new AuditCollector();
/** 计量兑底上报（网关治理 P0）：仅开发直连模式启用，生产网关模式下不启用避免双算 */
const usageReporter = new UsageReporter();
const workspaces = new WorkspaceStore();
const policy = new PolicyEngine(workspaces);
const approvals = new ApprovalBroker((method, params) => rpc.notify(method, params));
const fileTools = new FileTools(workspaces, policy, approvals, audit);
const executor = new CommandExecutor(policy, approvals, audit);
const officeTools = new OfficeTools({ workspaces, policy, approvals, audit });
const engine = new PiEngine();
/** T1.3 会话 JSONL 存储：initialize 时按 sessionsDir（或默认目录）初始化 */
let sessions: SessionJsonlStore | null = null;
/** T5.1 定时任务调度器（initialize 后初始化并启动） */
let scheduler: AutomationScheduler | null = null;
/** T3.6 浏览器桥：agent 工具 → 前端驱动内嵌浏览器 */
const browser = new BrowserBridge((method, params) => rpc.notify(method, params));
/** B1 底部终端：pty 会话管理，cwd 强制在工作区白名单内 */
const terminal = new TerminalManager(
    workspaces,
    (id, data) => rpc.notify("terminal.output", { id, data }),
    (id, exitCode) => rpc.notify("terminal.exit", { id, exitCode }),
);

/** 平台自有工具：策略管控下的文件/命令能力，以受控形式交给 Agent 引擎。
 *  T2.4 工具按模式隔离：list_dir/read_file 通用（两模式）；
 *  write_file/execute 仅 Code；办公工具仅 Work。 */
const platformTools: PlatformTool[] = [
    {
        name: "list_dir",
        description:
            "列出工作区中某个目录的条目（名称/类型/大小）。只能访问已配置的工作区目录。",
        parameters: {
            type: "object",
            properties: {
                dir: { type: "string", description: "绝对路径或相对主工作区的路径" },
            },
            required: ["dir"],
        },
        execute: async (args) => {
            assertAllowed(
                policy.decideFileOp(String(args.dir), "read"),
                RpcErrorCodes.PolicyDenied,
            );
            const entries = fileTools.list(String(args.dir));
            audit.record({ type: "tool.call", action: "list_dir", detail: args });
            return {
                ok: true,
                summary: entries
                    .map((e) => `${e.type === "dir" ? "[目录]" : `[文件${e.size ? ` ${e.size}B` : ""}]`} ${e.name}`)
                    .join("\n") || "(空目录)",
                data: { count: entries.length },
            };
        },
    },
    {
        name: "read_file",
        description: "读取工作区中文本文件内容（最大 512KB，超长截断）。越界路径会被策略拒绝。",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "文件绝对路径" },
            },
            required: ["path"],
        },
        execute: async (args) => {
            const r = fileTools.read(String(args.path));
            audit.record({ type: "tool.call", action: "read_file", detail: { path: args.path } });
            return { ok: true, summary: r.content, data: { truncated: r.truncated } };
        },
    },
    {
        name: "write_file",
        description:
            "在工作区内写文本文件（覆盖或新建）。平衡模式下自动放行；严格模式会弹出审批卡片由用户确认。",
        modes: ["code"],
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "目标文件绝对路径" },
                content: { type: "string", description: "要写入的完整内容" },
            },
            required: ["path", "content"],
        },
        execute: async (args) => {
            const r = await fileTools.write(String(args.path), String(args.content));
            return { ok: true, summary: `已写入 ${r.bytesWritten} 字节`, data: r };
        },
    },
    {
        name: "execute",
        description:
            "在工作区目录内运行一条 shell 命令并返回输出。危险命令被黑名单硬拦截；白名单外命令在平衡模式下需用户审批。",
        modes: ["code"],
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "要执行的命令行" },
                cwd: { type: "string", description: "工作目录（必须位于工作区内）" },
            },
            required: ["command", "cwd"],
        },
        execute: async (args) => {
            const r = await executor.run(String(args.command), String(args.cwd));
            return {
                ok: r.exitCode === 0 && !r.timedOut,
                summary: [
                    `exit=${r.exitCode}${r.timedOut ? " (超时强杀)" : ""}`,
                    r.stdout && `stdout:\n${r.stdout}`,
                    r.stderr && `stderr:\n${r.stderr}`,
                ]
                    .filter(Boolean)
                    .join("\n"),
                data: { exitCode: r.exitCode, timedOut: r.timedOut },
            };
        },
    },
    {
        name: "parse_document",
        description:
            "读取并解析工作区中的文档为纯文本（支持 .pdf/.docx/.pptx/.xlsx/.xls/.csv/.txt/.md/.html/.rtf/.json/.xml）。用于回答关于文档内容的问题或基于现有文件加工。",
        modes: ["work"],
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "文档绝对路径（须位于工作区内）" },
            },
            required: ["path"],
        },
        execute: async (args) => {
            const r = await officeTools.parseDocument(String(args.path));
            return { ok: true, summary: r.text, data: { truncated: r.truncated, kind: r.kind } };
        },
    },
    {
        name: "export_docx",
        description:
            "把 Markdown 文本导出为工作区内的 Word (.docx) 报告。支持标题(#)、加粗(**)、无序列表(-)；生成后告知用户保存位置。",
        modes: ["work"],
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "目标 .docx 文件绝对路径" },
                markdown: {
                    type: "string",
                    description: "Markdown 源文本，如 '# 标题\\n正文…'",
                },
            },
            required: ["path", "markdown"],
        },
        execute: async (args) => {
            const r = await officeTools.exportDocx(String(args.path), String(args.markdown));
            return { ok: true, summary: r.summary, data: r };
        },
    },
    {
        name: "export_xlsx",
        description:
            "把二维表格数据写入工作区内的 Excel (.xlsx)。rows 为数组套数组的行集合，首行为表头；适合清单、统计表等产出。",
        modes: ["work"],
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "目标 .xlsx 文件绝对路径" },
                sheetName: { type: "string", description: "工作表名，默认 Sheet1" },
                rows: {
                    type: "array",
                    items: { type: "array" },
                    description: '如 [["姓名","部门"],["张三","财务部"]]',
                },
            },
            required: ["path", "rows"],
        },
        execute: async (args) => {
            const rows = args.rows as unknown[][];
            const r = await officeTools.exportXlsx(
                String(args.path),
                rows,
                typeof args.sheetName === "string" ? args.sheetName : undefined,
            );
            return { ok: true, summary: r.summary, data: r };
        },
    },
    {
        name: "export_pptx",
        description:
            "把大纲文本生成为工作区内的 PPT 演示 (.pptx)。# 标题 定义一页（可选 ## 副标题），普通行 = 该页要点；适合汇报、宣讲类产出。生成后告知用户保存位置。",
        modes: ["work"],
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "目标 .pptx 文件绝对路径" },
                outline: {
                    type: "string",
                    description: "大纲文本，如 '# 二期进展\\n- 要点一\\n# 下一步\\n- 要点二'",
                },
            },
            required: ["path", "outline"],
        },
        execute: async (args) => {
            const r = await officeTools.exportPptx(String(args.path), String(args.outline));
            return { ok: true, summary: r.summary, data: r };
        },
    },
    {
        name: "browser_navigate",
        description:
            "在内置浏览器中打开指定网址并等待加载。用于访问网页、采集资料。",
        parameters: {
            type: "object",
            properties: { url: { type: "string", description: "要打开的网址" } },
            required: ["url"],
        },
        execute: async (args) => {
            const url = String(args.url ?? "");
            // T4.8 出网白名单校验
            assertAllowed(policy.decideEgress(url), RpcErrorCodes.PolicyDenied);
            const r = await browser.request("navigate", url);
            return { ok: true, summary: `已导航到 ${url}`, data: { result: r } };
        },
    },
    {
        name: "browser_read",
        description:
            "读取当前内置浏览器页面的可见文本内容，用于把网页信息带回工作区。",
        parameters: { type: "object", properties: {}, required: [] },
        execute: async () => {
            const r = await browser.request("read");
            return { ok: true, summary: r.slice(0, 6000), data: { chars: r.length } };
        },
    },
    {
        name: "browser_eval",
        description:
            "在内置浏览器当前页面执行一段 JavaScript 并返回结果。用于抓取结构化数据或操作页面元素。",
        parameters: {
            type: "object",
            properties: { js: { type: "string", description: "要执行的 JavaScript" } },
            required: ["js"],
        },
        execute: async (args) => {
            const r = await browser.request("eval", String(args.js ?? ""));
            return { ok: true, summary: r.slice(0, 6000), data: { chars: r.length } };
        },
    },
    {
        // ⑤ 知识库检索：桌面端输入条「知识库」选择器挂载的数据集，
        //    经服务端 /ai-datasets/:id/retrieve 做向量/全文检索（对齐 Kun 会话级知识库挂载）
        name: "dataset_search",
        description:
            "在当前会话已挂载的企业知识库中检索相关内容片段。回答事实性、资料类问题前应先检索；" +
            "若当前会话未挂载知识库，工具会提示用户先在输入条下方「知识库」入口选择。",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "检索关键词或自然语言问题" },
                topK: { type: "number", description: "每个知识库返回的片段数上限，缺省 6" },
            },
            required: ["query"],
        },
        execute: async (args, context) => {
            const datasetIds = getDatasetSelection(context?.sessionId ?? "");
            if (datasetIds.length === 0) {
                return {
                    ok: false,
                    summary: "当前会话未挂载知识库：请让用户通过输入条下方的「知识库」入口选择后重试。",
                    data: { mounted: 0 },
                };
            }
            const query = String(args.query ?? "").trim();
            if (!query) return { ok: false, summary: "缺少检索词 query。", data: { mounted: datasetIds.length } };
            const topK =
                typeof args.topK === "number" && args.topK > 0 ? Math.min(Math.floor(args.topK), 20) : 6;
            const cfg = runtimeConfig.require()!;
            const base = cfg.serverUrl.replace(/\/+$/, "");
            const results = await Promise.all(
                datasetIds.map(async (id) => {
                    try {
                        const res = await fetch(
                            `${base}/api/v1/ai-datasets/${encodeURIComponent(id)}/retrieve`,
                            {
                                method: "POST",
                                headers: {
                                    "content-type": "application/json",
                                    authorization: `Bearer ${cfg.token}`,
                                },
                                body: JSON.stringify({ query, topK }),
                            },
                        );
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        return (await res.json()) as {
                            chunks?: Array<{
                                content?: string;
                                score?: number;
                                fileName?: string;
                            }>;
                            totalTime?: number;
                        };
                    } catch (err) {
                        logStderr(`dataset_search 检索失败（dataset=${id}）: ${String(err)}`);
                        return { chunks: [] as Array<{ content?: string; score?: number; fileName?: string }> };
                    }
                }),
            );
            const chunks = results.flatMap((r) => r.chunks ?? []);
            audit.record({
                type: "tool.call",
                action: "dataset_search",
                detail: { query, datasets: datasetIds.length, hits: chunks.length },
            });
            if (chunks.length === 0) {
                return {
                    ok: true,
                    summary: `已检索 ${datasetIds.length} 个知识库，未命中相关内容。`,
                    data: { hits: 0, datasets: datasetIds.length },
                };
            }
            const lines = chunks.map(
                (c, i) =>
                    `[${i + 1}] ${c.fileName ?? "（未命名文档）"}（相关度 ${
                        typeof c.score === "number" ? c.score.toFixed(3) : "?"
                    }）\n${String(c.content ?? "").slice(0, 1200)}`,
            );
            return {
                ok: true,
                summary: lines.join("\n\n").slice(0, 12000),
                data: { hits: chunks.length, datasets: datasetIds.length },
            };
        },
    },
];

// ── 生命周期 ───────────────────────────────────────────────────────────

rpc.register("initialize", (params) => {
    const pack = params as Partial<ConfigPack>;
    if (!pack?.serverUrl || !pack?.token)
        throw new RpcError(RpcErrorCodes.InvalidParams, "initialize 需要 serverUrl 与 token");
    runtimeConfig.set(pack as ConfigPack);
    if (pack.workspaces) workspaces.setAll(pack.workspaces);
    policy.configure(pack.policy);
    policy.setEgressAllowlist(pack.egressAllowlist ?? []);
    const pack0 = runtimeConfig.require()!;
    audit.configure(pack0.serverUrl, pack0.token, pack0.userId);
    // 计量兑底：仅开发直连模式启用（生产走网关请求级计量，避免双算）
    if (process.env.DEV_MODEL_BASE_URL) usageReporter.configure(pack0.serverUrl, pack0.token);
    // T1.3：会话 JSONL 根目录（桌面端下发；缺省系统临时目录）
    sessions = new SessionJsonlStore(pack.sessionsDir || SessionJsonlStore.defaultRoot());
    // T5.1：定时任务调度器（数据目录：任务/记录；启动后按调度触发）
    scheduler = new AutomationScheduler(engine, sessions, pack.sessionsDir || SessionJsonlStore.defaultRoot());
    scheduler.start();
    void bootstrapEngineOnce();
    return {
        protocolVersion: "1.0",
        capabilities: {
            methods: [
                "session.create",
                "session.send",
                "session.abort",
                "session.setModel",
                "session.list",
                "session.get",
                "fs.list",
                "fs.read",
                "fs.readBinary",
                "fs.write",
                "fs.create",
                "fs.rename",
                "fs.delete",
                "fs.recent",
                "exec.run",
                "policy.getMode",
                "policy.setMode",
                "workspace.list",
                "workspace.add",
                "workspace.remove",
                "workspace.setActive",
                "workspace.createConversationDir",
                "office.parse",
                "office.exportDocx",
                "office.exportXlsx",
                "office.exportPptx",
                "office.readXlsx",
                "schedule.list",
                "schedule.create",
                "schedule.delete",
                "schedule.run",
                "schedule.records",
            ],
            engineReady: false,
        },
    };
});

/**
 * 随装 Pi 官方扩展（pi.dev/packages 收录，npm 月下载量选型）：
 * - @juicesharp/rpiv-todo            todo 工具 + 会话级任务清单（②Todo Tab 数据源）
 * - @juicesharp/rpiv-ask-user-question 结构化提问工具（计划确认/澄清交互）
 * - @narumitw/pi-plan-mode            Codex 式只读计划模式（④计划面板）
 * - @tintinweb/pi-subagents           Claude Code 同名子代理工具（③子代理卡片）
 * 入口以包内 pi.extensions 声明为准；缺失时跳过（可选依赖）。
 */
const BUNDLED_PI_EXTENSIONS: Array<[string, string]> = [
    ["@juicesharp/rpiv-todo", "index.ts"],
    ["@juicesharp/rpiv-ask-user-question", "index.ts"],
    ["@narumitw/pi-plan-mode", "dist/index.ts"],
    ["@tintinweb/pi-subagents", "src/index.ts"],
    ["@ff-labs/pi-fff", "src/index.ts"],
];

function resolveBundledExtensionPaths(): string[] {
    const fromEnv = process.env.AGENT_CORE_EXTENSIONS;
    if (fromEnv) {
        return fromEnv
            .split(/[;,]/)
            .map((p) => p.trim())
            .filter(Boolean);
    }
    const paths: string[] = [];
    for (const [pkg, entry] of BUNDLED_PI_EXTENSIONS) {
        const file = join(PKG_ROOT, "node_modules", pkg, entry);
        if (fs.existsSync(file)) paths.push(file);
        else logStderr(`Pi 扩展缺失（跳过）: ${pkg}`);
    }
    return paths;
}

/** initialize 之后的异步引导：启动引擎（模型端点 + 工具注册），幂等 */
let engineBooted = false;
async function bootstrapEngine(): Promise<void> {
    try {
        engine.registerTools(platformTools);
        const ws = workspaces.list()[0];
        if (ws) process.env.AGENT_CORE_WORKSPACE = ws;
        const cfg = runtimeConfig.require()!;
        // 开发直连优先（DEV_MODEL_BASE_URL 存在时跳过网关），生产走服务端网关（ADR-05）
        const devDirect = Boolean(process.env.DEV_MODEL_BASE_URL);
        const extensionPaths = resolveBundledExtensionPaths();
        if (extensionPaths.length > 0) logStderr(`加载 Pi 扩展 ${extensionPaths.length} 个`);
        await engine.start({
            modelGatewayUrl: devDirect ? "" : joinUrl(cfg.serverUrl, "/api/gateway"),
            gatewayToken: devDirect ? "" : cfg.token,
            defaultModel: cfg.defaultModel
                ? {
                      provider: cfg.defaultModel.provider ?? "huashu-gateway",
                      modelId: cfg.defaultModel.modelId,
                  }
                : undefined,
            storageDir: ".",
            skills: cfg.skills,
            extensionPaths,
        });
        rpc.notify("engine/event", { kind: "engine_ready" });
    } catch (err) {
        logStderr(`引擎启动失败（对话功能不可用，策略工具仍可用）: ${String(err)}`);
        rpc.notify("engine/event", { kind: "engine_error", message: String(err) });
    }
}

function joinUrl(base: string, path: string): string {
    return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

rpc.register("ping", () => ({ pong: Date.now() }));

// ── 策略与工作区管理（用户仅可降档） ─────────────────────────────────────

rpc.register("policy.getMode", () => ({
    mode: policy.currentMode,
    workspaceCount: workspaces.list().length,
}));

rpc.register("policy.setMode", (params) => {
    const mode = (params as { mode?: string })?.mode as PermissionMode | undefined;
    if (!mode || !["strict", "balanced", "trust"].includes(mode))
        throw new RpcError(RpcErrorCodes.InvalidParams, "无效的权限模式");
    // 天花板校验在 PolicyEngine 内执行（用户只能降档）
    policy.setMode(mode);
    return { mode: policy.currentMode };
});

rpc.register("workspace.list", () => ({ dirs: workspaces.list() }));

rpc.register("workspace.add", (params) => {
    const dir = (params as { dir?: string })?.dir;
    if (!dir) throw new RpcError(RpcErrorCodes.InvalidParams, "缺少 dir 参数");
    const abs = String(dir);
    // 目录本身也须通过文件策略白名单校验语义：先加入再验证父级无意义，
    // 直接尝试 stat —— WorkspaceStore.add 内部会失败返回 false
    const ok = workspaces.add(abs);
    if (!ok) throw new RpcError(RpcErrorCodes.InvalidParams, `目录不存在或已添加：${abs}`);
    return { ok: true };
});

rpc.register("workspace.remove", (params) => {
    const dir = (params as { dir?: string })?.dir;
    if (!dir) throw new RpcError(RpcErrorCodes.InvalidParams, "缺少 dir 参数");
    const removed = workspaces.remove(String(dir));
    if (removed) terminal.disposeByWorkspace(String(dir));
    return { removed };
});

/**
 * 激活工作区（复刻 openwork "激活=列表首位" 语义）：
 * 置顶白名单并把引擎默认 cwd 切到该目录——已存在的会话保持原 cwd，
 * 新建会话即落入新激活目录。
 */
rpc.register("workspace.setActive", (params) => {    requireInitialized();
    const dir = str(params, "dir");
    const list = workspaces.list();
    const hit = list.find((l) => l.toLowerCase() === dir.toLowerCase());
    if (!hit)
        throw new RpcError(RpcErrorCodes.InvalidParams, `该目录不在工作区列表：${dir}`);
    workspaces.setAll([hit, ...list.filter((l) => l !== hit)]);
    process.env.AGENT_CORE_WORKSPACE = hit;
    return { active: hit };
});

/** C1 时间戳会话目录（对齐 Kun conversation:create-workspace 语义）：
 *  在「会话根」（缺省 ~/Documents/华数工作区，可用 HS_CONVERSATION_ROOT 覆盖）
 *  下创建 YYYYMMDD-HHmmss 子目录，返回路径供前端加入白名单并激活。 */
rpc.register("workspace.createConversationDir", () => {
    const root = process.env.HS_CONVERSATION_ROOT ?? path.join(os.homedir(), "Documents", "华数工作区");
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const dir = path.join(root, stamp);
    fs.mkdirSync(dir, { recursive: true });
    return { dir };
});

// ── 文件操作 ───────────────────────────────────────────────────────────

rpc.register("fs.list", (params) => {
    requireInitialized();
    const dir = str(params, "dir");
    assertAllowed(policy.decideFileOp(dir, "read"), RpcErrorCodes.PolicyDenied);
    return { entries: fileTools.list(dir) };
});

rpc.register("fs.read", (params) => {
    requireInitialized();
    return fileTools.read(str(params, "path"));
});

/** T3.5 二进制读取（PPT 在线预览等）：base64 返回，上限 20MB */
rpc.register("fs.readBinary", (params) => {
    requireInitialized();
    const p = str(params, "path");
    assertAllowed(policy.decideFileOp(p, "read"), RpcErrorCodes.PolicyDenied);
    const buf = fs.readFileSync(p);
    if (buf.length > 20 * 1024 * 1024)
        throw new RpcError(RpcErrorCodes.InvalidParams, "文件超过 20MB，无法在线预览");
    return { base64: buf.toString("base64"), size: buf.length };
});

rpc.register("fs.write", async (params) => {
    requireInitialized();
    const p = params as { path?: string; content?: string };
    if (!p?.path || typeof p.content !== "string")
        throw new RpcError(RpcErrorCodes.InvalidParams, "fs.write 需要 path 与 content");
    return fileTools.write(p.path, p.content);
});

rpc.register("fs.create", async (params) => {
    requireInitialized();
    const p = params as { path?: string; type?: string };
    if (!p?.path || !p.type) throw new RpcError(RpcErrorCodes.InvalidParams, "fs.create 需要 path 与 type");
    return fileTools.createEntry(p.path, p.type === "directory" ? "directory" : "file");
});

rpc.register("fs.rename", async (params) => {
    requireInitialized();
    const p = params as { path?: string; newName?: string };
    if (!p?.path || !p.newName) throw new RpcError(RpcErrorCodes.InvalidParams, "fs.rename 需要 path 与 newName");
    return fileTools.renameEntry(p.path, p.newName);
});

rpc.register("fs.delete", async (params) => {
    requireInitialized();
    return fileTools.deleteEntry(str(params, "path"));
});

/** 最近修改文件（右侧工作区面板数据源） */
// ── 目录监听（Kun workspace-file-watcher：native 优先，失败降级轮询） ──

type WatchState = {
    watcher: fs.FSWatcher | null;
    timer: NodeJS.Timeout | null;
    snapshot: Map<string, number>;
};
const watchStates = new Map<string, WatchState>();
let notifyTimer: NodeJS.Timeout | null = null;

function snapshotRoot(root: string): Map<string, number> {
    const snap = new Map<string, number>();
    const walk = (dir: string, depth: number): void => {
        if (depth > 3 || snap.size > 1500) return;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            try {
                const st = fs.statSync(full);
                snap.set(full, st.mtimeMs);
                if (e.isDirectory()) walk(full, depth + 1);
            } catch {
                /* race，忽略 */
            }
        }
    };
    walk(root, 1);
    return snap;
}

function scheduleNotify(root: string): void {
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
        notifyTimer = null;
        rpc.notify("engine/event", { kind: "fs/changed", root });
    }, 400);
}

function stopWatch(root: string): void {
    const state = watchStates.get(root);
    if (!state) return;
    state.watcher?.close();
    if (state.timer) clearInterval(state.timer);
    watchStates.delete(root);
}

function startWatch(root: string): void {
    if (watchStates.has(root)) return;
    const state: WatchState = { watcher: null, timer: null, snapshot: snapshotRoot(root) };
    watchStates.set(root, state);
    try {
        state.watcher = fs.watch(
            root,
            { recursive: true },
            () => {
                state.snapshot = snapshotRoot(root);
                scheduleNotify(root);
            },
        );
        state.watcher.on("error", () => {
            // native 失败 → 轮询降级
            state.watcher?.close();
            state.watcher = null;
            if (!state.timer) {
                state.timer = setInterval(() => {
                    const next = snapshotRoot(root);
                    if (
                        next.size !== state.snapshot.size ||
                        [...next].some(([k, v]) => state.snapshot.get(k) !== v)
                    ) {
                        state.snapshot = next;
                        scheduleNotify(root);
                    }
                }, 1500);
            }
        });
    } catch {
        state.watcher = null;
    }
}

rpc.register("fs.watch", (params) => {
    requireInitialized();
    const root = str(params, "root");
    startWatch(root);
    return { watching: true };
});

rpc.register("fs.unwatch", (params) => {
    requireInitialized();
    stopWatch(str(params, "root"));
    return { watching: false };
});

rpc.register("fs.recent", (params) => {
    requireInitialized();
    const p = params as { root?: string; limit?: number; maxDepth?: number };
    if (!p?.root) throw new RpcError(RpcErrorCodes.InvalidParams, "fs.recent 需要 root");
    return {
        files: fileTools.recentFiles(p.root, { limit: p.limit, maxDepth: p.maxDepth }),
    };
});

// ── 命令执行 ───────────────────────────────────────────────────────────

rpc.register("exec.run", (params) => {
    requireInitialized();
    const p = params as { command?: string; cwd?: string };
    if (!p?.command || !p?.cwd)
        throw new RpcError(RpcErrorCodes.InvalidParams, "exec.run 需要 command 与 cwd");
    return executor.run(p.command, p.cwd);
});

// ── 审批响应通知 ───────────────────────────────────────────────────────

rpc.onNotification("approval/respond", (raw) => {
    const p = raw as {
        requestId?: string;
        approved?: boolean;
        reason?: string;
        remember?: boolean;
    };
    if (!p?.requestId) return;
    approvals.respond(p.requestId, Boolean(p.approved), p.reason, Boolean(p.remember));
});

// T3.6 浏览器结果回传（agent 驱动内嵌浏览器）
rpc.onNotification("browser/result", (raw) => {
    const p = raw as { requestId?: string; result?: string; error?: string };
    if (!p?.requestId) return;
    browser.respond(p.requestId, p.result, p.error);
});

// ── 底部终端（B1：pty 会话，cwd=激活工作区；输入/缩放走通知流无响应） ──

rpc.register("terminal.create", (params) => {
    requireInitialized();
    const p = (params ?? {}) as { cwd?: string; cols?: number; rows?: number };
    return terminal.create(String(p.cwd ?? ""), Number(p.cols), Number(p.rows));
});

rpc.onNotification("terminal.input", (raw) => {
    const p = raw as { id?: string; data?: string };
    if (!p?.id || typeof p.data !== "string") return;
    terminal.write(p.id, p.data);
});

rpc.onNotification("terminal.resize", (raw) => {
    const p = raw as { id?: string; cols?: number; rows?: number };
    if (!p?.id || typeof p.cols !== "number" || typeof p.rows !== "number") return;
    terminal.resize(p.id, p.cols, p.rows);
});

rpc.onNotification("terminal.dispose", (raw) => {
    const p = raw as { id?: string };
    if (!p?.id) return;
    terminal.dispose(p.id);
});

// ── 办公文档直通（与 fs.* 同级：供 UI/测试确定性调用；引擎侧另有同名工具） ──

rpc.register("office.parse", async (params) => {
    requireInitialized();
    return officeTools.parseDocument(str(params, "path"));
});
rpc.register("office.exportDocx", async (params) => {
    requireInitialized();
    const p = params as { path?: string; markdown?: string };
    if (!p?.path || typeof p.markdown !== "string")
        throw new RpcError(RpcErrorCodes.InvalidParams, "需要 path 与 markdown");
    return officeTools.exportDocx(p.path, p.markdown);
});
rpc.register("office.exportXlsx", async (params) => {
    requireInitialized();
    const p = params as { path?: string; rows?: unknown[][]; sheetName?: string };
    if (!p?.path || !Array.isArray(p.rows))
        throw new RpcError(RpcErrorCodes.InvalidParams, "需要 path 与 rows");
    return officeTools.exportXlsx(p.path, p.rows, p.sheetName);
});
rpc.register("office.exportPptx", async (params) => {
    requireInitialized();
    const p = params as { path?: string; outline?: string };
    if (!p?.path || typeof p.outline !== "string")
        throw new RpcError(RpcErrorCodes.InvalidParams, "需要 path 与 outline");
    return officeTools.exportPptx(p.path, p.outline);
});

/** T2.3 工件表格：结构化读取 xlsx（前端表格编辑器数据源） */
rpc.register("office.readXlsx", async (params) => {
    requireInitialized();
    const p = params as { path?: string };
    if (!p?.path) throw new RpcError(RpcErrorCodes.InvalidParams, "需要 path");
    return officeTools.readXlsx(p.path);
});

// ── 定时任务（T5.1） ─────────────────────────────────────────────────

rpc.register("schedule.list", () => {
    requireInitialized();
    return { tasks: scheduler!.listTasks(), records: scheduler!.listRecords() };
});

rpc.register("schedule.create", (params) => {
    requireInitialized();
    const p = params as {
        name?: string;
        instructions?: string;
        schedule?: { kind?: string; at?: number; hour?: number; minute?: number; daysOfWeek?: number[]; timezone?: string };
        mode?: string;
    };
    if (!p?.instructions || !p?.schedule?.kind || !p?.schedule?.timezone)
        throw new RpcError(RpcErrorCodes.InvalidParams, "schedule.create 需要 instructions、schedule.kind 与 schedule.timezone");
    assertAutomationTimezone(p.schedule.timezone);
    const task = scheduler!.createTask({
        name: p.name ?? "",
        instructions: p.instructions,
        schedule: {
            kind: p.schedule.kind as "once" | "daily" | "weekly",
            at: typeof p.schedule.at === "number" ? p.schedule.at : undefined,
            hour: typeof p.schedule.hour === "number" ? p.schedule.hour : undefined,
            minute: typeof p.schedule.minute === "number" ? p.schedule.minute : undefined,
            daysOfWeek: Array.isArray(p.schedule.daysOfWeek) ? p.schedule.daysOfWeek.map(Number) : undefined,
            timezone: p.schedule.timezone,
        },
        mode: normalizeMode(p.mode),
    });
    return { task };
});

rpc.register("schedule.delete", (params) => {
    requireInitialized();
    return { deleted: scheduler!.deleteTask(str(params, "id")) };
});

rpc.register("schedule.run", async (params) => {
    requireInitialized();
    const id = str(params, "id");
    const task = scheduler!.listTasks().find((t) => t.id === id);
    if (!task) throw new RpcError(RpcErrorCodes.InvalidParams, `任务不存在：${id}`);
    return { record: await scheduler!.executeTask(task) };
});

rpc.register("schedule.records", (params) => {
    requireInitialized();
    const id = (params as { id?: string } | undefined)?.id;
    return { records: scheduler!.listRecords(id && id !== "null" ? id : undefined) };
});

// ── Agent 引擎通道 ─────────────────────────────────────────────────────

/**
 * 创建会话。mode 为会话属性（T1.1 双模式）：code | work，缺省 code；
 * 会话创建后模式固定，切换模式=新建该模式的会话。
 * T1.3：会话元数据落 JSONL（meta.json），正文随事件流落 messages.jsonl。
 */
rpc.register("session.create", (params) => {
    const mode = normalizeMode((params as { mode?: string } | undefined)?.mode);
    const cwd = process.env.AGENT_CORE_WORKSPACE ?? "";
    const meta = sessions!.createSession(mode, cwd);
    return { sessionId: meta.id, mode };
});

/** 列出本地会话元数据（侧栏/恢复用；按 updatedAt 倒序） */
rpc.register("session.list", () => {
    requireInitialized();
    return { sessions: sessions!.listMeta() };
});

/** 读取会话详情：元数据 + 对话文本流（回放用；正文只存本机） */
rpc.register("session.get", (params) => {
    requireInitialized();
    const id = str(params, "sessionId");
    return { meta: sessions!.getMeta(id), messages: sessions!.readMessages(id) };
});

function normalizeMode(mode: string | undefined): "code" | "work" {
    return mode === "work" ? "work" : "code";
}

/**
 * 发送用户消息：立即返回 accepted；事件以
 * notification(engine/event, {sessionId, event}) 形式流出，
 * 消费方收到 type=done/error 即一轮结束。
 * mode 仅在首次发送（建会话）时生效，之后被忽略。
 */
rpc.register("session.send", (params) => {
    requireInitialized();
    const p = params as {
        sessionId?: string;
        text?: string;
        mode?: string;
        agentRole?: string;
        datasetIds?: unknown;
        graph?: boolean;
        goal?: boolean;
    };
    if (!p?.sessionId || !p.text)
        throw new RpcError(RpcErrorCodes.InvalidParams, "session.send 需要 sessionId 与 text");
    // #1 目标验收模式：/goal 前缀解析（引擎侧兜底；客户端 composer 亦可直接置 goal 标志）
    let sendText = p.text;
    let goal = Boolean(p.goal);
    if (!goal && (sendText.startsWith("/goal ") || sendText === "/goal")) {
        goal = true;
        sendText = sendText.replace(/^\/goal\s*/, "").trim();
        if (!sendText)
            throw new RpcError(RpcErrorCodes.InvalidParams, "/goal 需要目标描述");
    }
    // ⑤ 知识库挂载：随每轮发送更新会话级挂载集合（对齐 Kun thread knowledgeBases）
    if (Array.isArray(p.datasetIds)) {
        setDatasetSelection(p.sessionId, p.datasetIds.map((id) => String(id)));
    }
    void pumpSessionEvents(p.sessionId, sendText, p.mode, p.agentRole, Boolean(p.graph), goal).catch((err) => {
        logStderr(`session.send 泵异常: ${String(err)}`);
        rpc.notify("engine/event", {
            sessionId: p.sessionId,
            event: { type: "error", message: String(err), recoverable: false } satisfies EngineEvent,
        });
    });
    return { accepted: true };
});

async function pumpSessionEvents(
    sessionId: string,
    text: string,
    mode?: string,
    agentRole?: string,
    graph = false,
    goal = false,
): Promise<void> {
    // Graph 编排（Kun graph orchestration 语义的提示词实现）：计划 → 委派子代理 → 监督审查 → 汇总
    // （与 /goal 并存：goal 包装在引擎侧再叠一层，原始目标即编排后的任务文本）
    const finalText = graph
        ? [
              "【Graph 编排模式】请按以下流程执行本任务：",
              "1. 规划：先输出任务清单（编号列出要做的子任务）。",
              "2. 委派：每个子任务调用 Agent 子代理工具委派执行（一次只派一个，等待结果）。",
              "3. 监督：子代理完成后检查结果，不合格的说明原因并重新委派（至多一次）。",
              "4. 汇总：全部完成后给出总览与交付物清单。",
              "",
              `任务：${text}`,
          ].join("\n")
        : text;
    // T1.3：user 消息先落盘；事件流累计 assistant 文本与工具摘要，done/error 时落盘；
    // 每个引擎事件同时追加到 events.jsonl（Kun 完整事件流语义，诊断/回放/审计用）
    sessions?.appendMessage(sessionId, { role: "user", text: finalText, ts: Date.now() });
    let assistantText = "";
    let toolSummary = "";
    for await (const event of engine.sendMessage(sessionId, { text: finalText, mode: normalizeMode(mode), agentRole, goal })) {
        sessions?.appendEvent(sessionId, event);
        if (event.type === "text_delta") assistantText += event.delta;
        else if (event.type === "tool_call_end")
            toolSummary += `\n[工具 ${event.name ?? "tool"} ${event.ok ? "完成" : "失败"} · ${event.durationMs ?? 0}ms]`;
        else if (event.type === "usage") {
            // T4.6 用量计费：token 计量随审计通道上报服务端（按用户聚合）。
            // 网关治理 P0：补 mode/modelId 维度，供服务端按模式×模型分账与成本换算。
            audit.record({
                type: "session.usage",
                action: "token.usage",
                detail: {
                    inputTokens: event.inputTokens,
                    outputTokens: event.outputTokens,
                    cacheReadTokens: event.cacheReadTokens ?? 0,
                    cacheWriteTokens: event.cacheWriteTokens ?? 0,
                    mode: event.mode,
                    modelId: event.modelId,
                },
            });
            // 计量账本兑底（网关治理 P0 · A2）：仅开发直连模式启用。
            // 生产网关模式下网关请求级计量（source=gateway）已覆盖，避免双算。
            if (usageReporter.enabled) {
                usageReporter.record({
                    mode: event.mode,
                    modelId: event.modelId,
                    sessionId,
                    inputTokens: event.inputTokens,
                    outputTokens: event.outputTokens,
                    cacheReadTokens: event.cacheReadTokens ?? 0,
                    cacheWriteTokens: event.cacheWriteTokens ?? 0,
                });
            }
        } else if (event.type === "done" || event.type === "error") {
            const full = assistantText + (toolSummary.trim() ? `\n${toolSummary.trim()}` : "");
            if (full.trim())
                sessions?.appendMessage(sessionId, { role: "assistant", text: full, ts: Date.now() });
            // 首次对话自动生成标题（与新客户端 titleSeed 语义一致）
            const meta = sessions?.getMeta(sessionId);
            if (meta && meta.title === "新对话") {
                const title = text.replace(/\s+/g, " ").trim().slice(0, 40) || "新对话";
                sessions?.updateMeta(sessionId, { title });
            }
        }
        rpc.notify("engine/event", { sessionId, event });
    }
}

rpc.register("session.abort", (params) => {
    const id = str(params, "sessionId");
    engine.abort(id);
    return { aborted: true };
});

/** 模型选择器生效：切换会话模型（重建会话 = 新上下文，幂等） */
rpc.register("session.setModel", (params) => {
    const id = str(params, "sessionId");
    const modelId = (params as { modelId?: string })?.modelId;
    engine.setModel(id, modelId);
    return { set: Boolean(modelId) };
});

// ── 工具函数 ───────────────────────────────────────────────────────────

function requireInitialized(): void {
    if (!runtimeConfig.get())
        throw new RpcError(RpcErrorCodes.InvalidRequest, "请先调用 initialize");
}

/** 引擎只引导一次 */
function bootstrapEngineOnce(): void {
    if (engineBooted) return;
    engineBooted = true;
    void bootstrapEngine();
}

function str(params: unknown, key: string): string {
    const v = (params as Record<string, unknown> | undefined)?.[key];
    if (typeof v !== "string" || !v)
        throw new RpcError(RpcErrorCodes.InvalidParams, `缺少字符串参数 ${key}`);
    return v;
}

// ── 启动与停机 ─────────────────────────────────────────────────────────

process.on("disconnect", () => {
    logStderr("stdin 断开，停机流程开始");
    for (const root of [...watchStates.keys()]) stopWatch(root);
    approvals.rejectAll("sidecar 停机");
    browser.rejectAll();
    terminal.disposeAll();
    scheduler?.dispose();
    void audit.shutdown().finally(() => process.exit(0));
});

process.on("uncaughtException", (err) => {
    logStderr(`未捕获异常: ${err.stack ?? err.message}`);
});

logStderr("agent-core 启动完成，等待 RPC 指令");
rpc.listen();
