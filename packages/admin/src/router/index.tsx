import AuthGuard from "@buildingai/ui/components/auth/auth-guard";
import NotFoundPage from "@buildingai/ui/components/exception/not-found-page";
import { createBrowserRouter, Navigate } from "react-router-dom";

import ConsoleLayout from "../layouts/console";
import { LoginPage } from "../pages/login";

/**
 * 管理端路由（端分离 ADR-S03）：仅登录页与 /console 管理面。
 * 与 C 端无关；非管理登录由后端 AdminGuard 兜底（阶段 2）。
 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/console" replace />,
  },
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    element: <AuthGuard />,
    children: [
      {
        path: "/console/*",
        element: <ConsoleLayout />,
      },
    ],
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);