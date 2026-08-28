import { useMutation, useQuery } from "@tanstack/react-query";
import type { QueryOptionsUtil } from "@buildingai/web-types";

import { consoleHttpClient } from "../base";

export type AliyunSmsConfig = {
    sign: string;
    accessKeyId: string;
    accessKeySecret: string;
    templateCode?: string;
    loginTemplateCode?: string;
    registerTemplateCode?: string;
    bindMobileTemplateCode?: string;
    changeMobileTemplateCode?: string;
    findPasswordTemplateCode?: string;
    enable?: boolean;
};

export type TencentSmsConfig = {
    sign: string;
    appId: string;
    accessKeyId: string;
    accessKeySecret: string;
    templateCode?: string;
    enable?: boolean;
};

export type UpdateAliyunSmsConfigDto = Omit<AliyunSmsConfig, "enable">;
export type UpdateTencentSmsConfigDto = Omit<TencentSmsConfig, "enable">;

export type UpdateSmsConfigStatusDto = {
    enable: boolean;
};

export type SmsSceneSetting = {
    scene: number;
    sceneName: string;
    noticeType: "验证码";
    smsEnabled: boolean;
    smsTemplateId: string;
    smsContent: string;
    emailEnabled: boolean | null;
};

export type UpdateSmsSceneSettingDto = {
    enable: boolean;
    templateId: string;
    content: string;
};


/**
 * 获取阿里云短信配置
 */
export function useAliyunSmsConfigQuery(options?: QueryOptionsUtil<AliyunSmsConfig>) {
    return useQuery<AliyunSmsConfig>({
        queryKey: ["notice", "sms-config", "aliyun"],
        queryFn: () => consoleHttpClient.get<AliyunSmsConfig>("/notice/sms-config/aliyun"),
        ...options,
    });
}

/**
 * 获取通知设置中的短信场景配置列表
 */
export function useSmsSceneSettingsQuery(options?: QueryOptionsUtil<SmsSceneSetting[]>) {
    return useQuery<SmsSceneSetting[]>({
        queryKey: ["notice", "sms-scene-settings"],
        queryFn: () => consoleHttpClient.get<SmsSceneSetting[]>("/notice/sms-scene-settings"),
        ...options,
    });
}

/**
 * 更新单个短信场景配置
 */
export function useUpdateSmsSceneSettingMutation(scene: number, options?: any) {
    return useMutation<SmsSceneSetting, Error, UpdateSmsSceneSettingDto>({
        mutationFn: (data) =>
            consoleHttpClient.patch<SmsSceneSetting>(`/notice/sms-scene-settings/${scene}`, data),
        ...options,
    });
}

/**
 * 获取腾讯云短信配置
 */
export function useTencentSmsConfigQuery(options?: QueryOptionsUtil<TencentSmsConfig>) {
    return useQuery<TencentSmsConfig>({
        queryKey: ["notice", "sms-config", "tencent"],
        queryFn: () => consoleHttpClient.get<TencentSmsConfig>("/notice/sms-config/tencent"),
        ...options,
    });
}

/**
 * 更新阿里云短信配置
 */
export function useUpdateAliyunSmsConfigMutation(options?: any) {
    return useMutation<AliyunSmsConfig, Error, UpdateAliyunSmsConfigDto>({
        mutationFn: (data) =>
            consoleHttpClient.post<AliyunSmsConfig>("/notice/sms-config/aliyun", data),
        ...options,
    });
}

/**
 * 更新腾讯云短信配置
 */
export function useUpdateTencentSmsConfigMutation(options?: any) {
    return useMutation<TencentSmsConfig, Error, UpdateTencentSmsConfigDto>({
        mutationFn: (data) =>
            consoleHttpClient.post<TencentSmsConfig>("/notice/sms-config/tencent", data),
        ...options,
    });
}

/**
 * 更新短信渠道启用状态（互斥启用）
 */
export function useUpdateSmsConfigStatusMutation(provider: "aliyun" | "tencent", options?: any) {
    return useMutation<AliyunSmsConfig | TencentSmsConfig, Error, { enable: boolean }>({
        mutationFn: (data) =>
            consoleHttpClient.patch<AliyunSmsConfig | TencentSmsConfig>(
                `/notice/sms-config/${provider}/status`,
                data,
            ),
        ...options,
    });
}
