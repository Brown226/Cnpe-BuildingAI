/**
 * 定时任务调度器（T5.1 基础版，对齐 OpenWork automations 语义）：
 * 到点后在当前工作区开一个本地 Pi 会话线程执行 instructions，
 * 会话正文落 JSONL，执行结果记入任务记录（append-only）。
 * 服务端只做调度配置与记录（H3 决策），实际执行在桌面本地。
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { logStderr } from "../protocol/server.js";
import type { AgentEngine } from "../engine/types.js";
import { nextAutomationOccurrence, type AutomationSchedule } from "./schedules.js";
import type { SessionJsonlStore } from "../session/jsonl-store.js";

export interface AutomationTask {
    id: string;
    name: string;
    instructions: string;
    schedule: AutomationSchedule;
    /** 执行会话的模式（缺省 code） */
    mode?: "code" | "work";
    enabled: boolean;
    createdAt: number;
    lastRunAt?: number;
}

export interface AutomationRecord {
    id: string;
    taskId: string;
    at: number;
    status: "running" | "succeeded" | "failed";
    sessionId?: string;
    summary?: string;
    error?: string;
}

export class AutomationScheduler {
    private tasks = new Map<string, AutomationTask>();
    private records: AutomationRecord[] = [];
    private timer: NodeJS.Timeout | null = null;
    private recordsPath: string;
    private tasksPath: string;
    private running = new Set<string>();

    constructor(
        private readonly engine: AgentEngine,
        private readonly sessions: SessionJsonlStore,
        private readonly dataDir: string,
    ) {
        this.tasksPath = path.join(dataDir, "automation-tasks.json");
        this.recordsPath = path.join(dataDir, "automation-records.json");
        fs.mkdirSync(dataDir, { recursive: true });
        this.loadState();
    }

    start(): void {
        if (this.timer) return;
        this.scheduleNext();
    }

    dispose(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }

    // ── 任务 CRUD ──────────────────────────────────────────────────────

    listTasks(): AutomationTask[] {
        return [...this.tasks.values()];
    }

    createTask(input: { name: string; instructions: string; schedule: AutomationSchedule; mode?: "code" | "work" }): AutomationTask {
        const task: AutomationTask = {
            id: randomUUID(),
            name: input.name.trim().slice(0, 60) || "未命名任务",
            instructions: input.instructions,
            schedule: input.schedule,
            mode: input.mode ?? "code",
            enabled: true,
            createdAt: Date.now(),
        };
        this.tasks.set(task.id, task);
        this.persistTasks();
        this.scheduleNext();
        return task;
    }

    updateTask(id: string, patch: Partial<Pick<AutomationTask, "name" | "instructions" | "schedule" | "enabled" | "mode">>): AutomationTask | null {
        const task = this.tasks.get(id);
        if (!task) return null;
        Object.assign(task, patch);
        this.persistTasks();
        this.scheduleNext();
        return task;
    }

    deleteTask(id: string): boolean {
        const ok = this.tasks.delete(id);
        if (ok) this.persistTasks();
        this.scheduleNext();
        return ok;
    }

    listRecords(taskId?: string): AutomationRecord[] {
        return this.records.filter((r) => !taskId || r.taskId === taskId);
    }

    // ── 调度 ───────────────────────────────────────────────────────────

    private scheduleNext(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        const now = Date.now();
        let next: { at: number; task: AutomationTask } | null = null;
        for (const task of this.tasks.values()) {
            if (!task.enabled) continue;
            const occurrence = nextAutomationOccurrence(task.schedule, now);
            if (occurrence !== null && (next === null || occurrence < next.at)) {
                next = { at: occurrence, task };
            }
        }
        if (!next) return;
        const delay = Math.max(0, next.at - now);
        this.timer = setTimeout(() => {
            void this.executeTask(next!.task).catch((err) => {
                logStderr(`定时任务 ${next!.task.name} 执行异常: ${String(err)}`);
            });
            this.scheduleNext();
        }, delay);
        this.timer.unref?.();
        logStderr(`[automation] 下一任务 ${next.task.name} 触发于 ${new Date(next.at).toLocaleString()}`);
    }

    /** 立即运行（手动 / 触发）；执行在本地 Pi 会话线程，正文落 JSONL */
    async executeTask(task: AutomationTask): Promise<AutomationRecord> {
        const recordId = randomUUID();
        const record: AutomationRecord = {
            id: recordId,
            taskId: task.id,
            at: Date.now(),
            status: "running",
        };
        this.records.push(record);
        this.tasks.get(task.id)!.lastRunAt = record.at;
        this.persistTasks();
        this.persistRecords();

        if (this.running.has(task.id)) {
            record.status = "failed";
            record.error = "该任务已在运行中";
            this.persistRecords();
            return record;
        }
        this.running.add(task.id);

        const sessionId = randomUUID();
        record.sessionId = sessionId;
        try {
            // 开一个本地会话线程执行（用户可见，可观察）
            const meta = this.sessions.createSession(task.mode ?? "code", process.env.AGENT_CORE_WORKSPACE ?? "", task.name);
            this.sessions.appendMessage(sessionId, { role: "user", text: task.instructions, ts: Date.now() });
            let assistantText = "";
            let toolSummary = "";
            for await (const event of this.engine.sendMessage(sessionId, {
                text: task.instructions,
                mode: task.mode ?? "code",
            })) {
                this.sessions.appendEvent(sessionId, event);
                if (event.type === "text_delta") assistantText += event.delta;
                else if (event.type === "tool_call_end")
                    toolSummary += `\n[工具 ${event.name ?? "tool"} ${event.ok ? "完成" : "失败"} · ${event.durationMs ?? 0}ms]`;
            }
            const full = assistantText + (toolSummary.trim() ? `\n${toolSummary.trim()}` : "");
            if (full.trim()) this.sessions.appendMessage(sessionId, { role: "assistant", text: full, ts: Date.now() });
            // 本地会话与记录会话用同一 id：meta 已建记录会话，这里同步正文
            record.status = "succeeded";
            record.summary = full.slice(0, 200) || "（无输出）";
        } catch (err) {
            record.status = "failed";
            record.error = err instanceof Error ? err.message : String(err);
            logStderr(`定时任务执行失败: ${record.error}`);
        } finally {
            this.running.delete(task.id);
            this.persistRecords();
        }
        return record;
    }

    stopTask(taskId: string): boolean {
        void this.engine.abort(taskId);
        return true;
    }

    // ── 持久化 ─────────────────────────────────────────────────────────

    private loadState(): void {
        try {
            const tasks = JSON.parse(fs.readFileSync(this.tasksPath, "utf8")) as AutomationTask[];
            for (const t of tasks) this.tasks.set(t.id, t);
        } catch {
            /* 首次启动无任务 */
        }
        try {
            this.records = JSON.parse(fs.readFileSync(this.recordsPath, "utf8")) as AutomationRecord[];
        } catch {
            this.records = [];
        }
    }

    private persistTasks(): void {
        fs.writeFileSync(this.tasksPath, JSON.stringify([...this.tasks.values()], null, 2), "utf8");
    }

    private persistRecords(): void {
        // 记录上限 2000 条，超出丢最老
        if (this.records.length > 2000) this.records = this.records.slice(-2000);
        fs.writeFileSync(this.recordsPath, JSON.stringify(this.records, null, 2), "utf8");
    }
}
