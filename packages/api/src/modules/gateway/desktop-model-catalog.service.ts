import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import { DesktopModelCatalog } from "@buildingai/db/entities";
import { Repository } from "@buildingai/db/typeorm";
import { HttpErrorFactory } from "@buildingai/errors";

/**
 * 桌面模型目录服务（网关治理 P0 · A4/B1）
 *
 * - 下发：GET /gateway/models 返回启用清单（Pi models.json 数据源）
 * - 计价：计量落库时按 modelId 查单价换算成本（快照口径）
 * - 管理：consoleapi/desktop-models CRUD（管理员维护清单与单价）
 *
 * 目录为空时网关 /models 回退上游透传（开发/灰度期兼容），见 gateway.controller。
 */
export interface CatalogModelEntry {
    id: string;
    name: string;
    provider: string;
    api: "openai-completions";
    reasoning: boolean;
    input: string[];
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
    description?: string;
}

@Injectable()
export class DesktopModelCatalogService {
    constructor(
        @InjectRepository(DesktopModelCatalog)
        private readonly repo: Repository<DesktopModelCatalog>,
    ) {}

    /** 下发清单（仅启用项，按 sortOrder 降序）——Pi models.json 的 models 数组数据源 */
    async listActive(): Promise<DesktopModelCatalog[]> {
        return this.repo.find({ where: { isActive: true }, order: { sortOrder: "DESC" } });
    }

    /** 按 modelId 查单价（计量换算用；未配置返回 null——宁可少记不虚报） */
    async findPricing(modelId: string): Promise<DesktopModelCatalog | null> {
        if (!modelId) return null;
        return this.repo.findOne({ where: { modelId, isActive: true } });
    }

    /** 控制台列表（含停用项） */
    async listAll(): Promise<DesktopModelCatalog[]> {
        return this.repo.find({ order: { sortOrder: "DESC" } });
    }

    async create(dto: Partial<DesktopModelCatalog>): Promise<DesktopModelCatalog> {
        if (!dto.modelId?.trim()) throw HttpErrorFactory.badRequest("modelId 必填");
        const exists = await this.repo.findOne({ where: { modelId: dto.modelId.trim() } });
        if (exists) throw HttpErrorFactory.badRequest(`模型已存在: ${dto.modelId}`);
        return this.repo.save(this.repo.create({ ...dto, modelId: dto.modelId.trim() }));
    }

    async update(id: string, dto: Partial<DesktopModelCatalog>): Promise<DesktopModelCatalog> {
        const row = await this.repo.findOne({ where: { id } });
        if (!row) throw HttpErrorFactory.notFound(`模型不存在: ${id}`);
        if (dto.modelId !== undefined && dto.modelId !== row.modelId) {
            const dup = await this.repo.findOne({ where: { modelId: dto.modelId.trim() } });
            if (dup) throw HttpErrorFactory.badRequest(`模型标识已被占用: ${dto.modelId}`);
        }
        Object.assign(row, dto);
        return this.repo.save(row);
    }

    async remove(id: string): Promise<void> {
        await this.repo.delete(id);
    }

    /** 转成 Pi models.json 的 provider.models[] 条目（元/百万 tokens → pi cost 元/token） */
    toPiModelEntry(row: DesktopModelCatalog): CatalogModelEntry {
        const perMillion = (price: number): number => price / 1_000_000;
        return {
            id: row.modelId,
            name: row.name,
            provider: "huashu-gateway",
            api: "openai-completions",
            reasoning: row.reasoning,
            input: ["text"],
            cost: {
                input: perMillion(row.inputPrice),
                output: perMillion(row.outputPrice),
                cacheRead: perMillion(row.cacheReadPrice),
                cacheWrite: perMillion(row.cacheWritePrice),
            },
            contextWindow: row.contextWindow ?? 128_000,
            maxTokens: row.maxTokens ?? 8_192,
            ...(row.description ? { description: row.description } : {}),
        };
    }
}
