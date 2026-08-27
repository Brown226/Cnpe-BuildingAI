import {
  type UpdateUserBalanceDto,
  useChangeUserBalanceMutation,
  type User,
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
import { Separator } from "@buildingai/ui/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@buildingai/ui/components/ui/tabs";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Loader2, Zap } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const formSchema = z.object({
  action: z.enum(["1", "0"]),
  amount: z
    .number()
    .optional()
    .refine((value) => value !== undefined, "请输入调整额度")
    .refine((value) => value === undefined || value >= 1, "增加数量必须大于0"),
});

type FormValues = z.infer<typeof formSchema>;

type BalanceAdjustmentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  onSuccess?: () => void;
};

/**
 * 积分调整弹框组件
 */
export const BalanceAdjustmentDialog = ({
  open,
  onOpenChange,
  user,
  onSuccess,
}: BalanceAdjustmentDialogProps) => {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      action: "1",
      amount: undefined,
    },
  });

  const watchAction = form.watch("action");
  const watchAmount = form.watch("amount");

  const previewBalance = useMemo(() => {
    const currentBalance = user?.power ?? 0;
    const amount = watchAmount || 0;
    if (watchAction === "1") {
      return currentBalance + amount;
    }
    return Math.max(0, currentBalance - amount);
  }, [user?.power, watchAction, watchAmount]);

  useEffect(() => {
    if (open && user) {
      form.reset({
        action: "1",
        amount: undefined,
      });
    }
  }, [open, user, form]);

  const adjustmentMutation = useChangeUserBalanceMutation({
    onSuccess: () => {
      toast.success("积分调整成功");
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(`调整失败: ${error.message}`);
    },
  });

  const handleSubmit = (values: FormValues) => {
    if (!user) return;

    const dto: UpdateUserBalanceDto = {
      action: Number(values.action) as 0 | 1,
      amount: values.amount as number,
    };

    adjustmentMutation.mutate({ id: user.id, dto });
  };

  const isPending = adjustmentMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full md:max-w-md">
        <DialogHeader className="px-1">
          <DialogTitle className="text-lg">调整积分余额</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5 px-1">
            {/* 当前账户余额 */}
            <div className="bg-muted/50 flex items-center justify-between rounded-lg border px-4 py-3">
              <span className="text-muted-foreground text-sm">当前账户余额</span>
              <div className="flex items-center gap-1.5">
                <Zap className="text-primary size-5" />
                <span className="text-foreground text-xl font-bold tabular-nums">
                  {user?.power?.toLocaleString() ?? 0}
                </span>
              </div>
            </div>

            {/* 调整方式 */}
            <FormField
              control={form.control}
              name="action"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm">调整方式</FormLabel>
                  <FormControl>
                    <Tabs
                      value={field.value ?? "1"}
                      onValueChange={(v) => field.onChange(v)}
                      className="w-full"
                    >
                      <TabsList className="w-full">
                        <TabsTrigger value="1">增加积分</TabsTrigger>
                        <TabsTrigger value="0">扣减积分</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 增加数量 */}
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm">
                    {watchAction === "1" ? "增加数量" : "扣减数量"}
                  </FormLabel>
                  <FormControl>
                    <InputGroup className="w-full">
                      <InputGroupInput
                        type="number"
                        min={1}
                        placeholder="请输入调整额度"
                        value={field.value ?? ""}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        onChange={(e) =>
                          field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                        }
                      />
                      <InputGroupAddon align="inline-end">积分</InputGroupAddon>
                    </InputGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Separator className="border-border border-t border-dashed bg-transparent data-[orientation=horizontal]:h-0" />

            {/* 预估变更后 */}
            <div className="flex items-center justify-between">
              <div className="text-muted-foreground text-xs">预估变更后</div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm tabular-nums line-through">
                  {user?.power?.toLocaleString() ?? 0}
                </span>
                <div className="flex items-center gap-2">
                  <ArrowRight className="text-muted-foreground size-4" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-primary text-2xl font-bold tabular-nums">
                      {previewBalance.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                取消操作
              </Button>
              <Button type="submit" disabled={isPending || !watchAmount}>
                {isPending && <Loader2 className="animate-spin" />}
                确认调整并提交
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
