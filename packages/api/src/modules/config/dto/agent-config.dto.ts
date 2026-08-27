import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, Min, ValidateNested } from "class-validator";

const AGENT_CREATE_TYPES = ["direct", "coze", "dify", "ragflow"] as const;
const AGENT_BILLING_MODES = ["dynamic", "points"] as const;

/** 智能体可创建类型配置 DTO */
export class AgentTypeConfigItemDto {
    @IsIn(AGENT_CREATE_TYPES)
    key!: (typeof AGENT_CREATE_TYPES)[number];

    @IsBoolean()
    enabled!: boolean;

    @IsIn(AGENT_BILLING_MODES)
    billingMode!: (typeof AGENT_BILLING_MODES)[number];

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    points?: number;
}

/** 智能体设置 DTO */
export class UpdateAgentConfigDto {
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => AgentTypeConfigItemDto)
    createTypes?: AgentTypeConfigItemDto[];

    @IsOptional()
    @IsBoolean()
    publishWithoutReview?: boolean;
}
