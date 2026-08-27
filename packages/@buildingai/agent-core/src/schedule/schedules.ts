/**
 * 调度语义（T5.1，移植 OpenWork automations/schedule.ts）：
 * once/daily/weekly + IANA 时区，occurrence 计算含夏令时（DST）处理，
 * 墙钟落点在 DST 过渡窗内时顺延到下一合法分钟。
 */

export type AutomationScheduleKind = "once" | "daily" | "weekly";

export interface AutomationSchedule {
    kind: AutomationScheduleKind;
    /** once 的触发时刻（epoch ms） */
    at?: number;
    /** daily/weekly 的触发时刻（小时 0-23） */
    hour?: number;
    /** 分钟 0-59 */
    minute?: number;
    /** weekly 触发星期（0=周日 … 6=周六，ISO-ish） */
    daysOfWeek?: number[];
    /** IANA 时区，如 "Asia/Shanghai" */
    timezone: string;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const SEARCH_WINDOW_HOURS = 18;

type LocalDateTime = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };
type LocalDate = { year: number; month: number; day: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

export function assertAutomationTimezone(timezone: string): void {
    try {
        formatter(timezone).format(new Date(0));
    } catch {
        throw new RangeError(`Invalid IANA timezone: ${timezone}`);
    }
}

function formatter(timezone: string): Intl.DateTimeFormat {
    let f = formatters.get(timezone);
    if (!f) {
        f = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
            weekday: "short",
        });
        formatters.set(timezone, f);
    }
    return f;
}

function localDateTime(timestamp: number, timezone: string): LocalDateTime {
    const values = new Map(
        formatter(timezone)
            .formatToParts(new Date(timestamp))
            .filter((p) => p.type !== "literal")
            .map((p) => [p.type, p.value]),
    );
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(values.get("weekday") ?? "");
    return {
        year: Number(values.get("year")),
        month: Number(values.get("month")),
        day: Number(values.get("day")),
        hour: Number(values.get("hour")),
        minute: Number(values.get("minute")),
        weekday,
    };
}

function addLocalDays(date: LocalDate, days: number): LocalDate {
    const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
    return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function localKey(v: Pick<LocalDateTime, "year" | "month" | "day" | "hour" | "minute">): number {
    return Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute);
}

function sameLocalDate(l: LocalDate, r: LocalDate): boolean {
    return l.year === r.year && l.month === r.month && l.day === r.day;
}

function resolveLocalOccurrence(
    date: LocalDate,
    hour: number,
    minute: number,
    timezone: string,
): { timestamp: number; shifted: boolean } | null {
    const nominal = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
    const start = nominal - SEARCH_WINDOW_HOURS * 60 * 60 * 1_000;
    const end = nominal + SEARCH_WINDOW_HOURS * 60 * 60 * 1_000;
    const targetKey = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
    let shifted: number | null = null;
    for (let candidate = start; candidate <= end; candidate += 60_000) {
        const local = localDateTime(candidate, timezone);
        if (!sameLocalDate(local, date)) continue;
        if (localKey(local) === targetKey) return { timestamp: candidate, shifted: false };
        if (localKey(local) > targetKey && (shifted === null || candidate < shifted)) shifted = candidate;
    }
    return shifted === null ? null : { timestamp: shifted, shifted: true };
}

function isScheduledDay(schedule: AutomationSchedule, weekday: number): boolean {
    return schedule.kind === "daily" || (schedule.kind === "weekly" && (schedule.daysOfWeek ?? []).includes(weekday));
}

export function automationOccurrences(
    schedule: AutomationSchedule,
    opts: { after: number; count?: number },
): { occurrences: number[]; warnings: string[] } {
    assertAutomationTimezone(schedule.timezone);
    const count = Math.max(0, Math.min(opts.count ?? 5, 5));
    if (count === 0) return { occurrences: [], warnings: [] };
    if (schedule.kind === "once") {
        const at = schedule.at ?? 0;
        return { occurrences: at > opts.after ? [at] : [], warnings: [] };
    }

    const after = Math.floor(opts.after);
    const start = localDateTime(after, schedule.timezone);
    const occurrences: number[] = [];
    const warnings = new Set<string>();
    for (let offset = 0; offset < 370 && occurrences.length < count; offset += 1) {
        const date = addLocalDays({ year: start.year, month: start.month, day: start.day }, offset);
        const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
        if (!isScheduledDay(schedule, weekday)) continue;
        const resolved = resolveLocalOccurrence(date, schedule.hour ?? 0, schedule.minute ?? 0, schedule.timezone);
        if (!resolved || resolved.timestamp <= after) continue;
        if (resolved.shifted) {
            warnings.add(
                `墙钟落点在 ${schedule.timezone} 的夏令时过渡窗内，已顺延到下一合法分钟。`,
            );
        }
        occurrences.push(resolved.timestamp);
    }
    return { occurrences, warnings: [...warnings] };
}

export function nextAutomationOccurrence(schedule: AutomationSchedule, after: number): number | null {
    return automationOccurrences(schedule, { after, count: 1 }).occurrences[0] ?? null;
}
