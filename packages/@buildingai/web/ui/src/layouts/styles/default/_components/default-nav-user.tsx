import { useSettingsDialog } from "@buildingai/hooks";
import { useRechargeCenterQuery } from "@buildingai/services/web";
import { useAuthStore, useConfigStore } from "@buildingai/stores";
import { Avatar, AvatarFallback, AvatarImage } from "@buildingai/ui/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@buildingai/ui/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@buildingai/ui/components/ui/sidebar";
import { useAlertDialog } from "@buildingai/ui/hooks/use-alert-dialog";
import { ChevronsUpDown, LogOut, Settings, Sparkles, User, UserStar, Zap } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { UpgradeDialog } from "./upgrade-dialog";

export function UserButton({
  isLoggedIn,
  userInfo,
  billingEnabled = true,
}: {
  isLoggedIn: boolean;
  userInfo?: any;
  billingEnabled?: boolean;
}) {
  return (
    <>
      <Avatar className="h-8 w-8 rounded-lg after:rounded-lg">
        {isLoggedIn && (
          <AvatarImage className="rounded-lg" src={userInfo?.avatar} alt={userInfo?.nickname} />
        )}
        <AvatarFallback className="rounded-lg">
          {isLoggedIn ? userInfo?.nickname?.slice(0, 1) : <User />}
        </AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{userInfo?.nickname || "未登录"}</span>
        <span className="text-muted-foreground truncate text-xs">
          {isLoggedIn ? (
            billingEnabled ? (
              <div className="flex items-center gap-0.5">
                <Zap className="size-3!" />
                <span className="">{userInfo?.power || "0"}</span>
              </div>
            ) : (
              userInfo?.isRoot ? "超级管理员" : userInfo?.role?.name || "未设置角色"
            )
          ) : (
            "请先登录后使用"
          )}
        </span>
      </div>
      <ChevronsUpDown className="ml-auto size-4" />
    </>
  );
}

export function DefaultNavUser() {
  const { isMobile } = useSidebar();
  const { userInfo } = useAuthStore((state) => state.auth);
  const { websiteConfig } = useConfigStore((state) => state.config);
  const { logout, isLogin } = useAuthStore((state) => state.authActions);

  const location = useLocation();
  const navigate = useNavigate();
  const { confirm } = useAlertDialog();
  const settingsDialog = useSettingsDialog();
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);

  const isLoggedIn = isLogin();
  const membershipEnabled = websiteConfig?.features?.membership ?? false;
  const billingEnabled = websiteConfig?.features?.billingEnabled ?? false;
  // 企业免费模式下充值接口已被路由拦截，不再发起查询（避免跨域/404 噪音）
  const { data: rechargeCenter } = useRechargeCenterQuery({ enabled: billingEnabled });
  const rechargeEnabled = rechargeCenter?.rechargeStatus ?? false;

  if (!isLoggedIn) {
    const redirect = encodeURIComponent(location.pathname + location.search);

    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" asChild>
            <Link to={`/login?redirect=${redirect}`} state={{ redirect: location.pathname }}>
              <UserButton isLoggedIn={false} billingEnabled={billingEnabled} />
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground overflow-visible"
            >
              <UserButton isLoggedIn={true} userInfo={userInfo} billingEnabled={billingEnabled} />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <SidebarMenuButton
                size="lg"
                onClick={() => {
                  settingsDialog.open("profile");
                }}
              >
                <div className="relative">
                  <Avatar className="h-8 w-8 rounded-lg after:rounded-lg">
                    {isLoggedIn && (
                      <AvatarImage
                        className="rounded-lg"
                        src={userInfo?.avatar}
                        alt={userInfo?.nickname}
                      />
                    )}
                    <AvatarFallback className="rounded-lg">
                      {isLoggedIn ? userInfo?.nickname?.slice(0, 1) : <User />}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="text-foreground truncate font-medium">
                    {userInfo?.nickname || "未登录"}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {isLogin() ? (
                      <div className="flex items-center gap-0.5">
                        {membershipEnabled ? (
                          userInfo?.membershipLevel?.name || "未订阅会员"
                        ) : billingEnabled ? (
                          <div className="flex items-center gap-0.5">
                            <Zap className="size-3!" />
                            <span className="">{userInfo?.power || "0"}</span>
                          </div>
                        ) : (
                          userInfo?.isRoot
                            ? "超级管理员"
                            : userInfo?.role?.name || "未设置角色"
                        )}
                      </div>
                    ) : (
                      "请先登录后使用"
                    )}
                  </span>
                </div>
              </SidebarMenuButton>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {membershipEnabled && (
                <DropdownMenuItem
                  onSelect={() => {
                    setUpgradeDialogOpen(true);
                  }}
                >
                  <Sparkles />
                  会员订阅
                </DropdownMenuItem>
              )}
              {rechargeEnabled && billingEnabled && (
                <DropdownMenuItem
                  onSelect={() => {
                    settingsDialog.open("wallet");
                  }}
                >
                  <Zap />
                  积分购买
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => settingsDialog.open("personalized")}>
                <UserStar />
                个性化
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => settingsDialog.open("general")}>
                <Settings />
                设置
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                const redirect = encodeURIComponent(location.pathname + location.search);
                await confirm({
                  title: "退出确认",
                  description: "确定要退出登录吗？",
                });
                await logout();
                navigate(`/login?redirect=${redirect}`);
              }}
            >
              <LogOut />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {membershipEnabled && (
          <UpgradeDialog open={upgradeDialogOpen} onOpenChange={setUpgradeDialogOpen} />
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
