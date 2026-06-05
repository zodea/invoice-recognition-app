// PDF / 图片处理。
//
// 关键设计：扫描仪（Sharp 等）输出的是“图片型 PDF”，每页就是一张内嵌 JPEG。
// 我们直接把这些 JPEG 抽出来用于预览 + OCR（无损、原图），不依赖 pdf.js 渲染
// （pdf.js 的 worker 渲染在 Vite 里会卡死，而且对扫描件来说抽图更直接）。
// 电子发票那种“文字型 PDF”没有内嵌图，预览/识别走 pdftext.js 抽文字。
// 导出 / 批量打印用 pdf-lib 把原件页/图片重新封装、合并、排版。
import { PDFDocument } from "pdf-lib";

export function isPdf(file) {
  return (file.type || "") === "application/pdf" || /\.pdf$/i.test(file.name || "");
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

function imageDims(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = src;
  });
}

// —— 在 PDF 二进制里查找内嵌 JPEG 流（移植自命令行版 extract_pdf_images）——
const enc = new TextEncoder();
const STREAM = enc.encode("stream");
const ENDSTREAM = enc.encode("endstream");

function indexOf(buf, pat, from = 0) {
  outer: for (let i = from; i <= buf.length - pat.length; i++) {
    for (let j = 0; j < pat.length; j++) if (buf[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}

// FlateDecode = zlib（RFC1950），用浏览器自带 DecompressionStream 解压。
async function inflateMaybe(bytes) {
  for (const fmt of ["deflate", "deflate-raw"]) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(fmt));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) {
      /* 换一种格式再试 */
    }
  }
  return null;
}

export async function extractJpegStreams(buf) {
  const jpegs = [];
  const dec = new TextDecoder("latin1");
  let pos = 0;
  while ((pos = indexOf(buf, STREAM, pos)) !== -1) {
    const pre = dec.decode(buf.subarray(Math.max(0, pos - 1500), pos));
    let start = pos + 6;
    if (buf[start] === 13 && buf[start + 1] === 10) start += 2;
    else if (buf[start] === 10 || buf[start] === 13) start += 1;

    const end = indexOf(buf, ENDSTREAM, start);
    if (end < 0) break;

    let data = buf.subarray(start, end);
    while (data.length && (data[data.length - 1] === 10 || data[data.length - 1] === 13)) {
      data = data.subarray(0, data.length - 1);
    }

    const looksJpeg = data[0] === 0xff && data[1] === 0xd8;
    if (pre.includes("/DCTDecode") || looksJpeg) {
      if (pre.includes("/FlateDecode") && !looksJpeg) {
        const inflated = await inflateMaybe(data);
        if (inflated) data = inflated;
      }
      if (data[0] === 0xff && data[1] === 0xd8) jpegs.push(data.slice());
    }
    pos = end + 9;
  }
  return jpegs;
}

// 把一个 PDF 或图片渲染成页图数组：[{ dataUrl, width, height }]。
// PDF 走“抽内嵌 JPEG”；抽不到（文字型/非扫描件）则 pages 为空、unsupported=true。
export async function renderFileToPages(file, { maxPages = 60 } = {}) {
  if (isPdf(file)) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const jpegs = (await extractJpegStreams(buf)).slice(0, maxPages);
    const pages = [];
    for (const j of jpegs) {
      const url = URL.createObjectURL(new Blob([j], { type: "image/jpeg" }));
      const dim = await imageDims(url);
      pages.push({ dataUrl: url, width: dim.w, height: dim.h });
    }
    return { kind: "pdf", pages, unsupported: pages.length === 0 };
  }
  const dataUrl = await blobToDataUrl(file);
  const dim = await imageDims(dataUrl);
  return { kind: "image", pages: [{ dataUrl, width: dim.w, height: dim.h }] };
}

async function dataUrlToPngBytes(dataUrl) {
  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d").drawImage(img, 0, 0);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

// 把若干文件（保持原件）拼成一个 PDF；多份即“合并”。返回 Uint8Array。
export async function buildPdfFromFiles(files) {
  const out = await PDFDocument.create();
  for (const f of files) {
    const blob = f.blob;
    const type = blob.type || "";
    if (isPdf(f)) {
      const src = await PDFDocument.load(await blob.arrayBuffer());
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach((p) => out.addPage(p));
    } else if (/png/i.test(type)) {
      const img = await out.embedPng(await blob.arrayBuffer());
      const page = out.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else if (/jpe?g/i.test(type)) {
      const img = await out.embedJpg(await blob.arrayBuffer());
      const page = out.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else {
      const png = await dataUrlToPngBytes(f.pages[0].dataUrl);
      const img = await out.embedPng(png);
      const page = out.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
  }
  return await out.save();
}
