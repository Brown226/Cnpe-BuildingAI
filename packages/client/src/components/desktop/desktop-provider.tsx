import { toast } from "sonner";
import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createContext } from "react";
import { useAuthStore } from "@buildingai/stores";

import {
    desktopApi,
    isDesktop,
    onAgentEvent,
    startAgentEngine,
    stopAgentEngine,
    type ApprovalRequestPayload,
} from "@/services/desktop/desktop-api";

interface DesktopContextValue {
    /** 是否处于桌面客户端环境 */
    desktop: boolean;
    /** sidecar 是否就绪（initialize 完成） */
    ready: boolean;
    pendingApprovals: ApprovalRequestPayload[];
    respond: (requestId: string, approved: boolean, reason?: string) => void;
    refreshWorkspacesSignal: number;
}

const DesktopContext = createContext<DesktopContextValue>({
    desktop: false,
    ready: false,
    pendingApprovals: [],
    respond: () => undefined,
    refreshWorkspacesSignal: 0,
});

/**
 * 桌面端全局 Provider：负责拉起 sidecar、完成 initialize 握手、
 * 订阅引擎事件并把审批请求汇入卡片队列。
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

    const respond = useCallback((requestId: string, approved: boolean, reason?: string) => {
        void desktopApi.respondApproval(requestId, approved, reason);
        setPendingApprovals((list) => list.filter((a) => a.requestId !== requestId));
        if (!approved && reason) toast.info(reason);
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
                await desktopApi.initialize({
                    serverUrl: serverBase,
                    token: token as string,
                    userId,
                    policy: { mode: policyMode },
                });
                if (disposed) return;
                setReady(true);
                setRefreshWorkspacesSignal((n) => n + 1);

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
            }
        };

        void boot();

        return () => {
            disposed = true;
            unlisten?.();
            void stopAgentEngine();
        };
        // 登录态变化时重建连接
    }, [desktop, token, userId]);

    const value = useMemo(
        () => ({ desktop, ready, pendingApprovals, respond, refreshWorkspacesSignal }),
        [desktop, ready, pendingApprovals, respond, refreshWorkspacesSignal],
    );

    return <DesktopContext.Provider value={value}>{children}</DesktopContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDesktop(): DesktopContextValue {
    return useContext(DesktopContext);
}
