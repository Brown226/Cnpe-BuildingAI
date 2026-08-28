/**
 * 会话用量徽章（①-4 用量历史）：复用 buildingai 的 Context 组件。
 * 圆环显示当前上下文用量占比（128k = Pi 引擎 contextWindow），
 * hover 展示输入/输出/缓存 token 明细。
 */
import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextTrigger,
} from "@buildingai/ui/components/ai-elements/context";
import { useAssistantStore } from "@buildingai/stores";
import type { ReactNode } from "react";

/** Pi 引擎 buildModelObject 的 contextWindow（对齐 agent-core） */
const DESKTOP_CONTEXT_WINDOW = 128_000;

export function UsageBadge() {
  const sessionUsage = useAssistantStore((s) => s.sessionUsage);
  if (sessionUsage.inputTokens === 0 && sessionUsage.outputTokens === 0) return null;

  return (
    <Context
      usedTokens={sessionUsage.inputTokens}
      maxTokens={DESKTOP_CONTEXT_WINDOW}
      usage={{
        inputTokens: sessionUsage.inputTokens,
        outputTokens: sessionUsage.outputTokens,
        totalTokens: sessionUsage.inputTokens + sessionUsage.outputTokens,
        cachedInputTokens: sessionUsage.cacheReadTokens,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: sessionUsage.cacheReadTokens,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      }}
      modelId=""
    >
      <ContextTrigger />
      <ContextContent>
        <ContextContentHeader />
        <ContextContentBodyWrapper>
          <ContextInputUsage />
          <ContextOutputUsage />
          <ContextCacheUsage />
        </ContextContentBodyWrapper>
      </ContextContent>
    </Context>
  );
}

function ContextContentBodyWrapper({ children }: { children: ReactNode }) {
  return <div className="space-y-1.5 p-3 text-xs">{children}</div>;
}