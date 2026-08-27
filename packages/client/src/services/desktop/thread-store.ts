/**
 * 本地会话存储（桌面端）v2：
 * - 轻量文本流（user/assistant 纯文本 + 工具摘要行），200 条消息/会话、100 会话 LRU
 * - 归档（Kun「归档当前项目中的所有会话」语义）
 * - 虚拟文件夹（Kun sidebar-folders：侧栏组织层，按工作区分组的文件夹）
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
    /** Kun thread.archived 语义 */
    archived?: boolean;
    /** 所属虚拟文件夹（侧栏组织） */
    folderId?: string | null;
}

export interface WorkspaceFolder {
    id: string;
    name: string;
    createdAt: number;
}

const STORAGE_KEY = "huashu.desktop.threads.v1";
const FOLDERS_KEY = "huashu.desktop.ws-folders.v1";
const EXPANDED_KEY = "huashu.desktop.ws-expanded.v1";
const MAX_MESSAGES = 200;
const MAX_THREADS = 100;
/** 侧栏变更事件（跨组件同步） */
export const THREADS_CHANGED_EVENT = "huashu:threads-changed";

type Store = Record<string, LocalThread>;
type FolderStore = Record<string, WorkspaceFolder[]>;

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

function loadFolders(): FolderStore {
    if (typeof window === "undefined") return {};
    try {
        return JSON.parse(window.localStorage.getItem(FOLDERS_KEY) ?? "{}") as FolderStore;
    } catch {
        return {};
    }
}

function saveFolders(store: FolderStore): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(FOLDERS_KEY, JSON.stringify(store));
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
        archived: existing?.archived ?? false,
        folderId: existing?.folderId ?? null,
    };
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
        .filter((t) => t.workspaceId === workspaceId && t.archived !== true)
        .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteThread(id: string): void {
    const store = loadAll();
    if (store[id]) {
        delete store[id];
        saveAll(store);
    }
}

export function renameThread(id: string, title: string): void {
    const store = loadAll();
    if (store[id] && title.trim()) {
        store[id]!.title = title.trim().slice(0, 60);
        saveAll(store);
    }
}

export function archiveThread(id: string): void {
    const store = loadAll();
    if (store[id]) {
        store[id]!.archived = true;
        saveAll(store);
    }
}

/** Kun「归档当前项目中的所有会话」：返回将归档的数量并执行 */
export function archiveWorkspaceThreads(workspaceId: string): number {
    const store = loadAll();
    const targets = Object.values(store).filter(
        (t) => t.workspaceId === workspaceId && t.archived !== true,
    );
    for (const t of targets) t.archived = true;
    if (targets.length > 0) saveAll(store);
    return targets.length;
}

// ── 虚拟文件夹（Kun sidebar-folders） ────────────────────────────────

export function listFolders(workspaceId: string): WorkspaceFolder[] {
    return loadFolders()[workspaceId] ?? [];
}

export function createFolder(workspaceId: string, name: string): WorkspaceFolder {
    const store = loadFolders();
    const list = store[workspaceId] ?? [];
    const folder: WorkspaceFolder = {
        id: `fd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim().slice(0, 30) || "新建目录",
        createdAt: Date.now(),
    };
    store[workspaceId] = [...list, folder];
    saveFolders(store);
    return folder;
}

export function renameFolder(workspaceId: string, folderId: string, name: string): void {
    const store = loadFolders();
    const list = store[workspaceId] ?? [];
    store[workspaceId] = list.map((f) =>
        f.id === folderId ? { ...f, name: name.trim().slice(0, 30) || f.name } : f,
    );
    saveFolders(store);
}

export function deleteFolder(workspaceId: string, folderId: string): void {
    const store = loadFolders();
    store[workspaceId] = (store[workspaceId] ?? []).filter((f) => f.id !== folderId);
    saveFolders(store);
    // 文件夹内会话回到根
    const threads = loadAll();
    for (const t of Object.values(threads)) {
        if (t.folderId === folderId) t.folderId = null;
    }
    saveAll(threads);
}

export function moveThreadToFolder(threadId: string, folderId: string | null): void {
    const store = loadAll();
    if (store[threadId]) {
        store[threadId]!.folderId = folderId;
        saveAll(store);
    }
}

// ── 折叠记忆 ─────────────────────────────────────────────────────────

export function loadExpanded(): string[] {
    if (typeof window === "undefined") return [];
    try {
        return JSON.parse(window.localStorage.getItem(EXPANDED_KEY) ?? "[]") as string[];
    } catch {
        return [];
    }
}

export function saveExpanded(ids: string[]): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(EXPANDED_KEY, JSON.stringify(ids));
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

/** Kun 风格相对时间：23分钟 / HH:mm / M月D日 */
export function formatThreadTime(ts: number): string {
    const d = new Date(ts);
    const diff = Date.now() - ts;
    if (diff < 60_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟`;
    if (d.toDateString() === new Date().toDateString())
        return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    return `${d.getMonth() + 1}月${d.getDate()}日`;
}
