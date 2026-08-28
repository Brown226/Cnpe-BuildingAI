/**
 * 桌面端（Tauri）与 agent-core sidecar 的前端接入层。
 * 浏览器环境（网页版）下 isDesktop() 为 false，所有桌面能力静默不可用。
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export interface ApprovalRequestPayload {
    requestId: string;
    kind: "command" | "file_write" | "file_delete";
    target: string;
    detail: Record<string, unknown>;
    timeoutMs: number;
}

export interface AgentEventFrame {
    method: string;
    params?: {
        sessionId?: string;
        event?: Record<string, unknown>;
        kind?: string;
        message?: string;
        [key: string]: unknown;
    };
}

/** 是否运行在 Tauri 桌面壳内 */
export function isDesktop(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// ── 内嵌浏览器（T3.6 方案 A；Rust side browser.rs） ──────────────────

export const browserApi = {
    open(url: string, bounds: { x: number; y: number; w: number; h: number }): Promise<string> {
        return invoke("browser_open", { url, ...bounds });
    },
    bounds(b: { x: number; y: number; w: number; h: number }): Promise<void> {
        return invoke("browser_bounds", b);
    },
    navigate(url: string): Promise<void> {
        return invoke("browser_navigate", { url });
    },
    eval(js: string): Promise<string> {
        return invoke("browser_eval", { js });
    },
    goBack(): Promise<void> {
        return invoke("browser_go_back");
    },
    goForward(): Promise<void> {
        return invoke("browser_go_forward");
    },
    reload(): Promise<void> {
        return invoke("browser_reload");
    },
    read(): Promise<string> {
        return invoke("browser_read");
    },
    close(): Promise<void> {
        return invoke("browser_close");
    },
};

/** 拉起 sidecar（幂等） */
export function startAgentEngine(scriptPath?: string): Promise<void> {
    return invoke("agent_start", { script: scriptPath ?? null, nodeBin: null, cwd: null });
}

/** 系统目录选择框（用户取消返回 null） */
export function pickFolder(): Promise<string | null> {
    return invoke("pick_folder") as Promise<string | null>;
}

/** 在系统文件管理器中定位文件/目录 */
export function revealPath(path: string): Promise<void> {
    return invoke("reveal_path", { path });
}

/** 通用 RPC 调用 */
export function rpc<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T> {
    return invoke("agent_rpc", { method, params: params ?? {} }) as Promise<T>;
}

/** 发送通知帧（审批结果等无需响应的场景） */
export function notify(method: string, params: Record<string, unknown>): Promise<void> {
    return invoke("agent_notify", { method, params });
}

export function stopAgentEngine(): Promise<void> {
    return invoke("agent_stop");
}

/** 订阅 sidecar 推送（审批请求 / 引擎事件 / 进程退出） */
export function onAgentEvent(handler: (frame: AgentEventFrame) => void): Promise<UnlistenFn> {
    return listen<AgentEventFrame>("agent-event", (event) => handler(event.payload));
}

// ── 领域封装 ───────────────────────────────────────────────────────────

export const desktopApi = {
    initialize(pack: {
        serverUrl: string;
        token: string;
        userId?: string;
        policy?: { mode: string };
        workspaces?: string[];
        egressAllowlist?: string[];
        skills?: Array<{ name: string; description: string; content: string }>;
    }): Promise<{ protocolVersion: string }> {
        return rpc("initialize", pack);
    },

    policyGet(): Promise<{ mode: string; workspaceCount: number }> {
        return rpc("policy.getMode");
    },

    policySet(mode: "strict" | "balanced" | "trust"): Promise<{ mode: string }> {
        return rpc("policy.setMode", { mode });
    },

    workspaceList(): Promise<{ dirs: string[] }> {
        return rpc("workspace.list");
    },

    workspaceAdd(dir: string): Promise<{ ok: boolean }> {
        return rpc("workspace.add", { dir });
    },

    workspaceRemove(dir: string): Promise<{ removed: boolean }> {
        return rpc("workspace.remove", { dir });
    },

    respondApproval(
        requestId: string,
        approved: boolean,
        reason?: string,
        remember?: boolean,
    ): Promise<void> {
        return notify("approval/respond", { requestId, approved, reason, remember });
    },

    /** 列目录（懒加载文件树用） */
    fsList(dir: string): Promise<{ entries: Array<{ name: string; type: "file" | "dir"; size?: number }> }> {
        return rpc("fs.list", { dir });
    },

    /** 读文本（512KB 截断） */
    fsRead(path: string): Promise<{ content: string; truncated: boolean }> {
        return rpc("fs.read", { path });
    },

    /** 写文本（策略管控：严格模式弹审批，T2.3 编辑回写用） */
    fsWrite(path: string, content: string): Promise<{ bytesWritten: number }> {
        return rpc("fs.write", { path, content });
    },

    /** T3.5 二进制读取（base64，20MB 上限；PPT 在线预览用） */
    fsReadBinary(path: string): Promise<{ base64: string; size: number }> {
        return rpc("fs.readBinary", { path });
    },

    fsCreate(path: string, type: "file" | "directory"): Promise<{ path: string }> {
        return rpc("fs.create", { path, type });
    },

    fsRename(path: string, newName: string): Promise<{ path: string }> {
        return rpc("fs.rename", { path, newName });
    },

    fsDelete(path: string): Promise<{ deleted: boolean }> {
        return rpc("fs.delete", { path });
    },

    /** 最近修改文件（右面板 Recent 区） */
    fsRecent(
        root: string,
        limit = 8,
    ): Promise<{ files: Array<{ path: string; name: string; mtimeMs: number; size?: number }> }> {
        return rpc("fs.recent", { root, limit });
    },

    /** 激活工作区（置顶 + 引擎新会话 cwd 切换） */
    workspaceSetActive(dir: string): Promise<{ active: string }> {
        return rpc("workspace.setActive", { dir });
    },

    /** 监听工作区变更（native 失败 sidecar 自动降级轮询） */
    fsWatch(root: string): Promise<{ watching: boolean }> {
        return rpc("fs.watch", { root });
    },

    fsUnwatch(root: string): Promise<{ watching: boolean }> {
        return rpc("fs.unwatch", { root });
    },

    /** 在系统文件管理器中定位文件/目录（右面板菜单用） */
    revealPath(path: string): Promise<void> {
        return invoke("reveal_path", { path });
    },

    /** 解析文档为纯文本（docx/xlsx/csv/txt/md） */
    officeParse(
        path: string,
    ): Promise<{ text: string; truncated: boolean; kind: string }> {
        return rpc("office.parse", { path });
    },

    /** 执行命令（策略管控：黑名单硬拒/白名单放行/审批） */
    execRun(
        command: string,
        cwd: string,
    ): Promise<{ exitCode: number; stdout?: string; stderr?: string; timedOut?: boolean }> {
        return rpc("exec.run", { command, cwd });
    },

    /** T2.3 结构化读取 xlsx（首工作表 → 二维数组，前端表格编辑器用） */
    officeReadXlsx(
        path: string,
    ): Promise<{
        rows: unknown[][];
        sheetName: string;
        rowCount: number;
        colCount: number;
    }> {
        return rpc("office.readXlsx", { path });
    },

    /** T2.3 表格编辑回写：二维数组 → xlsx（覆盖原路径） */
    officeExportXlsx(
        path: string,
        rows: unknown[][],
        sheetName?: string,
    ): Promise<{ summary: string; bytesWritten: number; rowCount: number }> {
        return rpc("office.exportXlsx", { path, rows, sheetName });
    },

    /** 本地会话元数据列表（T1.3 JSONL；按 updatedAt 倒序） */
    sessionList(): Promise<{
        sessions: Array<{
            id: string;
            mode: "code" | "work";
            cwd: string;
            title: string;
            createdAt: number;
            updatedAt: number;
        }>;
    }> {
        return rpc("session.list");
    },

    /** 本地会话详情：元数据 + 对话文本流（回放用） */
    sessionGet(
        sessionId: string,
    ): Promise<{
        meta: {
            id: string;
            mode: "code" | "work";
            cwd: string;
            title: string;
            createdAt: number;
            updatedAt: number;
        } | null;
        messages: Array<{ role: "user" | "assistant"; text: string; ts: number }>;
    }> {
        return rpc("session.get", { sessionId });
    },

    // ── 定时任务（T5.1） ────────────────────────────────────────────
    scheduleList(): Promise<{
        tasks: Array<{
            id: string;
            name: string;
            instructions: string;
            schedule: { kind: string; at?: number; hour?: number; minute?: number; daysOfWeek?: number[]; timezone: string };
            enabled: boolean;
            lastRunAt?: number;
        }>;
        records: Array<{
            id: string;
            taskId: string;
            at: number;
            status: string;
            summary?: string;
            error?: string;
        }>;
    }> {
        return rpc("schedule.list");
    },

    scheduleCreate(input: {
        name: string;
        instructions: string;
        schedule: { kind: "once" | "daily" | "weekly"; at?: number; hour?: number; minute?: number; daysOfWeek?: number[]; timezone: string };
        mode?: "code" | "work";
    }): Promise<{ task: { id: string } }> {
        return rpc("schedule.create", input);
    },

    scheduleDelete(id: string): Promise<{ deleted: boolean }> {
        return rpc("schedule.delete", { id });
    },

    scheduleRun(id: string): Promise<{ record: unknown }> {
        return rpc("schedule.run", { id });
    },

    scheduleRecords(id?: string): Promise<{ records: unknown[] }> {
        return rpc("schedule.records", { id: id ?? null });
    },
};
