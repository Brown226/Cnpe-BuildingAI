/**
 * 文件 @ 提及 hook（对齐 Kun use-composer-file-mentions，适配 BuildingAI）。
 * 监听光标处的 @token、搜索工作区文件、键盘导航、token 替换与引用增删同步。
 * 知识库 mention 属后续低优先项（BuildingAI datasets），此处先做文件引用。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

import {
  composerFileReferenceKey,
  filterWorkspaceFileMentionSuggestions,
  formatComposerFileMentionToken,
  getFileMentionAtCursor,
  hasComposerFileMentionToken,
  isComposerDirectoryReference,
  mergeComposerFileReferences,
  removeComposerFileMentionToken,
  replaceFileMentionInInput,
  type ComposerFileMention,
  type ComposerFileReference,
} from "../libs/composer-file-references";
import {
  loadWorkspaceFileIndex,
  loadWorkspaceMentionPathSuggestions,
  mergeMentionCandidates,
} from "../libs/workspace-file-index";

export function shouldCaptureFileMentionCommitKey(
  event: Pick<ReactKeyboardEvent<HTMLTextAreaElement>, "key" | "shiftKey" | "metaKey" | "ctrlKey">,
): boolean {
  if (event.key === "Tab") return true;
  return event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey;
}

type Options = {
  enabled: boolean;
  input: string;
  setInput: (value: string) => void;
  workspaceRoot: string | null;
  menuBlocked: boolean;
  references: ComposerFileReference[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  focusComposer: () => void;
  onAdd?: (reference: ComposerFileReference) => void;
  onRemove?: (relativePath: string) => void;
};

export function useComposerFileMentions({
  enabled,
  input,
  setInput,
  workspaceRoot,
  menuBlocked,
  references,
  textareaRef,
  focusComposer,
  onAdd,
  onRemove,
}: Options) {
  const [cursor, setCursor] = useState(() => input.length);
  const [suggestions, setSuggestions] = useState<ComposerFileReference[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const presenceRef = useRef<Map<string, boolean>>(new Map());

  const activeMention = useMemo<ComposerFileMention | null>(() => {
    if (!enabled || !workspaceRoot) return null;
    return getFileMentionAtCursor(input, cursor);
  }, [cursor, enabled, input, workspaceRoot]);

  const activeKey = activeMention
    ? `${activeMention.start}:${activeMention.query}:${activeMention.quoted ? "q" : "p"}`
    : null;
  const showMenu = enabled && Boolean(activeMention) && activeKey !== dismissedKey && !menuBlocked;
  const highlighted =
    suggestions.length > 0 ? suggestions[Math.min(selectedIndex, suggestions.length - 1)] : null;

  useEffect(() => setSelectedIndex(0), [activeKey]);

  useEffect(() => {
    if (!showMenu || !activeMention || !workspaceRoot) {
      setSuggestions((current) => (current.length === 0 ? current : []));
      setLoading(false);
      return;
    }
    let cancelled = false;
    const query = activeMention.query;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void Promise.all([
        loadWorkspaceFileIndex(workspaceRoot),
        loadWorkspaceMentionPathSuggestions(workspaceRoot, query).catch(() => []),
      ])
        .then(([index, pathSuggestions]) => {
          if (cancelled) return;
          const candidates = mergeMentionCandidates(
            [...index.directories, ...index.files],
            pathSuggestions,
          );
          setSuggestions(filterWorkspaceFileMentionSuggestions(candidates, query, references));
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeMention, references, showMenu, workspaceRoot]);

  // references ↔ token 同步：token 被删则移除引用
  useEffect(() => {
    const previous = presenceRef.current;
    const next = new Map<string, boolean>();
    const removedRelativePaths: string[] = [];
    for (const reference of references) {
      const key = composerFileReferenceKey(reference);
      const present = hasComposerFileMentionToken(
        input,
        reference.relativePath,
        isComposerDirectoryReference(reference),
      );
      if (previous.get(key) === true && !present) removedRelativePaths.push(reference.relativePath);
      next.set(key, present);
    }
    presenceRef.current = next;
    if (!onRemove) return;
    for (const relativePath of removedRelativePaths) onRemove(relativePath);
  }, [input, onRemove, references]);

  const syncCursor = useCallback(
    (element = textareaRef.current) => {
      if (element) setCursor(element.selectionStart ?? input.length);
    },
    [input.length, textareaRef],
  );

  const applySuggestion = useCallback(
    (suggestion: ComposerFileReference | null) => {
      if (!suggestion || !activeMention) return;
      const next = replaceFileMentionInInput(input, activeMention, suggestion);
      setInput(next.input);
      onAdd?.(suggestion);
      setDismissedKey(null);
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(next.cursor, next.cursor);
        setCursor(next.cursor);
      });
    },
    [activeMention, input, onAdd, setInput, textareaRef],
  );

  const removeReference = useCallback(
    (reference: ComposerFileReference) => {
      onRemove?.(reference.relativePath);
      presenceRef.current.set(composerFileReferenceKey(reference), false);
      const nextInput = removeComposerFileMentionToken(
        input,
        reference.relativePath,
        isComposerDirectoryReference(reference),
      );
      if (nextInput !== input) {
        setInput(nextInput);
        window.requestAnimationFrame(() => syncCursor());
      }
      focusComposer();
    },
    [focusComposer, input, onRemove, setInput, syncCursor],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>, composing: boolean): boolean => {
      if (composing || !showMenu) return false;
      if (event.key === "ArrowDown" && suggestions.length > 0) {
        event.preventDefault();
        setSelectedIndex((current) => (current + 1) % suggestions.length);
        return true;
      }
      if (event.key === "ArrowUp" && suggestions.length > 0) {
        event.preventDefault();
        setSelectedIndex((current) => (current === 0 ? suggestions.length - 1 : current - 1));
        return true;
      }
      if (shouldCaptureFileMentionCommitKey(event)) {
        event.preventDefault();
        if (highlighted) applySuggestion(highlighted);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedKey(activeKey);
        setSuggestions([]);
        return true;
      }
      return false;
    },
    [activeKey, applySuggestion, highlighted, showMenu, suggestions.length],
  );

  return {
    showMenu,
    suggestions,
    loading,
    selectedIndex,
    highlighted,
    setCursor,
    syncCursor,
    applySuggestion,
    removeReference,
    handleKeyDown,
    addReference: (reference: ComposerFileReference) =>
      onAdd?.(reference),
  };
}

export { formatComposerFileMentionToken, mergeComposerFileReferences };