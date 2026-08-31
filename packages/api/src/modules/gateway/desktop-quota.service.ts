import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import { DesktopAuditEvent, DesktopQuota, DesktopUsageEvent } from "@buildingai/db/entities";
import { Repository } from "@buildingai/db/typeorm";

/**
 * 部门配额服务（网关治理 P0 · B2）
 *
 * 策略（BRD 决策）：**只告警不阻断为默认**——
 * - 月度用量达 warnThresholdPercent（默认 80%）→ 记 quota.warn 审计事件（部门内去重）；
 * - 达到 100% → 记 quota.exceeded；
 * - 硬阻断为部门级 opt-in 开关（blockEnabled）：超额后网关返回 429，
 *   评估结果带 30s 进程内缓存，避免每请求聚合全表。
 *
 * 通知渠道：本版本走审计事件（控制台可见）；站内/邮件通知待 notification 模块成熟后接入。
 */
export interface QuotaStatus {
    departmentId: string;
    month: string;
    budgetTokens: number | null;
    budgetCostMicroYuan: number | null;
    usedTokens: number;
    usedCostMicroYuan: number;
    tokenPercent: number | null;
    costPercent: number | null;
    warnThresholdPercent: number;
    blocked: boolean;
}

const BLOCK_CACHE_TTL_MS = 30_000;

@Injectable()
export class DesktopQuotaService {
    private readonly logger = new Logger(DesktopQuotaService.name);
    /** 告警去重：`${departmentId}:${month}:${milestone}` 已触发则不再重复记审计 */
    private firedMilestones = new Set<string>();
    /** 阻断判定缓存：departmentId -> { blocked, expiresAt } */
    private blockCache = new Map<string, { blocked: boolean; expiresAt: number }>();

    constructor(
        @InjectRepository(DesktopQuota)
        private readonly quotaRepo: Repository<DesktopQuota>,
        @InjectRepository(DesktopUsageEvent)
        private readonly usageRepo: Repository<DesktopUsageEvent>,
        @InjectRepository(DesktopAuditEvent)
        private readonly auditRepo: Repository<DesktopAuditEvent>,
    ) {}

    /** 当前月份（服务器本地时区，YYYY-MM） */
    currentMonth(): string {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    }

    /** 月份的时间范围（本地时区 → Date，供 occurredAt 过滤） */
    private monthRange(month: string): { from: Date; to: Date } {
        const [y, m] = month.split("-").map(Number);
        const from = new Date(y, (m ?? 1) - 1, 1);
        const to = new Date(y, m ?? 1, 1);
        return { from, to };
    }

    /** 配额行（部门×月份，无则 null=该部门未设限） */
    async findQuota(departmentId: string, month: string): Promise<DesktopQuota | null> {
        return this.quotaRepo.findOne({ where: { departmentId, month } });
    }

    /** 部门月度用量（token=input+output 口径；成本含 null 单价记录以外部分） */
    async usageOf(departmentId: string, month: string): Promise<{ usedTokens: number; usedCostMicroYuan: number }> {
        const { from, to } = this.monthRange(month);
        const row = (await this.usageRepo
            .createQueryBuilder("u")
            .select("COALESCE(SUM(u.inputTokens + u.outputTokens), 0)", "tokens")
            .addSelect("COALESCE(SUM(u.costMicroYuan), 0)", "cost")
            .where("u.departmentId = :departmentId", { departmentId })
            .andWhere("u.occurredAt >= :from", { from })
            .andWhere("u.occurredAt < :to", { to })
            .getRawOne()) as { tokens: string | null; cost: string | null };
        return { usedTokens: Number(row?.tokens ?? 0), usedCostMicroYuan: Number(row?.cost ?? 0) };
    }

    /** 配额状态（控制台展示 + 网关阻断判定共用） */
    async status(departmentId: string, month?: string): Promise<QuotaStatus | null> {
        const m = month || this.currentMonth();
        const quota = await this.findQuota(departmentId, m);
        if (!quota) return null;
        const { usedTokens, usedCostMicroYuan } = await this.usageOf(departmentId, m);
        const tokenPercent =
            quota.budgetTokens && quota.budgetTokens > 0
                ? Math.min(999, Math.round((usedTokens / Number(quota.budgetTokens)) * 100))
                : null;
        const costPercent =
            quota.budgetCostMicroYuan && quota.budgetCostMicroYuan > 0
                ? Math.min(999, Math.round((usedCostMicroYuan / Number(quota.budgetCostMicroYuan)) * 100))
                : null;
        const blocked =
            quota.blockEnabled &&
            ((tokenPercent !== null && tokenPercent >= 100) || (costPercent !== null && costPercent >= 100));
        return {
            departmentId,
            month: m,
            budgetTokens: quota.budgetTokens === null || quota.budgetTokens === undefined ? null : Number(quota.budgetTokens),
            budgetCostMicroYuan:
                quota.budgetCostMicroYuan === null || quota.budgetCostMicroYuan === undefined
                    ? null
                    : Number(quota.budgetCostMicroYuan),
            usedTokens,
            usedCostMicroYuan,
            tokenPercent,
            costPercent,
            warnThresholdPercent: quota.warnThresholdPercent,
            blocked,
        };
    }

    /**
     * 计量落库后评估（GatewayUsageService.record 成功后调用，异常只告警）。
     * 双轴任一达阈值即告警；达 100% 记 exceeded；阻断态清缓存立即生效。
     */
    async evaluateAfterRecord(departmentId?: string | null): Promise<void> {
        if (!departmentId) return;
        try {
            const st = await this.status(departmentId);
            if (!st) return;
            const percents = [st.tokenPercent, st.costPercent].filter((p): p is number => p !== null);
            if (percents.length === 0) return;
            const maxPercent = Math.max(...percents);
            const month = st.month;

            if (maxPercent >= 100) {
                this.fireMilestone(departmentId, month, "exceeded", st, maxPercent);
                this.blockCache.delete(departmentId);
            } else if (maxPercent >= st.warnThresholdPercent) {
                this.fireMilestone(departmentId, month, "warn", st, maxPercent);
            }
        } catch (err) {
            this.logger.warn(`配额评估失败（不影响计量）: ${String(err)}`);
        }
    }

    /** 网关转发前阻断判定（30s 缓存；默认策略只告警，仅 blockEnabled 部门生效） */
    async isBlocked(departmentId?: string | null): Promise<boolean> {
        if (!departmentId) return false;
        const cached = this.blockCache.get(departmentId);
        if (cached && cached.expiresAt > Date.now()) return cached.blocked;
        try {
            const st = await this.status(departmentId);
            const blocked = st?.blocked ?? false;
            this.blockCache.set(departmentId, { blocked, expiresAt: Date.now() + BLOCK_CACHE_TTL_MS });
            return blocked;
        } catch {
            return false;
        }
    }

    /** 管理端 upsert（部门×月份唯一） */
    async upsert(input: {
        departmentId: string;
        month: string;
        budgetTokens?: number | null;
        budgetCostMicroYuan?: number | null;
        warnThresholdPercent?: number;
        blockEnabled?: boolean;
    }): Promise<DesktopQuota> {
        if (!/^\d{4}-\d{2}$/.test(input.month)) {
            throw new Error("month 格式应为 YYYY-MM");
        }
        let row = await this.findQuota(input.departmentId, input.month);
        if (!row) {
            row = this.quotaRepo.create({ departmentId: input.departmentId, month: input.month });
        }
        if (input.budgetTokens !== undefined) row.budgetTokens = input.budgetTokens;
        if (input.budgetCostMicroYuan !== undefined) row.budgetCostMicroYuan = input.budgetCostMicroYuan;
        if (input.warnThresholdPercent !== undefined) {
            row.warnThresholdPercent = Math.min(100, Math.max(1, Math.floor(input.warnThresholdPercent)));
        }
        if (input.blockEnabled !== undefined) row.blockEnabled = input.blockEnabled;
        const saved = await this.quotaRepo.save(row);
        this.blockCache.delete(input.departmentId);
        return saved;
    }

    async listAll(): Promise<DesktopQuota[]> {
        return this.quotaRepo.find({ order: { month: "DESC", departmentId: "ASC" } });
    }

    /** 记审计里程碑（同部门同月同级别只记一次，防刷屏） */
    private async fireMilestone(
        departmentId: string,
        month: string,
        level: "warn" | "exceeded",
        st: QuotaStatus,
        percent: number,
    ): Promise<void> {
        const key = `${departmentId}:${month}:${level}`;
        if (this.firedMilestones.has(key)) return;
        this.firedMilestones.add(key);
        try {
            await this.auditRepo.insert(
                this.auditRepo.create({
                    occurredAt: new Date(),
                    type: level === "exceeded" ? "quota.exceeded" : "quota.warn",
                    action: `部门 ${departmentId} ${month} 用量达 ${percent}%`,
                    rule: level,
                    reason:
                        `tokens=${st.usedTokens}/${st.budgetTokens ?? "∞"} ` +
                        `cost=${(st.usedCostMicroYuan / 1e6).toFixed(2)}元/${st.budgetCostMicroYuan !== null ? (st.budgetCostMicroYuan / 1e6).toFixed(2) + "元" : "∞"} ` +
                        `block=${st.blocked}`,
                }),
            );
        } catch (err) {
            this.logger.warn(`配额审计事件写入失败: ${String(err)}`);
        }
    }
}
