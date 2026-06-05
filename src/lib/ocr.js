// PaddleOCR.js 封装。@paddlejs-models/ocr 在浏览器用 WebGL 跑 PP-OCR，
// 模型默认从百度 BOS 下载（国内可用）。首次 init 需联网且较慢。
//
// 注意：该库是 webpack + Emscripten(OpenCV) 打包，模块体里引用了全局 `Module`，
// 直接静态 import 会在严格 ESM 下抛 "Module is not defined" 并拖垮整个应用。
// 所以这里改成“点识别时才动态加载”，并在加载前补上 Module 全局垫片。

let ocrMod = null;
let initPromise = null;
let initialized = false;

export function ocrReady() {
  return initialized;
}

async function loadLib() {
  if (ocrMod) return ocrMod;
  if (typeof globalThis.Module === "undefined") globalThis.Module = {};
  ocrMod = await import("@paddlejs-models/ocr");
  return ocrMod;
}

export function initOcr(onProgress) {
  if (!initPromise) {
    if (onProgress) onProgress("正在加载 OCR 模型（首次较慢，需联网）…");
    initPromise = loadLib()
      .then((m) => m.init())
      .then(() => {
        initialized = true;
      })
      .catch((err) => {
        initPromise = null; // 允许重试
        throw err;
      });
  }
  return initPromise;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
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

// 识别一张页图（dataUrl），返回文本行数组。
export async function recognizeDataUrl(dataUrl, onProgress) {
  await initOcr(onProgress);
  const img = await loadImage(dataUrl);
  const res = await ocrMod.recognize(img);
  return extractLines(res).filter((s) => s && s.trim());
}

// 识别多页，合并所有文本行。
export async function recognizePages(pages, onProgress) {
  const all = [];
  for (let i = 0; i < pages.length; i++) {
    if (onProgress) onProgress(`识别第 ${i + 1}/${pages.length} 页…`);
    const lines = await recognizeDataUrl(pages[i].dataUrl);
    all.push(...lines);
  }
  return all;
}
