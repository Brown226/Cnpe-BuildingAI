/**
 * 右栏「待办」面板（②，对齐 Kun Todo 面板）：
 * 渲染本地引擎 todo 扩展维护的任务清单——按状态分组
 * （进行中 ◐ / 待处理 ○ / 已完成 ✓），进行中任务展示
 * activeForm 进行时标签，支持 blockedBy 依赖链提示。
 * 数据源：useTodoStore（transport 从 tool_call_end 结果快照归档）。
 */
import { cn } from "@buildingai/ui/lib/utils";
import { Circle, CircleCheck, CircleDotDashed, Link2, ListTodo, LoaderCircle } from "lucide-react";
import { memo, useMemo } from "react";

import { selectActiveTodos, useTodoStore, type TodoTask } from "./todo-store";

const STATUS_ORDER: Record<TodoTask["status"], number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
  deleted: 3,
};

function TaskRow({ task }: { task: TodoTask }) {
  const isInProgress = task.status === "in_progress";
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="mt-0.5 shrink-0">
        {isInProgress ? (
          <LoaderCircle className="text-primary size-3.5 animate-spin" />
        ) : task.status === "completed" ? (
          <CircleCheck className="text-muted-foreground size-3.5" />
        ) : (
          <Circle className="text-muted-foreground size-3.5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm",
            task.status === "completed" && "text-muted-foreground line-through",
            isInProgress && "font-medium",
          )}
        >
          #{task.id} {task.subject}
        </div>
        {isInProgress && task.activeForm ? (
          <div className="text-muted-foreground mt-0.5 truncate text-xs">{task.activeForm}</div>
        ) : null}
        {!isInProgress && task.description ? (
          <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
            {task.description}
          </div>
        ) : null}
        {task.blockedBy && task.blockedBy.length > 0 ? (
          <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-[11px]">
            <Link2 className="size-3" />
            <span>依赖 #{task.blockedBy.join(" #")}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const TodoPanel = memo(function TodoPanel() {
  const todos = useTodoStore(selectActiveTodos);

  const groups = useMemo(() => {
    const sorted = [...todos].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    return {
      inProgress: sorted.filter((t) => t.status === "in_progress"),
      pending: sorted.filter((t) => t.status === "pending"),
      completed: sorted.filter((t) => t.status === "completed"),
    };
  }, [todos]);

  const done = groups.completed.length;
  const total = todos.length;

  if (total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <ListTodo className="text-muted-foreground/50 size-8" />
        <div className="text-muted-foreground text-sm">暂无待办</div>
        <div className="text-muted-foreground/70 text-xs">
          让 AI 处理多步任务时，它会在这里维护任务清单
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-3 py-2.5">
        <div className="flex items-center gap-2">
          <CircleDotDashed className="text-primary size-4" />
          <span className="text-sm font-semibold">待办</span>
          <span className="text-muted-foreground text-xs">
            {done}/{total} 已完成
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {groups.inProgress.length > 0 ? (
          <div className="mb-2">
            <div className="text-muted-foreground px-1 py-1 text-[11px] tracking-wider uppercase">
              进行中
            </div>
            {groups.inProgress.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        ) : null}
        {groups.pending.length > 0 ? (
          <div className="mb-2">
            <div className="text-muted-foreground px-1 py-1 text-[11px] tracking-wider uppercase">
              待处理
            </div>
            {groups.pending.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        ) : null}
        {groups.completed.length > 0 ? (
          <div>
            <div className="text-muted-foreground px-1 py-1 text-[11px] tracking-wider uppercase">
              已完成
            </div>
            {groups.completed.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
});

TodoPanel.displayName = "TodoPanel";
