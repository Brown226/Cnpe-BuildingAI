import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import { DepartmentUserIndex, DesktopUsageEvent } from "@buildingai/db/entities";
import { Repository } from "@buildingai/db/typeorm";

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
    /** 部门快照缓存：userId -> departmentId（进程内，避免每请求一查） */
    private deptCache = new Map<string, string | null>();

    constructor(
        @InjectRepository(DesktopUsageEvent)
        private readonly usageRepo: Repository<DesktopUsageEvent>,
        @InjectRepository(DepartmentUserIndex)
        private readonly deptIndexRepo: Repository<DepartmentUserIndex>,
    ) {}

    /** 异步落库；任何失败仅告警 */
    async record(input: GatewayUsageRecord): Promise<void> {
        try {
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
                    input.costMicroYuan === null || input.costMicroYuan === undefined
                        ? null
                        : Math.max(0, Math.floor(input.costMicroYuan)),
                source: input.source ?? "gateway",
                departmentId: input.departmentId ?? (await this.resolveDepartment(input.userId)),
            });
            await this.usageRepo.save(entity);
        } catch (err) {
            this.logger.warn(`计量落库失败（不阻断请求）: ${String(err)}`);
        }
    }

    /** 查询用户主部门（首条绑定），带进程内缓存 */
    private async resolveDepartment(userId?: string): Promise<string | undefined> {
        if (!userId) return undefined;
        if (this.deptCache.has(userId)) return this.deptCache.get(userId) ?? undefined;
        try {
            const row = await this.deptIndexRepo.findOne({
                where: { userId },
                order: { createdAt: "ASC" },
            });
            const deptId = row?.departmentId ?? null;
            this.deptCache.set(userId, deptId);
            return deptId ?? undefined;
        } catch {
            return undefined;
        }
    }
}
