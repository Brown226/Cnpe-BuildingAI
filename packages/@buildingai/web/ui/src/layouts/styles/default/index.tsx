import { SidebarInset, SidebarProvider } from "@buildingai/ui/components/ui/sidebar";
import { useCallback, useState } from "react";
import { Outlet } from "react-router-dom";

import { DefaultAppSidebar } from "./_components/default-sidebar";

const SIDEBAR_WIDTH_KEY = "huashu.desktop.sidebarWidth.v1";
const MIN_WIDTH = 224;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 256;

function loadSidebarWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  try {
    const w = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (!Number.isFinite(w)) return DEFAULT_WIDTH;
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));
  } catch {
    return DEFAULT_WIDTH;
  }
}

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
  const [sidebarWidth, setSidebarWidth] = useState<number>(loadSidebarWidth);

  /** 侧栏右缘拖拽把手（对齐 Kun beginLeftResize：clamp 224..480 并持久化） */
  const startSidebarDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const move = (ev: PointerEvent) => {
      const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(startW + (ev.clientX - startX))));
      setSidebarWidth(clamped);
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
      } catch {
        /* 忽略存储失败 */
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [sidebarWidth]);

  return (
    <SidebarProvider
      storageKey="layout-style-default-sidebar"
      style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      <DefaultAppSidebar extraContent={extraSidebarContent} />
      <SidebarInset className="h-dvh overflow-x-hidden">
        {headerContent && (
          <div className="flex h-12 shrink-0 items-center border-b px-4">{headerContent}</div>
        )}
        <div className="relative flex min-h-0 flex-1">
          {/* 侧栏宽度拖拽把手（对齐 Kun；移动端侧栏为浮层，隐藏） */}
          <div
            className="hover:bg-primary/40 absolute inset-y-0 left-0 z-30 hidden w-1 cursor-col-resize md:block"
            onPointerDown={startSidebarDrag}
            title="拖动调整侧栏宽度"
          />
          <div className="min-w-0 flex-1 overflow-hidden">{children || <Outlet />}</div>
          {rightPanelContent}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
