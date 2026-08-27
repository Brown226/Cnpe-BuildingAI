import { Settings2 } from "lucide-react";
import { useState } from "react";

import { useDesktop } from "./desktop-provider";
import { ApprovalCardsHost } from "./approval-cards-host";
import { WorkspaceManagerDialog } from "./workspace-manager-dialog";

/**
 * 桌面客户端全局挂件：审批卡片浮层 + 工作区设置入口。
 * 浏览器（网页版）环境下整个组件返回 null。
 */
export function DesktopShellWidgets() {
    const { desktop, ready } = useDesktop();
    const [managerOpen, setManagerOpen] = useState(false);

    if (!desktop) return null;

    return (
        <>
            <ApprovalCardsHost />
            {ready && (
                <button
                    className="bg-background/90 fixed bottom-4 left-4 z-40 rounded-full border p-2 shadow-md backdrop-blur transition hover:scale-105"
                    title="工作区与安全设置"
                    onClick={() => setManagerOpen(true)}
                >
                    <Settings2 className="size-4" />
                </button>
            )}
            <WorkspaceManagerDialog open={managerOpen} onOpenChange={setManagerOpen} />
        </>
    );
}
