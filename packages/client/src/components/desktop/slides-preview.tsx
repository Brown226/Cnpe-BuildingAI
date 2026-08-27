/**
 * PPT 在线预览（T3.5：大纲→PPTX 生成 + 浏览器内翻页查看）。
 * 基于 pptx-preview 渲染 .pptx 二进制（经 sidecar fs.readBinary 读取），
 * 支持上一页/下一页翻页与页码显示。
 */
import PPTXPreviewer from "pptx-preview";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function SlidesPreview({ base64 }: { base64: string }) {
    const domRef = useRef<HTMLDivElement>(null);
    const previewerRef = useRef<PPTXPreviewer | null>(null);
    const [current, setCurrent] = useState(1);
    const [total, setTotal] = useState(0);
    const [error, setError] = useState("");

    useEffect(() => {
        const dom = domRef.current;
        if (!dom) return;
        let disposed = false;
        let previewer: PPTXPreviewer | null = null;
        try {
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            previewer = new PPTXPreviewer(dom, { mode: "slide" });
            previewerRef.current = previewer;
            void previewer.preview(bytes.buffer).then(() => {
                if (disposed) return;
                setTotal(previewer!.slideCount);
                setCurrent(Math.min(previewer!.currentIndex + 1, previewer!.slideCount));
            });
        } catch (err) {
            setError(String(err));
        }
        return () => {
            disposed = true;
            previewer?.destroy();
            previewerRef.current = null;
        };
    }, [base64]);

    const next = () => {
        const p = previewerRef.current;
        if (!p || p.currentIndex >= p.slideCount - 1) return;
        p.renderNextSlide();
        setCurrent(p.currentIndex + 1);
    };

    const prev = () => {
        const p = previewerRef.current;
        if (!p || p.currentIndex <= 0) return;
        p.renderPreSlide();
        setCurrent(p.currentIndex + 1);
    };

    if (error) {
        return (
            <div className="text-muted-foreground p-4 text-xs">{`（PPT 渲染失败：${error}）`}</div>
        );
    }

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
                <button
                    type="button"
                    onClick={prev}
                    disabled={current <= 1}
                    className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1 disabled:cursor-not-allowed disabled:opacity-40"
                    title="上一页"
                >
                    <ChevronLeft className="size-4" />
                </button>
                <span className="text-muted-foreground min-w-14 text-center text-[11px]">
                    {current} / {total}
                </span>
                <button
                    type="button"
                    onClick={next}
                    disabled={current >= total}
                    className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1 disabled:cursor-not-allowed disabled:opacity-40"
                    title="下一页"
                >
                    <ChevronRight className="size-4" />
                </button>
                <div className="flex-1" />
            </div>
            <div ref={domRef} className="flex-1 overflow-auto bg-muted/40" />
        </div>
    );
}
