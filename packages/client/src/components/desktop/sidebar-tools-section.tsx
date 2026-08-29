/**
 * 侧栏工具入口行（对齐 Kun Sidebar 的 CommandRow 系列）：
 * 新建会话（accent）→ 新对话页；日程 → 自动化页面；
 * 插件 → MCP 服务器列表（读服务端，管理仍走管理台）；扩展 → 技能市场下发清单。
 */
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import { useMcpServersAllQuery } from "@buildingai/services/web";
import { useAuthStore } from "@buildingai/stores";
import { Clock3, LayoutGrid, Plus, Puzzle } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { desktopApi } from "@/services/desktop/desktop-api";
import { useDesktop } from "./desktop-provider";

type ToolsDialog = "mcp" | "skills" | null;

/** 技能清单：与 desktop-provider 的 /api/desktop/config 下发同源 */
async function fetchSkills(token?: string): Promise<Array<{ name: string; description: string; content: string }>> {
    const serverBase = import.meta.env.VITE_APP_API_URL ?? window.location.origin;
    try {
        const res = await fetch(`${serverBase}/api/desktop/config`, {
            headers: { Authorization: token ? `Bearer ${token}` : "" },
        });
        if (!res.ok) return [];
        const cfg = (await res.json()) as { skills?: Array<{ name: string; description: string; content: string }> };
        return Array.isArray(cfg.skills) ? cfg.skills : [];
    } catch {
        return [];
    }
}

export function SidebarToolsSection() {
    const navigate = useNavigate();
    const token = useAuthStore((s) => s.auth.token);
    const { desktop, activeMode, addWorkspaceByPath } = useDesktop();
    const [dialog, setDialog] = useState<ToolsDialog>(null);
    const [skills, setSkills] = useState<Array<{ name: string; description: string; content: string }> | null>(null);
    const mcp = useMcpServersAllQuery(undefined, { enabled: dialog === "mcp" });

    const openSkills = async () => {
        setSkills(null);
        setDialog("skills");
        setSkills(await fetchSkills(token));
    };

    /** C1 时间戳会话目录（Kun conversation:create-workspace）：Work 模式新建会话自动建目录并激活 */
    const startNewSession = async () => {
        try {
            if (desktop && activeMode === "work") {
                const { dir } = await desktopApi.workspaceCreateConversationDir();
                await addWorkspaceByPath(dir, "conversation");
            }
        } catch (err) {
            toast.error(`创建会话目录失败：${String(err)}`);
        }
        navigate("/");
    };

    return (
        <>
            <div className="px-2 pt-1">
                <button
                    type="button"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm font-medium transition"
                    onClick={() => void startNewSession()}
                >
                    <Plus className="size-4" />
                    新建会话
                </button>
            </div>
            <div className="px-2 pt-1">
                <button
                    type="button"
                    className="hover:bg-accent flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition"
                    onClick={() => navigate("/automations")}
                >
                    <Clock3 className="text-muted-foreground size-4" />
                    日程
                </button>
                <button
                    type="button"
                    className="hover:bg-accent flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition"
                    onClick={() => setDialog("mcp")}
                >
                    <LayoutGrid className="text-muted-foreground size-4" />
                    插件
                </button>
                <button
                    type="button"
                    className="hover:bg-accent flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition"
                    onClick={() => void openSkills()}
                >
                    <Puzzle className="text-muted-foreground size-4" />
                    扩展
                </button>
            </div>

            {/* 插件：MCP 服务器清单（服务端为权威，仅展示） */}
            <Dialog open={dialog === "mcp"} onOpenChange={(v) => !v && setDialog(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>插件（MCP 服务器）</DialogTitle>
                        <DialogDescription>由管理台统一配置；密钥保存在服务端，桌面端不落盘。</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-80 space-y-1.5 overflow-y-auto">
                        {mcp.isLoading ? (
                            <div className="text-muted-foreground py-4 text-center text-xs">加载中…</div>
                        ) : (mcp.data ?? []).length === 0 ? (
                            <div className="text-muted-foreground py-4 text-center text-xs">暂无已配置的 MCP 服务器</div>
                        ) : (
                            (mcp.data ?? []).map((s) => (
                                <div key={s.id} className="hover:bg-accent/60 rounded-md border p-2">
                                    <div className="flex items-center gap-2">
                                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                                        {s.isDisabled ? (
                                            <span className="text-muted-foreground text-[10px]">停用</span>
                                        ) : null}
                                    </div>
                                    {s.description ? (
                                        <div className="text-muted-foreground line-clamp-1 text-[11px]">{s.description}</div>
                                    ) : null}
                                </div>
                            ))
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* 扩展：技能市场下发清单 */}
            <Dialog open={dialog === "skills"} onOpenChange={(v) => !v && setDialog(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>扩展（技能市场）</DialogTitle>
                        <DialogDescription>由管理员在管理台发布后自动下发到桌面引擎。</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-80 space-y-1.5 overflow-y-auto">
                        {skills === null ? (
                            <div className="text-muted-foreground py-4 text-center text-xs">加载中…</div>
                        ) : skills.length === 0 ? (
                            <div className="text-muted-foreground py-4 text-center text-xs">暂无已下发的技能</div>
                        ) : (
                            skills.map((s) => (
                                <div key={s.name} className="hover:bg-accent/60 rounded-md border p-2">
                                    <div className="text-sm font-medium">{s.name}</div>
                                    {s.description ? (
                                        <div className="text-muted-foreground line-clamp-1 text-[11px]">{s.description}</div>
                                    ) : null}
                                </div>
                            ))
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
