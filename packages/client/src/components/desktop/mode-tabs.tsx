/**
 * 模式切换器（T1.1 双模式框架，对齐 Kun WorkspaceModeTabs）：
 * 侧栏顶部下拉——trigger 显示当前模式图标+名称+chevron；
 * 菜单列出 Code|Work 双选项并带描述（Kun 下拉双选项语义）。
 * 切换模式后侧栏会话列表按模式过滤（thread-store 按 mode 分区），
 * 新建会话进入当前模式（use-chat-stream 以 activeMode 建 Pi session）。
 */
import { Check, ChevronDown, Code2, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useDesktop } from "./desktop-provider";

const MODES = [
    {
        id: "code" as const,
        label: "Code",
        description: "编程工作区 · 文件/终端/Git",
        icon: Code2,
    },
    {
        id: "work" as const,
        label: "Work",
        description: "办公工作区 · 文档/表格/报告",
        icon: FileText,
    },
];

export function ModeTabs() {
    const { desktop, activeMode, setMode } = useDesktop();
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
                e.stopPropagation();
            }
        };
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onEscape);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onEscape);
        };
    }, [open]);

    if (!desktop) return null;

    const current = MODES.find((m) => m.id === activeMode) ?? MODES[0]!;
    const CurrentIcon = current.icon;

    return (
        <div ref={rootRef} className="relative px-2 pt-2">
            <button
                type="button"
                aria-expanded={open}
                aria-haspopup="listbox"
                className="hover:bg-accent flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition"
                onClick={() => setOpen((v) => !v)}
            >
                <CurrentIcon className="text-muted-foreground size-4 shrink-0" />
                <span className="font-medium">{current.label}</span>
                <ChevronDown
                    className={`text-muted-foreground ml-auto size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
                />
            </button>
            {open ? (
                <div
                    role="listbox"
                    className="bg-popover text-popover-foreground absolute top-full right-2 left-2 z-50 mt-1 overflow-hidden rounded-lg border shadow-md"
                >
                    {MODES.map(({ id, label, description, icon: Icon }) => (
                        <button
                            key={id}
                            type="button"
                            role="option"
                            aria-selected={activeMode === id}
                            className="hover:bg-accent flex w-full items-center gap-2 px-3 py-2 text-left"
                            onClick={() => {
                                setMode(id);
                                setOpen(false);
                            }}
                        >
                            <Icon className="size-4 shrink-0" />
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium">{label}</div>
                                <div className="text-muted-foreground truncate text-[11px]">{description}</div>
                            </div>
                            {activeMode === id ? <Check className="text-primary size-4 shrink-0" /> : null}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
