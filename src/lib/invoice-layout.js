// 发票批量打印自动排版：把多张发票（PDF 页或图片）拼到 A4 页上，
// 每页 1/2/4 张，等比缩放、居中、留白。几何来自 print-layout.js，
// 与左侧预览共用同一套槽位，保证导出 PDF 与预览一致。
import { PDFDocument, degrees } from "pdf-lib";
import { A4, planSlots, perPageCount } from "./print-layout.js";

function isPdfFile(inv) {
  return (inv.blob.type || "") === "application/pdf" || /\.pdf$/i.test(inv.name || "");
}

// 把一个尺寸 (w,h) 的页/图，按顺时针 rot 度旋转后等比放进槽位 s，居中。
// pdf-lib 的 rotate 为逆时针正，故用 degrees(-rot)；x/y 为旋转后让可见框左下角落在居中位置。
function placeRotated(d, s, rot) {
  const W = d.w;
  const H = d.h;
  const swap = rot === 90 || rot === 270;
  const rw = swap ? H : W; // 旋转后未缩放宽
  const rh = swap ? W : H; // 旋转后未缩放高
  const scale = Math.min(s.wPt / rw, s.hPt / rh);
  const sw = W * scale;
  const sh = H * scale;
  const bx = s.xPt + (s.wPt - rw * scale) / 2;
  const by = s.yPt + (s.hPt - rh * scale) / 2;
  let x = bx;
  let y = by;
  if (rot === 90) { y = by + sw; }
  else if (rot === 180) { x = bx + sw; y = by + sh; }
  else if (rot === 270) { x = bx + sh; }
  return { x, y, width: sw, height: sh, rotate: degrees(-rot) };
}

// invoices: [{ name, blob, rotation }]，已是要打印的子集、且已排好序
// 返回打印版 PDF 的 Uint8Array
export async function buildPrintLayout(invoices, { perPage = 2, margin = 18, gap = 12 } = {}) {
  const out = await PDFDocument.create();

  // 收集所有“可绘制单元”（发票通常 1 页，但也支持多页）。
  // 单份发票嵌入失败不影响整批，跳过并记录。rot 取自该发票的方向设置。
  const drawables = [];
  const skipped = [];
  for (const inv of invoices) {
    const rot = (((inv.rotation || 0) % 360) + 360) % 360;
    try {
      const bytes = new Uint8Array(await inv.blob.arrayBuffer());
      if (isPdfFile(inv)) {
        const src = await PDFDocument.load(bytes);
        const eps = await out.embedPdf(src, src.getPageIndices());
        for (const ep of eps) drawables.push({ w: ep.width, h: ep.height, type: "page", ep, rot });
      } else {
        const t = inv.blob.type || "";
        const img = /png/i.test(t) ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        drawables.push({ w: img.width, h: img.height, type: "img", img, rot });
      }
    } catch (e) {
      skipped.push(inv.name || "(未命名)");
      console.warn("批量打印：跳过无法嵌入的发票", inv.name, (e && e.message) || e);
    }
  }
  buildPrintLayout.lastSkipped = skipped;

  const slots = planSlots(perPage, { margin, gap });
  const per = perPageCount(perPage);

  let page = null;
  drawables.forEach((d, i) => {
    const slotIdx = i % per;
    if (slotIdx === 0) page = out.addPage([A4.w, A4.h]);
    const opts = placeRotated(d, slots[slotIdx], d.rot || 0);
    if (d.type === "page") page.drawPage(d.ep, opts);
    else page.drawImage(d.img, opts);
  });

  if (!drawables.length) out.addPage([A4.w, A4.h]); // 避免空文档报错
  return out.save();
}

export function pdfBlobUrl(bytes) {
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

// 直接把“打印排版 PDF”送进系统打印对话框：用隐藏 iframe 载入 PDF blob，加载完成后
// 调用 contentWindow.print()。这样点“打印”出来的就是排版本身，而不是页面文字。
// Tauri WebView2 / Chrome / Edge 都支持；个别环境失败则回退到新标签页（手动 Ctrl+P）。
export function openForPrint(bytes) {
  const url = pdfBlobUrl(bytes);
  const cleanup = (frame) => {
    setTimeout(() => {
      if (frame && frame.parentNode) frame.remove();
      URL.revokeObjectURL(url);
    }, 60000);
  };
  try {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", visibility: "hidden" });
    iframe.src = url;
    iframe.onload = () => {
      // PDF 插件渲染是异步的，稍等再触发打印更稳
      setTimeout(() => {
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } catch (e) {
          window.open(url, "_blank");
        }
        cleanup(iframe);
      }, 400);
    };
    iframe.onerror = () => {
      window.open(url, "_blank");
      cleanup(iframe);
    };
    document.body.appendChild(iframe);
  } catch (e) {
    window.open(url, "_blank");
    cleanup(null);
  }
}

export function downloadBytes(bytes, name, mime = "application/pdf") {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}
