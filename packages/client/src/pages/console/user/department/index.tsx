import {
  type CreateDepartmentDto,
  type DepartmentTreeNode,
  type UpdateDepartmentDto,
  useCreateDepartmentMutation,
  useDeleteDepartmentMutation,
  useDepartmentTreeQuery,
  useUpdateDepartmentMutation,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@buildingai/ui/components/ui/select";
import { Skeleton } from "@buildingai/ui/components/ui/skeleton";
import { useAlertDialog } from "@buildingai/ui/hooks/use-alert-dialog";
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Input } from "@buildingai/ui/components/ui/input";
import { Label } from "@buildingai/ui/components/ui/label";
import { PageContainer } from "@/layouts/console/_components/page-container";

/**
 * 部门管理页面
 *
 * 以树形结构展示部门，支持新建、重命名、调整父级、删除。
 */
const DepartmentIndexPage = () => {
  const { data, isLoading, refetch } = useDepartmentTreeQuery();
  const createMutation = useCreateDepartmentMutation({
    onSuccess: () => {
      toast.success("部门创建成功");
      refetch();
    },
    onError: (e) => toast.error(`创建失败: ${e.message}`),
  });
  const updateMutation = useUpdateDepartmentMutation({
    onSuccess: () => {
      toast.success("部门更新成功");
      refetch();
    },
    onError: (e) => toast.error(`更新失败: ${e.message}`),
  });
  const deleteMutation = useDeleteDepartmentMutation({
    onSuccess: () => {
      toast.success("部门删除成功");
      refetch();
    },
    onError: (e) => toast.error(`删除失败: ${e.message}`),
  });
  const { confirm } = useAlertDialog();

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<DepartmentTreeNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 扁平化所有部门（供父级选择器）
  const flatList = useMemo(() => {
    const result: DepartmentTreeNode[] = [];
    const walk = (nodes: DepartmentTreeNode[]) => {
      for (const n of nodes) {
        result.push(n);
        walk(n.children ?? []);
      }
    };
    walk(data ?? []);
    return result;
  }, [data]);

  const handleDelete = async (node: DepartmentTreeNode) => {
    const ok = await confirm({
      title: "删除部门",
      description: `确定删除部门「${node.name}」吗？存在子部门或用户时无法删除。`,
      confirmText: "删除",
      confirmVariant: "destructive" as const,
    });
    if (ok) {
      deleteMutation.mutate(node.id);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (node: DepartmentTreeNode, depth: number) => {
    const hasChildren = (node.children?.length ?? 0) > 0;
    const isExpanded = expanded.has(node.id);
    return (
      <div key={node.id}>
        <div
          className="hover:bg-muted/50 flex items-center gap-2 rounded-md px-2 py-1.5"
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
        >
          <button
            type="button"
            className="flex size-5 items-center justify-center text-muted-foreground"
            onClick={() => hasChildren && toggleExpand(node.id)}
          >
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )
            ) : null}
          </button>
          <span className="flex-1 truncate text-sm">{node.name}</span>
          {node.system === 1 && (
            <span className="text-muted-foreground text-xs">系统</span>
          )}
          <span className="text-muted-foreground text-xs">
            {node.userCount} 人
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="size-7 p-0"
              onClick={() => {
                setEditingNode(node);
                setEditOpen(true);
              }}
            >
              <span className="text-xs">编辑</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="size-7 p-0 text-destructive"
              onClick={() => handleDelete(node)}
              disabled={node.system === 1}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
        {hasChildren && isExpanded && (node.children ?? []).map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <PageContainer>
      <div className="space-y-4 px-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">部门管理</h1>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 size-4" />
            新建部门
          </Button>
        </div>

        <div className="rounded-lg border">
          {isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-8 w-1/2" />
            </div>
          ) : (
            <div className="divide-y p-2">
              {(data ?? []).map((node) => renderNode(node, 0))}
            </div>
          )}
        </div>
      </div>

      <DepartmentFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        flatList={flatList}
        onSubmit={(values) => createMutation.mutate(values)}
        isPending={createMutation.isPending}
      />

      <DepartmentFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        node={editingNode}
        flatList={flatList}
        onSubmit={(values) => {
          if (!editingNode) return;
          updateMutation.mutate({ id: editingNode.id, dto: values });
        }}
        isPending={updateMutation.isPending}
      />
    </PageContainer>
  );
};

type DepartmentFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  node?: DepartmentTreeNode | null;
  flatList: DepartmentTreeNode[];
  onSubmit: (values: CreateDepartmentDto & UpdateDepartmentDto) => void;
  isPending: boolean;
};

function DepartmentFormDialog({
  open,
  onOpenChange,
  mode,
  node,
  flatList,
  onSubmit,
  isPending,
}: DepartmentFormDialogProps) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("no-parent");

  useEffect(() => {
    if (open) {
      setName(node?.name ?? "");
      setParentId(node?.parentId ?? "no-parent");
    }
  }, [open, node]);

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error("请输入部门名称");
      return;
    }
    const payload = {
      name: name.trim(),
      parentId: parentId === "no-parent" ? undefined : parentId,
    };
    onSubmit(payload);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "新建部门" : "编辑部门"}</DialogTitle>
          <DialogDescription>
            {mode === "create" ? "创建一个新的部门节点" : "修改部门名称或调整层级"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>部门名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="请输入部门名称"
            />
          </div>
          <div className="space-y-2">
            <Label>上级部门</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择上级部门" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no-parent">无（一级部门）</SelectItem>
                {flatList
                  .filter((d) => d.id !== node?.id)
                  .map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DepartmentIndexPage;