import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import { ScrollArea } from "@buildingai/ui/components/ui/scroll-area";

import AiSecretTemplateManage from "../../secret/_components/secret-template-manage";

const AiSecretManageDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-6xl">
        <DialogHeader className="p-4">
          <DialogTitle>密钥管理</DialogTitle>
          <DialogDescription>管理所有密钥配置</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[80vh]">
          <div className="p-4 pt-0 pb-6">
            <AiSecretTemplateManage />
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default AiSecretManageDialog;
