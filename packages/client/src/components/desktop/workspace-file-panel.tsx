/**
 * 工作区右面板（复刻 Kun WorkbenchFileTreeSidePanel 布局）：
 * tab 行「文件 / 预览：<文件名>」；文件页 = 工作区标题行（AZ 排序 + 刷新）
 * + 「筛选已加载文件」 + Recent modified files + 懒加载目录树；
 * 预览页 = 文本内容（512KB 截断）。全部操作经 sidecar 策略层管控。
 */
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  File as FileIcon,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useCallback, useEffect, useState } from "react";

import { desktopApi } from "@/services/desktop/desktop-api";
import { useDesktop } from "./desktop-provider";

type Entry = { name: string; type: "file" | "dir"; size?: number; mtimeMs?: number };
interface RecentFile {
  path: string;
  name: string;
  mtimeMs: number;
  size?: number;
}

const joinPath = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, "")}\\${name}`;
const relFromRoot = (root: string, p: string) =>
  p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]+/, "") : p;

export function WorkspaceFilePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { desktop, selectedWorkspace, refreshWorkspacesSignal } = useDesktop();
  const [tab, setTab] = useState<"files" | "preview">("files");
  const [tree, setTree] = useState<Record<string, Entry[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState("");
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ parent: string; type: "file" | "directory"; value: string } | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null);
  const [preview, setPreview] = useState<{ path: string; text: string; truncated: boolean } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const root = selectedWorkspace?.path ?? null;

  const loadDir = useCallback(async (dir: string) => {
    setLoading((s) => new Set(s).add(dir));
    try {
      const r = await desktopApi.fsList(dir);
      const entries = [...r.entries];
      setTree((t) => ({ ...t, [dir]: entries }));
    } catch (err) {
      toast.error(`读取目录失败：${String(err)}`);
    } finally {
      setLoading((s) => {
        const n = new Set(s);
        n.delete(dir);
        return n;
      });
    }
  }, []);

  const loadRecent = useCallback(async (dir: string) => {
    try {
      const r = await desktopApi.fsRecent(dir, 8);
      setRecent(r.files);
    } catch {
      setRecent([]);
    }
  }, []);

  useEffect(() => {
    if (!open || !root) return;
    setTree({});
    setExpanded(new Set());
    setFilter("");
    setTab("files");
    setPreview(null);
    void loadDir(root);
    void loadRecent(root);
  }, [open, root, refreshWorkspacesSignal, loadDir, loadRecent]);

  if (!desktop || !open || !root) return null;

  const sortedEntries = (dir: string): Entry[] => {
    const list = [...(tree[dir] ?? [])];
    list.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      const cmp = a.name.localeCompare(b.name, "zh-CN");
      return sortAsc ? cmp : -cmp;
    });
    return list;
  };

  const matchEntry = (e: Entry): boolean =>
    !filter.trim() || e.name.toLowerCase().includes(filter.trim().toLowerCase());

  /** 过滤后的目录条目：目录名命中或其子级命中则保留 */
  const filteredEntries = (dir: string): Entry[] => {
    if (!filter.trim()) return sortedEntries(dir);
    const out: Entry[] = [];
    for (const e of sortedEntries(dir)) {
      if (e.type === "file") {
        if (matchEntry(e)) out.push(e);
      } else {
        const childAbs = joinPath(dir, e.name);
        const childHit = matchEntry(e) || filteredEntries(childAbs).length > 0;
        if (childHit) out.push(e);
      }
    }
    return out;
  };

  const toggleDir = (dir: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(dir)) n.delete(dir);
      else n.add(dir);
      return n;
    });
    if (!tree[dir]) void loadDir(dir);
  };

  const openFile = async (path: string) => {
    setPreviewLoading(true);
    setPreview({ path, text: "", truncated: false });
    setTab("preview");
    try {
      const r = await desktopApi.fsRead(path);
      setPreview({ path, text: r.content, truncated: r.truncated });
    } catch (err) {
      setPreview({ path, text: `（无法预览：${String(err)}）`, truncated: false });
    } finally {
      setPreviewLoading(false);
    }
  };

  const withBusy = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      toast.error(String(err));
    }
  };

  const doCreate = async () => {
    if (!creating || !creating.value.trim()) {
      setCreating(null);
      return;
    }
    const target = joinPath(creating.parent, creating.value.trim());
    const parent = creating.parent;
    await withBusy(async () => {
      await desktopApi.fsCreate(target, creating.type);
      toast.success(`已创建：${creating.value.trim()}`);
      setCreating(null);
      await loadDir(parent);
      setExpanded((s) => new Set(s).add(parent));
      void loadRecent(root);
    });
  };

  const doRename = async () => {
    if (!renaming || !renaming.value.trim()) {
      setRenaming(null);
      return;
    }
    const parent = renaming.path.replace(/[\\/][^\\/]+$/, "");
    const oldPath = renaming.path;
    await withBusy(async () => {
      const r = await desktopApi.fsRename(oldPath, renaming.value.trim());
      toast.success("已重命名");
      setRenaming(null);
      await loadDir(parent);
      if (preview?.path === oldPath) setPreview({ ...preview, path: r.path });
      void loadRecent(root);
    });
  };

  const doDelete = (path: string, isDir: boolean) => {
    const parent = path.replace(/[\\/][^\\/]+$/, "");
    void withBusy(async () => {
      if (!window.confirm(`确认删除${isDir ? "目录（含全部内容）" : "文件"}？\n${path}`)) return;
      await desktopApi.fsDelete(path);
      toast.success("已删除");
      await loadDir(parent);
      if (preview?.path === path || (isDir && preview?.path.startsWith(path))) {
        setPreview(null);
        setTab("files");
      }
      void loadRecent(root);
    });
    setMenuFor(null);
  };

  const copyPath = (path: string) => {
    void navigator.clipboard.writeText(path);
    toast.success("路径已复制");
    setMenuFor(null);
  };

  const reveal = async (path: string) => {
    try {
      await invoke("reveal_path", { path });
    } catch (err) {
      toast.error(`打开失败：${String(err)}`);
    }
    setMenuFor(null);
  };

  const renderRows = (dir: string, depth: number): React.ReactNode =>
    filteredEntries(dir).map((e) => {
      const abs = joinPath(dir, e.name);
      const isDir = e.type === "dir";
      const isOpen = expanded.has(abs);
      const busy = loading.has(abs);
      return (
        <div key={abs}>
          <div
            className="group hover:bg-accent/60 flex items-center gap-1 rounded px-1.5 py-1"
            style={{ paddingLeft: depth * 14 + 6 }}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1 text-left"
              onClick={() => (isDir ? toggleDir(abs) : void openFile(abs))}
            >
              {isDir ? (
                <>
                  {busy ? (
                    <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
                  ) : isOpen ? (
                    <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                  )}
                  <FolderOpen className="text-muted-foreground size-3.5 shrink-0" />
                </>
              ) : (
                <>
                  <span className="w-3.5 shrink-0" />
                  <FileIcon className="text-muted-foreground size-3.5 shrink-0" />
                </>
              )}
              <span className="truncate text-[13px]">{e.name}</span>
            </button>
            <div className="relative shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground rounded p-0.5"
                onClick={() => setMenuFor(menuFor === abs ? null : abs)}
              >
                <MoreHorizontal className="size-3.5" />
              </button>
              {menuFor === abs && (
                <div className="bg-popover text-popover-foreground absolute top-full right-0 z-50 mt-1 w-44 overflow-hidden rounded-md border text-[13px] shadow-md">
                  {isDir && (
                    <>
                      <MenuItem icon={<FilePlus className="size-3.5" />} label="新建文件" onClick={() => { setCreating({ parent: abs, type: "file", value: "" }); setMenuFor(null); }} />
                      <MenuItem icon={<FolderPlus className="size-3.5" />} label="新建文件夹" onClick={() => { setCreating({ parent: abs, type: "directory", value: "" }); setMenuFor(null); }} />
                    </>
                  )}
                  <MenuItem icon={<Pencil className="size-3.5" />} label="重命名" onClick={() => { setRenaming({ path: abs, value: e.name }); setMenuFor(null); }} />
                  <MenuItem icon={<Copy className="size-3.5" />} label="复制路径" onClick={() => copyPath(abs)} />
                  <MenuItem icon={<ExternalLink className="size-3.5" />} label="在资源管理器中显示" onClick={() => void reveal(abs)} />
                  <MenuItem icon={<Trash2 className="size-3.5" />} label="删除" danger onClick={() => doDelete(abs, isDir)} />
                </div>
              )}
            </div>
          </div>
          {renaming?.path === abs && (
            <InlineInput
              depth={depth + 1}
              value={renaming.value}
              onChange={(v) => setRenaming({ path: abs, value: v })}
              onConfirm={() => void doRename()}
              onCancel={() => setRenaming(null)}
            />
          )}
          {creating?.parent === abs && (
            <InlineInput
              depth={depth + 1}
              value={creating.value}
              placeholder={creating.type === "file" ? "文件名…" : "文件夹名…"}
              onChange={(v) => setCreating({ ...creating, value: v })}
              onConfirm={() => void doCreate()}
              onCancel={() => setCreating(null)}
            />
          )}
          {isDir && isOpen && renderRows(abs, depth + 1)}
        </div>
      );
    });

  return (
    <div className="bg-background fixed inset-y-0 right-0 z-40 flex w-80 flex-col border-l shadow-lg">
      {/* tab 行：文件 / 预览（Kun 布局） */}
      <div className="flex items-center gap-1 border-b px-2 pt-2">
        <button
          type="button"
          onClick={() => setTab("files")}
          className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1.5 text-sm ${
            tab === "files"
              ? "border-primary font-medium"
              : "text-muted-foreground border-transparent hover:text-foreground"
          }`}
        >
          <FolderOpen className="size-4" />
          文件
        </button>
        {preview && (
          <button
            type="button"
            onClick={() => setTab("preview")}
            className={`flex min-w-0 items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1.5 text-sm ${
              tab === "preview"
                ? "border-primary font-medium"
                : "text-muted-foreground border-transparent hover:text-foreground"
            }`}
          >
            <FileIcon className="size-4 shrink-0" />
            <span className="max-w-32 truncate">{preview.path.replace(/^.*[\\/]/, "")}</span>
            <X
              className="text-muted-foreground size-3 shrink-0 hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                setPreview(null);
                setTab("files");
              }}
            />
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground mb-1 rounded p-1"
          title="关闭面板"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>

      {tab === "files" ? (
        <>
          {/* 工作区标题行：名称 + AZ 排序 + 刷新 */}
          <div className="flex items-center gap-1.5 border-b px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {selectedWorkspace?.name}
            </span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground rounded px-1 py-0.5 text-xs font-medium"
              title={sortAsc ? "当前 A→Z，点击切换 Z→A" : "当前 Z→A，点击切换 A→Z"}
              onClick={() => setSortAsc((v) => !v)}
            >
              {sortAsc ? <ArrowUpAZ className="size-4" /> : <ArrowDownAZ className="size-4" />}
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground rounded p-0.5"
              title="刷新"
              onClick={() => root && void loadDir(root)}
            >
              <RefreshCw className="size-4" />
            </button>
          </div>

          {/* 筛选已加载文件 */}
          <div className="border-b px-3 py-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="筛选已加载文件"
              className="border-input bg-background placeholder:text-muted-foreground h-7 w-full rounded-md border px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {/* Recent modified files */}
            {recent.length > 0 && !filter.trim() && (
              <div className="mb-1 px-2">
                <div className="text-muted-foreground px-1 py-1 text-[11px] font-medium">
                  Recent modified files
                </div>
                {recent.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    className="hover:bg-accent/60 flex w-full items-center gap-1.5 rounded px-1 py-1 text-left"
                    onClick={() => void openFile(f.path)}
                    title={f.path}
                  >
                    <FileIcon className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-[12px]">
                      {relFromRoot(root, f.path)}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-[10px]">
                      {formatMtime(f.mtimeMs)}
                    </span>
                  </button>
                ))}
                <div className="bg-border mx-1 my-1.5 h-px" />
              </div>
            )}

            {/* 根节点 */}
            <div className="group flex items-center gap-1 rounded px-1.5 py-1">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 text-left"
                onClick={() => toggleDir(root)}
              >
                {loading.has(root) ? (
                  <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
                ) : expanded.has(root) ? (
                  <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                )}
                <FolderOpen className="size-3.5 shrink-0" />
                <span className="truncate text-[13px] font-medium">{selectedWorkspace?.name}</span>
              </button>
              <div className="relative shrink-0 opacity-0 group-hover:opacity-100">
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground rounded p-0.5"
                  onClick={() => setMenuFor(menuFor === root ? null : root)}
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
                {menuFor === root && (
                  <div className="bg-popover text-popover-foreground absolute top-full right-0 z-50 mt-1 w-44 overflow-hidden rounded-md border text-[13px] shadow-md">
                    <MenuItem icon={<FilePlus className="size-3.5" />} label="新建文件" onClick={() => { setCreating({ parent: root, type: "file", value: "" }); setMenuFor(null); }} />
                    <MenuItem icon={<FolderPlus className="size-3.5" />} label="新建文件夹" onClick={() => { setCreating({ parent: root, type: "directory", value: "" }); setMenuFor(null); }} />
                    <MenuItem icon={<Copy className="size-3.5" />} label="复制路径" onClick={() => copyPath(root)} />
                    <MenuItem icon={<ExternalLink className="size-3.5" />} label="在资源管理器中显示" onClick={() => void reveal(root)} />
                  </div>
                )}
              </div>
            </div>
            {creating?.parent === root && (
              <InlineInput
                depth={1}
                value={creating.value}
                placeholder={creating.type === "file" ? "文件名…" : "文件夹名…"}
                onChange={(v) => setCreating({ ...creating, value: v })}
                onConfirm={() => void doCreate()}
                onCancel={() => setCreating(null)}
              />
            )}
            {expanded.has(root) && renderRows(root, 1)}
          </div>
        </>
      ) : (
        /* 预览 tab */
        <div className="flex flex-1 flex-col overflow-hidden">
          {previewLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            </div>
          ) : (
            <pre className="flex-1 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">
              {preview?.text || "（空文件）"}
            </pre>
          )}
          {preview?.truncated && (
            <div className="text-muted-foreground border-t px-3 py-1.5 text-[11px]">
              内容过长已截断（512KB 上限）
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatMtime(ms: number): string {
  const d = new Date(ms);
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (d.toDateString() === new Date().toDateString())
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`hover:bg-accent flex w-full items-center gap-2 px-3 py-1.5 text-left ${
        danger ? "text-destructive" : ""
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function InlineInput({
  depth,
  value,
  placeholder,
  onChange,
  onConfirm,
  onCancel,
}: {
  depth: number;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ paddingLeft: depth * 14 + 6 }} className="py-0.5 pr-2">
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm();
          if (e.key === "Escape") onCancel();
        }}
        onBlur={onConfirm}
        className="border-input bg-background h-6 w-full rounded border px-1.5 text-[13px] outline-none"
      />
    </div>
  );
}
