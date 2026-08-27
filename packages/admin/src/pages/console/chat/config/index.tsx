import { useChatConfigQuery, useUpdateChatConfigMutation } from "@buildingai/services/console";
import { PermissionGuard } from "@buildingai/ui/components/auth/permission-guard";
import {
  Editor,
  EditorContainer,
  EditorKit,
  Plate,
  usePlateEditor,
} from "@buildingai/ui/components/editor";
import { Button } from "@buildingai/ui/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@buildingai/ui/components/ui/form";
import { Input } from "@buildingai/ui/components/ui/input";
import { Switch } from "@buildingai/ui/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@buildingai/ui/components/ui/tabs";
import { Textarea } from "@buildingai/ui/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@buildingai/ui/components/ui/tooltip";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { HelpCircle, Loader2, PlusIcon, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Resolver } from "react-hook-form";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ModelSelector as AIModelSelector } from "@client/components/ask-assistant-ui/components/model-selector";
import { PageContainer } from "@/layouts/console/_components/page-container";

const suggestionSchema = z.object({
  icon: z.string(),
  text: z.string(),
});

const chatConfigFormSchema = z.object({
  welcomeTitle: z.string().min(1, "欢迎标题为必填项").trim(),
  welcomeDescription: z.string(),
  footerInfo: z.string().optional(),
  attachmentSizeLimit: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "string" ? (v === "" ? 0 : Number(v)) : v))
    .pipe(z.number().min(1, "对话附件大小限制须为正数（单位：MB）")),
  showMcpToolDetails: z.boolean(),
  suggestionsEnabled: z.boolean(),
  suggestions: z.array(suggestionSchema),
  memoryModelId: z.string().optional(),
  titleModelId: z.string().optional(),
  /** Same role as agent `modelRouting.titleModel`: generates follow-up chips after each reply. */
  followUpModelId: z.string().optional(),
});

type FormValues = z.infer<typeof chatConfigFormSchema>;

interface ApiChatConfig {
  welcomeInfo?: { title?: string; description?: string; footer?: string };
  attachmentSizeLimit?: number;
  showMcpToolDetails?: boolean;
  suggestionsEnabled?: boolean;
  suggestions?: Array<{ icon: string; text: string }>;
  memoryModelId?: string;
  titleModelId?: string;
  followUpModelId?: string;
}

const defaultFormValues: FormValues = {
  welcomeTitle: "",
  welcomeDescription: "",
  footerInfo: "",
  attachmentSizeLimit: 10,
  showMcpToolDetails: true,
  suggestionsEnabled: true,
  suggestions: [
    { icon: "🎮", text: "写一个像宝可梦方式的小游戏" },
    { icon: "📅", text: "2025年节日安排出来了吗?" },
    { icon: "😊", text: "AI时代，什么能力不可被替代?" },
    { icon: "📝", text: "一篇生成爆款小红书笔记" },
    { icon: "🔍", text: "AI能成为全球人类产生威胁吗?" },
  ],
  memoryModelId: "",
  titleModelId: "",
  followUpModelId: "",
};

const EMPTY_EDITOR_VALUE = [{ type: "p", children: [{ text: "" }] }];

function parseEditorValue(raw: unknown): any[] {
  if (Array.isArray(raw) && raw.length > 0) return raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      return [{ type: "p", children: [{ text: raw }] }];
    }
  }
  return EMPTY_EDITOR_VALUE;
}

interface ChatConfigFormProps {
  apiData: ApiChatConfig;
}

const ChatConfigForm = ({ apiData }: ChatConfigFormProps) => {
  const queryClient = useQueryClient();
  const updateMutation = useUpdateChatConfigMutation({
    onSuccess: () => {
      toast.success("保存成功");
      queryClient.invalidateQueries({ queryKey: ["console", "chat-config"] });
    },
  });

  const [resetKey, setResetKey] = useState(0);

  const editorInitialValue = useMemo(
    () => parseEditorValue(apiData.welcomeInfo?.description),
    [apiData],
  );

  const initialValues = useMemo<FormValues>(
    () => ({
      welcomeTitle: apiData.welcomeInfo?.title ?? "",
      welcomeDescription: JSON.stringify(editorInitialValue),
      footerInfo: apiData.welcomeInfo?.footer ?? "",
      attachmentSizeLimit:
        typeof apiData.attachmentSizeLimit === "number" ? apiData.attachmentSizeLimit : 10,
      showMcpToolDetails:
        typeof apiData.showMcpToolDetails === "boolean" ? apiData.showMcpToolDetails : true,
      suggestionsEnabled:
        typeof apiData.suggestionsEnabled === "boolean" ? apiData.suggestionsEnabled : true,
      suggestions: Array.isArray(apiData.suggestions)
        ? apiData.suggestions
        : defaultFormValues.suggestions,
      memoryModelId: apiData.memoryModelId ?? "",
      titleModelId: apiData.titleModelId ?? "",
      followUpModelId: apiData.followUpModelId ?? "",
    }),
    [apiData, editorInitialValue],
  );

  const descriptionEditor = usePlateEditor({
    plugins: EditorKit,
    id: `welcome-description-${resetKey}`,
    value: editorInitialValue,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(chatConfigFormSchema) as Resolver<FormValues>,
    defaultValues: initialValues,
  });

  useEffect(() => {
    form.reset(initialValues);
    if (apiData.welcomeInfo) setResetKey((k) => k + 1);
  }, [initialValues, apiData.welcomeInfo]);

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "suggestions",
  });

  const [newSuggestionText, setNewSuggestionText] = useState("");

  const onSubmit = (values: FormValues) => {
    updateMutation.mutate({
      welcomeInfo: {
        title: values.welcomeTitle,
        description: values.welcomeDescription,
        footer: values.footerInfo?.trim() || undefined,
      },
      attachmentSizeLimit: values.attachmentSizeLimit,
      showMcpToolDetails: values.showMcpToolDetails,
      suggestionsEnabled: values.suggestionsEnabled,
      suggestions: values.suggestions,
      memoryModelId: values.memoryModelId?.trim() ?? "",
      titleModelId: values.titleModelId?.trim() ?? "",
      followUpModelId: values.followUpModelId?.trim() ?? "",
    });
  };

  const handleReset = () => {
    form.reset(initialValues);
    setNewSuggestionText("");
    setResetKey((k) => k + 1);
    toast.success("已重置为当前保存的配置");
  };

  const handleAddSuggestion = () => {
    const text = newSuggestionText.trim();
    if (!text) return;
    append({ icon: "💬", text });
    setNewSuggestionText("");
  };

  return (
    <PageContainer>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
          <Tabs defaultValue="welcome" className="w-full">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-6">
                <TabsList>
                  <TabsTrigger value="welcome" className="px-3">
                    欢迎界面
                  </TabsTrigger>
                  <TabsTrigger value="suggestions" className="px-3">
                    建议选项
                  </TabsTrigger>
                  <TabsTrigger value="chat" className="px-3">
                    对话配置
                  </TabsTrigger>
                  <TabsTrigger value="model" className="px-3">
                    模型配置
                  </TabsTrigger>
                </TabsList>
              </div>
              <div className="flex shrink-0 gap-2">
                <PermissionGuard permissions="ai-conversations:update-config">
                  <Button type="submit" disabled={updateMutation.isPending}>
                    {updateMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                    保存设置
                  </Button>
                  <Button type="button" variant="outline" onClick={handleReset}>
                    重置设置
                  </Button>
                </PermissionGuard>
              </div>
            </div>
            <TabsContent value="welcome" className="mt-4">
              <div className="max-w-2xl space-y-6">
                <div>
                  <h3 className="text-sm font-medium">欢迎语</h3>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    对话页首屏展示的标题、描述与页脚
                  </p>
                </div>
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="welcomeTitle"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>欢迎标题</FormLabel>
                        <FormControl>
                          <Input
                            required
                            placeholder="例如：👋 你好，我可以帮你做什么？"
                            className="w-full max-w-2xl"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="welcomeDescription"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>欢迎描述</FormLabel>
                        <FormControl>
                          <Plate
                            editor={descriptionEditor}
                            onValueChange={({ value }) => {
                              field.onChange(JSON.stringify(value));
                            }}
                          >
                            <EditorContainer className="h-80 w-full max-w-2xl rounded-lg border">
                              <Editor required variant="default" />
                            </EditorContainer>
                          </Plate>
                        </FormControl>
                        <FormDescription>欢迎标题下方的说明文案</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="footerInfo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>页脚信息</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="例如：内容由AI生成，无法确保真实准确，仅供参考。"
                            className="min-h-[60px] max-w-2xl resize-y"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>对话区域底部的提示文案，选填</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="suggestions" className="mt-4">
              <div className="max-w-2xl space-y-6">
                <div>
                  <h3 className="text-sm font-medium">建议选项</h3>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    是否在对话页展示建议选项供用户快速选择
                  </p>
                </div>
                <FormField
                  control={form.control}
                  name="suggestionsEnabled"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <FormLabel>启用建议选项</FormLabel>
                          <FormDescription>展示建议选项供用户快速选择</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="space-y-4">
                  <div className="space-y-2">
                    <FormLabel className="text-sm">新增建议项</FormLabel>
                    <div className="flex gap-2">
                      <Input
                        placeholder="输入文案后点击添加"
                        value={newSuggestionText}
                        onChange={(e) => setNewSuggestionText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddSuggestion();
                          }
                        }}
                        className="w-full"
                      />
                      <Button
                        type="button"
                        onClick={handleAddSuggestion}
                        disabled={!newSuggestionText.trim()}
                      >
                        <PlusIcon className="size-4" />
                        添加
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <FormLabel className="text-sm">已添加的建议项</FormLabel>
                    {fields.length === 0 ? (
                      <p className="text-muted-foreground py-6 text-center text-sm">
                        暂无建议项，在上方输入后点击「添加」
                      </p>
                    ) : (
                      <ul className="border-border divide-y rounded-md border">
                        {fields.map((field, index) => (
                          <li
                            key={field.id}
                            className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {form.watch(`suggestions.${index}.text`) || "未填写"}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive h-8 w-8 shrink-0"
                              onClick={() => remove(index)}
                              aria-label="移除"
                            >
                              <X className="size-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="chat" className="mt-4">
              <div className="max-w-2xl space-y-6">
                <div>
                  <h3 className="text-sm font-medium">对话相关</h3>
                  <p className="text-muted-foreground mt-0.5 text-xs">附件上传与对话行为相关配置</p>
                </div>
                <FormField
                  control={form.control}
                  name="attachmentSizeLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        <span className="text-destructive">*</span> 对话附件大小限制（MB）
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          placeholder="10"
                          className="max-w-40"
                          {...field}
                          value={field.value}
                          onChange={(e) =>
                            field.onChange(e.target.value === "" ? 0 : Number(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormDescription>单次上传附件的最大体积，单位：兆字节（MB）</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="showMcpToolDetails"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <FormLabel>MCP 工具调用详情</FormLabel>
                          <FormDescription>开启后可展开查看 MCP 工具调用参数与结果</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </TabsContent>

            <TabsContent value="model" className="mt-4">
              <div className="max-w-2xl space-y-6">
                <div>
                  <h3 className="text-sm font-medium">模型路由</h3>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    为记忆提取、会话标题、追问建议等功能指定模型；不配置则对应功能不启用
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4 rounded-lg px-0 py-2">
                    <div className="flex min-w-0 flex-col">
                      <div className="flex items-center gap-1.5">
                        <FormLabel className="text-sm font-medium">记忆提取模型</FormLabel>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex shrink-0 rounded p-0.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                              aria-label="说明"
                            >
                              <HelpCircle className="text-muted-foreground h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            用于从对话中提取并写入长期记忆。不配置则不会读写长期记忆。
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        用于提取长期记忆，可选用低成本模型
                      </p>
                    </div>
                    <FormField
                      control={form.control}
                      name="memoryModelId"
                      render={({ field }) => (
                        <FormItem className="mb-0 ml-4 w-56 shrink-0">
                          <FormControl>
                            <AIModelSelector
                              modelType="llm"
                              value={field.value ?? ""}
                              onSelect={field.onChange}
                              triggerVariant="button"
                              placeholder="不启用"
                              className="w-full"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-lg px-0 py-2">
                    <div className="flex min-w-0 flex-col">
                      <div className="flex items-center gap-1.5">
                        <FormLabel className="text-sm font-medium">会话标题模型</FormLabel>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex shrink-0 rounded p-0.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                              aria-label="说明"
                            >
                              <HelpCircle className="text-muted-foreground h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            用于在新会话首次发送后，根据首条用户消息自动生成会话标题。不配置则使用默认标题。
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-xs">可选用低成本模型</p>
                    </div>
                    <FormField
                      control={form.control}
                      name="titleModelId"
                      render={({ field }) => (
                        <FormItem className="mb-0 ml-4 w-56 shrink-0">
                          <FormControl>
                            <AIModelSelector
                              modelType="llm"
                              value={field.value ?? ""}
                              onSelect={field.onChange}
                              triggerVariant="button"
                              placeholder="不启用"
                              className="w-full"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-lg px-0 py-2">
                    <div className="flex min-w-0 flex-col">
                      <div className="flex items-center gap-1.5">
                        <FormLabel className="text-sm font-medium">追问建议模型</FormLabel>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex shrink-0 rounded p-0.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                              aria-label="说明"
                            >
                              <HelpCircle className="text-muted-foreground h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            与智能体编排中「追问建议模型」一致：在助手回复后自动生成最多 3
                            条追问供用户点击。不配置则不生成。
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        回复后生成追问建议，可选用低成本模型
                      </p>
                    </div>
                    <FormField
                      control={form.control}
                      name="followUpModelId"
                      render={({ field }) => (
                        <FormItem className="mb-0 ml-4 w-56 shrink-0">
                          <FormControl>
                            <AIModelSelector
                              modelType="llm"
                              value={field.value ?? ""}
                              onSelect={field.onChange}
                              triggerVariant="button"
                              placeholder="不启用"
                              className="w-full"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </form>
      </Form>
    </PageContainer>
  );
};

const emptyChatConfig: ApiChatConfig = {};

const ChatConfigIndexPage = () => {
  const { data } = useChatConfigQuery();
  return <ChatConfigForm apiData={(data as ApiChatConfig) ?? emptyChatConfig} />;
};

export default ChatConfigIndexPage;
