/**
 * 桌面审计与用量诊断页（T4.11 管理员诊断）：
 * 用量汇总（token 计量）+ 桌面操作审计事件表。
 * 数据源：/consoleapi/desktop-audit（列表）与 /consoleapi/desktop-audit/usage（聚合），
 * 对应 agent-core AuditCollector 上报的桌面端事件流。
 */
import { useAuthStore } from "@buildingai/stores";
import { PageContainer } from "@/layouts/console/_components/page-container";
import { Badge } from "@buildingai/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@buildingai/ui/components/ui/card";
import { Skeleton } from "@buildingai/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@buildingai/ui/components/ui/table";
import { TimeText } from "@buildingai/ui/components/ui/time-text";
import { useQuery } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_APP_API_URL ?? window.location.origin;

interface AuditEvent {
  id: string;
  userId?: string;
  type: string;
  action: string;
  rule?: string;
  reason?: string;
  occurredAt: string;
}

interface UsageSummary {
  items: Array<{
    userId: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    events: number;
  }>;
  total: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

const TYPE_LABEL: Record<string, string> = {
  "session.start": "会话开始",
  "session.end": "会话结束",
  "session.usage": "用量",
  "tool.call": "工具调用",
  "policy.blocked": "策略拦截",
  "approval.requested": "审批请求",
  "approval.granted": "审批通过",
  "approval.denied": "审批拒绝",
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function DesktopAuditIndexPage() {
  const token = useAuthStore((state) => state.auth.token);

  const auditQuery = useQuery({
    queryKey: ["desktop-audit", "list"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/consoleapi/desktop-audit?pageSize=50`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { items: AuditEvent[]; total: number };
    },
    enabled: Boolean(token),
  });

  const usageQuery = useQuery({
    queryKey: ["desktop-audit", "usage"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/consoleapi/desktop-audit/usage`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as UsageSummary;
    },
    enabled: Boolean(token),
  });

  return (
    <PageContainer>
      <div className="space-y-6 px-3">
        <div className="flex flex-col gap-4 rounded-lg border bg-[linear-gradient(135deg,hsl(var(--muted))_0%,hsl(var(--background))_58%,hsl(var(--accent))_100%)] p-5 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">桌面审计与用量</h1>
            <p className="text-muted-foreground max-w-2xl text-sm">
              桌面客户端上报的操作流水与 token 用量计量（供审计、计费与诊断）
            </p>
          </div>
        </div>

        {/* 用量汇总卡片 */}
        <div className="grid gap-5 md:grid-cols-3">
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-sm">输入 Token</CardTitle>
            </CardHeader>
            <CardContent>
              {usageQuery.isLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="text-2xl font-semibold">
                  {fmtTokens(usageQuery.data?.total.inputTokens ?? 0)}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-sm">输出 Token</CardTitle>
            </CardHeader>
            <CardContent>
              {usageQuery.isLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="text-2xl font-semibold">
                  {fmtTokens(usageQuery.data?.total.outputTokens ?? 0)}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-sm">缓存命中（省费）</CardTitle>
            </CardHeader>
            <CardContent>
              {usageQuery.isLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="text-2xl font-semibold">
                  {fmtTokens(usageQuery.data?.total.cacheReadTokens ?? 0)}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 审计事件表 */}
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>操作流水（最近 50 条）</CardTitle>
          </CardHeader>
          <CardContent>
            {auditQuery.isLoading ? (
              <div className="space-y-2 py-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : auditQuery.isError ? (
              <div className="text-muted-foreground py-4 text-sm">
                加载失败：{String(auditQuery.error)}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>动作</TableHead>
                    <TableHead>用户</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(auditQuery.data?.items ?? []).map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap">
                        <TimeText value={e.occurredAt} variant="datetime" />
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{TYPE_LABEL[e.type] ?? e.type}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[360px] truncate font-mono text-xs">
                        {e.action}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{e.userId ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}