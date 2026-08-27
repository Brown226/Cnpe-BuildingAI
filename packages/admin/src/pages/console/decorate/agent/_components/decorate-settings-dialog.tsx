"use client";

import { type PagePathInfo, parsePageModules } from "@buildingai/hooks";
import { useAgentDecorateQuery, useSetAgentDecorateMutation } from "@buildingai/services/console";
import { Button } from "@buildingai/ui/components/ui/button";
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@buildingai/ui/components/ui/carousel";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@buildingai/ui/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import { ImageUpload } from "@buildingai/ui/components/ui/image-upload";
import { Input } from "@buildingai/ui/components/ui/input";
import { Label } from "@buildingai/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@buildingai/ui/components/ui/select";
import { Switch } from "@buildingai/ui/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type BannerItem = {
  imageUrl: string;
  linkUrl: string;
  linkType: "system" | "custom";
  linkComponent?: string | null;
};

const pageModules = import.meta.glob("/src/pages/**/index.tsx", { eager: true });
const pagePaths = parsePageModules(pageModules, {
  exclude: ["/console/", "/_", "/install"],
});

type DecorateSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

export function DecorateSettingsDialog({
  open,
  onOpenChange,
  onSuccess,
}: DecorateSettingsDialogProps) {
  const [enabled, setEnabled] = useState(false);
  const [banners, setBanners] = useState<BannerItem[]>([
    { imageUrl: "", linkUrl: "", linkType: "custom", linkComponent: null },
  ]);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const count = banners.length;

  const { data: config, isLoading } = useAgentDecorateQuery({ enabled: open });
  const setMutation = useSetAgentDecorateMutation({
    onSuccess: () => {
      toast.success("保存成功");
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (e) => {
      toast.error(`保存失败: ${e.message}`);
    },
  });

  useEffect(() => {
    if (!open || !config) return;

    setEnabled(config.enabled);

    if (config.banners && config.banners.length > 0) {
      setBanners(
        config.banners.map((banner) => {
          const linkUrl = banner.linkUrl || "";
          const matched = pagePaths.find((p) => p.path === linkUrl);
          return {
            imageUrl: banner.imageUrl || "",
            linkUrl,
            linkType: (matched ? "system" : "custom") as "system" | "custom",
            linkComponent: matched?.component ?? null,
          };
        }),
      );
    } else if (config.heroImageUrl || config.link?.path) {
      const linkUrl = config.link?.path ?? "";
      const matched = pagePaths.find((p) => p.path === linkUrl);
      setBanners([
        {
          imageUrl: config.heroImageUrl ?? "",
          linkUrl,
          linkType: (matched ? "system" : "custom") as "system" | "custom",
          linkComponent: matched?.component ?? null,
        },
      ]);
    } else {
      setBanners([{ imageUrl: "", linkUrl: "", linkType: "custom", linkComponent: null }]);
    }
  }, [open, config]);

  useEffect(() => {
    if (!api) return;
    setCurrent(api.selectedScrollSnap() + 1);
    api.on("select", () => setCurrent(api.selectedScrollSnap() + 1));
    api.on("reInit", () => setCurrent(api.selectedScrollSnap() + 1));
  }, [api]);

  const handleAddBanner = () => {
    setBanners((prev) => [
      ...prev,
      { imageUrl: "", linkUrl: "", linkType: "custom", linkComponent: null },
    ]);
  };

  const handleRemoveBanner = (index: number) => {
    if (banners.length <= 1) return;
    setBanners((prev) => prev.filter((_, i) => i !== index));
  };

  const handleBannerChange = (
    index: number,
    updates: Partial<Pick<BannerItem, "imageUrl" | "linkUrl" | "linkType" | "linkComponent">>,
  ) => {
    setBanners((prev) => prev.map((item, i) => (i === index ? { ...item, ...updates } : item)));
  };

  const handleSave = () => {
    const validBanners = banners
      .filter((banner) => banner.imageUrl.trim())
      .map((banner) => ({
        imageUrl: banner.imageUrl.trim(),
        linkUrl: banner.linkUrl.trim() || undefined,
        linkType: banner.linkType,
      }));

    if (validBanners.length === 0) {
      toast.error("请至少添加一张有效的 Banner 图片");
      return;
    }

    setMutation.mutate({
      enabled,
      title: config?.title ?? "",
      description: config?.description ?? "",
      banners: validBanners,
      overlayTitle: config?.overlayTitle ?? "",
      overlayDescription: config?.overlayDescription ?? "",
      overlayIconUrl: config?.overlayIconUrl ?? "",
      sortAgentIds: config?.sortAgentIds ?? [],
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-xl flex-col">
        <DialogHeader>
          <DialogTitle>设置装修位</DialogTitle>
        </DialogHeader>
        <div ref={setContainer} className="flex min-h-0 flex-1 flex-col gap-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="ad-enabled" className="flex-1">
              启用广告位
            </Label>
            <Switch
              id="ad-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={isLoading}
            />
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label>轮播图 Banner 设置</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddBanner}
                disabled={isLoading || count >= 5}
              >
                <Plus className="size-4" />
                添加
              </Button>
            </div>
            <Carousel setApi={setApi} opts={{ align: "start" }} className="mx-auto w-[74%]">
              <CarouselContent>
                {banners.map((banner, index) => (
                  <CarouselItem key={index} className="basis-full">
                    <div className="border-border flex min-w-0 flex-col gap-3 rounded-lg border p-3">
                      <div className="flex items-center justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleRemoveBanner(index)}
                          disabled={banners.length <= 1 || isLoading}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <ImageUpload
                        className="aspect-4/1 w-full!"
                        value={banner.imageUrl || undefined}
                        onChange={(url) => handleBannerChange(index, { imageUrl: url ?? "" })}
                        disabled={isLoading}
                      />
                      <div className="grid min-w-0 gap-2">
                        <Label className="text-xs">跳转类型</Label>
                        <Select
                          value={banner.linkType}
                          onValueChange={(v) => {
                            handleBannerChange(index, {
                              linkType: v as "system" | "custom",
                              linkComponent: v === "system" ? null : undefined,
                              linkUrl: v === "system" ? "" : banner.linkUrl,
                            });
                          }}
                          disabled={isLoading}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="选择跳转类型" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="system">系统页面</SelectItem>
                            <SelectItem value="custom">自定义链接</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {banner.linkType === "system" && (
                        <div className="grid min-w-0 gap-2">
                          <Label className="text-xs">组件路径</Label>
                          <Combobox<PagePathInfo>
                            value={
                              pagePaths.find((p) => p.component === banner.linkComponent) ?? null
                            }
                            onValueChange={(item) => {
                              handleBannerChange(index, {
                                linkComponent: item?.component ?? null,
                                linkUrl: item?.path ?? "",
                              });
                            }}
                            items={pagePaths}
                            itemToStringValue={(item) => item.label}
                          >
                            <ComboboxInput
                              placeholder="搜索或选择组件路径..."
                              className="w-full min-w-0"
                              disabled={isLoading}
                            />
                            <ComboboxContent container={container}>
                              <ComboboxEmpty>未找到匹配的组件路径</ComboboxEmpty>
                              <ComboboxList>
                                {(item) => (
                                  <ComboboxItem key={item.component} value={item}>
                                    {item.label}
                                  </ComboboxItem>
                                )}
                              </ComboboxList>
                            </ComboboxContent>
                          </Combobox>
                        </div>
                      )}
                      {banner.linkType === "custom" && (
                        <div className="grid min-w-0 gap-2">
                          <Label className="text-xs">路径</Label>
                          <Input
                            placeholder="菜单跳转路径，如 https://www.example.com"
                            value={banner.linkUrl}
                            onChange={(e) => handleBannerChange(index, { linkUrl: e.target.value })}
                            disabled={isLoading}
                            className="min-w-0"
                          />
                        </div>
                      )}
                    </div>
                  </CarouselItem>
                ))}
              </CarouselContent>
              <CarouselPrevious />
              <CarouselNext />
            </Carousel>
            <div className="text-muted-foreground py-2 text-center text-sm">
              {current}/{count}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={setMutation.isPending || isLoading}>
              {setMutation.isPending ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
