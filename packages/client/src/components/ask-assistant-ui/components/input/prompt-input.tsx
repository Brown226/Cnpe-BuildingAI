import { useMcpServerQuickMenuQuery, useMcpServersAllQuery } from "@buildingai/services/web";
import {
  PromptInputAttachment as AIPromptInputAttachment,
  PromptInputAttachments as AIPromptInputAttachments,
} from "@buildingai/ui/components/ai-elements/attachments";
import {
  PromptInput as AIPromptInput,
  PromptInputBody as AIPromptInputBody,
  PromptInputButton as AIPromptInputButton,
  PromptInputFooter as AIPromptInputFooter,
  type PromptInputMessage,
  PromptInputProvider as AIPromptInputProvider,
  PromptInputSubmit as AIPromptInputSubmit,
  PromptInputTextarea as AIPromptInputTextarea,
  PromptInputTools as AIPromptInputTools,
  usePromptInputController,
} from "@buildingai/ui/components/ai-elements/prompt-input";
import SvgIcons from "@buildingai/ui/components/svg-icons";
import { Button } from "@buildingai/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@buildingai/ui/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@buildingai/ui/components/ui/tooltip";
import { cn } from "@buildingai/ui/lib/utils";
import {
  FileText,
  GlobeIcon,
  //   ImagesIcon,
  LayoutGridIcon,
  ListTodo,
  PaperclipIcon,
  Plus,
  Square,
  X,
} from "lucide-react";
import type {
  ClipboardEvent,
  FocusEvent,
  FormEvent,
  KeyboardEvent,
  ReactNode,
  RefObject,
} from "react";
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AssistantContext } from "../../context";
import { useFileUpload } from "../../hooks/use-file-upload";
import type { Model } from "../../types";
import { McpSelector } from "../mcp-selector";
import { ModelSelector } from "../model-selector";
import { VoiceInput } from "./voice-input";
import { ComposerModeTools } from "./composer-mode-tools";
import { AgentPicker } from "../agent-picker";
import { UsageBadge } from "../usage-badge";
import { FileMentionMenu } from "../file-mention-menu";
import { SlashCommandMenu } from "../slash-command-menu";
import { useComposerFileMentions } from "../../hooks/use-composer-file-mentions";
import { useComposerSlashCommandMenu } from "../../hooks/use-composer-slash-command-menu";
import type { ComposerFileReference } from "../../libs/composer-file-references";
import { useDesktop } from "@/components/desktop/desktop-provider";
import { archiveThread } from "@/services/desktop/thread-store";
import { useAssistantStore } from "@buildingai/stores";
import { useNavigate, useParams } from "react-router-dom";

export type PromptInputHiddenTool =
  | "more"
  | "speech"
  | "quickMenu"
  | "mcp"
  | "file"
  | "thinking"
  | "generateImage"
  | "search"
  | "exploreApps";

export interface PromptInputProps {
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  status?: "submitted" | "streaming" | "ready" | "error";
  onSubmit?: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>,
  ) => void | Promise<void>;
  onTextareaFocus?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  onStop?: () => void;
  globalDrop?: boolean;
  multiple?: boolean;
  models?: Model[];
  selectedModelId?: string;
  selectedMcpServerIds?: string[];
  onSelectMcpServers?: (ids: string[]) => void;
  onSetFeature?: (key: string, value: boolean) => void;
  hiddenTools?: PromptInputHiddenTool[];
  children?: ReactNode;
}

const StopButton = memo(({ onStop }: { onStop: () => void }) => {
  return (
    <Button
      className="bg-foreground text-background hover:bg-foreground/90 disabled:bg-muted disabled:text-muted-foreground size-8 rounded-full p-1 transition-colors duration-200"
      data-testid="stop-button"
      onClick={(event) => {
        event.preventDefault();
        onStop();
      }}
    >
      <Square size={14} />
    </Button>
  );
});

StopButton.displayName = "StopButton";

const PromptInputAttachmentsList = memo(() => (
  <AIPromptInputAttachments>
    {(attachment) => <AIPromptInputAttachment data={attachment} />}
  </AIPromptInputAttachments>
));

PromptInputAttachmentsList.displayName = "PromptInputAttachmentsList";

const VoiceInputWithTranscript = memo(function VoiceInputWithTranscript({
  textareaRef,
  onAudioRecorded,
  onRecordingChange,
}: {
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onAudioRecorded: (blob: Blob) => Promise<string | void>;
  onRecordingChange: (recording: boolean) => void;
}) {
  const controller = usePromptInputController();
  return (
    <VoiceInput
      textareaRef={textareaRef}
      onAudioRecorded={onAudioRecorded}
      onRecordingChange={onRecordingChange}
      onTranscriptReceived={(text) => {
        const cur = controller.textInput.value;
        controller.textInput.setInput(cur ? `${cur} ${text}` : text);
      }}
    />
  );
});

VoiceInputWithTranscript.displayName = "VoiceInputWithTranscript";

type FeatureKey = "thinking" | "generateImage" | "search";
type SelectedMenuItem = FeatureKey | null;

interface FeatureMenuItemConfig {
  id: FeatureKey;
  icon: React.ReactNode;
  label: string;
  featureKey: FeatureKey;
}

const defaultNoop = () => {};

const PromptInputInner = memo(
  ({
    textareaRef,
    status,
    onStop,
    onTextareaFocus,
    globalDrop,
    multiple,
    onSubmit,
    models: modelsProp,
    selectedModelId: selectedModelIdProp,
    selectedMcpServerIds: selectedMcpServerIdsProp,
    onSelectMcpServers: onSelectMcpServersProp,
    onSetFeature: onSetFeatureProp,
    hiddenTools = [],
    children,
  }: PromptInputProps) => {
    const context = useContext(AssistantContext);
    const models = modelsProp ?? context?.models ?? [];
    const selectedModelId = selectedModelIdProp ?? context?.selectedModelId ?? "";
    const selectedMcpServerIds = selectedMcpServerIdsProp ?? context?.selectedMcpServerIds ?? [];
    const onSelectMcpServers = onSelectMcpServersProp ?? context?.onSelectMcpServers ?? defaultNoop;
    const onSetFeature = onSetFeatureProp ?? context?.onSetFeature ?? defaultNoop;

    const selectedModel = useMemo(
      () => models.find((m) => m.id === selectedModelId),
      [models, selectedModelId],
    );
    const onSelectModel = context?.onSelectModel;
    const isConversationInProgress = status === "submitted" || status === "streaming";
    // 排队消息（Kun FloatingComposerQueuedMessages）：进行中提交入队，空闲自动发送
    const queuedRef = useRef<PromptInputMessage[]>([]);
    const [queuedCount, setQueuedCount] = useState(0);
    const [queuedOpen, setQueuedOpen] = useState(false);
    const prevStatusRef = useRef(status);
    useEffect(() => {
      const prev = prevStatusRef.current;
      prevStatusRef.current = status;
      if (prev !== status && status === "ready" && queuedRef.current.length > 0) {
        const next = queuedRef.current.shift()!;
        setQueuedCount(queuedRef.current.length);
        onSubmit?.(next, {} as FormEvent<HTMLFormElement>);
      }
    }, [status, onSubmit]);

    const hiddenSet = useMemo(() => new Set<PromptInputHiddenTool>(hiddenTools), [hiddenTools]);
    const shouldLoadMcpServers = !hiddenSet.has("mcp");
    const shouldLoadQuickMenu = !hiddenSet.has("quickMenu");

    const [selectedMenuItem, setSelectedMenuItem] = useState<SelectedMenuItem>(null);
    const [isVoiceRecording, setIsVoiceRecording] = useState(false);
    // 输入历史（对齐 Kun use-composer-input-history）：本 composer 会话内 ↑↓ 回溯
    const historyRef = useRef<string[]>([]);
    const historyCursorRef = useRef(-1);
    const draftRef = useRef("");
    const { id: currentThreadId } = useParams<{ id: string }>();
    // 草稿持久化（Kun use-composer-draft 语义）：按线程保存，发送后清除
    const compositionDraftKey = `huashu.desktop.composer.draft.v1:${currentThreadId ?? "@new"}`;

    useEffect(() => {
      setSelectedMenuItem(null);
    }, [selectedModelId]);

    const { data: mcpServers = [], isLoading: isLoadingMcpServers } = useMcpServersAllQuery(
      {
        isDisabled: false,
      },
      {
        enabled: shouldLoadMcpServers,
      },
    );

    const { data: quickMenuMcpServer } = useMcpServerQuickMenuQuery({
      enabled: shouldLoadQuickMenu,
    });

    useEffect(() => {
      if (!shouldLoadMcpServers) return;
      if (isLoadingMcpServers) return;
      if (selectedMcpServerIds.length === 0) return;

      const availableIdSet = new Set(mcpServers.map((s) => s.id));
      /**
       * Keep ids that exist in the MCP list, and also preserve QuickMenu MCP id.
       * QuickMenu server can be a virtual/ephemeral entry and may not appear in `useMcpServersAllQuery`.
       */
      const nextSelectedIds = selectedMcpServerIds.filter((id) => {
        if (availableIdSet.has(id)) return true;
        return id === quickMenuMcpServer?.id;
      });

      if (nextSelectedIds.length === selectedMcpServerIds.length) return;
      onSelectMcpServers(nextSelectedIds);
    }, [
      shouldLoadMcpServers,
      isLoadingMcpServers,
      mcpServers,
      quickMenuMcpServer?.id,
      selectedMcpServerIds,
      onSelectMcpServers,
    ]);

    const {
      handleFileSelect,
      uploadFilesIfNeeded,
      validateFiles,
      availableFileTypes,
      hasImageSupport,
    } = useFileUpload(multiple, selectedModel?.features, context?.supportedUploadTypes);

    const controller = usePromptInputController();

    // 文件 @ 提及（对齐 Kun FloatingComposerFileMentionMenu）
    const { desktop, selectedWorkspace } = useDesktop();
    // 草稿恢复：仅首次挂载执行（Kun use-composer-draft 语义，按线程）
    const draftRestoredRef = useRef(false);
    useEffect(() => {
        if (!desktop || draftRestoredRef.current) return;
        draftRestoredRef.current = true;
        try {
            const v = window.localStorage.getItem(compositionDraftKey);
            if (v && controller.textInput.value === "") controller.textInput.setInput(v);
        } catch {
            /* 忽略存储失败 */
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅首次恢复
    }, [desktop]);
    // 草稿保存：值变化 400ms 防抖写入
    useEffect(() => {
        if (!desktop) return;
        const timer = setTimeout(() => {
            try {
                const v = controller.textInput.value;
                if (v.trim()) window.localStorage.setItem(compositionDraftKey, v);
                else window.localStorage.removeItem(compositionDraftKey);
            } catch {
                /* 忽略存储失败 */
            }
        }, 400);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅值变化时保存
    }, [controller.textInput.value, desktop]);
    const setComposerFileReferences = useAssistantStore((s) => s.setComposerFileReferences);
    const [references, setReferences] = useState<ComposerFileReference[]>([]);
    const focusComposer = useCallback(() => textareaRef?.current?.focus(), [textareaRef]);
    const syncReferences = useCallback(
      (next: ComposerFileReference[]) => {
        setReferences(next);
        setComposerFileReferences(next.map((r) => r.relativePath));
      },
      [setComposerFileReferences],
    );
    const mention = useComposerFileMentions({
      enabled: desktop,
      input: controller.textInput.value,
      setInput: (value) => controller.textInput.setInput(value),
      workspaceRoot: desktop ? (selectedWorkspace?.path ?? null) : null,
      menuBlocked: false,
      references,
      textareaRef,
      focusComposer,
      onAdd: (ref) =>
        syncReferences(
          references.some((r) => r.relativePath === ref.relativePath) ? references : [...references, ref],
        ),
      onRemove: (path) => syncReferences(references.filter((r) => r.relativePath !== path)),
    });

    // 斜杠命令（对齐 Kun FloatingComposerSlashCommandMenu）
    const { setMode } = useDesktop();
    const navigate = useNavigate();
    const slash = useComposerSlashCommandMenu({
      enabled: desktop,
      input: controller.textInput.value,
      canCreateNewThread: true,
      activeThreadId: currentThreadId ?? null,
      busy: false,
      menuBlocked: false,
      textareaRef,
      onSelect: (commandId) => {
        if (commandId === "new") navigate("/chat");
        else if (commandId === "code") setMode("code");
        else if (commandId === "work") setMode("work");
        else if (commandId === "archive" && currentThreadId) archiveThread(currentThreadId);
        controller.textInput.setInput("");
      },
      onDismiss: () => undefined,
    });

    /**
     * Handle paste event with file type validation
     */
    const handlePaste = useCallback(
      (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const items = event.clipboardData?.items;
        if (!items) return;

        const files: File[] = [];
        for (const item of items) {
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (file) {
              files.push(file);
            }
          }
        }

        if (files.length === 0) return;

        // Validate files against current model's supported types
        const { validFiles, invalidFiles, unsupportedTypeLabels } = validateFiles(files);

        if (invalidFiles.length > 0) {
          const typeText = unsupportedTypeLabels.join("、");
          toast.error(`当前模型不支持${typeText}类型`);
        }

        // Always prevent default to take full control of file handling
        event.preventDefault();

        // Add only valid files using the controller's attachments context
        if (validFiles.length > 0) {
          controller.attachments.add(validFiles);
        }
      },
      [validateFiles, controller.attachments],
    );

    const featureMenuItems: FeatureMenuItemConfig[] = useMemo(() => {
      const items: FeatureMenuItemConfig[] = [
        // {
        //   id: "generateImage",
        //   icon: <ImagesIcon className="size-4 scale-110 transform" />,
        //   label: "创建图片",
        //   featureKey: "generateImage",
        // },
        // {
        //   id: "search",
        //   icon: <GlobeIcon className="size-4 scale-110 transform" />,
        //   label: "网页搜索",
        //   featureKey: "search",
        // },
      ];

      if (selectedModel?.thinking) {
        items.unshift({
          id: "thinking",
          icon: <SvgIcons.bulb className="size-4 scale-130 transform" />,
          label: "思考",
          featureKey: "thinking",
        });
      }

      return items;
    }, [selectedModel?.thinking]);

    const handleFeatureMenuItemClick = useCallback(
      (item: FeatureMenuItemConfig) => {
        setSelectedMenuItem((prev) => {
          const isSelected = prev === item.id;
          const newValue = isSelected ? null : item.id;
          onSetFeature(item.featureKey, !isSelected);
          return newValue;
        });
      },
      [onSetFeature],
    );

    const handleExploreApps = useCallback(() => {
      // TODO: 跳转到全部应用页面
      window.open("/apps", "_blank");
    }, []);

    const selectedMenuItemConfig = useMemo(
      () => featureMenuItems.find((item) => item.id === selectedMenuItem),
      [featureMenuItems, selectedMenuItem],
    );

    const handleQuickMenuClick = useCallback(() => {
      if (quickMenuMcpServer?.id) {
        const isSelected = selectedMcpServerIds.includes(quickMenuMcpServer.id);
        if (isSelected) {
          onSelectMcpServers(selectedMcpServerIds.filter((id) => id !== quickMenuMcpServer.id));
        } else {
          onSelectMcpServers([...selectedMcpServerIds, quickMenuMcpServer.id]);
        }
      }
    }, [quickMenuMcpServer, selectedMcpServerIds, onSelectMcpServers]);

    const handleRemoveSelectedMenuItem = useCallback(() => {
      const currentItem = featureMenuItems.find((item) => item.id === selectedMenuItem);
      if (currentItem) {
        onSetFeature(currentItem.featureKey, false);
      }
      setSelectedMenuItem(null);
    }, [featureMenuItems, selectedMenuItem, onSetFeature]);

    const handleSubmit = useCallback(
      async (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => {
        if (isConversationInProgress) {
          event.preventDefault();
          // 对齐 Kun：进行中不抛错，入队等空闲自动发送
          queuedRef.current = [...queuedRef.current.slice(-9), message];
          setQueuedCount(queuedRef.current.length);
          controller.textInput.setInput("");
          return;
        }
        if (message.files?.length) {
          message.files = await uploadFilesIfNeeded(message.files);
        }
        // 输入历史（对齐 Kun use-composer-input-history）：正文入栈供 ↑↓ 回溯
        const text = message.text?.trim();
        if (text && historyRef.current[historyRef.current.length - 1] !== text) {
          historyRef.current = [...historyRef.current.slice(-49), text];
        }
        historyCursorRef.current = -1;
        try {
          window.localStorage.removeItem(compositionDraftKey);
        } catch {
          /* 忽略存储失败 */
        }
        onSubmit?.(message, event);
      },
      [isConversationInProgress, onSubmit, uploadFilesIfNeeded],
    );

    const handleTextareaKeyDown = useCallback(
      (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (mention.handleKeyDown(event, event.nativeEvent.isComposing)) return;
        if (slash.handleKeyDown(event, event.nativeEvent.isComposing)) return;
        // 输入历史回溯（↑↓，对齐 Kun；菜单未拦截时才能触发）
        if (
          (event.key === "ArrowUp" || event.key === "ArrowDown") &&
          !event.shiftKey &&
          !event.nativeEvent.isComposing
        ) {
          const hist = historyRef.current;
          if (hist.length > 0) {
            event.preventDefault();
            const cur = controller.textInput.value;
            if (event.key === "ArrowUp") {
              if (historyCursorRef.current === -1) {
                draftRef.current = cur;
                historyCursorRef.current = hist.length - 1;
              } else {
                historyCursorRef.current = Math.max(0, historyCursorRef.current - 1);
              }
              controller.textInput.setInput(hist[historyCursorRef.current]!);
            } else if (historyCursorRef.current !== -1) {
              historyCursorRef.current = -1;
              controller.textInput.setInput(draftRef.current);
            }
          }
          return;
        }
        if (
          isConversationInProgress &&
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
        }
      },
      [isConversationInProgress, mention, slash],
    );

    return (
      <AIPromptInput
        globalDrop={globalDrop}
        multiple={multiple}
        onSubmit={handleSubmit}
        className="relative"
      >
        {mention.showMenu && (
          <FileMentionMenu
            suggestions={mention.suggestions}
            loading={mention.loading}
            selectedIndex={mention.selectedIndex}
            highlighted={mention.highlighted}
            onSelect={mention.applySuggestion}
          />
        )}
        {slash.showMenu && (
          <SlashCommandMenu
            commands={slash.filteredCommands}
            highlighted={slash.highlightedCommand}
            selectedIndex={slash.selectedIndex}
            onSelect={slash.selectCommand}
          />
        )}
        <PromptInputAttachmentsList />
        {/* 文件引用 ContextChips（对齐 Kun FloatingComposerContextChips） */}
        {desktop && references.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 pb-1">
            {references.map((ref) => (
              <span
                key={ref.relativePath}
                className="bg-muted/60 border-muted-foreground/20 flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2 text-[11px]"
                title={ref.path}
              >
                <FileText className="text-muted-foreground size-3 shrink-0" />
                <span className="max-w-40 truncate">{ref.name}</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground rounded-full p-0.5"
                  title="移除引用"
                  onClick={() =>
                    syncReferences(references.filter((r) => r.relativePath !== ref.relativePath))
                  }
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {/* 排队消息条（对齐 Kun FloatingComposerQueuedMessages） */}
        {desktop && queuedCount > 0 && (
          <div className="relative px-3 pb-1">
            <button
              type="button"
              className="hover:bg-accent/60 flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition"
              onClick={() => setQueuedOpen((v) => !v)}
            >
              <ListTodo className="text-muted-foreground size-3" />
              <span className="text-muted-foreground">{queuedCount} 条排队中 · 空闲后自动发送</span>
              <X
                className="text-muted-foreground hover:text-foreground size-3"
                onClick={(e) => {
                  e.stopPropagation();
                  queuedRef.current = [];
                  setQueuedCount(0);
                  setQueuedOpen(false);
                }}
              />
            </button>
            {queuedOpen ? (
              <div className="bg-popover text-popover-foreground absolute top-full left-2 z-50 mt-1 w-72 overflow-hidden rounded-lg border shadow-md">
                <div className="text-muted-foreground border-b px-3 py-1.5 text-[10px]">
                  排队消息（点击发送前移除）
                </div>
                <div className="max-h-60 overflow-y-auto py-1">
                  {queuedRef.current.map((m, idx) => (
                    <div key={`${idx}-${(m as { text?: string }).text?.slice(0, 8) ?? ""}`} className="hover:bg-accent/60 flex items-center gap-1.5 px-3 py-1.5">
                      <span className="text-muted-foreground min-w-0 flex-1 truncate text-[11px]">
                        {(m as { text?: string }).text ?? "（附件消息）"}
                      </span>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5"
                        onClick={() => {
                          queuedRef.current = queuedRef.current.filter((_, i) => i !== idx);
                          setQueuedCount(queuedRef.current.length);
                        }}
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
        <AIPromptInputBody>
          <AIPromptInputTextarea
            ref={textareaRef}
            onFocus={onTextareaFocus}
            onKeyDown={handleTextareaKeyDown}
            onPaste={handlePaste}
            onSelect={() => {
              mention.syncCursor();
              slash.syncCursor();
            }}
          />
        </AIPromptInputBody>
        <AIPromptInputFooter className="h-13 py-0">
          <AIPromptInputTools>
            {/* 模型选择器（对齐 Kun 在 composer 内同位：容量→模型→智能体→…） */}
            {models.length > 0 && onSelectModel && !hiddenSet.has("more") && (
              <ModelSelector
                models={models}
                selectedModelId={selectedModelId}
                onModelChange={onSelectModel}
                triggerVariant="button"
                className="text-muted-foreground h-7 max-w-48 rounded-full px-2 text-xs"
              />
            )}
            {!hiddenSet.has("more") && <AgentPicker />}
            {desktop && <UsageBadge />}
            {desktop && <ComposerModeTools />}
            {(() => {
              const showFile =
                availableFileTypes.length > 0 && !hiddenSet.has("file") && !hiddenSet.has("more");
              const showFeatureItems = featureMenuItems.filter(
                (item) =>
                  !hiddenSet.has(item.id as PromptInputHiddenTool) && !hiddenSet.has("more"),
              );
              const showExploreApps = !hiddenSet.has("exploreApps") && !hiddenSet.has("more");
              const hasMoreItems = showFile || showFeatureItems.length > 0 || showExploreApps;
              return (
                hasMoreItems && (
                  <DropdownMenu>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <AIPromptInputButton>
                            <Plus size={16} />
                          </AIPromptInputButton>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>更多操作</p>
                      </TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent className="w-38">
                      {showFile && (
                        <DropdownMenuItem onSelect={handleFileSelect}>
                          <PaperclipIcon className="size-4 scale-110 transform" />
                          {hasImageSupport ? "选择照片和文件" : "选择文件"}
                        </DropdownMenuItem>
                      )}
                      {showFeatureItems.map((item) => (
                        <DropdownMenuItem
                          key={item.id}
                          onSelect={() => handleFeatureMenuItemClick(item)}
                        >
                          {item.icon}
                          {item.label}
                        </DropdownMenuItem>
                      ))}
                      {showExploreApps && (
                        <DropdownMenuItem onSelect={handleExploreApps}>
                          <LayoutGridIcon className="size-4" />
                          全部应用
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )
              );
            })()}
            {selectedMenuItemConfig && (
              <AIPromptInputButton
                onClick={handleRemoveSelectedMenuItem}
                className="bg-accent text-accent-foreground"
              >
                {selectedMenuItemConfig.icon}
                <span>{selectedMenuItemConfig.label}</span>
                <X size={14} className="ml-1" />
              </AIPromptInputButton>
            )}
            {quickMenuMcpServer && !hiddenSet.has("quickMenu") && (
              <AIPromptInputButton
                onClick={handleQuickMenuClick}
                className={
                  selectedMcpServerIds.includes(quickMenuMcpServer.id)
                    ? "bg-accent text-accent-foreground"
                    : undefined
                }
              >
                <GlobeIcon size={16} />
                <span>{quickMenuMcpServer.name || "Search"}</span>
              </AIPromptInputButton>
            )}
            {!hiddenSet.has("mcp") && !isLoadingMcpServers && (
              <McpSelector
                mcpServers={mcpServers}
                selectedMcpServerIds={selectedMcpServerIds}
                onSelectionChange={onSelectMcpServers}
              />
            )}
            {children}
          </AIPromptInputTools>
          <div className="flex min-w-0 items-center">
            {context?.onVoiceAudio && !hiddenSet.has("speech") ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex min-w-0 flex-1 items-center">
                    <VoiceInputWithTranscript
                      textareaRef={textareaRef}
                      onAudioRecorded={context.onVoiceAudio}
                      onRecordingChange={setIsVoiceRecording}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>语音输入</p>
                </TooltipContent>
              </Tooltip>
            ) : null}
            <div
              className={cn(
                "ml-2 flex shrink-0 items-center overflow-hidden transition-all duration-300 ease-out",
                isVoiceRecording && "ml-0 w-0 opacity-0",
              )}
            >
              {status === "submitted" || status === "streaming" ? (
                onStop ? (
                  <StopButton onStop={onStop} />
                ) : (
                  <AIPromptInputSubmit className="rounded-full" status={status} />
                )
              ) : (
                <AIPromptInputSubmit className="rounded-full" status={status} />
              )}
            </div>
          </div>
        </AIPromptInputFooter>
      </AIPromptInput>
    );
  },
);

PromptInputInner.displayName = "PromptInputInner";

export const PromptInput = memo((props: PromptInputProps) => {
  const {
    textareaRef,
    status = "ready",
    onSubmit,
    onTextareaFocus,
    onStop,
    globalDrop,
    multiple,
    models,
    selectedModelId,
    selectedMcpServerIds,
    onSelectMcpServers,
    onSetFeature,
    hiddenTools,
    children,
  } = props;

  return (
    <AIPromptInputProvider>
      <PromptInputInner
        textareaRef={textareaRef}
        status={status}
        onSubmit={onSubmit}
        onTextareaFocus={onTextareaFocus}
        onStop={onStop}
        globalDrop={globalDrop}
        multiple={multiple}
        models={models}
        selectedModelId={selectedModelId}
        selectedMcpServerIds={selectedMcpServerIds}
        onSelectMcpServers={onSelectMcpServers}
        onSetFeature={onSetFeature}
        hiddenTools={hiddenTools}
      >
        {children}
      </PromptInputInner>
    </AIPromptInputProvider>
  );
});

PromptInput.displayName = "PromptInput";
