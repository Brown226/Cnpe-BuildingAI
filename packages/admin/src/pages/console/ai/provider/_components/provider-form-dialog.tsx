import { MODEL_TYPE_DESCRIPTIONS, type ModelType } from "@buildingai/ai-sdk/interfaces";
import { consoleHttpClient } from "@buildingai/services";
import {
  type AiProvider,
  useQuickCreateAiProviderMutation,
  useUpdateAiProviderMutation,
} from "@buildingai/services/console";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@buildingai/ui/components/ui/form";
import { ImageUpload } from "@buildingai/ui/components/ui/image-upload";
import { Input } from "@buildingai/ui/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@buildingai/ui/components/ui/radio-group";
import { ScrollArea } from "@buildingai/ui/components/ui/scroll-area";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@buildingai/ui/components/ui/combobox";
import { Textarea } from "@buildingai/ui/components/ui/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import React, { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const MODEL_TYPES = Object.keys(MODEL_TYPE_DESCRIPTIONS) as ModelType[];

const formSchema = z.object({
  provider: z
    .string({ message: "供应商标识参数必须传递" })
    .min(1, "供应商标识不能为空")
    .max(50, "供应商标识不能超过50个字符"),
  name: z
    .string({ message: "供应商名称参数必须传递" })
    .min(1, "供应商名称不能为空")
    .max(100, "供应商名称不能超过100个字符"),
  description: z.string().max(1000, "供应商描述不能超过1000个字符").optional(),
  baseUrl: z.string().max(500, "接口地址不能超过 500 个字符").optional(),
  apiKey: z.string().max(200, "API 密钥不能超过 200 个字符").optional(),
  supportedModelTypes: z.array(z.string()).min(1, "至少选择一种类型").optional(),
  iconUrl: z.string().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().min(0, "排序权重不能小于0").optional(),
});

type FormValues = z.infer<typeof formSchema>;

type AiProviderFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider?: AiProvider | null;
  onSuccess?: () => void;
  /** 快捷创建成功回调：返回新厂商（供父级触发自动扫描导入模型） */
  onQuickCreated?: (provider: AiProvider) => void;
};

/**
 * AI 供应商表单（快捷配置：接口地址 + API 密钥）
 *
 * 模板/密钥由系统自动创建与绑定；编辑时密钥字段留空表示不修改，
 * 填写则合并进既有密钥配置（保留模板中的其它字段）。
 */
export const AiProviderFormDialog = ({
  open,
  onOpenChange,
  provider,
  onSuccess,
  onQuickCreated,
}: AiProviderFormDialogProps) => {
  const isEditMode = !!provider;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema as any),
    defaultValues: {
      provider: "",
      name: "",
      description: "",
      baseUrl: "",
      apiKey: "",
      supportedModelTypes: [],
      iconUrl: "",
      isActive: false,
      sortOrder: 0,
    },
  });

  const apiKey = form.watch("apiKey");
  const canEnable = isEditMode || !!apiKey?.trim();

  useEffect(() => {
    if (!open) return;
    form.reset({
      provider: provider?.provider ?? "",
      name: provider?.name ?? "",
      description: provider?.description ?? "",
      baseUrl: "",
      apiKey: "",
      supportedModelTypes: provider?.supportedModelTypes ?? [],
      iconUrl: provider?.iconUrl ?? "",
      isActive: provider?.isActive ?? false,
      sortOrder: provider?.sortOrder ?? 0,
    });

    // 编辑时回填既有接口地址（API 密钥不回填，留空表示不修改）
    if (isEditMode && provider?.bindSecretId) {
      consoleHttpClient
        .get<{ fieldValues?: { name: string; value?: string }[] }>(
          `/secret/${provider.bindSecretId}`,
        )
        .then((detail) => {
          const baseUrl = detail?.fieldValues?.find((f) => f.name === "baseUrl")?.value;
          if (baseUrl) form.setValue("baseUrl", baseUrl);
        })
        .catch(() => {
          // 读不到旧密钥不阻塞编辑
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider]);

  const createMutation = useQuickCreateAiProviderMutation({
    onSuccess: (created) => {
      toast.success("供应商创建成功");
      onQuickCreated?.(created);
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error(`创建失败: ${error.message}`);
    },
  });

  const updateMutation = useUpdateAiProviderMutation({
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = async (values: FormValues) => {
    // 创建：走快捷创建（模板/密钥自动生成绑定）
    if (!isEditMode || !provider) {
      if (!values.apiKey?.trim()) {
        toast.error("请填写 API 密钥");
        return;
      }
      createMutation.mutate({
        provider: values.provider,
        name: values.name,
        baseUrl: values.baseUrl?.trim() || undefined,
        apiKey: values.apiKey.trim(),
        iconUrl: values.iconUrl || undefined,
        supportedModelTypes: (values.supportedModelTypes || []).map((t) =>
          t.toLowerCase(),
        ) as ModelType[],
        isActive: values.isActive,
        sortOrder: values.sortOrder,
      });
      return;
    }

    // 编辑：更新厂商字段；密钥字段填写则合并更新（留空不修改）
    try {
      await updateMutation.mutateAsync({
        id: provider.id,
        dto: {
          provider: values.provider,
          name: values.name,
          description: values.description || undefined,
          supportedModelTypes: (values.supportedModelTypes || []).map((t) =>
            t.toLowerCase(),
          ) as ModelType[],
          iconUrl: values.iconUrl || null,
          isActive: values.isActive,
          sortOrder: values.sortOrder,
        },
      });

      const apiKeyVal = values.apiKey?.trim();
      const baseUrlVal = values.baseUrl?.trim();
      if ((apiKeyVal || baseUrlVal) && provider.bindSecretId) {
        // 取旧值合并：fieldValues 为整组替换语义，必须携带模板全部字段
        const detail = await consoleHttpClient.get<{
          fieldValues?: { name: string; value?: string; encrypted?: boolean }[];
        }>(`/secret/${provider.bindSecretId}`);
        const merged = (detail?.fieldValues ?? []).map((field) => {
          if (field.name === "apiKey" && apiKeyVal) {
            return { ...field, value: apiKeyVal };
          }
          if (field.name === "baseUrl" && baseUrlVal) {
            return { ...field, value: baseUrlVal };
          }
          return field;
        });
        await consoleHttpClient.patch(`/secret/${provider.bindSecretId}`, {
          fieldValues: merged,
        });
      }

      toast.success("供应商更新成功");
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast.error(`更新失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const modelTypeAnchor = useComboboxAnchor();
  // 模型类型下拉展开状态：展开时按 Escape 只应关闭下拉，而不是整个对话框
  const modelTypeComboboxOpenRef = useRef(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (modelTypeComboboxOpenRef.current) {
            e.preventDefault();
            modelTypeComboboxOpenRef.current = false;
          }
        }}
        className="flex h-[85vh] flex-col gap-0 p-0 sm:max-w-lg"
      >
        <DialogHeader className="p-4">
          <DialogTitle>{isEditMode ? "编辑供应商" : "新增供应商"}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "修改供应商配置；接口地址 / API 密钥留空表示不修改"
              : "填写 OpenAI 兼容端点与密钥，系统自动完成配置"}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <ScrollArea
              className="min-h-0 flex-1"
              viewportClassName="absolute inset-0"
            >
              <div className="space-y-4 p-4 pt-0">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="iconUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>图标</FormLabel>
                        <FormControl>
                          <ImageUpload
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
                    name="isActive"
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
                              <RadioGroupItem value="true" disabled={!canEnable} />
                              启用
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                              <RadioGroupItem value="false" />
                              禁用
                            </label>
                          </RadioGroup>
                        </FormControl>
                        {!isEditMode && !canEnable && (
                          <FormDescription className="text-xs">
                            请先填写 API 密钥才能启用供应商
                          </FormDescription>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="provider"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>供应商标识</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="例如: openai, deepseek, doubao"
                          {...field}
                          disabled={isEditMode}
                        />
                      </FormControl>
                      <FormDescription>唯一标识符，创建后不可修改</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>供应商名称</FormLabel>
                      <FormControl>
                        <Input placeholder="例如: OpenAI, DeepSeek, 字节豆包" {...field} />
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
                      <FormLabel>描述</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="供应商描述信息（可选）"
                          className="resize-none"
                          rows={2}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="baseUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>接口地址（可选）</FormLabel>
                      <FormControl>
                        <Input placeholder="https://api.openai.com/v1" {...field} />
                      </FormControl>
                      <FormDescription>
                        {isEditMode
                          ? "OpenAI 兼容端点地址；留空表示不修改"
                          : "OpenAI 兼容端点地址，留空使用该厂商默认端点"}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="apiKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required={!isEditMode}>API 密钥</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder={isEditMode ? "不修改请留空" : "sk-..."}
                          autoComplete="off"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>密钥将加密托管，不会明文展示</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="supportedModelTypes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>支持的模型类型</FormLabel>
                      <FormControl>
                        <Combobox
                          multiple
                          autoHighlight
                          items={MODEL_TYPES}
                          value={field.value || []}
                          onValueChange={field.onChange}
                          onOpenChange={(open) => {
                            modelTypeComboboxOpenRef.current = open;
                          }}
                        >
                          <ComboboxChips ref={modelTypeAnchor} className="min-h-9 w-full">
                            <ComboboxValue>
                              {(values: string[]) => (
                                <React.Fragment>
                                  {values.map((value: string) => (
                                    <ComboboxChip key={value}>
                                      {MODEL_TYPE_DESCRIPTIONS[value as ModelType]?.name || value}
                                    </ComboboxChip>
                                  ))}
                                  <ComboboxChipsInput placeholder="选择模型类型..." />
                                </React.Fragment>
                              )}
                            </ComboboxValue>
                          </ComboboxChips>
                          <ComboboxContent anchor={modelTypeAnchor}>
                            <ComboboxEmpty>未找到匹配的类型</ComboboxEmpty>
                            <ComboboxList>
                              {(item: string) => (
                                <ComboboxItem key={item} value={item}>
                                  {MODEL_TYPE_DESCRIPTIONS[item as ModelType]?.name || item}
                                </ComboboxItem>
                              )}
                            </ComboboxList>
                          </ComboboxContent>
                        </Combobox>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

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
              </div>
            </ScrollArea>
            <DialogFooter className="border-t p-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
                {isEditMode ? "保存" : "创建"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};