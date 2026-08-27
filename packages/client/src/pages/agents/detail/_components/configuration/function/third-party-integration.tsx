import type { ThirdPartyIntegrationConfig } from "@buildingai/types";
import { Input } from "@buildingai/ui/components/ui/input";
import { Label } from "@buildingai/ui/components/ui/label";
import { Switch } from "@buildingai/ui/components/ui/switch";
import { memo, useCallback, useMemo } from "react";

type ThirdPartyIntegrationValue = ThirdPartyIntegrationConfig & {
  provider?: "coze" | "dify" | "ragflow";
};

type ThirdPartyIntegrationProps = {
  mode: "coze" | "dify" | "ragflow";
  value: ThirdPartyIntegrationValue | null;
  onChange: (value: ThirdPartyIntegrationValue | null) => void;
};

export const ThirdPartyIntegration = memo(
  ({ mode, value, onChange }: ThirdPartyIntegrationProps) => {
    const config = useMemo<ThirdPartyIntegrationValue>(
      () => ({
        provider: mode,
        appId: value?.appId ?? "",
        apiKey: value?.apiKey ?? "",
        baseURL: value?.baseURL ?? "",
        extendedConfig: value?.extendedConfig,
        variableMapping: value?.variableMapping,
        useExternalConversation: value?.useExternalConversation ?? true,
      }),
      [value],
    );

    const update = useCallback(
      (patch: Partial<ThirdPartyIntegrationValue>) => {
        const botId =
          mode === "coze" ? (patch.appId ?? config.appId ?? "").trim() : undefined;
        const next: ThirdPartyIntegrationValue = {
          ...config,
          ...patch,
          provider: mode,
          extendedConfig: {
            ...(config.extendedConfig ?? {}),
            ...(patch.extendedConfig ?? {}),
            provider: mode,
            ...(botId ? { botId } : {}),
          },
        };

        const requireAppId = mode === "coze" || mode === "ragflow";
        const isEmpty = requireAppId
          ? !next.appId && !next.apiKey && !next.baseURL
          : !next.apiKey && !next.baseURL;

        onChange(isEmpty ? null : next);
      },
      [config, mode, onChange],
    );

    const title =
      mode === "ragflow"
        ? "RagFlow 平台配置"
        : mode === "coze"
          ? "Coze 平台配置"
          : "Dify 平台配置";
    const description =
      mode === "ragflow"
        ? "配置 RagFlow 聊天助手相关参数，系统会通过 RagFlow 提供智能体能力，并按平台用户隔离会话。"
        : mode === "coze"
          ? "配置 Coze Bot 相关参数，系统会从 Coze 获取智能体能力。"
          : "配置 Dify 应用相关参数，系统会通过 Dify 提供智能体能力。";

    return (
      <div className="bg-secondary rounded-lg px-3 py-2.5">
        <div className="mb-3 flex flex-col gap-0.5">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-muted-foreground text-xs">{description}</p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">BASE URL</Label>
            <Input
              placeholder={
                mode === "ragflow"
                  ? "例如：http://10.30.x.x:9380（RagFlow 服务地址）"
                  : mode === "coze"
                    ? "留空默认使用 Coze 官方地址，例如：https://api.coze.cn"
                    : "例如：https://api.dify.ai 或自定义网关地址"
              }
              value={config.baseURL ?? ""}
              className="bg-background"
              onChange={(e) => update({ baseURL: e.target.value.trim() })}
            />
          </div>

          {(mode === "coze" || mode === "ragflow") && (
            <div className="space-y-1.5">
              <Label className="text-xs">
                {mode === "coze" ? "Bot ID" : "Chat ID"}
                <span className="text-destructive ml-0.5">*</span>
              </Label>
              <Input
                placeholder={mode === "coze" ? "请输入 Coze Bot ID" : "请输入 RagFlow 聊天助手 ID"}
                value={config.appId ?? ""}
                className="bg-background"
                onChange={(e) => update({ appId: e.target.value.trim() })}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">
              API Key<span className="text-destructive ml-0.5">*</span>
            </Label>
            <Input
              type="password"
              placeholder="请输入平台 API Key"
              value={config.apiKey ?? ""}
              className="bg-background"
              autoComplete="new-password"
              onChange={(e) => update({ apiKey: e.target.value.trim() })}
            />
          </div>

          <div className="bg-background flex items-center justify-between rounded-md px-3 py-2">
            <div className="flex flex-col">
              <span className="text-sm font-medium">使用平台会话管理</span>
              <span className="text-muted-foreground mt-0.5 text-xs">
                开启后，由第三方平台管理会话上下文，否则由本系统统一管理。
              </span>
            </div>
            <Switch
              checked={config.useExternalConversation ?? true}
              onCheckedChange={(checked) => update({ useExternalConversation: checked })}
            />
          </div>
        </div>
      </div>
    );
  },
);

ThirdPartyIntegration.displayName = "ThirdPartyIntegration";
