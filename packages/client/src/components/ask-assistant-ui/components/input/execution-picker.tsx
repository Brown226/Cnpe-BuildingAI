/**
 * composer 执行选择器（对齐 Kun FloatingComposerExecutionPicker 的权限三档语义）：
 * 严格=ask-for-approval（每步审批）/ 平衡=approve-for-me（白名单自动、危险审批）/
 * 信任=full-access（白名单全自动）。直接映射我方策略引擎 policy.setMode。
 */
import { cn } from "@buildingai/ui/lib/utils";
import { Hand, LockKeyholeOpen, ShieldCheck, Bot } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { desktopApi } from "@/services/desktop/desktop-api";

interface ExecutionOption {
    mode: "strict" | "balanced" | "trust";
    label: string;
    description: string;
    icon: typeof Hand;
}

const EXECUTION_OPTIONS: ExecutionOption[] = [
    { mode: "strict", label: "严格", description: "每个操作都要我批准（ask-for-approval）", icon: Hand },
    { mode: "balanced", label: "平衡", description: "只读自动、危险操作审批（approve-for-me）", icon: Bot },
    { mode: "trust", label: "信任", description: "白名单内全部自动执行（full-access）", icon: LockKeyholeOpen },
];

export function ExecutionPicker() {
    const [mode, setMode] = useState<ExecutionOption["mode"] | null>(null);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        void desktopApi.policyGet().then(
            (r) => setMode(r.mode as ExecutionOption["mode"]),
            () => setMode("balanced"),
        );
    }, []);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as globalThis.Node)) {
                setOpen(false);
            }
        };
        window.addEventListener("mousedown", onDown);
        return () => window.removeEventListener("mousedown", onDown);
    }, [open]);

    const current = EXECUTION_OPTIONS.find((o) => o.mode === mode) ?? null;
    const select = async (next: ExecutionOption["mode"]) => {
        setBusy(true);
        try {
            await desktopApi.policySet(next);
            setMode(next);
            toast.success(`执行策略已切换为「${EXECUTION_OPTIONS.find((o) => o.mode === next)?.label}」`);
        } catch (err) {
            toast.error(String(err));
        } finally {
            setBusy(false);
            setOpen(false);
        }
    };

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                title={current ? `${current.label}：${current.description}` : "执行策略"}
                disabled={busy}
                className={cn(
                    "hover:bg-accent flex h-7 items-center gap-1.5 rounded-full border px-2 text-[11px] font-semibold transition-colors",
                    mode === "strict" && "text-amber-600 border-amber-500/40 bg-amber-500/10",
                    mode === "balanced" && "border-blue-500/40 text-blue-600 bg-blue-500/10",
                    mode === "trust" && "text-emerald-600 border-emerald-500/40 bg-emerald-500/10",
                )}
                onClick={() => setOpen((v) => !v)}
            >
                {current ? <current.icon className="size-3.5 shrink-0" /> : <ShieldCheck className="size-3.5 shrink-0" />}
                <span className="max-w-20 truncate">{current?.label ?? "…"}</span>
            </button>
            {open ? (
                <div className="bg-popover text-popover-foreground absolute top-full right-0 z-50 mt-1.5 w-72 overflow-hidden rounded-lg border shadow-md">
                    <div className="text-muted-foreground border-b px-3 py-1.5 text-[10px]">
                        执行策略（危险操作审批；企业硬规则不被放宽）
                    </div>
                    {EXECUTION_OPTIONS.map((o) => (
                        <button
                            key={o.mode}
                            type="button"
                            className={cn("hover:bg-accent flex w-full items-start gap-2 px-3 py-2 text-left", o.mode === mode && "bg-accent/50")}
                            onClick={() => void select(o.mode)}
                        >
                            <o.icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium">{o.label}</div>
                                <div className="text-muted-foreground text-[11px]">{o.description}</div>
                            </div>
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
