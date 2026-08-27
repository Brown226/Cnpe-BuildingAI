/**
 * 分屏双开状态（T2.1 split view，OpenWork primary/secondary 语义）：
 * 副会话 id 存 localStorage；主会话由路由 /chat/:id 决定。
 */
const SPLIT_KEY = "huashu.desktop.split.v1";

export function getSplitSessionId(): string | null {
    if (typeof window === "undefined") return null;
    try {
        const v = window.localStorage.getItem(SPLIT_KEY);
        return v && v !== "null" ? v : null;
    } catch {
        return null;
    }
}

export function setSplitSessionId(sessionId: string | null): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(SPLIT_KEY, sessionId ?? "null");
        window.dispatchEvent(new CustomEvent("huashu:split-changed"));
    } catch {
        /* 忽略存储失败 */
    }
}

export const SPLIT_CHANGED_EVENT = "huashu:split-changed";
