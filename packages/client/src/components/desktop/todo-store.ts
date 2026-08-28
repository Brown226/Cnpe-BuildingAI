/**
 * 桌面待办清单 store（②右栏 Todo Tab 数据源）：
 * 本地引擎的 todo 扩展（@juicesharp/rpiv-todo）每次工具调用都会在
 * tool_call_end 事件携带完整任务快照（details.tasks，含状态机
 * pending → in_progress → completed + deleted 墓碑），
 * transport 解析后按会话 id 归档于此，右栏「待办」Tab 实时渲染。
 */
import { create } from "zustand";

export interface TodoTask {
    id: number;
    subject: string;
    description?: string;
    /** in_progress 时的进行时标签（如"编写测试"） */
    activeForm?: string;
    status: "pending" | "in_progress" | "completed" | "deleted";
    blockedBy?: number[];
}

interface TodoStoreState {
    /** 会话 id → 当前任务清单（已过滤 deleted 墓碑） */
    todosByChat: Record<string, TodoTask[]>;
    /** 当前激活会话（transport 绑定线程上下文时更新） */
    activeChatId: string;
    setActiveChat: (chatId: string) => void;
    /** 工具结果快照整表替换（rpiv-todo 每次调用都携带全量状态） */
    applyTodoSnapshot: (chatId: string, tasks: TodoTask[]) => void;
}

export const useTodoStore = create<TodoStoreState>((set) => ({
    todosByChat: {},
    activeChatId: "",
    setActiveChat: (chatId) => set({ activeChatId: chatId }),
    applyTodoSnapshot: (chatId, tasks) =>
        set((state) => ({
            todosByChat: {
                ...state.todosByChat,
                [chatId]: tasks.filter((t) => t.status !== "deleted"),
            },
        })),
}));

/**
 * 空清单常量：zustand v5 的 selector 经 useSyncExternalStore 做快照比对，
 * 每次返回新 [] 会导致快照永不稳定 → 无限重渲染（React error #185）。
 */
const EMPTY_TODOS: TodoTask[] = [];

/** 读取当前激活会话的待办清单 */
export function selectActiveTodos(state: TodoStoreState): TodoTask[] {
    return state.todosByChat[state.activeChatId] ?? EMPTY_TODOS;
}
