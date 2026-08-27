import { DictService } from "@buildingai/dict";
import { Injectable } from "@nestjs/common";

export const AGENT_CREATE_TYPE_KEYS = ["direct", "coze", "dify", "ragflow"] as const;
export const AGENT_BILLING_MODE_KEYS = ["dynamic", "points"] as const;

export type AgentCreateTypeKey = (typeof AGENT_CREATE_TYPE_KEYS)[number];
export type AgentBillingMode = (typeof AGENT_BILLING_MODE_KEYS)[number];

export interface AgentTypeConfigItem {
    key: AgentCreateTypeKey;
    enabled: boolean;
    billingMode: AgentBillingMode;
    points?: number;
}

export interface AgentConfigDto {
    createTypes: AgentTypeConfigItem[];
    publishWithoutReview: boolean;
}

const AGENT_CONFIG_GROUP = "agent-config";
const AGENT_CONFIG_KEY = "create-types";
const AGENT_PUBLISH_WITHOUT_REVIEW_KEY = "publish-without-review";

const DEFAULT_CREATE_TYPES: AgentTypeConfigItem[] = [
    {
        key: "direct",
        enabled: true,
        billingMode: "dynamic",
    },
    {
        key: "coze",
        enabled: true,
        billingMode: "points",
        points: 0,
    },
    {
        key: "dify",
        enabled: true,
        billingMode: "points",
        points: 0,
    },
    {
        key: "ragflow",
        enabled: true,
        billingMode: "points",
        points: 0,
    },
];

/** 智能体设置配置服务 */
@Injectable()
export class AgentConfigService {
    constructor(private readonly dictService: DictService) {}

    /** 获取智能体设置配置 */
    async getConfig(): Promise<AgentConfigDto> {
        const stored = await this.dictService.get<AgentTypeConfigItem[]>(
            AGENT_CONFIG_KEY,
            DEFAULT_CREATE_TYPES,
            AGENT_CONFIG_GROUP,
        );

        const publishWithoutReview = await this.dictService.get<boolean>(
            AGENT_PUBLISH_WITHOUT_REVIEW_KEY,
            false,
            AGENT_CONFIG_GROUP,
        );

        return {
            createTypes: this.normalizeCreateTypes(stored),
            publishWithoutReview,
        };
    }

    /** 保存智能体设置配置 */
    async setConfig(payload: Partial<AgentConfigDto>): Promise<AgentConfigDto> {
        if (payload.createTypes !== undefined) {
            await this.dictService.set(
                AGENT_CONFIG_KEY,
                this.normalizeCreateTypes(payload.createTypes),
                {
                    group: AGENT_CONFIG_GROUP,
                    description: "agent 创建类型配置",
                },
            );
        }

        if (payload.publishWithoutReview !== undefined) {
            await this.dictService.set(
                AGENT_PUBLISH_WITHOUT_REVIEW_KEY,
                payload.publishWithoutReview,
                {
                    group: AGENT_CONFIG_GROUP,
                    description: "智能体发布到广场是否免审核",
                },
            );
        }

        return this.getConfig();
    }

    /** 规范化创建类型配置 */
    private normalizeCreateTypes(input?: AgentTypeConfigItem[]): AgentTypeConfigItem[] {
        const configMap = new Map((input ?? []).map((item) => [item.key, item]));

        return DEFAULT_CREATE_TYPES.map((defaultItem) => {
            const current = configMap.get(defaultItem.key);
            const billingMode =
                current?.billingMode === "dynamic" || current?.billingMode === "points"
                    ? current.billingMode
                    : defaultItem.billingMode;
            const normalizedPoints =
                billingMode === "points"
                    ? Math.max(0, Number(current?.points ?? defaultItem.points ?? 0) || 0)
                    : undefined;

            return {
                key: defaultItem.key,
                enabled: current?.enabled ?? defaultItem.enabled,
                billingMode,
                points: normalizedPoints,
            };
        });
    }
}
