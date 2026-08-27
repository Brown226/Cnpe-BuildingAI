/**
 * 不可变前缀指纹（T1.2 缓存优先循环）。
 *
 * 模型侧提示缓存命中依赖「前缀稳定」：系统提示 + 模式指令 + 工具 schema
 * 必须逐字节不变，动态数据（工作区内容、时间戳、用户消息）永不进前缀。
 * 本模块对前缀三要素做 sha256 指纹；引擎在每次回合前校验当前指纹与基准
 * 是否一致——漂移即意味着缓存命中率将下降（如误把动态数据拼进系统提示）。
 */
import { createHash } from "node:crypto";

export interface PrefixParts {
    /** 平台系统提示（第一 system 消息） */
    systemPrompt: string;
    /** 模式指令（第二 system 消息，T1.1 经 appendSystemPrompt 注入） */
    appendSystemPrompt: string[];
    /** 平台工具 schema（名称/描述/参数结构参与指纹；执行逻辑不影响前缀） */
    tools: Array<{ name: string; description?: string; parameters?: unknown }>;
}

/** 计算前缀指纹（sha256 hex） */
export function fingerprintPrefix(parts: PrefixParts): string {
    const h = createHash("sha256");
    h.update(parts.systemPrompt);
    for (const extra of parts.appendSystemPrompt) {
        h.update("\x00");
        h.update(extra);
    }
    for (const tool of parts.tools) {
        h.update("\x01");
        h.update(tool.name);
        h.update("\x02");
        h.update(tool.description ?? "");
        h.update("\x03");
        h.update(JSON.stringify(tool.parameters ?? {}));
    }
    return h.digest("hex");
}

/**
 * 前缀基准表：按模式记录基准指纹；每回合校验。
 * 校验失败返回 false（调用方负责告警并刷新基准，避免刷屏）。
 */
export class PrefixFingerprintTracker {
    private baselines = new Map<string, string>();

    /** 记录（或刷新）某模式的前缀基准 */
    setBaseline(mode: string, fingerprint: string): void {
        this.baselines.set(mode, fingerprint);
    }

    /** 校验当前指纹与基准一致；首次调用时建立基准并返回 true */
    verify(mode: string, fingerprint: string): boolean {
        const base = this.baselines.get(mode);
        if (base === undefined) {
            this.baselines.set(mode, fingerprint);
            return true;
        }
        return base === fingerprint;
    }

    /** 刷新基准（工具注册变化后的新稳态） */
    rebaseline(mode: string, fingerprint: string): void {
        this.baselines.set(mode, fingerprint);
    }

    /** 当前基准（诊断用） */
    baselineOf(mode: string): string | undefined {
        return this.baselines.get(mode);
    }
}
