import { toast } from "sonner";
import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createContext } from "react";
import { WifiOff } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { useAuthStore } from "@buildingai/stores";

import {
    desktopApi,
    isDesktop,
    onAgentEvent,
    pickFolder,
    startAgentEngine,
    stopAgentEngine,
    browserApi,
    notify,
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
    respond: (
        requestId: string,
        approved: boolean,
        reason?: string,
        remember?: boolean,
    ) => void;
    refreshWorkspacesSignal: number;
    /** 记忆的工作区列表（localStorage 持久化） */
    workspaces: WorkspaceEntry[];
    /** 当前选中的工作区 */
    selectedWorkspace: WorkspaceEntry | null;
    /** 系统目录框选择并添加工作区 */
    addWorkspaceByPicker: () => Promise<void>;
    /** 按路径添加工作区（C1 会话目录等程序化链路） */
    addWorkspaceByPath: (path: string, kind?: WorkspaceEntry["kind"]) => Promise<void>;
    /** 切换工作区（置顶 + 引擎激活） */
    selectWorkspace: (entry: WorkspaceEntry) => Promise<void>;
    /** 移除工作区（连带 sidecar 白名单） */
    removeWorkspace: (entry: WorkspaceEntry) => Promise<void>;
    /** 当前工作台模式（T1.1 双模式：code | work），localStorage 持久化 */
    activeMode: "code" | "work";
    /** 切换模式（新建会话进入该模式；已有会话按模式过滤显示） */
    setMode: (mode: "code" | "work") => void;
    /** T1.6 右栏文件面板开合（三栏常驻，可折叠） */
    panelOpen: boolean;
    setPanelOpen: (open: boolean) => void;
    /** T4.5 服务端下发的桌面策略键（null=未拉取/服务端不可用） */
    policyKeys: Record<string, boolean> | null;
    /** T4.2 强制在线状态（false=离线，桌面锁定） */
    online: boolean;
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
    addWorkspaceByPath: async () => undefined,
    selectWorkspace: async () => undefined,
    removeWorkspace: async () => undefined,
    activeMode: "code",
    setMode: () => undefined,
    panelOpen: false,
    setPanelOpen: () => undefined,
    policyKeys: null,
    online: true,
});

/** T3.6 处理 agent 的浏览器请求：invoke Tauri → 回填 browser/result */
async function handleBrowserRequest(params?: Record<string, unknown>): Promise<void> {
    const requestId = typeof params?.requestId === "string" ? params.requestId : "";
    if (!requestId) return;
    try {
        const action = String(params?.action ?? "");
        const payload = params?.payload as unknown;
        let result = "";
        if (action === "navigate") {
            await browserApi.navigate(String(payload ?? ""));
            result = "ok";
        } else if (action === "eval") {
            result = await browserApi.eval(String(payload ?? ""));
        } else if (action === "read") {
            result = await browserApi.read();
        }
        await notifyResult(requestId, result, undefined);
    } catch (err) {
        await notifyResult(requestId, undefined, String(err));
    }
}

function notifyResult(
    requestId: string,
    result?: string,
    error?: string,
): Promise<void> {
    return notify("browser/result", { requestId, result, error });
}

const MODE_STORAGE_KEY = "huashu.desktop.mode.v1";

function loadMode(): "code" | "work" {
    if (typeof window === "undefined") return "code";
    try {
        return window.localStorage.getItem(MODE_STORAGE_KEY) === "work" ? "work" : "code";
    } catch {
        return "code";
    }
}

/** T4.10 版本比较：a 是否严格高于 b（semver 数字逐段比较） */
function isNewerVersion(a: string, b: string): boolean {
    const pa = a.split(".").map((x) => Number.parseInt(x, 10) || 0);
    const pb = b.split(".").map((x) => Number.parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
        const x = pa[i] ?? 0;
        const y = pb[i] ?? 0;
        if (x !== y) return x > y;
    }
    return false;
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
    // 审计上报归属：auth.userInfo.id（此前误引用不存在的 state.user，userId 恒为 undefined）
    const userId = useAuthStore((state) => state.auth.userInfo?.id);
    const [ready, setReady] = useState(false);
    const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequestPayload[]>([]);
    const [refreshWorkspacesSignal, setRefreshWorkspacesSignal] = useState(0);
    const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [activeMode, setActiveMode] = useState<"code" | "work">(() => loadMode());
    const [policyKeys, setPolicyKeys] = useState<Record<string, boolean> | null>(null);
    /** T4.2 强制在线：心跳失败即判定离线并锁定桌面功能 */
    const [online, setOnline] = useState(true);
    const [panelOpen, setPanelOpen] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        try {
            return window.localStorage.getItem("huashu.desktop.panel.v1") !== "0";
        } catch {
            return true;
        }
    });
    const togglePanel = useCallback(() => {
        setPanelOpen((v) => {
            const next = !v;
            try {
                window.localStorage.setItem("huashu.desktop.panel.v1", next ? "1" : "0");
            } catch {
                /* 忽略存储失败 */
            }
            return next;
        });
    }, []);
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

    const respond = useCallback(
        (
            requestId: string,
            approved: boolean,
            reason?: string,
            remember?: boolean,
        ) => {
            void desktopApi.respondApproval(requestId, approved, reason, remember);
            setPendingApprovals((list) => list.filter((a) => a.requestId !== requestId));
            if (!approved && reason) toast.info(reason);
        },
        [],
    );

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
        async (path: string, kind?: WorkspaceEntry["kind"]) => {
            const entry = await makeWorkspaceEntry(path, kind);
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

    // T4.2 强制在线：30s 心跳，连续失败即锁定（离线均不可使用，A3 决策）
    useEffect(() => {
        if (!desktop || !token) return;
        let disposed = false;
        const serverBase = import.meta.env.VITE_APP_API_URL ?? window.location.origin;
        const check = async () => {
            try {
                const res = await fetch(`${serverBase}/api/desktop/heartbeat`, {
                    headers: { Authorization: token ? `Bearer ${token}` : "" },
                });
                if (!disposed) setOnline(res.ok);
            } catch {
                if (!disposed) setOnline(false);
            }
        };
        void check();
        const timer = setInterval(check, 30_000);
        return () => {
            disposed = true;
            clearInterval(timer);
        };
    }, [desktop, token]);

    // T4.10 版本管控：登录后拉取版本清单，比对当前版本，有新版本弹提示。
    // alpha 通道受 allowAlphaUpdates 策略键门控；forceUpdate 标记"必须更新"。
    useEffect(() => {
        if (!desktop || !token) return;
        let disposed = false;
        const serverBase = import.meta.env.VITE_APP_API_URL ?? window.location.origin;
        void (async () => {
            try {
                const [releaseRes, currentVersion] = await Promise.all([
                    fetch(`${serverBase}/api/desktop/release`, {
                        headers: { Authorization: token ? `Bearer ${token}` : "" },
                    }),
                    getVersion().catch(() => null),
                ]);
                if (disposed || !currentVersion || !releaseRes.ok) return;
                const release = (await releaseRes.json()) as {
                    version?: string;
                    channel?: string;
                    downloadUrl?: string;
                    forceUpdate?: boolean;
                    notes?: string;
                } | null;
                if (!release?.version) return;
                if (release.channel === "alpha" && policyKeys?.allowAlphaUpdates !== true) return;
                if (isNewerVersion(release.version, currentVersion)) {
                    const flag = release.forceUpdate ? "（必须更新）" : "";
                    toast.info(`发现新版本 ${release.version}${flag}`, {
                        description: release.notes || "请在管理员处获取安装包更新",
                        duration: 8000,
                    });
                }
            } catch {
                /* 版本检查失败静默 */
            }
        })();
        return () => {
            disposed = true;
        };
    }, [desktop, token, policyKeys]);

    useEffect(() => {
        if (!desktop || !token) return;
        let disposed = false;
        let unlisten: (() => void) | undefined;

        const boot = async () => {
            try {
                const serverBase =
                    import.meta.env.VITE_APP_API_URL ?? window.location.origin;

                // 配置下发（§4 服务端改造）：默认权限模式 + 策略键表按管理端配置；
                // 接口暂不可用（旧版本后端/离线）时回退默认
                let policyMode = "balanced";
                let fetchedPolicyKeys: Record<string, boolean> | null = null;
                let fetchedEgressAllowlist: string[] = [];
                let fetchedSkills: Array<{ name: string; description: string; content: string }> = [];
                try {
                    const res = await fetch(`${serverBase}/api/desktop/config`, {
                        headers: { Authorization: token ? `Bearer ${token}` : "" },
                    });
                    if (res.ok) {
                        const cfg = (await res.json()) as {
                            defaultPolicyMode?: string;
                            policyKeys?: Record<string, boolean>;
                            egressAllowlist?: string[];
                            skills?: Array<{ name: string; description: string; content: string }>;
                        };
                        if (
                            cfg?.defaultPolicyMode &&
                            ["strict", "balanced", "trust"].includes(cfg.defaultPolicyMode)
                        ) {
                            policyMode = cfg.defaultPolicyMode;
                        }
                        if (cfg?.policyKeys && typeof cfg.policyKeys === "object") {
                            fetchedPolicyKeys = cfg.policyKeys;
                        }
                        if (Array.isArray(cfg?.egressAllowlist)) {
                            fetchedEgressAllowlist = cfg.egressAllowlist;
                        }
                        if (Array.isArray(cfg?.skills)) {
                            fetchedSkills = cfg.skills;
                        }
                    }
                } catch {
                    /* 网络失败保持默认档 */
                }
                setPolicyKeys(fetchedPolicyKeys);

                await startAgentEngine();
                // 记忆工作区随配置包注入 sidecar 白名单（Kun 启动恢复语义）
                const persisted = loadWorkspaces();
                await desktopApi.initialize({
                    serverUrl: serverBase,
                    token: token as string,
                    userId,
                    policy: { mode: policyMode },
                    workspaces: persisted.items.map((w) => w.path),
                    egressAllowlist: fetchedEgressAllowlist,
                    skills: fetchedSkills,
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
                    } else if (method === "browser/request") {
                        // T3.6 agent 驱动内嵌浏览器：请求 → invoke Tauri → 回传结果
                        void handleBrowserRequest(frame.params).catch(() => undefined);
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
            addWorkspaceByPath,
            selectWorkspace,
            removeWorkspace,
            activeMode,
            setMode,
            panelOpen,
            setPanelOpen: togglePanel,
            policyKeys,
            online,
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
            addWorkspaceByPath,
            selectWorkspace,
            removeWorkspace,
            activeMode,
            setMode,
            panelOpen,
            togglePanel,
            policyKeys,
            online,
        ],
    );

    return (
        <DesktopContext.Provider value={value}>
            {children}
            {/* T4.2 强制在线：离线时全屏遮罩锁定（A3：离线均不可使用） */}
            {desktop && !online && (
                <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-background/95 backdrop-blur">
                    <WifiOff className="text-muted-foreground size-10" />
                    <p className="text-lg font-semibold">已离线</p>
                    <p className="text-muted-foreground text-sm">
                        请检查网络连接后重试；本平台所有功能需在线使用。
                    </p>
                </div>
            )}
        </DesktopContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDesktop(): DesktopContextValue {
    return useContext(DesktopContext);
}
