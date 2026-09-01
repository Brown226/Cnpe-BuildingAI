import { createHttpClient, createStandardApiParser } from "@buildingai/http";
import type { UserInfo } from "@buildingai/web-types";
import type { StateCreator } from "zustand";

import { createStore } from "../create-store";
import { clearPluginAuthCookies, setPluginAuthCookies } from "../utils/plugin-auth-cookies";

const isDev = import.meta.env.DEV;
const devBase = import.meta.env.VITE_DEVELOP_APP_BASE_URL;
const prodBase = import.meta.env.VITE_PRODUCTION_APP_BASE_URL;

export interface AuthState {
    token?: string;
    userInfo?: UserInfo;
}

export interface AuthActions {
    setToken: (token?: string) => void;
    setUserInfo: (userInfo?: UserInfo) => void;
    logout: () => Promise<void>;
    isLogin: () => boolean;
}

export type AuthSlice = {
    auth: AuthState;
    authActions: AuthActions;
};

const apiHttpClient = createHttpClient({
    baseURL: isDev ? devBase : prodBase,
    pathPrefix: import.meta.env.VITE_APP_WEB_API_PREFIX || "/api",
    parseResponse: createStandardApiParser(),
    hooks: {
        getAccessToken: async () => {
            return useAuthStore.getState().auth.token || "";
        },
        // 滑动续期写回（延迟引用 useAuthStore，回调运行时已初始化）
        onTokenRefreshed: (token) => {
            useAuthStore.getState().authActions.setToken(token);
        },
        onAuthError: () => {},
        onError: () => {},
    },
});

export const createAuthSlice: StateCreator<AuthSlice, [], [], AuthSlice> = (set) => ({
    auth: {
        token: undefined,
        userInfo: undefined,
    },
    authActions: {
        setToken: (token) => set((s) => ({ auth: { ...s.auth, token } })),
        setUserInfo: (userInfo) => set((s) => ({ auth: { ...s.auth, userInfo } })),
        logout: async () => {
            try {
                if (useAuthStore.getState().authActions.isLogin()) {
                    await apiHttpClient.post("/auth/logout");
                }
            } catch (error) {
                console.error("Logout request failed:", error);
            } finally {
                set(() => ({ auth: { token: undefined, userInfo: undefined } }));
            }
        },
        isLogin: () => {
            const { token } = useAuthStore.getState().auth;
            return !!token;
        },
    },
});

export const useAuthStore = createStore<AuthSlice>(createAuthSlice, {
    persist: {
        name: "auth",
        partialize: (state) => ({ auth: state.auth }),
    },
});

/**
 * Keep extension-readable cookies in sync with `auth.token` without touching persist logic.
 * Runs after localStorage rehydration so existing sessions get cookies on next page load.
 */
if (typeof window !== "undefined") {
    let prevToken = useAuthStore.getState().auth.token;
    if (prevToken) {
        setPluginAuthCookies(prevToken);
    }
    useAuthStore.subscribe((state) => {
        const token = state.auth.token;
        if (token === prevToken) return;
        prevToken = token;
        if (token) {
            setPluginAuthCookies(token);
        } else {
            clearPluginAuthCookies();
        }
    });
}
