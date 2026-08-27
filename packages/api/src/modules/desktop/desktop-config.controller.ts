import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import { Dict } from "@buildingai/db/entities";
import { Repository } from "@buildingai/db/typeorm";
import { Get, Req } from "@nestjs/common";

import { WebController } from "../../common/decorators/controller.decorator";

/**
 * 桌面策略键（T4.5，对齐 OpenWork desktop-policies 语义）。
 * 管理员在 dict 配置（group=desktop_policy），未配置的键回退默认值。
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

const POLICY_GROUP = "desktop_policy";
const POLICY_REVISION = 3;

/**
 * 桌面配置下发端点（T4.5）：默认权限模式 + 策略键表。
 * 策略优先级：部门覆盖组(desktop_policy:{deptId}) > 全局组(desktop_policy) > 默认值。
 * revision 供客户端小时级刷新感知策略变更。
 * 认证：全局 JWT 守卫，员工令牌访问。
 */
@WebController("desktop")
export class DesktopConfigController {
    constructor(
        @InjectRepository(Dict)
        private readonly dictRepository: Repository<Dict>,
    ) {}

    /** 登录后拉取配置包：默认权限模式 + 策略键表 */
    @Get("config")
    async config(@Req() req: unknown): Promise<{
        defaultPolicyMode: string;
        policyKeys: Record<DesktopPolicyKey, boolean>;
        revision: number;
    }> {
        const deptId = (req as { user?: { departmentId?: string; deptId?: string } }).user?.departmentId
            ?? (req as { user?: { deptId?: string } }).user?.deptId;
        const policyKeys = await this.loadPolicyKeys(deptId);
        const globalMode = process.env.DESKTOP_DEFAULT_POLICY_MODE ?? "balanced";
        return { defaultPolicyMode: globalMode, policyKeys, revision: POLICY_REVISION };
    }

    /** 读取策略键：部门组优先合并到全局组之上 */
    private async loadPolicyKeys(deptId?: string): Promise<Record<DesktopPolicyKey, boolean>> {
        const result: Record<DesktopPolicyKey, boolean> = { ...DEFAULT_POLICY };
        try {
            const groups = deptId ? [POLICY_GROUP, `${POLICY_GROUP}:${deptId}`] : [POLICY_GROUP];
            const rows = await this.dictRepository.find({ where: groups.map((g) => ({ group: g })) });
            // 部门覆盖组最后处理（覆盖同名校验键）
            const ordered = rows.sort((a, b) =>
                a.group.includes(":") ? 1 : b.group.includes(":") ? -1 : 0,
            );
            for (const row of ordered) {
                if (!DESKTOP_POLICY_KEYS.includes(row.key as DesktopPolicyKey)) continue;
                const bool = parseBool(row.value);
                if (bool !== undefined) result[row.key as DesktopPolicyKey] = bool;
            }
        } catch {
            /* 字典不可读时回退默认策略，不影响配置下发 */
        }
        return result;
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