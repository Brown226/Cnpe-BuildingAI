import {
  type AliyunSmsConfig,
  useAliyunSmsConfigQuery,
  useUpdateAliyunSmsConfigMutation,
  useUpdateSmsConfigStatusMutation,
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
 * 阿里云短信配置（受控输入，避免 react-hook-form reset 导致无法键入）。
 */
const AliyunSms = () => {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [sign, setSign] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [accessKeySecret, setAccessKeySecret] = useState("");
  const hydratedRef = useRef(false);

  const { data, isLoading, refetch } = useAliyunSmsConfigQuery({
    refetchOnWindowFocus: false,
  });

  const applyConfig = (config: Partial<AliyunSmsConfig>) => {
    setSign(config.sign ?? "");
    setAccessKeyId(config.accessKeyId ?? "");
    setAccessKeySecret(config.accessKeySecret ?? "");
    setEnabled(Boolean(config.enable));
  };

  useEffect(() => {
    if (!data) return;
    setEnabled(Boolean(data.enable));
    if (hydratedRef.current) return;
    setSign(data.sign ?? "");
    setAccessKeyId(data.accessKeyId ?? "");
    setAccessKeySecret(data.accessKeySecret ?? "");
    hydratedRef.current = true;
  }, [data]);

  const updateStatusMutation = useUpdateSmsConfigStatusMutation("aliyun", {
    onSuccess: (result: AliyunSmsConfig) => {
      setEnabled(Boolean(result.enable));
      toast.success("阿里云短信已启用");
      void queryClient.invalidateQueries({ queryKey: ["notice", "sms-config"] });
      void refetch();
    },
    onError: (error: Error) => {
      toast.error(error.message || "启用阿里云短信失败");
    },
  });

  const updateMutation = useUpdateAliyunSmsConfigMutation({
    onSuccess: (result: AliyunSmsConfig) => {
      toast.success("阿里云短信配置已保存");
      applyConfig(result);
      hydratedRef.current = true;
      void refetch();
    },
    onError: (error: Error) => {
      toast.error(error.message || "保存阿里云短信配置失败");
    },
  });

  const handleSave = () => {
    if (!sign.trim()) {
      toast.error("请输入短信签名");
      return;
    }
    if (!accessKeyId.trim()) {
      toast.error("请输入阿里云 AccessKey ID");
      return;
    }
    if (!accessKeySecret.trim()) {
      toast.error("请输入阿里云 AccessKey Secret");
      return;
    }
    setSaving(true);
    updateMutation.mutate(
      {
        sign: sign.trim(),
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
            <span className="text-sm font-medium">阿里云短信</span>
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
          <span className="text-destructive">*</span> AccessKey ID
        </FieldLabel>
        <Input
          value={accessKeyId}
          onChange={(e) => setAccessKeyId(e.target.value)}
          placeholder="请输入阿里云 AccessKey ID"
          autoComplete="off"
        />
      </Field>

      <Field>
        <FieldLabel>
          <span className="text-destructive">*</span> AccessKey Secret
        </FieldLabel>
        <Input
          type="password"
          value={accessKeySecret}
          onChange={(e) => setAccessKeySecret(e.target.value)}
          placeholder="请输入阿里云 AccessKey Secret"
          autoComplete="new-password"
        />
      </Field>

      <div className="flex items-center gap-2">
        <PermissionGuard permissions="notice:sms-config-update-aliyun">
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

export default AliyunSms;
