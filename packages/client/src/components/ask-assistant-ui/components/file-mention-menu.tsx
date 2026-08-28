/**
 * 文件 @ 提及菜单（对齐 Kun FloatingComposerFileMentionMenu，文件部分）。
 * 键盘同步 + 高亮列表；知识库分组属后置低优先项。
 */
import { FileText, Folder, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  composerFileReferenceKey,
  formatComposerFileMentionToken,
  isComposerDirectoryReference,
  type ComposerFileReference,
} from "../libs/composer-file-references";

type Props = {
  suggestions: ComposerFileReference[];
  loading: boolean;
  selectedIndex: number;
  highlighted: ComposerFileReference | null;
  onSelect: (suggestion: ComposerFileReference) => void;
};

export function FileMentionMenu({
  suggestions,
  loading,
  selectedIndex,
  highlighted,
  onSelect,
}: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const highlightedKey = highlighted ? composerFileReferenceKey(highlighted) : null;

  useEffect(() => {
    if (!highlightedKey) return;
    itemRefs.current.get(highlightedKey)?.scrollIntoView({ block: "nearest" });
  }, [highlightedKey, selectedIndex, suggestions.length]);

  return (
    <div className="bg-popover absolute bottom-full left-1/2 z-30 mb-2 w-[calc(100%_-_1rem)] max-w-[680px] -translate-x-1/2 overflow-hidden rounded-lg p-1.5 shadow-lg">
      <div className="text-muted-foreground flex h-7 items-center gap-2 px-2.5 text-xs font-semibold">
        <FileText className="size-3.5" strokeWidth={1.9} />
        <span>引用工作区文件</span>
        {loading ? <Loader2 className="size-3.5 animate-spin" strokeWidth={1.9} /> : null}
      </div>
      {suggestions.length > 0 ? (
        <div
          ref={menuRef}
          className="flex max-h-[min(280px,calc(100vh-260px))] flex-col gap-0.5 overflow-y-auto pr-1"
        >
          {suggestions.map((suggestion) => {
            const isDirectory = isComposerDirectoryReference(suggestion);
            const key = composerFileReferenceKey(suggestion);
            const active = highlightedKey === key;
            return (
              <button
                key={key}
                ref={(node) => {
                  if (node) itemRefs.current.set(key, node);
                  else itemRefs.current.delete(key);
                }}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(suggestion)}
                className={`flex min-h-[46px] w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition ${
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                }`}
              >
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-md ${
                    active ? "bg-background" : "bg-muted"
                  }`}
                >
                  {isDirectory ? (
                    <Folder className="size-4" strokeWidth={1.8} />
                  ) : (
                    <FileText className="size-4" strokeWidth={1.8} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold leading-5">
                    {isDirectory ? `${suggestion.name}/` : suggestion.name}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block truncate text-xs leading-4">
                    {isDirectory ? `${suggestion.relativePath}/` : suggestion.relativePath}
                  </span>
                </span>
                <span className="text-muted-foreground hidden max-w-[170px] shrink-0 truncate rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4 sm:block">
                  {formatComposerFileMentionToken(suggestion.relativePath, isDirectory)}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="text-muted-foreground rounded-md border border-dashed px-3 py-3 text-xs">
          {loading ? "正在加载文件…" : "无匹配文件"}
        </div>
      )}
    </div>
  );
}