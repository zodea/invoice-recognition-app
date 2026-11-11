// 电子发票多是“文字型 PDF”，直接抽文字最准（不经过 OCR）。
// 同时提供按需高清渲染；worker 和中文字体映射使用本地静态文件。
import * as pdfjsLib from "pdfjs-dist";
import { groupPdfTextLines } from './pdf-lines.js';
import { pdfRenderScale } from './pdf-preview.js';
import { pdfTextRegions } from './recognition-regions.js';

const baseUrl = import.meta.env?.BASE_URL || '/';
pdfjsLib.GlobalWorkerOptions.workerSrc = `${baseUrl}pdf.worker.min.mjs`;

// 返回纯文本、分行结果及归一化文字坐标，区域开关直接复用坐标。
export async function extractPdfText(file, { maxPages = 10 } = {}) {
  const buf = new Uint8Array(await file.arrayBuffer());
  // cMapUrl/cMapPacked：CID 字体的电子发票需要 cmap 才能抽出中文（cmaps 放在 public/）。
  const pdf = await pdfjsLib.getDocument({
    data: buf,
    cMapUrl: `${baseUrl}cmaps/`,
    cMapPacked: true,
  }).promise;
  try {
    const pages = [];
    const all = [];
    const regions = [];
    const numPages = pdf.numPages; // 供调用方复用，省一次 pdf-lib 解析
    for (let i = 1; i <= Math.min(numPages, maxPages); i++) {
      const page = await pdf.getPage(i);
      try {
        const content = await page.getTextContent();
        const lines = groupPdfTextLines(content.items);
        regions.push(...pdfTextRegions(content, page.getViewport({ scale: 1, rotation: 0 }), i - 1));
        pages.push({ lines });
        all.push(lines.map(line => line.text).join('\n'));
      } finally {
        page.cleanup();
      }
    }
    return { text: all.join('\n'), pages, numPages, regions };
  } finally {
    await pdf.destroy();
  }
}

// 把 PDF 每页渲染成图片 dataURL，用于左侧"打印排版"预览——效果与导出的打印 PDF 一致。
// 历史上本环境对"合成 PNG-PDF"的 render 会卡死，但真实电子发票可正常渲染；这里每页加
// 超时兜底（卡住则 cancel 该页并占位），失败页返回 null，调用方据此回退到信息卡片。
// 批量预览、高清查看和 OCR 分别传入所需分辨率；导出打印 PDF 仍使用原文件。
// canvas → 对象 URL（比 toDataURL 的 base64 编码更快、内存更省）。失败回退 null。
function canvasToObjectURL(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), 'image/png');
  });
}

// 取图片自然尺寸（用于横向自动旋转判断）。
export function imgNaturalSize(url) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => resolve({ w: 0, h: 0 });
    im.src = url;
  });
}

// 把一张图片按 deg(顺时针 0/90/180/270) 旋转，返回新的对象 URL；deg=0 原样返回。
export async function rotateImageUrl(url, deg = 0) {
  const r = ((deg % 360) + 360) % 360;
  if (!url || r === 0) return url;
  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement("canvas");
  const swap = r === 90 || r === 270;
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((r * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2);
  return await new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : url), 'image/png');
  });
}

export async function renderPdfPages(file, { scale = 2, firstPage = 1, maxPages = 10, timeoutMs = 12000, rotation = 0, targetWidth = 0, maxPixels = 16000000 } = {}) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({
    data: buf,
    cMapUrl: `${baseUrl}cmaps/`,
    cMapPacked: true,
  }).promise;
  const out = [];
  try {
    const start = Math.max(1, Math.floor(firstPage));
    for (let i = start; i <= Math.min(pdf.numPages, start + maxPages - 1); i++) {
      let page, canvas, timer;
      try {
        page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1, rotation });
        const viewport = page.getViewport({ scale: pdfRenderScale(base.width, base.height, { scale, targetWidth, maxPixels }), rotation });
        canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
        await Promise.race([
          task.promise,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              try { task.cancel(); } catch { /* 已结束的渲染无需取消 */ }
              reject(new Error('render timeout'));
            }, timeoutMs);
          }),
        ]);
        out.push(await canvasToObjectURL(canvas));
      } catch {
        out.push(null);
      } finally {
        clearTimeout(timer);
        page?.cleanup();
        if (canvas) { canvas.width = 0; canvas.height = 0; }
      }
    }
    return out;
  } finally {
    await pdf.destroy();
  }
}
