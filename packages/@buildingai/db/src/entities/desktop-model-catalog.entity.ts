import { Column, Entity, Index } from "../typeorm";
import { BaseEntity } from "./base";

/**
 * 桌面模型目录（网关治理 P0 · A4）
 *
 * 服务端维护的网关模型清单：下发到桌面引擎（models.json）与计量成本换算的
 * 唯一单价来源。管理端 CRUD（consoleapi/desktop-models）。
 *
 * 单价口径：元 / 百万 tokens（对齐国内主流定价习惯）；
 * 成本换算：costMicroYuan = tokens × 单价（微元 1e-6 元，整数，无浮点误差）。
 */
@Entity("desktop_model_catalog")
export class DesktopModelCatalog extends BaseEntity {
    /** 上游模型标识（如 gpt-5.6-sol / qwen3.8-max），唯一 */
    @Index({ unique: true })
    @Column({ type: "varchar", length: 160 })
    modelId: string;

    /** 显示名（如「Qwen3.8 Max」） */
    @Column({ type: "varchar", length: 200 })
    name: string;

    /** 上游 provider 标记（保留列，多上游路由时启用） */
    @Column({ type: "varchar", length: 64, nullable: true })
    provider?: string;

    /** 输入单价（元/百万 tokens，含缓存写入口径） */
    @Column({ type: "double precision", default: 0 })
    inputPrice: number;

    /** 输出单价（元/百万 tokens） */
    @Column({ type: "double precision", default: 0 })
    outputPrice: number;

    /** 缓存命中读取单价（元/百万 tokens，通常为输入价 1~2 折） */
    @Column({ type: "double precision", default: 0 })
    cacheReadPrice: number;

    /** 缓存写入单价（元/百万 tokens，多数端点与输入同价，缺省 0） */
    @Column({ type: "double precision", default: 0 })
    cacheWritePrice: number;

    /** 上下文窗口（tokens，真实能力值） */
    @Column({ type: "integer", nullable: true })
    contextWindow?: number;

    /** 最大输出 tokens */
    @Column({ type: "integer", nullable: true })
    maxTokens?: number;

    /** 是否支持推理/深度思考 */
    @Column({ type: "boolean", default: false })
    reasoning: boolean;

    /** 是否启用（下发与计量只取启用项） */
    @Column({ type: "boolean", default: true })
    isActive: boolean;

    /** 排序权重（数字越大越靠前） */
    @Column({ type: "integer", default: 0 })
    sortOrder: number;

    /** 描述（供客户端模型选择器展示） */
    @Column({ type: "varchar", length: 500, nullable: true })
    description?: string;
}
