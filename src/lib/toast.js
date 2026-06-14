// 轻量全局 toast：一次性的“操作结果/状态”用它短暂提示，自动消失，
// 不再常驻在固定操作区（issue #4）。
import { reactive } from "vue";

let seq = 0;
export const toastState = reactive({ items: [] });

// type: success | error | info | warn ；duration<=0 表示不自动消失（需手动关）
export function toast(message, opts = {}) {
  const { type = "success", duration = 4200 } = opts;
  const id = ++seq;
  toastState.items.push({ id, message: String(message ?? ""), type });
  if (duration > 0) setTimeout(() => dismissToast(id), duration);
  return id;
}

export const toastSuccess = (m, o) => toast(m, { type: "success", ...o });
export const toastError = (m, o) => toast(m, { type: "error", duration: 6000, ...o });
export const toastInfo = (m, o) => toast(m, { type: "info", ...o });
export const toastWarn = (m, o) => toast(m, { type: "warn", duration: 5200, ...o });

export function dismissToast(id) {
  const i = toastState.items.findIndex((t) => t.id === id);
  if (i >= 0) toastState.items.splice(i, 1);
}
