// PaddleOCR 官方异步 API（飞桨星河 paddleocr.aistudio-app.com）调用 PaddleOCR-VL-1.6。
// 协议（与官方 @paddleocr/api-sdk 一致，SDK 仅支持 Node 的 filePath，浏览器侧按同协议手写）：
//   提交：POST {base}/api/v2/ocr/jobs   multipart/form-data:
//         model=PaddleOCR-VL-1.6, optionalPayload=JSON(options), file=<blob>
//         头：Authorization: Bearer <token>
//   响应：提交/轮询外层为 { code, msg, data }，data 内含 jobId/state/resultUrl/extractProgress。
//   结果：state=done → fetch resultUrl.jsonUrl；内容可能是单个 JSON，也可能是 JSONL：
//         { result: { layoutParsingResults: [{ markdown:{text} … }] } }
//
// CORS：该 API 不带跨域头。浏览器开发期走 vite 代理 /vl-api（见 vite.config.js）；
// 打包桌面端走 Rust 侧请求（lib.rs vl_* 命令）。
import { appSettings, vlConfigured } from "./app-settings.js";

const JOBS_PATH = "/api/v2/ocr/jobs";
const SUBMIT_TIMEOUT_MS = 60000;
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_MS = 300000; // VL 高峰期会排队，放宽到 5 分钟

export { vlConfigured };

function isTauri() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

// 用户可能把完整 jobs 地址或裸域名贴进设置，这里归一出 API 基址（origin）。
export function vlApiOrigin() {
  try {
    return new URL(appSettings.vlApiUrl.trim()).origin;
  } catch (e) {
    return "";
  }
}

function browserBase() {
  // 浏览器（vite dev）：走同源代理；代理目标固定为官方域名（vite.config.js）。
  return "/vl-api";
}

function authHeaders() {
  // 官方示例使用小写 bearer；服务端当前也兼容 Bearer，这里贴近示例。
  return { Authorization: `bearer ${appSettings.vlToken.trim()}` };
}

async function tauriInvoke(cmd, args) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args);
}

async function blobToBase64(blob) {
  const fr = new FileReader();
  return await new Promise((resolve, reject) => {
    fr.onload = () => {
      const s = String(fr.result);
      resolve(s.slice(s.indexOf("base64,") + 7));
    };
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

export function unwrapVlEnvelope(json) {
  // 官方 job API 外层为 data；结果文件外层为 result。两种都兼容。
  if (!json || typeof json !== "object") return json;
  if (json.result && typeof json.result === "object") return json.result;
  if (json.data && typeof json.data === "object") return json.data;
  return json;
}

function mergeResultPieces(pieces) {
  const merged = { layoutParsingResults: [] };
  for (const raw of pieces) {
    const piece = unwrapVlEnvelope(raw);
    if (!piece || typeof piece !== "object") continue;
    if (Array.isArray(piece.layoutParsingResults)) merged.layoutParsingResults.push(...piece.layoutParsingResults);
    if (piece.dataInfo && !merged.dataInfo) merged.dataInfo = piece.dataInfo;
    if (piece.preprocessedImages && !merged.preprocessedImages) merged.preprocessedImages = piece.preprocessedImages;
  }
  return merged;
}

export function parseVlResultText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return { layoutParsingResults: [] };
  try {
    return unwrapVlEnvelope(JSON.parse(trimmed));
  } catch (e) {
    const pieces = [];
    for (const line of trimmed.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      pieces.push(JSON.parse(s));
    }
    return mergeResultPieces(pieces);
  }
}

async function fetchWithTimeout(url, init, ms, what) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error(`${what}超时（${Math.round(ms / 1000)}秒）。`);
    throw new Error(`${what}失败：${(e && e.message) || e}（网络/代理不可用）`);
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonOrThrow(resp, what) {
  if (resp.status === 401 || resp.status === 403) {
    throw new Error("云识别鉴权失败：访问令牌无效或过期，请到 aistudio.baidu.com 重新复制。");
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`${what}返回 ${resp.status}：${body.slice(0, 160)}`);
  }
  return await resp.json();
}

const VL_OPTIONS = {
  useDocOrientationClassify: true, // 自动转正横躺扫描件
  prettifyMarkdown: true,
};

async function submitJob(blob, filename) {
  if (isTauri()) {
    const json = await tauriInvoke("vl_submit_file", {
      baseUrl: vlApiOrigin(),
      token: appSettings.vlToken.trim(),
      model: "PaddleOCR-VL-1.6",
      optionalPayload: JSON.stringify(VL_OPTIONS),
      fileName: filename,
      fileBase64: await blobToBase64(blob),
    });
    return unwrapVlEnvelope(JSON.parse(json));
  }
  const form = new FormData();
  form.append("model", "PaddleOCR-VL-1.6");
  form.append("optionalPayload", JSON.stringify(VL_OPTIONS));
  form.append("file", blob, filename || "scan.pdf");
  const resp = await fetchWithTimeout(
    `${browserBase()}${JOBS_PATH}`,
    { method: "POST", headers: authHeaders(), body: form },
    SUBMIT_TIMEOUT_MS,
    "提交云识别任务"
  );
  return unwrapVlEnvelope(await readJsonOrThrow(resp, "提交云识别任务"));
}

async function getJobStatus(jobId) {
  if (isTauri()) {
    const json = await tauriInvoke("vl_get_json", {
      url: `${vlApiOrigin()}${JOBS_PATH}/${encodeURIComponent(jobId)}`,
      token: appSettings.vlToken.trim(),
    });
    return unwrapVlEnvelope(JSON.parse(json));
  }
  const resp = await fetchWithTimeout(
    `${browserBase()}${JOBS_PATH}/${encodeURIComponent(jobId)}`,
    { headers: authHeaders() },
    30000,
    "查询识别进度"
  );
  return unwrapVlEnvelope(await readJsonOrThrow(resp, "查询识别进度"));
}

async function fetchResultData(jsonUrl) {
  if (isTauri()) {
    const text = await tauriInvoke("vl_get_text", { url: jsonUrl });
    return parseVlResultText(text);
  }
  const resp = await fetchWithTimeout(jsonUrl, {}, 60000, "下载识别结果");
  if (!resp.ok) throw new Error(`下载识别结果失败（${resp.status}）`);
  return parseVlResultText(await resp.text());
}

// 主入口：识别一份文件（PDF/图片 blob）。onProgress(进度文字)。
// 返回 { markdownPages: string[], raw }。
export async function vlParseDocument({ blob, filename } = {}, onProgress) {
  if (!vlConfigured()) throw new Error("尚未配置云识别（设置里填 API地址 和 访问令牌）");
  if (!blob) throw new Error("没有可识别的内容");

  if (onProgress) onProgress("提交云识别任务…");
  // 免费额度高峰服务端会返回「队列已满(code 10010)」——不是账号/代码问题，退避重试几次再放弃。
  let job;
  for (let attempt = 1; ; attempt++) {
    try {
      job = await submitJob(blob, filename || blob.name || "scan");
      break;
    } catch (e) {
      const msg = String((e && e.message) || e);
      const queueFull = /队列已满|10010/.test(msg);
      if (queueFull && attempt <= 3) {
        if (onProgress) onProgress(`云端排队已满，${attempt * 4}秒后重试（第 ${attempt}/3 次）…`);
        await new Promise((r) => setTimeout(r, attempt * 4000));
        continue;
      }
      if (queueFull) throw new Error("云端排队已满，请过几分钟重试（不是账号问题，是免费额度高峰拥堵）。");
      throw e;
    }
  }
  const jobId = job && (job.jobId || job.id);
  if (!jobId) throw new Error(`云服务未返回任务ID：${JSON.stringify(job).slice(0, 120)}`);

  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (Date.now() - t0 > POLL_MAX_MS) {
      throw new Error("云识别排队超时（5分钟）。高峰期可稍后在问题弹窗里重试。");
    }
    const st = await getJobStatus(jobId);
    const state = st.state || st.status;
    if (onProgress) {
      const progress = st.extractProgress || st.progress || {};
      const prog = progress.totalPages ? `（${progress.extractedPages || 0}/${progress.totalPages} 页）` : "";
      onProgress(`云识别中：${state === "pending" ? "排队" : "解析"}${prog}…`);
    }
    if (state === "failed") throw new Error(`云识别失败：${st.errorMsg || "服务端处理出错"}`);
    if (state === "done") {
      const jsonUrl = st.resultUrl && (st.resultUrl.jsonUrl || st.resultUrl.json);
      if (!jsonUrl) throw new Error("云识别完成但缺少结果地址（resultUrl.jsonUrl）。");
      if (onProgress) onProgress("下载识别结果…");
      const data = await fetchResultData(jsonUrl);
      const results = data.layoutParsingResults || [];
      const markdownPages = results
        .map((r) => (r && r.markdown && (r.markdown.text ?? r.markdown)) || r.markdownText || "")
        .map(String)
        .filter(Boolean);
      if (!markdownPages.length) throw new Error("云识别没有返回文本内容（可能是空白页）。");
      return { markdownPages, raw: data };
    }
  }
}
