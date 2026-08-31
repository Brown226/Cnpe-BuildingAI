import { AppEntity } from "../decorators/app-entity.decorator";
import { Column, Index, JoinColumn, ManyToOne } from "../typeorm";
import { BaseEntity } from "./base";
import { User } from "./user.entity";

/**
 * 用户全局记忆实体
 * 存储跨 Agent 的用户长期偏好和个人信息
 */
@AppEntity({ name: "ai_user_memory", comment: "用户全局记忆" })
@Index(["userId", "isActive", "createdAt"])
@Index(["scopeType", "scopeId"])
export class UserMemory extends BaseEntity {
    @Column({ type: "uuid", comment: "用户ID" })
    @Index()
    userId: string;

    /**
     * T4.3 scope 三级分区（隔离型：可见集 = 个人 ∪ 部门 ∪ 组织）
     * personal 记忆由对话抽取/用户自写产生；department/org 记忆仅管理端可写。
     */
    @Column({
        type: "varchar",
        length: 16,
        default: "personal",
        comment: "scope 级别：personal-个人，department-部门共享，org-组织共享",
    })
    scopeType: string;

    /** scope 归属 ID：personal→userId，department→deptId，org→NULL */
    @Column({ type: "uuid", nullable: true, comment: "scope 归属ID" })
    scopeId?: string | null;

    /**
     * Yan 结构化记忆六类（#6 记忆结构化）：检索加权与展示用。
     * preference/environment/project/decision/procedure/failure_solution
     */
    @Column({
        type: "varchar",
        length: 24,
        default: "project",
        comment: "结构化类型：preference|environment|project|decision|procedure|failure_solution",
    })
    memoryType: string;

    /** 支撑该记忆的对话原文摘录（≤500 字符，证据驱动） */
    @Column({ type: "text", nullable: true, comment: "证据摘录" })
    evidence?: string | null;

    /** 检索关键词（写入时 tokenize，含 CJK 二元组，≤16 个） */
    @Column({ type: "jsonb", nullable: true, comment: "检索关键词" })
    keywords?: string[] | null;

    /** 重复强化次数（同内容再现时 +1，检索加权用） */
    @Column({ type: "int", default: 1, comment: "重复强化次数" })
    occurrences: number;

    @Column({ type: "text", comment: "记忆内容" })
    content: string;

    /**
     * preference: 用户偏好 (如语言、风格偏好)
     * personal_info: 个人信息 (如姓名、职业)
     * habit: 使用习惯
     * instruction: 用户指令 (如"请用中文回答")
     */
    @Column({
        type: "varchar",
        length: 50,
        comment: "记忆分类",
    })
    category: string;

    @Column({
        type: "varchar",
        length: 255,
        nullable: true,
        comment: "来源会话ID",
    })
    source?: string;

    @Column({
        type: "uuid",
        nullable: true,
        comment: "来源智能体ID",
    })
    sourceAgentId?: string;

    @Column({
        type: "jsonb",
        nullable: true,
        comment: "扩展元数据",
    })
    metadata?: Record<string, any>;

    @Column({
        type: "boolean",
        default: true,
        comment: "是否有效",
    })
    isActive: boolean;

    @ManyToOne(() => User, { onDelete: "CASCADE" })
    @JoinColumn({ name: "user_id" })
    user?: User;
}
