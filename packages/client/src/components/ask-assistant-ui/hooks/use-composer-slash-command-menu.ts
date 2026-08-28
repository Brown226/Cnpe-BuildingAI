/**
 * 斜杠命令菜单 hook（对齐 Kun use-composer-slash-command-menu，裁剪为 BuildingAI 能力）。
 * 检测光标处 `/`、过滤命令、键盘导航、选中回调。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

import { buildSlashCommands, getSlashQueryAtCursor } from "../libs/slash-commands";

type Options = {
  enabled: boolean;
  input: string;
  canCreateNewThread: boolean;
  activeThreadId: string | null;
  busy: boolean;
  menuBlocked: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onSelect: (commandId: string) => void;
  onDismiss: () => void;
};

export function useComposerSlashCommandMenu({
  enabled,
  input,
  canCreateNewThread,
  activeThreadId,
  busy,
  menuBlocked,
  textareaRef,
  onSelect,
  onDismiss,
}: Options) {
  const [cursor, setCursor] = useState(() => input.length);

  const slashQuery = useMemo(
    () => (enabled ? getSlashQueryAtCursor(input, cursor) : null),
    [enabled, input, cursor],
  );

  const commands = useMemo(
    () => buildSlashCommands({ canCreateNewThread, activeThreadId, busy }),
    [canCreateNewThread, activeThreadId, busy],
  );

  const filteredCommands = useMemo(() => {
    if (slashQuery == null) return [];
    if (!slashQuery) return commands;
    return commands.filter((command) => {
      const haystack = [command.id, command.title, command.description, ...command.keywords];
      return haystack.some((part) => part.toLowerCase().includes(slashQuery));
    });
  }, [commands, slashQuery]);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const highlightedCommand =
    filteredCommands.length > 0
      ? filteredCommands[Math.min(selectedIndex, filteredCommands.length - 1)]
      : null;

  useEffect(() => setSelectedIndex(0), [slashQuery]);

  const showMenu = enabled && slashQuery != null && !menuBlocked;

  const syncCursor = useCallback(
    (element = textareaRef?.current) => {
      if (element) setCursor(element.selectionStart ?? input.length);
    },
    [input.length, textareaRef],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>, composing: boolean): boolean => {
      if (composing || slashQuery == null || !showMenu) return false;
      if (event.key === "ArrowDown" && filteredCommands.length > 0) {
        event.preventDefault();
        setSelectedIndex((current) => (current + 1) % filteredCommands.length);
        return true;
      }
      if (event.key === "ArrowUp" && filteredCommands.length > 0) {
        event.preventDefault();
        setSelectedIndex((current) => (current === 0 ? filteredCommands.length - 1 : current - 1));
        return true;
      }
      if (event.key === "Enter" && !event.shiftKey && highlightedCommand && !highlightedCommand.disabled) {
        event.preventDefault();
        onSelect(highlightedCommand.id);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
        return true;
      }
      return false;
    },
    [slashQuery, showMenu, filteredCommands, highlightedCommand, onSelect, onDismiss],
  );

  return {
    showMenu,
    commands,
    filteredCommands,
    highlightedCommand,
    selectedIndex,
    syncCursor,
    handleKeyDown,
    selectCommand: onSelect,
  };
}