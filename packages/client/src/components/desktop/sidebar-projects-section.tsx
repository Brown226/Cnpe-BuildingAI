/**
 * 侧栏「项目」分组（复刻 Kun SidebarProjectsSection）：
 * 工作区列表 + 归属本地会话（点击回放）；激活工作区自动展开；
 * 行悬停：新对话 / 移除项目。仅桌面环境渲染（经 DefaultLayout 注入）。
 */
import { FolderOpen, FolderPlus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@buildingai/ui/components/ui/sidebar";

import { useDesktop } from "@/components/desktop/desktop-provider";
import {
  deleteThread,
  formatThreadTime,
  listThreadsByWorkspace,
  THREADS_CHANGED_EVENT,
} from "@/services/desktop/thread-store";

export function DesktopProjectsSection() {
  const {
    desktop,
    workspaces,
    selectedWorkspace,
    selectWorkspace,
    addWorkspaceByPicker,
    removeWorkspace,
  } = useDesktop();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handler = () => setVersion((v) => v + 1);
    window.addEventListener(THREADS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(THREADS_CHANGED_EVENT, handler);
  }, []);

  if (!desktop) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="flex items-center justify-between">
        <span>项目</span>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground rounded p-0.5"
          title="添加项目文件夹"
          onClick={() => void addWorkspaceByPicker()}
        >
          <FolderPlus className="size-3.5" />
        </button>
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {workspaces.length === 0 && (
            <div className="text-muted-foreground px-2 py-3 text-xs leading-5">
              还没有项目工作区。
              <br />
              点右上 ➕ 添加文件夹开始。
            </div>
          )}
          {workspaces.map((w) => {
            const active = selectedWorkspace?.id === w.id;
            const threads = listThreadsByWorkspace(w.id);
            return (
              <SidebarMenuItem key={`${w.id}-${version}`}>
                <SidebarMenuButton
                  tooltip={w.name}
                  isActive={active}
                  onClick={() => void selectWorkspace(w)}
                >
                  <FolderOpen />
                  <span className="truncate">{w.name}</span>
                </SidebarMenuButton>
                <SidebarMenuAction
                  showOnHover
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`移除项目「${w.name}」？\n（不会删除磁盘文件，仅移出列表）`)) {
                      void removeWorkspace(w);
                    }
                  }}
                >
                  <X />
                  <span className="sr-only">移除项目</span>
                </SidebarMenuAction>
                {active &&
                  (threads.length > 0 ? (
                    <SidebarMenuSub className="mr-0 pr-0">
                      {threads.slice(0, 10).map((t) => (
                        <SidebarMenuSubItem key={t.id}>
                          <SidebarMenuSubButton
                            isActive={pathname === `/chat/${t.id}`}
                            onClick={() => navigate(`/chat/${t.id}`)}
                            className="h-7"
                          >
                            <span className="line-clamp-1 flex-1 text-xs">{t.title}</span>
                            <span className="text-muted-foreground shrink-0 text-[10px]">
                              {formatThreadTime(t.updatedAt)}
                            </span>
                          </SidebarMenuSubButton>
                          <SidebarMenuAction
                            showOnHover
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteThread(t.id);
                              setVersion((v) => v + 1);
                            }}
                          >
                            <Trash2 />
                            <span className="sr-only">删除会话</span>
                          </SidebarMenuAction>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  ) : (
                    <SidebarMenuSub className="mr-0 pr-0">
                      <div className="text-muted-foreground px-2 py-1 text-[11px]">
                        该工作区还没有会话
                      </div>
                    </SidebarMenuSub>
                  ))}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
