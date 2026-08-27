import type { QueryOptionsUtil } from "@buildingai/web-types";
import { useQuery } from "@tanstack/react-query";

import { apiHttpClient } from "../base";

export const AGENT_CREATE_TYPE_KEYS = ["direct", "coze", "dify", "ragflow"] as const;
export const AGENT_BILLING_MODE_KEYS = ["dynamic", "points"] as const;

export type AgentCreateTypeKey = (typeof AGENT_CREATE_TYPE_KEYS)[number];
export type AgentBillingMode = (typeof AGENT_BILLING_MODE_KEYS)[number];

export type AgentTypeConfigItem = {
    key: AgentCreateTypeKey;
    enabled: boolean;
    billingMode: AgentBillingMode;
    points?: number;
};

export type AgentConfigDto = {
    createTypes: AgentTypeConfigItem[];
    publishWithoutReview: boolean;
};

export function useWebAgentConfigQuery(options?: QueryOptionsUtil<AgentConfigDto>) {
    return useQuery<AgentConfigDto>({
        queryKey: ["web", "agent-config"],
        queryFn: () => apiHttpClient.get<AgentConfigDto>("/agent-config"),
        ...options,
    });
}
