import { createHash } from "node:crypto";

import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import { Dict } from "@buildingai/db/entities";
import { Repository } from "@buildingai/db/typeorm";
import { Get, Req } from "@nestjs/common";

import { WebController } from "../../common/decorators/controller.decorator";
import {
    parseScopeGroup,
    scopeGroupName,
    sortScopedRows,
} from "../../common/modules/scope/scope-group.util";
import { ResolvedScope, ScopeResolver } from "../../common/modules/scope/scope-resolver.service";

/**
 * 桌面策略键（T4.5，对齐 OpenWork desktop-policies 语义）。
 * 管理员在 dict 配置，未配置的键回退默认值。
 */
export const DESKTOP_POLICY_KEYS = [
    "allowCustomProviders", // 允许自配模型（供应商）
    "allowMultipleWorkspaces", // 允许多工作区
    "allowManageExtensions", // 允许管理扩展
    "allowSelfInstallSkills", // 允许自装技能
    "allowAlphaUpdates", // 允许 Alpha 更新通道
    "showWelcomePage", // 显示欢迎页
] as const;

export type DesktopPolicyKey = (typeof DESKTOP_POLICY_KEYS)[number];

const DEFAULT_POLICY: Record<DesktopPolicyKey, boolean> = {
    allowCustomProviders: true,
    allowMultipleWorkspaces: true,
    allowManageExtensions: true,
    allowSelfInstallSkills: true,
    allowAlphaUpdates: false,
    showWelcomePage: true,
};

/** T4.3 scope 三级组名基名（语法见 scope-group.util.ts） */
const POLICY_GROUP = "desktop_policy";
const EGRESS_GROUP = "desktop_egress";
const SKILLS_GROUP = "desktop_skills";
/** revision 参与哈希的组族（任一 dict 行变更 → 客户端小时级刷新感知） */
const REVISION_FAMILIES = [POLICY_GROUP, EGRESS_GROUP, SKILLS_GROUP, "desktop_release"];

/** 桌面版本清单（T4.10 版本管控） */
export interface DesktopRelease {
    version: string;
    channel: "stable" | "alpha";
    downloadUrl: string;
    forceUpdate: boolean;
    notes: string;
}

/**
 * 桌面配置下发端点（T4.5）：默认权限模式 + 策略键表。
 * T4.3 scope 三级合并：
 * - 覆盖型（策略键/出网白名单）：个人 > 部门 > 组织 > 默认，最具体一级的已配置值整体生效
 * - 隔离型（技能下发）：可见集 = 个人 ∪ 部门 ∪ 组织，同 key 冲突时更具体 scope 优先
 * - 部门关系经 ScopeResolver 实查 department_user_index（修复旧实现依赖 JWT departmentId 恒
 *   undefined 导致部门覆盖组从未生效的问题）
 * revision 为策略相关 dict 行的内容指纹（旧实现为硬编码常量，变更不可感知）。
 * 认证：全局 JWT 守卫，员工令牌访问。
 */
@WebController("desktop")
export class DesktopConfigController {
    constructor(
        @InjectRepository(Dict)
        private readonly dictRepository: Repository<Dict>,
        private readonly scopeResolver: ScopeResolver,
    ) {}

    /** 登录后拉取配置包：默认权限模式 + 策略键表 + 出网白名单 + 技能列表 */
    @Get("config")
    async config(@Req() req: unknown): Promise<{
        defaultPolicyMode: string;
        policyKeys: Record<DesktopPolicyKey, boolean>;
        egressAllowlist: string[];
        skills: Array<{ name: string; description: string; content: string }>;
        revision: number;
    }> {
        const userId = (req as { user?: { id?: string } }).user?.id ?? "";
        const scope: ResolvedScope = userId
            ? await this.scopeResolver.resolve(userId)
            : { userId: "", departmentIds: [], org: true };
        const [policyKeys, egressAllowlist, skills, revision] = await Promise.all([
            this.loadPolicyKeys(scope),
            this.loadEgressAllowlist(scope),
            this.loadSkills(scope),
            this.computeRevision(),
        ]);
        const globalMode = process.env.DESKTOP_DEFAULT_POLICY_MODE ?? "balanced";
        return { defaultPolicyMode: globalMode, policyKeys, egressAllowlist, skills, revision };
    }

    /** 心跳（T4.2 强制在线）：JWT 校验通过即在线；桌面端离线时锁定功能 */
    @Get("heartbeat")
    heartbeat(): { ok: true; now: string } {
        return { ok: true, now: new Date().toISOString() };
    }

    /** 版本清单（T4.10 版本管控）：dict group=desktop_release key=release，
     *  value=JSON {version, channel, downloadUrl, forceUpdate, notes}；未配置返回 null（不提示更新）。 */
    @Get("release")
    async release(): Promise<DesktopRelease | null> {
        return this.loadRelease();
    }

    private async loadRelease(): Promise<DesktopRelease | null> {
        try {
            const row = await this.dictRepository.findOne({
                where: { group: "desktop_release", key: "release", isEnabled: true },
            });
            if (!row) return null;
            const parsed = JSON.parse(row.value) as Partial<DesktopRelease>;
            return {
                version: String(parsed.version ?? "0.0.0"),
                channel: parsed.channel === "alpha" ? "alpha" : "stable",
                downloadUrl: String(parsed.downloadUrl ?? ""),
                forceUpdate: Boolean(parsed.forceUpdate),
                notes: String(parsed.notes ?? ""),
            };
        } catch {
            return null;
        }
    }

    /** 出网白名单（T4.8，覆盖型三级）：各级组内 key=allowlist，value 为 JSON 数组（域名，支持
     *  *.corp.com 通配）；最具体一级的已配置行整体生效，空数组 = 显式不限制（向后兼容）。 */
    private async loadEgressAllowlist(scope: ResolvedScope): Promise<string[]> {
        try {
            const rows = sortScopedRows(
                (await this.findScopedRows(EGRESS_GROUP, scope)).filter(
                    (row) => row.isEnabled && row.key === "allowlist",
                ),
            );
            let result: string[] = [];
            for (const row of rows) {
                const parsed: unknown = JSON.parse(row.value);
                if (Array.isArray(parsed)) {
                    result = parsed.filter((x): x is string => typeof x === "string");
                }
            }
            return result;
        } catch {
            return [];
        }
    }

    /** 技能列表（T4.4 管理员发布制，隔离型三级并集）：dict group=desktop_skills（含 scoped 变体），
     *  每条 key=技能名，value=JSON {description, content}；同 key 冲突时更具体 scope 优先。
     *  员工登录拉取后随配置包注入本地引擎。 */
    private async loadSkills(
        scope: ResolvedScope,
    ): Promise<Array<{ name: string; description: string; content: string }>> {
        const byName = new Map<string, { name: string; description: string; content: string }>();
        try {
            const rows = sortScopedRows(
                (await this.findScopedRows(SKILLS_GROUP, scope)).filter((row) => row.isEnabled),
            );
            for (const row of rows) {
                try {
                    const parsed = JSON.parse(row.value) as { description?: string; content?: string };
                    const content = parsed.content?.trim();
                    if (!content) continue;
                    byName.set(row.key, {
                        name: row.key,
                        description: parsed.description ?? row.key,
                        content,
                    });
                } catch {
                    /* 单条技能解析失败跳过 */
                }
            }
        } catch {
            /* 字典不可读时返回已合并部分 */
        }
        return [...byName.values()];
    }

    /** 读取策略键（覆盖型三级）：默认值 < 组织组 < 部门组(:d: 与旧裸 :uuid) < 个人组(:u:) */
    private async loadPolicyKeys(scope: ResolvedScope): Promise<Record<DesktopPolicyKey, boolean>> {
        const result: Record<DesktopPolicyKey, boolean> = { ...DEFAULT_POLICY };
        try {
            const rows = sortScopedRows(await this.findScopedRows(POLICY_GROUP, scope));
            for (const row of rows) {
                if (!DESKTOP_POLICY_KEYS.includes(row.key as DesktopPolicyKey)) continue;
                const bool = parseBool(row.value);
                if (bool !== undefined) result[row.key as DesktopPolicyKey] = bool;
            }
        } catch {
            /* 字典不可读时回退默认策略，不影响配置下发 */
        }
        return result;
    }

    /** 查询某组族下该用户可见的全部 dict 行（org + 所属部门(含旧裸组名) + 个人），并过滤组名解析归属 */
    private async findScopedRows(base: string, scope: ResolvedScope): Promise<Dict[]> {
        const groups = new Set<string>([base]);
        for (const deptId of scope.departmentIds) {
            groups.add(scopeGroupName(base, "department", deptId));
            groups.add(`${base}:${deptId}`); // 旧裸 uuid 组名兼容（varchar(50) 时代不可写，防御性保留）
        }
        if (scope.userId) groups.add(scopeGroupName(base, "personal", scope.userId));
        const rows = await this.dictRepository.find({
            where: [...groups].map((group) => ({ group })),
        });
        return rows.filter((row) => parseScopeGroup(row.group)?.base === base);
    }

    /** revision：策略相关组族全部 dict 行（id/键/updatedAt）的哈希指纹；变更即变，客户端据此刷新 */
    private async computeRevision(): Promise<number> {
        try {
            const conditions = REVISION_FAMILIES.map((_, i) => `d.group = :f${i} OR d.group LIKE :p${i}`).join(" OR ");
            const parameters: Record<string, string> = {};
            REVISION_FAMILIES.forEach((family, i) => {
                parameters[`f${i}`] = family;
                parameters[`p${i}`] = `${family}:%`;
            });
            const rows = await this.dictRepository
                .createQueryBuilder("d")
                .select(["d.id", "d.group", "d.key", "d.updatedAt"])
                .where(`(${conditions})`)
                .setParameters(parameters)
                .getMany();
            const material = rows
                .map((row) => `${row.group}|${row.key}|${row.updatedAt ? new Date(row.updatedAt).toISOString() : ""}`)
                .sort()
                .join("\n");
            return parseInt(createHash("sha1").update(material).digest("hex").slice(0, 8), 16) || 1;
        } catch {
            return 1;
        }
    }
}

function parseBool(raw: string): boolean | undefined {
    try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === "boolean" ? parsed : undefined;
    } catch {
        const v = raw.trim().toLowerCase();
        if (v === "true" || v === "1") return true;
        if (v === "false" || v === "0") return false;
        return undefined;
    }
}
