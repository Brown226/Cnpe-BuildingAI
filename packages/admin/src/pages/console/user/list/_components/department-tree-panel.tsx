import {
  type DepartmentTreeNode,
  useCreateDepartmentMutation,
  useDepartmentTreeQuery,
} from "@buildingai/services/console";
import { Button } from "@buildingai/ui/components/ui/button";
import { Input } from "@buildingai/ui/components/ui/input";
import { cn } from "@buildingai/ui/lib/utils";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
  Plus,
  Settings2,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

type DepartmentTreePanelProps = {
  /** 当前选中的部门 ID（null = 全部部门） */
  selectedId: string | null;
  onSelect: (node: DepartmentTreeNode | null) => void;
};

/**
 * 用户管理左侧「组织架构」部门树面板：
 * 可折叠树 + 每部门人数 + 快速新建部门 + 管理部门入口。
 */
export function DepartmentTreePanel({ selectedId, onSelect }: DepartmentTreePanelProps) {
  const { data: tree = [], isLoading, refetch } = useDepartmentTreeQuery();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");

  // 首次加载默认展开第一层
  useEffect(() => {
    if (tree.length > 0 && expanded.size === 0) {
      setExpanded(new Set(tree.map((node) => node.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createMutation = useCreateDepartmentMutation({
    onSuccess: () => {
      toast.success("部门已创建");
      setNewDeptName("");
      setQuickAddOpen(false);
      void refetch();
    },
    onError: (error) => {
      toast.error(`创建部门失败: ${error.message}`);
    },
  });

  const handleQuickAdd = () => {
    const name = newDeptName.trim();
    if (!name) return;
    createMutation.mutate({ name, parentId: selectedId ?? undefined });
  };

  const renderNode = (node: DepartmentTreeNode, depth: number) => {
    const hasChildren = (node.children?.length ?? 0) > 0;
    const isExpanded = expanded.has(node.id);
    const isActive = selectedId === node.id;

    return (
      <div key={node.id}>
        <div
          className={cn(
            "hover:bg-muted/60 flex cursor-pointer items-center gap-1 rounded-md py-1.5 pr-2 text-sm",
            isActive && "bg-accent text-accent-foreground",
          )}
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
          onClick={() => onSelect(node)}
        >
          <button
            type="button"
            className={cn(
              "text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded",
              !hasChildren && "invisible",
            )}
            onClick={(e) => {
              e.stopPropagation();
              toggle(node.id);
            }}
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", isExpanded && "rotate-90")}
            />
          </button>
          {isExpanded && hasChildren ? (
            <FolderOpen className="text-muted-foreground size-4 shrink-0" />
          ) : (
            <Folder className="text-muted-foreground size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="text-muted-foreground shrink-0 text-xs">{node.userCount ?? 0}人</span>
        </div>
        {hasChildren && isExpanded && <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>}
      </div>
    );
  };

  return (
    <div className="bg-card flex h-full flex-col rounded-lg border">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-sm font-medium">组织架构</span>
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            title="新建部门（建在当前选中部门下）"
            onClick={() => setQuickAddOpen((v) => !v)}
          >
            <Plus />
          </Button>
          <Button size="icon-sm" variant="ghost" title="管理部门" asChild>
            <Link to="/console/user/department">
              <Settings2 />
            </Link>
          </Button>
        </div>
      </div>

      {quickAddOpen && (
        <div className="flex items-center gap-1 px-3 pb-2">
          <Input
            autoFocus
            value={newDeptName}
            onChange={(e) => setNewDeptName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleQuickAdd()}
            placeholder={selectedId ? "子部门名称" : "部门名称"}
            className="h-8 text-xs"
          />
          <Button size="sm" className="h-8" disabled={createMutation.isPending} onClick={handleQuickAdd}>
            {createMutation.isPending ? <Loader2 className="animate-spin" /> : "确定"}
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {/* 全部部门根节点 */}
        <div
          className={cn(
            "hover:bg-muted/60 flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1.5 text-sm",
            selectedId === null && "bg-accent text-accent-foreground",
          )}
          onClick={() => onSelect(null)}
        >
          <Users className="text-muted-foreground size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">全部部门</span>
        </div>

        {isLoading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
            <Loader2 className="animate-spin" />
            加载部门...
          </div>
        ) : tree.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-xs">
            暂无部门，点击上方 + 新建
          </div>
        ) : (
          tree.map((node) => renderNode(node, 1))
        )}
      </div>
    </div>
  );
};