// 识别明细库的浏览器侧读写（issue #14 / ADR-0003）。
// dev 走 vite 中间件 /recognized（写到项目内 识别明细库/<工地>.json）；打包桌面端待接 Rust（同 ADR-0002/0003）。
export async function loadAllRecognized() {
  try {
    const r = await fetch("/recognized");
    if (r.ok) return await r.json(); // { 工地: records[] }
  } catch (e) { /* 中间件不可用（如打包端未接 Rust）→ 视作空库 */ }
  return {};
}

export async function saveSiteRecognized(site, records) {
  try {
    const r = await fetch(`/recognized?site=${encodeURIComponent(site)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site, version: 1, records: records || [] }),
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}
