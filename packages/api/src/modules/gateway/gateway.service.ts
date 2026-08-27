import { DictService } from "@buildingai/dict";
import { Injectable, Logger } from "@nestjs/common";

/**
 * 桌面模型网关配置（dict 存储）
 *
 * apiKeyRef 支持两种写法：
 * - "${ENV_NAME}"：引用服务器环境变量（推荐，密钥不落库）
 * - 明文：直接存储（仅限内网测试）
 */
export interface DesktopGatewayConfig {
    /** 网关是否启用 */
    enabled: boolean;
    /** OpenAI 兼容上游基地址，如 https://tokenrhythm.studio/v1 或内网 vLLM 地址 */
    baseUrl: string;
    /** 上游 API Key 或 ${ENV_VAR} 引用 */
    apiKeyRef?: string;
}

export const GATEWAY_CONFIG_KEY = "desktop_gateway_config";
export const GATEWAY_CONFIG_SCOPE = "gateway";

@Injectable()
export class GatewayService {
    private readonly logger = new Logger(GatewayService.name);

    constructor(private readonly dictService: DictService) {}

    /** 读取并解析网关配置；未启用/未配置返回 null */
    async resolveConfig(): Promise<{ baseUrl: string; apiKey: string } | null> {
        const cfg = await this.dictService.get<Partial<DesktopGatewayConfig>>(
            GATEWAY_CONFIG_KEY,
            {},
            GATEWAY_CONFIG_SCOPE,
        );
        if (!cfg?.enabled || !cfg.baseUrl) return null;

        let apiKey = "";
        if (cfg.apiKeyRef) {
            const envMatch = /^\$\{([A-Z0-9_]+)\}$/.exec(cfg.apiKeyRef.trim());
            if (envMatch) {
                apiKey = process.env[envMatch[1]!] ?? "";
                if (!apiKey) {
                    this.logger.warn(`网关上游密钥环境变量未设置: ${envMatch[1]}`);
                }
            } else {
                apiKey = cfg.apiKeyRef;
            }
        }
        return { baseUrl: cfg.baseUrl.replace(/\/+$/, ""), apiKey };
    }

    /**
     * 转发请求到上游（保持响应为流式能力不受损，不解析 JSON 体）
     */
    async forward(
        method: string,
        pathSuffix: string,
        bodyText: string | undefined,
        contentType: string | undefined,
    ): Promise<Response> {
        const config = await this.resolveConfig();
        if (!config) {
            throw new Error("模型网关未启用或未配置");
        }
        return fetch(`${config.baseUrl}${pathSuffix}`, {
            method,
            headers: {
                ...(contentType ? { "content-type": contentType } : {}),
                ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
            },
            body: bodyText,
            signal: AbortSignal.timeout(600_000),
        });
    }

    async getConfig(): Promise<DesktopGatewayConfig> {
        const cfg = await this.dictService.get<Partial<DesktopGatewayConfig>>(
            GATEWAY_CONFIG_KEY,
            {},
            GATEWAY_CONFIG_SCOPE,
        );
        return {
            enabled: false,
            baseUrl: "",
            ...cfg,
        };
    }

    async setConfig(config: Partial<DesktopGatewayConfig>): Promise<DesktopGatewayConfig> {
        const merged = {
            ...(await this.getConfig()),
            ...config,
        };
        await this.dictService.set(GATEWAY_CONFIG_KEY, merged, {
            group: GATEWAY_CONFIG_SCOPE,
            description: "桌面端模型网关上游配置",
        });
        // 密钥不回显
        return { ...merged, apiKeyRef: undefined };
    }
}
