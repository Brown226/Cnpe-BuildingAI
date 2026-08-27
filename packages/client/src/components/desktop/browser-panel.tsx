/**
 * 内嵌浏览器面板（T3.6 方案 A）：地址栏/后退/前进/刷新/新开/关闭。
 * 浏览器视图由 Rust 子 webview 承载，本组件只负责 bounds 同步与命令转发。
 * 位置：右缘浮层（close 时整体收起，内嵌 webview 同步隐藏）。
 */
import { ChevronLeft, ChevronRight, Globe, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { browserApi } from "@/services/desktop/desktop-api";
import { useDesktop } from "./desktop-provider";

const PANEL_WIDTH = 720;
const PANEL_HEIGHT = 560;

export function BrowserPanel() {
  const { desktop } = useDesktop();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const boundsOf = useCallback((): { x: number; y: number; w: number; h: number } | null => {
    const el = containerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, []);

  const doOpen = useCallback(
    async (target?: string) => {
      const bounds = boundsOf();
      if (!bounds) return;
      setOpen(true);
      setLoading(true);
      try {
        const final = target?.trim() || "https://www.bing.com";
        await browserApi.open(final, bounds);
        setUrl(final);
      } catch (err) {
        toast.error(String(err));
      } finally {
        setLoading(false);
      }
    },
    [boundsOf],
  );

  // 打开时同步 bounds（浮层变化后 webview 对齐）
  useEffect(() => {
    if (!open || !desktop) return;
    const sync = () => {
      const b = boundsOf();
      if (b) void browserApi.bounds(b).catch(() => undefined);
    };
    sync();
    const ro = new ResizeObserver(sync);
    const el = containerRef.current;
    if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [open, desktop, boundsOf]);

  if (!desktop) return null;

  const doClose = async () => {
    setOpen(false);
    await browserApi.close().catch(() => undefined);
  };

  const nav = async (to: string) => {
    if (!to.trim()) return;
    setLoading(true);
    try {
      await browserApi.navigate(to.trim());
      setUrl(to.trim());
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="bg-background/90 fixed right-2 bottom-16 z-40 rounded-lg border p-2 shadow-md backdrop-blur transition hover:scale-105"
        title="内置浏览器"
        onClick={() => void doOpen()}
      >
        <Globe className="size-4" />
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      className="bg-background fixed right-2 top-14 z-40 flex flex-col rounded-lg border shadow-lg"
      style={{ width: PANEL_WIDTH, height: PANEL_HEIGHT }}
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
        <button type="button" onClick={() => void browserApi.goBack()} title="后退" className="text-muted-foreground hover:text-foreground rounded p-1">
          <ChevronLeft className="size-4" />
        </button>
        <button type="button" onClick={() => void browserApi.goForward()} title="前进" className="text-muted-foreground hover:text-foreground rounded p-1">
          <ChevronRight className="size-4" />
        </button>
        <button type="button" onClick={() => void browserApi.reload()} title="刷新" className="text-muted-foreground hover:text-foreground rounded p-1">
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </button>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void nav(url);
          }}
          placeholder="输入网址，回车访问…"
          className="border-input bg-background placeholder:text-muted-foreground h-7 min-w-0 flex-1 rounded border px-2 text-xs outline-none"
        />
        <button type="button" onClick={() => void doOpen()} title="打开新页面" className="text-muted-foreground hover:text-foreground shrink-0 rounded border px-2 py-0.5 text-xs">
          打开
        </button>
        <button type="button" onClick={() => void doClose()} title="关闭浏览器" className="text-muted-foreground hover:text-foreground rounded p-1">
          <X className="size-4" />
        </button>
      </div>
      <div className="text-muted-foreground min-h-0 flex-1 bg-muted/40 px-3 py-2 text-[11px]">
        浏览器视图已就位：在此区域下方点击「打开」加载页面，agent 可在对话中驱动导航/采集。
      </div>
    </div>
  );
}