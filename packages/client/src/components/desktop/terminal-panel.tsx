/**
 * 底部终端停靠面板（B1，对齐 Kun terminal/TerminalPanel 语义）：
 * - pty 会话绑定激活工作区（cwd=workspace.path，切换工作区即重建会话）
 * - 输出经 agent-event 的 terminal.output 通知流回显（xterm 渲染）
 * - 顶部 4px 把手拖拽调高度（terminal-store 持久化）
 */
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { RotateCcw, TerminalSquare, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { desktopApi, onAgentEvent, type AgentEventFrame } from "@/services/desktop/desktop-api";
import {
    getTerminalHeight,
    setTerminalHeight,
    setTerminalOpen,
} from "@/services/desktop/terminal-store";

import { useDesktop } from "./desktop-provider";

type TermStatus = "idle" | "starting" | "running" | "exited" | "error";

export function TerminalPanel() {
    const { selectedWorkspace } = useDesktop();
    const cwd = selectedWorkspace?.path ?? "";

    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const sessionIdRef = useRef<string | null>(null);

    const [status, setStatus] = useState<TermStatus>("idle");
    const [shellName, setShellName] = useState("");
    const [errorText, setErrorText] = useState("");
    const [restartTick, setRestartTick] = useState(0);

    // xterm 实例只建一次；会话随工作区重建
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const term = new Terminal({
            cursorBlink: true,
            fontSize: 13,
            fontFamily: 'Consolas, "Courier New", monospace',
            scrollback: 5000,
            convertEol: true,
            theme: {
                background: "#0f1115",
                foreground: "#e6e6e6",
                cursor: "#7aa2f7",
                selectionBackground: "#3b4261",
            },
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(el);
        termRef.current = term;
        fitRef.current = fit;

        term.onData((data) => {
            const id = sessionIdRef.current;
            if (id) void desktopApi.terminalInput(id, data);
        });

        // 容器尺寸变化（面板拖高/窗口缩放）→ fit + 通知 pty resize
        const ro = new ResizeObserver(() => {
            const id = sessionIdRef.current;
            try {
                fit.fit();
                if (id) void desktopApi.terminalResize(id, term.cols, term.rows);
            } catch {
                /* fit 在容器不可见时可能抛错，忽略 */
            }
        });
        ro.observe(el);

        return () => {
            ro.disconnect();
            term.dispose();
            termRef.current = null;
            fitRef.current = null;
        };
    }, []);

    // 会话生命周期：无工作区 = 空闲提示；有工作区 = 建会话
    useEffect(() => {
        let disposed = false;
        const prevId = sessionIdRef.current;
        sessionIdRef.current = null;
        if (prevId) void desktopApi.terminalDispose(prevId);

        const term = termRef.current;
        fitRef.current?.fit();
        if (!cwd || !term) {
            setStatus("idle");
            return;
        }

        setStatus("starting");
        setErrorText("");
        term.reset();

        void (async () => {
            try {
                const { id, shell } = await desktopApi.terminalCreate(cwd, term.cols, term.rows);
                if (disposed) {
                    void desktopApi.terminalDispose(id);
                    return;
                }
                sessionIdRef.current = id;
                setShellName(shell);
                setStatus("running");
                void desktopApi.terminalResize(id, term.cols, term.rows);
            } catch (err) {
                if (disposed) return;
                setStatus("error");
                setErrorText(err instanceof Error ? err.message : String(err));
            }
        })();

        return () => {
            disposed = true;
            const id = sessionIdRef.current;
            sessionIdRef.current = null;
            if (id) void desktopApi.terminalDispose(id);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- restartTick 仅驱动重建
    }, [cwd, restartTick]);

    // 事件订阅（一次）：terminal.output 回显 / terminal.exit 状态
    useEffect(() => {
        let unlisten: UnlistenFn | null = null;
        void onAgentEvent((frame: AgentEventFrame) => {
            if (frame.method === "terminal.output") {
                const { id, data } = (frame.params ?? {}) as { id?: string; data?: string };
                if (id && id === sessionIdRef.current && typeof data === "string") {
                    termRef.current?.write(data);
                }
                return;
            }
            if (frame.method === "terminal.exit") {
                const { id } = (frame.params ?? {}) as { id?: string };
                if (id && id === sessionIdRef.current) setStatus("exited");
            }
        }).then((fn) => {
            unlisten = fn;
        });
        return () => void unlisten?.();
    }, []);

    const startDrag = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        const startH = getTerminalHeight();
        const move = (ev: PointerEvent) => setTerminalHeight(startH + (startY - ev.clientY));
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }, []);

    const height = getTerminalHeight();

    return (
        <div className="shrink-0 border-t bg-background/95" style={{ height }}>
            <div
                className="hover:bg-accent/60 flex h-1.5 shrink-0 cursor-row-resize items-center"
                onPointerDown={startDrag}
                title="拖动调整终端高度"
            >
                <div className="bg-border mx-auto h-0.5 w-24 rounded-full" />
            </div>
            <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3">
                <TerminalSquare className="text-muted-foreground size-3.5" />
                <span className="text-muted-foreground text-xs font-medium">终端</span>
                {status === "running" && shellName && (
                    <span className="text-muted-foreground text-[11px]">· {shellName}</span>
                )}
                <span className="text-muted-foreground/70 truncate text-[11px]">{cwd}</span>
                <div className="ml-auto flex items-center gap-1">
                    {(status === "exited" || status === "error") && (
                        <button
                            type="button"
                            className="hover:bg-accent hover:text-foreground text-muted-foreground rounded p-1"
                            title="重新打开终端"
                            onClick={() => setRestartTick((t) => t + 1)}
                        >
                            <RotateCcw className="size-3.5" />
                        </button>
                    )}
                    <button
                        type="button"
                        className="hover:bg-accent hover:text-foreground text-muted-foreground rounded p-1"
                        title="关闭终端"
                        onClick={() => setTerminalOpen(false)}
                    >
                        <X className="size-3.5" />
                    </button>
                </div>
            </div>
            <div className="relative h-[calc(100%-2.375rem)]">
                {status === "idle" && (
                    <div className="text-muted-foreground absolute inset-0 flex items-center justify-center text-xs">
                        先在左侧「项目」中添加并选择工作区
                    </div>
                )}
                {status === "error" && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs">
                        <span className="text-destructive">终端启动失败：{errorText}</span>
                        <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground underline"
                            onClick={() => setRestartTick((t) => t + 1)}
                        >
                            重试
                        </button>
                    </div>
                )}
                {status === "exited" && (
                    <div className="text-muted-foreground absolute inset-0 flex items-center justify-center text-xs">
                        进程已退出（点击右上角 ↻ 重开）
                    </div>
                )}
                <div ref={containerRef} className="h-full w-full overflow-hidden pl-2" />
            </div>
        </div>
    );
}
