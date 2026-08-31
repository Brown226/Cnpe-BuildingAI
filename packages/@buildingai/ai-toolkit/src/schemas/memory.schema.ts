import { z } from "zod";

/** Yan 结构化记忆六类（#6 记忆结构化） */
export const MEMORY_MEMORY_TYPES = [
    "preference",
    "environment",
    "project",
    "decision",
    "procedure",
    "failure_solution",
] as const;

export const extractedMemorySchema = z.object({
    memories: z
        .array(
            z.object({
                type: z
                    .enum(["user_global", "agent_specific"])
                    .describe(
                        "user_global = cross-agent long-term preference; agent_specific = current agent business context",
                    ),
                content: z
                    .string()
                    .describe("A single self-contained sentence describing the memory"),
                category: z
                    .string()
                    .describe(
                        "For user_global: preference | personal_info | habit | instruction. For agent_specific: business_context | user_requirement | decision | fact",
                    ),
                memoryType: z
                    .enum(MEMORY_MEMORY_TYPES)
                    .optional()
                    .describe(
                        "Structured type — preference: stable likes/dislikes or standing instructions; environment: stable facts about the user's tools/paths/system; project: current work project context; decision: agreed choices; procedure: repeated how-to steps; failure_solution: a problem and what fixed it",
                    ),
                evidence: z
                    .string()
                    .max(500)
                    .optional()
                    .describe(
                        "Short verbatim quote from the conversation that supports this memory",
                    ),
            }),
        )
        .describe("Extracted memories. Return empty array if nothing worth remembering."),
});

export type ExtractedMemoryOutput = z.infer<typeof extractedMemorySchema>;
export type ExtractedMemoryItem = ExtractedMemoryOutput["memories"][number];
