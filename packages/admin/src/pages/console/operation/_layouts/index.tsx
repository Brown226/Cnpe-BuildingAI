import { useAuthStore } from "@buildingai/stores";
import { SidebarInset } from "@buildingai/ui/components/ui/sidebar";
import { isEnabled } from "@buildingai/utils/is";
import { Navigate, Outlet, useParams } from "react-router-dom";

import type { SidebarMenuItem } from "../_config/sidebar-config";
import { sidebarConfigMap } from "../_config/sidebar-config";
import { OperationSidebar } from "./sidebar";

function hasMenuItemPermission(
  item: SidebarMenuItem,
  userPermissions: string[],
  isRoot: boolean,
): boolean {
  if (isRoot) return true;

  const permissions = Array.isArray(item.permissions) ? item.permissions : [item.permissions];
  return permissions.some((permission) => userPermissions.includes(permission));
}

/**
 * 营销工具通用布局组件
 * 根据路由参数动态加载对应的侧边栏配置
 */
export default function OperationLayout() {
  const params = useParams();
  const { userInfo } = useAuthStore((state) => state.auth);

  // 从路由中提取工具类型（如 'cdk', 'points-task'）
  const routeParts = params["*"]?.split("/").filter(Boolean) ?? [];
  const toolType = routeParts[0] || "";
  const toolSubPath = routeParts.slice(1).join("/");
  const config = sidebarConfigMap[toolType];

  if (!config) {
    return <Navigate to="/console/operation" replace />;
  }

  const userPermissions = userInfo?.permissionsCodes ?? [];
  const isRoot = isEnabled(userInfo?.isRoot);
  const accessibleMenuItems = config.menuItems.filter((item) =>
    hasMenuItemPermission(item, userPermissions, isRoot),
  );
  const hasCurrentMenuAccess = accessibleMenuItems.some(
    (item) => toolSubPath === item.path || toolSubPath.startsWith(`${item.path}/`),
  );

  if (!toolSubPath && accessibleMenuItems[0]) {
    return (
      <Navigate to={`/console/operation/${toolType}/${accessibleMenuItems[0].path}`} replace />
    );
  }

  if (!hasCurrentMenuAccess) {
    return <Navigate to="/console/operation" replace />;
  }

  // 构建基础路径
  const basePath = `/console/operation/${toolType}`;

  return (
    <>
      <OperationSidebar config={config} basePath={basePath} />
      <SidebarInset className="flex flex-col overflow-hidden">
        <div className="relative flex-1">
          <Outlet />
        </div>
      </SidebarInset>
    </>
  );
}
