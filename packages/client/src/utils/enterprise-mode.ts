/**
 * 企业免费模式（SERVER_BILLING_ENABLED !== "true"）下从后台控制台隐藏的商业菜单 path。
 * 对应 C 端商业模块：财务管理（financial）/ 营销中心（operation）/ 订单管理（order）/
 * 支付配置（pay-config）。
 * 无论 RBAC 是否授权，企业模式下这些入口与页面均不可达。
 */
export const ENTERPRISE_HIDDEN_CONSOLE_MENU_PATHS: readonly string[] = [
    "financial",
    "order",
    "operation",
    "pay-config",
];

export function isEnterpriseHiddenConsolePath(path: string): boolean {
    return ENTERPRISE_HIDDEN_CONSOLE_MENU_PATHS.some(
        (p) => path === p || path.startsWith(`${p}/`),
    );
}