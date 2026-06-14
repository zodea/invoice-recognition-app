// PaddleOCR.js 封装。模型已随应用本地化（public/ocr-models/，det+rec 共约12MB），
// 运行时不再访问百度 BOS——彻底避免联网依赖和 CDN 的 CORS 缓存投毒
// （BOS 不按 Origin 区分缓存，别的端口请求过后会缓存住错误的
//   Access-Control-Allow-Origin，导致本端口全部 Failed to fetch）。
//
// 注意：该库是 webpack + Emscripten(OpenCV) 打包，模块体里引用了全局 `Module`，
// 直接静态 import 会在严格 ESM 下抛 "Module is not defined" 并拖垮整个应用。
// 所以这里"点识别时才动态加载"，并在加载前补上 Module 全局垫片（index.html）。
//
// 该库还有一个坑：模型加载失败时 init() 的 Promise 永远不落定（fetch 异常被吞），
// UI 会卡死在"识别中…"。这里所有外部调用都包超时，超时即报可读错误并允许重试。

let ocrMod = null;
let initPromise = null;
let initialized = false;

const INIT_TIMEOUT_MS = 90000; // 本地模型加载通常 <5s；留余量给低配机器首次编译 WebGL
const RECOGNIZE_TIMEOUT_MS = 90000; // 单页识别上限（大图慢机兜底）

export function ocrReady() {
  return initialized;
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally?.(() => clearTimeout(timer)) ?? promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

async function loadLib() {
  if (ocrMod) return ocrMod;
  if (typeof globalThis.Module === "undefined") globalThis.Module = {};
  ocrMod = await import("@paddlejs-models/ocr");
  return ocrMod;
}

function modelBase() {
  const base = (import.meta.env && import.meta.env.BASE_URL) || "/";
  // paddlejs 的 modelPath 需要绝对 URL；本地路径拼上当前页面源
  const origin = typeof location !== "undefined" ? location.origin : "";
  return `${origin}${base}ocr-models`;
}

export function initOcr(onProgress) {
  if (!initPromise) {
    if (onProgress) onProgress("正在加载 OCR 模型（本地内置，无需联网）…");
    initPromise = (async () => {
      const m = await loadLib();
      const base = modelBase();
      // init(det模型路径, rec模型路径)：字符串，须以 model.json 结尾
      await withTimeout(
        m.init(`${base}/det/model.json`, `${base}/rec/model.json`),
        INIT_TIMEOUT_MS,
        "OCR 模型加载超时。请确认应用文件完整（public/ocr-models/），或重启应用后重试。"
      );
      initialized = true;
    })().catch((err) => {
      initPromise = null; // 允许重试
      const msg = String((err && err.message) || err);
      throw new Error(/超时|timeout/i.test(msg) ? msg : `OCR 模型加载失败：${msg}（模型已内置本地，一般无需联网；若持续失败请重启应用）`);
    });
  }
  return initPromise;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败（页图可能已被释放，请重新打开文件）"));
    img.src = src;
  });
}

// 兼容不同返回结构，统一取出文本行数组。
function extractLines(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res.map(String);
  if (Array.isArray(res.text)) return res.text.map(String);
  if (Array.isArray(res.words)) return res.words.map((w) => (typeof w === "string" ? w : w.text || ""));
  return [];
}

// 识别一张页图（dataUrl/objectURL），返回文本行数组。
export async function recognizeDataUrl(dataUrl, onProgress) {
  await initOcr(onProgress);
  const img = await loadImage(dataUrl);
  const res = await withTimeout(
    ocrMod.recognize(img),
    RECOGNIZE_TIMEOUT_MS,
    "单页识别超时（图片过大或显卡过慢）。可压缩/重扫该页后重试。"
  );
  return extractLines(res).filter((s) => s && s.trim());
}

// 识别多页，合并所有文本行。单页失败不拖垮整份：记录页号继续，最后统一抛出汇总错误
// （若所有页都失败）或附加警告（部分失败时仍返回已识别文本，并在 warnings 里说明）。
export async function recognizePages(pages, onProgress) {
  const all = [];
  const failed = [];
  for (let i = 0; i < pages.length; i++) {
    if (onProgress) onProgress(`识别第 ${i + 1}/${pages.length} 页…`);
    try {
      const lines = await recognizeDataUrl(pages[i].dataUrl);
      all.push(...lines);
    } catch (e) {
      failed.push({ page: i + 1, reason: String((e && e.message) || e) });
      // 模型没初始化成功时，后续页必然同样失败，直接中断
      if (!initialized) throw e;
    }
  }
  if (failed.length && all.length === 0) {
    throw new Error(failed.map((f) => `第${f.page}页：${f.reason}`).join("；"));
  }
  recognizePages.lastFailedPages = failed; // 部分失败：调用方可读取并提示
  return all;
}
