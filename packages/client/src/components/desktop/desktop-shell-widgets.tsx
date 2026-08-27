import { FolderOpen, Settings2 } from "lucide-react";
import { useState } from "react";

import { useDesktop } from "./desktop-provider";
import { ApprovalCardsHost } from "./approval-cards-host";
import { WorkspaceFilePanel } from "./workspace-file-panel";
import { WorkspaceManagerDialog } from "./workspace-manager-dialog";

/**
 * 桌面客户端全局挂件：审批卡片浮层 + 工作区文件面板开关 + 工作区设置入口。
 * 浏览器（网页版）环境下整个组件返回 null。
 */
export function DesktopShellWidgets() {
    const { desktop, ready } = useDesktop();
    const [managerOpen, setManagerOpen] = useState(false);
    const [panelOpen, setPanelOpen] = useState(false);

    if (!desktop) return null;

    return (
        <>
            <ApprovalCardsHost />
            {ready && (
                <>
                    {/* 右缘图标列（Kun 布局）：工作区文件面板开关 */}
                    <button
                        className={`bg-background/90 fixed top-1/2 right-2 z-40 -translate-y-1/2 rounded-lg border p-2 shadow-md backdrop-blur transition hover:scale-105 ${
                            panelOpen ? "text-primary border-primary/40" : ""
                        }`}
                        title="工作区文件"
                        onClick={() => setPanelOpen((v) => !v)}
                    >
                        <FolderOpen className="size-4" />
                    </button>
                    <button
                        className="bg-background/90 fixed bottom-4 left-4 z-40 rounded-full border p-2 shadow-md backdrop-blur transition hover:scale-105"
                        title="工作区与安全设置"
                        onClick={() => setManagerOpen(true)}
                    >
                        <Settings2 className="size-4" />
                    </button>
                </>
            )}
            <WorkspaceFilePanel open={panelOpen} onClose={() => setPanelOpen(false)} />
            <WorkspaceManagerDialog open={managerOpen} onOpenChange={setManagerOpen} />
        </>
    );
}
