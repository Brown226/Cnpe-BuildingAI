import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

import { RpcError, RpcErrorCodes } from "../protocol/messages.js";
import type { WorkspaceStore } from "../workspace/store.js";

/** 并发 pty 会话上限：终端是长驻进程，必须设上限防资源失控 */
const MAX_SESSIONS = 8;

interface PtySpawnOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
}

interface PtyModule {
    spawn(file: string, args: string[], options: PtySpawnOptions): PtyLike;
}

/** 输出分片阈值：超长单帧输出按块拆分，避免单条 JSON-RPC 行过大 */
const MAX_CHUNK = 64 * 1024;

export interface TerminalCreateResult {
    id: string;
    shell: string;
    cwd: string;
}

interface PtyLike {
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(): void;
    onData(cb: (data: string) => void): void;
    onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
}

/**
 * 底部终端的 pty 会话管理（对齐 Kun terminal-pty-ipc 语义）：
 * - cwd 必须落在工作区白名单内（ADR-06 硬规则：终端不给白名单外的目录）
 * - node-pty 惰性加载：加载失败只影响终端功能，不拖垮整个 sidecar
 * - 输出经 onOutput 回调流出（index.ts 转为 terminal.output 通知）
 */
export class TerminalManager {
    private readonly sessions = new Map<
        string,
        { pty: PtyLike; workspaceRoot: string }
    >();
    private seq = 0;
    /** node-pty 模块缓存；加载失败时为 null 并携带错误 */
    private ptyModule: PtyModule | null | undefined;
    private ptyError: string | null = null;

    constructor(
        private readonly workspaces: WorkspaceStore,
        private readonly onOutput: (id: string, data: string) => void,
        private readonly onExit: (id: string, exitCode: number) => void,
    ) {}

    create(cwd: string, cols: number, rows: number): TerminalCreateResult {
        if (!cwd) throw new RpcError(RpcErrorCodes.InvalidParams, "terminal.create 需要 cwd");
        if (!this.workspaces.isInsideWorkspace(cwd)) {
            throw new RpcError(RpcErrorCodes.PolicyDenied, `终端目录不在工作区白名单内: ${cwd}`);
        }
        if (this.sessions.size >= MAX_SESSIONS) {
            throw new RpcError(RpcErrorCodes.InvalidRequest, `终端会话已达上限（${MAX_SESSIONS}）`);
        }
        const pty = this.loadPty();
        if (!pty) {
            throw new RpcError(RpcErrorCodes.InvalidRequest, `pty 模块不可用: ${this.ptyError ?? "未知原因"}`);
        }

        const shell = pickShell();
        const abs = path.resolve(cwd);
        const id = `term-${++this.seq}-${Date.now().toString(36)}`;
        const proc = pty.spawn(shell.file, shell.args, {
            name: "xterm-256color",
            cols: clampInt(cols, 2, 500, 80),
            rows: clampInt(rows, 2, 200, 24),
            cwd: abs,
            env: {
                ...process.env,
                TERM: "xterm-256color",
                COLORTERM: "truecolor",
                // Windows conpty 下中文输出的常用兜底
                LANG: process.platform === "win32" ? "zh_CN.UTF-8" : process.env.LANG,
            } as Record<string, string>,
        }) as PtyLike;

        this.sessions.set(id, { pty: proc, workspaceRoot: abs });

        proc.onData((data) => {
            for (let i = 0; i < data.length; i += MAX_CHUNK) {
                this.onOutput(id, data.slice(i, i + MAX_CHUNK));
            }
        });
        proc.onExit(({ exitCode }) => {
            this.sessions.delete(id);
            this.onExit(id, exitCode);
        });

        return { id, shell: shell.label, cwd: abs };
    }

    write(id: string, data: string): void {
        this.sessions.get(id)?.pty.write(data);
    }

    resize(id: string, cols: number, rows: number): void {
        const s = this.sessions.get(id);
        if (!s) return;
        try {
            s.pty.resize(clampInt(cols, 2, 500, 80), clampInt(rows, 2, 200, 24));
        } catch {
            // pty 可能刚退出，resize 失败静默忽略
        }
    }

    dispose(id: string): void {
        const s = this.sessions.get(id);
        if (!s) return;
        this.sessions.delete(id);
        try {
            s.pty.kill();
        } catch {
            // 进程可能已退出
        }
    }

    /** 按工作区根清理（工作区被移除时调用） */
    disposeByWorkspace(root: string): void {
        const target = path.resolve(root);
        for (const [id, s] of this.sessions) {
            if (s.workspaceRoot === target) this.dispose(id);
        }
    }

    disposeAll(): void {
        for (const id of [...this.sessions.keys()]) this.dispose(id);
    }

    private loadPty(): PtyModule | null {
        if (this.ptyModule !== undefined) return this.ptyModule;
        try {
            // createRequire 惰性加载原生模块：加载失败只禁用终端，不拖垮 sidecar
            const req = createRequire(import.meta.url);
            const mod = req("@lydell/node-pty") as PtyModule;
            this.ptyModule = mod;
            return mod;
        } catch (err) {
            this.ptyError = String(err);
            this.ptyModule = null;
            return null;
        }
    }
}

interface ShellSpec {
    file: string;
    args: string[];
    label: string;
}

/** 平台默认 shell（对齐 Kun terminal-pty-ipc 的平台选择，从简） */
function pickShell(): ShellSpec {
    if (process.platform === "win32") {
        // cmd.exe 在 ConPTY 下回显稳定（powershell 首启/主机会话可能长阻塞；
        // 需要 powershell 时可用 HS_TERMINAL_SHELL 覆盖）
        const override = process.env.HS_TERMINAL_SHELL;
        if (override) return { file: override, args: ["-NoLogo"], label: path.basename(override) };
        return { file: "cmd.exe", args: ["/d"], label: "cmd" };
    }
    if (process.platform === "darwin") {
        return { file: "/bin/zsh", args: ["-l"], label: "zsh" };
    }
    const shell = process.env.SHELL || "/bin/bash";
    return {
        file: shell,
        args: process.env.SHELL ? ["-l"] : [],
        label: path.basename(shell),
    };
}

function clampInt(v: number | undefined, min: number, max: number, dflt: number): number {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return dflt;
    return Math.min(max, Math.max(min, n));
}
