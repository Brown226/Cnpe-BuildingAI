import type { StateCreator } from "zustand";

import { createStore } from "../create-store";

const PERSIST_KEY = "assistant";
const LEGACY_SELECTED_MODEL_KEY = "__selected_model_id__";

export interface AssistantState {
    selectedModelId: string;
    /** 选中的智能体（新会话应用的 persona，对齐 Kun composerAgentId）；空=默认 */
    composerAgentId: string;
    /** 输入条已引用的工作区文件（relativePath 列表，发送时内容注入 prompt） */
    composerFileReferences: string[];
    /** 输入条已挂载的知识库（数据集 id 列表，发送时随 session.send 下发引擎） */
    composerDatasetIds: string[];
    /** 当前会话 token 用量（input=最近一轮，output/cache=累计） */
    sessionUsage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

export interface AssistantActions {
    setSelectedModelId: (id: string) => void;
    setComposerAgentId: (id: string) => void;
    setComposerFileReferences: (paths: string[]) => void;
    setComposerDatasetIds: (ids: string[]) => void;
    recordSessionUsage: (usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number }) => void;
    resetSessionUsage: () => void;
}

export type AssistantSlice = AssistantState & AssistantActions;

export const createAssistantSlice: StateCreator<AssistantSlice, [], [], AssistantSlice> = (
    set,
) => ({
    selectedModelId: "",
    setSelectedModelId: (id) => set({ selectedModelId: id }),
    composerAgentId: "",
    setComposerAgentId: (id) => set({ composerAgentId: id }),
    composerFileReferences: [],
    setComposerFileReferences: (paths) => set({ composerFileReferences: paths }),
    composerDatasetIds: [],
    setComposerDatasetIds: (ids) => set({ composerDatasetIds: ids }),
    sessionUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    recordSessionUsage: (usage) =>
        set((state) => ({
            sessionUsage: {
                inputTokens: usage.inputTokens,
                outputTokens: state.sessionUsage.outputTokens + usage.outputTokens,
                cacheReadTokens: state.sessionUsage.cacheReadTokens + usage.cacheReadTokens,
            },
        })),
    resetSessionUsage: () =>
        set({ sessionUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } }),
});

export const useAssistantStore = createStore<AssistantSlice>(createAssistantSlice, {
    persist: {
        name: PERSIST_KEY,
        partialize: (state) => ({
            selectedModelId: state.selectedModelId,
            composerAgentId: state.composerAgentId,
            composerDatasetIds: state.composerDatasetIds,
        }),
        merge: (persisted, current) => {
            const p = persisted as {
                selectedModelId?: string;
                composerAgentId?: string;
                composerDatasetIds?: string[];
            } | undefined;
            return {
                selectedModelId: p?.selectedModelId ?? current.selectedModelId,
                composerAgentId: p?.composerAgentId ?? current.composerAgentId,
                composerDatasetIds: p?.composerDatasetIds ?? current.composerDatasetIds,
                composerFileReferences: current.composerFileReferences,
                sessionUsage: current.sessionUsage,
            };
        },
        migrate: (storage) => {
            const fromLegacy = storage.getItem(LEGACY_SELECTED_MODEL_KEY);
            if (fromLegacy) return { selectedModelId: fromLegacy };
            return undefined;
        },
    },
});
