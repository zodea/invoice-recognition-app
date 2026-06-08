// 电子发票多是“文字型 PDF”，直接抽文字最准（不经过 OCR）。
// pdf.js 的 getDocument / getTextContent 在本环境是正常的（只有 page.render 会卡死），
// 所以这里只用文字抽取，不做渲染。worker 用 public/ 下的静态文件。
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

// 返回 { text, pages:[{ lines:[{str,x,y}] }] }。text 是整份拼接后的纯文本。
export async function extractPdfText(file, { maxPages = 10 } = {}) {
  const buf = new Uint8Array(await file.arrayBuffer());
  // cMapUrl/cMapPacked：CID 字体的电子发票需要 cmap 才能抽出中文（cmaps 放在 public/）。
  const pdf = await pdfjsLib.getDocument({
    data: buf,
    cMapUrl: `${import.meta.env.BASE_URL}cmaps/`,
    cMapPacked: true,
  }).promise;
  const pages = [];
  const all = [];
  const numPages = pdf.numPages; // 真实页数（供调用方复用，省一次 pdf-lib 解析）
  const n = Math.min(numPages, maxPages);
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // 按 y 分行（同一行的 item y 接近），再按 x 排序拼接
    const items = content.items
      .filter((it) => it.str != null)
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
    const lines = groupIntoLines(items);
    pages.push({ lines });
    all.push(lines.map((l) => l.text).join("\n"));
    page.cleanup();
  }
  await pdf.destroy();
  return { text: all.join("\n"), pages, numPages };
}

// 把 PDF 每页渲染成图片 dataURL，用于左侧"打印排版"预览——效果与导出的打印 PDF 一致。
// 历史上本环境对"合成 PNG-PDF"的 render 会卡死，但真实电子发票可正常渲染；这里每页加
// 超时兜底（卡住则 cancel 该页并占位），失败页返回 null，调用方据此回退到信息卡片。
// 注意：这些页图只用于左侧屏幕预览，导出打印 PDF 走 embedPdf(原文件)，与本函数无关，
// 所以 scale 可按批量大小自适应调小以提速/省内存，不影响最终打印清晰度。
// canvas → 对象 URL（比 toDataURL 的 base64 编码更快、内存更省）。失败回退 null。
function canvasToObjectURL(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), "image/jpeg", quality);
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
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : url), "image/jpeg", 0.9);
  });
}

export async function renderPdfPages(file, { scale = 1.5, maxPages = 10, timeoutMs = 12000, quality = 0.82, rotation = 0 } = {}) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({
    data: buf,
    cMapUrl: `${import.meta.env.BASE_URL}cmaps/`,
    cMapPacked: true,
  }).promise;
  const out = [];
  const n = Math.min(pdf.numPages, maxPages);
  for (let i = 1; i <= n; i++) {
    try {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale, rotation }); // rotation 顺时针，叠加在页面固有旋转上
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const task = page.render({ canvasContext: canvas.getContext("2d"), viewport });
      let timer;
      await Promise.race([
        task.promise,
        new Promise((_, rej) => {
          timer = setTimeout(() => {
            try { task.cancel(); } catch (e) { /* ignore */ }
            rej(new Error("render timeout"));
          }, timeoutMs);
        }),
      ]);
      clearTimeout(timer);
      out.push(await canvasToObjectURL(canvas, quality));
      page.cleanup();
    } catch (e) {
      out.push(null);
    }
  }
  await pdf.destroy();
  return out;
}

function groupIntoLines(items, yTol = 3) {
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    let line = lines.find((l) => Math.abs(l.y - it.y) <= yTol);
    if (!line) {
      line = { y: it.y, parts: [] };
      lines.push(line);
    }
    line.parts.push(it);
  }
  return lines.map((l) => ({
    y: l.y,
    text: l.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(" ").replace(/\s+/g, " ").trim(),
  }));
}
