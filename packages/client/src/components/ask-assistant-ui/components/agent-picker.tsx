/**
 * 智能体选择器（对齐 Kun FloatingComposerAgentPicker）：
 * 在输入条选择"智能体 persona"，作用于下一条新对话（Default=不带 persona）。
 * 数据源：我的智能体列表（/ai-agents/my-created）。
 */
import { useMyAgentsInfiniteQuery } from "@buildingai/services/web";
import { useAssistantStore } from "@buildingai/stores";
import { Avatar, AvatarFallback, AvatarImage } from "@buildingai/ui/components/ui/avatar";
import { Button } from "@buildingai/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@buildingai/ui/components/ui/dropdown-menu";
import { cn } from "@buildingai/ui/lib/utils";
import { Bot, ChevronDown } from "lucide-react";
import { memo, useMemo } from "react";

export const AgentPicker = memo(function AgentPicker() {
  const composerAgentId = useAssistantStore((s) => s.composerAgentId);
  const setComposerAgentId = useAssistantStore((s) => s.setComposerAgentId);
  const { data } = useMyAgentsInfiniteQuery({ pageSize: 50 });

  const agents = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.items),
    [data],
  );
  const active = agents.find((a) => a.id === composerAgentId);

  if (agents.length === 0) return null;

  const clearAgent = () => setComposerAgentId("");
  const pickAgent = (id: string) => setComposerAgentId(id);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 gap-1 rounded-full px-2 text-xs text-muted-foreground",
            active && "text-foreground",
          )}
          title={active ? `智能体：${active.name}` : "为新对话选择智能体 persona"}
        >
          {active?.avatar ? (
            <Avatar className="size-3.5">
              <AvatarImage src={active.avatar} alt={active.name} />
              <AvatarFallback>{active.name.slice(0, 1)}</AvatarFallback>
            </Avatar>
          ) : (
            <Bot className="size-3.5" />
          )}
          <span className="max-w-[120px] truncate">{active ? active.name : "Default"}</span>
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <div className="text-muted-foreground px-3 py-1.5 text-[10px] tracking-wider uppercase">
          Agent persona
        </div>
        <DropdownMenuItem
          onSelect={clearAgent}
          className={cn(!composerAgentId && "bg-muted")}
        >
          <Bot className="text-muted-foreground size-4" />
          <span className="flex-1">Default (runtime)</span>
        </DropdownMenuItem>
        {agents.map((agent) => (
          <DropdownMenuItem
            key={agent.id}
            onSelect={() => pickAgent(agent.id)}
            className={cn(composerAgentId === agent.id && "bg-muted")}
          >
            {agent.avatar ? (
              <Avatar className="size-3.5 shrink-0">
                <AvatarImage src={agent.avatar} alt={agent.name} />
                <AvatarFallback>{agent.name.slice(0, 1)}</AvatarFallback>
              </Avatar>
            ) : (
              <span className="bg-primary size-3.5 shrink-0 rounded-full" />
            )}
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate">{agent.name}</span>
              {agent.description ? (
                <span className="text-muted-foreground block truncate text-xs">
                  {agent.description}
                </span>
              ) : null}
            </span>
          </DropdownMenuItem>
        ))}
        <div className="text-muted-foreground border-t px-3 py-1.5 text-[11px]">
          应用到下一条新对话
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});