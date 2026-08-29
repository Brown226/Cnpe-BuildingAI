import { definePageMeta, useDocumentHead } from "@buildingai/hooks";
import {
  type ChatConfig,
  useAiProvidersQuery,
  useChatConfigQuery,
  useConversationQuery,
} from "@buildingai/services/web";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import type { Suggestion } from "@/components/ask-assistant-ui";
import { AssistantProvider, Chat, useAssistant } from "@/components/ask-assistant-ui";
import { getLocalThread } from "@/services/desktop/thread-store";
import { TerminalPanel } from "@/components/desktop/terminal-panel";
import {
    getSplitSessionId,
    SPLIT_CHANGED_EVENT,
} from "@/services/desktop/split-store";
import {
    getTerminalOpen,
    TERMINAL_CHANGED_EVENT,
} from "@/services/desktop/terminal-store";
import { isDesktop } from "@/services/desktop/desktop-api";

const DEFAULT_SUGGESTIONS: Suggestion[] = [
  { id: "1", text: "如何开始使用 React Hooks？" },
  { id: "2", text: "TypeScript 的最佳实践是什么？" },
  { id: "3", text: "如何优化 React 应用的性能？" },
];

export const meta = definePageMeta({
  title: "对话",
  description: "开始新的对话",
  icon: "square-pen",
});

const IndexPage = () => {
  const { id } = useParams<{ id: string }>();
  const { data: providers = [] } = useAiProvidersQuery({ supportedModelTypes: "llm" });
  const { data: conversation } = useConversationQuery(id || "", { enabled: !!id });
  const { data: rawChatConfig } = useChatConfigQuery();
  const chatConfig = rawChatConfig as ChatConfig | undefined;

  // 分屏副会话（T2.1 split view）
  const [splitId, setSplitId] = useState<string | null>(() => getSplitSessionId());
  useEffect(() => {
    const handler = () => setSplitId(getSplitSessionId());
    window.addEventListener(SPLIT_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SPLIT_CHANGED_EVENT, handler);
  }, []);

  // B1 底部终端：仅桌面端渲染，开合状态变化即重渲染
  const [terminalOpen, setTerminalOpen] = useState<boolean>(() => isDesktop() && getTerminalOpen());
  useEffect(() => {
    if (!isDesktop()) return;
    const handler = () => setTerminalOpen(getTerminalOpen());
    window.addEventListener(TERMINAL_CHANGED_EVENT, handler);
    return () => window.removeEventListener(TERMINAL_CHANGED_EVENT, handler);
  }, []);

  useDocumentHead({
    title: id ? conversation?.title || "新对话" : "新对话",
  });

  const suggestions: Suggestion[] = useMemo(() => {
    if (!chatConfig) return DEFAULT_SUGGESTIONS;
    if (!chatConfig.suggestionsEnabled) return [];
    const list = Array.isArray(chatConfig.suggestions) ? chatConfig.suggestions : [];
    return list
      .filter((item): item is { icon?: string; text: string } => Boolean(item?.text))
      .map((item, index) => ({ id: String(index), text: item.text }));
  }, [chatConfig]);

  const welcomeInfo = chatConfig?.welcomeInfo;

  const assistant = useAssistant({ providers, suggestions });
  // 分屏副实例：hooks 不可条件调用，splitId 为空时 override 传 undefined（无副作用）
  const splitAssistant = useAssistant({
    providers,
    suggestions,
    threadIdOverride: splitId ?? undefined,
  });
  const splitThread = splitId ? getLocalThread(splitId) : null;

  const mainChat = (
    <AssistantProvider {...assistant} showMcpToolDetails={chatConfig?.showMcpToolDetails ?? true}>
      <Chat
        title={conversation?.title || "新对话"}
        welcomeTitle={welcomeInfo?.title}
        welcomeDescription={welcomeInfo?.description}
        footerText={welcomeInfo?.footer}
      />
    </AssistantProvider>
  );

  if (splitId) {
    return (
      <div className="grid h-full min-h-0 grid-cols-2 divide-x">
        <div className="min-h-0 min-w-0">{mainChat}</div>
        <div className="min-h-0 min-w-0">
          <AssistantProvider
            {...splitAssistant}
            showMcpToolDetails={chatConfig?.showMcpToolDetails ?? true}
          >
            <Chat
              title={splitThread?.title || "分屏会话"}
              welcomeTitle={welcomeInfo?.title}
              welcomeDescription={welcomeInfo?.description}
              footerText={welcomeInfo?.footer}
            />
          </AssistantProvider>
        </div>
      </div>
    );
  }

  if (terminalOpen) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">{mainChat}</div>
        <TerminalPanel />
      </div>
    );
  }

  return mainChat;
};

export default IndexPage;
