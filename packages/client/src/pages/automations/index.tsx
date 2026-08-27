/**
 * 定时任务管理页（T5.1，对齐 OpenWork automations-page）：
 * 列表（状态/下次触发）+ 创建（once/daily/weekly+时区）+ Run now + History + 删除。
 * 仅桌面端可见。
 */
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Play,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { desktopApi, isDesktop } from "@/services/desktop/desktop-api";

type Task = {
  id: string;
  name: string;
  instructions: string;
  schedule: { kind: string; hour?: number; minute?: number; daysOfWeek?: number[]; timezone: string };
  enabled: boolean;
  lastRunAt?: number;
};
type Record = { id: string; taskId: string; at: number; status: string; summary?: string; error?: string };

const KIND_LABEL: Record<string, string> = { once: "单次", daily: "每日", weekly: "每周" };
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function fmtTime(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

function scheduleLabel(t: Task, expand = false): string {
  const s = t.schedule;
  const tz = s.timezone;
  if (s.kind === "once") return `单次 ${fmtTime(s.hour ? undefined : parseInt(s as never) as never)}`;
  const hh = String(s.hour ?? 9).padStart(2, "0");
  const mm = String(s.minute ?? 0).padStart(2, "0");
  if (s.kind === "daily") return `每日 ${hh}:${mm} (${tz})`;
  const days = (s.daysOfWeek ?? []).map((d) => WEEKDAYS[d]).join("、");
  return `每周 ${days} ${hh}:${mm} (${tz})`;
}

export function AutomationsPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [records, setRecords] = useState<Record[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [kind, setKind] = useState<"daily" | "weekly" | "once">("daily");
  const [hour, setHour] = useState("9");
  const [minute, setMinute] = useState("0");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const timezone = "Asia/Shanghai";

  const refresh = useCallback(async () => {
    try {
      const data = await desktopApi.scheduleList();
      setTasks(data.tasks);
      setRecords(data.records);
    } catch (err) {
      toast.error(String(err));
    }
  }, []);

  useEffect(() => {
    if (isDesktop()) void refresh();
  }, [refresh]);

  if (!isDesktop()) {
    return <div className="p-6 text-sm text-muted-foreground">定时任务仅桌面端可用。</div>;
  }

  const createTask = async () => {
    if (!instructions.trim()) {
      toast.error("请输入任务指令");
      return;
    }
    try {
      await desktopApi.scheduleCreate({
        name: name.trim() || "定时任务",
        instructions: instructions.trim(),
        schedule: {
          kind,
          hour: kind === "once" ? undefined : Number(hour),
          minute: kind === "once" ? undefined : Number(minute),
          daysOfWeek: kind === "weekly" ? days : undefined,
          timezone,
        },
        mode: "work",
      });
      toast.success("已创建定时任务");
      setCreating(false);
      setName("");
      setInstructions("");
      void refresh();
    } catch (err) {
      toast.error(String(err));
    }
  };

  const runTask = async (id: string) => {
    try {
      await desktopApi.scheduleRun(id);
      toast.success("已触发执行（本地会话可见）");
      void refresh();
    } catch (err) {
      toast.error(String(err));
    }
  };

  const delTask = async (id: string) => {
    if (!window.confirm("确认删除该定时任务？")) return;
    try {
      await desktopApi.scheduleDelete(id);
      toast.success("已删除");
      void refresh();
    } catch (err) {
      toast.error(String(err));
    }
  };

  const taskRecords = (taskId: string) => records.filter((r) => r.taskId === taskId);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">定时任务</h1>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm"
        >
          {creating ? "收起" : "+ 新建任务"}
        </button>
      </div>

      {creating && (
        <div className="border-border space-y-3 rounded-lg border p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="任务名称"
            className="border-input bg-background h-8 w-full rounded border px-2 text-sm outline-none"
          />
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="任务指令（到点后 agent 在本机工作区执行）"
            rows={3}
            className="border-input bg-background w-full rounded border px-2 py-1.5 text-sm outline-none"
          />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="border-input bg-background h-8 rounded border px-2">
              <option value="daily">每日</option>
              <option value="weekly">每周</option>
              <option value="once">单次</option>
            </select>
            {kind !== "once" && (
              <>
                <input value={hour} onChange={(e) => setHour(e.target.value)} className="border-input bg-background h-8 w-16 rounded border px-2 text-center" placeholder="时" />
                <span>:</span>
                <input value={minute} onChange={(e) => setMinute(e.target.value)} className="border-input bg-background h-8 w-16 rounded border px-2 text-center" placeholder="分" />
              </>
            )}
            {kind === "weekly" && (
              <div className="flex gap-1">
                {WEEKDAYS.map((w, d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()))}
                    className={`h-7 w-7 rounded-full border text-xs ${days.includes(d) ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            )}
            <span className="text-muted-foreground text-xs">{timezone}</span>
            <div className="flex-1" />
            <button type="button" onClick={() => void createTask()} className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm">
              创建
            </button>
          </div>
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="text-muted-foreground border-border rounded-lg border p-8 text-center text-sm">
          还没有定时任务。新建一个后，到点会在本机自动执行并生成可见会话。
        </div>
      ) : (
        tasks.map((t) => (
          <div key={t.id} className="border-border rounded-lg border">
            <div className="flex items-center gap-2 px-4 py-2.5">
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                className="text-muted-foreground hover:text-foreground rounded p-0.5"
              >
                {expandedId === t.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              </button>
              <CalendarClock className="text-muted-foreground size-4" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</span>
              <span className="text-muted-foreground truncate text-xs">{scheduleLabel(t)}</span>
              <button type="button" title="立即运行" onClick={() => void runTask(t.id)} className="text-muted-foreground hover:text-foreground rounded p-1">
                <Play className="size-4" />
              </button>
              <button type="button" title="删除" onClick={() => void delTask(t.id)} className="text-muted-foreground hover:text-destructive rounded p-1">
                <Trash2 className="size-4" />
              </button>
            </div>
            {expandedId === t.id && (
              <div className="border-border border-t px-6 py-3">
                <p className="text-muted-foreground mb-2 text-xs whitespace-pre-wrap">{t.instructions}</p>
                <div className="text-xs">
                  <div className="text-muted-foreground mb-1">执行历史</div>
                  {taskRecords(t.id).length === 0 ? (
                    <div className="text-muted-foreground text-[11px]">暂无历史</div>
                  ) : (
                    taskRecords(t.id).map((r) => (
                      <div key={r.id} className="flex items-center gap-2 py-0.5">
                        <span className="text-muted-foreground">{fmtTime(r.at)}</span>
                        <span className={r.status === "succeeded" ? "text-green-600" : r.status === "failed" ? "text-red-600" : "text-amber-600"}>
                          {r.status === "succeeded" ? "成功" : r.status === "failed" ? "失败" : "运行中"}
                        </span>
                        <span className="text-muted-foreground min-w-0 truncate text-[11px]">{r.error ?? r.summary ?? ""}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
