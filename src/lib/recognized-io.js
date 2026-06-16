// 识别明细库的读写（issue #14 / ADR-0003）。
// 打包桌面端走 Rust（recognized_load_all / recognized_save，写 appData/识别明细库/）；
// dev 浏览器走 vite 中间件 /recognized（写项目内 识别明细库/，gitignore）。
import { isTauri, invoke } from "./tauri";

export async function loadAllRecognized() {
  if (isTauri()) {
    try { return JSON.parse(await invoke("recognized_load_all")); } catch (e) { return {}; }
  }
  try {
    const r = await fetch("/recognized");
    if (r.ok) return await r.json(); // { 工地: records[] }
  } catch (e) { /* 中间件不可用 → 空库 */ }
  return {};
}

export async function saveSiteRecognized(site, records) {
  const json = JSON.stringify({ site, version: 1, records: records || [] });
  if (isTauri()) {
    try { await invoke("recognized_save", { site, json }); return true; } catch (e) { return false; }
  }
  try {
    const r = await fetch(`/recognized?site=${encodeURIComponent(site)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: json,
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}
