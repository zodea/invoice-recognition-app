import { reactive } from "vue";
import { PDFDocument } from "pdf-lib";
import { renderFileToPages, isPdf } from "./lib/pdf";
import { extractPdfText, renderPdfPages } from "./lib/pdftext";
import { recognizePages } from "./lib/ocr";
import { parseInvoice, isProbablyInvoiceText } from "./lib/invoice-parse";
import { applyInvoiceFilenameFallback } from "./lib/invoice-filename";
import { markInvoiceDuplicates } from "./lib/invoice-dedupe";
import { invoiceFolderParts } from "./lib/invoice-export-package";
import { loadLedger, saveLedger, recordInvoices, markVerified, parseVerifiedNumbers, historyStatus, importInputInvoiceWorkbookBytes } from "./lib/invoice-ledger";
import { perPageCount } from "./lib/print-layout.js";

let seq = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

function emptyFields() {
  return { code: "", number: "", date: "", dateText: "", buyer: "", seller: "", amount: "", tax: "", total: "", rate: "", type: "", taxKind: "", docType: "", remark: "" };
}

// 预览队列：按插入顺序小批量渲染，避免一次性占满 pdf.js worker。
const previewRenderQueue = [];
let previewRenderRunning = false;
// 预览页图只用于屏幕显示（导出走原文件），按批量大小自适应分辨率：
// 量大时调小，显著降低光栅化耗时与内存，肉眼预览仍清晰。
function adaptivePreviewScale() {
  const n = invoiceStore.invoices.length;
  if (n > 80) return 1.0;
  if (n > 40) return 1.2;
  if (n > 15) return 1.35;
  return 1.6;
}
async function renderInvoicePreview(inv) {
  try {
    inv.previewStatus = "running";
    if (inv.kind === "image" || !inv.isTextPdf) {
      // 图片上传 / 扫描型 PDF：内嵌 JPEG 即整页，直接复用，无需再渲染
      inv.renderedPages = inv.pages.map((p) => p.dataUrl);
    } else {
      // 电子发票（文字型 PDF）：用 pdf.js 渲染真实页面
      inv.renderedPages = await renderPdfPages(inv.blob, { scale: adaptivePreviewScale() });
    }
    inv.previewStatus = inv.renderedPages.length ? "done" : "idle";
  } catch (e) {
    inv.renderedPages = [];
    inv.previewStatus = "error";
  }
}
function queuePreviewRender(inv) {
  if (inv.previewStatus === "queued" || inv.previewStatus === "running" || inv.previewStatus === "done") return;
  inv.previewStatus = "queued";
  previewRenderQueue.push(inv);
  processPreviewQueue();
}
async function processPreviewQueue() {
  if (previewRenderRunning) return;
  previewRenderRunning = true;
  try {
    while (previewRenderQueue.length) {
      const batch = previewRenderQueue.splice(0, 3);
      await Promise.all(batch.map((inv) => renderInvoicePreview(inv)));
      await new Promise((r) => setTimeout(r, 80));
    }
  } finally {
    previewRenderRunning = false;
  }
}

// 文字层不可用时，取“整页图像”喂给 OCR：
//   电子/字体加密票 → 渲染整页（scale 2，OCR 友好清晰度，加密票渲染后视觉正常）；
//   真扫描件 → 直接用内嵌的整页 JPEG（原始分辨率）。
async function pageImagesForOcr(inv) {
  if (inv.isTextPdf) {
    try {
      const imgs = (await renderPdfPages(inv.blob, { scale: 2 })).filter(Boolean);
      if (imgs.length) return imgs;
    } catch (e) { /* 渲染失败再退到内嵌图 */ }
  }
  if (inv.pages && inv.pages.length) return inv.pages.map((p) => p.dataUrl).filter(Boolean);
  try {
    return (await renderPdfPages(inv.blob, { scale: 2 })).filter(Boolean);
  } catch (e) {
    return [];
  }
}

export const invoiceStore = reactive({
  invoices: [],
  busy: false,
  msg: "",
  perPage: 2, // 每页打印张数 1/2/4
  selectedId: "", // 左右联动选中的发票 id
  buyerFilter: "全部",
  docTypeFilter: "全部",
  groupDims: [], // 待优化#3：分目录维度（顺序即嵌套顺序），同时驱动左右两栏分组排序
  ledger: loadLedger(), // 历史发票台账（跨批次查重 + 认证状态），本地持久化
});

// 用台账刷新每张发票的历史状态（是否曾用过/已认证），供 UI 标记“历史重复/已认证”
function refreshHistory() {
  for (const inv of invoiceStore.invoices) inv.history = historyStatus(invoiceStore.ledger, inv);
}

// 只填空字段，保留人工编辑
function applyParsed(fields, parsed) {
  for (const k of Object.keys(parsed)) {
    if ((fields[k] === "" || fields[k] == null) && parsed[k] !== "" && parsed[k] != null) {
      fields[k] = parsed[k];
    }
  }
}

function applyFilenameFallback(inv) {
  const { filled } = applyInvoiceFilenameFallback(inv.fields, inv.name);
  if (filled.length) {
    inv.systemNote = inv.systemNote || "已按文件名补录，需复核";
    return true;
  }
  return false;
}

export const invoiceActions = {
  async addFiles(fileList) {
    const arr = Array.from(fileList).filter((f) => /\.(pdf|png|jpe?g|bmp|webp|gif|tiff?)$/i.test(f.name));
    for (const file of arr) {
      const inv = reactive({
        id: uid("inv"),
        name: file.name,
        blob: file,
        kind: /\.pdf$/i.test(file.name) ? "pdf" : "image",
        pages: [],
        renderedPages: [], // 左侧打印预览用的真实页图（异步填充）
        previewStatus: "idle",
        pageCount: 1,
        rendering: true,
        isTextPdf: false,
        textGarbled: false, // 文字层是乱码(字体加密)，识别走整页 OCR
        fields: emptyFields(),
        rawText: "",
        status: "idle",
        error: "",
        note: "",
        systemNote: "",
        duplicateOfId: "",
        duplicateReason: "",
        history: { usedBefore: false, verified: false, printed: false, batches: [] }, // 历史台账：是否曾用过/已认证/已打印
        include: true,
      });
      invoiceStore.invoices.push(inv);
      if (!invoiceStore.selectedId) invoiceStore.selectedId = inv.id;
      renderFileToPages(file)
        .then(async (r) => {
          inv.pages = r.pages;
          if (r.kind === "pdf") {
            // 电子发票（文字型 PDF）即便内嵌了二维码/印章小图，也会被 extractJpegStreams
            // 误当成“页图”。这里再用文字探测确认：抽得到发票文字就按电子发票处理——
            // 丢弃碎片图、预览走信息卡片、页数取真实 PDF 页数（与 embedPdf 打印一致）。
            let textPdf = r.unsupported;
            if (!textPdf) {
              try {
                const tr = await extractPdfText(file);
                const t = tr.text || "";
                const meaningful = t.replace(/\s/g, "").length;
                if (isProbablyInvoiceText(t)) {
                  textPdf = true;
                  inv.rawText = t; // 文字层可用：直接解析
                } else if (meaningful >= 40) {
                  // 有实质文字层但被字体加密成乱码（如某些电子发票）：仍按电子票处理，
                  // 预览渲染整页、识别时走“整页 OCR”兜底（不存乱码 rawText）。
                  textPdf = true;
                  inv.textGarbled = true;
                }
              } catch (e) {
                /* 抽不到文字则按扫描件处理 */
              }
            }
            if (textPdf) {
              inv.isTextPdf = true;
              inv.pages = []; // 丢弃误抽的二维码/印章碎片
              try {
                const doc = await PDFDocument.load(await file.arrayBuffer());
                inv.pageCount = doc.getPageCount();
              } catch (e) {
                inv.pageCount = 1;
              }
            } else {
              inv.pageCount = r.pages.length || 1; // 扫描型：每张内嵌 JPEG 即一页
            }
          } else {
            inv.pageCount = r.pages.length || 1;
          }
          inv.rendering = false;
          queuePreviewRender(inv); // 异步渲染左侧真实打印预览
        })
        .catch((e) => {
          inv.rendering = false;
          inv.error = String((e && e.message) || e);
        });
    }
  },

  removeInvoice(id) {
    const i = invoiceStore.invoices.findIndex((x) => x.id === id);
    if (i >= 0) invoiceStore.invoices.splice(i, 1);
    if (invoiceStore.selectedId === id) invoiceStore.selectedId = invoiceStore.invoices[0]?.id || "";
  },

  clearAll() {
    invoiceStore.invoices.splice(0);
    invoiceStore.selectedId = "";
    invoiceStore.buyerFilter = "全部";
    invoiceStore.docTypeFilter = "全部";
    invoiceStore.groupDims = [];
  },

  toggleInclude(inv) {
    inv.include = !inv.include;
  },

  refreshDuplicates() {
    return markInvoiceDuplicates(invoiceStore.invoices);
  },

  async recognizeOne(inv, { skipDedupe = false } = {}) {
    // 等待文件读取（抽图/抽文字探测）完成，避免点早了被直接跳过（点"全部识别"会静默漏掉）
    let waited = 0;
    while (inv.rendering && waited < 20000) {
      await new Promise((r) => setTimeout(r, 150));
      waited += 150;
    }
    if (inv.rendering) return;
    inv.status = "running";
    inv.error = "";
    invoiceStore.busy = true;
    try {
      let text = "";
      if (isPdf(inv)) {
        // 复用 addFiles 探测阶段已抽到的文字：省去重复解析，也避免与左侧预览渲染抢 pdf.js worker
        if (inv.isTextPdf && inv.rawText) {
          text = inv.rawText;
        } else {
          try {
            const r = await extractPdfText(inv.blob);
            text = r.text || "";
          } catch (e) {
            text = "";
          }
        }
        if (isProbablyInvoiceText(text)) {
          // 文字层可用：直接解析（最准最快）
          inv.isTextPdf = true;
          inv.rawText = text;
          applyParsed(inv.fields, parseInvoice(text));
        } else {
          // 文字层缺失(扫描件) 或 被字体加密成乱码(电子票) → 渲染整页转 OCR。
          // 加密票虽抽不到文字，但渲染出来视觉正常，OCR 能读出真实文字。
          let ocrText = "";
          try {
            const imgs = await pageImagesForOcr(inv);
            if (imgs.length) {
              invoiceStore.msg = inv.textGarbled ? "字体加密，转图像 OCR 识别…" : "OCR 识别扫描发票…";
              const lines = await recognizePages(imgs.map((d) => ({ dataUrl: d })), (m) => (invoiceStore.msg = m));
              ocrText = lines.join("\n");
            }
          } catch (e) {
            // OCR 不可用（如无法联网下载模型/无 WebGL）→ 不让整张失败，下面用文件名兜底
            inv.systemNote = "OCR 不可用，已按文件名补录，请手动核对";
          }
          if (ocrText.trim()) {
            inv.rawText = ocrText;
            applyParsed(inv.fields, parseInvoice(ocrText));
            inv.systemNote = inv.systemNote || "OCR 识别，请重点核对";
          }
          // 无论 OCR 成否，最后都会执行下方 applyFilenameFallback 补齐日期/金额等空字段
        }
      } else {
        invoiceStore.msg = "OCR 识别发票图片…";
        const lines = await recognizePages(inv.pages, (m) => (invoiceStore.msg = m));
        inv.rawText = lines.join("\n");
        applyParsed(inv.fields, parseInvoice(inv.rawText));
      }
      applyFilenameFallback(inv);
      inv.status = "done";
      // 批量识别时跳过逐张去重（O(n²)，整批结束后统一跑一次即可），大幅提速
      if (skipDedupe) {
        invoiceStore.msg = "识别完成，请核对。";
      } else {
        const duplicateCount = invoiceActions.refreshDuplicates();
        invoiceStore.msg = duplicateCount ? `识别完成，已自动排除 ${duplicateCount} 张重复发票。` : "识别完成，请核对。";
      }
      inv.history = historyStatus(invoiceStore.ledger, inv); // 历史台账查重/认证标记
    } catch (e) {
      inv.status = "error";
      inv.error = String((e && e.message) || e);
      invoiceStore.msg = "识别失败：" + inv.error;
    } finally {
      invoiceStore.busy = false;
    }
  },

  async recognizeAll() {
    for (const inv of invoiceStore.invoices) {
      if (inv.status !== "done") await invoiceActions.recognizeOne(inv, { skipDedupe: true });
    }
    const duplicateCount = invoiceActions.refreshDuplicates(); // 整批结束统一去重一次
    refreshHistory(); // 跨批次历史查重 + 认证标记
    const reused = invoiceStore.invoices.filter((i) => i.history && i.history.usedBefore).length;
    invoiceStore.msg = `全部识别完成${duplicateCount ? `，已排除 ${duplicateCount} 张本批重复` : ""}${reused ? `，⚠ ${reused} 张历史上已用过(疑似重复使用)` : ""}。`;
  },

  // —— 历史台账 / 认证查重 ——
  async importInputInvoiceReport(file) {
    if (!file) return { imported: 0, added: 0, updated: 0 };
    const bytes = await file.arrayBuffer();
    const { ledger, imported, added, updated } = importInputInvoiceWorkbookBytes(invoiceStore.ledger, bytes, { sourceName: file.name });
    invoiceStore.ledger = ledger;
    saveLedger(ledger);
    refreshHistory();
    invoiceStore.msg = `进项历史导入完成：${imported} 张，新增 ${added} 张，更新 ${updated} 张。已认证视为已打印，后续用于防重复。`;
    return { imported, added, updated };
  },
  recordToLedger(name) {
    const list = orderedForPrint().map((x) => x.inv).filter((inv) => inv.status === "done");
    const { ledger, added, repeated } = recordInvoices(invoiceStore.ledger, list, { name: name || "报销批次" });
    invoiceStore.ledger = ledger;
    saveLedger(ledger);
    refreshHistory();
    invoiceStore.msg = `已记入历史台账：新增 ${added} 张，更新 ${repeated} 张。`;
    return { added, repeated };
  },
  importVerifiedRows(rows) {
    const numbers = parseVerifiedNumbers(rows);
    const { ledger, matched, unmatched } = markVerified(invoiceStore.ledger, numbers);
    invoiceStore.ledger = ledger;
    saveLedger(ledger);
    refreshHistory();
    invoiceStore.msg = `认证清单导入：识别 ${numbers.length} 个发票号码，匹配台账 ${matched} 张，另登记 ${unmatched} 张仅认证记录。`;
    return { count: numbers.length, matched, unmatched };
  },
  refreshHistory,
};

export function invoiceSummary() {
  let amount = 0, tax = 0, total = 0, n = 0;
  for (const inv of filteredInvoices()) {
    if (!inv.include) continue;
    n++;
    amount += Number(inv.fields.amount) || 0;
    tax += Number(inv.fields.tax) || 0;
    total += Number(inv.fields.total) || 0;
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  return { count: n, amount: r2(amount), tax: r2(tax), total: r2(total) };
}

// 未识别的购买方/类型在筛选里统一归到“未识别”桶（显示留空意味，不再编造“未识别购买方”等文字）
export const UNSET_LABEL = "未识别";

export function buyerOptions() {
  const set = new Set();
  for (const inv of invoiceStore.invoices) set.add((inv.fields.buyer || "").trim() || UNSET_LABEL);
  return ["全部", ...[...set].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))];
}

export function docTypeOptions() {
  const set = new Set();
  for (const inv of invoiceStore.invoices) set.add((inv.fields.docType || inv.fields.type || "").trim() || UNSET_LABEL);
  return ["全部", ...[...set].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))];
}

export function passesInvoiceFilters(inv) {
  const buyer = (inv.fields.buyer || "").trim() || UNSET_LABEL;
  const docType = (inv.fields.docType || inv.fields.type || "").trim() || UNSET_LABEL;
  return (invoiceStore.buyerFilter === "全部" || buyer === invoiceStore.buyerFilter)
    && (invoiceStore.docTypeFilter === "全部" || docType === invoiceStore.docTypeFilter);
}

export function filteredInvoices() {
  return invoiceStore.invoices.filter((inv) => passesInvoiceFilters(inv));
}

// 选中的分目录维度下，该发票的文件夹路径（用于左右两栏分组排序与分组标签展示）
export function groupPath(inv) {
  return invoiceFolderParts(inv, invoiceStore.groupDims || []);
}

// 先按所选分目录维度（顺序）分组，再组内按开票日期升序；无日期排最后。
// 这样左右两栏顺序与“整理导出”的文件夹分类完全一致（待优化#3）。
export function sortedInvoices({ applyFilters = true } = {}) {
  const dims = invoiceStore.groupDims || [];
  const arr = invoiceStore.invoices.slice();
  arr.sort((a, b) => {
    const pa = invoiceFolderParts(a, dims);
    const pb = invoiceFolderParts(b, dims);
    for (let i = 0; i < dims.length; i++) {
      const c = (pa[i] || "").localeCompare(pb[i] || "", "zh-Hans-CN");
      if (c) return c;
    }
    const da = a.fields.date || "";
    const db = b.fields.date || "";
    if (da && db) return da.localeCompare(db) || a.id.localeCompare(b.id);
    if (da && !db) return -1;
    if (!da && db) return 1;
    return a.id.localeCompare(b.id);
  });
  return arr.map((inv, i) => ({
    inv,
    seq: i + 1,
    needsReview: !inv.fields.date || !inv.fields.total || !inv.fields.seller || !inv.fields.buyer || /需复核/.test(inv.systemNote || "") || !!inv.duplicateReason,
  })).filter((x) => !applyFilters || passesInvoiceFilters(x.inv));
}

// 仅勾选要打印的，保持排序与全局序号（序号在两侧一致，所以不重新编号）
export function orderedForPrint() {
  return sortedInvoices().filter((x) => x.inv.include);
}

// 把发票展开成“打印单元”（每页一个槽位），顺序与导出 PDF 完全一致。
export function printUnits() {
  const units = [];
  for (const { inv, seq, needsReview } of orderedForPrint()) {
    const imgs = inv.renderedPages && inv.renderedPages.length ? inv.renderedPages : null;
    const pc = inv.pageCount || (imgs ? imgs.length : 0) || inv.pages.length || 1;
    for (let k = 0; k < pc; k++) {
      units.push({
        invId: inv.id,
        inv,
        seq,
        page: k,
        pageCount: pc,
        needsReview,
        // 真实渲染页图（与导出打印 PDF 一致）；尚未渲染好/失败则为 null，预览回退信息卡片
        image: imgs && imgs[k] ? imgs[k] : null,
      });
    }
  }
  return units;
}

export function selectInvoice(id) {
  invoiceStore.selectedId = id;
}

export function perPageSlots() {
  return perPageCount(invoiceStore.perPage);
}
