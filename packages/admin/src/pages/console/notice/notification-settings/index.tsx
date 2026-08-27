import {
  type SmsSceneSetting,
  useSmsSceneSettingsQuery,
  useUpdateSmsSceneSettingMutation,
} from "@buildingai/services/console";
import { PermissionGuard } from "@buildingai/ui/components/auth/permission-guard";
import { Badge } from "@buildingai/ui/components/ui/badge";
import { Button } from "@buildingai/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@buildingai/ui/components/ui/form";
import { Input } from "@buildingai/ui/components/ui/input";
import { Switch } from "@buildingai/ui/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@buildingai/ui/components/ui/table";
import { Textarea } from "@buildingai/ui/components/ui/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { PageContainer } from "@/layouts/console/_components/page-container";

const sceneSettingSchema = z.object({
  enable: z.boolean(),
  templateId: z.string().min(1, "请输入模板ID"),
  content: z.string().min(1, "请输入短信内容"),
});

type SceneSettingFormValues = z.infer<typeof sceneSettingSchema>;

/**
 * 通知设置页面（短信场景）。
 */
const NoticeNotificationSettingsPage = () => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingScene, setEditingScene] = useState<SmsSceneSetting | null>(null);

  const form = useForm<SceneSettingFormValues>({
    resolver: zodResolver(sceneSettingSchema),
    defaultValues: {
      enable: true,
      templateId: "",
      content: "",
    },
  });

  const { data, isLoading, refetch } = useSmsSceneSettingsQuery({});
  const rows = useMemo(() => data || [], [data]);

  const updateMutation = useUpdateSmsSceneSettingMutation(editingScene?.scene ?? 0, {
    onSuccess: () => {
      toast.success("通知场景配置已更新");
      setDialogOpen(false);
      setEditingScene(null);
      void refetch();
    },
    onError: (error: any) => {
      toast.error(error?.message || "更新通知场景配置失败");
    },
  });

  useEffect(() => {
    if (!editingScene) {
      return;
    }

    form.reset({
      enable: editingScene.smsEnabled,
      templateId: editingScene.smsTemplateId,
      content: editingScene.smsContent,
    });
  }, [editingScene, form]);

  /**
   * 打开场景配置弹窗。
   */
  const handleOpenSetting = (row: SmsSceneSetting) => {
    setEditingScene(row);
    setDialogOpen(true);
  };

  /**
   * 提交当前场景配置。
   */
  const onSubmit = async (values: SceneSettingFormValues) => {
    if (!editingScene) {
      return;
    }

    await updateMutation.mutateAsync({
      enable: values.enable,
      templateId: values.templateId,
      content: values.content,
    });
  };

  return (
    <PageContainer className="h-inset">
      <div className="space-y-4">
        <h2 className="text-base font-medium">通知设置</h2>

        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>通知场景</TableHead>
                <TableHead>通知类型</TableHead>
                <TableHead>短信通知</TableHead>
                {/* <TableHead>邮箱通知</TableHead> */}
                <PermissionGuard permissions="notice:sms-scene-settings-update">
                  <TableHead className="w-[120px]">操作</TableHead>
                </PermissionGuard>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground h-24 text-center text-sm">
                    加载中...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground h-24 text-center text-sm">
                    暂无通知场景配置
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.scene}>
                    <TableCell>{row.sceneName}</TableCell>
                    <TableCell>{row.noticeType}</TableCell>
                    <TableCell>
                      <Badge variant={row.smsEnabled ? "default" : "secondary"}>
                        {row.smsEnabled ? "开启" : "关闭"}
                      </Badge>
                    </TableCell>
                    {/* <TableCell>
                      {row.emailEnabled === null ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <Badge variant={row.emailEnabled ? "default" : "secondary"}>
                          {row.emailEnabled ? "启用" : "禁用"}
                        </Badge>
                      )}
                    </TableCell> */}
                    <PermissionGuard permissions="notice:sms-scene-settings-update">
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => handleOpenSetting(row)}>
                          设置
                        </Button>
                      </TableCell>
                    </PermissionGuard>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>短信通知设置</DialogTitle>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="enable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>开启状态</FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-3">
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                        <span className="text-sm">{field.value ? "开启" : "关闭"}</span>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="templateId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>模板ID</FormLabel>
                    <FormControl>
                      <Input placeholder="例如：SMS_222458159" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>短信内容</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="请输入短信内容，支持变量 ${code}"
                        className="min-h-28"
                        {...field}
                      />
                    </FormControl>
                    <p className="text-muted-foreground text-xs">
                      可选变量：验证码变量 {"${code}"}。示例：您正在登录，验证码 {"${code}"}
                      ，5分钟内有效。
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={updateMutation.isPending}
                >
                  取消
                </Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  保存
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
};

export default NoticeNotificationSettingsPage;
