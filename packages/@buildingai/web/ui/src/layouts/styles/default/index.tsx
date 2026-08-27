import { SidebarInset, SidebarProvider } from "@buildingai/ui/components/ui/sidebar";
import { Outlet } from "react-router-dom";

import { DefaultAppSidebar } from "./_components/default-sidebar";

export default function DefaultLayout({
  children,
  extraSidebarContent,
  headerContent,
  rightPanelContent,
}: {
  children?: React.ReactNode;
  /** 注入到默认侧栏的额外分组（桌面端「项目」区等） */
  extraSidebarContent?: React.ReactNode;
  /** 注入到内容区顶部的额外内容（桌面端模式 Tab 等） */
  headerContent?: React.ReactNode;
  /** 注入到内容区右侧的常驻面板（T1.6 三栏：桌面端文件面板等） */
  rightPanelContent?: React.ReactNode;
}) {
  return (
    <SidebarProvider storageKey="layout-style-default-sidebar">
      <DefaultAppSidebar extraContent={extraSidebarContent} />
      <SidebarInset className="h-dvh overflow-x-hidden">
        {headerContent && (
          <div className="flex h-12 shrink-0 items-center border-b px-4">{headerContent}</div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-hidden">{children || <Outlet />}</div>
          {rightPanelContent}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
