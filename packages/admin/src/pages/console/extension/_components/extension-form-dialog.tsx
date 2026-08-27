import {
  ExtensionSupportTerminal,
  type ExtensionSupportTerminalType,
  ExtensionType,
  type ExtensionTypeType,
} from "@buildingai/constants/shared/extension.constant";
import {
  type CreateExtensionDto,
  type Extension,
  type UpdateExtensionDto,
  useCreateExtensionMutation,
  useUpdateExtensionMutation,
} from "@buildingai/services/console";
import { Button } from "@buildingai/ui/components/ui/button";
import { Checkbox } from "@buildingai/ui/components/ui/checkbox";
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
import semver from "semver";
import { toast } from "sonner";
import { z } from "zod";

const EXTENSION_TYPE_OPTIONS: { label: string; value: ExtensionTypeType }[] = [
  { label: "应用插件", value: ExtensionType.APPLICATION },
  { label: "功能插件", value: ExtensionType.FUNCTIONAL },
];

const TERMINAL_OPTIONS: {
  label: string;
  value: ExtensionSupportTerminalType;
  disabled?: boolean;
}[] = [
  { label: "Web端", value: ExtensionSupportTerminal.WEB },
  { label: "公众号", value: ExtensionSupportTerminal.WEIXIN, disabled: true },
  { label: "H5", value: ExtensionSupportTerminal.H5, disabled: true },
  { label: "小程序", value: ExtensionSupportTerminal.MP, disabled: true },
  { label: "API端", value: ExtensionSupportTerminal.API, disabled: true },
];

const formSchema = z.object({
  name: z
    .string({ message: "应用名称必须填写" })
    .min(1, "应用名称不能为空")
    .max(100, "应用名称不能超过100个字符"),
  identifier: z
    .string({ message: "标识符必须填写" })
    .min(1, "标识符不能为空")
    .max(100, "标识符不能超过100个字符"),
  description: z.string().max(1000, "描述不能超过1000个字符").optional(),
  type: z.number({ message: "应用类型必须选择" }),
  supportTerminal: z.array(z.number()).min(1, "至少选择一个").optional(),
  version: z
    .string()
    .min(1, "版本号不能为空")
    .max(50, "版本号不能超过50个字符")
    .refine(
      (val) => {
        if (!val) return true;
        return semver.valid(val) !== null;
      },
      { message: "版本号格式不正确" },
    )
    .optional(),
  authorName: z.string().max(100, "作者名称不能超过100个字符").optional(),
  icon: z.string().max(500, "图标地址不能超过500个字符").optional(),
});

type FormValues = z.infer<typeof formSchema>;

type ExtensionFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  extension?: Extension | null;
  onSuccess?: () => void;
};

export const ExtensionFormDialog = ({
  open,
  onOpenChange,
  extension,
  onSuccess,
}: ExtensionFormDialogProps) => {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema as any),
    defaultValues: {
      name: "",
      identifier: "",
      description: "",
      type: ExtensionType.APPLICATION,
      supportTerminal: [],
      version: "1.0.0",
      authorName: "",
      icon: "",
    },
  });

  useEffect(() => {
    if (open) {
      if (extension) {
        form.reset({
          name: extension.name || "",
          identifier: extension.identifier || "",
          description: extension.description || "",
          type: extension.type ?? ExtensionType.APPLICATION,
          supportTerminal: extension.supportTerminal ?? [],
          version: extension.version || "",
          authorName: extension.author?.name || "",
          icon: extension.icon || "",
        });
      } else {
        form.reset({
          name: "",
          identifier: "",
          description: "",
          type: ExtensionType.APPLICATION,
          supportTerminal: [],
          version: "",
          authorName: "",
          icon: "",
        });
      }
    }
  }, [open, extension, form]);

  const isEditMode = !!extension;

  const createMutation = useCreateExtensionMutation({
    onSuccess: () => {
      toast.success("应用创建成功");
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(`创建失败: ${error.message}`);
    },
  });

  const updateMutation = useUpdateExtensionMutation({
    onSuccess: () => {
      toast.success("应用更新成功");
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (values: FormValues) => {
    if (isEditMode) {
      const dto: UpdateExtensionDto = {
        name: values.name,
        description: values.description || undefined,
        type: values.type as ExtensionTypeType,
        supportTerminal: values.supportTerminal as ExtensionSupportTerminalType[] | undefined,
        version: values.version || undefined,
        author: values.authorName ? { ...extension.author, name: values.authorName } : undefined,
        icon: values.icon || undefined,
      };
      updateMutation.mutate({ id: extension.id, dto });
    } else {
      const dto: CreateExtensionDto = {
        name: values.name,
        identifier: values.identifier,
        description: values.description || undefined,
        type: values.type as ExtensionTypeType,
        supportTerminal: values.supportTerminal as ExtensionSupportTerminalType[] | undefined,
        version: values.version || undefined,
        author: values.authorName ? { name: values.authorName } : undefined,
        icon: values.icon || undefined,
      };
      createMutation.mutate(dto);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="p-4">
          <DialogTitle>{isEditMode ? "编辑应用" : "创建应用"}</DialogTitle>
          <DialogDescription>
            {isEditMode ? "修改本地应用的基本信息" : "创建一个新的本地应用"}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[80vh]">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 p-4 pt-0 pb-17">
              <FormField
                control={form.control}
                name="icon"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>应用图标</FormLabel>
                    <FormControl>
                      <ImageUpload
                        size="lg"
                        shape="rounded"
                        value={field.value || undefined}
                        onChange={(url) => field.onChange(url ?? "")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>应用名称</FormLabel>
                    <FormControl>
                      <Input placeholder="请输入应用名称" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="identifier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>标识符</FormLabel>
                    <FormControl>
                      <Input placeholder="例如: example-app" disabled={!!extension} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>应用描述</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="请输入应用描述"
                        className="resize-none"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>应用类型</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(Number(v))}
                      value={String(field.value)}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="选择应用类型" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {EXTENSION_TYPE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={String(opt.value)}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="supportTerminal"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>支持终端</FormLabel>
                    <div className="flex flex-wrap gap-4">
                      {TERMINAL_OPTIONS.map((opt) => {
                        const checked = field.value?.includes(opt.value) ?? false;
                        return (
                          <label key={opt.value} className="flex items-center gap-1.5 text-sm">
                            <Checkbox
                              checked={checked}
                              disabled={opt.disabled === true}
                              onCheckedChange={(v) => {
                                const next = v
                                  ? [...(field.value ?? []), opt.value]
                                  : (field.value ?? []).filter((t) => t !== opt.value);
                                field.onChange(next);
                              }}
                            />
                            {opt.label}
                          </label>
                        );
                      })}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 items-start gap-4">
                <FormField
                  control={form.control}
                  name="version"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>应用版本</FormLabel>
                      <FormControl>
                        <Input placeholder="例如: 1.0.0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="authorName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>作者名称</FormLabel>
                      <FormControl>
                        <Input placeholder="请输入作者名称" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter className="bg-background absolute bottom-0 left-0 w-full flex-row justify-end rounded-lg p-4">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  取消
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending && <Loader2 className="animate-spin" />}
                  {isEditMode ? "保存" : "创建"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
