/**
 * 分屏合并胶囊（T2.1，OpenWork SidebarSplitPill 语义）：
 * 分屏激活时显示在顶部 header 右侧，点击任一半聚焦对应会话，X 解除分屏。
 */
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getLocalThread } from "@/services/desktop/thread-store";
import {
    getSplitSessionId,
    setSplitSessionId,
    SPLIT_CHANGED_EVENT,
} from "@/services/desktop/split-store";

export function SplitPill() {
    const navigate = useNavigate();
    const [splitId, setSplitId] = useState<string | null>(() => getSplitSessionId());

    useEffect(() => {
        const handler = () => setSplitId(getSplitSessionId());
        window.addEventListener(SPLIT_CHANGED_EVENT, handler);
        return () => window.removeEventListener(SPLIT_CHANGED_EVENT, handler);
    }, []);

    if (!splitId) return null;
    const splitThread = getLocalThread(splitId);

    return (
        <div className="flex items-center gap-1 rounded-lg border bg-background/80 p-0.5 shadow-sm backdrop-blur">
            <span className="text-muted-foreground px-1.5 text-[11px]">分屏</span>
            <button
                type="button"
                className="text-muted-foreground hover:bg-accent hover:text-foreground rounded px-2 py-1 text-xs"
                title="聚焦当前会话"
                onClick={() => navigate(`/chat/${splitId}`)}
            >
                {splitThread?.title ?? "副会话"}
            </button>
            <button
                type="button"
                className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1"
                title="解除分屏"
                onClick={() => setSplitSessionId(null)}
            >
                <X className="size-3" />
            </button>
        </div>
    );
}
