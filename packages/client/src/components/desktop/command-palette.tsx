/**
 * 全局命令面板（T2.2，Ctrl+K）：
 * 模式切换 / 新建会话 / 会话搜索（标题+内容）/ 工作区切换 / 视图操作。
 * 快捷键：Ctrl+K 打开，Ctrl+N 新建会话，Ctrl+1/2 切模式（仅桌面端）。
 */
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@buildingai/ui/components/ui/command";
import { FolderOpen, FolderPlus, MessageSquarePlus, Repeat2, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { useDesktop } from "./desktop-provider";
import { desktopApi } from "@/services/desktop/desktop-api";
import { installGlobalKeymap, registerShortcut } from "@/services/desktop/keymap";
import { searchThreads } from "@/services/desktop/thread-store";

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const {
    desktop,
    setMode,
    activeMode,
    workspaces,
    selectWorkspace,
    addWorkspaceByPicker,
    setPanelOpen,
    policyKeys,
  } = useDesktop();
  /** T4.5 策略：不允许多工作区时隐藏"添加工作区"入口 */
  const allowAddWorkspace = policyKeys?.allowMultipleWorkspaces !== false;

  useEffect(() => {
    if (!desktop) return;
    installGlobalKeymap();
    const un1 = registerShortcut("ctrl+k", () => setOpen(true));
    const un2 = registerShortcut("ctrl+n", () => {
      setOpen(false);
      navigate("/chat");
    });
    const un3 = registerShortcut("ctrl+1", () => setMode("code"));
    const un4 = registerShortcut("ctrl+2", () => setMode("work"));
    return () => {
      un1();
      un2();
      un3();
      un4();
    };
  }, [desktop, navigate, setMode]);

  if (!desktop) return null;

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  /** T4.12 桌面会话导出：聚合全部本地会话（meta+messages）→ JSON 下载 */
  const exportSessions = async () => {
    try {
      const { sessions } = await desktopApi.sessionList();
      const exported = {
        exportedAt: new Date().toISOString(),
        sessions: [] as Array<unknown>,
      };
      for (const s of sessions) {
        const detail = await desktopApi.sessionGet(s.id);
        exported.sessions.push({ meta: detail.meta, messages: detail.messages });
      }
      const blob = new Blob([JSON.stringify(exported, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `buildingai-sessions-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${sessions.length} 个会话`);
      close();
    } catch (err) {
      toast.error(`导出失败：${String(err)}`);
    }
  };

  const results = searchThreads(query, { mode: activeMode }).slice(0, 10);

  return (
    <CommandDialog open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
      <CommandInput
        placeholder="输入命令或搜索会话…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>无匹配结果</CommandEmpty>
        {query.trim() === "" && (
          <CommandGroup heading="模式">
            <CommandItem
              onSelect={() => {
                setMode("code");
                close();
              }}
            >
              Code 模式
              <CommandShortcut>Ctrl+1</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setMode("work");
                close();
              }}
            >
              Work 模式
              <CommandShortcut>Ctrl+2</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading={query.trim() ? "搜索结果" : "会话"}>
          {query.trim() === "" && (
            <CommandItem
              onSelect={() => {
                navigate("/chat");
                close();
              }}
            >
              <MessageSquarePlus className="size-3.5" />
              新建会话
              <CommandShortcut>Ctrl+N</CommandShortcut>
            </CommandItem>
          )}
          {results.map((t) => (
            <CommandItem
              key={t.id}
              value={`会话 ${t.title}`}
              onSelect={() => {
                navigate(`/chat/${t.id}`);
                close();
              }}
            >
              <Repeat2 className="size-3.5" />
              {t.title}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="工作区">
          {workspaces.slice(0, 8).map((w) => (
            <CommandItem
              key={w.id}
              value={`工作区 ${w.name}`}
              onSelect={() => {
                void selectWorkspace(w);
                close();
              }}
            >
              <FolderOpen className="size-3.5" />
              切换工作区：{w.name}
            </CommandItem>
          ))}
          {allowAddWorkspace && (
            <CommandItem
              onSelect={() => {
                void addWorkspaceByPicker();
                close();
              }}
            >
              <FolderPlus className="size-3.5" />
              添加工作区…
            </CommandItem>
          )}
        </CommandGroup>
        <CommandGroup heading="视图">
          <CommandItem
            onSelect={() => {
              setPanelOpen(true);
              close();
            }}
          >
            <FolderOpen className="size-3.5" />
            打开文件面板
          </CommandItem>
          <CommandItem onSelect={() => void exportSessions()}>
            <Download className="size-3.5" />
            导出会话数据（JSON）
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
