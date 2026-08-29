/**
 * 桌面端右栏（T1.6 三栏布局）：对齐 Kun 的「图标侧轨 + 可拖宽面板」形态。
 * - 侧轨（w-10）常驻右缘：文件/预览/待办/计划/Git/浏览器 + 面板开合按钮
 * - 面板宽度可拖（clamp 280..520），localStorage 持久化
 * - 待办计数徽标、预览入口按存在性显隐（对齐 Kun side-rail 激活态语义）
 */
import {
    ClipboardCheck,
    File as FileIcon,
    FolderOpen,
    GitBranch,
    Globe,
    ListTodo,
    PanelRightClose,
    PanelRightOpen,
} from "lucide-react";
import { useCallback, useState } from "react";

import { useTodoStore, selectActiveTodos } from "./todo-store";
import { useDesktop } from "./desktop-provider";
import {
    WorkspaceFilePanel,
    type PanelTab,
} from "./workspace-file-panel";

const WIDTH_KEY = "huashu.desktop.rightPanelWidth.v1";
const MIN_WIDTH = 280;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 320;

function loadWidth(): number {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    try {
        const w = Number(window.localStorage.getItem(WIDTH_KEY));
        if (!Number.isFinite(w)) return DEFAULT_WIDTH;
        return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));
    } catch {
        return DEFAULT_WIDTH;
    }
}

const RAIL_ITEMS: Array<{ id: PanelTab; icon: typeof FolderOpen; title: string }> = [
    { id: "files", icon: FolderOpen, title: "文件" },
    { id: "todo", icon: ListTodo, title: "待办" },
    { id: "plan", icon: ClipboardCheck, title: "计划" },
    { id: "git", icon: GitBranch, title: "Git" },
    { id: "browser", icon: Globe, title: "浏览器" },
];

export function DesktopRightPanel() {
    const { desktop, selectedWorkspace, panelOpen, setPanelOpen } = useDesktop();
    const activeTodos = useTodoStore(selectActiveTodos);
    const todoCount = activeTodos.length;

    const [tab, setTab] = useState<PanelTab>("files");
    const [hasPreview, setHasPreview] = useState(false);
    const [width, setWidth] = useState<number>(loadWidth);

    const openTab = useCallback(
        (next: PanelTab) => {
            setTab(next);
            if (!panelOpen) setPanelOpen(true);
        },
        [panelOpen, setPanelOpen],
    );

    const startDrag = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = width;
        const move = (ev: PointerEvent) => {
            const next = startW - (ev.clientX - startX);
            const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(next)));
            setWidth(clamped);
            try {
                window.localStorage.setItem(WIDTH_KEY, String(clamped));
            } catch {
                /* 忽略存储失败 */
            }
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }, [width]);

    if (!desktop) return null;

    const rail = (
        <nav className="bg-background flex w-10 shrink-0 flex-col items-center gap-0.5 border-l px-0.5 py-2">
            {RAIL_ITEMS.map(({ id, icon: Icon, title }) => (
                <div key={id} className="relative">
                    <button
                        type="button"
                        title={title}
                        aria-pressed={tab === id && panelOpen}
                        onClick={() => openTab(id)}
                        className={`flex size-8 items-center justify-center rounded-md transition ${
                            tab === id && panelOpen
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                    >
                        <Icon className="size-4" />
                        {id === "todo" && todoCount > 0 ? (
                            <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 min-w-3.5 rounded-full px-0.5 text-center text-[9px] leading-3.5">
                                {todoCount > 9 ? "9+" : todoCount}
                            </span>
                        ) : null}
                    </button>
                </div>
            ))}
            {hasPreview ? (
                <div className="relative">
                    <button
                        type="button"
                        title="预览"
                        aria-pressed={tab === "preview" && panelOpen}
                        onClick={() => openTab("preview")}
                        className={`flex size-8 items-center justify-center rounded-md transition ${
                            tab === "preview" && panelOpen
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                    >
                        <FileIcon className="size-4" />
                    </button>
                </div>
            ) : null}
            <div className="flex-1" />
            <button
                type="button"
                title={panelOpen ? "收起右栏" : "展开右栏"}
                onClick={() => setPanelOpen(!panelOpen)}
                className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-md transition"
            >
                {panelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            </button>
        </nav>
    );

    return (
        <div className="flex h-full shrink-0">
            {panelOpen ? (
                <>
                    <div
                        className="bg-border hover:bg-primary/40 w-1 shrink-0 cursor-col-resize transition-colors"
                        onPointerDown={startDrag}
                        title="拖动调整面板宽度"
                    />
                    <div className="h-full min-h-0" style={{ width }}>
                        {selectedWorkspace ? (
                            <WorkspaceFilePanel
                                open
                                embedded
                                tab={tab}
                                onTabChange={setTab}
                                onPreviewChange={setHasPreview}
                            />
                        ) : (
                            <div className="text-muted-foreground flex h-full items-center justify-center border-l px-3 text-xs">
                                先在左侧「项目」中添加并选择工作区
                            </div>
                        )}
                    </div>
                </>
            ) : null}
            {rail}
        </div>
    );
}
