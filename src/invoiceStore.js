import { planPaymentAttachments } from './lib/payment-batch-matching.js';
import { linkPaymentFile } from './lib/payment-attachments.js';
import { parsePaymentEvidence, parsePaymentTransactions } from './lib/payment-evidence.js';
import { appStorage } from './lib/app-storage.js';
import { intakeDecision, intakeFingerprint, canEnterLedger, planRecognizedInvoice, receiptType } from './lib/invoice-intake.js';
import { transferReceipt } from './lib/receipt-transfer.js';
import { fileHash, isPdf } from './lib/file-utils.js';
import { paymentStore, savePayments } from './lib/payment-store.js';
import { getLedgerAttachment, saveLedgerAttachment, saveLedgerAttachmentIfMissing, appendInvoiceSupplement } from './lib/ledger-attachments.js';
import { withProjectAllocation, isMultiProject, projectAllocationState } from './lib/invoice-allocation.js';
import { directory, saveDirectory } from './lib/expense-directory.js';
import { planTrashPurge, persistTrashPurge, readTrashCleanupQueue, cleanupPurgedAttachments } from './lib/ledger-trash-purge.js';
import { deleteUnusedLedgerAttachments } from './lib/ledger-attachments.js';
import { loadLedgerTrash, readLedgerTrashForChange, moveLedgerToTrash, restoreLedgerFromTrash, persistLedgerTransition } from './lib/ledger-trash.js';
import { normalizeBuyerName } from './lib/invoice-buyer-check.js';
import { invoiceProblems } from "./lib/invoice-review.js";
import { reactive, markRaw } from "vue";
import { rotateImageUrl, imgNaturalSize } from './lib/image-utils.js';
import { discardFilePreviews } from './lib/preview-cache.js';
import { getOcrCache, putOcrCache } from './lib/ocr-cache.js';
import { recognizePageRegion, recognizePages, yieldToBackground } from "./lib/ocr";
import { applyParsedInvoiceFields } from "./lib/invoice-fields";
import { applyInvoiceFilenameFallback, paymentScreenshotDraft } from "./lib/invoice-filename";
import { recoverMedicalReceiptNumber, shouldRetryMedicalNumber } from './lib/invoice-medical-ocr.js';
import { confirmedDuplicateInvoices, markInvoiceDuplicates } from "./lib/invoice-dedupe";
import { identifyIntakeFile, intakeFile, supplementFolder } from './lib/fileIntake.js';
import { invoiceFolderParts } from "./lib/invoice-export-package";
import { ledgerKey, loadLedger, saveLedger, recordInvoices, markVerified, parseVerifiedNumbers, historyStatus, markPrintedInvoices, shouldDefaultExcludeByHistory, missingReimbursementFields } from "./lib/invoice-ledger-state.js";
import { markReimbursedBatch, updateCurrentReimbursements } from "./lib/invoice-ledger-state.js";
import { inferExpenseTag } from "./lib/invoice-tags";
import { syncLedgerMatches } from "./lib/ledger-matching.js";
import {uniqueSupplementMatch,supplementType,readInvoiceSupplements,writeInvoiceSupplements,saveInvoiceSupplement,reconcileInvoiceSupplements,linkInvoiceSupplement,unlinkInvoiceSupplement} from './lib/invoice-supplements.js';
import {applyAssignmentReview,persistAssignmentImport} from './lib/expense-assignment-review.js';

import { dismissToast, toastInfo, toastUndo } from './lib/toast.js';

let duplicateToast = null;
let workspaceGeneration = 0;
let seq = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

function emptyFields() {
  return { code: "", number: "", date: "", dateText: "", buyer: "", seller: "", amount: "", tax: "", total: "", rate: "", type: "", taxKind: "", docType: "", remark: "" };
}

// 回收某张发票占用的对象 URL（预览页图/内嵌页图），避免删除/清空后内存泄漏。
function revokeInvoiceUrls(inv) {
  documentJobs.get(inv)?.abort();
  discardFilePreviews(inv.blob);
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
  const { renderPdfPages } = await import('./lib/pdftext.js');
  return await renderPdfPages(inv.blob, { signal: documentJobs.get(inv)?.signal, scale: adaptivePreviewScale(), maxPixels: 360000, rotation, maxPages: inv.isTextPdf ? 10 : 60 });
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

async function preparePdf(inv, cached) {
  try {
    if (cached?.pageCount) {
      inv.pageCount = cached.pageCount;
      inv.isTextPdf = !!cached.isTextPdf;
      return;
    }
    const [{ extractPdfText }, { isProbablyInvoiceText }] = await Promise.all([import('./lib/pdftext.js'), import('./lib/invoice-parse.js')]);
    const probe = await extractPdfText(inv.blob, { signal: documentJobs.get(inv)?.signal });
    if (inv.removed) return;
    inv.pageCount = probe.numPages || 1;
    const readable = isProbablyInvoiceText(probe.text);
    inv.textGarbled = !readable && probe.text.replace(/\s/g, '').length >= 40;
    inv.isTextPdf = readable || inv.textGarbled;
    pdfProbes.set(inv, probe);
  } catch {
    if (inv.removed) return;
    try {
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.load(await inv.blob.arrayBuffer());
      inv.pageCount = pdf.getPageCount();
    } catch {
      await loadEmbeddedScans(inv);
      inv.pageCount = inv.pages.length || 1;
    }
  } finally {
    inv.rendering = false;
    if (!inv.removed) queuePreviewRender(inv);
  }
}

async function loadEmbeddedScans(inv) {
  if (inv.embeddedScansLoaded || inv.removed) return;
  const { renderFileToPages } = await import('./lib/pdf.js');
  const { pages } = await renderFileToPages(inv.blob, { useObjectUrl: true });
  inv.pages = pages;
  inv.embeddedScansLoaded = true;
  if (inv.removed) revokeInvoiceUrls(inv);
}

// OCR 按物理页号分段渲染。内嵌 JPEG 可能只是裁片，回退时不在预览上画框。
async function pageImagesForOcr(inv, firstPage, maxPages) {
  let urls = [];
  try {
    const { renderPdfPages } = await import('./lib/pdftext.js');
    urls = await renderPdfPages(inv.blob, { signal: documentJobs.get(inv)?.signal, firstPage, maxPages, scale: 2.2, maxPixels: 2_200_000 });
  } catch { /* 尝试原始扫描图 */ }
  if ((urls.length < maxPages || urls.some(url => !url)) && !inv.isTextPdf) {
    await loadEmbeddedScans(inv).catch(() => {});
  }
  return Array.from({ length: maxPages }, (_, offset) => {
    const pageIndex = firstPage + offset - 1;
    return { pageIndex, dataUrl: urls[offset] || inv.pages[pageIndex]?.dataUrl, owned: !!urls[offset] };
  });
}

const preparing = new WeakMap();
const documentJobs = new WeakMap();
const pdfProbes = new WeakMap();
const importCache = new WeakMap();

export const invoiceStore = reactive({
  invoices: [],
  busy: false,
  recognitionProgress: null,
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
  matchSupplementHash: "",
});

function supplementMatchLedger() {
  const candidates = { ...invoiceStore.ledger };
  for (const inv of invoiceStore.invoices) {
    const f = inv.fields;
    if (!f || inv.removed || inv.status !== 'done' || inv.otherReceiptConfirmed || receiptType(f) || supplementType(f) || !/^\d{8,25}$/.test(String(f.number).replace(/\s/g,''))) continue;
    const key = ledgerKey(inv);
    if (!candidates[key]) candidates[key] = f;
    else if (['date','seller','buyer','total'].some(field => f[field] && candidates[key][field] && String(f[field]) !== String(candidates[key][field]) && (field !== 'total' || Number(f.total) !== Number(candidates[key].total)))) {
      candidates['draft:'+inv.id] = f;
    }
  }
  return candidates;
}
function supplementPorts() {
 return {getMatchLedger:supplementMatchLedger,getLedger:()=>invoiceStore.ledger,saveLedger:next=>{saveLedger(next);invoiceStore.ledger=next;},getRecords:()=>invoiceStore.supplements,saveRecords:next=>{writeInvoiceSupplements(next);invoiceStore.supplements=next;},saveOriginal:saveLedgerAttachment,getOriginal:async key=>(await getLedgerAttachment(key))?.blob,append:appendInvoiceSupplement,hashFile:fileHash};
}
function refreshSupplementLinks(){
  const links=new Map(invoiceStore.supplements.map(r=>[r.hash,r.ledgerKey]));
  for(const inv of invoiceStore.invoices) if(links.has(inv.supplementHash)) inv.linkedLedgerKey=links.get(inv.supplementHash);
  if(paymentStore.rows.some(r=>r.supplementOnly && links.has(r.evidenceHash) && r.linkedLedgerKey!==links.get(r.evidenceHash)))
    savePayments(paymentStore.rows.map(r=>r.supplementOnly && links.has(r.evidenceHash)?{...r,linkedLedgerKey:links.get(r.evidenceHash)}:r));
}

async function storeSupplement({invoice,file,fields,name,rawText,paymentId}, {reconcile=true, automatic=false, attachmentType=''}={}) {
  const source=invoice?{file:invoice.blob,fields:invoice.fields,name:invoice.name,rawText:invoice.rawText}:{file,fields,name:name||file?.name,rawText};
  if (attachmentType) source.fields = {...source.fields, attachmentType};
  const legacyPaymentId=paymentId||invoice?.paymentId;
  if(!source.file)throw new Error('缺少附件原件');
  const hash=await fileHash(source.file);
  if (automatic && paymentStore.rows.some(r=>!r.supplementOnly && (r.evidenceHash===hash || r.evidenceOriginalHash===hash))) return null;
  const previous=paymentStore.rows.filter(r=>r.id===legacyPaymentId||r.sourceKind==='receipt'&&r.evidenceHash===hash);
  if(legacyPaymentId&&!previous.some(r=>r.id===legacyPaymentId))throw new Error('原付款记录不存在，请重新核对');
  if(previous.some(r=>r.evidenceConfirmed||r.reimbursement==='已报销'))throw new Error('旧付款记录已经确认或报销，先核对其费用状态，附件原件不会丢失');
  const result=await saveInvoiceSupplement(source,supplementPorts(),{reconcile});
  if(invoice){if(attachmentType)invoice.fields.attachmentType=attachmentType;invoice.supplementHash=result.record.hash;invoice.linkedLedgerKey=result.record.ledgerKey;invoice.include=false;}
  if(previous.length)savePayments(paymentStore.rows.map(r=>previous.some(old=>old.id===r.id)?{...r,supplementOnly:true,linkedLedgerKey:result.record.ledgerKey,evidenceConfirmed:false}:r));
  if (!automatic) invoiceStore.attachmentVersion++;
  return result;
}

async function collectRecognizedSupplements() {
  const pool = supplementMatchLedger();
  const errors = [], payments = [];
  const drafts = invoiceStore.invoices.filter(inv => inv.status === 'done' && !inv.removed && !inv.paymentId && !inv.supplementHash && inv.blob);
  for (const inv of drafts) {
    if (supplementType(inv.fields)) {
      try { await storeSupplement({ invoice:inv }, { automatic:true, reconcile:false }); }
      catch (error) { errors.push(inv.name+'：'+error.message); }
      continue;
    }
    if (inv.fields.docType !== '付款凭证') continue;
    inv.paymentMatchNote = '';
    try {
      const hash = inv.sha256 || await fileHash(inv.blob);
      const archived = invoiceStore.supplements.find(record => record.hash === hash);
      if (archived) {
        inv.supplementHash = hash; inv.linkedLedgerKey = archived.ledgerKey;
        inv.fields.attachmentType = supplementType(archived.fields); inv.include = false;
        continue;
      }
      const owner = paymentStore.rows.find(row => row.evidenceHash === hash || row.evidenceOriginalHash === hash || row.evidenceSelection?.some(file => file.hash === hash));
      if (owner) { inv.paymentId = owner.id; inv.include = false; continue; }
      const evidence = parsePaymentEvidence(inv.rawText);
      if (evidence.kind !== 'payment' || evidence.direction !== 'expense' || evidence.paymentStatus !== 'success' || parsePaymentTransactions(inv.rawText).length > 1) continue;
      const fields = { ...inv.fields, ...evidence, date:evidence.date || inv.fields.date, seller:evidence.seller || inv.fields.seller, total:evidence.total === '' ? inv.fields.total : evidence.total };
      payments.push({ inv, file:inv.blob, hash, fields, normalized:String(inv.rawText || '').replace(/\s/g,'') });
    } catch (error) { errors.push(inv.name+'：'+error.message); }
  }
  const targets = new Map();
  let claims;
  const plans = planPaymentAttachments(paymentStore.rows, payments, paymentStore.rows, {onClaims: value => { claims = value; }});
  for (const [id,plan] of plans) {
    for (const choice of plan.choices) targets.set(choice.index,id);
  }
  for (const [index,candidate] of payments.entries()) {
    const inv = candidate.inv;
    const invoiceMatch = uniqueSupplementMatch({ ...inv, fields:candidate.fields },pool);
    const row = paymentStore.rows.find(item => item.id === targets.get(index));
    if (!row && claims?.has(index)) {
      inv.paymentMatchNote = '付款清单有候选记录，请核对后分配凭证。';
      continue;
    }
    if (row && invoiceMatch) {
      inv.paymentMatchNote = '已匹配付款清单和主发票，请选择附件归属。';
      continue;
    }
    try {
      if (row) {
        if (row.evidenceConfirmed || row.evidenceHash || row.reimbursement === '已报销' || row.pendingCopies?.length) {
          inv.paymentMatchNote = '已找到付款记录，请核对已有凭证。';
          continue;
        }
        const patch = await linkPaymentFile(row,candidate,'付款凭证');
        savePayments(paymentStore.rows.map(current => current.id === row.id ? { ...current,...patch } : current));
        inv.paymentId = row.id; inv.include = false;
      } else if (invoiceMatch) {
        await storeSupplement({ invoice:inv },{ automatic:true,reconcile:false,attachmentType:'付款凭证附件' });
      }
    } catch (error) { errors.push(inv.name+'：'+error.message); }
  }
  const result = await reconcileInvoiceSupplements(supplementPorts());
  refreshSupplementLinks();
  invoiceStore.attachmentVersion++;
  return { ...result, errors };
}

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

async function recoverHeader(inv, result, page, trackRegions) {
  if (!shouldRetryMedicalNumber(result.parsedFields, inv.name)) return;
  let originalUrl;
  try {
    if (isPdf(inv) && trackRegions) {
      // 只有票号缺失时才以旧版高清倍率重绘首页，局部补扫保留原始像素。
      [originalUrl] = await import('./lib/pdftext.js')
        .then(({ renderPdfPages }) => renderPdfPages(inv.blob, { signal: documentJobs.get(inv)?.signal, scale: 3, maxPages: 1 })).catch(() => []);
    }
    const recovered = await recoverMedicalReceiptNumber(originalUrl ? { ...page, dataUrl: originalUrl } : page, recognizePageRegion);
    if (recovered) {
      result.parsedFields.number = recovered.number;
      result.rawText = [result.rawText, recovered.text].filter(Boolean).join('\n');
      if (trackRegions) result.regions.push(...recovered.regions);
    }
  } finally {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
  }
}

function isDetail(inv, fields) {
  return supplementFolder(intakeFile(inv.blob).parentFolder) || supplementType(fields) ||
    /行程单|行程及费用明细|快递.*明细|邮寄.*明细/.test(inv.name);
}

async function scanPdf(inv, previous) {
  const { parseInvoice } = await import('./lib/invoice-parse.js');
  const pending = previous?.remainingPages || Array.from({ length: inv.pageCount }, (_, i) => i + 1);
  const limit = Math.min(pending.length, inv.isTextPdf ? 4 : 20);
  const result = { rawText: previous?.rawText || '', regions: [...(previous?.regions || [])], parsedFields: { ...previous?.parsedFields }, remainingPages: [] };
  const failed = [];
  let index = 0, stop = false;
  while (index < limit && !stop && !inv.removed) {
    // 常见发票先取两页，后续和补扫每次仅保留少量整页图。
    const start = pending[index];
    let count = 1;
    while (count < 2 && index + count < limit && pending[index + count] === start + count) count++;
    const pages = await pageImagesForOcr(inv, start, count);
    try {
      for (const page of pages) {
        if (inv.removed) break;
        const number = pending[index++];
        if (!page.dataUrl) { failed.push(number); continue; }
        try {
          invoiceStore.msg = '识别第 ' + number + '/' + inv.pageCount + ' 页…';
          const lines = await recognizePages([page], undefined, {
            onPageRegions: page.owned ? regions => result.regions.push(...regions) : undefined,
          });
          result.rawText = [result.rawText, ...lines].filter(Boolean).join('\n');
          result.parsedFields = parseInvoice(result.rawText);
          if (number === 1) await recoverHeader(inv, result, page, page.owned);
          const fields = result.parsedFields;
          if (!previous && !inv.isTextPdf && fields.docType === '增值税发票' && !isDetail(inv, fields) &&
              /^\d{8,25}$/.test(fields.number) && Number.isFinite(fields.total)) {
            stop = true;
            break;
          }
        } catch (error) {
          failed.push(number);
          if (error.name === 'OcrInitializationError') { stop = true; break; }
        }
      }
    } finally {
      for (const page of pages) if (page.owned) URL.revokeObjectURL(page.dataUrl);
    }
  }
  result.remainingPages = [...failed, ...pending.slice(index)];
  result.note = failed.length ? '第 ' + failed.join('、') + ' 页识别失败，可补扫重试' : 'OCR 识别，请重点核对';
  result.cacheable = !failed.length;
  return result;
}

let backgroundQueue = Promise.resolve();
function deferScreenshot(inv) {
  inv.status = 'queued';
  backgroundQueue = backgroundQueue.then(async () => {
    await yieldToBackground();
    while (invoiceStore.busy && !inv.removed) await new Promise(resolve => setTimeout(resolve, 50));
    if (!inv.removed && inv.status === 'queued') await invoiceActions.recognizeOne(inv, { background: true });
  }).catch(error => { inv.error = String(error.message || error); inv.status = 'error'; });
}

async function readRecognition(inv, { force, remaining, deferNamed }) {
  const lookup = importCache.get(inv);
  importCache.delete(inv);
  if (!force && !remaining) {
    const cached = await (lookup || getOcrCache(inv.sha256));
    if (cached) return cached;
    if (deferNamed && inv.filenameDraft) { deferScreenshot(inv); return null; }
  }
  await preparing.get(inv);
  if (inv.removed) return null;
  const { parseInvoice, isProbablyInvoiceText } = await import('./lib/invoice-parse.js');
  let result;
  if (isPdf(inv)) {
    let probe = force ? null : pdfProbes.get(inv);
    pdfProbes.delete(inv);
    if (!remaining && !probe) {
      probe = await import('./lib/pdftext.js').then(({ extractPdfText }) => extractPdfText(inv.blob, { signal: documentJobs.get(inv)?.signal })).catch(() => null);
    }
    if (!remaining && isProbablyInvoiceText(probe?.text || '')) {
      inv.isTextPdf = true;
      result = { rawText: probe.text, regions: probe.regions, parsedFields: parseInvoice(probe.text) };
    } else {
      result = await scanPdf(inv, remaining ? inv.lastRecognition : null);
    }
  } else {
    const regions = [];
    const lines = await recognizePages(inv.pages, undefined, { onPageRegions: hits => regions.push(...hits) });
    const rawText = lines.join('\n');
    result = { rawText, regions, parsedFields: parseInvoice(rawText) };
    await recoverHeader(inv, result, inv.pages[0], true);
    if (result.parsedFields.docType === '医疗票据') result.note = '医疗票据 OCR 识别，请重点核对';
  }
  if (isPdf(inv)) Object.assign(result, { pageCount: inv.pageCount, isTextPdf: inv.isTextPdf });
  if (result.rawText.trim() && result.cacheable !== false) await putOcrCache(inv.sha256, result);
  return result;
}

function applyRecognition(inv, result) {
  const previous = inv.automaticFields || {};
  // 重新识别和补扫时，只替换上一次自动填入且用户未修改的值。
  for (const [key, value] of Object.entries(previous)) {
    if (inv.fields[key] === value) inv.fields[key] = '';
  }
  const automatic = {};
  applyParsedInvoiceFields(automatic, result.parsedFields, result.rawText);
  const { filled } = applyInvoiceFilenameFallback(automatic, inv.name);
  applyParsedInvoiceFields(inv.fields, automatic, result.rawText);
  inv.automaticFields = markRaw(automatic);
  inv.lastRecognition = markRaw(result);
  inv.rawText = result.rawText;
  inv.recognitionRegions = markRaw(result.regions || []);
  inv.systemNote = [result.note, filled.length && '已按文件名补录，需复核'].filter(Boolean).join('；');
}

export const invoiceActions = {
  async addFiles(fileList, onFile) {
    const generation = workspaceGeneration;
    const arr = Array.from(fileList).filter((f) => /\.(pdf|png|jpe?g|bmp|webp|gif|tiff?)$/i.test(f.name));
    if (arr.length) dismissToast(duplicateToast);
    for (const [index, file] of arr.entries()) {
      if (arr.length > 15 && index > 0 && index % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      const source = await identifyIntakeFile(file).catch(() => intakeFile(file));
      if (generation !== workspaceGeneration) return;
      onFile?.(index + 1, arr.length);
      if (source.sha256 && invoiceStore.invoices.some(inv => inv.sourcePath === source.relativePath && inv.sha256 === source.sha256)) continue;
      const inv = reactive({
        id: uid("inv"),
        name: file.name,
        blob: markRaw(file),
        sourcePath: source.relativePath,
        sha256: source.sha256 || '',
        sha256Short: source.sha256Short || '',
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
      if (inv.kind === 'image') {
        const draft = paymentScreenshotDraft(file.name);
        if (draft) {
          Object.assign(inv.fields, draft);
          inv.automaticFields = markRaw(draft);
          inv.filenameDraft = true;
          inv.systemNote = '文件名草稿，可先核对；交易单号待后台识别';
        }
        inv.pages = [{ dataUrl: URL.createObjectURL(file), pageIndex: 0 }];
        inv.rendering = false;
        queuePreviewRender(inv);
        continue;
      }
      documentJobs.set(inv, new AbortController());
      const lookup = getOcrCache(inv.sha256);
      importCache.set(inv, lookup);
      const ready = lookup.then(cached => preparePdf(inv, cached)).catch(error => { inv.error = String(error.message || error); });
      preparing.set(inv, ready);
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
    workspaceGeneration++;
    dismissToast(duplicateToast);
    previewRenderQueue.length = 0;
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
    } finally {
      if (inv.removed) revokeInvoiceUrls(inv);
    }
  },

  refreshDuplicates() {
    return markInvoiceDuplicates(invoiceStore.invoices);
  },

  removeConfirmedDuplicates({ undoable = false } = {}) {
    const invoices = invoiceStore.invoices;
    const duplicates = confirmedDuplicateInvoices(invoices);
    if (undoable && duplicates.length) {
      dismissToast(duplicateToast);
      const removed = new Set(duplicates);
      const order = invoices.map(inv => inv.id);
      const selected = invoiceStore.selectedId;
      invoiceStore.invoices = invoices.filter(inv => !removed.has(inv));
      if (duplicates.some(inv => inv.id === selected)) invoiceStore.selectedId = invoiceStore.invoices[0]?.id || '';
      const selectionAfterRemoval = invoiceStore.selectedId;

      duplicateToast = toastUndo(`已移除 ${duplicates.length} 张重复发票，每组保留一张。`, () => {
        const current = invoiceStore.invoices;
        const positions = new Map(order.map((id, index) => [id, index]));
        invoiceStore.invoices = [...current, ...removed].sort((a, b) =>
          (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
        if (invoiceStore.selectedId === selectionAfterRemoval && duplicates.some(inv => inv.id === selected)) {
          invoiceStore.selectedId = selected;
        }
        removed.clear();
        invoiceActions.refreshDuplicates();
        refreshHistory();
      }, () => {
        // 撤销期限内保留这几张的原始页和预览；恢复后所有权交还当前批次。
        for (const inv of removed) { inv.removed = true; revokeInvoiceUrls(inv); }
        duplicateToast = null;
      });
    } else {
      for (const inv of duplicates) invoiceActions.removeInvoice(inv.id);
    }
    invoiceActions.refreshDuplicates();
    return duplicates.length;
  },

  async recognizeOne(inv, { skipDedupe = false, force = false, remaining = false, background = false, deferNamed = false } = {}) {
    if (inv.removed || inv.status === 'running' || (remaining && !inv.lastRecognition?.remainingPages?.length)) return;
    inv.status = "running";
    inv.error = "";
    if (!background) invoiceStore.busy = true;
    try {
      const result = await readRecognition(inv, { force, remaining, deferNamed });
      if (!result || inv.removed) return;
      applyRecognition(inv, result);
      inv.filenameDraft = false;
      if (supplementFolder(intakeFile(inv.blob).parentFolder)) {
        inv.fields.attachmentType ||= /行程单/.test(intakeFile(inv.blob).parentFolder) ? '行程单' : '行程及费用明细';
        inv.include = false;
      }
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
      if (!skipDedupe) {
        await syncMatchedAttachments();
        const result = await invoiceActions.matchRecognizedAttachments();
        if (result.errors.length) invoiceStore.msg += ' 附件需重试：'+result.errors.join('；');
      }
    } catch (e) {
      inv.status = "error";
      inv.error = String((e && e.message) || e);
      invoiceStore.msg = "识别失败：" + inv.error;
    } finally {
      if (!skipDedupe && !background) invoiceStore.busy = false;
    }
  },

  async recognizeAll() {
    if (invoiceStore.busy) return;
    invoiceStore.busy = true;
    try {
      const pending = invoiceStore.invoices.filter(inv => !['done', 'queued', 'running'].includes(inv.status));
      invoiceStore.recognitionProgress = { label: '识别票据', done: 0, total: pending.length };
      let lastYield = performance.now();
      for (const [index, inv] of pending.entries()) {
        if (!inv.removed) await invoiceActions.recognizeOne(inv, { skipDedupe: true, deferNamed: true });
        invoiceStore.recognitionProgress.done = index + 1;
        // Cache hits can otherwise run the whole loop in microtasks without a paint.
        if (index + 1 < pending.length && performance.now() - lastYield >= 12) {
          await yieldToBackground();
          lastYield = performance.now();
        }
      }
      invoiceStore.recognitionProgress = { label: '核对附件匹配' };
      const duplicateCount = invoiceActions.removeConfirmedDuplicates();
      refreshHistory();
      const reused = invoiceStore.invoices.filter((i) => i.history && i.history.usedBefore).length;
      const unfinished = invoiceStore.invoices.filter(i => i.status === "error" || i.status === "idle").length;
      const matched = await syncMatchedAttachments();
      const attachments = await invoiceActions.matchRecognizedAttachments();
      invoiceStore.msg = `本批识别结束${unfinished ? `，${unfinished} 张未识别成功` : ""}${duplicateCount ? `，已自动移除 ${duplicateCount} 张本批重复` : ""}${reused ? `，⚠ ${reused} 张有历史勾选或使用记录` : ""}；匹配台账 ${matched.matched} 张，新增原件 ${matched.saved} 张${matched.needsReview ? `，${matched.needsReview} 张需人工核对` : ""}${matched.failed ? `，${matched.failed} 张原件保存失败` : ""}。`;
      if (attachments.linked || attachments.pending) invoiceStore.msg += ' 附件已关联 '+attachments.linked+' 份，待匹配 '+attachments.pending+' 份。';
      if (attachments.errors.length || attachments.failed) invoiceStore.msg += ' 附件需重试：'+(attachments.errors.join('；') || attachments.failed+' 份关联失败');
    } finally {
      invoiceStore.recognitionProgress = null;
      invoiceStore.busy = false;
    }
  },
  async matchRecognizedAttachments() {
    if (invoiceStore.savingIntake) return {linked:0,pending:0,failed:0,errors:['正在保存，请稍后重试匹配']};
    invoiceStore.savingIntake=true;
    try { return await collectRecognizedSupplements(); }
    finally { invoiceStore.savingIntake=false; }
  },
  matchingDraftNumber(doc) {
    const match=uniqueSupplementMatch(doc,supplementMatchLedger());
    return match && !invoiceStore.ledger[match.entry.key] ? match.entry.number : '';
  },
  intakeDecision(inv) { return intakeDecision(inv, directory.buyers, invoiceStore.ledger); },
  applyAssignmentImport(review,selected,newProjects=[]){
    if(invoiceStore.savingIntake)throw new Error('正在保存，请稍候');
    const selectedIds=new Set(selected);
    const used=new Set(review.filter(item=>selectedIds.has(item.id)).map(item=>item.patch?.project));
    const additions=newProjects.filter(name=>used.has(name)&&!directory.projects.includes(name));
    const previousProjects=[...directory.projects];
    const projects=[...new Set([...previousProjects,...additions])];
    const result=applyAssignmentReview(review,selected,invoiceStore.ledger,paymentStore.rows,{...directory,projects});
    if(additions.length)saveDirectory({...directory,projects});
    try {
    persistAssignmentImport(result,{previousLedger:invoiceStore.ledger,previousPayments:paymentStore.rows,writeBackup:data=>appStorage.setItem('expenseAssignmentBackup.v1',JSON.stringify(data)),writeLedger:saveLedger,writePayments:rows=>appStorage.setItem('paymentRecords.v1',JSON.stringify(rows))});
    } catch(error) { if(additions.length)saveDirectory({...directory,projects:previousProjects});throw error; }
    invoiceStore.ledger=result.ledger;paymentStore.rows=result.payments;refreshHistory();return result;
  },
  markDraftEdited(inv){inv.manualEditPending=true;},
  async saveSupplement({invoice,file,fields,name,rawText,paymentId}={}) {
    if(invoiceStore.savingIntake)throw new Error('正在保存，请稍候');
    invoiceStore.savingIntake=true;
    try{
      return await storeSupplement({invoice,file,fields,name,rawText,paymentId});
    }finally{invoiceStore.savingIntake=false;}
  },
  async retrySupplementMatches(){if(invoiceStore.savingIntake)throw new Error('正在保存，请稍候');invoiceStore.savingIntake=true;try{const result=await reconcileInvoiceSupplements(supplementPorts());refreshSupplementLinks();invoiceStore.attachmentVersion++;return result;}finally{invoiceStore.savingIntake=false;}},
  async confirmSupplementLink(hash,key){if(invoiceStore.savingIntake)throw new Error('正在保存，请稍候');const record=invoiceStore.supplements.find(r=>r.hash===hash);if(!record)throw new Error('附件未保存');invoiceStore.savingIntake=true;try{await linkInvoiceSupplement(record,key,supplementPorts());refreshSupplementLinks();invoiceStore.attachmentVersion++;}finally{invoiceStore.savingIntake=false;}},
  unlinkSupplement(hash) {
    if (invoiceStore.savingIntake) throw new Error('正在保存，请稍候');
    const record = invoiceStore.supplements.find(item => item.hash === hash);
    if (!record?.ledgerKey) return;
    unlinkInvoiceSupplement(record, supplementPorts());
    refreshSupplementLinks();
    invoiceStore.attachmentVersion++;
  },
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
      const attachments=await collectRecognizedSupplements();
      errors.push(...attachments.errors);
      failed += attachments.errors.length + attachments.failed;
      return { saved, failed, errors, pending: invoiceStore.invoices.filter(inv => ['review','receipt','supplement','unrecognized','ready'].includes(intakeDecision(inv,directory.buyers,invoiceStore.ledger).state)).length };
    } finally { invoiceStore.savingIntake = false; }
  },
  async transferOtherReceipt(inv) {
    if (invoiceStore.savingIntake) throw new Error('正在保存，请稍候');
    if (inv.paymentMatchNote) throw new Error(inv.paymentMatchNote);
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
      const ids = plan.trash.slice(0, plan.changed).map(record => record.id);
      toastUndo(`已将 ${result.changed} 张发票移入回收站。`, () => {
        if (invoiceStore.purgingTrash) throw new Error('正在整理回收站，请稍后从回收站恢复。');
        const restored = invoiceActions.restoreLedgerEntries(ids);
        toastInfo(`已恢复 ${restored.changed} 张。` + (restored.conflicts ? `另有 ${restored.conflicts} 张同号码记录，请在回收站核对。` : '') + (restored.warning || ''));
      });
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
    const { importExpenseWorkbook } = await import('./lib/expense-import.js');
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
    const { importInputInvoiceWorkbookBytes } = await import('./lib/invoice-ledger.js');
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
  const folders = new Map();
  if (dims.length) for (const inv of arr) folders.set(inv, invoiceFolderParts(inv, dims));
  arr.sort((a, b) => {
    for (let i = 0; i < dims.length; i++) {
      const c = (folders.get(a)[i] || "").localeCompare(folders.get(b)[i] || "", "zh-Hans-CN");
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
