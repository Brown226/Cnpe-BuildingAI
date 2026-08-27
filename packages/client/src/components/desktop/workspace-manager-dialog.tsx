import { Button } from "@buildingai/ui/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import { Input } from "@buildingai/ui/components/ui/input";
import { Label } from "@buildingai/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@buildingai/ui/components/ui/radio-group";
import { toast } from "sonner";
import { useCallback, useEffect, useState } from "react";

import { desktopApi } from "@/services/desktop/desktop-api";

const MODE_DESC: Record<string, string> = {
    strict: "所有写操作与命令均需确认（适合财务、涉密岗位）",
    balanced: "白名单自动执行，其余弹审批（推荐日常使用）",
    trust: "全部自动执行并全量审计（仅限明确授权的研发岗）",
};

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * 工作区与权限模式管理面板（ADR-06）。
 * 用户可查看当前工作区白名单与权限模式；模式只允许在
 * 管理员下发的天花板内调整（升档请求会被 sidecar 拒绝并提示）。
 */
export function WorkspaceManagerDialog({ open, onOpenChange }: Props) {
    const [dirs, setDirs] = useState<string[]>([]);
    const [mode, setMode] = useState<string>("balanced");
    const [newDir, setNewDir] = useState("");
    const [busy, setBusy] = useState(false);

    const reload = useCallback(async () => {
        try {
            const [policyRes, wsRes] = await Promise.all([
                desktopApi.policyGet(),
                desktopApi.workspaceList(),
            ]);
            setMode(policyRes.mode);
            setDirs(wsRes.dirs);
        } catch (err) {
            console.error("[desktop] 工作区配置加载失败", err);
        }
    }, []);

    useEffect(() => {
        if (open) void reload();
    }, [open, reload]);

    const addDir = async () => {
        if (!newDir.trim() || busy) return;
        setBusy(true);
        try {
            await desktopApi.workspaceAdd(newDir.trim());
            setNewDir("");
            await reload();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    const removeDir = async (dir: string) => {
        await desktopApi.workspaceRemove(dir);
        await reload();
    };

    const changeMode = async (next: string) => {
        try {
            const res = await desktopApi.policySet(next as "strict" | "balanced" | "trust");
            setMode(res.mode);
            toast.success(`权限模式已切换为${MODE_LABEL[res.mode] ?? res.mode}`);
        } catch (err) {
            // 天花板拦截等策略拒绝：以服务端提示为准
            toast.error(err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>工作区与安全设置</DialogTitle>
                    <DialogDescription>
                        本地智能助手只能访问下方目录，并由管理员下发的权限上限约束。
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>工作区目录</Label>
                        <div className="flex gap-2">
                            <Input
                                placeholder="输入本机文件夹绝对路径"
                                value={newDir}
                                onChange={(e) => setNewDir(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && void addDir()}
                            />
                            <Button disabled={busy || !newDir.trim()} onClick={() => void addDir()}>
                                添加
                            </Button>
                        </div>
                        <div className="text-muted-foreground max-h-32 space-y-1 overflow-auto text-xs">
                            {dirs.length === 0 && <p>尚未添加任何工作区</p>}
                            {dirs.map((d) => (
                                <div key={d} className="flex items-center justify-between rounded border px-2 py-1">
                                    <span className="truncate font-mono">{d}</span>
                                    <button
                                        className="hover:text-destructive text-muted-foreground shrink-0 pl-2"
                                        onClick={() => void removeDir(d)}
                                    >
                                        移除
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>安全模式（只能收紧或维持管理员设定）</Label>
                        <RadioGroup value={mode} onValueChange={(v) => void changeMode(v)}>
                            {Object.entries(MODE_DESC).map(([value, desc]) => (
                                <label key={value} className="flex cursor-pointer items-start gap-2 rounded p-2 hover:bg-accent">
                                    <RadioGroupItem value={value} className="mt-0.5" />
                                    <span className="space-y-0.5">
                                        <span className="block text-sm font-medium">{MODE_LABEL[value]}</span>
                                        <span className="text-muted-foreground block text-xs">{desc}</span>
                                    </span>
                                </label>
                            ))}
                        </RadioGroup>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        关闭
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

const MODE_LABEL: Record<string, string> = {
    strict: "严格模式",
    balanced: "平衡模式",
    trust: "信任模式",
};
