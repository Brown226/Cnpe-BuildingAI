/**
 * composer Git 分支选择器（对齐 Kun FloatingComposer 工作区行的 GitBranchPicker）：
 * 仅 Code 模式 + 当前工作区为 git 仓库时显示；切换经 exec.run 走策略层（与 git-panel 同源）。
 */
import { GitBranch, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDesktop } from "@/components/desktop/desktop-provider";
import { desktopApi } from "@/services/desktop/desktop-api";

export function GitBranchPicker() {
    const { desktop, selectedWorkspace, activeMode } = useDesktop();
    const root = selectedWorkspace?.path ?? null;

    const [available, setAvailable] = useState(false);
    const [branch, setBranch] = useState("");
    const [branches, setBranches] = useState<string[]>([]);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    const refresh = useCallback(async () => {
        if (!root) {
            setAvailable(false);
            return;
        }
        try {
            const cur = await desktopApi.execRun("git branch --show-current", root);
            if (cur.exitCode !== 0 || !cur.stdout?.trim()) {
                setAvailable(false);
                return;
            }
            const list = await desktopApi.execRun("git branch --format=%(refname:short)", root);
            if (list.exitCode !== 0) {
                setAvailable(false);
                return;
            }
            setBranch(cur.stdout?.trim() ?? "");
            setBranches((list.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean));
            setAvailable(true);
        } catch {
            setAvailable(false);
        }
    }, [root]);

    useEffect(() => {
        void refresh();
    }, [refresh, activeMode]);

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

    if (!desktop || activeMode !== "code" || !root || !available) return null;

    const switchBranch = async (name: string) => {
        if (name === branch) {
            setOpen(false);
            return;
        }
        setBusy(true);
        try {
            const r = await desktopApi.execRun(`git checkout "${name.replace(/"/g, "")}"`, root!);
            if (r.exitCode !== 0) throw new Error(r.stderr?.trim() || r.stdout?.trim() || "checkout 失败");
            await refresh();
        } catch (err) {
            // 切换失败保留原分支状态，静默提示由 toast 层处理（此处仅回滚 UI）
            void err;
            await refresh();
        } finally {
            setBusy(false);
            setOpen(false);
        }
    };

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                title={`Git 分支：${branch}`}
                className="border-input bg-background hover:bg-accent flex h-7 max-w-44 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors"
                onClick={() => setOpen((v) => !v)}
            >
                <GitBranch className="text-muted-foreground size-3.5 shrink-0" />
                <span className="truncate">{branch}</span>
            </button>
            {open ? (
                <div className="bg-popover text-popover-foreground absolute top-full left-0 z-50 mt-1.5 w-60 overflow-hidden rounded-lg border shadow-md">
                    <div className="flex items-center justify-between border-b px-3 py-1.5">
                        <span className="text-muted-foreground text-xs">切换分支</span>
                        <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground rounded p-0.5"
                            title="刷新分支列表"
                            onClick={() => void refresh()}
                        >
                            <RefreshCw className="size-3" />
                        </button>
                    </div>
                    <div className="max-h-72 overflow-y-auto py-1">
                        {branches.map((b) => (
                            <button
                                key={b}
                                type="button"
                                disabled={busy}
                                className="hover:bg-accent flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
                                onClick={() => void switchBranch(b)}
                            >
                                <GitBranch className="text-muted-foreground size-3 shrink-0" />
                                <span className="min-w-0 flex-1 truncate">{b}</span>
                                {b === branch ? (
                                    <span className="text-primary text-[10px]">当前</span>
                                ) : null}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
