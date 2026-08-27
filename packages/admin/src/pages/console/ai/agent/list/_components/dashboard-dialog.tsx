import type { ConsoleAgentItem } from "@buildingai/services/console";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import { ScrollArea } from "@buildingai/ui/components/ui/scroll-area";

import { AgentDashboardPanel } from "@/pages/console/ai/agent/list/_components/agent-dashboard-panel";

type DashboardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: ConsoleAgentItem | null;
};

export function DashboardDialog({ open, onOpenChange, agent }: DashboardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl!">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle>{agent ? `${agent.name} · 数据统计` : "数据统计"}</DialogTitle>
          <DialogDescription>查看当前智能体的对话、Token、反馈与标注等监控数据。</DialogDescription>
        </DialogHeader>
        {open && agent ? (
          <ScrollArea className="max-h-[70vh] min-h-0 flex-1 pb-2">
            <AgentDashboardPanel agentId={agent.id} source="console" showTitle={false} />
          </ScrollArea>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
