/**
 * Markdown 富文本编辑器（T3.1，对齐 Kun WriteRichEditor + markdown-sync 语义）：
 * Plate 所见即所得编辑（EditorKit 含 Markdown/表格/代码块/工具栏），
 * 保存时 serializeEditorToMarkdown 回写文件；编辑/取消由外层控制。
 */
import {
  Editor,
  EditorContainer,
  EditorKit,
  markdownToValue,
  serializeEditorToMarkdown,
  Plate,
  usePlateEditor,
} from "@buildingai/ui/components/editor";
import { Check, X } from "lucide-react";

export function MarkdownEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (markdown: string) => void;
  onCancel: () => void;
}) {
  const editor = usePlateEditor({
    plugins: EditorKit,
    id: "work-md-editor",
    value: markdownToValue(initial),
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <span className="text-muted-foreground text-[11px]">富文本编辑（保存为 Markdown）</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onSave(serializeEditorToMarkdown(editor))}
          className="text-primary hover:bg-accent flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium"
        >
          <Check className="size-3" /> 保存
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-muted-foreground hover:bg-accent flex items-center gap-1 rounded px-2 py-0.5 text-[11px]"
        >
          <X className="size-3" /> 取消
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <Plate editor={editor}>
          <EditorContainer className="h-full">
            <Editor variant="default" className="min-h-full" placeholder="输入 Markdown 内容…" />
          </EditorContainer>
        </Plate>
      </div>
    </div>
  );
}
