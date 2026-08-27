import type { GroupedPermissions, Permission, RoleEntity } from "@buildingai/services/console";
import {
  useAssignPermissionsMutation,
  usePermissionListQuery,
  useRoleDetailQuery,
} from "@buildingai/services/console";
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
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface AssignPermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: RoleEntity | null;
  onSuccess?: () => void;
}

/**
 * 分配权限弹框组件
 */
export const AssignPermissionsDialog = ({
  open,
  onOpenChange,
  role,
  onSuccess,
}: AssignPermissionsDialogProps) => {
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<string[]>([]);

  const { data: permissionGroups, isLoading: isLoadingPermissions } = usePermissionListQuery(
    { isGrouped: true },
    { enabled: open },
  );

  const { data: roleDetail } = useRoleDetailQuery(role?.id || "", {
    enabled: open && !!role?.id,
  });

  const assignMutation = useAssignPermissionsMutation({
    onSuccess: () => {
      toast.success("权限分配成功");
      onOpenChange(false);
      onSuccess?.();
    },
  });

  useEffect(() => {
    if (!open || !roleDetail) {
      setSelectedPermissionIds([]);
      return;
    }

    const permissionIds = (roleDetail as any).permissions?.map((p: Permission) => p.id) || [];
    setSelectedPermissionIds(permissionIds);
  }, [open, roleDetail]);

  const handleTogglePermission = (permissionId: string) => {
    setSelectedPermissionIds((prev) =>
      prev.includes(permissionId)
        ? prev.filter((id) => id !== permissionId)
        : [...prev, permissionId],
    );
  };

  const handleToggleGroup = (groupPermissions: Permission[]) => {
    const groupPermissionIds = groupPermissions.map((p) => p.id);
    const allSelected = groupPermissionIds.every((id) => selectedPermissionIds.includes(id));

    if (allSelected) {
      setSelectedPermissionIds((prev) => prev.filter((id) => !groupPermissionIds.includes(id)));
    } else {
      setSelectedPermissionIds((prev) => [
        ...prev.filter((id) => !groupPermissionIds.includes(id)),
        ...groupPermissionIds,
      ]);
    }
  };

  const handleSubmit = () => {
    if (!role?.id) return;

    assignMutation.mutate({
      id: role.id,
      permissionIds: selectedPermissionIds,
    });
  };

  const handleSelectAll = () => {
    const allPermissionIds = groups.flatMap((group) =>
      group.permissions.map((p: Permission) => p.id),
    );
    setSelectedPermissionIds(allPermissionIds);
  };

  const handleClearAll = () => {
    setSelectedPermissionIds([]);
  };

  const handleInvertSelection = () => {
    const allPermissionIds = groups.flatMap((group) =>
      group.permissions.map((p: Permission) => p.id),
    );
    const newSelected = allPermissionIds.filter((id) => !selectedPermissionIds.includes(id));
    setSelectedPermissionIds(newSelected);
  };

  const groups = (permissionGroups as GroupedPermissions[]) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>分配权限</DialogTitle>
          <DialogDescription>
            为角色 <span className="font-semibold">{role?.name}</span> 分配系统权限
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 pb-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSelectAll}
            disabled={isLoadingPermissions}
          >
            全选
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClearAll}
            disabled={isLoadingPermissions}
          >
            取消全部
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleInvertSelection}
            disabled={isLoadingPermissions}
          >
            反选
          </Button>
          <div className="text-muted-foreground ml-auto text-sm">
            已选择 {selectedPermissionIds.length} 项
          </div>
        </div>

        <ScrollArea className="max-h-[60vh] pr-4">
          {isLoadingPermissions ? (
            <div className="flex h-32 items-center justify-center">
              <p className="text-muted-foreground text-sm">加载中...</p>
            </div>
          ) : groups.length === 0 ? (
            <div className="flex h-32 items-center justify-center">
              <p className="text-muted-foreground text-sm">暂无权限数据</p>
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => {
                const groupPermissions = group.permissions || [];
                const allSelected = groupPermissions.every((p: Permission) =>
                  selectedPermissionIds.includes(p.id),
                );
                const someSelected =
                  !allSelected &&
                  groupPermissions.some((p: Permission) => selectedPermissionIds.includes(p.id));

                return (
                  <div key={group.code} className="rounded-lg border p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Checkbox
                        checked={allSelected}
                        ref={(el) => {
                          if (el) {
                            (el as any).indeterminate = someSelected;
                          }
                        }}
                        onCheckedChange={() => handleToggleGroup(groupPermissions)}
                      />
                      <span className="font-semibold">{group.name}</span>
                      <span className="text-muted-foreground text-xs">
                        ({groupPermissions.length} 项)
                      </span>
                    </div>

                    <div className="ml-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {groupPermissions.map((permission: Permission) => (
                        <div key={permission.id} className="flex items-start gap-2">
                          <Checkbox
                            checked={selectedPermissionIds.includes(permission.id)}
                            onCheckedChange={() => handleTogglePermission(permission.id)}
                          />
                          <div className="flex-1">
                            <p className="text-sm font-medium">{permission.name}</p>
                            {permission.description && (
                              <p className="text-muted-foreground text-xs">
                                {permission.description}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={assignMutation.isPending || !role?.id}>
            {assignMutation.isPending ? "保存中..." : "确定"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
