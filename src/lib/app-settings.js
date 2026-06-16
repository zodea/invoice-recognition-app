// 应用设置：本地持久化（localStorage）。当前只有 PaddleOCR-VL 云识别的接入配置。
// 注意：token 属于凭证，只存本机 localStorage，绝不写进代码仓库。
import { reactive } from "vue";

const KEY = "appSettings.v1";

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return {};
}

export const appSettings = reactive({
  vlApiUrl: "", // 形如 https://paddleocr.aistudio-app.com/api/v2/ocr/jobs
  vlToken: "",
  hoverZoom: true, // 预览图鼠标悬停放大镜（issue #12），默认开
  localOcrAck: false, // 已选"仍用本地识别"，不再弹 OCR 拦截弹窗（issue #13）；提示条照常显示
  ...load(),
});

export function saveAppSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ vlApiUrl: appSettings.vlApiUrl, vlToken: appSettings.vlToken, hoverZoom: appSettings.hoverZoom, localOcrAck: appSettings.localOcrAck }));
  } catch (e) { /* ignore */ }
}

// 记住"仍用本地识别"，以后不再弹拦截弹窗（issue #13）。
export function ackLocalOcr() {
  appSettings.localOcrAck = true;
  saveAppSettings();
}

export function vlConfigured() {
  return Boolean((appSettings.vlApiUrl || "").startsWith("http") && appSettings.vlToken);
}
