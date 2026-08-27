import {
  type TencentSmsConfig,
  useTencentSmsConfigQuery,
  useUpdateSmsConfigStatusMutation,
  useUpdateTencentSmsConfigMutation,
} from "@buildingai/services/console";
import { PermissionGuard } from "@buildingai/ui/components/auth/permission-guard";
import { Button } from "@buildingai/ui/components/ui/button";
import { Card, CardContent } from "@buildingai/ui/components/ui/card";
import { Field, FieldLabel } from "@buildingai/ui/components/ui/field";
import { Input } from "@buildingai/ui/components/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

/**
 * 腾讯云短信配置（受控输入，避免 react-hook-form reset 导致无法键入）。
 */
const TencentSms = () => {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [sign, setSign] = useState("");
  const [appId, setAppId] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [accessKeySecret, setAccessKeySecret] = useState("");
  const hydratedRef = useRef(false);

  const { data, isLoading, refetch } = useTencentSmsConfigQuery({
    refetchOnWindowFocus: false,
  });

  const applyConfig = (config: Partial<TencentSmsConfig>) => {
    setSign(config.sign ?? "");
    setAppId(config.appId ?? "");
    setAccessKeyId(config.accessKeyId ?? "");
    setAccessKeySecret(config.accessKeySecret ?? "");
    setEnabled(Boolean(config.enable));
  };

  useEffect(() => {
    if (!data) return;
    setEnabled(Boolean(data.enable));
    if (hydratedRef.current) return;
    setSign(data.sign ?? "");
    setAppId(data.appId ?? "");
    setAccessKeyId(data.accessKeyId ?? "");
    setAccessKeySecret(data.accessKeySecret ?? "");
    hydratedRef.current = true;
  }, [data]);

  const updateStatusMutation = useUpdateSmsConfigStatusMutation("tencent", {
    onSuccess: (result: TencentSmsConfig) => {
      setEnabled(Boolean(result.enable));
      toast.success("腾讯云短信已启用");
      void queryClient.invalidateQueries({ queryKey: ["notice", "sms-config"] });
      void refetch();
    },
    onError: (error: Error) => {
      toast.error(error.message || "启用腾讯云短信失败");
    },
  });

  const updateMutation = useUpdateTencentSmsConfigMutation({
    onSuccess: (result: TencentSmsConfig) => {
      toast.success("腾讯云短信配置已保存");
      applyConfig(result);
      hydratedRef.current = true;
      void refetch();
    },
    onError: (error: Error) => {
      toast.error(error.message || "保存腾讯云短信配置失败");
    },
  });

  const handleSave = () => {
    if (!sign.trim()) {
      toast.error("请输入短信签名");
      return;
    }
    if (!appId.trim()) {
      toast.error("请输入腾讯云 APP KEY");
      return;
    }
    if (!accessKeyId.trim()) {
      toast.error("请输入腾讯云 SECRET ID");
      return;
    }
    if (!accessKeySecret.trim()) {
      toast.error("请输入腾讯云 SECRET KEY");
      return;
    }
    setSaving(true);
    updateMutation.mutate(
      {
        sign: sign.trim(),
        appId: appId.trim(),
        accessKeyId: accessKeyId.trim(),
        accessKeySecret: accessKeySecret.trim(),
      },
      {
        onSettled: () => setSaving(false),
      },
    );
  };

  const handleEnable = () => {
    setSaving(true);
    updateStatusMutation.mutate({ enable: true }, { onSettled: () => setSaving(false) });
  };

  const handleReset = () => {
    if (data) {
      applyConfig(data);
      return;
    }
    setSign("");
    setAppId("");
    setAccessKeyId("");
    setAccessKeySecret("");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-full">
              <MessageSquare className="text-primary size-5" />
            </div>
            <span className="text-sm font-medium">腾讯云短信</span>
          </div>
          <PermissionGuard permissions="notice:sms-config-update-status">
            <Button
              type="button"
              size="sm"
              variant={enabled ? "outline" : "default"}
              disabled={enabled || saving}
              onClick={handleEnable}
            >
              {saving && !enabled && <Loader2 className="mr-2 size-4 animate-spin" />}
              {enabled ? "已启用" : "启用"}
            </Button>
          </PermissionGuard>
        </CardContent>
      </Card>

      <Field>
        <FieldLabel>
          <span className="text-destructive">*</span> 短信签名
        </FieldLabel>
        <Input
          value={sign}
          onChange={(e) => setSign(e.target.value)}
          placeholder="请输入短信签名"
          autoComplete="off"
        />
      </Field>

      <Field>
        <FieldLabel>
          <span className="text-destructive">*</span> APP_ID
        </FieldLabel>
        <Input
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          placeholder="请输入腾讯云 APP KEY"
          autoComplete="off"
        />
      </Field>

      <Field>
        <FieldLabel>
          <span className="text-destructive">*</span> SECRET_ID
        </FieldLabel>
        <Input
          value={accessKeyId}
          onChange={(e) => setAccessKeyId(e.target.value)}
          placeholder="请输入腾讯云 SECRET ID"
          autoComplete="off"
        />
      </Field>

      <Field>
        <FieldLabel>
          <span className="text-destructive">*</span> SECRET_KEY
        </FieldLabel>
        <Input
          type="password"
          value={accessKeySecret}
          onChange={(e) => setAccessKeySecret(e.target.value)}
          placeholder="请输入腾讯云 SECRET KEY"
          autoComplete="new-password"
        />
      </Field>

      <div className="flex items-center gap-2">
        <PermissionGuard permissions="notice:sms-config-update-tencent">
          <Button type="button" disabled={saving} onClick={handleSave}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            保存设置
          </Button>
        </PermissionGuard>
        <PermissionGuard permissions="notice:sms-scene-settings-detail">
          <Button asChild type="button" variant="outline">
            <Link to="/console/notice/notification-settings">通知设置</Link>
          </Button>
        </PermissionGuard>
        <Button type="button" variant="outline" onClick={handleReset}>
          重置设置
        </Button>
      </div>
    </div>
  );
};

export default TencentSms;
