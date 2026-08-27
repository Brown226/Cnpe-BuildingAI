/**
 * 桌面端（Tauri）与 agent-core sidecar 的前端接入层。
 * 浏览器环境（网页版）下 isDesktop() 为 false，所有桌面能力静默不可用。
 */
import type { UserPlayground } from "@buildingai/db";
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

    respondApproval(requestId: string, approved: boolean, reason?: string): Promise<void> {
        return notify("approval/respond", { requestId, approved, reason });
    },

    /** 列目录（懒加载文件树用） */
    fsList(dir: string): Promise<{ entries: Array<{ name: string; type: "file" | "dir"; size?: number }> }> {
        return rpc("fs.list", { dir });
    },

    /** 读文本（512KB 截断） */
    fsRead(path: string): Promise<{ content: string; truncated: boolean }> {
        return rpc("fs.read", { path });
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

    /** 激活工作区（置顶 + 引擎新会话 cwd 切换） */
    workspaceSetActive(dir: string): Promise<{ active: string }> {
        return rpc("workspace.setActive", { dir });
    },
};
