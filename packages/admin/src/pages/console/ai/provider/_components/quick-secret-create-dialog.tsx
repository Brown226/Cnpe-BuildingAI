import {
  useAllSecretTemplatesQuery,
  useCreateSecretMutation,
} from "@buildingai/services/console";
import { Button } from "@buildingai/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import { Input } from "@buildingai/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@buildingai/ui/components/ui/select";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type QuickSecretCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 优先选中的密钥模板 */
  defaultTemplateId?: string;
  /** 创建成功回调，返回新密钥 id */
  onCreated: (secretId: string) => void;
};

/**
 * 快速新建密钥弹窗：选模板 → 按模板字段填写 → 保存后自动绑定。
 * 让「新建厂商」不必先绕道独立的密钥管理页。
 */
export const QuickSecretCreateDialog = ({
  open,
  onOpenChange,
  defaultTemplateId,
  onCreated,
}: QuickSecretCreateDialogProps) => {
  const { data: templates = [] } = useAllSecretTemplatesQuery({ enabled: open });
  const enabledTemplates = templates.filter((t) => t.isEnabled === 1);

  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const preferred =
      enabledTemplates.find((t) => t.id === defaultTemplateId) ?? enabledTemplates[0];
    setTemplateId(preferred?.id ?? "");
    setName(preferred ? `${preferred.name} 密钥` : "");
    setFieldValues({});
    setMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultTemplateId, templates]);

  const template = enabledTemplates.find((t) => t.id === templateId);

  const createMutation = useCreateSecretMutation({
    onSuccess: (secret) => {
      toast.success("密钥已创建");
      onCreated(secret.id);
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(`创建失败: ${error.message}`);
    },
  });

  const handleSubmit = () => {
    if (!template) return;
    const missing = template.fieldConfig.filter(
      (field) => field.required && !(fieldValues[field.name] ?? "").trim(),
    );
    if (missing.length > 0) {
      setMessage(`请填写必填项：${missing.map((field) => field.name).join("、")}`);
      return;
    }
    createMutation.mutate({
      name: name.trim() || `${template.name} 密钥`,
      templateId: template.id,
      fieldValues: template.fieldConfig.map((field) => ({
        name: field.name,
        value: (fieldValues[field.name] ?? "").trim(),
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>快速新建密钥</DialogTitle>
          <DialogDescription>选择模板并填写字段，保存后自动绑定到该厂商</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">密钥模板</label>
            <Select
              value={templateId}
              onValueChange={(value) => {
                const next = enabledTemplates.find((t) => t.id === value);
                setTemplateId(value);
                if (next) setName(`${next.name} 密钥`);
              }}
              disabled={enabledTemplates.length <= 1}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择密钥模板" />
              </SelectTrigger>
              <SelectContent>
                {enabledTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {enabledTemplates.length === 0 && (
              <p className="text-muted-foreground text-xs">
                暂无可用的密钥模板，请先在密钥管理中创建模板
              </p>
            )}
          </div>

          {template && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">密钥名称</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="给这份密钥起个名字"
                />
              </div>

              {template.fieldConfig.map((field) => (
                <div key={field.name} className="space-y-2">
                  <label className="text-sm font-medium">
                    {field.name}
                    {field.required && <span className="text-destructive"> *</span>}
                  </label>
                  <Input
                    value={fieldValues[field.name] ?? ""}
                    onChange={(e) =>
                      setFieldValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                    }
                    placeholder={field.placeholder || `请输入${field.name}`}
                  />
                </div>
              ))}
            </>
          )}

          {message && <p className="text-destructive text-xs">{message}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="animate-spin" />}
            创建并绑定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};