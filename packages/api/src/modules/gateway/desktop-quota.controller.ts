import { Body, Controller, Get, Param, Put, Query } from "@nestjs/common";

import { DesktopQuotaService, type QuotaStatus } from "./desktop-quota.service";

/**
 * 部门配额控制台（网关治理 P0 · B2）
 *
 * 管理员维护部门月度预算：/consoleapi/desktop-quotas
 * - GET  ?departmentId=&month=  状态查询（含用量与百分比）
 * - GET  list                   全量清单
 * - PUT  upsert                 预算/阈值/阻断开关（部门×月份唯一）
 */
@Controller("consoleapi/desktop-quotas")
export class DesktopQuotaConsoleController {
    constructor(private readonly quotaService: DesktopQuotaService) {}

    @Get()
    async status(
        @Query("departmentId") departmentId?: string,
        @Query("month") month?: string,
    ): Promise<QuotaStatus | { ok: false; reason: "未设置配额" }> {
        if (!departmentId) throw new Error("departmentId 必填");
        const st = await this.quotaService.status(departmentId, month || undefined);
        return st ?? { ok: false as const, reason: "未设置配额" as const };
    }

    @Get("list")
    async list(): Promise<unknown[]> {
        return this.quotaService.listAll();
    }

    @Put("upsert")
    async upsert(
        @Body()
        dto: {
            departmentId?: string;
            month?: string;
            budgetTokens?: number | null;
            budgetCostMicroYuan?: number | null;
            warnThresholdPercent?: number;
            blockEnabled?: boolean;
        },
    ): Promise<unknown> {
        if (!dto.departmentId || !dto.month) throw new Error("departmentId 与 month 必填");
        return this.quotaService.upsert({
            departmentId: dto.departmentId,
            month: dto.month,
            budgetTokens: dto.budgetTokens,
            budgetCostMicroYuan: dto.budgetCostMicroYuan,
            warnThresholdPercent: dto.warnThresholdPercent,
            blockEnabled: dto.blockEnabled,
        });
    }
}
