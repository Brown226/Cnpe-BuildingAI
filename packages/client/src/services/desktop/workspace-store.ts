/**
 * 工作区前端持久化（复刻 Kun"路径+记忆列表"模型 + openwork 稳定 ID）：
 * - 列表存 localStorage（上限 30 条，按加入时间淘汰）
 * - id = ws_ + sha256(绝对路径)[:12]，作为会话绑定与去重的稳定键
 * - selectedId 对应 openwork 的 selected 语义；引擎侧激活另有 workspace.setActive
 */
import type { WorkspaceEntry } from "./workspace-types";

const STORAGE_KEY = "huashu.desktop.workspaces.v1";
export const WORKSPACE_CAP = 30;

interface Persisted {
    items: WorkspaceEntry[];
    selectedId: string | null;
}

const EMPTY: Persisted = { items: [], selectedId: null };

function safeParse(raw: string | null): Persisted {
    if (!raw) return EMPTY;
    try {
        const d = JSON.parse(raw) as Persisted;
        if (!Array.isArray(d.items)) return EMPTY;
        return { items: d.items, selectedId: d.selectedId ?? null };
    } catch {
        return EMPTY;
    }
}

export function loadWorkspaces(): Persisted {
    if (typeof window === "undefined") return EMPTY;
    return safeParse(window.localStorage.getItem(STORAGE_KEY));
}

export function saveWorkspaces(data: Persisted): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function basename(p: string): string {
    const norm = p.replace(/[\\/]+$/, "");
    const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
    return idx >= 0 ? norm.slice(idx + 1) : norm;
}

export function parentDir(p: string): string {
    const norm = p.replace(/[\\/]+$/, "");
    const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
    return idx > 0 ? norm.slice(0, idx) : norm;
}

async function sha256Hex(input: string): Promise<string> {
    const bytes = new TextEncoder().encode(input.toLowerCase());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

export async function makeWorkspaceEntry(path: string, kind?: WorkspaceEntry["kind"]): Promise<WorkspaceEntry> {
    const id = `ws_${(await sha256Hex(path)).slice(0, 12)}`;
    return { id, name: basename(path), path, addedAt: Date.now(), kind };
}

/** 追加（去重置顶，超限淘汰最旧），返回新列表与应选中的条目 */
export function upsertEntry(items: WorkspaceEntry[], entry: WorkspaceEntry): { items: WorkspaceEntry[]; deduped: boolean } {
    const rest = items.filter((it) => it.id !== entry.id);
    const deduped = rest.length !== items.length;
    const next = [entry, ...rest];
    if (next.length > WORKSPACE_CAP) next.length = WORKSPACE_CAP;
    return { items: next, deduped };
}
