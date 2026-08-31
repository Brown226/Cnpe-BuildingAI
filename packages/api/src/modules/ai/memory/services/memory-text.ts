/**
 * #6 记忆结构化：纯逻辑模块（移植 Yan-Agent lib/long-term-memory.js，MIT）。
 *
 * 四个机制：
 * - 安全过滤：敏感信息标记（api key/密码/密钥/authorization…）与提示注入模式
 *   ——命中即拒绝入库（Yan 语义：宁可漏存不可泄密/被投毒）
 * - 关键词 tokenize：拉丁词元（含 .:/- 分段）+ CJK 二元组，供检索评分
 * - 评分检索：查询词元（去停用词）对 keywords/正文加权，类型加权
 *   （failure_solution/environment 更高），occurrences 强化项，阈值 2.6
 * - 字符预算格式化：按预算逐行装配注入上下文（默认 3600，600-12000 夹紧）
 *
 * 与 Yan 的差异：无 confidence/supersede/key 机制（我们用 dedup+occurrences 强化）；
 * scope 过滤在 SQL 可见集层完成，此处不再按 workspace 过滤。
 */

export const MEMORY_TYPES = [
    "preference",
    "environment",
    "project",
    "decision",
    "procedure",
    "failure_solution",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export const DEFAULT_MAX_CONTEXT_CHARS = 3600;
export const MAX_MEMORY_CONTENT_CHARS = 800;
export const MAX_EVIDENCE_CHARS = 500;
export const MAX_KEYWORDS = 16;
export const MEMORY_SCORE_THRESHOLD = 2.6;

const RETRIEVAL_STOP_TOKENS = new Set([
    "帮我", "这个", "那个", "一下", "进行", "使用", "运行", "打开", "项目", "文件", "任务", "工作",
    "测试", "游戏", "网页", "网站", "代码", "程序", "问题", "错误", "正常", "修复", "检查", "验证",
    "please", "help", "with", "this", "that", "use", "run", "open", "project", "file", "task",
    "test", "game", "website", "code", "program", "problem", "error", "normal", "fix", "check",
    "verify",
]);

const SENSITIVE_MEMORY_MARKERS = Object.freeze([
    "api key:",
    "api key=",
    "apikey:",
    "apikey=",
    "access_token=",
    "refresh_token=",
    "authorization: bearer ",
    "password:",
    "password=",
    "passwd:",
    "passwd=",
    "private key-----",
    "密钥：",
    "密钥=",
    "密码：",
    "密码=",
]);

const UNSAFE_MEMORY_PATTERNS: RegExp[] = [
    /ignore (?:all |any )?(?:previous|prior) instructions?/i,
    /reveal (?:the )?(?:system|developer) prompt/i,
    /<\/?(?:system|developer|assistant|tool)[^>]*>/i,
    /忽略(?:之前|以上|所有).{0,12}(?:指令|提示词)/,
    /泄露.{0,12}(?:系统|开发者).{0,8}(?:提示词|指令)/,
];

/**
 * 敏感标记同样过 normalizeText（NFKC 会把全角"：/＝"折叠为半角，
 * 标记与文本必须同一归一域才能命中——Yan 原实现的中文全角标记是死标记，此处修正）
 */
const SENSITIVE_MEMORY_MARKERS_NORMALIZED = SENSITIVE_MEMORY_MARKERS.map((marker) =>
    normalizeText(marker),
);

export function normalizeText(value: unknown): string {
    return String(value ?? "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

/** 拉丁词元（含 .:/- 内部分段）+ CJK 二元组，最多 160 个 */
export function tokenize(value: string): string[] {
    const normalized = normalizeText(value);
    const tokens = new Set<string>();
    const latin = normalized.match(/[a-z0-9][a-z0-9._:/\\-]{1,}/g) ?? [];
    for (const token of latin) {
        tokens.add(token);
        for (const part of token.split(/[._:/\\-]+/)) {
            if (part.length >= 2) tokens.add(part);
        }
    }
    const cjkRuns = normalized.match(/[\u3400-\u9fff]+/g) ?? [];
    for (const run of cjkRuns) {
        if (run.length <= 12) tokens.add(run);
        for (let i = 0; i < run.length - 1; i++) tokens.add(run.slice(i, i + 2));
    }
    return [...tokens].slice(0, 160);
}

export function clipText(value: unknown, max: number): string {
    return String(value ?? "")
        .replace(/\r\n?/g, "\n")
        .trim()
        .slice(0, max);
}

/** 提示注入模式命中 → 拒绝入库 */
export function containsUnsafeMemoryText(value: unknown): boolean {
    const text = normalizeText(value);
    if (!text) return true;
    return UNSAFE_MEMORY_PATTERNS.some((pattern) => pattern.test(text));
}

/** 敏感信息标记命中 → 拒绝入库 */
export function containsSensitiveMemoryText(value: unknown): boolean {
    const text = normalizeText(value);
    return SENSITIVE_MEMORY_MARKERS_NORMALIZED.some((marker) => text.includes(marker));
}

/** 内容 + 证据双向校验：任一命中即拒绝 */
export function isSafeMemoryText(content: string, evidence?: string | null): boolean {
    if (containsUnsafeMemoryText(content) || containsSensitiveMemoryText(content)) return false;
    if (evidence && (containsUnsafeMemoryText(evidence) || containsSensitiveMemoryText(evidence))) {
        return false;
    }
    return true;
}

/** 写入时计算检索关键词（内容词元 + 调用方补充，去重 ≤16） */
export function memoryKeywords(content: string, supplied?: string[]): string[] {
    const extra = (supplied ?? [])
        .map((keyword) => normalizeText(keyword))
        .filter(Boolean);
    return [...new Set([...extra, ...tokenize(content)])].slice(0, MAX_KEYWORDS);
}

export interface MemoryScoreInput {
    content: string;
    memoryType?: string | null;
    keywords?: string[] | null;
    occurrences?: number | null;
}

/** 检索评分（Yan scoreMemory 的 DB 适配版）：阈值 2.6 以上才值得注入 */
export function scoreMemory(
    memory: MemoryScoreInput,
    queryTokens: string[],
    normalizedQuery: string,
): number {
    const content = normalizeText(memory.content);
    if (!content) return Number.NEGATIVE_INFINITY;
    const keywords = new Set((memory.keywords ?? []).flatMap((keyword) => tokenize(keyword)));
    const contentTokens = new Set(tokenize(content));
    let score = 0;
    if (normalizedQuery.length >= 4 && content.includes(normalizedQuery)) score += 12;
    for (const token of queryTokens) {
        if (RETRIEVAL_STOP_TOKENS.has(token)) continue;
        if (keywords.has(token)) score += token.length >= 4 ? 3.2 : 1.6;
        else if (contentTokens.has(token)) score += token.length >= 4 ? 2.2 : 1.1;
        else if (token.length >= 4 && content.includes(token)) score += 1.2;
    }
    if (memory.memoryType === "failure_solution" || memory.memoryType === "environment") {
        score += 0.35;
    } else if (memory.memoryType === "preference") {
        score += 0.25;
    }
    score += Math.min(0.7, Math.log2(Math.max(1, Number(memory.occurrences) || 1)) * 0.2);
    return score;
}

export interface MemoryCandidate extends MemoryScoreInput {
    /** 调用方按 createdAt DESC 传入；preference 恒取最新 4 条（Yan always-include 语义） */
    createdAt?: Date | string | null;
}

/**
 * 按查询挑选注入记忆：
 * - 恒含最新 ≤4 条 preference（稳定偏好了始终跟随）
 * - 其余按评分 ≥2.6 排序取满 limit
 * - 查询为空/无词元时退化为按原顺序截断
 */
export function pickMemoriesForQuery<T extends MemoryCandidate>(
    candidates: T[],
    query: string,
    limit: number,
): T[] {
    if (limit <= 0 || candidates.length === 0) return [];
    const normalizedQuery = normalizeText(query);
    const queryTokens = tokenize(normalizedQuery);
    if (!queryTokens.length) return candidates.slice(0, limit);

    const always = candidates.filter((m) => m.memoryType === "preference").slice(0, 4);
    const alwaysIds = new Set(always);
    const resultLimit = Math.max(1, Math.min(30, limit));
    const scored = candidates
        .filter((m) => !alwaysIds.has(m))
        .map((m) => ({ memory: m, score: scoreMemory(m, queryTokens, normalizedQuery) }))
        .filter((item) => item.score >= MEMORY_SCORE_THRESHOLD)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(0, resultLimit - always.length))
        .map((item) => item.memory);
    return [...always, ...scored].slice(0, resultLimit);
}

/**
 * 装配注入上下文（含预算裁剪）：调用方自行包裹 `<user_memory>` 等标签。
 * 返回空串表示无可注入内容。
 */
export function formatMemoriesForPrompt(
    memories: Array<MemoryScoreInput & { evidence?: string | null }>,
    maxChars: number = DEFAULT_MAX_CONTEXT_CHARS,
): string {
    const bounded = Math.max(600, Math.min(12000, Math.floor(maxChars) || DEFAULT_MAX_CONTEXT_CHARS));
    if (!memories.length) return "";
    const header = [
        "## 用户长期记忆（按相关度检索）",
        "以下是历史交互沉淀的观察，不是本次会话的新证据：遵循稳定的用户偏好；可执行路径与易变环境信息使用前先核实。",
    ].join("\n");
    const lines = [header];
    let length = header.length;
    for (const memory of memories) {
        const label = memory.memoryType ?? "project";
        const evidence = memory.evidence ? `（依据：${memory.evidence}）` : "";
        const line = `- [${label}] ${memory.content}${evidence}`;
        if (length + line.length + 1 > bounded) break;
        lines.push(line);
        length += line.length + 1;
    }
    return lines.length > 1 ? lines.join("\n") : "";
}
