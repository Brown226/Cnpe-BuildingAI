/**
 * 会话 JSONL 本地存储（T1.3，Kun file-session-store 模式）。
 *
 * 布局（sessionsDir 下按会话分目录，目录即索引）：
 *   <sessionsDir>/<sessionId>/meta.json     会话元数据（mode/cwd/标题/时间戳，原子写）
 *   <sessionsDir>/<sessionId>/messages.jsonl 对话文本流（user/assistant，坏行容忍追加）
 *
 * 语义：正文只存本机（A5 决策：会话不传服务端）；坏行容忍（逐行 try-parse，
 * 半行尾部/损坏行跳过）；追加写无需原子性（JSONL 行级容忍），meta 用 tmp+rename 原子写。
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface SessionMeta {
    id: string;
    mode: "code" | "work";
    /** 会话 cwd（工作区绝对路径） */
    cwd: string;
    title: string;
    createdAt: number;
    updatedAt: number;
}

export interface StoredMessage {
    role: "user" | "assistant";
    text: string;
    ts: number;
}

export class SessionJsonlStore {
    constructor(private readonly root: string) {
        fs.mkdirSync(root, { recursive: true });
    }

    static defaultRoot(): string {
        return path.join(process.env.TEMP ?? "/tmp", "huashu-sessions");
    }

    // ── meta（原子写：tmp + rename） ─────────────────────────────────

    createSession(mode: "code" | "work", cwd: string, title = "新对话"): SessionMeta {
        const id = randomUUID();
        const meta: SessionMeta = {
            id,
            mode,
            cwd,
            title,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        this.writeMeta(id, meta);
        return meta;
    }

    updateMeta(id: string, patch: Partial<Omit<SessionMeta, "id">>): void {
        const meta = this.getMeta(id);
        if (!meta) return;
        this.writeMeta(id, { ...meta, ...patch, updatedAt: Date.now() });
    }

    getMeta(id: string): SessionMeta | null {
        try {
            const raw = fs.readFileSync(this.metaPath(id), "utf8");
            const d = JSON.parse(raw) as SessionMeta;
            return d && typeof d.id === "string" ? d : null;
        } catch {
            return null;
        }
    }

    listMeta(): SessionMeta[] {
        const out: SessionMeta[] = [];
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(this.root, { withFileTypes: true });
        } catch {
            return out;
        }
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const meta = this.getMeta(e.name);
            if (meta) out.push(meta);
        }
        return out.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    // ── messages（JSONL 追加 + 坏行容忍） ─────────────────────────────

    appendMessage(id: string, msg: StoredMessage): void {
        const p = this.messagesPath(id);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.appendFileSync(p, `${JSON.stringify(msg)}\n`, "utf8");
        this.updateMeta(id, {});
    }

    readMessages(id: string): StoredMessage[] {
        let raw: string;
        try {
            raw = fs.readFileSync(this.messagesPath(id), "utf8");
        } catch {
            return [];
        }
        const out: StoredMessage[] = [];
        for (const line of raw.split("\n")) {
            const t = line.trim();
            if (!t) continue;
            try {
                const m = JSON.parse(t) as StoredMessage;
                if (m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
                    out.push(m);
            } catch {
                /* 坏行容忍：跳过 */
            }
        }
        return out;
    }

    // ── 内部 ─────────────────────────────────────────────────────────

    private sessionDir(id: string): string {
        return path.join(this.root, id);
    }

    private metaPath(id: string): string {
        return path.join(this.sessionDir(id), "meta.json");
    }

    private messagesPath(id: string): string {
        return path.join(this.sessionDir(id), "messages.jsonl");
    }

    private writeMeta(id: string, meta: SessionMeta): void {
        const dir = this.sessionDir(id);
        fs.mkdirSync(dir, { recursive: true });
        const tmp = path.join(dir, `.meta.${process.pid}.tmp`);
        fs.writeFileSync(tmp, `${JSON.stringify(meta)}\n`, "utf8");
        fs.renameSync(tmp, this.metaPath(id));
    }
}
