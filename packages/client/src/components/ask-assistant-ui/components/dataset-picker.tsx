/**
 * 知识库选择器（对齐 Kun KnowledgeBasePicker）：
 * 在输入条挂载企业知识库（数据集），选中集合随 session.send 下发本地引擎，
 * 引擎经 dataset_search 工具检索（API /ai-datasets/:id/retrieve）。
 * 数据源：我的知识库 / 团队知识库（/ai-datasets/my-created、/team）。
 */
import {
  useMyCreatedDatasetsInfiniteQuery,
  useTeamDatasetsInfiniteQuery,
} from "@buildingai/services/web";
import { useAssistantStore } from "@buildingai/stores";
import { RETRIEVAL_MODE } from "@buildingai/constants/shared/datasets.constants";
import { Badge } from "@buildingai/ui/components/ui/badge";
import { Button } from "@buildingai/ui/components/ui/button";
import { Checkbox } from "@buildingai/ui/components/ui/checkbox";
import { Input } from "@buildingai/ui/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@buildingai/ui/components/ui/popover";
import { ScrollArea } from "@buildingai/ui/components/ui/scroll-area";
import { Spinner } from "@buildingai/ui/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@buildingai/ui/components/ui/tabs";
import { cn } from "@buildingai/ui/lib/utils";
import { BookOpen, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

const RETRIEVAL_MODE_LABEL: Record<string, string> = {
  [RETRIEVAL_MODE.VECTOR]: "向量检索",
  [RETRIEVAL_MODE.FULL_TEXT]: "全文检索",
  [RETRIEVAL_MODE.HYBRID]: "混合检索",
};

type DatasetTab = "my" | "team";

const PAGE_SIZE = 20;

export const DatasetPicker = memo(function DatasetPicker() {
  const composerDatasetIds = useAssistantStore((s) => s.composerDatasetIds);
  const setComposerDatasetIds = useAssistantStore((s) => s.setComposerDatasetIds);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DatasetTab>("my");
  const [searchKeyword, setSearchKeyword] = useState("");

  const myQuery = useMyCreatedDatasetsInfiniteQuery(PAGE_SIZE, {
    enabled: open && activeTab === "my",
  });
  const teamQuery = useTeamDatasetsInfiniteQuery(PAGE_SIZE, {
    enabled: open && activeTab === "team",
  });

  const myDatasets = useMemo(
    () => myQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [myQuery.data?.pages],
  );
  const teamDatasets = useMemo(
    () => teamQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [teamQuery.data?.pages],
  );

  const availableDatasets = useMemo(() => {
    const base = activeTab === "my" ? myDatasets : teamDatasets;
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) return base;
    return base.filter((d) => d.name.toLowerCase().includes(keyword));
  }, [activeTab, myDatasets, teamDatasets, searchKeyword]);

  const hasMore = activeTab === "my" ? myQuery.hasNextPage : teamQuery.hasNextPage;
  const loadingMore =
    activeTab === "my" ? myQuery.isFetchingNextPage : teamQuery.isFetchingNextPage;
  const loadMore = () => {
    if (activeTab === "my") {
      if (myQuery.hasNextPage && !myQuery.isFetchingNextPage) void myQuery.fetchNextPage();
    } else if (teamQuery.hasNextPage && !teamQuery.isFetchingNextPage) {
      void teamQuery.fetchNextPage();
    }
  };

  // 无限加载哨兵（与智能体配置的知识库选择一致）
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = viewportRef.current;
    const sentinel = sentinelRef.current;
    if (!open || !root || !sentinel || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { root, rootMargin: "100px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTab, hasMore, loadingMore]);

  const toggleDataset = (id: string) => {
    setComposerDatasetIds(
      composerDatasetIds.includes(id)
        ? composerDatasetIds.filter((x) => x !== id)
        : [...composerDatasetIds, id],
    );
  };

  const count = composerDatasetIds.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 gap-1 rounded-full px-2 text-xs text-muted-foreground",
            count > 0 && "text-foreground",
          )}
          title="挂载知识库，回答时自动检索"
        >
          <BookOpen className="size-3.5" />
          <span>知识库</span>
          {count > 0 ? (
            <span className="bg-primary/10 text-primary rounded-full px-1.5 text-[11px]">
              {count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start" side="top">
        <div className="border-b px-3 py-2.5">
          <div className="text-sm font-semibold">知识库</div>
          <div className="text-muted-foreground mt-0.5 text-xs">
            挂载企业知识库作为回答参考，发送后由引擎自动检索
          </div>
        </div>
        <div className="px-3 pt-2">
          <Tabs
            value={activeTab}
            onValueChange={(val) => setActiveTab(val as DatasetTab)}
          >
            <TabsList className="w-full">
              <TabsTrigger value="my" className="flex-1 text-xs">
                我的知识库
              </TabsTrigger>
              <TabsTrigger value="team" className="flex-1 text-xs">
                团队知识库
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Input
            placeholder={activeTab === "my" ? "搜索我的知识库..." : "搜索团队知识库..."}
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            className="mt-2 h-8 text-xs"
          />
        </div>
        <ScrollArea viewportRef={viewportRef} className="mt-2 h-64 px-2 pb-1">
          {availableDatasets.length === 0 ? (
            <div className="text-muted-foreground py-6 text-center text-xs">暂无知识库</div>
          ) : (
            availableDatasets.map((dataset) => {
              const isSelected = composerDatasetIds.includes(dataset.id);
              return (
                <div
                  key={dataset.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "hover:bg-muted flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left",
                    isSelected && "bg-muted text-primary",
                  )}
                  onClick={() => toggleDataset(dataset.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleDataset(dataset.id);
                    }
                  }}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleDataset(dataset.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="min-w-0 flex-1 truncate text-sm font-medium">
                    {dataset.name}
                  </div>
                  {dataset.retrievalMode ? (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {RETRIEVAL_MODE_LABEL[dataset.retrievalMode] ?? dataset.retrievalMode}
                    </Badge>
                  ) : null}
                </div>
              );
            })
          )}
          <div ref={sentinelRef} className="h-6 w-full" />
          {loadingMore ? (
            <div className="flex h-8 w-full items-center justify-center">
              <Spinner className="text-muted-foreground size-5" />
            </div>
          ) : null}
          {!hasMore && availableDatasets.length > 0 ? (
            <div className="text-muted-foreground py-1.5 text-center text-[11px]">
              没有更多了
            </div>
          ) : null}
        </ScrollArea>
        <div className="text-muted-foreground flex items-center justify-between border-t px-3 py-2 text-xs">
          <span>已挂载 {count} 个</span>
          {count > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground h-6 px-1.5"
              onClick={() => setComposerDatasetIds([])}
            >
              <X className="size-3" />
              清空
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
});

DatasetPicker.displayName = "DatasetPicker";
