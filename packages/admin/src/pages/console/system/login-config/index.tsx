import type { LoginType } from "@buildingai/constants";
import { LOGIN_TYPE } from "@buildingai/constants/shared/auth";
import { useLoginSettingsQuery, useSetLoginSettingsMutation } from "@buildingai/services/console";
import {
  useAdConfigQuery,
  useSetAdConfigMutation,
  useTestAdConfigMutation,
} from "@buildingai/services/console";
import { PermissionGuard } from "@buildingai/ui/components/auth/permission-guard";
import { Button } from "@buildingai/ui/components/ui/button";
import { Checkbox } from "@buildingai/ui/components/ui/checkbox";
import { Input } from "@buildingai/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@buildingai/ui/components/ui/select";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@buildingai/ui/components/ui/field";
import { Label } from "@buildingai/ui/components/ui/label";
import { Switch } from "@buildingai/ui/components/ui/switch";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { PageContainer } from "@/layouts/console/_components/page-container";

const LOGIN_TYPE_OPTIONS: { value: LoginType; label: string }[] = [
  { value: LOGIN_TYPE.ACCOUNT as LoginType, label: "账号" },
  { value: LOGIN_TYPE.WECHAT as LoginType, label: "微信" },
  { value: LOGIN_TYPE.PHONE as LoginType, label: "手机号" },
];

const defaultConfig = {
  allowedLoginMethods: [LOGIN_TYPE.ACCOUNT, LOGIN_TYPE.WECHAT] as LoginType[],
  allowedRegisterMethods: [LOGIN_TYPE.ACCOUNT, LOGIN_TYPE.WECHAT] as LoginType[],
  allowMultipleLogin: true,
  showPolicyAgreement: true,
};

const SystemLoginConfigIndexPage = () => {
  const { data, isLoading } = useLoginSettingsQuery();
  const setMutation = useSetLoginSettingsMutation({
    onSuccess: () => {
      toast.success("保存成功");
    },
    onError: (e) => {
      toast.error(`保存失败: ${e.message}`);
    },
  });

  const [allowedLoginMethods, setAllowedLoginMethods] = useState<LoginType[]>(
    defaultConfig.allowedLoginMethods,
  );
  const [allowedRegisterMethods, setAllowedRegisterMethods] = useState<LoginType[]>(
    defaultConfig.allowedRegisterMethods,
  );
  const [allowMultipleLogin, setAllowMultipleLogin] = useState(defaultConfig.allowMultipleLogin);
  const [showPolicyAgreement, setShowPolicyAgreement] = useState(defaultConfig.showPolicyAgreement);

  // AD 认证配置状态
  const { data: adConfig } = useAdConfigQuery();
  const setAdMutation = useSetAdConfigMutation({
    onSuccess: () => toast.success("AD 配置已保存"),
    onError: (e) => toast.error(`保存失败: ${e.message}`),
  });
  const testAdMutation = useTestAdConfigMutation();
  const [adEnabled, setAdEnabled] = useState(false);
  const [adHost, setAdHost] = useState("");
  const [adPort, setAdPort] = useState("389");
  const [adBaseDN, setAdBaseDN] = useState("");
  const [adBindMode, setAdBindMode] = useState<"upn" | "sam">("sam");
  const [adUpnDomain, setAdUpnDomain] = useState("");
  const [adDomain, setAdDomain] = useState("");
  const [testAccount, setTestAccount] = useState("");
  const [testPassword, setTestPassword] = useState("");

  const adInitial = useMemo(
    () => (adConfig ? { ...adConfig } : null),
    [adConfig],
  );

  useEffect(() => {
    if (!adInitial) return;
    setAdEnabled(adInitial.enabled);
    setAdHost(adInitial.host || "");
    setAdPort(String(adInitial.port ?? 389));
    setAdBaseDN(adInitial.baseDN || "");
    setAdBindMode(adInitial.bindMode || "sam");
    setAdUpnDomain(adInitial.upnDomain || "");
    setAdDomain(adInitial.domain || "");
  }, [adInitial]);

  const handleSaveAd = () => {
    if (adEnabled && (!adHost.trim() || !adBaseDN.trim())) {
      toast.error("启用 AD 认证需填写主机与 BaseDN");
      return;
    }
    setAdMutation.mutate({
      enabled: adEnabled,
      host: adHost.trim(),
      port: parseInt(adPort, 10) || 389,
      baseDN: adBaseDN.trim(),
      bindMode: adBindMode,
      upnDomain: adUpnDomain.trim() || undefined,
      domain: adDomain.trim() || undefined,
    });
  };

  const handleTestAd = () => {
    if (!adHost.trim() || !adBaseDN.trim()) {
      toast.error("请先填写 AD 主机与 BaseDN");
      return;
    }
    testAdMutation.mutate(
      { username: testAccount, password: testPassword },
      {
        onSuccess: (res) => {
          toast.success(res.ok ? "AD 连接测试成功" : "AD 连接测试失败（账号或网络异常）");
        },
      },
    );
  };

  const initialData = useMemo(
    () =>
      data
        ? {
            allowedLoginMethods: data.allowedLoginMethods,
            allowedRegisterMethods: data.allowedRegisterMethods,
            allowMultipleLogin: data.allowMultipleLogin,
            showPolicyAgreement: data.showPolicyAgreement,
          }
        : null,
    [data],
  );

  useEffect(() => {
    if (!initialData) return;
    setAllowedLoginMethods(initialData.allowedLoginMethods);
    setAllowedRegisterMethods(initialData.allowedRegisterMethods);
    setAllowMultipleLogin(initialData.allowMultipleLogin);
    setShowPolicyAgreement(initialData.showPolicyAgreement);
  }, [initialData]);

  const toggleLogin = (value: LoginType) => {
    setAllowedLoginMethods((prev) => {
      const next = prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
      if (next.length === 0) return prev;
      return next;
    });
  };

  const toggleRegister = (value: LoginType) => {
    setAllowedRegisterMethods((prev) => {
      const next = prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
      return next;
    });
  };

  const handleSave = () => {
    if (allowedLoginMethods.length === 0) {
      toast.error("至少保留一种登录方式");
      return;
    }
    setMutation.mutate({
      allowedLoginMethods,
      allowedRegisterMethods,
      allowMultipleLogin,
      showPolicyAgreement,
    });
  };

  const handleReset = () => {
    if (!initialData) return;
    setAllowedLoginMethods(initialData.allowedLoginMethods);
    setAllowedRegisterMethods(initialData.allowedRegisterMethods);
    setAllowMultipleLogin(initialData.allowMultipleLogin);
    setShowPolicyAgreement(initialData.showPolicyAgreement);
    toast.success("已重置为当前保存的配置");
  };

  if (isLoading) {
    return (
      <PageContainer>
        <div className="flex items-center py-12">
          <Loader2 className="text-muted-foreground size-8 animate-spin" />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PermissionGuard permissions="users:get-login-settings">
        <div className="space-y-6 px-3">
          <h1 className="text-2xl font-semibold">登录设置</h1>

          <FieldGroup>
            <FieldLabel>注册方式</FieldLabel>
            <div className="flex flex-wrap gap-6">
              {LOGIN_TYPE_OPTIONS.map((opt) => (
                <div key={opt.value} className="flex items-center gap-2">
                  <Checkbox
                    id={`register-${opt.value}`}
                    checked={allowedRegisterMethods.includes(opt.value)}
                    onCheckedChange={() => toggleRegister(opt.value)}
                  />
                  <Label htmlFor={`register-${opt.value}`} className="cursor-pointer font-normal">
                    {opt.label}注册
                  </Label>
                </div>
              ))}
            </div>
            <FieldDescription>不选择任何方式时，前台将关闭注册入口与自动注册能力</FieldDescription>
          </FieldGroup>

          <FieldGroup>
            <FieldLabel>
              <span className="text-destructive">*</span> 登录方式
            </FieldLabel>
            <div className="flex flex-wrap gap-6">
              {LOGIN_TYPE_OPTIONS.map((opt) => (
                <div key={opt.value} className="flex items-center gap-2">
                  <Checkbox
                    id={`login-${opt.value}`}
                    checked={allowedLoginMethods.includes(opt.value)}
                    onCheckedChange={() => toggleLogin(opt.value)}
                  />
                  <Label htmlFor={`login-${opt.value}`} className="cursor-pointer font-normal">
                    {opt.label}登录
                  </Label>
                </div>
              ))}
            </div>
            <FieldDescription>至少保留一种登录方式</FieldDescription>
          </FieldGroup>

          <FieldGroup>
            <Field>
              <div className="flex max-w-sm items-center justify-between gap-4">
                <div>
                  <FieldLabel>多处登录</FieldLabel>
                  <FieldDescription>是否允许多处同时登录</FieldDescription>
                </div>
                <Switch checked={allowMultipleLogin} onCheckedChange={setAllowMultipleLogin} />
              </div>
            </Field>
            <Field>
              <div className="flex max-w-sm items-center justify-between gap-4">
                <div>
                  <FieldLabel>是否开启协议</FieldLabel>
                  <FieldDescription>用户登录/注册时，是否显示服务协议和隐私政策</FieldDescription>
                </div>
                <Switch checked={showPolicyAgreement} onCheckedChange={setShowPolicyAgreement} />
              </div>
            </Field>
            <FieldDescription>
              微信登录凭证请在{" "}
              <Link to="/console/channel/wechat-oa" className="text-primary">
                渠道 - 微信公众号配置
              </Link>{" "}
              中设置
            </FieldDescription>
          </FieldGroup>

          <div className="flex gap-3">
            <PermissionGuard permissions="users:set-login-settings">
              <Button onClick={handleSave} disabled={setMutation.isPending}>
                {setMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                保存设置
              </Button>

              <Button variant="outline" onClick={handleReset} disabled={!initialData}>
                重置设置
              </Button>
            </PermissionGuard>
          </div>

          {/* AD 域认证配置 */}
          <div className="border-muted mt-8 rounded-lg border p-4">
            <h2 className="text-lg font-semibold">AD 域认证</h2>
            <p className="text-muted-foreground mb-4 text-sm">
              启用后，账号密码将通过内网 AD（LDAP BIND）验证，替代本地密码校验。
            </p>
            <div className="space-y-4">
              <Field>
                <div className="flex max-w-sm items-center justify-between gap-4">
                  <div>
                    <FieldLabel>启用 AD 认证</FieldLabel>
                    <FieldDescription>开启后所有账号登录改为 AD 验证</FieldDescription>
                  </div>
                  <Switch checked={adEnabled} onCheckedChange={setAdEnabled} />
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <FieldLabel required>AD 服务器</FieldLabel>
                  <Input value={adHost} onChange={(e) => setAdHost(e.target.value)} placeholder="如 10.30.2.5" />
                </div>
                <div className="space-y-2">
                  <FieldLabel required>端口</FieldLabel>
                  <Input value={adPort} onChange={(e) => setAdPort(e.target.value)} placeholder="389" />
                </div>
              </div>

              <div className="space-y-2">
                <FieldLabel required>Base DN</FieldLabel>
                <Input
                  value={adBaseDN}
                  onChange={(e) => setAdBaseDN(e.target.value)}
                  placeholder="OU=cnpe,DC=cnpe,DC=cc"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <FieldLabel>绑定模式</FieldLabel>
                  <Select value={adBindMode} onValueChange={(v) => setAdBindMode(v as "upn" | "sam")}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sam">SAM（域\账号）</SelectItem>
                      <SelectItem value="upn">UPN（账号@域名）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {adBindMode === "upn" ? (
                  <div className="space-y-2">
                    <FieldLabel>UPN 域名</FieldLabel>
                    <Input
                      value={adUpnDomain}
                      onChange={(e) => setAdUpnDomain(e.target.value)}
                      placeholder="cnpe.cc"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <FieldLabel>域（SAM 模式）</FieldLabel>
                    <Input
                      value={adDomain}
                      onChange={(e) => setAdDomain(e.target.value)}
                      placeholder="CNPE"
                    />
                  </div>
                )}
              </div>

              <div className="border-muted rounded-lg border p-3">
                <FieldLabel className="mb-2">连接测试</FieldLabel>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    value={testAccount}
                    onChange={(e) => setTestAccount(e.target.value)}
                    placeholder="测试账号（samAccountName）"
                  />
                  <Input
                    type="password"
                    value={testPassword}
                    onChange={(e) => setTestPassword(e.target.value)}
                    placeholder="测试密码"
                  />
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={handleTestAd} disabled={testAdMutation.isPending}>
                    {testAdMutation.isPending && <Loader2 className="mr-1 size-3 animate-spin" />}
                    测试连接
                  </Button>
                  <span className="text-muted-foreground text-xs">
                    使用以上配置尝试绑定（需先保存配置）
                  </span>
                </div>
              </div>

              <div className="flex gap-3">
                <Button onClick={handleSaveAd} disabled={setAdMutation.isPending} variant="secondary">
                  {setAdMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  保存 AD 配置
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PermissionGuard>
    </PageContainer>
  );
};

export default SystemLoginConfigIndexPage;
