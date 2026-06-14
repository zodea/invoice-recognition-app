// 打开外部链接：Tauri 桌面端走 open_external 命令（系统默认浏览器），
// 浏览器端直接 window.open。仅用于 http/https。
function isTauri() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

export async function openExternal(url) {
  const u = String(url || "");
  if (!/^https?:\/\//i.test(u)) throw new Error("仅支持打开 http/https 链接");
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_external", { url: u });
    return;
  }
  window.open(u, "_blank", "noopener");
}
