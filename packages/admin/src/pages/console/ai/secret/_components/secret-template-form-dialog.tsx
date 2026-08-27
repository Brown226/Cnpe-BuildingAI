import { BooleanNumber } from "@buildingai/constants/shared/status-codes.constant";
import {
  type CreateSecretTemplateDto,
  type SecretTemplate,
  type SecretTemplateFieldConfig,
  useCreateSecretTemplateMutation,
  useUpdateSecretTemplateMutation,
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
import { RadioGroup, RadioGroupItem } from "@buildingai/ui/components/ui/radio-group";
import { ScrollArea } from "@buildingai/ui/components/ui/scroll-area";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleMinus, Info, Loader2, Plus } from "lucide-react";
import { useEffect } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const fieldConfigSchema = z.object({
  name: z.string().min(1, "字段名称不能为空"),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
});

const formSchema = z.object({
  name: z
    .string({ message: "模板名称必须填写" })
    .min(1, "模板名称不能为空")
    .max(100, "模板名称不能超过100个字符"),
  icon: z.string().optional(),
  fieldConfig: z.array(fieldConfigSchema).min(1, "至少需要一个字段配置"),
  isEnabled: z.boolean().optional(),
  sortOrder: z.number().min(0, "排序权重不能小于0").optional(),
});

type FormValues = z.infer<typeof formSchema>;

type SecretTemplateFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: SecretTemplate | null;
  onSuccess?: () => void;
};

export const SecretTemplateFormDialog = ({
  open,
  onOpenChange,
  template,
  onSuccess,
}: SecretTemplateFormDialogProps) => {
  const isEditMode = !!template;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema as any),
    defaultValues: {
      name: "",
      icon: "",
      fieldConfig: [{ name: "baseUrl", required: false, placeholder: "请输入baseUrl" }],
      isEnabled: true,
      sortOrder: 0,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "fieldConfig",
  });

  useEffect(() => {
    if (open) {
      if (template) {
        form.reset({
          name: template.name,
          icon: template.icon || "",
          fieldConfig:
            template.fieldConfig?.length > 0
              ? template.fieldConfig.map((f) => ({
                  name: f.name,
                  required: f.required ?? false,
                  placeholder: f.placeholder || "",
                }))
              : [{ name: "baseUrl", required: false, placeholder: "请输入baseUrl" }],
          isEnabled: template.isEnabled === BooleanNumber.YES,
          sortOrder: template.sortOrder,
        });
      } else {
        form.reset({
          name: "",
          icon: "",
          fieldConfig: [{ name: "baseUrl", required: false, placeholder: "请输入baseUrl" }],
          isEnabled: true,
          sortOrder: 0,
        });
      }
    }
  }, [open, template, form]);

  const createMutation = useCreateSecretTemplateMutation({
    onSuccess: () => {
      toast.success("密钥模板创建成功");
      onOpenChange(false);
      onSuccess?.();
    },
  });

  const updateMutation = useUpdateSecretTemplateMutation({
    onSuccess: () => {
      toast.success("密钥模板更新成功");
      onOpenChange(false);
      onSuccess?.();
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (values: FormValues) => {
    const fieldConfig: SecretTemplateFieldConfig[] = values.fieldConfig.map((f) => ({
      name: f.name,
      required: f.required,
      placeholder: f.placeholder || undefined,
    }));

    if (isEditMode && template) {
      updateMutation.mutate({
        id: template.id,
        data: {
          name: values.name,
          icon: values.icon || undefined,
          fieldConfig,
          isEnabled: values.isEnabled ? BooleanNumber.YES : BooleanNumber.NO,
          sortOrder: values.sortOrder,
        },
      });
    } else {
      const dto: CreateSecretTemplateDto = {
        name: values.name,
        icon: values.icon || undefined,
        fieldConfig,
        isEnabled: values.isEnabled ? BooleanNumber.YES : BooleanNumber.NO,
        sortOrder: values.sortOrder,
      };
      createMutation.mutate(dto);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="p-4">
          <DialogTitle>{isEditMode ? "编辑密钥模板" : "新增密钥模板"}</DialogTitle>
          <DialogDescription>
            {isEditMode ? "修改密钥模板的配置信息" : "创建一个新的密钥模板"}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[80vh]">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 p-4 pt-0 pb-17">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="icon"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>图标</FormLabel>
                      <FormControl>
                        <ImageUpload
                          size="sm"
                          value={field.value}
                          onChange={(url) => field.onChange(url ?? "")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="isEnabled"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel required>启用状态</FormLabel>
                      <FormControl>
                        <RadioGroup
                          className="flex gap-4"
                          value={field.value ? "true" : "false"}
                          onValueChange={(v) => field.onChange(v === "true")}
                        >
                          <label className="flex items-center gap-2 text-sm">
                            <RadioGroupItem value="true" />
                            启用
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <RadioGroupItem value="false" />
                            禁用
                          </label>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>模板名称</FormLabel>
                    <FormControl>
                      <Input placeholder="例如: OpenAI, Azure, 阿里云" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <FormLabel required>字段配置</FormLabel>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => append({ name: "", required: false, placeholder: "" })}
                  >
                    <Plus className="size-3.5" />
                    添加字段
                  </Button>
                </div>

                {fields.length === 0 && (
                  <p className="text-muted-foreground text-center text-sm">
                    暂无字段配置，请添加至少一个字段
                  </p>
                )}

                {fields.map((field, index) => (
                  <div key={field.id} className="bg-muted/30 rounded-lg border p-3">
                    <div className="flex flex-col gap-4">
                      <div className="flex justify-between">
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="destructive"
                            className="text-destructive size-fit shrink-0 p-0"
                            onClick={() => remove(index)}
                            disabled={fields.length <= 1}
                          >
                            <CircleMinus className="size-3.5" />
                          </Button>
                          <span className="text-sm font-bold">字段{index + 1}</span>
                        </div>
                        <FormField
                          control={form.control}
                          name={`fieldConfig.${index}.required`}
                          render={({ field }) => (
                            <FormItem className="flex items-center gap-2 space-y-0">
                              <FormControl>
                                <Checkbox
                                  id={`checkbox-${index}`}
                                  name={`fieldConfig.${index}.required`}
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                />
                              </FormControl>
                              <FormLabel className="text-muted-foreground text-xs font-normal">
                                必填
                              </FormLabel>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <FormField
                          control={form.control}
                          name={`fieldConfig.${index}.name`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>字段名</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="例如: apiKey"
                                  className="h-8 text-sm"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`fieldConfig.${index}.placeholder`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>占位符</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="例如: 请输入apiKey"
                                  className="h-8 text-sm"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <p className="text-muted-foreground mt-2 flex items-center gap-1 text-xs">
                  <Info className="size-3" />
                  <span>提供给自定义厂商使用时，必须带有 baseUrl 字段</span>
                </p>

                {form.formState.errors.fieldConfig?.root && (
                  <p className="text-destructive text-sm">
                    {form.formState.errors.fieldConfig.root.message}
                  </p>
                )}
              </div>

              <FormField
                control={form.control}
                name="sortOrder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>排序权重</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        placeholder="0"
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
