import { MODEL_TYPE_DESCRIPTIONS, type ModelType } from "@buildingai/ai-sdk/interfaces";
import { consoleHttpClient } from "@buildingai/services";
import {
  type AiProvider,
  type AiProviderRemoteModelItem,
  useBatchCreateAiModelsMutation,
} from "@buildingai/services/console";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@buildingai/ui/components/ui/button";
import { Checkbox } from "@buildingai/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import { ScrollArea } from "@buildingai/ui/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@buildingai/ui/components/ui/select";
import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const ALL_MODEL_TYPES = Object.keys(MODEL_TYPE_DESCRIPTIONS) as ModelType[];

type ScanImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: AiProvider | null;
  /** 导入完成回调（用于刷新厂商模型数） */
  onImported?: () => void;
};

/**
 * 自动扫描确认框：快捷创建厂商后拉取其远程模型列表，勾选后一键批量导入。
 */
export const ScanImportDialog = ({
  open,
  onOpenChange,
  provider,
  onImported,
}: ScanImportDialogProps) => {
  const queryClient = useQueryClient();
  const [models, setModels] = useState<AiProviderRemoteModelItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scaning, setScaning] = useState(false);
  const [modelType, setModelType] = useState<string>("llm");

  // 模型类型下拉：优先取厂商支持的子集
  const typeOptions = useMemo(() => {
    const supported = provider?.supportedModelTypes ?? [];
    const list = supported.length > 0
      ? ALL_MODEL_TYPES.filter((t) => supported.includes(t))
      : ALL_MODEL_TYPES;
    return list.length > 0 ? list : ALL_MODEL_TYPES;
  }, [provider?.supportedModelTypes]);

  useEffect(() => {
    if (open && provider) {
      setModels([]);
      setSelected(new Set());
      const first = typeOptions[0] ?? "llm";
      setModelType(first);
      void scan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider?.id]);

  const scan = async () => {
    if (!provider) return;
    setScaning(true);
    try {
      const list = await queryClient.fetchQuery<AiProviderRemoteModelItem[]>({
        queryKey: ["ai-providers", "remote", provider.id],
        queryFn: () =>
          consoleHttpClient.get<AiProviderRemoteModelItem[]>(
            `/ai-providers/remote/${provider.id}`,
          ),
        staleTime: 0,
      });
      const items = list ?? [];
      setModels(items);
      setSelected(new Set(items.map((m) => m.id)));
    } catch (error) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (error as Error)?.message ??
        "未知错误";
      toast.error(`扫描失败：${message}`);
      setModels([]);
    } finally {
      setScaning(false);
    }
  };

  const toggle = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const allChecked = models.length > 0 && selected.size === models.length;

  const batchMutation = useBatchCreateAiModelsMutation({
    onSuccess: (result) => {
      toast.success(
        `导入完成：创建 ${result.created} 个${result.skipped ? `，跳过 ${result.skipped} 个（已存在）` : ""}`,
      );
      onImported?.();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(`导入失败：${error.message}`);
    },
  });

  const handleImport = () => {
    if (!provider || selected.size === 0) return;
    batchMutation.mutate({
      providerId: provider.id,
      modelType,
      models: Array.from(selected).map((id) => ({ id })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导入远程模型</DialogTitle>
          <DialogDescription>
            已扫描「{provider?.name}」下的远程模型，勾选需要导入的模型（已存在的会自动跳过）
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={allChecked}
                onCheckedChange={(checked) => {
                  if (checked) setSelected(new Set(models.map((m) => m.id)));
                  else setSelected(new Set());
                }}
              />
              全选（{models.length}）
            </label>
            <label className="flex items-center gap-2 text-sm">统一模型类型</label>
            <Select value={modelType} onValueChange={setModelType}>
              <SelectTrigger className="h-8 w-44">
                <SelectValue placeholder="模型类型" />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map((t) => (
                  <SelectItem key={t} value={t}>
                    {MODEL_TYPE_DESCRIPTIONS[t].name}
                    <span className="text-muted-foreground ml-1 text-xs">
                      ({MODEL_TYPE_DESCRIPTIONS[t].description})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" variant="outline" onClick={() => void scan()} disabled={scaning}>
            {scaning ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            重新扫描
          </Button>
        </div>

        <ScrollArea className="max-h-64 rounded-md border">
          {scaning ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm">
              <Loader2 className="animate-spin" />
              扫描 {provider?.name} 的远程模型...
            </div>
          ) : models.length === 0 ? (
            <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
              未发现可用模型（请确认接口地址与 API 密钥）
            </div>
          ) : (
            <div className="flex flex-col">
              {models.map((m) => (
                <label
                  key={m.id}
                  className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 px-3 py-2 text-sm"
                >
                  <Checkbox
                    checked={selected.has(m.id)}
                    onCheckedChange={(checked) => toggle(m.id, !!checked)}
                  />
                  <span className="truncate font-mono text-xs">{m.id}</span>
                </label>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            稍后再说
          </Button>
          <Button
            type="button"
            onClick={handleImport}
            disabled={batchMutation.isPending || selected.size === 0}
          >
            {batchMutation.isPending && <Loader2 className="animate-spin" />}
            导入所选（{selected.size}）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};