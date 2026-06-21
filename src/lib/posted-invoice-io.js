// 已入账发票持久化的读写抽象（后端首步）。
// 打包桌面端走 Rust SQLite（posted_invoice_*，appData/songhuodan.db）；
// dev 浏览器走 vite 中间件 /posted-invoices（写项目内 已入账发票/，gitignore）。
// 这层是「日后迁服务端」的接缝：换后端时只改这三个函数的实现，invoiceStore 不动。
import { isTauri, invoke } from "./tauri";

export async function loadPostedInvoicesData() {
  if (isTauri()) {
    try { return JSON.parse(await invoke("posted_invoice_load_all")); } catch (e) { return []; }
  }
  try {
    const r = await fetch("/posted-invoices");
    if (r.ok) return await r.json();
  } catch (e) { /* 中间件未就绪 */ }
  return [];
}

export async function savePostedInvoiceData(body) {
  const json = JSON.stringify(body);
  if (isTauri()) {
    try { await invoke("posted_invoice_save", { json }); return true; } catch (e) { return false; }
  }
  try {
    const r = await fetch("/posted-invoices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: json,
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

export async function deletePostedInvoiceData(id) {
  if (isTauri()) {
    try { await invoke("posted_invoice_delete", { id }); return true; } catch (e) { return false; }
  }
  try {
    const r = await fetch(`/posted-invoices?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    return r.ok;
  } catch (e) {
    return false;
  }
}
