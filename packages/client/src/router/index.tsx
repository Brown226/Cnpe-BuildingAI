import GlobalError from "@buildingai/ui/components/exception/global-error";
import NotFoundPage from "@buildingai/ui/components/exception/not-found-page";
import MainLayout from "@buildingai/ui/layouts/main/index";
import DefaultLayout from "@buildingai/ui/layouts/styles/default/index";
import { useAuthStore } from "@buildingai/stores";
import { Navigate, useLocation, createBrowserRouter } from "react-router-dom";
import type { ReactNode } from "react";

import AgentsIndexPage from "@/pages/agents";
import AgentChatPage from "@/pages/agents/detail/chat";
import AgentConfigurationPage from "@/pages/agents/detail/configuration";
import AgentLogsPage from "@/pages/agents/detail/logs";
import AgentMonitoringPage from "@/pages/agents/detail/monitoring";
import AgentPublishPage from "@/pages/agents/detail/publish";
import PublishChatPage from "@/pages/agents/site-chat";
import AgentsWorkspacePage from "@/pages/agents/workspace";
import AppsIndexPage from "@/pages/apps";
import DatasetsIndexPage from "@/pages/datasets";
import DatasetsLayout from "@/pages/datasets/_layouts";
import DatasetsDetailPage from "@/pages/datasets/detail";
import InstallPage from "@/pages/install";

import DynamicHomePage from "../pages";
import AppIframePage from "../pages/apps/[identifier]";
import ChatPage from "../pages/chat";
import { LoginPage } from "../pages/login";
import { OAuthCallbackPage } from "../pages/login/oauth-callback";
import AlipayReturnPage from "../pages/payment/alipay-return";
import { AutomationsPage } from "../pages/automations";
import { DesktopProjectsSection } from "@/components/desktop/sidebar-projects-section";
import { ModeTabs } from "@/components/desktop/mode-tabs";
import { DesktopRightPanel } from "@/components/desktop/desktop-right-panel";
import { SplitPill } from "@/components/desktop/split-pill";
import { CommandPalette } from "@/components/desktop/command-palette";

/** 登录守卫：未持 token 的访问重定向到登录页（带 redirect 回跳参数） */
function AuthGuard({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.auth.token);
  const location = useLocation();
  if (!token) {
    const redirect = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    element: <MainLayout />,
    errorElement: <GlobalError />,
    children: [
      {
        path: "/login",
        element: <LoginPage />,
      },
      {
        path: "/login/oauth-callback",
        element: <OAuthCallbackPage />,
      },
      {
        path: "/install",
        element: <InstallPage />,
      },
      {
        path: "/payment/alipay-return",
        element: <AlipayReturnPage />,
      },
      {
        path: "/agents/:id/configuration",
        element: <AgentConfigurationPage />,
      },
      {
        path: "/agents/:id/publish",
        element: <AgentPublishPage />,
      },
      {
        path: "/agents/:id/logs",
        element: <AgentLogsPage />,
      },
      {
        path: "/agents/:id/monitoring",
        element: <AgentMonitoringPage />,
      },
      {
        path: "/agents/:id/chat",
        element: <AgentChatPage />,
      },
      {
        path: "/agents/:id/c/:uuid",
        element: <AgentChatPage />,
      },
      {
        path: "/agents/:agentId/:accessToken/c/:conversationId",
        element: <PublishChatPage />,
      },
      {
        path: "/agents/:agentId/:accessToken",
        element: <PublishChatPage />,
      },
      {
        element: (
          <DefaultLayout
            extraSidebarContent={<DesktopProjectsSection />}
            headerContent={
              <div className="flex w-full items-center justify-between">
                <ModeTabs />
                <SplitPill />
              </div>
            }
            rightPanelContent={<DesktopRightPanel />}
          />
        ),
        errorElement: (
          <DefaultLayout>
            <GlobalError />
          </DefaultLayout>
        ),
        children: [
          // 命令面板使用 useNavigate，需在 Router 上下文内渲染（全局浮层）
          {
            element: <CommandPalette />,
          },
          {
            element: <DynamicHomePage />,
            children: [
              {
                index: true,
                element: <ChatPage />,
              },
              {
                path: "/c/:id",
                element: <ChatPage />,
              },
            ],
          },
          {
            path: "/chat",
            element: <ChatPage />,
          },
          {
            path: "/automations",
            element: <AutomationsPage />,
          },
          {
            path: "/chat/:id",
            element: <ChatPage />,
          },
          {
            path: "/apps",
            element: <AppsIndexPage />,
          },
          {
            path: "/apps/:identifier/*",
            element: (
              <AuthGuard>
                <AppIframePage />
              </AuthGuard>
            ),
          },
          {
            path: "/agents",
            element: <AgentsIndexPage />,
          },
          {
            path: "/datasets",
            element: <DatasetsLayout />,
            children: [
              {
                index: true,
                element: <DatasetsIndexPage />,
              },

              {
                path: "/datasets/:id",
                element: (
                  <AuthGuard>
                    <DatasetsDetailPage />
                  </AuthGuard>
                ),
              },
            ],
          },
          {
            path: "/agents/workspace",
            element: <AgentsWorkspacePage />,
          },
          {
            path: "*",
            element: <NotFoundPage />,
          },
        ],
      },

      {
        path: "*",
        element: <NotFoundPage />,
      },
    ],
  },
]);
