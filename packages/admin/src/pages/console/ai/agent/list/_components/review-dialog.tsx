import type { ConsoleAgentItem } from "@buildingai/services/console";
import {
  useApproveAgentSquareMutation,
  useRejectAgentSquareMutation,
} from "@buildingai/services/console";
import { Button } from "@buildingai/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import { Label } from "@buildingai/ui/components/ui/label";
import { ScrollArea } from "@buildingai/ui/components/ui/scroll-area";
import { Textarea } from "@buildingai/ui/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type ReviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: ConsoleAgentItem | null;
  onSuccess?: () => void;
};

export function ReviewDialog({ open, onOpenChange, agent, onSuccess }: ReviewDialogProps) {
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  const approveMutation = useApproveAgentSquareMutation({
    onSuccess: () => {
      toast.success("已通过审核并自动上架");
      onOpenChange(false);
      onSuccess?.();
    },
  });

  const rejectMutation = useRejectAgentSquareMutation({
    onSuccess: () => {
      toast.success("已拒绝发布");
      onOpenChange(false);
      setShowRejectInput(false);
      setRejectReason("");
      onSuccess?.();
    },
  });

  const handleApprove = () => {
    if (!agent) return;
    approveMutation.mutate(agent.id);
  };

  const handleRejectSubmit = () => {
    if (!agent) return;
    rejectMutation.mutate({ id: agent.id, reason: rejectReason.trim() || undefined });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setShowRejectInput(false);
      setRejectReason("");
    }
    onOpenChange(next);
  };

  const pending = approveMutation.isPending || rejectMutation.isPending;
  const openingQuestions = agent?.openingQuestions ?? [];
  const quickCommands = agent?.quickCommands ?? [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>审核智能体</DialogTitle>
          <DialogDescription>
            {agent ? `「${agent.name}」申请发布到广场，请选择通过或拒绝。` : ""}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-72 rounded-md border md:max-h-[60vh]">
          <div className="space-y-4 p-3">
            <div className="space-y-2">
              <div className="text-sm font-medium">角色设定</div>
              <div className="text-muted-foreground text-sm whitespace-pre-wrap">
                {agent?.rolePrompt?.trim() || "未配置"}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">开场白</div>
              <div className="text-muted-foreground text-sm whitespace-pre-wrap">
                {agent?.openingStatement?.trim() || "未配置"}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">开场问题</div>
              {openingQuestions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {openingQuestions.map((question, index) => (
                    <div
                      key={`${question}-${index}`}
                      className="bg-muted text-muted-foreground rounded-md px-2 py-1 text-xs"
                    >
                      {question}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground text-sm">未配置</div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">快捷指令</div>
              {quickCommands.length > 0 ? (
                <div className="space-y-2">
                  {quickCommands.map((command, index) => (
                    <div key={`${command.name}-${index}`} className="bg-muted/40 rounded-md p-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span>{command.name || `指令 ${index + 1}`}</span>
                        <span className="text-muted-foreground text-xs">
                          {command.replyType === "custom" ? "自定义回复" : "模型回复"}
                        </span>
                      </div>
                      <div className="text-muted-foreground mt-1 text-xs whitespace-pre-wrap">
                        触发词：{command.content?.trim() || "未配置"}
                      </div>
                      {command.replyType === "custom" ? (
                        <div className="text-muted-foreground mt-1 text-xs whitespace-pre-wrap">
                          回复内容：{command.replyContent?.trim() || "未配置"}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground text-sm">未配置</div>
              )}
            </div>
          </div>
        </ScrollArea>
        {showRejectInput && (
          <div className="grid gap-2 py-2">
            <Label htmlFor="reject-reason">拒绝原因（选填）</Label>
            <Textarea
              id="reject-reason"
              placeholder="请输入拒绝原因"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>
        )}
        <DialogFooter className="gap-2">
          {showRejectInput ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setShowRejectInput(false)}
              >
                返回
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={handleRejectSubmit}
              >
                {rejectMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                确认拒绝
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => handleOpenChange(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={() => setShowRejectInput(true)}
              >
                拒绝
              </Button>
              <Button type="button" disabled={pending} onClick={handleApprove}>
                {approveMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                通过
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
