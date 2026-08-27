/**
 * 侧栏「项目」分组（一比一复刻 Kun SidebarProjectsSection + SidebarProjectOverlays）：
 * - 工作区右键菜单：新建会话 / 新建目录(虚拟文件夹) / 在资源管理器中打开 /
 *   归档当前项目中的所有会话(带计数确认) / 移除工作区(危险确认)
 * - 会话右键菜单：重命名 / 归档 / 删除；会话可拖入虚拟文件夹
 * - 路径副标题（父目录尾段，Kun 的 E: / .deepseekgui 样式）+ 相对时间（23分钟）
 * - 折叠状态持久化
 */
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Columns2,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  Pencil,
  Pin,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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

import { desktopApi } from "@/services/desktop/desktop-api";
import { useDesktop } from "@/components/desktop/desktop-provider";
import {
  archiveThread,
  archiveWorkspaceThreads,
  createFolder,
  deleteFolder,
  deleteThread,
  formatThreadTime,
  listFolders,
  listThreadsByWorkspace,
  loadExpanded,
  moveThreadToFolder,
  pinThread,
  renameFolder,
  renameThread,
  reorderThreads,
  saveExpanded,
  searchThreads,
  type LocalThread,
} from "@/services/desktop/thread-store";
import { setSplitSessionId } from "@/services/desktop/split-store";
import type { WorkspaceEntry } from "@/services/desktop/workspace-types";

type MenuState = {
  x: number;
  y: number;
  kind: "workspace" | "thread" | "folder";
  workspace: WorkspaceEntry;
  thread?: LocalThread;
  folderId?: string;
  folderName?: string;
} | null;

const parentTail = (p: string): string => {
  const parent = p.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]+$/, "");
  const tail = parent.split(/[\\/]/).pop();
  return tail ?? parent;
};

export function DesktopProjectsSection() {
  const {
    desktop,
    workspaces,
    selectedWorkspace,
    selectWorkspace,
    addWorkspaceByPicker,
    removeWorkspace,
    activeMode,
    policyKeys,
  } = useDesktop();
  /** T4.5 策略：不允许多工作区时隐藏"添加工作区"入口 */
  const allowAddWorkspace = policyKeys?.allowMultipleWorkspaces !== false;
  const navigate = useNavigate();
  const [version, setVersion] = useState(0);
  const [menu, setMenu] = useState<MenuState>(null);
  const [expandedIds, setExpandedIds] = useState<string[]>(() => loadExpanded());
  const [dragThread, setDragThread] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const bump = () => setVersion((v) => v + 1);

  useEffect(() => {
    const handler = () => bump();
    window.addEventListener("huashu:threads-changed", handler);
    return () => window.removeEventListener("huashu:threads-changed", handler);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  if (!desktop) return null;

  const openMenu = (e: React.MouseEvent, kind: NonNullable<MenuState>["kind"], w: WorkspaceEntry, extra?: { thread?: LocalThread; folderId?: string; folderName?: string }) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      kind,
      workspace: w,
      thread: extra?.thread,
      folderId: extra?.folderId,
      folderName: extra?.folderName,
      x: Math.min(e.clientX, window.innerWidth - 230),
      y: Math.min(e.clientY, window.innerHeight - 240),
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((ids) => {
      const next = ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id];
      saveExpanded(next);
      return next;
    });
  };

  /** Kun「新建会话」：先巡检目录存在（workspace-availability 语义） */
  const newThreadIn = async (w: WorkspaceEntry) => {
    try {
      await desktopApi.fsList(w.path);
    } catch (err) {
      toast.error(`工作区目录不可用：${w.path}`, { description: String(err) });
      return;
    }
    await selectWorkspace(w);
    navigate("/chat");
  };

  const newFolderIn = (w: WorkspaceEntry) => {
    const name = window.prompt("新建目录名称：", "新建目录");
    if (name?.trim()) {
      createFolder(w.id, name);
      bump();
    }
  };

  const archiveAllIn = (w: WorkspaceEntry) => {
    const count = listThreadsByWorkspace(w.id, activeMode).length;
    if (count === 0) return;
    if (window.confirm(`归档「${w.name}」中的所有会话？\n\n将归档 ${count} 个会话。归档后将从列表隐藏。`)) {
      archiveWorkspaceThreads(w.id, activeMode);
      bump();
    }
  };

  const removeWorkspaceConfirm = (w: WorkspaceEntry) => {
    if (
      window.confirm(
        `移除工作区「${w.name}」？\n\n不会删除磁盘上的文件，仅从列表移除；其下会话记录将被清出侧栏。`,
      )
    ) {
      void removeWorkspace(w);
    }
  };

  const openInSystem = async (path: string) => {
    try {
      await desktopApi.revealPath(path);
    } catch (err) {
      toast.error(`打开失败：${String(err)}`);
    }
  };

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="flex items-center justify-between">
        <span>项目</span>
        {allowAddWorkspace && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground rounded p-0.5"
            title="添加项目文件夹"
            onClick={() => void addWorkspaceByPicker()}
          >
            <FolderPlus className="size-3.5" />
          </button>
        )}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        {/* T2.1 全文搜索（标题 + 消息内容，按当前模式过滤） */}
        <div className="relative px-2 pb-1.5">
          <Search className="text-muted-foreground absolute top-1/2 left-3.5 size-3 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话（标题/内容）"
            className="border-input bg-background placeholder:text-muted-foreground h-7 w-full rounded-md border pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {query.trim() !== "" && (
          <div className="px-2 pb-2">
            {searchThreads(query, { mode: activeMode }).length === 0 ? (
              <div className="text-muted-foreground px-1 py-2 text-[11px]">无匹配会话</div>
            ) : (
              <div className="flex flex-col gap-px">
                {searchThreads(query, { mode: activeMode })
                  .slice(0, 20)
                  .map((t) => (
                    <ThreadRow
                      key={t.id}
                      thread={t}
                      depth={0}
                      onOpen={() => navigate(`/chat/${t.id}`)}
                      onContextMenu={(e) => openMenu(e, "thread", { id: t.workspaceId ?? "", name: "" } as WorkspaceEntry, { thread: t })}
                      onDragStart={() => undefined}
                    />
                  ))}
              </div>
            )}
          </div>
        )}
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
            const expanded = expandedIds.includes(w.id) || active;
            const folders = listFolders(w.id);
            const rootThreads = listThreadsByWorkspace(w.id, activeMode).filter((t) => !t.folderId);
            return (
              <SidebarMenuItem key={w.id}>
                <SidebarMenuButton
                  tooltip={`${w.name} · ${w.path}`}
                  isActive={active}
                  onClick={() => {
                    void selectWorkspace(w);
                    toggleExpand(w.id);
                  }}
                  onContextMenu={(e) => openMenu(e, "workspace", w)}
                >
                  <button
                    type="button"
                    className="absolute left-1 z-10 rounded p-0.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(w.id);
                    }}
                  >
                    {expanded ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                  </button>
                  <FolderOpen className="ml-3" />
                  <span className="truncate">{w.name}</span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
                    {parentTail(w.path)}
                  </span>
                </SidebarMenuButton>

                {expanded && (
                  <SidebarMenuSub className="mr-0 pr-0">
                    {/* 虚拟文件夹 */}
                    {folders.map((f) => {
                      const folderThreads = listThreadsByWorkspace(w.id, activeMode).filter(
                        (t) => t.folderId === f.id,
                      );
                      return (
                        <SidebarMenuSubItem
                          key={f.id}
                          onDragOver={(e) => {
                            if (dragThread) e.preventDefault();
                          }}
                          onDrop={() => {
                            if (dragThread) {
                              moveThreadToFolder(dragThread, f.id);
                              setDragThread(null);
                              bump();
                            }
                          }}
                        >
                          <SidebarMenuSubButton className="h-6 font-medium">
                            <FolderOpen className="size-3" />
                            <span className="line-clamp-1 flex-1 text-xs">{f.name}</span>
                          </SidebarMenuSubButton>
                          <SidebarMenuAction
                            showOnHover
                            onClick={(e) => {
                              e.stopPropagation();
                              openMenu(e, "folder", w, { folderId: f.id, folderName: f.name });
                            }}
                          >
                            <Pencil />
                            <span className="sr-only">文件夹菜单</span>
                          </SidebarMenuAction>
                          <SidebarMenuSub>
                            {folderThreads.map((t) => (
                              <ThreadRow
                                key={t.id}
                                thread={t}
                                depth={1}
                                onOpen={() => navigate(`/chat/${t.id}`)}
                                onContextMenu={(e) => openMenu(e, "thread", w, { thread: t })}
                                onDragStart={() => setDragThread(t.id)}
                                onDrop={() => {
                                  if (!dragThread || dragThread === t.id) return setDragThread(null);
                                  const ids = folderThreads.map((x) => x.id);
                                  const from = ids.indexOf(dragThread);
                                  const to = ids.indexOf(t.id);
                                  if (from >= 0 && to >= 0) {
                                    ids.splice(from, 1);
                                    ids.splice(to, 0, dragThread);
                                    reorderThreads(ids);
                                    bump();
                                  }
                                  setDragThread(null);
                                }}
                              />
                            ))}
                            {folderThreads.length === 0 && (
                              <div className="text-muted-foreground px-2 py-0.5 text-[11px]">
                                拖入会话归组
                              </div>
                            )}
                          </SidebarMenuSub>
                        </SidebarMenuSubItem>
                      );
                    })}

                    {/* 根会话 */}
                    {rootThreads.map((t) => (
                      <ThreadRow
                        key={t.id}
                        thread={t}
                        depth={0}
                        onOpen={() => navigate(`/chat/${t.id}`)}
                        onContextMenu={(e) => openMenu(e, "thread", w, { thread: t })}
                        onDragStart={() => setDragThread(t.id)}
                        onDrop={() => {
                          if (!dragThread || dragThread === t.id) return setDragThread(null);
                          const ids = rootThreads.map((x) => x.id);
                          const from = ids.indexOf(dragThread);
                          const to = ids.indexOf(t.id);
                          if (from >= 0 && to >= 0) {
                            ids.splice(from, 1);
                            ids.splice(to, 0, dragThread);
                            reorderThreads(ids);
                            bump();
                          }
                          setDragThread(null);
                        }}
                      />
                    ))}
                    {rootThreads.length === 0 && folders.length === 0 && (
                      <div className="text-muted-foreground px-2 py-1 text-[11px]">
                        该工作区还没有会话
                      </div>
                    )}
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        className="text-muted-foreground h-6 cursor-pointer text-[11px]"
                        onClick={() => void newThreadIn(w)}
                      >
                        <Plus className="size-3" />
                        新建会话
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>

      {/* 右键菜单（工作区 / 会话 / 文件夹） */}
      {menu && (
        <div
          role="menu"
          className="bg-popover text-popover-foreground fixed z-[100] min-w-56 rounded-lg border p-1 text-[13px] shadow-lg"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {menu.kind === "workspace" && (
            <>
              <MenuRow
                icon={<Plus className="size-3.5" />}
                label="新建会话"
                onClick={() => {
                  setMenu(null);
                  void newThreadIn(menu.workspace);
                }}
              />
              <MenuRow
                icon={<FolderPlus className="size-3.5" />}
                label="新建目录"
                onClick={() => {
                  setMenu(null);
                  newFolderIn(menu.workspace);
                }}
              />
              <MenuRow
                icon={<ExternalLink className="size-3.5" />}
                label="在资源管理器中打开"
                onClick={() => {
                  setMenu(null);
                  void openInSystem(menu.workspace.path);
                }}
              />
              <MenuRow
                icon={<Archive className="size-3.5" />}
                label={`归档当前项目中的所有会话${
                  listThreadsByWorkspace(menu.workspace.id, activeMode).length
                    ? `（${listThreadsByWorkspace(menu.workspace.id, activeMode).length}）`
                    : ""
                }`}
                disabled={listThreadsByWorkspace(menu.workspace.id, activeMode).length === 0}
                onClick={() => {
                  setMenu(null);
                  archiveAllIn(menu.workspace);
                }}
              />
              <div className="bg-border my-1 h-px" />
              <MenuRow
                icon={<Trash2 className="size-3.5" />}
                label="移除工作区"
                danger
                onClick={() => {
                  setMenu(null);
                  removeWorkspaceConfirm(menu.workspace);
                }}
              />
            </>
          )}
          {menu.kind === "thread" && menu.thread && (
            <>
              <MenuRow
                icon={<Pin className="size-3.5" />}
                label={menu.thread.pinned ? "取消置顶" : "置顶"}
                onClick={() => {
                  pinThread(menu.thread!.id, !menu.thread!.pinned);
                  bump();
                  setMenu(null);
                }}
              />
              <MenuRow
                icon={<Columns2 className="size-3.5" />}
                label="在分屏中打开"
                onClick={() => {
                  setSplitSessionId(menu.thread!.id);
                  setMenu(null);
                }}
              />
              <MenuRow
                icon={<Pencil className="size-3.5" />}
                label="重命名"
                onClick={() => {
                  const name = window.prompt("重命名会话：", menu.thread!.title);
                  if (name?.trim()) {
                    renameThread(menu.thread!.id, name);
                    bump();
                  }
                  setMenu(null);
                }}
              />
              <MenuRow
                icon={<Archive className="size-3.5" />}
                label="归档"
                onClick={() => {
                  archiveThread(menu.thread!.id);
                  bump();
                  setMenu(null);
                }}
              />
              <div className="bg-border my-1 h-px" />
              <MenuRow
                icon={<Trash2 className="size-3.5" />}
                label="删除会话"
                danger
                onClick={() => {
                  if (window.confirm(`删除会话「${menu.thread!.title}」？`)) {
                    deleteThread(menu.thread!.id);
                    bump();
                  }
                  setMenu(null);
                }}
              />
            </>
          )}
          {menu.kind === "folder" && (
            <>
              <MenuRow
                icon={<Pencil className="size-3.5" />}
                label="重命名目录"
                onClick={() => {
                  const name = window.prompt("重命名目录：", menu.folderName ?? "");
                  if (name?.trim()) {
                    renameFolder(menu.workspace.id, menu.folderId!, name);
                    bump();
                  }
                  setMenu(null);
                }}
              />
              <MenuRow
                icon={<Trash2 className="size-3.5" />}
                label="删除目录"
                danger
                onClick={() => {
                  deleteFolder(menu.workspace.id, menu.folderId!);
                  bump();
                  setMenu(null);
                }}
              />
            </>
          )}
        </div>
      )}
    </SidebarGroup>
  );
}

function ThreadRow({
  thread,
  depth,
  onOpen,
  onContextMenu,
  onDragStart,
  onDrop,
}: {
  thread: LocalThread;
  depth: number;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: () => void;
  /** T2.1 拖拽排序：拖到本行时触发重排 */
  onDrop?: () => void;
}) {
  return (
    <SidebarMenuSubItem
      draggable
      onDragStart={() => onDragStart()}
      onDragOver={(e) => {
        if (onDrop) e.preventDefault();
      }}
      onDrop={(e) => {
        if (onDrop) {
          e.preventDefault();
          onDrop();
        }
      }}
      style={depth > 0 ? { paddingLeft: 14 } : undefined}
    >
      <SidebarMenuSubButton onClick={onOpen} onContextMenu={onContextMenu} className="h-7">
        {thread.pinned && <Pin className="text-primary size-3 shrink-0 fill-current" />}
        {thread.unread && (
          <span className="bg-primary size-1.5 shrink-0 rounded-full" title="未读" />
        )}
        <span className="line-clamp-1 flex-1 text-xs">{thread.title}</span>
        <span className="text-muted-foreground shrink-0 text-[10px]">
          {formatThreadTime(thread.updatedAt)}
        </span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`hover:bg-accent flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? "text-destructive" : ""
      }`}
    >
      {icon}
      <span className="flex-1">{label}</span>
    </button>
  );
}
