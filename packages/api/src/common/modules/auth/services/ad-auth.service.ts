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
    /**
     * 只读服务账号 DN（可选，用于枚举全量域用户做定时同步）
     * 例如 CN=svc-ldap,CN=Users,DC=cnpe,DC=cc
     */
    serviceAccountDn?: string;
    /** 只读服务账号密码（仅存 dict，不落日志） */
    serviceAccountPassword?: string;
}

/** 从 AD 读取到的用户信息 */
export interface AdUserInfo {
    /** sAMAccountName */
    username: string;
    /** displayName，可能为空 */
    displayName?: string;
    /** mail，可能为空 */
    email?: string;
    /** 完整 DN */
    dn: string;
    /** DN 中自内向外的 OU 名序列（已剔除 baseDN 自身的 OU），最近部门在前 */
    ouNames: string[];
    /** 域账号是否被禁用（userAccountControl 第 2 位） */
    disabled: boolean;
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

    /**
     * 验证账号密码并读取用户属性（登录场景使用）
     *
     * 与 verify() 相同的绑定流程，但在绑定成功的连接上追加一次针对该用户的
     * 属性搜索（displayName/mail/userAccountControl/dn），用于首登建档与资料同步。
     * 不需要额外服务账号——用用户自己的凭据即可完成读取。
     *
     * @returns 验证失败返回 null；成功返回用户属性
     */
    async verifyWithAttributes(username: string, password: string): Promise<AdUserInfo | null> {
        const config = await this.getConfig();
        if (!config.enabled || !config.host || !config.baseDN) {
            return null;
        }

        const bindDn = this.buildBindDn(username, config);
        const url = `${config.useLdaps ? "ldaps" : "ldap"}://${config.host}:${config.port}`;
        const timeout = config.timeout ?? 3000;

        return new Promise<AdUserInfo | null>((resolve) => {
            const client = ldap.createClient({ url, timeout, connectTimeout: timeout });
            let settled = false;
            const done = (result: AdUserInfo | null) => {
                if (settled) return;
                settled = true;
                try {
                    client.unbind(() => undefined);
                } catch {
                    // 忽略 unbind 异常
                }
                resolve(result);
            };

            client.on("error", (err: Error) => {
                this.logger.warn(`AD 连接异常(${username}): ${err.message}`);
                done(null);
            });

            client.bind(bindDn, password, (err: Error | null) => {
                if (err) {
                    this.logger.debug(`AD bind 失败(${username}): ${err.message}`);
                    done(null);
                    return;
                }
                this.searchOneUser(client, config, username)
                    .then((info) => done(info))
                    .catch((e: Error) => {
                        this.logger.warn(`AD 属性读取失败(${username}): ${e.message}`);
                        // 绑定已通过：至少返回基础信息保证登录可用
                        done({
                            username,
                            dn: "",
                            ouNames: [],
                            disabled: false,
                        });
                    });
            });
        });
    }

    /**
     * 使用只读服务账号枚举域用户（定时同步使用）
     *
     * 未配置服务账号时返回 null（调用方跳过本轮同步）。
     *
     * @param maxEntries 最大拉取条数（默认 5000）
     */
    async listDomainUsers(maxEntries = 5000): Promise<AdUserInfo[] | null> {
        const config = await this.getConfig();
        if (!config.enabled || !config.serviceAccountDn || !config.serviceAccountPassword) {
            return null;
        }

        const url = `${config.useLdaps ? "ldaps" : "ldap"}://${config.host}:${config.port}`;
        const timeout = config.timeout ?? 3000;

        return new Promise<AdUserInfo[] | null>((resolve) => {
            const client = ldap.createClient({ url, timeout, connectTimeout: timeout });
            let settled = false;
            const done = (result: AdUserInfo[] | null, err?: Error) => {
                if (settled) return;
                settled = true;
                try {
                    client.unbind(() => undefined);
                } catch {
                    // 忽略 unbind 异常
                }
                if (err) this.logger.warn(`AD 枚举用户失败: ${err.message}`);
                resolve(result);
            };

            client.on("error", (err: Error) => done(null, err));

            client.bind(config.serviceAccountDn!, config.serviceAccountPassword!, (err: Error | null) => {
                if (err) {
                    done(null, new Error(`服务账号绑定失败: ${err.message}`));
                    return;
                }
                const filter = "(&(objectClass=user)(!(objectClass=computer)))";
                client.search(
                    config.baseDN,
                    {
                        scope: "sub",
                        filter,
                        sizeLimit: maxEntries,
                        attributes: ["sAMAccountName", "displayName", "mail", "userAccountControl"],
                    },
                    (searchErr, res) => {
                        if (searchErr) {
                            done(null, searchErr);
                            return;
                        }
                        const users: AdUserInfo[] = [];
                        res.on("searchEntry", (entry: { object?: Record<string, unknown>; pojo?: { objectName?: string } }) => {
                            const obj = entry.object;
                            const sam = String(obj?.["sAMAccountName"] ?? "");
                            if (!sam) return;
                            const uac = Number(obj?.["userAccountControl"] ?? 512);
                            const dn =
                                entry.pojo?.objectName ??
                                (typeof obj?.dn === "string" ? (obj.dn as string) : "");
                            users.push({
                                username: sam,
                                displayName: obj?.["displayName"] ? String(obj.displayName) : undefined,
                                email: obj?.["mail"] ? String(obj.mail) : undefined,
                                dn,
                                ouNames: extractOuNames(dn, config.baseDN),
                                disabled: Number.isFinite(uac) && (uac & 2) !== 0,
                            });
                        });
                        res.on("error", (e: Error) => {
                            // sizeLimit 达到也会触发 error，已有结果时按部分成功处理
                            done(users.length > 0 ? users : null, e);
                        });
                        res.on("end", () => done(users));
                    },
                );
            });
        });
    }

    /** 在已绑定的连接上搜索单个用户属性 */
    private searchOneUser(
        client: ldap.Client,
        config: AdAuthConfig,
        username: string,
    ): Promise<AdUserInfo | null> {
        return new Promise((resolve, reject) => {
            // 用户名已在调用侧校验格式；此处仅组装过滤条件
            const filter = `(sAMAccountName=${username.replace(/[()\\\x00*]/g, "")})`;
            client.search(
                config.baseDN,
                {
                    scope: "sub",
                    filter,
                    sizeLimit: 1,
                    attributes: ["sAMAccountName", "displayName", "mail", "userAccountControl"],
                },
                (err, res) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    let found: AdUserInfo | null = null;
                    res.on("searchEntry", (entry: { object?: Record<string, unknown>; pojo?: { objectName?: string } }) => {
                        const obj = entry.object;
                        const uac = Number(obj?.["userAccountControl"] ?? 512);
                        const dn =
                            entry.pojo?.objectName ??
                            (typeof obj?.dn === "string" ? (obj.dn as string) : "");
                        found = {
                            username: String(obj?.["sAMAccountName"] ?? username),
                            displayName: obj?.["displayName"] ? String(obj.displayName) : undefined,
                            email: obj?.["mail"] ? String(obj.mail) : undefined,
                            dn,
                            ouNames: extractOuNames(dn, config.baseDN),
                            disabled: Number.isFinite(uac) && (uac & 2) !== 0,
                        };
                    });
                    res.on("error", (e: Error) => reject(e));
                    res.on("end", () => resolve(found));
                },
            );
        });
    }
}

/**
 * 从 DN 中提取自内向外的 OU 名序列（剔除 baseDN 自身包含的 OU 段与 DC 段）。
 * 例：CN=张三,OU=研发组,OU=技术中心,OU=cnpe,DC=cnpe,DC=cc 且 baseDN=OU=cnpe,...
 * → ["研发组", "技术中心"]
 */
export function extractOuNames(dn: string, baseDN: string): string[] {
    if (!dn) return [];
    // baseDN 自身的 OU/DC 组件名（小写），避免把组织根 OU 当部门
    const excluded = new Set<string>();
    for (const part of baseDN.split(",")) {
        const m = /^(ou|dc)=([^,]+)$/i.exec(part.trim());
        if (m) excluded.add(m[2]!.trim().toLowerCase());
    }
    const names: string[] = [];
    for (const m of dn.matchAll(/(?:^|,)OU=([^,]+)/gi)) {
        const name = m[1]!.trim();
        if (!excluded.has(name.toLowerCase())) names.push(name);
    }
    return names;
}