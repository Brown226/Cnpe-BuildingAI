import {
  type EmployeeImportReport,
  useImportEmployeesMutation,
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
import { ScrollArea } from "@buildingai/ui/components/ui/scroll-area";
import { Loader2, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

type ImportEmployeesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

/**
 * 员工 Excel 导入对话框
 *
 * 上传员工名单 Excel（列：登录账号/真实姓名/密码/角色/一级部门/二级部门/邮箱），
 * 展示导入结果报告（成功数 + 跳过明细）。
 */
export function ImportEmployeesDialog({ open, onOpenChange, onSuccess }: ImportEmployeesDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");
  const [report, setReport] = useState<EmployeeImportReport | null>(null);

  const importMutation = useImportEmployeesMutation({
    onSuccess: (result) => {
      setReport(result);
      toast.success(`导入完成：成功 ${result.imported} 条，跳过 ${result.skipped.length} 条`);
      onSuccess?.();
    },
    onError: (e) => {
      toast.error(`导入失败: ${e.message}`);
    },
  });

  const handleClose = (openNext: boolean) => {
    onOpenChange(openNext);
    if (!openNext) {
      // 重置状态
      setTimeout(() => {
        setFileName("");
        setReport(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }, 200);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setReport(null);
    importMutation.mutate(file);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导入员工</DialogTitle>
          <DialogDescription>
            上传员工名单 Excel（列：登录账号 / 真实姓名 / 密码 / 角色 / 一级部门 / 二级部门 /
            邮箱）。部门不存在时自动创建，账号已存在自动跳过。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label
            className="border-muted-foreground/25 hover:bg-muted/50 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center"
            onClick={() => !importMutation.isPending && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileChange}
            />
            {importMutation.isPending ? (
              <Loader2 className="size-8 animate-spin" />
            ) : (
              <UploadCloud className="text-muted-foreground size-8" />
            )}
            <div className="text-sm font-medium">
              {fileName || (importMutation.isPending ? "正在解析导入..." : "点击选择 Excel 文件")}
            </div>
            <div className="text-muted-foreground text-xs">
              支持 .xlsx / .xls，文件内账号与邮箱重复自动去重
            </div>
          </label>

          {report && (
            <div className="rounded-lg border p-3 text-sm">
              <div className="mb-2 flex items-center gap-4">
                <span>
                  总行数: <b>{report.total}</b>
                </span>
                <span className="text-green-600">
                  成功: <b>{report.imported}</b>
                </span>
                <span className="text-amber-600">
                  跳过: <b>{report.skipped.length}</b>
                </span>
              </div>
              {report.skipped.length > 0 && (
                <ScrollArea className="max-h-40 rounded-md border p-2">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground">
                        <th className="text-left font-medium">行号</th>
                        <th className="text-left font-medium">账号</th>
                        <th className="text-left font-medium">原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.skipped.map((s, i) => (
                        <tr key={i}>
                          <td className="py-0.5 pr-2">{s.row}</td>
                          <td className="py-0.5 pr-2">{s.username || "-"}</td>
                          <td className="py-0.5">{s.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={importMutation.isPending}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}