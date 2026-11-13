import { appStorage } from './app-storage.js';
// 桌面设置存入便携数据目录；令牌随本地完整备份携带，绝不提交代码仓库。
import { reactive } from "vue";

const KEY = "appSettings.v1";

function load() {
  try {
    const raw = appStorage.getItem(KEY);
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
  appStorage.setItem(KEY, JSON.stringify({ vlApiUrl: appSettings.vlApiUrl, vlToken: appSettings.vlToken, hoverZoom: appSettings.hoverZoom }));
}

export function vlConfigured() {
  return Boolean((appSettings.vlApiUrl || "").startsWith("http") && appSettings.vlToken);
}
