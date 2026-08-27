import {
  type RoleEntity,
  useBatchDeleteRolesMutation,
  useDeleteRoleMutation,
  useRoleListQuery,
} from "@buildingai/services/console";
import { PermissionGuard } from "@buildingai/ui/components/auth/permission-guard";
import { Button } from "@buildingai/ui/components/ui/button";
import { Checkbox } from "@buildingai/ui/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@buildingai/ui/components/ui/dropdown-menu";
import { Input } from "@buildingai/ui/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@buildingai/ui/components/ui/table";
import { TimeText } from "@buildingai/ui/components/ui/time-text";
import { useAlertDialog } from "@buildingai/ui/hooks/use-alert-dialog";
import { usePagination } from "@buildingai/ui/hooks/use-pagination";
import { Edit, MoreHorizontal, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageContainer } from "@/layouts/console/_components/page-container";

import { AssignPermissionsDialog } from "./_components/assign-permissions-dialog";
import { EditRoleDialog } from "./_components/edit-role-dialog";

const AccessRoleIndexPage = () => {
  const [searchName, setSearchName] = useState("");
  const [searchDescription, setSearchDescription] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [currentRole, setCurrentRole] = useState<RoleEntity | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignRole, setAssignRole] = useState<RoleEntity | null>(null);
  const { confirm } = useAlertDialog();

  const { data, isLoading, refetch } = useRoleListQuery({
    page,
    pageSize,
    name: searchName || undefined,
    description: searchDescription || undefined,
  });

  const { PaginationComponent } = usePagination({
    total: data?.total || 0,
    pageSize: pageSize,
    page: page,
    onPageChange: (page) => {
      setPage(page);
    },
  });

  const deleteMutation = useDeleteRoleMutation({
    onSuccess: () => {
      toast.success("删除成功");
      refetch();
      setSelectedIds([]);
    },
  });

  const batchDeleteMutation = useBatchDeleteRolesMutation({
    onSuccess: () => {
      toast.success("批量删除成功");
      refetch();
      setSelectedIds([]);
    },
  });

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(data?.items.map((role) => role.id) || []);
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds([...selectedIds, id]);
    } else {
      setSelectedIds(selectedIds.filter((selectedId) => selectedId !== id));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) {
      toast.warning("请选择要删除的角色");
      return;
    }
    await confirm({
      title: "删除角色",
      description: `确定要删除选中的 ${selectedIds.length} 个角色吗？此操作不可恢复。`,
    });
    batchDeleteMutation.mutate(selectedIds);
  };

  const handleDelete = async (id: string) => {
    await confirm({
      title: "删除角色",
      description: "确定要删除该角色吗？此操作不可恢复。",
    });
    deleteMutation.mutate(id);
  };

  const roles = data?.items || [];
  const allSelected = roles.length > 0 && selectedIds.length === roles.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < roles.length;

  const handleOpenCreate = () => {
    setCurrentRole(null);
    setCreateDialogOpen(true);
  };

  const handleOpenEdit = (role: RoleEntity) => {
    setCurrentRole(role);
    setCreateDialogOpen(true);
  };

  const handleOpenAssign = (role: RoleEntity) => {
    setAssignRole(role);
    setAssignDialogOpen(true);
  };

  return (
    <PageContainer>
      <div className="flex flex-col gap-2">
        <div className="bg-background sticky top-0 z-2 grid grid-cols-1 gap-4 pt-1 pb-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          <Input
            placeholder="搜索角色名称..."
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            className="text-sm"
          />
          <Input
            placeholder="搜索角色描述..."
            value={searchDescription}
            onChange={(e) => setSearchDescription(e.target.value)}
            className="text-sm"
          />
          <div className="flex items-center gap-2 sm:col-start-1 lg:end lg:col-start-3 xl:col-start-4 2xl:col-start-5">
            <PermissionGuard permissions="role:delete">
              {selectedIds.length > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleBatchDelete}
                  disabled={batchDeleteMutation.isPending}
                >
                  <Trash2 className="mr-2 size-4" />
                  批量删除 ({selectedIds.length})
                </Button>
              )}
            </PermissionGuard>
            <PermissionGuard permissions="role:create">
              <Button size="sm" onClick={handleOpenCreate}>
                <UserPlus className="mr-2 size-4" />
                新增角色
              </Button>
            </PermissionGuard>
          </div>
        </div>

        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={handleSelectAll}
                    aria-label="全选"
                    ref={(el) => {
                      if (el) {
                        (el as any).indeterminate = someSelected;
                      }
                    }}
                  />
                </TableHead>
                <TableHead>角色名称</TableHead>
                <TableHead>描述</TableHead>
                <TableHead>角色人数</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="w-24">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    加载中...
                  </TableCell>
                </TableRow>
              ) : roles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground h-32 text-center">
                    暂无数据
                  </TableCell>
                </TableRow>
              ) : (
                roles.map((role: RoleEntity) => (
                  <TableRow key={role.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.includes(role.id)}
                        onCheckedChange={(checked) => handleSelectOne(role.id, checked as boolean)}
                        aria-label={`选择 ${role.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{role.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {role.description || "-"}
                    </TableCell>
                    <TableCell>{role.userCount || 0}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <TimeText value={role.createdAt} format="YYYY/MM/DD HH:mm" />
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <PermissionGuard permissions="role:update">
                            <DropdownMenuItem onClick={() => handleOpenEdit(role)}>
                              <Edit className="mr-2 size-4" />
                              编辑
                            </DropdownMenuItem>
                          </PermissionGuard>
                          <PermissionGuard permissions="role:assign-permissions">
                            <DropdownMenuItem onClick={() => handleOpenAssign(role)}>
                              <ShieldCheck className="mr-2 size-4" />
                              分配权限
                            </DropdownMenuItem>
                          </PermissionGuard>
                          <DropdownMenuSeparator />
                          <PermissionGuard permissions="role:delete">
                            <DropdownMenuItem
                              onClick={() => handleDelete(role.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="mr-2 size-4" />
                              删除
                            </DropdownMenuItem>
                          </PermissionGuard>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="bg-background sticky bottom-0 z-2 flex py-2">
          <PaginationComponent className="mx-0 w-fit" />
        </div>
      </div>

      <EditRoleDialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) setCurrentRole(null);
        }}
        role={currentRole}
        onSuccess={() => {
          refetch();
          setCreateDialogOpen(false);
          setCurrentRole(null);
        }}
      />

      <AssignPermissionsDialog
        open={assignDialogOpen}
        onOpenChange={(open) => {
          setAssignDialogOpen(open);
          if (!open) setAssignRole(null);
        }}
        role={assignRole}
        onSuccess={() => {
          refetch();
          setAssignDialogOpen(false);
          setAssignRole(null);
        }}
      />
    </PageContainer>
  );
};

export default AccessRoleIndexPage;
