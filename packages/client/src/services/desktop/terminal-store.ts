/**
 * 底部终端面板状态（B1，对齐 Kun toggleTerminal/terminalHeight 语义）：
 * 开合与高度持久化 localStorage；高度 clamp 128..640（内容区 38vh 由面板侧限制）。
 */
const TERMINAL_KEY = "huashu.desktop.terminal.v1";

export const TERMINAL_CHANGED_EVENT = "huashu:terminal-changed";

const MIN_HEIGHT = 128;
const MAX_HEIGHT = 640;
const DEFAULT_HEIGHT = 280;

interface PersistedTerminalState {
    open?: boolean;
    height?: number;
}

function readState(): PersistedTerminalState {
    if (typeof window === "undefined") return {};
    try {
        const raw = window.localStorage.getItem(TERMINAL_KEY);
        return raw ? (JSON.parse(raw) as PersistedTerminalState) : {};
    } catch {
        return {};
    }
}

function writeState(patch: PersistedTerminalState): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(TERMINAL_KEY, JSON.stringify(patch));
        window.dispatchEvent(new CustomEvent(TERMINAL_CHANGED_EVENT));
    } catch {
        /* 忽略存储失败 */
    }
}

export function getTerminalOpen(): boolean {
    return readState().open ?? false;
}

export function setTerminalOpen(open: boolean): void {
    writeState({ open });
}

export function getTerminalHeight(): number {
    const h = readState().height;
    if (typeof h !== "number" || !Number.isFinite(h)) return DEFAULT_HEIGHT;
    return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(h)));
}

export function setTerminalHeight(px: number): void {
    if (!Number.isFinite(px)) return;
    writeState({ height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(px))) });
}

export function toggleTerminalOpen(): void {
    setTerminalOpen(!getTerminalOpen());
}
