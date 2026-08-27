/**
 * Git 面板（T2.5，Code 模式右栏 tab）：
 * 分支查看/切换、diff 审查（--stat + 详情）、提交（add+commit）、
 * 单文件回退（checkout）。全部经 exec.run 走策略层（git 命令白名单）。
 * 仅在工作区根为 git 仓库时可用。
 */
import { GitBranch, Check, GitCommitHorizontal, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useCallback, useEffect, useState } from "react";

import { desktopApi } from "@/services/desktop/desktop-api";
import { useDesktop } from "./desktop-provider";

interface DiffEntry {
    path: string;
    status: string;
    additions: number;
    deletions: number;
}

const git = async (cwd: string, args: string): Promise<string> => {
    const r = await desktopApi.execRun(`git ${args}`, cwd);
    if (r.exitCode !== 0) throw new Error(r.stderr?.trim() || r.stdout?.trim() || `git ${args} 失败`);
    return r.stdout ?? "";
};

export function GitPanel() {
    const { desktop, selectedWorkspace } = useDesktop();
    const root = selectedWorkspace?.path ?? null;
    const [branch, setBranch] = useState("");
    const [branches, setBranches] = useState<string[]>([]);
    const [diffStat, setDiffStat] = useState("");
    const [diffDetail, setDiffDetail] = useState<{ path: string; content: string } | null>(null);
    const [isRepo, setIsRepo] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(false);
    const [commitMsg, setCommitMsg] = useState("");

    const refresh = useCallback(async () => {
        if (!root) return;
        setLoading(true);
        try {
            const cur = await git(root, "branch --show-current");
            setBranch(cur.trim());
            const list = await git(root, "branch --format=%(refname:short)");
            setBranches(list.split("\n").map((s) => s.trim()).filter(Boolean));
            const stat = await git(root, "diff --stat");
            setDiffStat(stat.trim());
            setDiffDetail(null);
            setIsRepo(true);
        } catch {
            setIsRepo(false);
        } finally {
            setLoading(false);
        }
    }, [root]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    if (!desktop || !root) return null;
    if (isRepo === false) {
        return (
            <div className="text-muted-foreground p-3 text-xs leading-5">
                该工作区不是 Git 仓库，Git 面板不可用。
            </div>
        );
    }

    const switchBranch = async (name: string) => {
        try {
            await git(root, `checkout ${name}`);
            toast.success(`已切换到分支 ${name}`);
            void refresh();
        } catch (err) {
            toast.error(String(err));
        }
    };

    const viewDiff = async (path: string) => {
        try {
            const content = await git(root, `diff -- ${path}`);
            setDiffDetail({ path, content });
        } catch (err) {
            toast.error(String(err));
        }
    };

    const revertFile = async (path: string) => {
        if (!window.confirm(`回退文件（丢弃未提交改动）？\n${path}`)) return;
        try {
            await git(root, `checkout -- ${path}`);
            toast.success("已回退");
            void refresh();
        } catch (err) {
            toast.error(String(err));
        }
    };

    const doCommit = async () => {
        if (!commitMsg.trim()) {
            toast.error("请输入提交信息");
            return;
        }
        try {
            await git(root, "add -A");
            await git(root, `commit -m "${commitMsg.trim().replace(/"/g, "\\\"")}"`);
            toast.success("已提交");
            setCommitMsg("");
            void refresh();
        } catch (err) {
            toast.error(String(err));
        }
    };

    // diff --stat 解析为条目
    const entries: DiffEntry[] = [];
    for (const line of diffStat.split("\n")) {
        const m = /^\s*([^|]+?)\s+\|\s+(\d+)\s+([+-]+)$/.exec(line);
        if (m) {
            const plus = (m[3]!.match(/\+/g) ?? []).length;
            const minus = (m[3]!.match(/-/g) ?? []).length;
            entries.push({ path: m[1]!.trim(), status: "M", additions: plus, deletions: minus });
        } else if (line.includes("new file")) {
            const p = line.replace(/^\s*/, "").split(/\s+\|/)[0]?.trim();
            if (p) entries.push({ path: p, status: "A", additions: 0, deletions: 0 });
        }
    }

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-1.5 border-b px-3 py-2">
                <GitBranch className="text-muted-foreground size-3.5" />
                <select
                    value={branch}
                    onChange={(e) => void switchBranch(e.target.value)}
                    className="border-input bg-background h-7 min-w-0 flex-1 rounded border px-1.5 text-xs outline-none"
                >
                    {branches.map((b) => (
                        <option key={b} value={b}>
                            {b}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={() => void refresh()}
                    className="text-muted-foreground hover:bg-accent rounded p-1"
                    title="刷新"
                >
                    <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
                </button>
            </div>

            <div className="flex items-center gap-1.5 border-b px-3 py-1.5">
                <GitCommitHorizontal className="text-muted-foreground size-3.5" />
                <input
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    placeholder="提交信息（git add -A + commit）"
                    className="border-input bg-background placeholder:text-muted-foreground h-7 min-w-0 flex-1 rounded border px-1.5 text-xs outline-none"
                />
                <button
                    type="button"
                    onClick={() => void doCommit()}
                    className="text-primary hover:bg-accent shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium"
                >
                    提交
                </button>
            </div>

            {diffDetail ? (
                <div className="flex flex-1 flex-col overflow-hidden">
                    <div className="flex items-center gap-2 border-b px-3 py-1.5">
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                            {diffDetail.path}
                        </span>
                        <button
                            type="button"
                            onClick={() => void revertFile(diffDetail.path)}
                            className="text-destructive hover:bg-accent shrink-0 rounded px-1.5 py-0.5 text-[11px]"
                            title="丢弃该文件的未提交改动"
                        >
                            <RotateCcw className="size-3" />
                            回退
                        </button>
                        <button
                            type="button"
                            onClick={() => setDiffDetail(null)}
                            className="text-muted-foreground hover:bg-accent shrink-0 rounded px-1.5 py-0.5 text-[11px]"
                        >
                            返回
                        </button>
                    </div>
                    <pre className="flex-1 overflow-auto p-3 font-mono text-[11px] whitespace-pre-wrap">
                        {diffDetail.content || "（无差异）"}
                    </pre>
                </div>
            ) : (
                <div className="flex-1 overflow-auto py-1">
                    {entries.length === 0 ? (
                        <div className="text-muted-foreground px-3 py-2 text-[11px]">
                            {diffStat ? diffStat : "工作区干净，无未提交改动"}
                        </div>
                    ) : (
                        entries.map((e) => (
                            <div
                                key={e.path}
                                className="hover:bg-accent/60 flex cursor-pointer items-center gap-1.5 px-3 py-1.5"
                                onClick={() => void viewDiff(e.path)}
                            >
                                <Check className="text-muted-foreground size-3 shrink-0" />
                                <span className="min-w-0 flex-1 truncate text-xs">{e.path}</span>
                                {e.additions > 0 && (
                                    <span className="text-green-600 shrink-0 text-[10px]">+{e.additions}</span>
                                )}
                                {e.deletions > 0 && (
                                    <span className="text-red-600 shrink-0 text-[10px]">-{e.deletions}</span>
                                )}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
