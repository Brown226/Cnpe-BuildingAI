/**
 * 桌面端右栏（T1.6 三栏布局：左导航 / 中工作区 / 右文件面板）。
 * 作为 DefaultLayout 的 rightPanelContent 注入；开合状态由
 * DesktopProvider 持有（localStorage 持久化）。
 * 面板展开=常驻右栏；折叠后右缘保留小按钮作为重新打开入口。
 */
import { FolderOpen } from "lucide-react";

import { useDesktop } from "./desktop-provider";
import { WorkspaceFilePanel } from "./workspace-file-panel";

export function DesktopRightPanel() {
    const { desktop, panelOpen, setPanelOpen } = useDesktop();
    if (!desktop) return null;

    if (!panelOpen) {
        return (
            <button
                type="button"
                className="bg-background/90 fixed top-1/2 right-2 z-40 -translate-y-1/2 rounded-lg border p-2 shadow-md backdrop-blur transition hover:scale-105"
                title="工作区文件"
                onClick={() => setPanelOpen(true)}
            >
                <FolderOpen className="size-4" />
            </button>
        );
    }

    return <WorkspaceFilePanel embedded open onClose={() => setPanelOpen(false)} />;
}
