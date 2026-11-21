import { defineConfig } from "vite";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import RekaResolver from "reka-ui/resolver";
import vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";
import { cleanBuildOutput } from "./scripts/lib/clean-build-output.mjs";
import { ocrPrebundlePlugin, ocrProductionPlugin } from "./scripts/lib/ocr-source-reuse.mjs";

// 本地运行用。OCR 用 WebGL，导出用 File System Access API，
// 需在 Chrome / Edge 里以 http://localhost 打开（不是 file://）。
export default defineConfig({
  base: "./",
  plugins: [
    cleanBuildOutput(),
    {
      name: "preload-home-workspace",
      apply: "build",
      transformIndexHtml(_, { bundle, chunk }) {
        // Download the workspace during startup. Its store modules still execute
        // only after the desktop data migration in main.js has completed.
        const home = Object.values(bundle).find(output => output.type === "chunk" &&
          output.moduleIds.some(id => id.endsWith("/src/App.vue")));
        if (!home || home === chunk) return;
        const seen = new Set([chunk.fileName, ...chunk.imports]);
        const scripts = [];
        function preload(file) {
          if (seen.has(file) || bundle[file]?.type !== "chunk") return;
          seen.add(file);
          scripts.push({ tag: "link", attrs: { rel: "modulepreload", crossorigin: "", href: "./" + file } });
          bundle[file].imports.forEach(preload);
        }
        preload(home.fileName);
        return [
          ...scripts,
          ...Array.from(home.viteMetadata.importedCss, file => ({
            tag: "link", injectTo: "head", attrs: { rel: "stylesheet", crossorigin: "", href: "./" + file },
          })),
        ];
      },
    },
    ocrProductionPlugin(),
    UnoCSS(),
    vue(),
    AutoImport({
      imports: ["vue"],
      dirs: ["src/composables"],
      dts: "src/auto-imports.d.ts",
      exclude: [/[\\/]node_modules[\\/]/, /[\\/]\.git[\\/]/, /[\\/]dist[\\/]/],
    }),
    Components({
      dirs: ["src/components"],
      extensions: ["vue"],
      deep: true,
      resolvers: [RekaResolver()],
      dts: "src/components.d.ts",
      exclude: [/[\\/]node_modules[\\/]/, /[\\/]\.git[\\/]/, /[\\/]dist[\\/]/],
    }),
  ],
  server: {
    port: 5173,
    open: true,
    proxy: {
      // PaddleOCR 官方异步 API 不带 CORS 头，浏览器开发期经本代理同源转发；
      // 打包后的桌面端走 Rust 侧请求（lib.rs http_request），不经此代理。
      "/vl-api": {
        target: "https://paddleocr.aistudio-app.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/vl-api/, ""),
      },
    },
  },
  build: {
    // 显式要求构建前清空输出目录，防止旧 chunk 持续累积进 Tauri 打包产物。
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");
          // 表格和首页共享 Vue，将运行时单独归组以保持表格按需加载。
          if (/\/node_modules\/(?:vue|@vue)\//.test(normalizedId)) return "vue-runtime";
          if (normalizedId.includes("commonjsHelpers.js")) return "commonjs-runtime";
          // 拆开 PDF 解析预览（pdfjs-dist）与 PDF 生成编辑（pdf-lib），避免互相拖累按需加载。
          if (normalizedId.includes("/node_modules/pdfjs-dist/")) return "vendor-pdfjs";
          if (/\/node_modules\/(?:pdf-lib|@pdf-lib)\//.test(normalizedId)) return "vendor-pdf-lib";
          if (normalizedId.includes("/node_modules/xlsx/")) return "vendor-xlsx";
          if (normalizedId.includes("/node_modules/vxe-")) return "vendor-table";
          if (normalizedId.includes("/node_modules/@paddlejs")) return "vendor-ocr";
        },
      },
    },
  },
  optimizeDeps: {
    // 这些库体积大或含 worker，交给 Vite 预构建
    include: ["pdfjs-dist", "pdf-lib", "xlsx", "@paddlejs-models/ocr"],
    esbuildOptions: { plugins: [ocrPrebundlePlugin()] },
  },
});
