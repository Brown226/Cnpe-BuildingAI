import { useI18n } from "@buildingai/i18n";
import {
  CardRedeemType,
  type CreateCardBatchDto,
  MembershipPlanDuration,
  useCreateCardBatchMutation,
  useMembershipLevelListQuery,
  useMembershipPlansConfigQuery,
} from "@buildingai/services/console";
import { Button } from "@buildingai/ui/components/ui/button";
import { Calendar, type Locale } from "@buildingai/ui/components/ui/calendar";
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
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@buildingai/ui/components/ui/input-group";
import { Label } from "@buildingai/ui/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@buildingai/ui/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@buildingai/ui/components/ui/select";
import { Textarea } from "@buildingai/ui/components/ui/textarea";
import { cn } from "@buildingai/ui/lib/utils";
import { format } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const DATE_FNS_LOCALE_MAP: Record<string, Locale> = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

type CreateBatchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * 创建卡密批次对话框
 */
export function CreateBatchDialog({ open, onOpenChange }: CreateBatchDialogProps) {
  const { locale: currentLocale } = useI18n();
  const dateFnsLocale = DATE_FNS_LOCALE_MAP[currentLocale] ?? zhCN;

  const [name, setName] = useState("");
  const [redeemType, setRedeemType] = useState<CardRedeemType>(CardRedeemType.POINTS);
  const [levelId, setLevelId] = useState<string>("");
  const [membershipDuration, setMembershipDuration] = useState<MembershipPlanDuration>(
    MembershipPlanDuration.MONTH,
  );
  const [customValue, setCustomValue] = useState("");
  const [customUnit, setCustomUnit] = useState("天");
  const [pointsAmount, setPointsAmount] = useState("");
  const [expireAt, setExpireAt] = useState<Date>();
  const [totalCount, setTotalCount] = useState("");
  const [remark, setRemark] = useState("");

  const { data: membershipConfigData } = useMembershipPlansConfigQuery();
  const membershipEnabled = membershipConfigData?.plansStatus ?? false;
  const { data: levelsData } = useMembershipLevelListQuery({ pageSize: 100 });
  const createMutation = useCreateCardBatchMutation();

  useEffect(() => {
    if (!open) {
      setName("");
      setRedeemType(membershipEnabled ? CardRedeemType.MEMBERSHIP : CardRedeemType.POINTS);
      setLevelId("");
      setMembershipDuration(MembershipPlanDuration.MONTH);
      setCustomValue("");
      setCustomUnit("天");
      setPointsAmount("");
      setExpireAt(undefined);
      setTotalCount("");
      setRemark("");
    }
  }, [open, membershipEnabled]);

  useEffect(() => {
    if (!membershipEnabled && redeemType === CardRedeemType.MEMBERSHIP) {
      setRedeemType(CardRedeemType.POINTS);
      setLevelId("");
      setMembershipDuration(MembershipPlanDuration.MONTH);
      setCustomValue("");
      setCustomUnit("天");
    }
  }, [membershipEnabled, redeemType]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("请输入卡密名称");
      return;
    }

    if (!expireAt) {
      toast.error("请选择卡密到期时间");
      return;
    }

    if (!totalCount || Number(totalCount) <= 0) {
      toast.error("请输入有效的生成数量");
      return;
    }

    if (redeemType === CardRedeemType.MEMBERSHIP) {
      if (!membershipEnabled) {
        toast.error("会员功能未开启，无法创建会员卡密");
        return;
      }
      if (!levelId) {
        toast.error("请选择会员等级");
        return;
      }
      if (
        membershipDuration === MembershipPlanDuration.CUSTOM &&
        (!customValue || Number(customValue) <= 0)
      ) {
        toast.error("请输入有效的自定义时长");
        return;
      }
    } else if (redeemType === CardRedeemType.POINTS) {
      if (!pointsAmount || Number(pointsAmount) <= 0) {
        toast.error("请输入有效的积分数量");
        return;
      }
    }

    const body: CreateCardBatchDto = {
      name: name.trim(),
      redeemType,
      expireAt: expireAt.toISOString(),
      totalCount: Number(totalCount),
      remark: remark.trim() || undefined,
    };

    if (redeemType === CardRedeemType.MEMBERSHIP) {
      body.levelId = levelId;
      body.membershipDuration = membershipDuration;
      if (membershipDuration === MembershipPlanDuration.CUSTOM) {
        body.customDuration = {
          value: Number(customValue),
          unit: customUnit,
        };
      }
    } else {
      body.pointsAmount = Number(pointsAmount);
    }

    try {
      await createMutation.mutateAsync(body);
      toast.success("创建成功");
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error?.message || "创建失败");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full overflow-y-auto md:w-md">
        <DialogHeader>
          <DialogTitle>新增卡密批次</DialogTitle>
          <DialogDescription>创建一个新的卡密批次，系统将自动生成卡密</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>
              <span className="text-destructive">*</span>卡密名称
            </Label>
            <Input
              id="name"
              placeholder="请输入卡密名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>
              <span className="text-destructive">*</span>兑换类型
            </Label>
            <Select
              value={String(redeemType)}
              onValueChange={(value) => setRedeemType(Number(value) as CardRedeemType)}
            >
              <SelectTrigger id="redeemType" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {membershipEnabled && (
                  <SelectItem value={String(CardRedeemType.MEMBERSHIP)}>订阅会员</SelectItem>
                )}
                <SelectItem value={String(CardRedeemType.POINTS)}>积分余额</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {membershipEnabled && redeemType === CardRedeemType.MEMBERSHIP && (
            <>
              <div className="space-y-2">
                <Label>
                  <span className="text-destructive">*</span>会员等级
                </Label>
                <Select value={levelId} onValueChange={setLevelId}>
                  <SelectTrigger id="levelId" className="w-full">
                    <SelectValue placeholder="请选择会员等级" />
                  </SelectTrigger>
                  <SelectContent>
                    {levelsData?.items?.map((level) => (
                      <SelectItem key={level.id} value={level.id}>
                        {level.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>
                  <span className="text-destructive">*</span>会员时长
                </Label>
                <Select
                  value={String(membershipDuration)}
                  onValueChange={(value) =>
                    setMembershipDuration(Number(value) as MembershipPlanDuration)
                  }
                >
                  <SelectTrigger id="membershipDuration" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={String(MembershipPlanDuration.MONTH)}>1个月</SelectItem>
                    <SelectItem value={String(MembershipPlanDuration.QUARTER)}>3个月</SelectItem>
                    <SelectItem value={String(MembershipPlanDuration.HALF)}>6个月</SelectItem>
                    <SelectItem value={String(MembershipPlanDuration.YEAR)}>1年</SelectItem>
                    <SelectItem value={String(MembershipPlanDuration.FOREVER)}>终身</SelectItem>
                    <SelectItem value={String(MembershipPlanDuration.CUSTOM)}>自定义</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {membershipDuration === MembershipPlanDuration.CUSTOM && (
                <div className="space-y-2">
                  <Label>
                    <span className="text-destructive">*</span>自定义时长
                  </Label>
                  <InputGroup className="w-full">
                    <InputGroupInput
                      type="number"
                      min={1}
                      placeholder="如 7"
                      value={customValue}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setCustomValue(e.target.value)
                      }
                    />
                    <InputGroupAddon align="inline-end" className="pr-1">
                      <Select value={customUnit} onValueChange={setCustomUnit}>
                        <SelectTrigger className="text-muted-foreground h-8 min-w-[72px] border-0 bg-transparent shadow-none focus-visible:ring-0">
                          <SelectValue placeholder="单位" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="天">天</SelectItem>
                          <SelectItem value="月">月</SelectItem>
                          <SelectItem value="年">年</SelectItem>
                        </SelectContent>
                      </Select>
                    </InputGroupAddon>
                  </InputGroup>
                </div>
              )}
            </>
          )}

          {redeemType === CardRedeemType.POINTS && (
            <div className="space-y-2">
              <Label>
                <span className="text-destructive">*</span>积分数量
              </Label>
              <Input
                id="pointsAmount"
                type="number"
                min="1"
                placeholder="请输入积分数量"
                value={pointsAmount}
                onChange={(e) => setPointsAmount(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>
              <span className="text-destructive">*</span>生成数量
            </Label>
            <Input
              id="totalCount"
              type="number"
              min="1"
              placeholder="请输入生成数量"
              value={totalCount}
              onChange={(e) => setTotalCount(e.target.value)}
            />
          </div>

          <div
            className={cn(
              "space-y-2",
              redeemType === CardRedeemType.POINTS ||
                membershipDuration === MembershipPlanDuration.CUSTOM
                ? "sm:col-span-2"
                : "",
            )}
          >
            <Label>
              <span className="text-destructive">*</span>卡密到期时间
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !expireAt && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-2 size-4" />
                  {expireAt ? (
                    format(expireAt, "PPP", { locale: dateFnsLocale })
                  ) : (
                    <span>选择卡密到期时间</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" selected={expireAt} onSelect={setExpireAt} />
              </PopoverContent>
            </Popover>
          </div>

          <div className="col-span-1 space-y-2 sm:col-span-2">
            <Label htmlFor="remark">备注</Label>
            <Textarea
              id="remark"
              placeholder="请输入备注信息（可选）"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} loading={createMutation.isPending}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
