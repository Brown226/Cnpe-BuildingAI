/**
 * 本地会话存储（桌面端）：
 * 让「项目」侧栏分组与本地会话历史成为可能——引擎正文在本机，
 * 这里保存轻量文本流（user/assistant 纯文本 + 工具摘要行），
 * 上限 200 条消息/会话、100 个会话（LRU 淘汰）。
 */
export interface LocalThreadMessage {
    role: "user" | "assistant" | "system";
    text: string;
}

export interface LocalThread {
    id: string;
    /** 关联工作区 id（ws_sha256 前缀） */
    workspaceId: string | null;
    title: string;
    messages: LocalThreadMessage[];
    updatedAt: number;
}

const STORAGE_KEY = "huashu.desktop.threads.v1";
const MAX_MESSAGES = 200;
const MAX_THREADS = 100;
/** 侧栏变更事件（跨组件同步） */
export const THREADS_CHANGED_EVENT = "huashu:threads-changed";

type Store = Record<string, LocalThread>;

function loadAll(): Store {
    if (typeof window === "undefined") return {};
    try {
        return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Store;
    } catch {
        return {};
    }
}

function saveAll(store: Store): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent(THREADS_CHANGED_EVENT));
}

export function getLocalThread(id: string): LocalThread | undefined {
    return loadAll()[id];
}

/** 追加消息；titleSeed 首次用于生成标题 */
export function appendThreadMessages(
    threadId: string,
    workspaceId: string | null,
    messages: LocalThreadMessage[],
    titleSeed?: string,
): void {
    if (!threadId || messages.length === 0) return;
    const store = loadAll();
    const existing = store[threadId];
    const merged = [...(existing?.messages ?? []), ...messages].slice(-MAX_MESSAGES);
    const title =
        existing?.title ??
        (titleSeed?.replace(/\s+/g, " ").trim().slice(0, 40) || "新对话");
    store[threadId] = {
        id: threadId,
        workspaceId: existing?.workspaceId ?? workspaceId,
        title,
        messages: merged,
        updatedAt: Date.now(),
    };
    // LRU 淘汰最旧会话
    const ids = Object.keys(store);
    if (ids.length > MAX_THREADS) {
        ids
            .sort((a, b) => store[a]!.updatedAt - store[b]!.updatedAt)
            .slice(0, ids.length - MAX_THREADS)
            .forEach((id) => delete store[id]);
    }
    saveAll(store);
}

export function listThreadsByWorkspace(workspaceId: string): LocalThread[] {
    return Object.values(loadAll())
        .filter((t) => t.workspaceId === workspaceId)
        .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteThread(id: string): void {
    const store = loadAll();
    if (store[id]) {
        delete store[id];
        saveAll(store);
    }
}

/** 转成 useChat 可用的 UIMessage 形状（文本部分） */
export function toUIMessages(thread: LocalThread): Array<{
    id: string;
    role: "user" | "assistant";
    parts: Array<{ type: "text"; text: string }>;
}> {
    return thread.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m, i) => ({
            id: `${thread.id}-${i}`,
            role: m.role as "user" | "assistant",
            parts: [{ type: "text" as const, text: m.text }],
        }));
}

export function formatThreadTime(ts: number): string {
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    if (sameDay) return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    return `${d.getMonth() + 1}月${d.getDate()}日`;
}
