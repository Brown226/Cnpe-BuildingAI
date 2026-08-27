import type { RoleEntity } from "@buildingai/services/console";
import { useCreateRoleMutation, useUpdateRoleMutation } from "@buildingai/services/console";
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
import { Label } from "@buildingai/ui/components/ui/label";
import { Textarea } from "@buildingai/ui/components/ui/textarea";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

interface CreateRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  role?: RoleEntity | null;
}

/**
 * 创建角色弹框组件
 */
export const EditRoleDialog = ({ open, onOpenChange, onSuccess, role }: CreateRoleDialogProps) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const isEdit = useMemo(() => !!role?.id, [role?.id]);

  const createMutation = useCreateRoleMutation({
    onSuccess: () => {
      toast.success("创建成功");
      handleClose();
      onSuccess?.();
    },
  });

  const updateMutation = useUpdateRoleMutation({
    onSuccess: () => {
      toast.success("更新成功");
      handleClose();
      onSuccess?.();
    },
  });

  useEffect(() => {
    if (!open) return;

    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
  }, [open, role?.id, role?.name, role?.description]);

  const handleClose = () => {
    setName("");
    setDescription("");
    onOpenChange(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("请输入角色名称");
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
    };

    if (isEdit && role?.id) {
      updateMutation.mutate({
        id: role.id,
        ...payload,
      });
      return;
    }

    createMutation.mutate(payload);
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "编辑角色" : "新增角色"}</DialogTitle>
            <DialogDescription>
              {isEdit ? "修改角色的名称和描述" : "创建一个新的角色，设置角色名称和描述"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">
                <span className="text-destructive">*</span>角色名称
              </Label>
              <Input
                id="name"
                placeholder="请输入角色名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">角色描述</Label>
              <Textarea
                id="description"
                placeholder="请输入角色描述（可选）"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
                rows={4}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (isEdit ? "保存中..." : "创建中...") : "确定"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
