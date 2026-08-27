import { Column, Entity, Index } from "../typeorm";
import { BaseEntity } from "./base";

/**
 * 桌面客户端审计事件（ADR-07 强制上报部分）
 *
 * 由客户端 Node sidecar 批量上报：操作流水/工具调用/策略拦截/审批结果。
 * 会话正文不上报（默认仅存员工本地）。
 */
@Entity("desktop_audit_event")
export class DesktopAuditEvent extends BaseEntity {
    /** 触发事件的用户 id（客户端登录态解析） */
    @Index()
    @Column({ type: "varchar", length: 64, nullable: true })
    userId?: string;

    /** 事件发生时间（客户端时钟 ISO 字符串） */
    @Index()
    @Column({ type: "timestamptz" })
    occurredAt: Date;

    /**
     * 事件类型：
     * session.start | session.end | tool.call |
     * policy.blocked | approval.requested | approval.granted | approval.denied
     */
    @Index()
    @Column({ type: "varchar", length: 32 })
    type: string;

    /** 动作描述（命令行/文件路径等，已截断） */
    @Column({ type: "text" })
    action: string;

    /** 命中规则标识（黑名单条目/权限模式等） */
    @Column({ type: "varchar", length: 160, nullable: true })
    rule?: string;

    /** 拒绝原因/备注 */
    @Column({ type: "varchar", length: 255, nullable: true })
    reason?: string;

    /** 结构化附加信息（exitCode/durationMs/target 等） */
    @Column({ type: "jsonb", nullable: true })
    detail?: Record<string, unknown>;
}
