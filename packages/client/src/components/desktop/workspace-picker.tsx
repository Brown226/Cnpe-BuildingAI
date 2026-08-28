/**
 * Composer 工作区切换器（复刻 Kun WorkspaceProjectPicker）：
 * 当前项 + 记忆列表（>5 出搜索框）+ 底部"添加文件夹"（系统目录框）。
 * 挂载在输入区上方（Kun FloatingComposerSurfaceView 同位）。仅桌面渲染。
 */
import { ChevronDown, FolderOpen, FolderPlus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useDesktop } from "./desktop-provider";
import { parentDir } from "@/services/desktop/workspace-store";

export function WorkspacePicker() {
    const { desktop, workspaces, selectedWorkspace, addWorkspaceByPicker, selectWorkspace } =
        useDesktop();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as globalThis.Node)) {
                setOpen(false);
            }
        };
        window.addEventListener("mousedown", onDown);
        return () => window.removeEventListener("mousedown", onDown);
    }, [open]);

    if (!desktop) return null;

    const filtered = query.trim()
        ? workspaces.filter((w) => w.path.toLowerCase().includes(query.trim().toLowerCase()))
        : workspaces;
    const showSearch = workspaces.length > 5;

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="border-input bg-background hover:bg-accent flex h-7 max-w-64 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors"
                title={selectedWorkspace?.path ?? "选择工作区"}
            >
                <FolderOpen className="text-muted-foreground size-3.5 shrink-0" />
                <span className="truncate">
                    {selectedWorkspace ? selectedWorkspace.name : "选择工作区"}
                </span>
                <ChevronDown className="text-muted-foreground size-3 shrink-0" />
            </button>

            {open && (
                <div className="bg-popover text-popover-foreground absolute bottom-full left-0 z-50 mb-1.5 w-80 overflow-hidden rounded-lg border shadow-md">
                    {showSearch && (
                        <div className="flex items-center gap-2 border-b px-3 py-2">
                            <Search className="text-muted-foreground size-3.5" />
                            <input
                                autoFocus
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="搜索工作区…"
                                className="placeholder:text-muted-foreground w-full bg-transparent text-sm outline-none"
                            />
                        </div>
                    )}
                    <div className="max-h-72 overflow-y-auto py-1">
                        {filtered.length === 0 && (
                            <div className="text-muted-foreground px-3 py-6 text-center text-sm">
                                {workspaces.length === 0
                                    ? "还没有工作区，添加一个文件夹开始"
                                    : "没有匹配的工作区"}
                            </div>
                        )}
                        {filtered.map((w) => {
                            const selected = selectedWorkspace?.id === w.id;
                            return (
                                <button
                                    key={w.id}
                                    type="button"
                                    onClick={() => {
                                        setOpen(false);
                                        setQuery("");
                                        void selectWorkspace(w);
                                    }}
                                    className="hover:bg-accent flex w-full items-center gap-2.5 px-3 py-2 text-left"
                                >
                                    <FolderOpen className="text-muted-foreground size-4 shrink-0" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">
                                            {w.name}
                                        </span>
                                        <span className="text-muted-foreground block truncate text-xs">
                                            {parentDir(w.path)}
                                        </span>
                                    </span>
                                    {selected && (
                                        <span className="text-primary shrink-0 text-xs">当前</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    <div className="border-t py-1">
                        <button
                            type="button"
                            onClick={() => {
                                setOpen(false);
                                void addWorkspaceByPicker();
                            }}
                            className="hover:bg-accent flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm"
                        >
                            <FolderPlus className="size-4" />
                            添加文件夹…
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
