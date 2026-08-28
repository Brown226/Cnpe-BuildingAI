/**
 * 斜杠命令目录（对齐 Kun floating-composer-commands，裁剪为 BuildingAI 真实能力）。
 * 命令：/new 新建会话、/archive 归档、/code 与 /work 模式切换。
 * 说明：Kun 的 /plan /btw /review /compact /fork /goal 是其 agent 循环的手动命令，
 * BuildingAI 的 Pi 引擎无对应（压缩为自动），故不迁移——避免无后端的虚假命令。
 */
import { Archive, Code2, FileText, Plus } from "lucide-react";
import type { ReactNode } from "react";

export type SlashCommand = {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  icon: ReactNode;
  disabled?: boolean;
  badge?: string;
};

export function buildSlashCommands(input: {
  canCreateNewThread: boolean;
  activeThreadId: string | null;
  busy: boolean;
}): SlashCommand[] {
  const threadActionDisabled = !input.activeThreadId || input.busy;
  return [
    {
      id: "new",
      title: "新建会话",
      description: "开始一个全新的对话",
      keywords: ["new", "create", "thread", "chat", "新建", "会话"],
      icon: <Plus className="size-4" strokeWidth={1.9} />,
      disabled: !input.canCreateNewThread,
      badge: "/new",
    },
    {
      id: "code",
      title: "Code 模式",
      description: "切换到编程工作模式",
      keywords: ["code", "编程", "开发", "代码"],
      icon: <Code2 className="size-4" strokeWidth={1.9} />,
      badge: "/code",
    },
    {
      id: "work",
      title: "Work 模式",
      description: "切换到办公写作模式",
      keywords: ["work", "办公", "写作", "文档"],
      icon: <FileText className="size-4" strokeWidth={1.9} />,
      badge: "/work",
    },
    {
      id: "archive",
      title: "归档当前会话",
      description: "归档当前会话并从列表隐藏",
      keywords: ["archive", "hide", "归档", "隐藏"],
      icon: <Archive className="size-4" strokeWidth={1.9} />,
      disabled: threadActionDisabled,
      badge: "/archive",
    },
  ];
}

/** 光标处的斜杠查询：行首或空白后紧跟 `/` 时返回查询串；否则 null */
export function getSlashQueryAtCursor(input: string, cursor: number): string | null {
  const boundedCursor = Math.max(0, Math.min(cursor, input.length));
  const beforeCursor = input.slice(0, boundedCursor);
  const match = /(^|[\s\n])[/]([^\s/]*)$/u.exec(beforeCursor);
  if (!match) return null;
  return match[2] ?? "";
}