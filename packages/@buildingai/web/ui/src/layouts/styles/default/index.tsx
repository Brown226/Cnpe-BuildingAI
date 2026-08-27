import { SidebarInset, SidebarProvider } from "@buildingai/ui/components/ui/sidebar";
import { Outlet } from "react-router-dom";

import { DefaultAppSidebar } from "./_components/default-sidebar";

export default function DefaultLayout({
  children,
  extraSidebarContent,
}: {
  children?: React.ReactNode;
  /** 注入到默认侧栏的额外分组（桌面端「项目」区等） */
  extraSidebarContent?: React.ReactNode;
}) {
  return (
    <SidebarProvider storageKey="layout-style-default-sidebar">
      <DefaultAppSidebar extraContent={extraSidebarContent} />
      <SidebarInset className="h-dvh overflow-x-hidden">{children || <Outlet />}</SidebarInset>
    </SidebarProvider>
  );
}
