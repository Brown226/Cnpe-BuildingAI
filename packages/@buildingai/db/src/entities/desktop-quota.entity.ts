import { Column, Entity, Index } from "../typeorm";
import { BaseEntity } from "./base";

/**
 * 部门月度模型用量配额（网关治理 P0 · B2）
 *
 * 维度：部门 × 月份（服务器本地时区）。预算两轴可选：
 * - budgetTokens：token 预算（input+output 口径，缓存 token 不计入，钱的部分走成本轴）；
 * - budgetCostMicroYuan：成本预算（微元 1e-6 元，与计量账本口径一致）。
 *
 * 策略（BRD 决策）：默认只告警不阻断——达到 warnThresholdPercent 记 quota.warn
 * 审计事件，达到 100% 记 quota.exceeded；硬阻断为部门级开关 blockEnabled，
 * 仅在超额后生效（网关返回 429）。org 默认不开阻断。
 */
@Entity("desktop_quota")
@Index(["departmentId", "month"], { unique: true })
export class DesktopQuota extends BaseEntity {
    /** 部门 id */
    @Column({ type: "varchar", length: 64 })
    departmentId: string;

    /** 月份（YYYY-MM，服务器本地时区） */
    @Column({ type: "varchar", length: 7 })
    month: string;

    /** token 预算（input+output 口径）；null=不设限 */
    @Column({ type: "bigint", nullable: true })
    budgetTokens?: number | null;

    /** 成本预算（微元 1e-6 元）；null=不设限 */
    @Column({ type: "bigint", nullable: true })
    budgetCostMicroYuan?: number | null;

    /** 告警阈值百分比（默认 80，1~100） */
    @Column({ type: "int", default: 80 })
    warnThresholdPercent: number;

    /** 超额硬阻断开关（默认 false：只告警不阻断） */
    @Column({ type: "boolean", default: false })
    blockEnabled: boolean;
}
