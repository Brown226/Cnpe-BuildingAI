import { BaseService, FieldFilterOptions } from "@buildingai/base";
import {
    SecretService,
    SecretTemplateService,
    type CreateSecretDto,
    type CreateSecretTemplateDto,
} from "@buildingai/core";
import { AI_DEFAULT_MODEL, BooleanNumber } from "@buildingai/constants";
import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import { AiProvider } from "@buildingai/db/entities";
import { Like, Repository } from "@buildingai/db/typeorm";
import { DictService } from "@buildingai/dict";
import { HttpErrorFactory } from "@buildingai/errors";
import { CreateAiProviderDto, UpdateAiProviderDto } from "@modules/ai/provider/dto/ai-provider.dto";
import { CreateQuickAiProviderDto } from "@modules/ai/provider/dto/quick-create-ai-provider.dto";
import { Injectable } from "@nestjs/common";

/**
 * AI供应商服务
 *
 * 管理AI供应商的CRUD操作和连接测试功能
 */
@Injectable()
export class AiProviderService extends BaseService<AiProvider> {
    constructor(
        @InjectRepository(AiProvider)
        private readonly aiProviderRepository: Repository<AiProvider>,
        private readonly dictService: DictService,
        private readonly secretService: SecretService,
        private readonly secretTemplateService: SecretTemplateService,
    ) {
        super(aiProviderRepository);
    }

    /**
     * 快捷创建AI供应商（OpenAI 兼容场景）
     *
     * 自动完成：找/建「快捷-{provider}」密钥模板 → 复用或新建密钥并加密托管 → 创建厂商并绑定，
     * 全程幂等（可重复调用不产生重复模板/密钥）；使用者无需感知模板/密钥概念。
     */
    async quickCreateProvider(dto: CreateQuickAiProviderDto): Promise<Partial<AiProvider>> {
        // 供应商标识唯一性校验（与 createProvider 一致）
        const existingProvider = await this.findOne({
            where: { provider: dto.provider },
        });

        if (existingProvider) {
            throw HttpErrorFactory.badRequest(`供应商标识 '${dto.provider}' 已存在`);
        }

        // 1. 找/建快捷密钥模板（字段固定为 apiKey / baseUrl，与 ai-sdk 运行时消费约定一致）
        const templateName = `快捷-${dto.provider}`;
        let template = await this.secretTemplateService.findOne({
            where: { name: templateName },
        });

        if (!template) {
            try {
                template = await this.secretTemplateService.create({
                    name: templateName,
                    fieldConfig: [
                        { name: "apiKey", required: true, placeholder: "API Key" },
                        { name: "baseUrl", required: false, placeholder: "https://api.openai.com/v1" },
                    ],
                    isEnabled: BooleanNumber.YES,
                    sortOrder: 0,
                } as CreateSecretTemplateDto);
            } catch (error) {
                // 并发下模板已存在则复用
                template = await this.secretTemplateService.findOne({
                    where: { name: templateName },
                });
                if (!template) throw error;
                this.logger.warn(`快捷模板创建冲突，复用已有模板: ${templateName}`);
            }
        }

        // 2. 快捷模板下复用或新建密钥（同名复用，避免重复密钥垃圾）
        const secretName = `${dto.provider} 密钥`;
        let secret;
        try {
            secret = await this.secretService.create({
                name: secretName,
                templateId: template.id,
                fieldValues: [
                    { name: "apiKey", value: dto.apiKey },
                    { name: "baseUrl", value: dto.baseUrl ?? "" },
                ],
                status: BooleanNumber.YES,
            } as CreateSecretDto);
        } catch (error) {
            secret = await this.secretService.findOne({
                where: { templateId: template.id, name: secretName },
            });
            if (!secret) throw error;
            this.logger.warn(`快捷密钥创建冲突，复用已有密钥: ${secretName}`);
        }

        // 3. 创建厂商并绑定密钥
        return await this.createProvider({
            provider: dto.provider,
            name: dto.name,
            description: undefined,
            bindSecretId: secret.id,
            supportedModelTypes: dto.supportedModelTypes,
            iconUrl: dto.iconUrl,
            isActive: dto.isActive,
            sortOrder: dto.sortOrder ?? 0,
        });
    }

    /**
     * 创建AI供应商
     */
    async createProvider(
        dto: CreateAiProviderDto,
        options?: FieldFilterOptions<AiProvider>,
    ): Promise<Partial<AiProvider>> {
        // 检查供应商标识是否已存在
        const existingProvider = await this.findOne({
            where: { provider: dto.provider },
        });

        if (existingProvider) {
            throw HttpErrorFactory.badRequest(`供应商标识 '${dto.provider}' 已存在`);
        }

        try {
            const provider = await this.create(dto, options);
            return provider;
        } catch (error) {
            this.logger.error(`创建AI供应商失败: ${error.message}`, error.stack);
            throw HttpErrorFactory.badRequest("创建AI供应商失败");
        }
    }

    /**
     * 更新AI供应商
     */
    async updateProvider(
        id: string,
        dto: UpdateAiProviderDto,
        options?: FieldFilterOptions<AiProvider>,
    ): Promise<Partial<AiProvider>> {
        // 如果更新了provider标识，检查是否冲突
        if (dto.provider) {
            const conflictProvider = await this.findOne({
                where: { provider: dto.provider },
            });

            if (conflictProvider && conflictProvider.id !== id) {
                throw HttpErrorFactory.badRequest(`供应商标识 '${dto.provider}' 已存在`);
            }
        }

        try {
            const provider = await this.updateById(id, dto, options);
            return provider;
        } catch (error) {
            this.logger.error(`更新AI供应商失败: ${error.message}`, error.stack);
            throw HttpErrorFactory.badRequest("更新AI供应商失败");
        }
    }

    /**
     * 获取AI供应商列表（不分页）
     * @description 获取所有AI供应商列表，支持关键词搜索和状态过滤
     */
    async getProviderList(
        queryOptions: {
            keyword?: string;
            isActive?: boolean;
        } = {},
        excludeFields: string[] = ["apiKey"],
    ) {
        const where: any = {};

        // 构建查询条件
        if (typeof queryOptions.isActive === "boolean") {
            where.isActive = queryOptions.isActive;
        }

        // 关键词搜索（名称、标识符或描述）
        const whereConditions: any[] = [];
        if (queryOptions.keyword) {
            whereConditions.push(
                { ...where, ...{ name: Like(`%${queryOptions.keyword}%`) } },
                {
                    ...where,
                    ...{ provider: Like(`%${queryOptions.keyword}%`) },
                },
                {
                    ...where,
                    ...{ description: Like(`%${queryOptions.keyword}%`) },
                },
            );
        } else {
            whereConditions.push(where);
        }

        try {
            const providers = await this.findAll({
                where: whereConditions.length > 1 ? whereConditions : where,
                relations: ["models"],
                order: {
                    sortOrder: "DESC",
                    createdAt: "DESC",
                },
                excludeFields,
            });

            providers.forEach((p) =>
                p.models?.sort(
                    (a, b) =>
                        b.sortOrder - a.sortOrder || b.createdAt.getTime() - a.createdAt.getTime(),
                ),
            );

            return providers;
        } catch (error) {
            this.logger.error(`查询AI供应商列表失败: ${error.message}`, error.stack);
            throw HttpErrorFactory.internal("查询AI供应商列表失败");
        }
    }

    /**
     * 获取供应商详情
     */
    async getProviderDetail(
        id: string,
        excludeFields: string[] = ["apiKey"],
    ): Promise<Partial<AiProvider>> {
        this.logger.log(`正在获取AI供应商详情: ${id}`);

        try {
            const provider = await this.findOne({
                where: { id },
                relations: ["models"],
                excludeFields,
            });

            if (!provider) {
                throw HttpErrorFactory.notFound("供应商不存在");
            }

            provider.models?.sort(
                (a, b) =>
                    b.sortOrder - a.sortOrder || b.createdAt.getTime() - a.createdAt.getTime(),
            );

            return provider;
        } catch (error) {
            this.logger.error(`获取AI供应商详情失败: ${error.message}`, error.stack);
            throw HttpErrorFactory.internal("获取AI供应商详情失败");
        }
    }

    /**
     * 删除AI供应商
     */
    async deleteProvider(id: string): Promise<void> {
        this.logger.log(`正在删除AI供应商: ${id}`);

        try {
            const provider = await this.findOne({
                where: { id },
                relations: ["models"],
            });
            const defaultModelId = await this.dictService.get<string | undefined>(AI_DEFAULT_MODEL);

            if (defaultModelId && provider?.models?.some((model) => model.id === defaultModelId)) {
                await this.dictService.deleteByKey(AI_DEFAULT_MODEL);
            }

            await this.delete(id);
            this.logger.log(`AI供应商删除成功: ${id}`);
        } catch (error) {
            this.logger.error(`删除AI供应商失败: ${error.message}`, error.stack);
            throw HttpErrorFactory.badRequest("删除AI供应商失败");
        }
    }

    /**
     * 获取所有启用的供应商
     */
    async getActiveProviders(excludeFields: string[] = ["apiKey"]): Promise<Partial<AiProvider>[]> {
        const providers = await this.findAll({
            where: { isActive: true },
            relations: ["models"],
            order: { sortOrder: "ASC", createdAt: "DESC" },
            excludeFields,
        });

        providers.forEach((p) =>
            p.models?.sort(
                (a, b) =>
                    b.sortOrder - a.sortOrder || b.createdAt.getTime() - a.createdAt.getTime(),
            ),
        );

        return providers;
    }

    /**
     * 根据供应商标识获取供应商
     */
    async getProviderByCode(
        provider: string,
        excludeFields: string[] = ["apiKey"],
    ): Promise<Partial<AiProvider> | null> {
        const result = await this.findOne({
            where: { provider, isActive: true },
            relations: ["models"],
            excludeFields,
        });

        // 对模型列表排序
        result?.models?.sort(
            (a, b) => b.sortOrder - a.sortOrder || b.createdAt.getTime() - a.createdAt.getTime(),
        );

        return result;
    }
}
