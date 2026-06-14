import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";

// 开发期：把云识别「下载结果」这一步在 Node 侧代取。结果文件在百度对象存储(bcebos)，
// 浏览器直连会被 CORS 拦；Node 端 fetch 无此限制。仅 dev 生效；打包后的桌面端走 Rust(vl_get_text)。
function vlResultProxy() {
  return {
    name: "vl-result-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith("/vl-result")) return next();
        const u = new URL(req.url, "http://localhost").searchParams.get("u");
        let host = "";
        try { host = new URL(u).host; } catch { /* invalid */ }
        if (!u || !/(\.bcebos\.com|aistudio-app\.com|\.baidu\.com)$/.test(host)) {
          res.statusCode = 400;
          res.end("bad or disallowed url");
          return;
        }
        fetch(u)
          .then(async (r) => {
            res.statusCode = r.status;
            res.setHeader("content-type", r.headers.get("content-type") || "application/octet-stream");
            res.end(Buffer.from(await r.arrayBuffer()));
          })
          .catch((e) => {
            res.statusCode = 502;
            res.end(String((e && e.message) || e));
          });
      });
    },
  };
}

// 本地运行用。OCR 用 WebGL，导出用 File System Access API，
// 需在 Chrome / Edge 里以 http://localhost 打开（不是 file://）。
export default defineConfig({
  base: "./",
  plugins: [UnoCSS(), vue(), vlResultProxy()],
  server: {
    port: 5173,
    open: true,
    proxy: {
      // PaddleOCR 官方异步 API 不带 CORS 头，浏览器开发期经本代理同源转发；
      // 打包后的桌面端走 Rust 侧请求（lib.rs vl_*），不经此代理。
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
