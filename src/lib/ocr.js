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

import { ocrTextRegions } from './recognition-regions.js';

let ocrMod = null;
let initPromise = null;
let initialized = false;

const INIT_TIMEOUT_MS = 90000; // 本地模型加载通常 <5s；留余量给低配机器首次编译 WebGL
const RECOGNIZE_TIMEOUT_MS = 90000; // 单页识别上限（大图慢机兜底）

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
  const base = import.meta.env?.BASE_URL || '/';
  return new URL(`${base}ocr-models`, location.href).href;
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
      const error = new Error(/超时|timeout/i.test(msg) ? msg : `OCR 模型加载失败：${msg}（模型已内置本地，一般无需联网；若持续失败请重启应用）`);
      error.name = 'OcrInitializationError';
      throw error;
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

export function downscaleImageForOcr(source, maxEdge = 1600) {
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  const ratio = maxEdge / Math.max(width, height);
  if (!width || !height || ratio >= 1) return source;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Paddle 1.2.4 的检测器和 OpenCV 裁剪共用内部画布，所有入口逐次推理。
let inferenceQueue = Promise.resolve();
function recognizeSource(source, onRegions) {
  const run = inferenceQueue.then(async () => {
    await initOcr();
    if (source instanceof HTMLCanvasElement) {
      // 检测器按 HTMLImageElement 的尺寸属性将检测框映回输入坐标。
      source.naturalWidth = source.width;
      source.naturalHeight = source.height;
    }
    const result = await withTimeout(ocrMod.recognize(source), RECOGNIZE_TIMEOUT_MS,
      '单页识别超时（图片过大或显卡过慢）。可压缩/重扫该页后重试。');
    onRegions?.(ocrTextRegions(result, source.naturalWidth, source.naturalHeight));
    return extractLines(result).filter(line => line && line.trim());
  });
  inferenceQueue = run.catch(() => {});
  return run;
}

async function recognizeDataUrl(dataUrl, onRegions) {
  const image = await loadImage(dataUrl);
  const input = downscaleImageForOcr(image);
  try {
    if (input !== image) image.removeAttribute('src');
    return await recognizeSource(input, onRegions);
  } finally {
    if (input !== image) input.width = input.height = 0;
    image.removeAttribute('src');
  }
}

export async function recognizePageRegion(page, crop, onPageRegions) {
  const image = await loadImage(page.dataUrl);
  const left = Math.floor(crop.x * image.naturalWidth);
  const top = Math.floor(crop.y * image.naturalHeight);
  const width = Math.ceil((crop.x + crop.width) * image.naturalWidth) - left;
  const height = Math.ceil((crop.y + crop.height) * image.naturalHeight) - top;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(image, left, top, width, height, 0, 0, width, height);
    return await recognizeSource(canvas, onPageRegions && (regions => onPageRegions(regions.map(region => ({
      ...region,
      x: (left + region.x * width) / image.naturalWidth,
      y: (top + region.y * height) / image.naturalHeight,
      width: region.width * width / image.naturalWidth,
      height: region.height * height / image.naturalHeight,
      page: page.pageIndex ?? 0,
    })))));
  } finally {
    canvas.width = canvas.height = 0;
    image.removeAttribute('src');
  }
}

// 识别多页，合并所有文本行。单页失败不拖垮整份：记录页号继续，最后统一抛出汇总错误
// （若所有页都失败）或附加警告（部分失败时仍返回已识别文本，并在 warnings 里说明）。
export async function recognizePages(pages, onProgress, { onPageRegions } = {}) {
  const all = [];
  const failed = [];
  for (let i = 0; i < pages.length; i++) {
    if (onProgress) onProgress(`识别第 ${i + 1}/${pages.length} 页…`);
    try {
      const lines = await recognizeDataUrl(pages[i].dataUrl, onPageRegions ? regions => onPageRegions(regions.map(region => ({ ...region, page: pages[i].pageIndex ?? i }))) : undefined);
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

export function yieldToBackground() {
  if (globalThis.scheduler?.postTask) return globalThis.scheduler.postTask(() => {}, { priority: 'background' });
  return new Promise(resolve => {
    if (globalThis.requestIdleCallback) globalThis.requestIdleCallback(resolve, { timeout: 300 });
    else setTimeout(resolve, 0);
  });
}
