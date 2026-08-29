/**
 * composer 任务档案选择器（对齐 Kun FloatingComposerTaskProfile 的 profile 概念）：
 * 下拉选档位 → useAssistantStore.composerTaskProfileId → resolveAgentRole 随 send 注入引擎。
 * surface（code/design）由全局模式 Tab 承担，此处只留档位。
 */
import { cn } from "@buildingai/ui/lib/utils";
import { useAssistantStore } from "@buildingai/stores";
import { FlaskConical, Gauge, Landmark, ShieldCheck, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { TASK_PROFILES } from "../../libs/task-profiles";

const PROFILE_ICONS: Record<string, typeof Gauge> = {
    standard: Gauge,
    architect: Landmark,
    reviewer: ShieldCheck,
    researcher: FlaskConical,
};

export function TaskProfilePicker() {
    const profileId = useAssistantStore((s) => s.composerTaskProfileId);
    const setProfileId = useAssistantStore((s) => s.setComposerTaskProfileId);
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

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

    const current = TASK_PROFILES.find((p) => p.id === profileId) ?? TASK_PROFILES[0]!;
    const Icon = PROFILE_ICONS[current.id] ?? Gauge;

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                title={`任务档案：${current.description}`}
                className="border-input bg-background hover:bg-accent flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors"
                onClick={() => setOpen((v) => !v)}
            >
                <Icon className="text-muted-foreground size-3.5 shrink-0" />
                <span className="max-w-24 truncate">{current.label}</span>
                <ChevronDown className={cn("text-muted-foreground size-3 shrink-0 transition-transform", open && "rotate-180")} />
            </button>
            {open ? (
                <div className="bg-popover text-popover-foreground absolute top-full right-0 z-50 mt-1.5 w-64 overflow-hidden rounded-lg border shadow-md">
                    {TASK_PROFILES.map((p) => {
                        const ItemIcon = PROFILE_ICONS[p.id] ?? Gauge;
                        return (
                            <button
                                key={p.id}
                                type="button"
                                className={cn(
                                    "hover:bg-accent flex w-full items-start gap-2 px-3 py-2 text-left",
                                    p.id === current.id && "bg-accent/50",
                                )}
                                onClick={() => {
                                    setProfileId(p.id);
                                    setOpen(false);
                                }}
                            >
                                <ItemIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-medium">{p.label}</div>
                                    <div className="text-muted-foreground text-[11px]">{p.description}</div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
