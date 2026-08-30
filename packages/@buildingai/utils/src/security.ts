import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * T4.9 凭据加密：AES-256-GCM。
 * 密钥从 env SECRET_ENCRYPTION_KEY 派生（scrypt）；未配置时使用内置回退键
 * （保证开箱可用，生产部署应显式配置——见 .env.example）。
 * 密文格式 v1:<iv_b64>:<tag_b64>:<cipher_b64>，带版本前缀便于将来轮换。
 */
const GCM_PREFIX = "v1:";
const KEY_SALT = "buildingai.secret.v1";

function deriveKey(): Buffer {
    const secret = process.env.SECRET_ENCRYPTION_KEY || "buildingai-insecure-fallback-key";
    return scryptSync(secret, KEY_SALT, 32);
}

/**
 * Encrypt field value (AES-256-GCM)
 * @param plainValue Plaintext value
 * @returns Encrypted value（v1 格式；空串原样返回）
 */
export const encryptValue = (plainValue: string): string => {
    if (!plainValue) return plainValue;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
    const enc = Buffer.concat([cipher.update(plainValue, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${GCM_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
};

/**
 * Decrypt field value
 * 兼容三代数据：v1 GCM 密文 → 历史 base64 → 明文原文（解不开时兜底返回原值）。
 * @param encryptedValue Encrypted value
 * @returns Decrypted value
 */
export const decryptValue = (encryptedValue: string): string => {
    if (!encryptedValue) return encryptedValue;
    // v1：AES-256-GCM
    if (encryptedValue.startsWith(GCM_PREFIX)) {
        try {
            const [ivB64, tagB64, dataB64] = encryptedValue.slice(GCM_PREFIX.length).split(":");
            if (!ivB64 || !tagB64 || !dataB64) return encryptedValue;
            const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivB64, "base64"));
            decipher.setAuthTag(Buffer.from(tagB64, "base64"));
            return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
        } catch {
            // tag 校验失败（密钥轮换/数据损坏）：按约定返回原值由上层兜底
            return encryptedValue;
        }
    }
    // 历史 base64（升级前数据，惰性兼容）
    try {
        const decoded = Buffer.from(encryptedValue, "base64").toString("utf8");
        // base64 解码在 Node 不抛错：解码结果含替换符/控制字符过多时视为明文原样返回
        const controlChars = (decoded.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/g) ?? []).length;
        if (decoded && controlChars / Math.max(decoded.length, 1) < 0.1) {
            return decoded;
        }
        return encryptedValue;
    } catch {
        return encryptedValue;
    }
};

/** jsonb 凭据对象整体加密（MCP headers 等）：{ __enc, v, data } 封装 */
const ENC_RECORD_MARKER = "__enc";

export function encryptRecord(
    record?: Record<string, string> | null,
): Record<string, string> | undefined {
    if (!record || Object.keys(record).length === 0) return record ?? undefined;
    if ((record as Record<string, unknown>)[ENC_RECORD_MARKER]) return record; // 已加密
    return {
        [ENC_RECORD_MARKER]: "v1",
        data: encryptValue(JSON.stringify(record)),
    } as unknown as Record<string, string>;
}

export function decryptRecord(
    record?: Record<string, string> | null,
): Record<string, string> | undefined {
    if (!record) return record ?? undefined;
    const marker = (record as Record<string, unknown>)[ENC_RECORD_MARKER];
    if (!marker) return record; // 未加密（历史明文）
    try {
        const data = (record as unknown as { data: string }).data;
        return JSON.parse(decryptValue(data)) as Record<string, string>;
    } catch {
        return {};
    }
}

/**
 * Mask sensitive value (e.g., API keys, secrets)
 * Shows first few and last few characters, masks the middle part
 * @param value Original value to mask
 * @param visiblePrefixLength Number of characters to show at the beginning (default: 4)
 * @param visibleSuffixLength Number of characters to show at the end (default: 4)
 * @param maskChar Character to use for masking (default: '*')
 * @returns Masked value
 *
 * @example
 * maskSensitiveValue('abcdefghijklmnop') // Returns 'abcd************mnop'
 * maskSensitiveValue('short') // Returns '*****'
 */
export const maskSensitiveValue = (
    value: string,
    visiblePrefixLength = 4,
    visibleSuffixLength = 4,
    maskChar = "*",
): string => {
    if (!value || value.length === 0) {
        return "";
    }

    // If value is too short, mask everything
    const minLength = visiblePrefixLength + visibleSuffixLength;
    if (value.length <= minLength) {
        return maskChar.repeat(value.length);
    }

    // Extract prefix and suffix
    const prefix = value.substring(0, visiblePrefixLength);
    const suffix = value.substring(value.length - visibleSuffixLength);

    // Calculate mask length
    const maskLength = value.length - visiblePrefixLength - visibleSuffixLength;
    const mask = maskChar.repeat(maskLength);

    return `${prefix}${mask}${suffix}`;
};
