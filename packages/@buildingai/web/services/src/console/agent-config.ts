import type { MutationOptionsUtil, QueryOptionsUtil } from "@buildingai/web-types";
import { useMutation, useQuery } from "@tanstack/react-query";

import { consoleHttpClient } from "../base";

export const AGENT_CREATE_TYPE_KEYS = ["direct", "coze", "dify", "ragflow"] as const;
export const AGENT_BILLING_MODE_KEYS = ["dynamic", "points"] as const;

export type AgentCreateTypeKey = (typeof AGENT_CREATE_TYPE_KEYS)[number];
export type AgentBillingMode = (typeof AGENT_BILLING_MODE_KEYS)[number];

/** 智能体类型配置 */
export type AgentTypeConfigItem = {
    key: AgentCreateTypeKey;
    enabled: boolean;
    billingMode: AgentBillingMode;
    points?: number;
};

/** 智能体设置配置 */
export type AgentConfigDto = {
    createTypes: AgentTypeConfigItem[];
    publishWithoutReview: boolean;
};

/** 智能体设置更新参数 */
export type UpdateAgentConfigDto = {
    createTypes?: AgentTypeConfigItem[];
    publishWithoutReview?: boolean;
};

/** 获取智能体设置 */
export function useAgentConfigQuery(options?: QueryOptionsUtil<AgentConfigDto>) {
    return useQuery<AgentConfigDto>({
        queryKey: ["agent-config"],
        queryFn: () => consoleHttpClient.get<AgentConfigDto>("/agent-config"),
        ...options,
    });
}

/** 保存智能体设置 */
export function useSetAgentConfigMutation(
    options?: MutationOptionsUtil<AgentConfigDto, UpdateAgentConfigDto>,
) {
    return useMutation<AgentConfigDto, Error, UpdateAgentConfigDto>({
        mutationFn: (dto) => consoleHttpClient.post<AgentConfigDto>("/agent-config", dto),
        ...options,
    });
}
