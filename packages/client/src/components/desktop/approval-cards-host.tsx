import { Badge } from "@buildingai/ui/components/ui/badge";
import { Button } from "@buildingai/ui/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@buildingai/ui/components/ui/card";
import { ScrollArea } from "@buildingai/ui/components/ui/scroll-area";

import { useDesktop } from "./desktop-provider";

const KIND_LABEL: Record<string, string> = {
    command: "执行命令",
    file_write: "写入文件",
    file_delete: "删除文件",
};

/**
 * 审批卡片浮层（ADR-06）：策略判定为 require_approval 的操作
 * 由 sidecar 推送到此处，用户允许/拒绝后经 IPC 回写。
 * 卡片在屏幕右下角堆叠，仅桌面客户端环境渲染。
 */
export function ApprovalCardsHost() {
    const { desktop, pendingApprovals, respond } = useDesktop();

    if (!desktop || pendingApprovals.length === 0) return null;

    return (
        <div className="fixed right-4 bottom-4 z-50 flex w-[380px] flex-col gap-3">
            {pendingApprovals.map((req) => (
                <Card key={req.requestId} className="border-warning/40 shadow-lg">
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-sm">
                                需要你的确认：{KIND_LABEL[req.kind] ?? req.kind}
                            </CardTitle>
                            <Badge variant="secondary">等待审批</Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-2 pb-2">
                        <p className="truncate font-mono text-xs" title={req.target}>
                            {req.target}
                        </p>
                        {"cwd" in req.detail && typeof req.detail.cwd === "string" && (
                            <p className="text-muted-foreground truncate text-xs">目录：{req.detail.cwd}</p>
                        )}
                        {"beforePreview" in req.detail && String(req.detail.beforePreview) !== "(新建)" && (
                            <ScrollArea className="bg-muted max-h-24 rounded p-2 font-mono text-xs whitespace-pre-wrap">
                                {String(req.detail.beforePreview)}
                            </ScrollArea>
                        )}
                        {"afterPreview" in req.detail && (
                            <ScrollArea className="bg-primary/5 max-h-24 rounded p-2 font-mono text-xs whitespace-pre-wrap">
                                {String(req.detail.afterPreview)}
                            </ScrollArea>
                        )}
                    </CardContent>
                    <CardFooter className="flex gap-2 pt-0">
                        <Button size="sm" onClick={() => respond(req.requestId, true)}>
                            允许
                        </Button>
                        <Button
                            size="sm"
                            variant="secondary"
                            title="本次会话中同类操作不再询问"
                            onClick={() => respond(req.requestId, true, undefined, true)}
                        >
                            总是允许
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => respond(req.requestId, false, "已拒绝本次操作")}
                        >
                            拒绝
                        </Button>
                    </CardFooter>
                </Card>
            ))}
        </div>
    );
}
