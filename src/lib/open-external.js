// 打开外部链接：Tauri 桌面端走 open_external 命令（系统默认浏览器），
// 浏览器端直接 window.open。仅用于 http/https。
import { isTauri, invokeTauri } from './platform.js';

export async function openExternal(url) {
  const u = String(url || "");
  if (!/^https?:\/\//i.test(u)) throw new Error("仅支持打开 http/https 链接");
  if (isTauri()) {
    await invokeTauri("open_external", { url: u });
    return;
  }
  window.open(u, "_blank", "noopener");
}
