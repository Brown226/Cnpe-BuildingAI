/**
 * Agent Sidecar 主入口（设计文档 §3.1 Node Agent Sidecar 层）。
 * 由 Tauri Rust Core 以子进程方式拉起；stdin/stdout 承载行分隔 JSON-RPC。
 * stdout 只输出协议帧——任何日志必须走 stderr。
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
// 开发期密钥从包根 .env.local 加载（被 .gitignore 覆盖）；生产由 Tauri 注入环境
// quiet 必须：stdout 是唯一 RPC 出口，任何库不得向 stdout 打印
import dotenv from "dotenv";
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(PKG_ROOT, ".env.local"), quiet: true, override: false });
dotenv.config({ quiet: true });
import { RpcServer, logStderr } from "./protocol/server.js";
import { RpcError, RpcErrorCodes } from "./protocol/messages.js";
import { WorkspaceStore } from "./workspace/store.js";
import { PolicyEngine, assertAllowed } from "./policy/engine.js";
import type { PermissionMode } from "./policy/types.js";
import { ApprovalBroker } from "./approval/broker.js";
import { AuditCollector } from "./audit/collector.js";
import { FileTools } from "./tools/file-tools.js";
import { CommandExecutor } from "./tools/command-exec.js";
import { OfficeTools } from "./tools/office-tools.js";
import type { PlatformTool } from "./tools/types.js";
import { runtimeConfig } from "./state/runtime-config.js";
import type { ConfigPack } from "./state/runtime-config.js";
import { PiEngine } from "./engine/pi-engine.js";
import type { EngineEvent } from "./engine/types.js";

const rpc = new RpcServer();
const audit = new AuditCollector();
const workspaces = new WorkspaceStore();
const policy = new PolicyEngine(workspaces);
const approvals = new ApprovalBroker((method, params) => rpc.notify(method, params));
const fileTools = new FileTools(workspaces, policy, approvals, audit);
const executor = new CommandExecutor(policy, approvals, audit);
const officeTools = new OfficeTools({ workspaces, policy, approvals, audit });
const engine = new PiEngine();

/** 平台自有工具：策略管控下的文件/命令能力，以受控形式交给 Agent 引擎 */
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
            "读取并解析工作区中的文档为纯文本（支持 .docx/.xlsx/.csv/.txt/.md）。用于回答关于文档内容的问题或基于现有文件加工。",
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
];

// ── 生命周期 ───────────────────────────────────────────────────────────

rpc.register("initialize", (params) => {
    const pack = params as Partial<ConfigPack>;
    if (!pack?.serverUrl || !pack?.token)
        throw new RpcError(RpcErrorCodes.InvalidParams, "initialize 需要 serverUrl 与 token");
    runtimeConfig.set(pack as ConfigPack);
    if (pack.workspaces) workspaces.setAll(pack.workspaces);
    policy.configure(pack.policy);
    const pack0 = runtimeConfig.require()!;
    audit.configure(pack0.serverUrl, pack0.token, pack0.userId);
    void bootstrapEngineOnce();
    return {
        protocolVersion: "1.0",
        capabilities: {
            methods: [
                "session.create",
                "session.send",
                "session.abort",
                "fs.list",
                "fs.read",
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
                "office.parse",
                "office.exportDocx",
                "office.exportXlsx",
            ],
            engineReady: false,
        },
    };
});

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
    return { removed: workspaces.remove(String(dir)) };
});

/**
 * 激活工作区（复刻 openwork "激活=列表首位" 语义）：
 * 置顶白名单并把引擎默认 cwd 切到该目录——已存在的会话保持原 cwd，
 * 新建会话即落入新激活目录。
 */
rpc.register("workspace.setActive", (params) => {
    requireInitialized();
    const dir = str(params, "dir");
    const list = workspaces.list();
    const hit = list.find((l) => l.toLowerCase() === dir.toLowerCase());
    if (!hit)
        throw new RpcError(RpcErrorCodes.InvalidParams, `该目录不在工作区列表：${dir}`);
    workspaces.setAll([hit, ...list.filter((l) => l !== hit)]);
    process.env.AGENT_CORE_WORKSPACE = hit;
    return { active: hit };
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
    const p = raw as { requestId?: string; approved?: boolean; reason?: string };
    if (!p?.requestId) return;
    approvals.respond(p.requestId, Boolean(p.approved), p.reason);
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

// ── Agent 引擎通道 ─────────────────────────────────────────────────────

rpc.register("session.create", () => ({ sessionId: randomUUID() }));

/**
 * 发送用户消息：立即返回 accepted；事件以
 * notification(engine/event, {sessionId, event}) 形式流出，
 * 消费方收到 type=done/error 即一轮结束。
 */
rpc.register("session.send", (params) => {
    requireInitialized();
    const p = params as { sessionId?: string; text?: string };
    if (!p?.sessionId || !p.text)
        throw new RpcError(RpcErrorCodes.InvalidParams, "session.send 需要 sessionId 与 text");
    void pumpSessionEvents(p.sessionId, p.text).catch((err) => {
        logStderr(`session.send 泵异常: ${String(err)}`);
        rpc.notify("engine/event", {
            sessionId: p.sessionId,
            event: { type: "error", message: String(err), recoverable: false } satisfies EngineEvent,
        });
    });
    return { accepted: true };
});

async function pumpSessionEvents(sessionId: string, text: string): Promise<void> {
    for await (const event of engine.sendMessage(sessionId, { text })) {
        rpc.notify("engine/event", { sessionId, event });
    }
}

rpc.register("session.abort", (params) => {
    const id = str(params, "sessionId");
    engine.abort(id);
    return { aborted: true };
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

void randomUUID;

// ── 启动与停机 ─────────────────────────────────────────────────────────

process.on("disconnect", () => {
    logStderr("stdin 断开，停机流程开始");
    for (const root of [...watchStates.keys()]) stopWatch(root);
    approvals.rejectAll("sidecar 停机");
    void audit.shutdown().finally(() => process.exit(0));
});

process.on("uncaughtException", (err) => {
    logStderr(`未捕获异常: ${err.stack ?? err.message}`);
});

logStderr("agent-core 启动完成，等待 RPC 指令");
rpc.listen();
