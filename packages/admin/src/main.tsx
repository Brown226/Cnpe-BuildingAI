import "./styles/index.css";

import { I18nProvider } from "@buildingai/i18n";
import { QueryClient, QueryClientProvider } from "@buildingai/services";
import { ThemeProvider } from "@buildingai/ui/components/theme-provider";
import { Toaster } from "@buildingai/ui/components/ui/sonner";
import { TooltipProvider } from "@buildingai/ui/components/ui/tooltip";
import { AlertDialogProvider } from "@buildingai/ui/hooks/use-alert-dialog";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { SettingsDialogProvider } from "@client/components/settings-dialog";
import { defaultLocale, messages } from "./locales";
import { router } from "./router";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error && typeof error === "object" && "status" in error && error.status === 401) {
          return false;
        }
        return failureCount < 3;
      },
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider messages={messages} defaultLocale={defaultLocale}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <AlertDialogProvider>
              <SettingsDialogProvider>
                <Toaster position="top-center" />
                <RouterProvider router={router} />
              </SettingsDialogProvider>
            </AlertDialogProvider>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);