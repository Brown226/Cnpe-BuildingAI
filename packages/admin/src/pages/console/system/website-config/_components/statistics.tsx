import {
  useSetWebsiteConfigMutation,
  useWebsiteConfigQuery,
  type WebsiteConfigResponse,
} from "@buildingai/services/console";
import { PermissionGuard } from "@buildingai/ui/components/auth/permission-guard";
import { Button } from "@buildingai/ui/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@buildingai/ui/components/ui/form";
import { Input } from "@buildingai/ui/components/ui/input";
import { ExternalLinkIcon, Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { toast } from "sonner";

export type StatisticsFormValues = {
  appid: string;
};

const defaultValues: StatisticsFormValues = { appid: "" };

export default function Statistics() {
  const { data: rawData, isLoading } = useWebsiteConfigQuery();
  const data = rawData as WebsiteConfigResponse | undefined;
  const setMutation = useSetWebsiteConfigMutation({
    onSuccess: () => toast.success("保存成功"),
    onError: (e) => {
      console.log(`保存失败: ${e.message}`);
    },
  });

  const form = useForm<StatisticsFormValues>({ defaultValues });

  useEffect(() => {
    if (data?.statistics == null) return;
    form.reset({ appid: data.statistics.appid ?? "" });
  }, [data?.statistics, form]);

  const onSubmit = (values: StatisticsFormValues) => {
    setMutation.mutate({ statistics: { appid: values.appid } });
  };
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="appid"
          render={({ field }) => (
            <FormItem>
              <FormLabel>AppID</FormLabel>
              <FormControl>
                <Input placeholder="请输入统计应用ID" {...field} />
              </FormControl>
              <FormDescription>
                开通地址:{" "}
                <Button variant="link" asChild className="h-fit p-0">
                  <Link
                    to="https://clarity.microsoft.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Microsoft Clarity
                    <ExternalLinkIcon className="size-4" />
                  </Link>
                </Button>
              </FormDescription>
            </FormItem>
          )}
        />
        <div className="flex gap-2">
          <PermissionGuard permissions="system-website:setConfig">
            <Button type="submit" disabled={setMutation.isPending}>
              {setMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              保存设置
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                data?.statistics != null && form.reset({ appid: data.statistics.appid ?? "" })
              }
            >
              重置设置
            </Button>
          </PermissionGuard>
        </div>
      </form>
    </Form>
  );
}
