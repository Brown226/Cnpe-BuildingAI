import { toast } from "sonner";
import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createContext } from "react";
import { useAuthStore } from "@buildingai/stores";

import {
    desktopApi,
    isDesktop,
    onAgentEvent,
    pickFolder,
    startAgentEngine,
    stopAgentEngine,
    type ApprovalRequestPayload,
} from "@/services/desktop/desktop-api";
import {
    basename,
    loadWorkspaces,
    makeWorkspaceEntry,
    saveWorkspaces,
    upsertEntry,
} from "@/services/desktop/workspace-store";
import type { WorkspaceEntry } from "@/services/desktop/workspace-types";

interface DesktopContextValue {
    /** 是否处于桌面客户端环境 */
    desktop: boolean;
    /** sidecar 是否就绪（initialize 完成） */
    ready: boolean;
    pendingApprovals: ApprovalRequestPayload[];
    respond: (requestId: string, approved: boolean, reason?: string) => void;
    refreshWorkspacesSignal: number;
    /** 记忆的工作区列表（localStorage 持久化） */
    workspaces: WorkspaceEntry[];
    /** 当前选中的工作区 */
    selectedWorkspace: WorkspaceEntry | null;
    /** 系统目录框选择并添加工作区 */
    addWorkspaceByPicker: () => Promise<void>;
    /** 切换工作区（置顶 + 引擎激活） */
    selectWorkspace: (entry: WorkspaceEntry) => Promise<void>;
    /** 移除工作区（连带 sidecar 白名单） */
    removeWorkspace: (entry: WorkspaceEntry) => Promise<void>;
    /** 当前工作台模式（T1.1 双模式：code | work），localStorage 持久化 */
    activeMode: "code" | "work";
    /** 切换模式（新建会话进入该模式；已有会话按模式过滤显示） */
    setMode: (mode: "code" | "work") => void;
}

const DesktopContext = createContext<DesktopContextValue>({
    desktop: false,
    ready: false,
    pendingApprovals: [],
    respond: () => undefined,
    refreshWorkspacesSignal: 0,
    workspaces: [],
    selectedWorkspace: null,
    addWorkspaceByPicker: async () => undefined,
    selectWorkspace: async () => undefined,
    removeWorkspace: async () => undefined,
    activeMode: "code",
    setMode: () => undefined,
});

const MODE_STORAGE_KEY = "huashu.desktop.mode.v1";

function loadMode(): "code" | "work" {
    if (typeof window === "undefined") return "code";
    try {
        return window.localStorage.getItem(MODE_STORAGE_KEY) === "work" ? "work" : "code";
    } catch {
        return "code";
    }
}

/**
 * 桌面端全局 Provider：负责拉起 sidecar、完成 initialize 握手、
 * 订阅引擎事件并把审批请求汇入卡片队列；同时持有工作区记忆列表
 * （复刻 Kun"路径+记忆列表"模型，持久化在 localStorage）与
 * 当前工作台模式（T1.1 双模式：code | work）。
 * 非桌面（浏览器）环境下为空实现，不影响网页版。
 */
export function DesktopProvider({ children }: { children: ReactNode }) {
    const desktop = isDesktop();
    const token = useAuthStore((state) => state.auth.token);
    const user = useAuthStore((state) => state.user);
    // 修复：此前直接引用未定义的 userId（deps 数组内）导致首渲染 ReferenceError 白屏
    const userId = (user as { id?: string } | null)?.id;
    const [ready, setReady] = useState(false);
    const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequestPayload[]>([]);
    const [refreshWorkspacesSignal, setRefreshWorkspacesSignal] = useState(0);
    const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [activeMode, setActiveMode] = useState<"code" | "work">(() => loadMode());
    const selectedWorkspace = useMemo(
        () => workspaces.find((w) => w.id === selectedId) ?? null,
        [workspaces, selectedId],
    );

    const setMode = useCallback((mode: "code" | "work") => {
        setActiveMode(mode);
        try {
            window.localStorage.setItem(MODE_STORAGE_KEY, mode);
        } catch {
            /* 忽略存储失败 */
        }
    }, []);

    const respond = useCallback((requestId: string, approved: boolean, reason?: string) => {
        void desktopApi.respondApproval(requestId, approved, reason);
        setPendingApprovals((list) => list.filter((a) => a.requestId !== requestId));
        if (!approved && reason) toast.info(reason);
    }, []);

    // 启动时恢复记忆列表（非桌面环境读到的为空，无副作用）
    useEffect(() => {
        if (!desktop) return;
        const persisted = loadWorkspaces();
        setWorkspaces(persisted.items);
        setSelectedId(persisted.selectedId);
    }, [desktop]);

    const activateOnEngine = useCallback((path: string) => {
        // 引擎未就绪时静默失败：initialize 时已通过 pack.workspaces 注入
        void desktopApi.workspaceSetActive(path).catch(() => undefined);
    }, []);

    const selectWorkspace = useCallback(
        async (entry: WorkspaceEntry) => {
            setSelectedId(entry.id);
            const persisted = loadWorkspaces();
            saveWorkspaces({ ...persisted, selectedId: entry.id });
            activateOnEngine(entry.path);
            setRefreshWorkspacesSignal((n) => n + 1);
        },
        [activateOnEngine],
    );

    const addWorkspaceByPath = useCallback(
        async (path: string) => {
            const entry = await makeWorkspaceEntry(path);
            const persisted = loadWorkspaces();
            const { items, deduped } = upsertEntry(persisted.items, entry);
            const nextSelectedId = entry.id;
            setWorkspaces(items);
            setSelectedId(nextSelectedId);
            saveWorkspaces({ items, selectedId: nextSelectedId });
            // sidecar 白名单幂等添加；激活放 initialize/setActive 链路
            void desktopApi.workspaceAdd(path).catch(() => undefined);
            activateOnEngine(path);
            setRefreshWorkspacesSignal((n) => n + 1);
            toast.success(deduped ? `已切换到工作区 ${basename(path)}` : `已添加工作区 ${basename(path)}`);
        },
        [activateOnEngine],
    );

    const addWorkspaceByPicker = useCallback(async () => {
        try {
            const dir = await pickFolder();
            if (!dir) return;
            await addWorkspaceByPath(dir);
        } catch (err) {
            toast.error(`添加工作区失败：${String(err)}`);
        }
    }, [addWorkspaceByPath]);

    const removeWorkspace = useCallback(async (entry: WorkspaceEntry) => {
        const persisted = loadWorkspaces();
        const items = persisted.items.filter((it) => it.id !== entry.id);
        const selectedId2 = persisted.selectedId === entry.id ? (items[0]?.id ?? null) : persisted.selectedId;
        setWorkspaces(items);
        setSelectedId(selectedId2);
        saveWorkspaces({ items, selectedId: selectedId2 });
        void desktopApi.workspaceRemove(entry.path).catch(() => undefined);
        setRefreshWorkspacesSignal((n) => n + 1);
    }, []);

    useEffect(() => {
        if (!desktop || !token) return;
        let disposed = false;
        let unlisten: (() => void) | undefined;

        const boot = async () => {
            try {
                const serverBase =
                    import.meta.env.VITE_APP_API_URL ?? window.location.origin;

                // 配置下发（§4 服务端改造）：默认权限模式按管理端配置；
                // 接口暂不可用（旧版本后端/离线）时回退 balanced
                let policyMode = "balanced";
                try {
                    const res = await fetch(`${serverBase}/api/desktop/config`, {
                        headers: { Authorization: token ? `Bearer ${token}` : "" },
                    });
                    if (res.ok) {
                        const cfg = (await res.json()) as { defaultPolicyMode?: string };
                        if (
                            cfg?.defaultPolicyMode &&
                            ["strict", "balanced", "trust"].includes(cfg.defaultPolicyMode)
                        ) {
                            policyMode = cfg.defaultPolicyMode;
                        }
                    }
                } catch {
                    /* 网络失败保持默认档 */
                }

                await startAgentEngine();
                // 记忆工作区随配置包注入 sidecar 白名单（Kun 启动恢复语义）
                const persisted = loadWorkspaces();
                await desktopApi.initialize({
                    serverUrl: serverBase,
                    token: token as string,
                    userId,
                    policy: { mode: policyMode },
                    workspaces: persisted.items.map((w) => w.path),
                });
                if (disposed) return;
                setReady(true);
                setRefreshWorkspacesSignal((n) => n + 1);

                // 恢复上次激活的工作区（引擎新会话 cwd）
                const selected =
                    persisted.items.find((w) => w.id === persisted.selectedId) ?? persisted.items[0];
                if (selected) activateOnEngine(selected.path);

                unlisten = await onAgentEvent((frame) => {
                    const method = frame.method ?? "";
                    if (method === "approval/request") {
                        setPendingApprovals((list) =>
                            list.some((a) => a.requestId === frame.params?.requestId)
                                ? list
                                : [...list, frame.params as unknown as ApprovalRequestPayload],
                        );
                    } else if (method === "engine/event") {
                        const kind = frame.params?.kind;
                        if (kind === "engine_ready") toast.success("本地智能引擎已就绪");
                        if (kind === "engine_error") {
                            toast.error(`智能引擎启动失败：${String(frame.params?.message ?? "")}`);
                        }
                        if (kind === "process_exit") setReady(false);
                    }
                });
            } catch (err) {
                console.error("[desktop] 启动失败", err);
                toast.error(`本地引擎启动失败：${String(err)}`);
            }
        };

        void boot();

        return () => {
            disposed = true;
            unlisten?.();
            void stopAgentEngine();
        };
        // 登录态变化时重建连接
    }, [desktop, token, userId, activateOnEngine]);

    const value = useMemo(
        () => ({
            desktop,
            ready,
            pendingApprovals,
            respond,
            refreshWorkspacesSignal,
            workspaces,
            selectedWorkspace,
            addWorkspaceByPicker,
            selectWorkspace,
            removeWorkspace,
            activeMode,
            setMode,
        }),
        [
            desktop,
            ready,
            pendingApprovals,
            respond,
            refreshWorkspacesSignal,
            workspaces,
            selectedWorkspace,
            addWorkspaceByPicker,
            selectWorkspace,
            removeWorkspace,
            activeMode,
            setMode,
        ],
    );

    return <DesktopContext.Provider value={value}>{children}</DesktopContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDesktop(): DesktopContextValue {
    return useContext(DesktopContext);
}
