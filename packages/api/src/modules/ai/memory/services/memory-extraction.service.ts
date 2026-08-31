import { MEMORY_EXTRACTION_PROMPT } from "@buildingai/ai-toolkit/prompts";
import {
    type ExtractedMemoryItem,
    type ExtractedMemoryOutput,
    extractedMemorySchema,
} from "@buildingai/ai-toolkit/schemas";
import type { MemoryConfig } from "@buildingai/types/ai/agent-config.interface";
import { Injectable, Logger } from "@nestjs/common";
import type { LanguageModel } from "ai";
import { generateText, Output } from "ai";

import { MemoryService } from "./memory.service";

export interface MemoryExtractionParams {
    userId: string;
    agentId?: string;
    conversationId?: string;
    conversationText: string;
    model: LanguageModel;
    memoryConfig?: MemoryConfig | null;
}

@Injectable()
export class MemoryExtractionService {
    private readonly logger = new Logger(MemoryExtractionService.name);

    constructor(private readonly memoryService: MemoryService) {}

    async extractAndSaveMemories(
        params: MemoryExtractionParams,
    ): Promise<{ usageTokens?: number }> {
        const { userId, agentId, conversationId, conversationText, model, memoryConfig } = params;

        try {
            const { output, usage } = await generateText({
                model,
                output: Output.object({ schema: extractedMemorySchema }),
                prompt: MEMORY_EXTRACTION_PROMPT(conversationText, !!agentId),
                temperature: 0,
            });

            console.log("memory extraction output------------------", output);

            const memories = (output as ExtractedMemoryOutput | undefined)?.memories ?? [];
            if (memories.length > 0) {
                this.logger.log(`Extracted ${memories.length} memories from conversation`);
                const savePromises = memories.map((memory: ExtractedMemoryItem) => {
                    if (memory.type === "user_global") {
                        return this.memoryService.createUserMemory({
                            userId,
                            content: memory.content,
                            category: memory.category,
                            source: conversationId,
                            sourceAgentId: agentId,
                            memoryType: memory.memoryType,
                            evidence: memory.evidence,
                        });
                    }
                    if (memory.type === "agent_specific" && agentId) {
                        return this.memoryService.createAgentMemory({
                            userId,
                            agentId,
                            content: memory.content,
                            category: memory.category,
                            source: conversationId,
                        });
                    }
                    return Promise.resolve(null);
                });
                await Promise.allSettled(savePromises);
            } else {
                this.logger.debug("No memories extracted from conversation");
            }

            const maxUser = memoryConfig?.maxUserMemories ?? 20;
            const maxAgent = memoryConfig?.maxAgentMemories ?? 20;
            await this.memoryService.trimUserMemoriesToLimit(userId, maxUser);
            if (agentId) {
                await this.memoryService.trimAgentMemoriesToLimit(userId, agentId, maxAgent);
            }
            const usageTokens =
                (usage?.totalTokens ?? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)) || 0;
            return { usageTokens };
        } catch (error) {
            this.logger.error(
                `Memory extraction failed: ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error.stack : undefined,
            );
            return { usageTokens: 0 };
        }
    }
}
