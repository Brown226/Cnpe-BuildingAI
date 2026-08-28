/**
 * 斜杠命令菜单（对齐 Kun FloatingComposerSlashCommandMenu）。
 * 键盘同步高亮列表；命令目录见 slash-commands.ts。
 */
import { useEffect, useRef } from "react";

import type { SlashCommand } from "../libs/slash-commands";

type Props = {
  commands: SlashCommand[];
  highlighted: SlashCommand | null;
  selectedIndex: number;
  onSelect: (commandId: string) => void;
};

export function SlashCommandMenu({ commands, highlighted, selectedIndex, onSelect }: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const highlightedId = highlighted?.id ?? null;

  useEffect(() => {
    if (!highlightedId) return;
    itemRefs.current.get(highlightedId)?.scrollIntoView({ block: "nearest" });
  }, [commands.length, highlightedId, selectedIndex]);

  return (
    <div className="bg-popover absolute bottom-full left-1/2 z-30 mb-2 w-[calc(100%_-_1rem)] max-w-[760px] -translate-x-1/2 overflow-hidden rounded-lg p-1.5 shadow-lg">
      <div className="text-muted-foreground flex h-7 items-center px-2.5 text-xs font-semibold">
        命令
      </div>
      {commands.length > 0 ? (
        <div
          ref={menuRef}
          className="flex max-h-[min(300px,calc(100vh-260px))] flex-col gap-0.5 overflow-y-auto pr-1"
        >
          {commands.map((command) => {
            const active = highlightedId === command.id;
            return (
              <button
                key={command.id}
                ref={(node) => {
                  if (node) itemRefs.current.set(command.id, node);
                  else itemRefs.current.delete(command.id);
                }}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(command.id)}
                disabled={command.disabled}
                className={`flex min-h-[52px] w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
                  active && !command.disabled
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:hover:bg-transparent"
                }`}
              >
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-md ${
                    active && !command.disabled ? "bg-background" : "bg-muted"
                  }`}
                >
                  {command.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold leading-5">
                    {command.title}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block truncate text-xs leading-4">
                    {command.description}
                  </span>
                </span>
                <span className="text-muted-foreground hidden max-w-[150px] shrink-0 truncate rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4 sm:block">
                  {command.badge ?? `/${command.id}`}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="text-muted-foreground rounded-md border border-dashed px-3 py-3 text-xs">
          无匹配命令
        </div>
      )}
    </div>
  );
}