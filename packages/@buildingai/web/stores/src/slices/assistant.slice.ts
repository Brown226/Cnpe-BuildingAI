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
}

export interface AssistantActions {
    setSelectedModelId: (id: string) => void;
    setComposerAgentId: (id: string) => void;
    setComposerFileReferences: (paths: string[]) => void;
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
});

export const useAssistantStore = createStore<AssistantSlice>(createAssistantSlice, {
    persist: {
        name: PERSIST_KEY,
        partialize: (state) => ({
            selectedModelId: state.selectedModelId,
            composerAgentId: state.composerAgentId,
        }),
        merge: (persisted, current) => {
            const p = persisted as { selectedModelId?: string; composerAgentId?: string } | undefined;
            return {
                selectedModelId: p?.selectedModelId ?? current.selectedModelId,
                composerAgentId: p?.composerAgentId ?? current.composerAgentId,
                composerFileReferences: current.composerFileReferences,
            };
        },
        migrate: (storage) => {
            const fromLegacy = storage.getItem(LEGACY_SELECTED_MODEL_KEY);
            if (fromLegacy) return { selectedModelId: fromLegacy };
            return undefined;
        },
    },
});
