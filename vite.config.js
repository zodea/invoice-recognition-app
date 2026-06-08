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
  },
  optimizeDeps: {
    // 这些库体积大或含 worker，交给 Vite 预构建
    include: ["pdfjs-dist", "pdf-lib", "xlsx"],
  },
});
