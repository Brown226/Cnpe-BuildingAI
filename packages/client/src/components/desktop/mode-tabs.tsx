/**
 * 顶部模式 Tab（T1.1 双模式框架，B2 决策：顶部 Code | Work Tab）。
 * 仅桌面端渲染：读 useDesktop().activeMode/setMode。
 * 切换模式后侧栏会话列表按模式过滤（thread-store 按 mode 分区），
 * 新建会话进入当前模式（use-chat-stream 以 activeMode 建 Pi session）。
 */
import { Code2, FileText } from "lucide-react";

import { useDesktop } from "./desktop-provider";

const MODES = [
    { id: "code", label: "Code", icon: Code2 },
    { id: "work", label: "Work", icon: FileText },
] as const;

export function ModeTabs() {
    const { desktop, activeMode, setMode } = useDesktop();
    if (!desktop) return null;

    return (
        <div className="flex items-center gap-1 rounded-lg border bg-background/80 p-1 shadow-sm backdrop-blur">
            {MODES.map(({ id, label, icon: Icon }) => (
                <button
                    key={id}
                    type="button"
                    aria-pressed={activeMode === id}
                    title={`${label} 模式`}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                        activeMode === id
                            ? "bg-primary text-primary-foreground shadow"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                    onClick={() => setMode(id)}
                >
                    <Icon className="size-3.5" />
                    {label}
                </button>
            ))}
        </div>
    );
}
