import { intakeDecision, intakeFingerprint, canEnterLedger, planRecognizedInvoice, receiptType } from './lib/invoice-intake.js';
import { transferReceipt } from './lib/receipt-transfer.js';
import { fileHash, isPdf } from './lib/file-utils.js';
import { paymentStore, savePayments } from './lib/payment-store.js';
import { getLedgerAttachment, saveLedgerAttachment, saveLedgerAttachmentIfMissing, appendInvoiceSupplement } from './lib/ledger-attachments.js';
import { withProjectAllocation, isMultiProject, projectAllocationState } from './lib/invoice-allocation.js';
import { directory } from './lib/expense-directory.js';
import { planTrashPurge, persistTrashPurge, readTrashCleanupQueue, cleanupPurgedAttachments } from './lib/ledger-trash-purge.js';
import { deleteUnusedLedgerAttachments } from './lib/ledger-attachments.js';
import { loadLedgerTrash, readLedgerTrashForChange, moveLedgerToTrash, restoreLedgerFromTrash, persistLedgerTransition } from './lib/ledger-trash.js';
import { normalizeBuyerName } from './lib/invoice-buyer-check.js';
import { invoiceProblems } from "./lib/invoice-review.js";
import { reactive } from "vue";
import { PDFDocument } from "pdf-lib";
import { renderFileToPages } from "./lib/pdf";
import { extractPdfText, renderPdfPages, rotateImageUrl, imgNaturalSize } from "./lib/pdftext";
import { recognizePages } from "./lib/ocr";
import { parseInvoice, isProbablyInvoiceText } from "./lib/invoice-parse";
import { applyParsedInvoiceFields } from "./lib/invoice-fields";
import { applyInvoiceFilenameFallback } from "./lib/invoice-filename";
import { confirmedDuplicateInvoices, markInvoiceDuplicates } from "./lib/invoice-dedupe";
import { invoiceFolderParts } from "./lib/invoice-export-package";
import { loadLedger, saveLedger, recordInvoices, markVerified, parseVerifiedNumbers, historyStatus, importInputInvoiceWorkbookBytes, markPrintedInvoices, shouldDefaultExcludeByHistory, missingReimbursementFields } from "./lib/invoice-ledger";
import { importExpenseWorkbook } from "./lib/expense-import";
import { markReimbursedBatch, updateCurrentReimbursements } from "./lib/invoice-ledger";
import { inferExpenseTag } from "./lib/invoice-tags";
import { syncLedgerMatches } from "./lib/ledger-matching.js";
import {supplementType,readInvoiceSupplements,writeInvoiceSupplements,saveInvoiceSupplement,reconcileInvoiceSupplements,linkInvoiceSupplement} from './lib/invoice-supplements.js';
import {applyAssignmentReview,persistAssignmentImport} from './lib/expense-assignment-import.js';

let seq = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

function emptyFields() {
  return { code: "", number: "", date: "", dateText: "", buyer: "", seller: "", amount: "", tax: "", total: "", rate: "", type: "", taxKind: "", docType: "", remark: "" };
}

// 回收某张发票占用的对象 URL（预览页图/内嵌页图），避免删除/清空后内存泄漏。
function revokeInvoiceUrls(inv) {
  const urls = new Set();
  for (const u of inv.renderedPages || []) if (typeof u === "string" && u.startsWith("blob:")) urls.add(u);
  for (const p of inv.pages || []) if (p && typeof p.dataUrl === "string" && p.dataUrl.startsWith("blob:")) urls.add(p.dataUrl);
  for (const u of urls) URL.revokeObjectURL(u);
}

// 预览队列：按插入顺序小批量渲染，避免一次性占满 pdf.js worker。
const previewRenderQueue = [];
let previewRenderRunning = false;
// 预览页图只用于屏幕显示（导出走原文件），按批量大小自适应分辨率：
// 批量缩略图保持轻量；DocumentImage 按实际显示尺寸单独生成当前页的高清预览。
function adaptivePreviewScale() {
  const n = invoiceStore.invoices.length;
  if (n > 80) return 1.0;
  if (n > 40) return 1.2;
  if (n > 15) return 1.35;
  return 1.6;
}
// 只回收“本函数新建的”旋转/渲染对象 URL，保留 inv.pages 的源图 URL（图片旋转 0 度会原样复用）。
function revokeRenderedPages(inv) {
  const keep = new Set((inv.pages || []).map((p) => p && p.dataUrl).filter(Boolean));
  for (const u of inv.renderedPages || []) {
    if (typeof u === "string" && u.startsWith("blob:") && !keep.has(u)) URL.revokeObjectURL(u);
  }
}
// PDF 统一渲染原页面，保证高清预览与识别框使用相同的页面坐标；图片保留原始像素。
async function produceRenderedPages(inv, rotation) {
  if (inv.kind === "image") {
    return await Promise.all(inv.pages.map((p) => rotateImageUrl(p.dataUrl, rotation)));
  }
  return await renderPdfPages(inv.blob, { scale: adaptivePreviewScale(), rotation, maxPages: inv.isTextPdf ? 10 : 60 });
}
// 取首页宽高（图片/扫描件用已知页尺寸；电子票用首张渲染图尺寸）。
async function firstPageSize(inv) {
  if (inv.pages[0]?.width && inv.pages[0]?.height) return { w: inv.pages[0].width, h: inv.pages[0].height };
  const url = inv.renderedPages?.[0];
  if (!url) return null;
  return await imgNaturalSize(url);
}
// 仅“内容很多导致页面异常竖长”时才需要自动旋转：竖向且高宽比超过 A4(1.41) 明显（≥1.55）。
// 普通横向电子发票、A4 竖向扫描件都不旋转——避免“所有的都旋转”。
const AUTO_ROTATE_TALL_RATIO = 1.55;
function needsAutoRotate(size) {
  return size && size.w > 0 && size.h > 0 && size.h / size.w >= AUTO_ROTATE_TALL_RATIO;
}
async function renderInvoicePreview(inv) {
  try {
    revokeRenderedPages(inv);
    inv.previewStatus = "running";
    inv.renderedPages = await produceRenderedPages(inv, inv.rotation);
    // 自动旋转：用户未手动调过、当前 0 度、且页面异常竖长（内容很多）→ 旋 90° 再渲一次
    if (!inv.rotationTouched && inv.rotation === 0 && needsAutoRotate(await firstPageSize(inv))) {
      inv.rotation = 90;
      inv.rotationAuto = true;
      revokeRenderedPages(inv);
      inv.renderedPages = await produceRenderedPages(inv, 90);
    }
    inv.previewStatus = inv.renderedPages.length ? "done" : "idle";
  } catch (e) {
    inv.renderedPages = [];
    inv.previewStatus = "error";
  } finally {
    if (inv.removed) revokeInvoiceUrls(inv);
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
      await Promise.all(batch.filter((inv) => !inv.removed).map((inv) => renderInvoicePreview(inv)));
      await new Promise((r) => setTimeout(r, 80));
    }
  } finally {
    previewRenderRunning = false;
  }
}

// 文字层不可用时，以独立的无损整页图识别；不读取屏幕缩略图。
async function pageImagesForOcr(inv) {
  try {
    const images = await renderPdfPages(inv.blob, { scale: 3, maxPages: inv.isTextPdf ? 10 : 60 });
    const pages = images.map((dataUrl, pageIndex) => ({ dataUrl, pageIndex })).filter(page => page.dataUrl);
    if (pages.length) return { pages, owned: true };
  } catch { /* 整页渲染失败时回退原始扫描图 */ }
  return { pages: inv.pages || [], owned: false };
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
  ledgerTrash: loadLedgerTrash(),
  purgingTrash: false,
  savingIntake: false,
  attachmentSync: null,
  attachmentVersion: 0,
  supplements: readInvoiceSupplements(),
});

function supplementPorts() {
 return {getLedger:()=>invoiceStore.ledger,saveLedger:next=>{saveLedger(next);invoiceStore.ledger=next;},getRecords:()=>invoiceStore.supplements,saveRecords:next=>{writeInvoiceSupplements(next);invoiceStore.supplements=next;},saveOriginal:saveLedgerAttachment,getOriginal:async key=>(await getLedgerAttachment(key))?.blob,append:appendInvoiceSupplement,hashFile:fileHash};
}
function refreshSupplementLinks(){for(const inv of invoiceStore.invoices){const record=invoiceStore.supplements.find(r=>r.hash===inv.supplementHash);if(record?.ledgerKey)inv.linkedLedgerKey=record.ledgerKey;}}

let matchQueue = Promise.resolve();
function syncMatchedAttachments() {
  matchQueue = matchQueue.catch(() => {}).then(async () => {
    const result = await syncLedgerMatches(invoiceStore.ledger, invoiceStore.invoices.filter(inv => canEnterLedger(inv, directory.buyers, invoiceStore.ledger)));
    invoiceStore.attachmentSync = result;
    invoiceStore.attachmentVersion++;
    return result;
  });
  return matchQueue;
}

// 用台账刷新每张发票的历史状态（是否曾用过/已认证），供 UI 标记“历史重复/已认证”
function applyHistoryToInvoice(inv) {
  inv.history = historyStatus(invoiceStore.ledger, inv);
  const shouldExclude = shouldDefaultExcludeByHistory(invoiceStore.ledger, inv);
  if (shouldExclude && !inv.includeTouched) {
    inv.include = false;
    inv.historyAutoExcluded = true;
  } else if (!shouldExclude) {
    inv.historyAutoExcluded = false;
  }
}
function refreshHistory() {
  for (const inv of invoiceStore.invoices) applyHistoryToInvoice(inv);
}

// 只填空字段，保留人工编辑
const applyParsed = applyParsedInvoiceFields;

function applyFilenameFallback(inv) {
  const { filled } = applyInvoiceFilenameFallback(inv.fields, inv.name);
  if (filled.length) {
    const note = "已按文件名补录，需复核";
    if (!String(inv.systemNote || "").includes(note)) inv.systemNote = inv.systemNote ? `${inv.systemNote}；${note}` : note;
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
        recognitionRegions: [],
        renderedPages: [], // 左侧打印预览用的真实页图（异步填充）
        previewStatus: "idle",
        rotation: 0, // 顺时针旋转角度 0/90/180/270，预览与打印一致
        rotationTouched: false, // 用户是否手动调过方向（手动后不再自动旋转）
        rotationAuto: false, // 是否被自动旋转过（仅提示用）
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
        includeTouched: false,
        historyAutoExcluded: false,
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
            let probedNumPages = 0;
            if (!textPdf) {
              try {
                const tr = await extractPdfText(file);
                probedNumPages = tr.numPages || 0; // 复用探针页数，省一次 pdf-lib 解析
                const t = tr.text || "";
                const meaningful = t.replace(/\s/g, "").length;
                if (isProbablyInvoiceText(t)) {
                  textPdf = true;
                  inv.rawText = t; // 文字层可用：直接解析
                  inv.recognitionRegions = tr.regions;
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
              for (const page of inv.pages) if (page.dataUrl?.startsWith('blob:')) URL.revokeObjectURL(page.dataUrl);
              inv.pages = []; // 丢弃误抽的二维码/印章碎片
              if (probedNumPages) {
                inv.pageCount = probedNumPages;
              } else {
                try {
                  const doc = await PDFDocument.load(await file.arrayBuffer());
                  inv.pageCount = doc.getPageCount();
                } catch (e) {
                  inv.pageCount = 1;
                }
              }
            } else {
              inv.pageCount = probedNumPages || r.pages.length || 1;
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
    if (i >= 0) {
      invoiceStore.invoices[i].removed = true;
      revokeInvoiceUrls(invoiceStore.invoices[i]); // 回收预览图对象 URL，防内存泄漏
      invoiceStore.invoices.splice(i, 1);
    }
    if (invoiceStore.selectedId === id) invoiceStore.selectedId = invoiceStore.invoices[0]?.id || "";
  },

  clearAll() {
    invoiceStore.invoices.forEach((inv) => { inv.removed = true; revokeInvoiceUrls(inv); });
    invoiceStore.invoices.splice(0);
    invoiceStore.selectedId = "";
    invoiceStore.buyerFilter = "全部";
    invoiceStore.docTypeFilter = "全部";
    invoiceStore.groupDims = [];
  },

  toggleInclude(inv) {
    if (!inv.include && inv.history?.entry?.reimbursement === "已报销") return;
    inv.include = !inv.include;
    inv.includeTouched = true;
  },

  // 打印勾选批量操作（作用于当前筛选后可见的发票）
  setIncludeAll(list, value) {
    for (const inv of list) {
      if (value && inv.history?.entry?.reimbursement === "已报销") continue;
      inv.include = value;
      inv.includeTouched = true;
    }
  },
  invertInclude(list) {
    for (const inv of list) {
      if (!inv.include && inv.history?.entry?.reimbursement === "已报销") continue;
      inv.include = !inv.include;
      inv.includeTouched = true;
    }
  },
  // 一键排除“历史已用/已认证”的发票（避免重复使用），返回排除张数
  excludeReused(list) {
    let n = 0;
    for (const inv of list || invoiceStore.invoices) {
      if (inv.include && inv.history && inv.history.usedBefore) {
        inv.include = false;
        inv.includeTouched = true;
        n++;
      }
    }
    return n;
  },

  // 手动调整方向：dir=1 右旋(顺时针)/dir=-1 左旋(逆时针)，每次 90°，立即重渲预览（打印同样按 rotation）
  async rotateInvoice(inv, dir = 1) {
    inv.rotation = (((inv.rotation || 0) + dir * 90) % 360 + 360) % 360;
    inv.rotationTouched = true;
    try {
      revokeRenderedPages(inv);
      inv.previewStatus = "running";
      inv.renderedPages = await produceRenderedPages(inv, inv.rotation);
      inv.previewStatus = inv.renderedPages.length ? "done" : "idle";
    } catch (e) {
      inv.previewStatus = "error";
    }
  },

  refreshDuplicates() {
    return markInvoiceDuplicates(invoiceStore.invoices);
  },

  removeConfirmedDuplicates() {
    const duplicates = confirmedDuplicateInvoices(invoiceStore.invoices);
    for (const inv of duplicates) invoiceActions.removeInvoice(inv.id);
    invoiceActions.refreshDuplicates();
    return duplicates.length;
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
            inv.recognitionRegions = r.regions;
          } catch (e) {
            text = "";
          }
        }
        if (isProbablyInvoiceText(text)) {
          // 文字层可用：直接解析（最准最快）
          inv.isTextPdf = true;
          inv.rawText = text;
          applyParsed(inv.fields, parseInvoice(text), text);
        } else {
          // 文字层缺失(扫描件) 或 被字体加密成乱码(电子票) → 渲染整页转 OCR。
          // 加密票虽抽不到文字，但渲染出来视觉正常，OCR 能读出真实文字。
          let ocrText = "";
          try {
            const input = await pageImagesForOcr(inv);
            inv.recognitionRegions = [];
            try {
              if (input.pages.length) {
                invoiceStore.msg = inv.textGarbled ? "字体加密，转图像 OCR 识别…" : "OCR 识别扫描发票…";
                const lines = await recognizePages(input.pages, m => { invoiceStore.msg = m; }, {
                  // 原始内嵌图可能只是页面裁片，无法确认整页位置时不画框。
                  onPageRegions: input.owned ? regions => { inv.recognitionRegions.push(...regions); } : undefined,
                });
                ocrText = lines.join("\n");
              }
            } finally {
              if (input.owned) for (const page of input.pages) URL.revokeObjectURL(page.dataUrl);
            }
          } catch (e) {
            // OCR 不可用（如无法联网下载模型/无 WebGL）→ 不让整张失败，下面用文件名兜底
            inv.systemNote = "OCR 不可用，已按文件名补录，请手动核对";
          }
          if (ocrText.trim()) {
            inv.rawText = ocrText;
            applyParsed(inv.fields, parseInvoice(ocrText), ocrText);
            inv.systemNote = inv.systemNote || "OCR 识别，请重点核对";
          }
          // 无论 OCR 成否，最后都会执行下方 applyFilenameFallback 补齐日期/金额等空字段
        }
      } else {
        invoiceStore.msg = "OCR 识别发票图片…";
        inv.recognitionRegions = [];
        const lines = await recognizePages(inv.pages, (m) => (invoiceStore.msg = m), {
          onPageRegions: regions => { inv.recognitionRegions.push(...regions); },
        });
        inv.rawText = lines.join("\n");
        applyParsed(inv.fields, parseInvoice(inv.rawText), inv.rawText);
        if (inv.fields.docType === "医疗票据") inv.systemNote = inv.systemNote || "医疗票据 OCR 识别，请重点核对";
      }
      applyFilenameFallback(inv);
      inv.status = "done";
      // 自动分类只更新本批草稿，不借助标签写入台账。
      if (!inv.expenseTagSet) inv.expenseTag = inferExpenseTag(inv);
      if (!canEnterLedger(inv, directory.buyers, invoiceStore.ledger)) inv.include = false;
      // 批量识别时跳过逐张去重（O(n²)，整批结束后统一跑一次即可），大幅提速
      if (skipDedupe) {
        invoiceStore.msg = "识别完成，请核对。";
      } else {
        const duplicateCount = invoiceActions.removeConfirmedDuplicates();
        invoiceStore.msg = duplicateCount ? `识别完成，已自动移除 ${duplicateCount} 张重复发票。` : "识别完成，请核对。";
      }
      applyHistoryToInvoice(inv); // 历史台账查重/认证/已打印默认不勾选
      if (!skipDedupe) await syncMatchedAttachments();
    } catch (e) {
      inv.status = "error";
      inv.error = String((e && e.message) || e);
      invoiceStore.msg = "识别失败：" + inv.error;
    } finally {
      if (!skipDedupe) invoiceStore.busy = false;
    }
  },

  async recognizeAll() {
    if (invoiceStore.busy) return;
    invoiceStore.busy = true;
    try {
      for (const inv of invoiceStore.invoices) {
        if (inv.status !== "done") await invoiceActions.recognizeOne(inv, { skipDedupe: true });
      }
      const duplicateCount = invoiceActions.removeConfirmedDuplicates();
      refreshHistory();
      const reused = invoiceStore.invoices.filter((i) => i.history && i.history.usedBefore).length;
      const unfinished = invoiceStore.invoices.filter((i) => i.status !== "done").length;
      const matched = await syncMatchedAttachments();
      invoiceStore.msg = `本批识别结束${unfinished ? `，${unfinished} 张未识别成功` : ""}${duplicateCount ? `，已自动移除 ${duplicateCount} 张本批重复` : ""}${reused ? `，⚠ ${reused} 张有历史勾选或使用记录` : ""}；匹配台账 ${matched.matched} 张，新增原件 ${matched.saved} 张${matched.needsReview ? `，${matched.needsReview} 张需人工核对` : ""}${matched.failed ? `，${matched.failed} 张原件保存失败` : ""}。`;
    } finally { invoiceStore.busy = false; }
  },

  intakeDecision(inv) { return intakeDecision(inv, directory.buyers, invoiceStore.ledger); },
  applyAssignmentImport(review,selected){
    if(invoiceStore.savingIntake)throw new Error('正在保存，请稍候');
    const result=applyAssignmentReview(review,selected,invoiceStore.ledger,paymentStore.rows,directory);
    persistAssignmentImport(result,{previousLedger:invoiceStore.ledger,previousPayments:paymentStore.rows,writeBackup:data=>localStorage.setItem('expenseAssignmentBackup.v1',JSON.stringify(data)),writeLedger:saveLedger,writePayments:rows=>localStorage.setItem('paymentRecords.v1',JSON.stringify(rows))});
    invoiceStore.ledger=result.ledger;paymentStore.rows=result.payments;refreshHistory();return result;
  },
  markDraftEdited(inv){inv.manualEditPending=true;},
  async saveSupplement({invoice,file,fields,name,rawText,paymentId}={}) {
    if(invoiceStore.savingIntake)throw new Error('正在保存，请稍候');
    const source=invoice?{file:invoice.blob,fields:invoice.fields,name:invoice.name,rawText:invoice.rawText}:{file,fields,name:name||file?.name,rawText};
    const legacyPaymentId=paymentId||invoice?.paymentId;
    invoiceStore.savingIntake=true;
    try{
      if(!source.file)throw new Error('缺少附件原件');
      const hash=await fileHash(source.file);
      const previous=paymentStore.rows.filter(r=>r.id===legacyPaymentId||r.sourceKind==='receipt'&&r.evidenceHash===hash);
      if(legacyPaymentId&&!previous.some(r=>r.id===legacyPaymentId))throw new Error('原付款记录不存在，请重新核对');
      if(previous.some(r=>r.evidenceConfirmed||r.reimbursement==='已报销'))throw new Error('旧付款记录已经确认或报销，先核对其费用状态，附件原件不会丢失');
      const result=await saveInvoiceSupplement(source,supplementPorts());
      if(invoice){invoice.supplementHash=result.record.hash;invoice.linkedLedgerKey=result.record.ledgerKey;invoice.include=false;}
      if(previous.length)savePayments(paymentStore.rows.map(r=>previous.some(old=>old.id===r.id)?{...r,supplementOnly:true,linkedLedgerKey:result.record.ledgerKey,evidenceConfirmed:false}:r));
      invoiceStore.attachmentVersion++;return result;
    }finally{invoiceStore.savingIntake=false;}
  },
  async retrySupplementMatches(){if(invoiceStore.savingIntake)throw new Error('正在保存，请稍候');invoiceStore.savingIntake=true;try{const result=await reconcileInvoiceSupplements(supplementPorts());refreshSupplementLinks();invoiceStore.attachmentVersion++;return result;}finally{invoiceStore.savingIntake=false;}},
  async confirmSupplementLink(hash,key){if(invoiceStore.savingIntake)throw new Error('正在保存，请稍候');const record=invoiceStore.supplements.find(r=>r.hash===hash);if(!record)throw new Error('附件未保存');invoiceStore.savingIntake=true;try{await linkInvoiceSupplement(record,key,supplementPorts());refreshSupplementLinks();invoiceStore.attachmentVersion++;}finally{invoiceStore.savingIntake=false;}},
  async saveRecognizedInvoices(invoices = invoiceStore.invoices) {
    if (invoiceStore.savingIntake) throw new Error('正在保存，请稍候');
    invoiceStore.savingIntake = true;
    let saved = 0, failed = 0;
    const errors = [];
    try {
      for (const inv of [...invoices]) {
        if (inv.removed || intakeDecision(inv, directory.buyers, invoiceStore.ledger).state !== 'ready') continue;
        try {
          if (!inv.blob) throw new Error('缺少原件');
          const before = intakeFingerprint(inv);
          const plan = planRecognizedInvoice(invoiceStore.ledger, inv, directory.buyers);
          await saveLedgerAttachmentIfMissing(plan.key, inv.blob);
          if (inv.removed || before !== intakeFingerprint(inv)) throw new Error('保存期间票面有变化，请重新保存');
          const latest = planRecognizedInvoice(invoiceStore.ledger, inv, directory.buyers);
          saveLedger(latest.ledger); invoiceStore.ledger = latest.ledger;
          inv.savedFingerprint = before; inv.manualEditPending=false;saved++;
        } catch (error) { failed++; errors.push(inv.name+'：'+error.message); }
      }
      refreshHistory(); invoiceStore.attachmentVersion++;
      await reconcileInvoiceSupplements(supplementPorts());refreshSupplementLinks();
      return { saved, failed, errors, pending: invoiceStore.invoices.filter(inv => ['review','receipt','supplement','unrecognized','ready'].includes(intakeDecision(inv,directory.buyers,invoiceStore.ledger).state)).length };
    } finally { invoiceStore.savingIntake = false; }
  },
  async transferOtherReceipt(inv) {
    if (invoiceStore.savingIntake) throw new Error('正在保存，请稍候');
    if (intakeDecision(inv, directory.buyers, invoiceStore.ledger).state !== 'receipt') throw new Error('请先确认标记为其他票据');
    if (inv.fields?.number && invoiceStore.ledger[String(inv.fields.number).replace(/\s/g,'')]) throw new Error('同号码已存在于历史台账，请先核对并移入回收站，再转存为其他票据，避免重复计费。');
    invoiceStore.savingIntake = true;
    try {
      const result = await transferReceipt(inv, { getRows: () => paymentStore.rows, saveRows: savePayments, saveAttachment: saveLedgerAttachment });
      inv.paymentId = result.row.id; inv.include = false;
      return result;
    } finally { invoiceStore.savingIntake = false; }
  },
  // —— 历史台账 / 认证查重 ——
  async purgeLedgerTrash(ids) {
    if (invoiceStore.purgingTrash) throw new Error('正在清理，请稍候');
    invoiceStore.purgingTrash = true;
    try {
      const plan = planTrashPurge(invoiceStore.ledger, readLedgerTrashForChange(), ids);
      if (plan.changed) persistTrashPurge(plan);
      invoiceStore.ledgerTrash = readLedgerTrashForChange();
      let warning = '';
      try { await cleanupPurgedAttachments(() => invoiceStore.ledger, deleteUnusedLedgerAttachments); }
      catch (error) { warning = '部分原件副本尚未清理，可点击“重试原件清理”：' + error.message; }
      invoiceStore.attachmentVersion++;
      return { changed: plan.changed, pending: readTrashCleanupQueue().length, warning };
    } finally { invoiceStore.ledgerTrash = loadLedgerTrash(); invoiceStore.purgingTrash = false; }
  },
  deleteLedgerEntries(keys) {
    const previousTrash = readLedgerTrashForChange();
    const plan = moveLedgerToTrash(invoiceStore.ledger, previousTrash, keys);
    if (!plan.changed) return plan;
    try {
      const result = persistLedgerTransition(plan, previousTrash, saveLedger);
      invoiceStore.ledger = result.ledger;
      refreshHistory();
      return result;
    } finally { invoiceStore.ledgerTrash = loadLedgerTrash(); }
  },
  restoreLedgerEntries(ids) {
    const previousTrash = readLedgerTrashForChange();
    const plan = restoreLedgerFromTrash(invoiceStore.ledger, previousTrash, ids);
    if (!plan.changed) return plan;
    try {
      const result = persistLedgerTransition(plan, previousTrash, saveLedger);
      invoiceStore.ledger = result.ledger;
      refreshHistory();
      return result;
    } finally { invoiceStore.ledgerTrash = loadLedgerTrash(); }
  },
  saveProjectAllocation(key, allocation) {
    const previous = invoiceStore.ledger[key];
    if (!previous) return { ok: false, message: '未找到台账记录。' };
    try {
      const entry = withProjectAllocation(previous, allocation);
      const next = { ...invoiceStore.ledger, [key]: entry };
      saveLedger(next);
      invoiceStore.ledger = next;
      refreshHistory();
      return { ok: true };
    } catch (error) { return { ok: false, message: error.message }; }
  },
  saveReviewedInvoice(key, changes) {
    const prev = invoiceStore.ledger[key];
    if (!prev) return {ok:false, message:"记录不存在"};
    const allowed = ["paymentDate","service","remark","allocation","date","buyer","seller","type","amount","tax","total","project","purpose","payer","reimburser","expenseOwner","assignmentNote"];
    const entry = {...prev, ...Object.fromEntries(Object.entries(changes).filter(([k])=>allowed.includes(k)))};
    if (isMultiProject(prev)) {
      entry.allocation = prev.allocation;
      entry.project = '';
      entry.projectAllocations = prev.projectAllocations;
    }
    const errors = [...invoiceProblems(entry), ...(isMultiProject(entry) ? projectAllocationState(entry).errors : [])];
    if (errors.length) return {ok:false, message:errors.join("；")};
    entry.reviewedAt = new Date().toISOString();
    const next = {...invoiceStore.ledger, [key]:entry};
    saveLedger(next); invoiceStore.ledger = next;
    for (const inv of invoiceStore.invoices) if (inv.fields?.number === entry.number) Object.assign(inv.fields, Object.fromEntries(allowed.filter(k=>entry[k]!=null).map(k=>[k,entry[k]])));
    refreshHistory(); return {ok:true};
  },
  applyExpensePreview(result) {
    saveLedger(result.ledger); invoiceStore.ledger = result.ledger; refreshHistory();
  },
  async importExpenseReport(file) {
    const result = importExpenseWorkbook(invoiceStore.ledger, await file.arrayBuffer());
    if (!result.recognized) throw new Error("未找到可识别的发票号码和工地或付款账户列。");
    saveLedger(result.ledger);
    invoiceStore.ledger = result.ledger;
    refreshHistory();
    return result;
  },
  async importInputInvoiceReport(file) {
    if (!file) return { imported: 0, added: 0, updated: 0 };
    const bytes = await file.arrayBuffer();
    const { ledger, imported, added, updated } = importInputInvoiceWorkbookBytes(invoiceStore.ledger, bytes, { sourceName: file.name });
    saveLedger(ledger);
    invoiceStore.ledger = ledger;
    refreshHistory();
    await syncMatchedAttachments();
    await invoiceActions.retrySupplementMatches();
    invoiceStore.msg = `进项历史导入完成：${imported} 张，新增 ${added} 张，更新 ${updated} 张。请在历史报销核对中检查使用情况。`;
    return { imported, added, updated };
  },
  updateReconciliation(key, changes) {
    const previous = invoiceStore.ledger[key];
    if (!previous) return { ok: false, message: "未找到台账记录。" };
    const allowed = ["reimbursement", "reimbursementDate", "reimburser", "project", "purpose", "payment", "payer", "tags", "allocation"];
    const patch = Object.fromEntries(Object.entries(changes).filter(([k]) => allowed.includes(k)));
    if (isMultiProject(previous) && ('project' in patch || 'allocation' in patch)) return { ok: false, message: '请在工地分配中调整多工地归属。' };
    if (patch.allocation === '多工地分配') return { ok: false, message: '请在工地分配中填写各工地金额。' };
    if (patch.project) patch.allocation = '指定工地';
    const nextEntry = { ...previous, ...patch };
    if (patch.reimbursement === "已报销" && !nextEntry.reimbursementDate) return { ok: false, message: "请先填写报销日期。" };
    const clearsRequiredField = ["reimburser", "project", "purpose"].some(k => Object.hasOwn(patch, k) && !String(patch[k] || "").trim());
    if (nextEntry.reimbursement === "已报销" && (patch.reimbursement === "已报销" || clearsRequiredField)) {
      const missing = missingReimbursementFields(nextEntry);
      if (missing.length) return { ok: false, message: `请先填写${missing.join("、")}，再标记已报销。` };
    }
    const next = { ...invoiceStore.ledger, [key]: nextEntry };
    saveLedger(next);
    invoiceStore.ledger = next;
    if (patch.reimbursement === "已报销") {
      for (const inv of invoiceStore.invoices) {
        if (historyStatus(next, inv).entry?.key === key) { inv.include = false; inv.includeTouched = false; }
      }
    }
    refreshHistory();
    return { ok: true };
  },
  markReimbursedBatch(keys, date) {
    const result = markReimbursedBatch(invoiceStore.ledger, keys, date);
    saveLedger(result.ledger);
    invoiceStore.ledger = result.ledger;
    for (const inv of invoiceStore.invoices) {
      if (historyStatus(result.ledger, inv).entry?.reimbursement === "已报销") {
        inv.include = false;
        inv.includeTouched = false;
      }
    }
    refreshHistory();
    return result;
  },
  updateCurrentReimbursements(invoices, action, date) {
    if (action === "mark") assertLedgerEligible(invoices);
    if (action === "mark") { const bad = invoices.find(inv => invoiceProblems(inv.fields).length); if (bad) throw new Error("请先复核完整票面：" + invoiceProblems(bad.fields).join("、")); }
    const result = updateCurrentReimbursements(invoiceStore.ledger, invoices, action, date);
    saveLedger(result.ledger);
    invoiceStore.ledger = result.ledger;
    if (action === "mark") {
      for (const inv of invoiceStore.invoices) {
        if (historyStatus(result.ledger, inv).entry?.reimbursement === "已报销") { inv.include = false; inv.includeTouched = false; }
      }
    }
    refreshHistory();
    return result;
  },
  setInvoiceExpenseTag(inv, tag) {
    inv.expenseTag = tag; inv.expenseTagSet = true;
    inv.manualEditPending=true;
    return { ok: true };
  },
  clearLedger() {
    const result = invoiceActions.deleteLedgerEntries(Object.keys(invoiceStore.ledger));
    invoiceStore.msg = `已将 ${result.changed} 张发票移入回收站，可随时恢复。${result.warning || ''}`;
  },
  recordToLedger(name) {
    const list = orderedForPrint().map((x) => x.inv).filter((inv) => inv.status === "done");
    assertLedgerEligible(list);
    const { ledger, added, repeated } = recordInvoices(invoiceStore.ledger, list, { name: name || "报销批次" });
    invoiceStore.ledger = ledger;
    saveLedger(ledger);
    refreshHistory();
    invoiceStore.msg = `已记入历史台账：新增 ${added} 张，更新 ${repeated} 张。`;
    return { added, repeated };
  },
  markPrinted(ids, name) {
    const idSet = ids && ids.length ? new Set(ids) : null;
    const list = orderedForPrint()
      .map((x) => x.inv)
      .filter((inv) => inv.status === "done" && (!idSet || idSet.has(inv.id)));
    assertLedgerEligible(list);
    const { ledger, added, updated, printed } = markPrintedInvoices(invoiceStore.ledger, list, { name: name || "打印批次" });
    invoiceStore.ledger = ledger;
    saveLedger(ledger);
    refreshHistory();
    invoiceStore.msg = `已标记打印：${printed} 张，新增台账 ${added} 张，更新 ${updated} 张。`;
    return { added, updated, printed };
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
  syncMatchedAttachments,
  async refreshInvoiceMatches() {
    invoiceActions.refreshDuplicates();
    refreshHistory();
    return syncMatchedAttachments();
  },
};

export function assertLedgerEligible(invoices) {
  const bad = invoices.find(inv => !canEnterLedger(inv, directory.buyers, invoiceStore.ledger));
  if (bad) throw new Error(intakeDecision(bad, directory.buyers, invoiceStore.ledger).reason);
}

export function invoiceSummary() {
  let amount = 0, tax = 0, total = 0, n = 0;
  for (const inv of filteredInvoices()) {
    if (!inv.include || supplementType(inv.fields)) continue;
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
  for (const buyer of directory.buyers) if (String(buyer).trim()) set.add(String(buyer).trim());
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
  return (invoiceStore.buyerFilter === "全部" || normalizeBuyerName(buyer) === normalizeBuyerName(invoiceStore.buyerFilter))
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
    needsReview: !inv.fields.date || !inv.fields.total || !inv.fields.seller || !inv.fields.buyer || /需复核|请.*核对/.test(inv.systemNote || "") || !!inv.duplicateReason || !!inv.history?.usedBefore,
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
