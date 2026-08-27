import {
  type Extension,
  useGetApplicationByActivationCodeMutation,
  useInstallByActivationCodeMutation,
} from "@buildingai/services/console";
import { AspectRatio } from "@buildingai/ui/components/ui/aspect-ratio";
import { Button } from "@buildingai/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@buildingai/ui/components/ui/form";
import { Input } from "@buildingai/ui/components/ui/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const formSchema = z.object({
  activationKey: z
    .string({ message: "请输入兑换码" })
    .min(1, "兑换码不能为空")
    .regex(/^[A-Z0-9]+$/, "兑换码格式不正确"),
});

type FormValues = z.infer<typeof formSchema>;

type ActivationInstallDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

/**
 * 兑换码安装应用弹框组件
 */
export const ActivationInstallDialog = ({
  open,
  onOpenChange,
  onSuccess,
}: ActivationInstallDialogProps) => {
  const [step, setStep] = useState<"input" | "confirm">("input");
  const [extensionInfo, setExtensionInfo] = useState<Extension | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      activationKey: "",
    },
  });

  const verifyMutation = useGetApplicationByActivationCodeMutation();

  const installMutation = useInstallByActivationCodeMutation({
    onSuccess: () => {
      toast.success("应用安装成功");
      handleClose();
      onSuccess?.();
    },
  });

  /**
   * 验证兑换码并获取应用详情
   */
  const handleVerifyActivationKey = async (values: FormValues) => {
    try {
      const code = values.activationKey;
      const extension = await verifyMutation.mutateAsync(code);
      if (extension) {
        setExtensionInfo(extension);
        setStep("confirm");
        toast.success("兑换码验证成功");
      }
    } catch (error: any) {
      console.log(`验证失败: ${error.message || "兑换码无效"}`);
    }
  };

  /**
   * 确认安装
   */
  const handleInstall = () => {
    if (!form.getValues("activationKey")) {
      toast.error("安装失败: 未获取到兑换码，请重新验证兑换码");
      setStep("input");
      return;
    }
    if (!extensionInfo?.key) {
      toast.error("安装失败: 未获取到应用标识符，请重新验证兑换码");
      setStep("input");
      return;
    }
    installMutation.mutate({
      activationCode: form.getValues("activationKey"),
      identifier: extensionInfo.key,
    });
  };

  /**
   * 关闭弹框并重置状态
   */
  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setStep("input");
      setExtensionInfo(null);
      form.reset();
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:w-lg">
        {step === "input" ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold">安装新应用</DialogTitle>
              <DialogDescription>请输入您的兑换码以验证应用包合法性</DialogDescription>
            </DialogHeader>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleVerifyActivationKey)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="activationKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          placeholder="请输入兑换码"
                          className="font-mono text-base tracking-widest"
                          autoComplete="off"
                          {...field}
                          onChange={(e) => {
                            const value = e.target.value.toUpperCase();
                            field.onChange(value);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={handleClose}>
                    取消
                  </Button>
                  <Button type="submit" disabled={verifyMutation.isPending}>
                    {verifyMutation.isPending && <Loader2 className="animate-spin" />}
                    兑换
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        ) : (
          <>
            <DialogHeader className="items-center space-y-4">
              {/* 封面图 */}
              <div className="relative w-full">
                <AspectRatio ratio={16 / 9} className="w-full overflow-hidden rounded-lg">
                  <img
                    src={extensionInfo?.cover}
                    alt={extensionInfo?.name}
                    className="h-full w-full object-cover"
                  />
                </AspectRatio>

                {/* 应用图标 */}
                <div className="bg-muted absolute -bottom-8 left-1/2 flex size-16 -translate-x-1/2 items-center justify-center rounded-lg shadow-lg">
                  <img
                    src={extensionInfo?.icon}
                    alt={extensionInfo?.name}
                    className="size-14 rounded-full object-cover"
                  />
                </div>
              </div>

              <div className="mt-8 text-center">
                <DialogTitle className="text-2xl font-bold">{extensionInfo?.name}</DialogTitle>
              </div>
            </DialogHeader>

            <DialogDescription className="line-clamp-5 text-center leading-relaxed">
              {extensionInfo?.describe}
            </DialogDescription>

            <DialogFooter className="flex-col gap-2">
              <Button type="button" variant="secondary" onClick={() => setStep("input")}>
                返回上一步
              </Button>
              <Button onClick={handleInstall} disabled={installMutation.isPending} size="lg">
                {installMutation.isPending && <Loader2 className="animate-spin" />}
                <Download />
                开始部署安装
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
