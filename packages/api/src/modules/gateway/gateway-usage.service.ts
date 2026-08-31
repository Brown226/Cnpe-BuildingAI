import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import { DepartmentUserIndex, DesktopUsageEvent } from "@buildingai/db/entities";
import { Repository } from "@buildingai/db/typeorm";

import { DesktopModelCatalogService } from "./desktop-model-catalog.service";
import { DesktopQuotaService } from "./desktop-quota.service";

/**
 * 网关计量服务（网关治理 P0 · A2/A3）
 *
 * 职责：把一次模型调用落成一条 desktop_usage_event 事实记录——
 * - 网关请求级计量（source="gateway"）是权威账本；
 * - 客户端审计通道兜底上报（source="client"）只补网关未覆盖场景；
 * - 落库时快照用户主部门（department_user_index 首条），报表免 join；
 * - cost 由调用方按模型单价换算后传入（微元整数）；单价缺失记 null，
 *   宁可少记不虚报。
 *
 * 失败不抛出：计量故障不得影响模型请求主链路。
 */
export interface GatewayUsageRecord {
    userId?: string;
    mode?: string | null;
    modelId?: string | null;
    provider?: string | null;
    sessionId?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    /** 成本（微元 1e-6 元）；null=单价未配置 */
    costMicroYuan?: number | null;
    source?: "gateway" | "client";
    /** 调用方已知的部门快照；缺省时服务端自查 */
    departmentId?: string | null;
}

@Injectable()
export class GatewayUsageService {
    private readonly logger = new Logger(GatewayUsageService.name);
    /** 部门快照缓存：userId -> { departmentId, expiresAt }（带 TTL，负向 60s 防绑部门后长期不生效） */
    private deptCache = new Map<string, { departmentId: string | null; expiresAt: number }>();

    constructor(
        @InjectRepository(DesktopUsageEvent)
        private readonly usageRepo: Repository<DesktopUsageEvent>,
        @InjectRepository(DepartmentUserIndex)
        private readonly deptIndexRepo: Repository<DepartmentUserIndex>,
        private readonly catalogService: DesktopModelCatalogService,
        private readonly quotaService: DesktopQuotaService,
    ) {}

    /** 异步落库；任何失败仅告警。cost 缺省时按目录单价现算（B1 快照口径） */
    async record(input: GatewayUsageRecord): Promise<void> {
        try {
            const costMicroYuan =
                input.costMicroYuan !== undefined
                    ? input.costMicroYuan
                    : await this.computeCost(
                          input.modelId ?? undefined,
                          input.inputTokens ?? 0,
                          input.outputTokens ?? 0,
                          input.cacheReadTokens ?? 0,
                          input.cacheWriteTokens ?? 0,
                      );
            const entity = this.usageRepo.create({
                userId: input.userId,
                occurredAt: new Date(),
                mode: input.mode ?? undefined,
                modelId: input.modelId ?? undefined,
                provider: input.provider ?? undefined,
                sessionId: input.sessionId ?? undefined,
                inputTokens: Math.max(0, Math.floor(input.inputTokens ?? 0)),
                outputTokens: Math.max(0, Math.floor(input.outputTokens ?? 0)),
                cacheReadTokens: Math.max(0, Math.floor(input.cacheReadTokens ?? 0)),
                cacheWriteTokens: Math.max(0, Math.floor(input.cacheWriteTokens ?? 0)),
                costMicroYuan:
                    costMicroYuan === null || costMicroYuan === undefined
                        ? null
                        : Math.max(0, Math.floor(costMicroYuan)),
                source: input.source ?? "gateway",
                departmentId: input.departmentId ?? (await this.resolveDepartment(input.userId)),
            });
            await this.usageRepo.save(entity);
            // B2：计量落库后触发配额评估（内部自带异常隔离，失败仅告警）
            await this.quotaService.evaluateAfterRecord(entity.departmentId);
        } catch (err) {
            this.logger.warn(`计量落库失败（不阻断请求）: ${String(err)}`);
        }
    }

    /**
     * B1 成本换算（微元）：tokens × 目录单价。
     * 单价单位为元/百万 tokens → 微元 = tokens × price（元/M）× 1e6 / 1e6 = tokens × price。
     * 目录缺失或未配置单价返回 null（宁可少记不虚报）。
     */
    private async computeCost(
        modelId: string | undefined,
        inputTokens: number,
        outputTokens: number,
        cacheReadTokens: number,
        cacheWriteTokens: number,
    ): Promise<number | null> {
        if (!modelId) return null;
        const pricing = await this.catalogService.findPricing(modelId);
        if (!pricing) return null;
        const cost =
            inputTokens * (pricing.inputPrice ?? 0) +
            outputTokens * (pricing.outputPrice ?? 0) +
            cacheReadTokens * (pricing.cacheReadPrice ?? 0) +
            cacheWriteTokens * (pricing.cacheWritePrice ?? 0);
        return Math.round(cost);
    }

    /**
     * B3 部门/模式/模型聚合报表（账本口径，B3）。
     * 按 departmentId × mode × modelId 聚合 tokens 与成本，供管理端用量报表页消费。
     */
    async summary(params: {
        from?: Date;
        to?: Date;
        departmentId?: string;
        userId?: string;
    }): Promise<{
        items: Array<{
            departmentId: string | null;
            mode: string | null;
            modelId: string | null;
            inputTokens: number;
            outputTokens: number;
            cacheReadTokens: number;
            costMicroYuan: number;
            costKnown: boolean;
            events: number;
        }>;
        total: { inputTokens: number; outputTokens: number; costMicroYuan: number; costKnown: boolean };
    }> {
        const qb = this.usageRepo
            .createQueryBuilder("u")
            .select("u.departmentId", "departmentId")
            .addSelect("u.mode", "mode")
            .addSelect("u.modelId", "modelId")
            .addSelect("SUM(u.inputTokens)", "inputTokens")
            .addSelect("SUM(u.outputTokens)", "outputTokens")
            .addSelect("SUM(u.cacheReadTokens)", "cacheReadTokens")
            .addSelect("SUM(u.costMicroYuan)", "costMicroYuan")
            .addSelect("COUNT(u.costMicroYuan)", "costEvents")
            .addSelect("COUNT(*)", "events")
            .groupBy("u.departmentId")
            .addGroupBy("u.mode")
            .addGroupBy("u.modelId");
        if (params.from) qb.andWhere("u.occurredAt >= :from", { from: params.from });
        if (params.to) qb.andWhere("u.occurredAt <= :to", { to: params.to });
        if (params.departmentId) qb.andWhere("u.departmentId = :departmentId", { departmentId: params.departmentId });
        if (params.userId) qb.andWhere("u.userId = :userId", { userId: params.userId });

        const rows = (await qb.getRawMany()) as Array<{
            departmentId: string | null;
            mode: string | null;
            modelId: string | null;
            inputTokens: string | null;
            outputTokens: string | null;
            cacheReadTokens: string | null;
            costMicroYuan: string | null;
            costEvents: string | null;
            events: string | null;
        }>;

        const items = rows.map((r) => {
            const events = Number(r.events ?? 0);
            const costEvents = Number(r.costEvents ?? 0);
            // costKnown=false 表示该组存在单价缺失的记录（成本只对已知部分求和）
            const costKnown = costEvents >= events;
            return {
                departmentId: r.departmentId,
                mode: r.mode,
                modelId: r.modelId,
                inputTokens: Number(r.inputTokens ?? 0),
                outputTokens: Number(r.outputTokens ?? 0),
                cacheReadTokens: Number(r.cacheReadTokens ?? 0),
                costMicroYuan: Number(r.costMicroYuan ?? 0),
                costKnown,
                events,
            };
        });
        const total = items.reduce(
            (acc, i) => ({
                inputTokens: acc.inputTokens + i.inputTokens,
                outputTokens: acc.outputTokens + i.outputTokens,
                costMicroYuan: acc.costMicroYuan + i.costMicroYuan,
                costKnown: acc.costKnown && i.costKnown,
            }),
            { inputTokens: 0, outputTokens: 0, costMicroYuan: 0, costKnown: true },
        );
        return { items, total };
    }

    /** 查询用户主部门（首条绑定），带进程内缓存（网关阻断判定共用，public）。
     * 缓存带 TTL：正向 10 分钟；负向（未绑部门）仅 60s，避免用户绑定部门后长时间不生效。 */
    async resolveDepartment(userId?: string): Promise<string | undefined> {
        if (!userId) return undefined;
        const now = Date.now();
        const cached = this.deptCache.get(userId);
        if (cached) {
            if (now < cached.expiresAt) return cached.departmentId ?? undefined;
            this.deptCache.delete(userId);
        }
        try {
            const row = await this.deptIndexRepo.findOne({
                where: { userId },
                order: { createdAt: "ASC" },
            });
            const deptId = row?.departmentId ?? null;
            this.deptCache.set(userId, {
                departmentId: deptId,
                expiresAt: now + (deptId ? 10 * 60 * 1000 : 60 * 1000),
            });
            return deptId ?? undefined;
        } catch {
            return undefined;
        }
    }
}
