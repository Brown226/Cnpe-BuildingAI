/**
 * composer 模式感知工具按钮（计划 §1.1，对齐 Kun composer 按模式换工具）：
 * - Code 模式：「终端」toggle 底部终端面板（B1）
 * - Work 模式：「生成文档」下拉 → 周报/纪要/清单模板 → docx/xlsx 导出到工作区
 */
import { Button } from "@buildingai/ui/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@buildingai/ui/components/ui/dropdown-menu";
import { FileSpreadsheet, FileText, TerminalSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useDesktop } from "@/components/desktop/desktop-provider";
import { desktopApi } from "@/services/desktop/desktop-api";
import {
    getTerminalOpen,
    TERMINAL_CHANGED_EVENT,
    toggleTerminalOpen,
} from "@/services/desktop/terminal-store";

interface Template {
    id: string;
    label: string;
    title: string;
    content: string;
}

const TEMPLATES: Template[] = [
    {
        id: "weekly",
        label: "周报",
        title: "本周工作周报",
        content: "# 本周工作周报\n\n## 本周进展\n- \n\n## 问题与风险\n- \n\n## 下周计划\n- \n",
    },
    {
        id: "minutes",
        label: "纪要",
        title: "会议纪要",
        content: "# 会议纪要\n\n## 时间\n\n## 参会人员\n\n## 议题\n\n## 结论与待办\n- \n",
    },
    {
        id: "list",
        label: "清单",
        title: "任务清单",
        content: "# 任务清单\n\n- [ ] 任务一\n- [ ] 任务二\n",
    },
];

function todayStamp(): string {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export function ComposerModeTools() {
    const { desktop, activeMode, selectedWorkspace } = useDesktop();
    const [terminalOpen, setTerminalOpenState] = useState(false);
    const [template, setTemplate] = useState<Template | null>(null);
    const [content, setContent] = useState("");
    const [fileName, setFileName] = useState("");
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        const sync = () => setTerminalOpenState(getTerminalOpen());
        sync();
        window.addEventListener(TERMINAL_CHANGED_EVENT, sync);
        return () => window.removeEventListener(TERMINAL_CHANGED_EVENT, sync);
    }, []);

    if (!desktop) return null;

    const openTemplate = (t: Template) => {
        setTemplate(t);
        setContent(t.content);
        setFileName(`${t.title}-${todayStamp()}`);
    };

    const targetPath = (ext: string) => {
        const root = selectedWorkspace?.path ?? "";
        return `${root.replace(/[\\/]+$/, "")}/${fileName || template?.id || "文档"}.${ext}`;
    };

    const exportDocx = async () => {
        if (!template) return;
        setExporting(true);
        try {
            const r = await desktopApi.officeExportDocx(targetPath("docx"), content);
            toast.success(`已生成：${r.summary}（${r.bytesWritten} 字节）`);
            setTemplate(null);
        } catch (err) {
            toast.error(String(err));
        } finally {
            setExporting(false);
        }
    };

    const exportXlsx = async () => {
        if (!template) return;
        setExporting(true);
        try {
            const rows = content
                .split("\n")
                .filter((l) => l.trim())
                .map((l) => [l.replace(/^[#\-\*\s]+/, "")]);
            const r = await desktopApi.officeExportXlsx(targetPath("xlsx"), rows, template.label);
            toast.success(`已生成：${r.summary}（${r.bytesWritten} 字节）`);
            setTemplate(null);
        } catch (err) {
            toast.error(String(err));
        } finally {
            setExporting(false);
        }
    };

    return (
        <>
            {activeMode === "code" ? (
                <Button
                    variant="ghost"
                    size="sm"
                    title={terminalOpen ? "收起终端" : "打开终端"}
                    className={`h-7 gap-1 rounded-full px-2 text-xs ${terminalOpen ? "text-foreground" : "text-muted-foreground"}`}
                    onClick={() => toggleTerminalOpen()}
                >
                    <TerminalSquare className="size-3.5" />
                    终端
                </Button>
            ) : (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            title="生成文档"
                            className="text-muted-foreground h-7 gap-1 rounded-full px-2 text-xs"
                        >
                            <FileText className="size-3.5" />
                            生成文档
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-44">
                        {TEMPLATES.map((t) => (
                            <DropdownMenuItem key={t.id} onClick={() => openTemplate(t)}>
                                <FileText className="size-4" />
                                {t.label}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}

            <Dialog open={template !== null} onOpenChange={(v) => !v && setTemplate(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>生成{template?.label}（{template?.title}）</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-2">
                        <input
                            value={fileName}
                            onChange={(e) => setFileName(e.target.value)}
                            placeholder="文件名（不含扩展名）"
                            className="border-input placeholder:text-muted-foreground h-8 w-full rounded-md border px-2 text-xs outline-none"
                        />
                        <textarea
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            rows={9}
                            className="border-input font-mono w-full resize-y rounded-md border p-2 text-xs outline-none"
                            placeholder="模板内容（markdown）…"
                        />
                        <div className="text-muted-foreground text-[11px]">
                            输出目录：{selectedWorkspace?.path ?? "（未选择工作区）"}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button size="sm" variant="outline" disabled={!fileName || exporting} onClick={() => void exportXlsx()}>
                            <FileSpreadsheet className="size-3.5" />
                            导出 Excel
                        </Button>
                        <Button size="sm" disabled={!fileName || exporting} onClick={() => void exportDocx()}>
                            <FileText className="size-3.5" />
                            导出 Word
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
