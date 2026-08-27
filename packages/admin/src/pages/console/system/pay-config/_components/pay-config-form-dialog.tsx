import {
  Merchant,
  PayConfigPayType,
  type PayConfigType,
  PayVersion,
} from "@buildingai/constants/shared/payconfig.constant";
import { BooleanNumber } from "@buildingai/constants/shared/status-codes.constant";
import {
  PayConfigPayTypeLabels,
  type SystemPayConfigDetail,
  useSystemPayconfigDetailQuery,
  useUpdateSystemPayconfigMutation,
} from "@buildingai/services/console";
import { PermissionGuard } from "@buildingai/ui/components/auth/permission-guard";
import { Button } from "@buildingai/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import { FieldDescription } from "@buildingai/ui/components/ui/field";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@buildingai/ui/components/ui/form";
import { ImageUpload } from "@buildingai/ui/components/ui/image-upload";
import { Input } from "@buildingai/ui/components/ui/input";
import { ScrollArea } from "@buildingai/ui/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@buildingai/ui/components/ui/select";
import { Textarea } from "@buildingai/ui/components/ui/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

const wechatConfigSchema = z.object({
  payVersion: z.enum([PayVersion.V2, PayVersion.V3]),
  merchantType: z.enum([Merchant.ORDINARY, Merchant.CHILD]),
  mchId: z.string().min(1, "商户号不能为空"),
  apiKey: z.string().min(1, "商户API密钥不能为空"),
  paySignKey: z.string().min(1, "微信支付密钥不能为空"),
  cert: z.string().min(1, "微信支付证书不能为空"),
});

const alipayConfigSchema = z.object({
  appId: z.string().min(1, "AppID不能为空"),
  privateKey: z.string().min(1, "应用私钥不能为空"),
  gateway: z.string().optional(),
  appCert: z.string().min(1, "应用公钥证书不能为空"),
  alipayPublicCert: z.string().min(1, "支付宝公钥证书不能为空"),
  alipayRootCert: z.string().min(1, "支付宝根证书不能为空"),
});

const formSchema = z
  .object({
    name: z.string().min(1, "显示名称不能为空"),
    logo: z.string().min(1, "图标不能为空"),
    isEnable: z.boolean(),
    isDefault: z.boolean(),
    sort: z.number().int().min(0, "排序必须大于等于0"),
    payType: z.number(),
    wechatConfig: wechatConfigSchema.optional(),
    alipayConfig: alipayConfigSchema.optional(),
  })
  .refine(
    (data) => {
      if (data.payType === PayConfigPayType.WECHAT) {
        return !!data.wechatConfig;
      }
      if (data.payType === PayConfigPayType.ALIPAY) {
        return !!data.alipayConfig;
      }
      return false;
    },
    {
      message: "请填写完整的支付配置",
    },
  );

type FormValues = z.infer<typeof formSchema>;

type PayConfigFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configId: string | null;
  onSuccess?: () => void;
};

export const PayConfigFormDialog = ({
  open,
  onOpenChange,
  configId,
  onSuccess,
}: PayConfigFormDialogProps) => {
  const { data: rawDetail, isLoading: isLoadingDetail } = useSystemPayconfigDetailQuery(
    configId || "",
    { enabled: open && !!configId },
  );
  const detail = rawDetail as SystemPayConfigDetail | undefined;

  const updateMutation = useUpdateSystemPayconfigMutation({
    onSuccess: () => {
      toast.success("支付配置已更新");
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema as any),
    defaultValues: {
      name: "",
      logo: "",
      isEnable: true,
      isDefault: false,
      sort: 0,
      payType: PayConfigPayType.WECHAT,
      wechatConfig: undefined,
      alipayConfig: undefined,
    },
  });

  const payType = form.watch("payType");

  useEffect(() => {
    if (detail && open) {
      const isWeChat = detail.payType === PayConfigPayType.WECHAT;
      const config = detail.config as any;

      form.reset({
        name: detail.name,
        logo: detail.logo,
        isEnable: detail.isEnable === BooleanNumber.YES,
        isDefault: detail.isDefault === BooleanNumber.YES,
        sort: detail.sort,
        payType: detail.payType,
        wechatConfig: isWeChat
          ? {
              payVersion: config?.payVersion || PayVersion.V3,
              merchantType: config?.merchantType || Merchant.ORDINARY,
              mchId: config?.mchId || "",
              apiKey: config?.apiKey || "",
              paySignKey: config?.paySignKey || "",
              cert: config?.cert || "",
            }
          : undefined,
        alipayConfig: !isWeChat
          ? {
              appId: config?.appId || "",
              privateKey: config?.privateKey || "",
              gateway: config?.gateway || "",
              appCert: config?.appCert || "",
              alipayPublicCert: config?.alipayPublicCert || "",
              alipayRootCert: config?.alipayRootCert || "",
            }
          : undefined,
      });
    }
  }, [detail, open, form]);

  const onSubmit = (values: FormValues) => {
    if (!configId) return;

    const payload = {
      id: configId,
      name: values.name,
      logo: values.logo,
      isEnable: values.isEnable ? BooleanNumber.YES : BooleanNumber.NO,
      isDefault: values.isDefault ? BooleanNumber.YES : BooleanNumber.NO,
      sort: values.sort,
      payType: values.payType,
      config:
        values.payType === PayConfigPayType.WECHAT ? values.wechatConfig : values.alipayConfig,
    };

    updateMutation.mutate(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑支付配置</DialogTitle>
          <DialogDescription>
            {payType === PayConfigPayType.WECHAT ? "微信支付配置" : "支付宝支付配置"}
          </DialogDescription>
        </DialogHeader>

        {isLoadingDetail ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <ScrollArea className="h-[60vh] **:data-[slot=scroll-area-scrollbar]:hidden">
                <div className="space-y-4 px-1">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="payType"
                      render={({ field }) => {
                        const displayText =
                          PayConfigPayTypeLabels[field.value as PayConfigType] ?? "未知支付方式";
                        return (
                          <FormItem>
                            <FormLabel>支付方式</FormLabel>
                            <FormControl>
                              <Input value={displayText} disabled />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            显示名称<span className="text-destructive">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="请输入显示名称" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="logo"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>图标</FormLabel>
                          <FormControl>
                            <ImageUpload
                              className="h-16 w-16!"
                              size="lg"
                              value={field.value ?? ""}
                              onChange={(url) => field.onChange(url ?? "")}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="sort"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            排序权重<span className="text-destructive">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              onChange={(e) => field.onChange(Number(e.target.value))}
                              placeholder="请输入排序权重"
                            />
                          </FormControl>
                          <FormDescription>排序权重越大，显示越靠前</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* 微信支付配置 */}
                  {payType === PayConfigPayType.WECHAT && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="wechatConfig.payVersion"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                微信支付接口版本<span className="text-destructive">*</span>
                              </FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                value={field.value ?? PayVersion.V3}
                              >
                                <FormControl>
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="选择支付版本" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value={PayVersion.V3}>V3</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormDescription>暂时只支持V3版本</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="wechatConfig.merchantType"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                商户类型<span className="text-destructive">*</span>
                              </FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                value={field.value ?? Merchant.ORDINARY}
                              >
                                <FormControl>
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="选择商户类型" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value={Merchant.ORDINARY}>普通商户</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormDescription>
                                暂时只支持普通商户类型，服务商户类型模式暂不支持
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FieldDescription>
                        微信 APPID 请在{" "}
                        <Link to="/console/channel/wechat-oa" className="text-primary">
                          渠道 - 微信公众号配置
                        </Link>{" "}
                        中设置
                      </FieldDescription>
                      <FormField
                        control={form.control}
                        name="wechatConfig.mchId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              微信商户号<span className="text-destructive">*</span>
                            </FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="请输入商户号" />
                            </FormControl>
                            <FormDescription>微信支付商户号（MCHID）</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="wechatConfig.apiKey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              商户API密钥<span className="text-destructive">*</span>
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                placeholder="请输入商户API密钥"
                                className="h-24 resize-none font-mono text-sm"
                              />
                            </FormControl>
                            <FormDescription>微信支付商户API密钥(paySignKey)</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="wechatConfig.cert"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              微信支付证书<span className="text-destructive">*</span>
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                rows={5}
                                placeholder="请输入微信支付证书内容"
                                className="h-24 resize-none font-mono text-sm"
                              />
                            </FormControl>
                            <FormDescription>
                              微信支付证书（apiclient_cert.pem），前往微信商家平台生成并黏贴至此处
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="wechatConfig.paySignKey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              微信支付密钥<span className="text-destructive">*</span>
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                placeholder="请输入微信支付密钥"
                                className="h-24 resize-none font-mono text-sm"
                              />
                            </FormControl>
                            <FormDescription>
                              微信支付证书密钥（apiclient_key.pem），前往微信商家平台生成并黏贴至此处
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}

                  {/* 支付宝配置 */}
                  {payType === PayConfigPayType.ALIPAY && (
                    <div className="space-y-4">
                      <FormField
                        control={form.control}
                        name="alipayConfig.appId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              AppID<span className="text-destructive">*</span>
                            </FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="请输入AppID" />
                            </FormControl>
                            <FormDescription>请填写开发平台申请的应用 ID 信息</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="alipayConfig.gateway"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>网关地址</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="请输入网关地址" />
                            </FormControl>
                            <FormDescription>支付宝开放平台网关地址</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="alipayConfig.privateKey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              应用私钥<span className="text-destructive">*</span>
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                placeholder="请输入应用私钥"
                                className="h-24 resize-none font-mono text-sm"
                              />
                            </FormControl>
                            <FormDescription>应用私钥内容(PKCS8格式)</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="alipayConfig.appCert"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              应用公钥证书<span className="text-destructive">*</span>
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                placeholder="请输入应用公钥证书内容"
                                className="h-24 resize-none font-mono text-sm"
                              />
                            </FormControl>
                            <FormDescription>应用公钥证书内容(appCertPublicKey)</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="alipayConfig.alipayPublicCert"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              支付宝公钥证书<span className="text-destructive">*</span>
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                placeholder="请输入支付宝公钥证书内容"
                                className="h-24 resize-none font-mono text-sm"
                              />
                            </FormControl>
                            <FormDescription>
                              支付宝公钥证书内容(alipayCertPublicKey)
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="alipayConfig.alipayRootCert"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              支付宝根证书<span className="text-destructive">*</span>
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                placeholder="请输入支付宝根证书内容"
                                className="h-24 resize-none font-mono text-sm"
                              />
                            </FormControl>
                            <FormDescription>支付宝根证书内容(alipayRootCert)</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}
                </div>
              </ScrollArea>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={updateMutation.isPending}
                >
                  取消
                </Button>
                <PermissionGuard permissions="system-payconfig:update">
                  <Button type="submit" disabled={updateMutation.isPending}>
                    {updateMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                    保存
                  </Button>
                </PermissionGuard>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
};
