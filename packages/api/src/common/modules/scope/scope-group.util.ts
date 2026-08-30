/**
 * T4.3 scope 三级组名语法（dict 配置面）。
 *
 * 组名规则：
 * - 组织级：`{group}`                如 `desktop_policy`
 * - 部门级：`{group}:d:{deptId}`     如 `desktop_policy:d:9f3…`
 * - 个人级：`{group}:u:{userId}`     如 `desktop_policy:u:7a1…`
 * - 兼容：旧裸 `{group}:{uuid}` 按部门级解释（uuid 与 `d:`/`u:` 前缀不冲突）
 *
 * 纯函数，无副作用；供 desktop-config 与后续 memory/datasets 分区共用。
 */

export type ScopeLevel = "org" | "department" | "personal";

export interface ParsedScopeGroup {
    base: string;
    level: ScopeLevel;
    /** department/personal 级的 id（deptId/userId）；org 级为空 */
    id?: string;
}

/** 覆盖型合并优先级：org(0) < department(1) < personal(2)，越具体越后应用 */
export const SCOPE_LEVEL_RANK: Record<ScopeLevel, number> = {
    org: 0,
    department: 1,
    personal: 2,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 生成某一级的 scoped 组名 */
export function scopeGroupName(base: string, level: "department" | "personal", id: string): string {
    return `${base}:${level === "department" ? "d" : "u"}:${id}`;
}

/** 解析 dict 组名 → scope 归属；不属于 `{base}[:...]` 体系的返回 null（base 取首个冒号前段） */
export function parseScopeGroup(rawGroup: string): ParsedScopeGroup | null {
    const idx = rawGroup.indexOf(":");
    if (idx < 0) return { base: rawGroup, level: "org" };
    const base = rawGroup.slice(0, idx);
    const rest = rawGroup.slice(idx + 1);
    if (rest.startsWith("d:")) return { base, level: "department", id: rest.slice(2) };
    if (rest.startsWith("u:")) return { base, level: "personal", id: rest.slice(2) };
    // 旧约定兼容：`{base}:{uuid}` 视为部门组（该语法在 varchar(50) 时代实际不可写，防御性保留）
    if (UUID_RE.test(rest)) return { base, level: "department", id: rest };
    return null;
}

/** 按 scope 级别升序稳定排序（org → department → personal），调用方按序应用即得"最具体生效" */
export function sortScopedRows<T extends { group: string }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => {
        const ra = SCOPE_LEVEL_RANK[parseScopeGroup(a.group)?.level ?? "org"];
        const rb = SCOPE_LEVEL_RANK[parseScopeGroup(b.group)?.level ?? "org"];
        return ra - rb;
    });
}
