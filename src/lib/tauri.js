// Tauri 环境判定 + 命令调用的小封装（dev 浏览器走中间件/HTTP，打包桌面端走 Rust 命令）。
export function isTauri() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

export async function invoke(cmd, args) {
  const m = await import("@tauri-apps/api/core");
  return m.invoke(cmd, args);
}

// File/Blob → base64（不含 data: 前缀），供 Rust 命令接收。
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result);
      resolve(s.slice(s.indexOf("base64,") + 7));
    };
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}
