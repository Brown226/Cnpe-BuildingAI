import { Column, Entity, Index } from "../typeorm";
import { BaseEntity } from "./base";

/**
 * 桌面模型用量计量事实表（网关治理 P0，M9/M10 计量收口）
 *
 * 数据源：网关请求级计量（chat/completions 流式+非流式，source="gateway"）
 * 与客户端审计通道兜底上报（source="client"，仅 gateway 未覆盖场景）。
 * 审计表 desktop_audit_event 保持只增不改语义；本表是计量的唯一账本。
 *
 * 成本换算：costMicroYuan = tokens × 模型单价（网关下发），单位微元（1e-6 元），
 * 用整数避免浮点误差；单价未配置时为 null（只记 token，不虚报成本）。
 */
@Entity("desktop_usage_event")
export class DesktopUsageEvent extends BaseEntity {
    /** 用户 id（网关鉴权解析，非客户端自报） */
    @Index()
    @Column({ type: "varchar", length: 64, nullable: true })
    userId?: string;

    /** 请求完成时间 */
    @Index()
    @Column({ type: "timestamptz" })
    occurredAt: Date;

    /** 会话模式：code | work（客户端透传 X-BuildingAI-Mode，缺失为 null） */
    @Index()
    @Column({ type: "varchar", length: 16, nullable: true })
    mode?: string;

    /** 实际使用模型标识（响应 model 字段优先，缺失为 null） */
    @Index()
    @Column({ type: "varchar", length: 160, nullable: true })
    modelId?: string;

    /** 上游 provider 标识（保留列，模型路由多上游时启用） */
    @Column({ type: "varchar", length: 64, nullable: true })
    provider?: string;

    /** 会话标识（客户端透传 X-BuildingAI-Session，缺失为 null） */
    @Column({ type: "varchar", length: 64, nullable: true })
    sessionId?: string;

    /** 输入 tokens（含缓存写入，OpenAI prompt_tokens 口径） */
    @Column({ type: "int", default: 0 })
    inputTokens: number;

    /** 输出 tokens */
    @Column({ type: "int", default: 0 })
    outputTokens: number;

    /** 缓存命中读取 tokens（按单价打折计费） */
    @Column({ type: "int", default: 0 })
    cacheReadTokens: number;

    /** 缓存写入 tokens */
    @Column({ type: "int", default: 0 })
    cacheWriteTokens: number;

    /** 成本（微元 1e-6 元，整数）；单价缺失时为 null——宁可少记不虚报 */
    @Column({ type: "bigint", nullable: true })
    costMicroYuan?: number | null;

    /** 计量来源：gateway=网关请求级（权威账本）| client=客户端兜底上报 */
    @Column({ type: "varchar", length: 16, default: "gateway" })
    source: string;

    /** 部门快照（服务端按 department_user_index 查询落库，报表免 join） */
    @Column({ type: "varchar", length: 64, nullable: true })
    departmentId?: string;
}
