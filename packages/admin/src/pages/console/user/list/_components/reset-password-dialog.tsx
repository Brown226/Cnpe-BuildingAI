import {
  useResetPasswordAutoMutation,
  useResetPasswordMutation,
} from "@buildingai/services/console";
import { Button } from "@buildingai/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@buildingai/ui/components/ui/form";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@buildingai/ui/components/ui/input-group";
import { useAlertDialog } from "@buildingai/ui/hooks/use-alert-dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Eye, EyeClosed, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const formSchema = z
  .object({
    password: z.string({ message: "请输入新密码" }).min(6, "密码至少8位以上"),
    confirmPassword: z.string({ message: "请确认密码" }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "两次密码输入不一致",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof formSchema>;

type ResetPasswordDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  nickname: string | null;
  onSuccess?: () => void;
};

/**
 * 重置密码弹框组件
 */
export const ResetPasswordDialog = ({
  open,
  onOpenChange,
  userId,
  nickname,
  onSuccess,
}: ResetPasswordDialogProps) => {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const { confirm } = useAlertDialog();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  const resetPasswordMutation = useResetPasswordMutation({
    onSuccess: () => {
      toast.success("密码重置成功");
      onOpenChange(false);
      form.reset();
      setGeneratedPassword(null);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(`重置失败: ${error.message}`);
    },
  });

  const resetPasswordAutoMutation = useResetPasswordAutoMutation({
    onSuccess: (data) => {
      setGeneratedPassword(data.password);
      form.setValue("password", data.password);
      form.setValue("confirmPassword", data.password);
      toast.success("密码生成成功");
    },
    onError: (error) => {
      toast.error(`生成失败: ${error.message}`);
    },
    onSettled: () => {
      setIsGenerating(false);
    },
  });

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // 关闭弹框时重置所有状态
      form.reset();
      setGeneratedPassword(null);
      setShowPassword(false);
      setShowConfirmPassword(false);
      setIsGenerating(false);
    }
    onOpenChange(open);
  };

  const handleSubmit = (values: FormValues) => {
    resetPasswordMutation.mutate({
      id: userId,
      password: values.password,
    });
  };

  const handleGeneratePassword = async () => {
    await confirm({
      title: "随机生成密码",
      description: `确定要随机生成「${nickname}」的密码吗？`,
    });
    setIsGenerating(true);
    resetPasswordAutoMutation.mutate(userId);
  };

  const handleCopyPassword = async () => {
    const password = form.getValues("password");
    if (!password) {
      toast.error("请先生成或输入密码");
      return;
    }
    try {
      await navigator.clipboard.writeText(password);
      toast.success("密码已复制到剪贴板");
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>重置密码</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-primary h-auto p-0 text-sm font-normal hover:bg-transparent"
              onClick={handleGeneratePassword}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1 size-3.5" />
              )}
              {isGenerating ? "生成中..." : "随机生成"}
            </Button>
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {generatedPassword ? (
              // 显示生成的密码
              <div className="space-y-4">
                <FormItem>
                  <FormLabel>生成的密码</FormLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="new-password-input"
                      type="text"
                      placeholder="请输入新密码"
                      disabled
                      value={generatedPassword}
                    />
                    <InputGroupAddon
                      align="inline-end"
                      onClick={handleCopyPassword}
                      className="hover:bg-muted/50 cursor-pointer rounded-sm p-1 transition-colors"
                    >
                      <Copy className="size-4" />
                    </InputGroupAddon>
                  </InputGroup>
                </FormItem>
              </div>
            ) : (
              // 显示密码输入框
              <>
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <span className="text-destructive">*</span>
                        新密码
                      </FormLabel>
                      <FormControl>
                        <InputGroup>
                          <InputGroupInput
                            id="new-password-input"
                            type={showPassword ? "text" : "password"}
                            placeholder="请输入新密码"
                            {...field}
                          />
                          <InputGroupAddon
                            align="inline-end"
                            onClick={() => setShowPassword(!showPassword)}
                            className="hover:bg-muted/50 cursor-pointer rounded-sm p-1 transition-colors"
                          >
                            {showPassword ? (
                              <EyeClosed className="size-4" />
                            ) : (
                              <Eye className="size-4" />
                            )}
                          </InputGroupAddon>
                        </InputGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <span className="text-destructive">*</span>
                        确认密码
                      </FormLabel>
                      <FormControl>
                        <InputGroup>
                          <InputGroupInput
                            id="confirm-password-input"
                            type={showConfirmPassword ? "text" : "password"}
                            placeholder="请输入新密码"
                            {...field}
                          />
                          <InputGroupAddon
                            align="inline-end"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className="hover:bg-muted/50 cursor-pointer rounded-sm p-1 transition-colors"
                          >
                            {showConfirmPassword ? (
                              <EyeClosed className="size-4" />
                            ) : (
                              <Eye className="size-4" />
                            )}
                          </InputGroupAddon>
                        </InputGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormDescription className="text-muted-foreground text-xs">
                  建议6位以上的密码
                </FormDescription>
              </>
            )}

            <DialogFooter className="gap-2">
              {!generatedPassword && (
                <>
                  <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                    取消
                  </Button>
                  <Button type="submit" disabled={resetPasswordMutation.isPending}>
                    {resetPasswordMutation.isPending && <Loader2 className="animate-spin" />}
                    确认重置密码
                  </Button>
                </>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
