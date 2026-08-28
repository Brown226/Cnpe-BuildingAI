/**
 * 桌面计划面板 store（④，对齐 Kun 计划面板）：
 * @narumitw/pi-plan-mode 扩展的 plan_mode_complete 工具参数携带完整
 * Markdown 实施计划（{ plan }），transport 在 tool_call_start 时按会话
 * 归档于此，右栏「计划」Tab 渲染。同一会话后续 plan_mode_complete
 * 调用会整体替换（计划可迭代修订）。
 */
import { create } from "zustand";

interface PlanStoreState {
    /** 会话 id → 最新计划的 Markdown 全文 */
    planByChat: Record<string, string>;
    /** 当前激活会话（transport 绑定线程上下文时更新） */
    activeChatId: string;
    setActiveChat: (chatId: string) => void;
    /** 计划全文整表替换（plan_mode_complete 每次携带完整的决策就绪计划） */
    applyPlan: (chatId: string, plan: string) => void;
}

export const usePlanStore = create<PlanStoreState>((set) => ({
    planByChat: {},
    activeChatId: "",
    setActiveChat: (chatId) => set({ activeChatId: chatId }),
    applyPlan: (chatId, plan) =>
        set((state) => ({
            planByChat: { ...state.planByChat, [chatId]: plan },
        })),
}));

/** 读取当前激活会话的计划 */
export function selectActivePlan(state: PlanStoreState): string {
    return state.planByChat[state.activeChatId] ?? "";
}