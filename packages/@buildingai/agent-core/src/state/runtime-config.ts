/** 运行时配置：initialize 时由客户端 Rust Core 下发的配置包 */
import type { PolicyConfig } from "../policy/types.js";

export interface ConfigPack {
    /** 服务端管控平面基地址，如 https://ai.example.corp */
    serverUrl: string;
    /** 登录会话短期凭证（网关代理 + 审计上报共用） */
    token: string;
    userId?: string;
    /** 服务端策略覆盖项（黑名单追加、默认模式等） */
    policy?: Partial<PolicyConfig>;
    /** 管理端下发的建议工作区目录 */
    workspaces?: string[];
    /** 默认模型标识（管理端从可用模型列表中选择下发） */
    defaultModel?: { provider?: string; modelId: string };
}

class RuntimeConfigStore {
    private pack: ConfigPack | null = null;

    set(pack: ConfigPack): void {
        this.pack = pack;
    }

    get(): ConfigPack | null {
        return this.pack;
    }

    require(): ConfigPack {
        if (!this.pack) throw new Error("sidecar 尚未初始化（缺少 initialize 调用）");
        return this.pack;
    }
}

export const runtimeConfig = new RuntimeConfigStore();
