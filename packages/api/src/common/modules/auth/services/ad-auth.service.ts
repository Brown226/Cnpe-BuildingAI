import { DictService } from "@buildingai/dict";
import { HttpErrorFactory } from "@buildingai/errors";
import { Injectable, Logger } from "@nestjs/common";
import ldap from "ldapjs";

/**
 * AD 认证配置
 *
 * 参数来源于内网 ADHandel.cs 实测：
 * AD_IP=10.30.2.5, AD_Port=389, AD_BaseDN=OU=cnpe,DC=cnpe,DC=cc
 */
export interface AdAuthConfig {
    /** 是否启用 AD 认证 */
    enabled: boolean;
    /** AD 服务器 IP/域名 */
    host: string;
    /** AD 端口（默认 389） */
    port: number;
    /** 基础 DN，如 OU=cnpe,DC=cnpe,DC=cc */
    baseDN: string;
    /** 绑定标识模式：upn（username@cnpe.cc）或 sam（username） */
    bindMode: "upn" | "sam";
    /** UPN 域名后缀（bindMode=upn 时使用），如 cnpe.cc */
    upnDomain?: string;
    /** AD 域名（bindMode=sam 时使用），如 CNPE */
    domain?: string;
    /** 是否使用 LDAPS（636 端口） */
    useLdaps?: boolean;
    /** 连接超时（毫秒） */
    timeout?: number;
}

/**
 * 默认 AD 认证配置
 */
const DEFAULT_AD_CONFIG: AdAuthConfig = {
    enabled: false,
    host: "",
    port: 389,
    baseDN: "",
    bindMode: "sam",
    upnDomain: "",
    domain: "",
    useLdaps: false,
    timeout: 3000,
};

/**
 * AD 认证服务
 *
 * 通过 LDAP BIND 验证用户账号密码（与内网 C# DirectoryEntry 绑定逻辑一致）。
 * 仅做只读验证，不写入 AD；密码仅用于 bind，不落日志。
 */
@Injectable()
export class AdAuthService {
    private readonly logger = new Logger(AdAuthService.name);
    /** dict 中存储 AD 配置的 key 与 scope */
    private static readonly CONFIG_KEY = "ad_auth_config";
    private static readonly CONFIG_SCOPE = "auth";

    constructor(private readonly dictService: DictService) {}

    /**
     * 获取 AD 认证配置
     */
    async getConfig(): Promise<AdAuthConfig> {
        return {
            ...DEFAULT_AD_CONFIG,
            ...(await this.dictService.get<Partial<AdAuthConfig>>(
                AdAuthService.CONFIG_KEY,
                {},
                AdAuthService.CONFIG_SCOPE,
            )),
        };
    }

    /**
     * 保存 AD 认证配置
     *
     * @param config 更新后的配置
     */
    async setConfig(config: Partial<AdAuthConfig>): Promise<AdAuthConfig> {
        const merged = {
            ...DEFAULT_AD_CONFIG,
            ...(await this.dictService.get<Partial<AdAuthConfig>>(
                AdAuthService.CONFIG_KEY,
                {},
                AdAuthService.CONFIG_SCOPE,
            )),
            ...config,
        };
        await this.dictService.set(
            AdAuthService.CONFIG_KEY,
            merged,
            { group: AdAuthService.CONFIG_SCOPE, description: "AD 域认证配置" },
        );
        return merged;
    }

    /**
     * 验证账号密码是否通过 AD 认证
     *
     * @param username 登录账号（samAccountName）
     * @param password 密码
     * @returns 是否验证通过
     */
    async verify(username: string, password: string): Promise<boolean> {
        const config = await this.getConfig();
        if (!config.enabled) {
            // 未启用 AD 时不做 LDAP 验证，由调用方决定降级策略
            return false;
        }
        if (!config.host || !config.baseDN) {
            throw HttpErrorFactory.internal("AD 认证未正确配置（缺少 host 或 baseDN）");
        }

        const bindDn = this.buildBindDn(username, config);
        const url = `${config.useLdaps ? "ldaps" : "ldap"}://${config.host}:${config.port}`;
        const timeout = config.timeout ?? 3000;

        return new Promise<boolean>((resolve) => {
            const client = ldap.createClient({ url, timeout, connectTimeout: timeout });
            const done = (result: boolean) => {
                try {
                    client.unbind((err) => {
                        if (err) this.logger.debug(`AD unbind 失败: ${err.message}`);
                    });
                } catch {
                    // 忽略 unbind 异常
                }
                resolve(result);
            };

            client.on("error", (err) => {
                this.logger.warn(`AD 连接异常: ${err.message}`);
                done(false);
            });

            client.bind(bindDn, password, (err: Error | null) => {
                if (err) {
                    this.logger.debug(`AD bind 失败(${username}): ${err.message}`);
                    done(false);
                    return;
                }
                done(true);
            });
        });
    }

    /**
     * 构建绑定 DN
     *
     * @param username 登录账号
     * @param config AD 配置
     */
    private buildBindDn(username: string, config: AdAuthConfig): string {
        if (config.bindMode === "upn" && config.upnDomain) {
            return `${username}@${config.upnDomain}`;
        }
        if (config.bindMode === "sam" && config.domain) {
            return `${config.domain}\\${username}`;
        }
        // 兜底：samAccountName 直接绑定（部分 AD 配置允许）
        return username;
    }
}