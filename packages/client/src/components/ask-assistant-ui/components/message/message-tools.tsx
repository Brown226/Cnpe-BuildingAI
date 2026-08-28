import type { UIMessage } from "ai";
import { memo, useMemo, useState } from "react";

import { useOptionalAssistantContext } from "../../context";
import { GenericTool } from "../tools/generic-tool";
import { ImageGenerationTool } from "../tools/image-generation-tool";
import { KnowledgeReferences } from "../tools/knowledge-references";
import { PlanTool } from "../tools/plan-tool";
import { WeatherTool } from "../tools/weather-tool";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";

interface ToolPartData {
  toolCallId: string;
  state: string;
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
  approval?: { id?: string; approved?: boolean };
}

/** 工具分类（对齐 Kun summarizeProcessWork 的 toolKind，适配 BuildingAI 工具名） */
function toolClass(toolName: string): string {
  if (["list_dir", "read_file"].includes(toolName)) return "读文件";
  if (["write_file", "export_docx", "export_xlsx"].includes(toolName)) return "写文件";
  if (["execute"].includes(toolName)) return "执行命令";
  if (toolName.startsWith("browser_")) return "浏览器";
  if (["parse_document"].includes(toolName)) return "解析文档";
  return "工具";
}

function summarizeParts(parts: ToolPartData[]): string {
  const counts = new Map<string, number>();
  for (const p of parts) {
    const name = (p as { toolName?: string }).toolName ?? "tool";
    const cls = toolClass(name);
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, n]) => `${k} ×${n}`).join(" · ");
}

/** 把工具 part 列表按「连续 dynamic tool」分组，非 dynamic tool 单独成组 */
function groupToolParts(parts: UIMessage["parts"]): Array<{ key: string; parts: ToolPartData[] }> {
  const groups: Array<{ key: string; parts: ToolPartData[] }> = [];
  let current: ToolPartData[] | null = null;
  for (const part of parts) {
    const p = part as unknown as { type?: string } & ToolPartData;
    const isDynamic = p.type === "dynamic-tool";
    if (isDynamic) {
      if (!current) current = [];
    } else {
      if (current && current.length > 0) {
        groups.push({ key: `dynamic-${groups.length}`, parts: current });
        current = null;
      }
      groups.push({ key: `single-${groups.length}`, parts: [p as ToolPartData] });
      continue;
    }
    current!.push(p as ToolPartData);
  }
  if (current && current.length > 0) {
    groups.push({ key: `dynamic-${groups.length}`, parts: current });
  }
  return groups;
}

export interface MessageToolsProps {
  parts: UIMessage["parts"];
  addToolApprovalResponse?: (args: { id: string; approved: boolean; reason?: string }) => void;
}

const renderSinglePart = (
  part: ToolPartData & { type?: string },
  addToolApprovalResponse: MessageToolsProps["addToolApprovalResponse"],
  showReference: boolean,
  showMcpToolDetails: boolean,
  allParts: UIMessage["parts"],
) => {
  const key = part.toolCallId || "tool";
  if (part.type === "tool-datasetsSearch" && showReference) {
    const output = part.output as { found?: boolean; results?: unknown[] } | undefined;
    if (output?.found && Array.isArray(output.results) && output.results.length > 0) {
      return <KnowledgeReferences key={key} toolPart={{ output: output.results }} />;
    }
    return null;
  }
  if (part.type === "tool-getInformation" && showReference) {
    const output = part.output;
    if (Array.isArray(output) && output.length > 0) {
      return <KnowledgeReferences key={key} toolPart={part} />;
    }
    return null;
  }
  if ("output" in part && Array.isArray(part.output) && part.output.length > 0) return null;
  if (part.type === "tool-getWeather") {
    return <WeatherTool key={key} toolPart={part} addToolApprovalResponse={addToolApprovalResponse} />;
  }
  if (part.type === "tool-request_execution_plan") {
    const planningParts = allParts.filter(
      (p) =>
        p &&
        typeof p === "object" &&
        "type" in p &&
        (p as { type: string }).type === "data-planning-status",
    ) as Array<{ type: string; data?: { phase?: string; planPreview?: string } }>;
    const planningStatus =
      planningParts.length > 0 ? planningParts[planningParts.length - 1].data : undefined;
    return (
      <PlanTool
        key={key}
        toolPart={part}
        planningStatus={
          planningStatus
            ? { phase: planningStatus.phase ?? "", planPreview: planningStatus.planPreview }
            : undefined
        }
      />
    );
  }
  if (
    part.type === "tool-dalle2ImageGeneration" ||
    part.type === "tool-dalle3ImageGeneration" ||
    part.type === "tool-gptImageGeneration"
  ) {
    return <ImageGenerationTool key={key} toolPart={part} addToolApprovalResponse={addToolApprovalResponse} />;
  }
  const toolName =
    part.type === "dynamic-tool"
      ? ((part as unknown as { toolName?: string }).toolName ?? "tool")
      : (part.type as string).replace("tool-", "");
  return <GenericTool key={key} toolName={toolName} toolPart={part} showDetails={showMcpToolDetails} />;
};

export const MessageTools = memo(function MessageTools({
  parts,
  addToolApprovalResponse,
}: MessageToolsProps) {
  const ctx = useOptionalAssistantContext();
  const showReference = ctx?.showReference ?? true;
  const showMcpToolDetails = ctx?.showMcpToolDetails ?? true;
  const toolParts = parts.filter(
    (part) =>
      typeof part.type === "string" &&
      (part.type.startsWith("tool-") || part.type === "dynamic-tool"),
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const groups = useMemo(() => groupToolParts(toolParts), [toolParts]);

  if (toolParts.length === 0) return null;

  return (
    <>
      {groups.map((group) => {
        const isDynamicGroup = group.parts.length > 1 && group.parts.every((p) => (p as { type?: string }).type === "dynamic-tool");
        if (isDynamicGroup) {
          const isOpen = expanded.has(group.key);
          return (
            <div key={group.key} className="not-prose mb-4 w-full rounded-md border">
              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.key)) next.delete(group.key);
                    else next.add(group.key);
                    return next;
                  })
                }
                className="flex w-full items-center gap-2 p-3 text-sm"
              >
                {isOpen ? <ChevronDown className="text-muted-foreground size-4" /> : <ChevronRight className="text-muted-foreground size-4" />}
                <Wrench className="text-muted-foreground size-4" />
                <span className="text-muted-foreground font-medium">{summarizeParts(group.parts)}</span>
              </button>
              {isOpen && (
                <div className="border-t p-2">
                  {group.parts.map((p) =>
                    renderSinglePart(p as ToolPartData & { type?: string }, addToolApprovalResponse, showReference, showMcpToolDetails, parts),
                  )}
                </div>
              )}
            </div>
          );
        }
        return group.parts.map((p) =>
          renderSinglePart(p as ToolPartData & { type?: string }, addToolApprovalResponse, showReference, showMcpToolDetails, parts),
        );
      })}
    </>
  );
});
