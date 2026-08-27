import { useCDKSettingsQuery, useUpdateCDKSettingsMutation } from "@buildingai/services/console";
import { Button } from "@buildingai/ui/components/ui/button";
import { Switch } from "@buildingai/ui/components/ui/switch";
import { Textarea } from "@buildingai/ui/components/ui/textarea";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageContainer } from "@/layouts/console/_components/page-container";

/**
 * 卡密设置页面
 */
export default function CDKSettings() {
  const [isEnabled, setIsEnabled] = useState(false);
  const [notice, setNotice] = useState("");

  const { data, isLoading } = useCDKSettingsQuery();
  const updateMutation = useUpdateCDKSettingsMutation();

  useEffect(() => {
    if (data) {
      setIsEnabled(data.enabled);
      setNotice(data.notice || "");
    }
  }, [data]);

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        enabled: isEnabled,
        notice: notice.trim() || undefined,
      });
      toast.success("保存成功");
    } catch (error: any) {
      toast.error(error?.message || "保存失败");
    }
  };

  return (
    <PageContainer>
      <div className="space-y-4 px-4">
        <div>
          <h1 className="text-lg font-semibold">卡密设置</h1>
          <p className="text-muted-foreground text-sm">配置卡密相关功能</p>
        </div>

        <div className="space-y-2">
          <h2 className="text-[14px] font-medium">是否启用功能</h2>
          <p className="text-muted-foreground text-sm">开启或关闭卡密兑换功能</p>
        </div>
        <div className="flex items-center space-x-2">
          <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
          <span className="text-sm">{isEnabled ? "已启用" : "已禁用"}</span>
        </div>

        <div className="space-y-2">
          <h2 className="text-[14px] font-medium">兑换须知</h2>
          <p className="text-muted-foreground text-sm">用户兑换卡密时需要了解的重要信息</p>
        </div>
        <Textarea
          value={notice}
          onChange={(e) => setNotice(e.target.value)}
          placeholder="请输入兑换须知内容，每条须知占一行..."
          className="min-h-32 w-full resize-none md:w-md"
          rows={6}
        />

        <div className="flex justify-start">
          <Button onClick={handleSave} loading={updateMutation.isPending || isLoading}>
            保存
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
