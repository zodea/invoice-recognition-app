// 发票批量打印自动排版：把多张发票（PDF 页或图片）拼到 A4 页上，
// 每页 1/2/4 张，等比缩放、居中、留白。几何来自 print-layout.js，
// 与左侧预览共用同一套槽位，保证导出 PDF 与预览一致。
import { PDFDocument } from "pdf-lib";
import { A4, planSlots, perPageCount } from "./print-layout.js";

function isPdfFile(inv) {
  return (inv.blob.type || "") === "application/pdf" || /\.pdf$/i.test(inv.name || "");
}

// invoices: [{ name, blob }]，已是要打印的子集、且已排好序
// 返回打印版 PDF 的 Uint8Array
export async function buildPrintLayout(invoices, { perPage = 2, margin = 18, gap = 12 } = {}) {
  const out = await PDFDocument.create();

  // 收集所有“可绘制单元”（发票通常 1 页，但也支持多页）。
  // 单份发票嵌入失败不影响整批，跳过并记录。
  const drawables = [];
  const skipped = [];
  for (const inv of invoices) {
    try {
      const bytes = new Uint8Array(await inv.blob.arrayBuffer());
      if (isPdfFile(inv)) {
        const src = await PDFDocument.load(bytes);
        const eps = await out.embedPdf(src, src.getPageIndices());
        for (const ep of eps) drawables.push({ w: ep.width, h: ep.height, type: "page", ep });
      } else {
        const t = inv.blob.type || "";
        const img = /png/i.test(t) ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        drawables.push({ w: img.width, h: img.height, type: "img", img });
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
    const s = slots[slotIdx];
    const scale = Math.min(s.wPt / d.w, s.hPt / d.h);
    const w = d.w * scale;
    const h = d.h * scale;
    const x = s.xPt + (s.wPt - w) / 2;
    const y = s.yPt + (s.hPt - h) / 2;
    if (d.type === "page") page.drawPage(d.ep, { x, y, width: w, height: h });
    else page.drawImage(d.img, { x, y, width: w, height: h });
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
