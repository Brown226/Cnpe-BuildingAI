/**
 * 子代理卡片（③，对齐 Kun 子代理卡片 / Claude Code Agent tool）：
 * pi-subagents 扩展注册的 Agent 工具调用渲染为独立卡片——
 * 头部显示子代理名称/类型与运行状态，正文展示其 task 描述，
 * 可展开查看完整 prompt，底部显示最终结果。
 * 输入：transport 的 tool-input-available（input.preview = 参数 JSON）；
 * 输出：tool-output-available（output.summary = 结果文本）。
 */
import {
  getStatusBadge,
  Tool,
  ToolContent,
  ToolHeader,
  ToolOutput,
} from "@buildingai/ui/components/ai-elements/tool";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import { cn } from "@buildingai/ui/lib/utils";
import { ArrowLeft, ChevronDown, ChevronRight, Maximize2 } from "lucide-react";
import { memo, useState } from "react";

interface SubagentArgs {
  /** 子代理任务描述（Claude Code 语义：描述委派给子代理做什么） */
  description?: string;
  prompt?: string;
  /** 子代理类型名（如 research / coding） */
  name?: string;
  model?: string;
  thinking?: string;
}

interface SubagentPart {
  toolCallId: string;
  state: string;
  input?: { preview?: string } & Record<string, unknown>;
  output?: { summary?: string } & Record<string, unknown>;
  errorText?: string;
}

function parseArgs(part: SubagentPart): SubagentArgs {
  const preview = part.input?.preview;
  if (!preview) return {};
  try {
    const parsed = JSON.parse(preview) as Record<string, unknown>;
    return {
      description:
        typeof parsed.description === "string" ? parsed.description : undefined,
      prompt: typeof parsed.prompt === "string" ? parsed.prompt : undefined,
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      thinking: typeof parsed.thinking === "string" ? parsed.thinking : undefined,
    };
  } catch {
    return {};
  }
}

export const SubagentCard = memo(function SubagentCard({
  toolPart,
}: {
  toolPart: SubagentPart;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const args = parseArgs(toolPart);
  const resultText =
    typeof toolPart.output?.summary === "string" ? toolPart.output.summary : "";
  const statusText = getStatusBadge(toolPart.state as never);

  return (
    <Tool>
      <ToolHeader
        state={toolPart.state as never}
        title={`子代理${args.name ? ` · ${args.name}` : ""}`}
        type="tool-invocation"
      />
      <ToolContent>
        <div className="not-prose rounded-md border p-2">
          <div className="flex items-start gap-1">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex min-w-0 flex-1 items-start gap-2 text-left"
            >
              {expanded ? (
                <ChevronDown className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
              ) : (
                <ChevronRight className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
              )}
              <span className={cn("min-w-0 flex-1 text-sm", !expanded && "line-clamp-2")}>
                {args.description || args.prompt || "子代理任务"}
              </span>
              {statusText}
            </button>
            {/* 查看子代理会话（Kun 子会话在主面打开的等价：详情视图，顶部返回条） */}
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground relative shrink-0 rounded p-0.5"
              title="查看子代理会话"
              onClick={() => setDetailOpen(true)}
            >
              <Maximize2 className="size-3.5" />
            </button>
          </div>
          {expanded && (args.prompt || args.model || args.thinking) && (
            <div className="text-muted-foreground mt-2 space-y-1.5 border-t pt-2 text-xs">
              {args.prompt ? (
                <pre className="text-muted-foreground whitespace-pre-wrap font-sans text-xs">
                  {args.prompt}
                </pre>
              ) : null}
              {args.model || args.thinking ? (
                <div className="flex flex-wrap gap-1.5">
                  {args.model ? (
                    <span className="bg-muted rounded px-1.5 py-0.5">模型 {args.model}</span>
                  ) : null}
                  {args.thinking ? (
                    <span className="bg-muted rounded px-1.5 py-0.5">思考 {args.thinking}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
        <ToolOutput
          output={resultText ? { summary: resultText } : undefined}
          errorText={toolPart.errorText}
        />
      </ToolContent>

      {/* 子代理会话详情（Kun 返回条语义：进入子会话视图 → 返回主对话） */}
      <Dialog open={detailOpen} onOpenChange={(v) => !v && setDetailOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogTitle className="sr-only">子代理会话详情</DialogTitle>
          <div className="mb-2 flex h-8 items-center gap-2 border-b pb-1">
            <button
              type="button"
              className="hover:bg-accent hover:text-foreground text-muted-foreground flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition"
              title="返回主对话"
              onClick={() => setDetailOpen(false)}
            >
              <ArrowLeft className="size-3.5" />
              返回主对话
            </button>
            <span className="text-muted-foreground truncate text-xs">
              子代理{args.name ? ` · ${args.name}` : ""} {statusText}
            </span>
          </div>
          <div className="space-y-3 overflow-y-auto">
            <div>
              <div className="text-muted-foreground mb-1 text-[11px] font-medium">任务描述</div>
              <div className="text-sm">{args.description || "（未提供描述）"}</div>
            </div>
            {args.prompt ? (
              <div>
                <div className="text-muted-foreground mb-1 text-[11px] font-medium">任务指令</div>
                <pre className="bg-muted/60 rounded-md p-2 text-xs whitespace-pre-wrap">
                  {args.prompt}
                </pre>
              </div>
            ) : null}
            {args.model || args.thinking ? (
              <div className="flex flex-wrap gap-1.5">
                {args.model ? (
                  <span className="bg-muted rounded px-1.5 py-0.5 text-xs">模型 {args.model}</span>
                ) : null}
                {args.thinking ? (
                  <span className="bg-muted rounded px-1.5 py-0.5 text-xs">思考 {args.thinking}</span>
                ) : null}
              </div>
            ) : null}
            <div>
              <div className="text-muted-foreground mb-1 text-[11px] font-medium">执行结果</div>
              {toolPart.errorText ? (
                <div className="text-destructive rounded-md border border-dashed p-2 text-xs">
                  {toolPart.errorText}
                </div>
              ) : resultText ? (
                <pre className="bg-muted/60 max-h-80 overflow-y-auto rounded-md p-2 text-xs whitespace-pre-wrap">
                  {resultText}
                </pre>
              ) : (
                <div className="text-muted-foreground text-xs">（尚未完成）</div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Tool>
  );
});

SubagentCard.displayName = "SubagentCard";