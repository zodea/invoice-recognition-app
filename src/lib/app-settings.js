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
  ...load(),
});

export function saveAppSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ vlApiUrl: appSettings.vlApiUrl, vlToken: appSettings.vlToken, hoverZoom: appSettings.hoverZoom }));
  } catch (e) { /* ignore */ }
}

export function vlConfigured() {
  return Boolean((appSettings.vlApiUrl || "").startsWith("http") && appSettings.vlToken);
}
