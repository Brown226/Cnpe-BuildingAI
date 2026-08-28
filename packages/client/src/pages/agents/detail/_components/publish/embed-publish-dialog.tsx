import { Button } from "@buildingai/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import { Copy } from "lucide-react";
import { useMemo, useState } from "react";

const EMBED_MODES = [
  {
    value: "inline",
    title: "页面内嵌",
    description: "适合在页面正文区域内完整展示聊天界面",
  },
  {
    value: "float-desktop",
    title: "桌面悬浮",
    description: "适合在桌面站右下角悬浮展示聊天入口",
  },
  {
    value: "float-mobile",
    title: "移动浮窗",
    description: "适合移动端页面的轻量悬浮入口",
  },
] as const;

type EmbedMode = (typeof EMBED_MODES)[number]["value"];

interface EmbedPublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  publicLink: string;
  iframeCode: string;
  floatingScriptCode: string;
  mobileScriptCode: string;
  onPublish: () => void;
  onCopy: (value: string, successMessage: string) => void | Promise<void>;
}

function PreviewCard({ selected, mode }: { selected: boolean; mode: EmbedMode }) {
  const isInline = mode === "inline";
  const isDesktop = mode === "float-desktop";

  return (
    <div
      className={`relative h-31 overflow-hidden rounded-2xl border bg-[#F7F8FA] p-3 transition-all ${
        selected ? "border-[#4F7CFF] ring-1 ring-[#4F7CFF]/20" : "border-transparent"
      }`}
    >
      <div className="space-y-1">
        <div className="h-1.5 w-8 rounded-full bg-[#D8DCE5]" />
        <div className="h-1.5 w-14 rounded-full bg-[#E4E7EE]" />
      </div>

      {isInline ? (
        <div className="mt-4 flex h-[78px] items-start justify-center">
          <div className="h-full w-[82%] rounded-xl border border-[#B8C9FF] bg-white p-3 shadow-[0_6px_18px_rgba(79,124,255,0.12)]">
            <div className="mb-2 flex items-center gap-2">
              <div className="size-5 rounded-full bg-[#CFE0FF]" />
              <div className="h-2 w-18 rounded-full bg-[#E7EBF3]" />
            </div>
            <div className="space-y-1">
              <div className="h-2 w-full rounded-full bg-[#EEF1F6]" />
              <div className="h-2 w-3/4 rounded-full bg-[#EEF1F6]" />
            </div>
          </div>
        </div>
      ) : null}

      {isDesktop ? (
        <div className="relative mt-4 h-[78px]">
          <div className="absolute right-3 bottom-2 h-16 w-20 rounded-xl border border-[#B8C9FF] bg-white p-2 shadow-[0_6px_18px_rgba(79,124,255,0.16)]">
            <div className="mb-2 flex items-center gap-1.5">
              <div className="size-4 rounded-full bg-[#CFE0FF]" />
              <div className="h-1.5 w-10 rounded-full bg-[#E7EBF3]" />
            </div>
            <div className="space-y-1">
              <div className="h-1.5 w-full rounded-full bg-[#EEF1F6]" />
              <div className="h-1.5 w-2/3 rounded-full bg-[#EEF1F6]" />
            </div>
          </div>
          <div className="absolute right-1 bottom-0 flex size-4 items-center justify-center rounded-full bg-[#4F7CFF] text-white shadow-sm">
            <div className="size-1.5 rounded-full bg-white" />
          </div>
        </div>
      ) : null}

      {mode === "float-mobile" ? (
        <div className="relative mt-3 flex h-[82px] items-start justify-end">
          <div className="mr-4 h-[76px] w-[46px] rounded-[12px] border border-[#B8C9FF] bg-white p-1.5 shadow-[0_6px_18px_rgba(79,124,255,0.16)]">
            <div className="mb-1.5 flex items-center gap-1">
              <div className="size-3 rounded-full bg-[#CFE0FF]" />
              <div className="h-1.5 w-5 rounded-full bg-[#E7EBF3]" />
            </div>
            <div className="space-y-1">
              <div className="h-1 w-full rounded-full bg-[#EEF1F6]" />
              <div className="h-1 w-2/3 rounded-full bg-[#EEF1F6]" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * JS 嵌入发布弹框，按原型展示嵌入方式选择和对应代码。
 */
export function EmbedPublishDialog({
  open,
  onOpenChange,
  publicLink,
  iframeCode,
  floatingScriptCode,
  mobileScriptCode,
  onCopy,
}: EmbedPublishDialogProps) {
  const [selectedMode, setSelectedMode] = useState<EmbedMode>("inline");

  const currentCode = useMemo(() => {
    if (selectedMode === "float-desktop") return floatingScriptCode;
    if (selectedMode === "float-mobile") return mobileScriptCode;
    return iframeCode;
  }, [floatingScriptCode, iframeCode, mobileScriptCode, selectedMode]);

  const currentTitle = useMemo(() => {
    if (selectedMode === "float-desktop") {
      return "将以下 JavaScript 浮窗代码嵌入到你的网站中";
    }
    if (selectedMode === "float-mobile") {
      return "将以下移动端浮窗代码嵌入到你的网站中";
    }
    return "将以下 iframe 嵌入到你的网站中的目标位置";
  }, [selectedMode]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full gap-0 rounded-[24px] p-0 md:max-w-4xl">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-2xl font-semibold">
            <span>嵌入到网站中</span>
          </DialogTitle>
          <p className="text-muted-foreground text-sm">选择一种方式将聊天应用嵌入到你的网站中</p>
        </DialogHeader>

        <div className="max-h-[78vh] space-y-6 overflow-y-auto px-6 py-5">
          <div className="grid gap-3 md:grid-cols-3">
            {EMBED_MODES.map((item) => {
              const selected = selectedMode === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  className="space-y-3 text-left"
                  onClick={() => setSelectedMode(item.value)}
                >
                  <PreviewCard selected={selected} mode={item.value} />
                  <div className="space-y-1 px-1">
                    <div className="text-sm font-medium">{item.title}</div>
                    <div className="text-muted-foreground text-xs leading-5">
                      {item.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="bg-background rounded-2xl border p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{currentTitle}</div>
                <div className="text-muted-foreground mt-1 text-xs break-all">
                  {publicLink || "发布后显示公开访问链接"}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="bg-background size-9 shrink-0"
                onClick={() => onCopy(currentCode, "嵌入代码已复制")}
              >
                <Copy className="size-4" />
              </Button>
            </div>

            <div className="bg-background overflow-hidden rounded-xl border">
              <pre className="overflow-x-auto p-4 text-xs leading-6 whitespace-pre-wrap">
                <code>{currentCode}</code>
              </pre>
            </div>
          </div>

          <div className="bg-muted/20 text-muted-foreground rounded-2xl border px-4 py-3 text-xs leading-6">
            {selectedMode === "inline"
              ? "推荐优先使用 iframe 方式，接入成本最低，兼容性最好。"
              : "浮窗方式本质上仍然通过 iframe 承载公开页，只是由脚本在页面中动态挂载。"}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
