import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";

// 本地运行用。OCR 用 WebGL，导出用 File System Access API，
// 需在 Chrome / Edge 里以 http://localhost 打开（不是 file://）。
export default defineConfig({
  base: "./",
  plugins: [UnoCSS(), vue()],
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
  optimizeDeps: {
    // 这些库体积大或含 worker，交给 Vite 预构建
    include: ["pdfjs-dist", "pdf-lib", "xlsx"],
  },
});
