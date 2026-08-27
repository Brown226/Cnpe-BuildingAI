import { ModelType } from "@buildingai/ai-sdk";
import {
    IsArray,
    IsBoolean,
    IsDefined,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    MaxLength,
    Min,
    MinLength,
} from "class-validator";

/**
 * 快捷创建AI供应商DTO
 *
 * OpenAI 兼容场景：直接提供 Base URL + API Key，
 * 系统自动创建/复用「快捷-{provider}」模板与密钥并完成绑定，使用者无需感知模板/密钥概念。
 */
export class CreateQuickAiProviderDto {
    /**
     * 供应商唯一标识（如 openai / deepseek / 自定义）
     */
    @IsDefined({ message: "供应商标识参数必须传递" })
    @IsNotEmpty({ message: "供应商标识不能为空" })
    @IsString({ message: "供应商标识必须是字符串" })
    @MinLength(1, { message: "供应商标识不能为空" })
    @MaxLength(50, { message: "供应商标识不能超过50个字符" })
    provider: string;

    /**
     * 供应商显示名称
     */
    @IsDefined({ message: "供应商名称参数必须传递" })
    @IsNotEmpty({ message: "供应商名称不能为空" })
    @IsString({ message: "供应商名称必须是字符串" })
    @MinLength(1, { message: "供应商名称不能为空" })
    @MaxLength(100, { message: "供应商名称不能超过100个字符" })
    name: string;

    /**
     * OpenAI 兼容 Base URL（可选，缺省用供应商默认端点）
     */
    @IsOptional()
    @IsString({ message: "Base URL 必须是字符串" })
    @MaxLength(500, { message: "Base URL 不能超过500个字符" })
    baseUrl?: string;

    /**
     * API Key
     */
    @IsDefined({ message: "API Key 参数必须传递" })
    @IsNotEmpty({ message: "API Key 不能为空" })
    @IsString({ message: "API Key 必须是字符串" })
    @MinLength(1, { message: "API Key 不能为空" })
    @MaxLength(200, { message: "API Key 不能超过200个字符" })
    apiKey: string;

    /**
     * 供应商图标URL
     */
    @IsOptional()
    @IsString({ message: "图标URL必须是字符串" })
    @MaxLength(500, { message: "图标URL不能超过500个字符" })
    iconUrl?: string;

    /**
     * 支持的模型类型
     */
    @IsOptional()
    @IsArray({ message: "支持的模型类型必须是数组" })
    supportedModelTypes?: ModelType[];

    /**
     * 是否启用该供应商
     */
    @IsOptional()
    @IsBoolean({ message: "启用状态必须是布尔值" })
    isActive?: boolean;

    /**
     * 排序权重
     */
    @IsOptional()
    @IsNumber({}, { message: "排序权重必须是数字" })
    @Min(0, { message: "排序权重不能小于0" })
    sortOrder?: number;
}