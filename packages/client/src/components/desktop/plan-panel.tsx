/**
 * 右栏「计划」面板（④，对齐 Kun Plan 面板）：
 * 渲染 plan_mode_complete 提交的决策就绪实施计划（Markdown）。
 * 数据源：usePlanStore（transport 从 plan_mode_complete 参数归档）。
 */
import { cn } from "@buildingai/ui/lib/utils";
import { ClipboardCheck, GitBranch } from "lucide-react";
import { memo } from "react";
import ReactMarkdown from "react-markdown";

import { selectActivePlan, usePlanStore } from "./plan-store";

export const PlanPanel = memo(function PlanPanel() {
  const plan = usePlanStore(selectActivePlan);

  if (!plan.trim()) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <ClipboardCheck className="text-muted-foreground/50 size-8" />
        <div className="text-muted-foreground text-sm">暂无计划</div>
        <div className="text-muted-foreground/70 text-xs">
          进入计划模式（/plan）后，AI 会先在此提交实施计划
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <GitBranch className="text-primary size-4" />
        <span className="text-sm font-semibold">实施计划</span>
        <span className="text-muted-foreground text-[10px]">决策就绪 · 仅供审查</span>
      </div>
      <div
        className={cn(
          "prose-sm prose-headings:mt-3 prose-p:my-1.5 flex-1 overflow-y-auto p-3 text-[13px]",
        )}
      >
        <ReactMarkdown>{plan}</ReactMarkdown>
      </div>
      <div className="text-muted-foreground border-t px-3 py-1.5 text-[10px]">
        plan_mode_complete · 本地引擎生成
      </div>
    </div>
  );
});

PlanPanel.displayName = "PlanPanel";