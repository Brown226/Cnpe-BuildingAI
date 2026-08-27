import { type FinanceCenterResponse, useFinanceCenterQuery } from "@buildingai/services/console";
import { Card, CardContent, CardHeader } from "@buildingai/ui/components/ui/card";
import { Skeleton } from "@buildingai/ui/components/ui/skeleton";
import { cn } from "@buildingai/ui/lib/utils";

import { PageContainer } from "@/layouts/console/_components/page-container";

/** 金额格式（保留两位小数） */
function formatAmount(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** 整数格式 */
function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function StatItem({
  label,
  value,
  unit,
  variant = "default",
}: {
  label: string;
  value: string;
  unit?: string;
  variant?: "default" | "muted";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={cn(
          "text-sm tracking-wider uppercase",
          variant === "muted" ? "text-muted-foreground/80" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span className="text-foreground text-lg font-semibold tracking-tight tabular-nums">
        {value}
        {unit != null && (
          <span className="text-muted-foreground ml-1 text-sm font-normal">{unit}</span>
        )}
      </span>
    </div>
  );
}

function Block({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card size="sm" className={cn("bg-card/50", className)}>
      <CardHeader className="pb-2">
        <h3 className="text-foreground text-sm font-semibold tracking-wider uppercase">{title}</h3>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

const FinancialAnalysisIndexPage = () => {
  const { data, isLoading } = useFinanceCenterQuery();

  if (isLoading) {
    return (
      <PageContainer>
        <div className="flex flex-col gap-6">
          <Skeleton className="h-24 w-full rounded-xl" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </div>
      </PageContainer>
    );
  }

  if (!data) {
    return (
      <PageContainer>
        <div className="text-muted-foreground flex min-h-70 items-center justify-center text-sm">
          暂无数据
        </div>
      </PageContainer>
    );
  }

  const { finance, recharge, member, user } = data as unknown as FinanceCenterResponse;

  const pointsIssued = user.totalPointsIssued;
  const pointsConsumed = user.totalPointsConsumed;
  const pointsRemaining = user.totalPowerSum;

  return (
    <PageContainer>
      <div className="flex flex-col gap-6">
        {/* 经营概况：摘要带，净收入为主视觉 */}
        <Card>
          <CardContent className="flex flex-wrap items-end justify-between gap-6 py-5">
            <div>
              <p className="text-muted-foreground mb-1 text-sm tracking-wider uppercase">
                累计净收入
              </p>
              <p className="text-foreground text-3xl font-semibold tracking-tight tabular-nums">
                ¥{formatAmount(finance.totalNetIncome)}
              </p>
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-4 sm:gap-x-10">
              <StatItem
                label="累计收入金额"
                value={formatAmount(finance.totalIncomeAmount)}
                variant="muted"
              />
              <StatItem
                label="累计订单数"
                value={formatInteger(finance.totalIncomeNum)}
                unit="笔"
                variant="muted"
              />
              <StatItem
                label="累计退款金额"
                value={formatAmount(finance.totalRefundAmount)}
                variant="muted"
              />
              <StatItem
                label="累计退款订单"
                value={formatInteger(finance.totalRefundNum)}
                variant="muted"
              />
            </div>
          </CardContent>
        </Card>

        {/* 订单概况 + 用户概况：双栏 */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Block title="订单概况">
            <div className="space-y-5">
              <div>
                <p className="text-muted-foreground mb-3 text-sm font-medium tracking-wider uppercase">
                  充值
                </p>
                <div className="grid grid-cols-2 gap-4 xl:grid-cols-3 2xl:grid-cols-5">
                  <StatItem label="累计充值收入" value={formatAmount(recharge.rechargeAmount)} />
                  <StatItem label="充值订单数" value={formatInteger(recharge.rechargeNum)} />
                  <StatItem
                    label="累计退款金额"
                    value={formatAmount(recharge.rechargeRefundAmount)}
                  />
                  <StatItem label="退款订单" value={formatInteger(recharge.rechargeRefundNum)} />
                  <StatItem label="充值净收入" value={formatAmount(recharge.rechargeNetIncome)} />
                </div>
              </div>
              <div className="border-border/40 border-t pt-4">
                <p className="text-muted-foreground mb-3 text-sm font-medium tracking-wider uppercase">
                  会员
                </p>
                <div className="grid grid-cols-2 gap-4 xl:grid-cols-3 2xl:grid-cols-5">
                  <StatItem label="开通会员收入" value={formatAmount(member.memberAmount)} />
                  <StatItem label="会员订单数" value={formatInteger(member.memberOrderNum)} />
                  <StatItem label="累计退款金额" value={formatAmount(member.memberRefundAmount)} />
                  <StatItem label="退款订单" value={formatInteger(member.memberRefundNum)} />
                  <StatItem label="会员净收入" value={formatAmount(member.memberNetIncome)} />
                </div>
              </div>
            </div>
          </Block>

          <Block title="用户概况">
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-3 2xl:grid-cols-5">
                <StatItem label="用户总人数" value={formatInteger(user.totalUserNum)} />
                <StatItem label="累计充值人数" value={formatInteger(user.totalRechargeNum)} />
                <StatItem label="开通会员人数" value={formatInteger(user.totalMemberUserNum)} />
                <StatItem label="用户累计消费金额" value={formatAmount(user.totalRechargeAmount)} />
                <StatItem label="用户累计提问次数" value={formatInteger(user.totalChatNum)} />
              </div>
              <div className="border-border/40 border-t pt-4">
                <p className="text-muted-foreground mb-3 text-[11px] font-medium tracking-wider uppercase">
                  积分
                </p>
                <div className="grid grid-cols-3 gap-4">
                  <StatItem label="累计发放积分" value={formatInteger(pointsIssued)} />
                  <StatItem label="用户消耗积分" value={formatInteger(pointsConsumed)} />
                  <StatItem label="用户剩余积分" value={formatInteger(pointsRemaining)} />
                </div>
              </div>
            </div>
          </Block>
        </div>
      </div>
    </PageContainer>
  );
};

export default FinancialAnalysisIndexPage;
