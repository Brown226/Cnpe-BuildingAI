import { InjectRepository } from "@buildingai/db/@nestjs/typeorm";
import { Agent } from "@buildingai/db/entities";
import { Not, Repository } from "@buildingai/db/typeorm";
import { Injectable, Logger } from "@nestjs/common";

import { RagflowApiService } from "./ragflow-api.service";

export interface RagflowAgentSyncResult {
    agent: Agent;
    status: "skipped" | "success" | "failed";
    errorMessage?: string;
}

/**
 * RagFlow 聊天助手信息同步服务。
 */
@Injectable()
export class RagflowAgentSyncService {
    private readonly logger = new Logger(RagflowAgentSyncService.name);

    constructor(
        @InjectRepository(Agent)
        private readonly agentRepository: Repository<Agent>,
        private readonly ragflowApiService: RagflowApiService,
    ) {}

    /**
     * 规范化并写回 RagFlow 基础配置。
     */
    normalizeConfig(agent: Agent): Agent {
        const normalized = this.ragflowApiService.normalizeConfig(agent.thirdPartyIntegration);
        agent.thirdPartyIntegration = {
            ...normalized,
            extendedConfig: {
                ...(normalized.extendedConfig ?? {}),
                ragflowSyncStatus: this.ragflowApiService.hasValidConfig(normalized)
                    ? "pending"
                    : "skipped",
            },
        };
        return agent;
    }

    /**
     * 同步 RagFlow 聊天助手基础信息到本地 Agent。
     */
    async syncAgentInfo(agentId: string): Promise<RagflowAgentSyncResult> {
        const agent = await this.agentRepository.findOne({ where: { id: agentId } });
        if (!agent || agent.createMode !== "ragflow") {
            return {
                agent: agent as Agent,
                status: "skipped",
            };
        }

        const normalized = this.ragflowApiService.normalizeConfig(agent.thirdPartyIntegration);
        if (!this.ragflowApiService.hasValidConfig(normalized)) {
            const nextIntegration = {
                ...normalized,
                extendedConfig: {
                    ...(normalized.extendedConfig ?? {}),
                    ragflowSyncStatus: "skipped",
                    ragflowSyncError: "RagFlow API Key 或 Chat ID 未配置完整，已跳过同步",
                },
            };
            await this.agentRepository.save({
                ...agent,
                thirdPartyIntegration: nextIntegration,
            });
            const latest = await this.agentRepository.findOne({ where: { id: agentId } });
            return {
                agent: latest as Agent,
                status: "skipped",
                errorMessage: "RagFlow API Key 或 Chat ID 未配置完整，已跳过同步",
            };
        }

        try {
            const appInfo = await this.ragflowApiService.getChatAssistant(normalized);
            const shouldSyncName = await this.shouldSyncName(agent, appInfo.name);

            const nextIntegration = {
                ...normalized,
                extendedConfig: {
                    ...(normalized.extendedConfig ?? {}),
                    ragflowAppInfo: appInfo.raw,
                    ragflowSyncStatus: "success",
                    ragflowSyncError: undefined,
                    ragflowSyncedAt: new Date().toISOString(),
                },
            };

            const payload: Partial<Agent> = {
                thirdPartyIntegration: nextIntegration,
            };

            if (shouldSyncName && appInfo.name) payload.name = appInfo.name;
            if (shouldSyncName && appInfo.description) payload.description = appInfo.description;
            if (appInfo.prologue) payload.openingStatement = appInfo.prologue;

            await this.agentRepository.save({
                ...agent,
                ...payload,
            });
            const latest = await this.agentRepository.findOne({ where: { id: agentId } });
            return {
                agent: latest as Agent,
                status: "success",
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.warn(
                `Sync RagFlow chat assistant info failed: agentId=${agentId}, error=${errorMessage}`,
            );

            const nextIntegration = {
                ...normalized,
                extendedConfig: {
                    ...(normalized.extendedConfig ?? {}),
                    ragflowSyncStatus: "failed",
                    ragflowSyncError: errorMessage,
                    ragflowSyncedAt: new Date().toISOString(),
                },
            };
            await this.agentRepository.save({
                ...agent,
                thirdPartyIntegration: nextIntegration,
            });
            const latest = await this.agentRepository.findOne({ where: { id: agentId } });
            return {
                agent: latest as Agent,
                status: "failed",
                errorMessage,
            };
        }
    }

    private async shouldSyncName(agent: Agent, name?: string): Promise<boolean> {
        const nextName = name?.trim();
        if (!nextName) return false;

        const existingAgent = await this.agentRepository.findOne({
            where: {
                createBy: agent.createBy,
                name: nextName,
                id: Not(agent.id),
            },
        });

        return !existingAgent;
    }
}
