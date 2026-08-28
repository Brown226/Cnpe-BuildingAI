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
import { cn } from "@buildingai/ui/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
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
  const args = parseArgs(toolPart);
  const resultText =
    typeof toolPart.output?.summary === "string" ? toolPart.output.summary : "";

  return (
    <Tool>
      <ToolHeader
        state={toolPart.state as never}
        title={`子代理${args.name ? ` · ${args.name}` : ""}`}
        type="tool-invocation"
      />
      <ToolContent>
        <div className="not-prose rounded-md border p-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-start gap-2 text-left"
          >
            {expanded ? (
              <ChevronDown className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
            ) : (
              <ChevronRight className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
            )}
            <span className={cn("min-w-0 flex-1 text-sm", !expanded && "line-clamp-2")}>
              {args.description || args.prompt || "子代理任务"}
            </span>
            {getStatusBadge(toolPart.state as never)}
          </button>
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
    </Tool>
  );
});

SubagentCard.displayName = "SubagentCard";