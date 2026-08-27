import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// 端分离前台包：管理端应用（ADR-S03）。构建产物经 release.mjs 落 public/admin。
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        babel({ presets: [reactCompilerPreset()] }),
    ],
    clearScreen: false,
    resolve: {
        tsconfigPaths: true,
        alias: [
            // 阶段1过渡：共享 UI/工具暂留 client。共享模块内部的 @/ 引用需指回 client，
            // admin 自有的 @/ 由兜底别名处理。待“共享 UI 层收编 @buildingai/ui”后移除这些条目。
            { find: "@client", replacement: path.resolve(__dirname, "../client/src") },
            { find: "@/services/desktop", replacement: path.resolve(__dirname, "../client/src/services/desktop") },
            { find: "@/components/desktop", replacement: path.resolve(__dirname, "../client/src/components/desktop") },
            { find: "@/components/ask-assistant-ui", replacement: path.resolve(__dirname, "../client/src/components/ask-assistant-ui") },
            { find: "@/components/settings-dialog", replacement: path.resolve(__dirname, "../client/src/components/settings-dialog") },
            { find: "@/components/image-preview", replacement: path.resolve(__dirname, "../client/src/components/image-preview") },
            { find: "@/components/provider-icons", replacement: path.resolve(__dirname, "../client/src/components/provider-icons") },
            { find: "@/components/agreement-dialog", replacement: path.resolve(__dirname, "../client/src/components/agreement-dialog") },
            { find: "@/components/tags", replacement: path.resolve(__dirname, "../client/src/components/tags") },
            { find: "@/components/file-fomat-icons", replacement: path.resolve(__dirname, "../client/src/components/file-fomat-icons") },
            { find: "@/utils/api", replacement: path.resolve(__dirname, "../client/src/utils/api") },
            { find: "@/utils/error", replacement: path.resolve(__dirname, "../client/src/utils/error") },
            { find: "@/utils/format", replacement: path.resolve(__dirname, "../client/src/utils/format") },
            { find: "@", replacement: path.resolve(__dirname, "src") },
        ],
        dedupe: ["react", "react-dom", "@tanstack/react-query"],
    },
    server: {
        host: "0.0.0.0",
        open: true,
        port: 4092,
        strictPort: true,
    },
    build: {
        sourcemap: false,
        rollupOptions: {
            onwarn(warning, warn) {
                if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
                if (warning.code === "COMMONJS_VARIABLE_IN_ESM") return;
                if (
                    warning.message &&
                    warning.message.includes("dynamic import will not move module into another chunk")
                )
                    return;
                warn(warning);
            },
            output: {
                manualChunks(id) {
                    // 共享依赖独立分包，加速缓存命中
                    if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
                        return "vendor-react";
                    }
                    if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) {
                        return "vendor-charts";
                    }
                    if (id.includes("@buildingai/") && id.includes("node_modules")) {
                        return "vendor-buildingai";
                    }
                    return undefined;
                },
            },
        },
    },
});