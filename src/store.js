import { reactive } from "vue";
import { renderFileToPages } from "./lib/pdf";
import { recognizePages } from "./lib/ocr";
import { parseDoc } from "./lib/parse";
import { buildTree, buildTreeFromStore, flattenForApply } from "./lib/delivery-tree";
import { loadSuppliers, matchSupplier, normalizeCompanyName } from "./lib/supplier-db";
import { vlConfigured, vlParseDocument } from "./lib/ocr-vl";
import { parseVlToDocs } from "./lib/vl-parse";
import { rotateImageUrl } from "./lib/pdftext";
import { toastWarn } from "./lib/toast";

let seq = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export function makeItem() {
  return { name: "", unit: "", quantity: "", unitPrice: "", total: "" };
}
export function makeDoc() {
  return { id: uid("d"), date: null, dateText: "", orderNo: "", items: [makeItem()] };
}

export const store = reactive({
  partitions: [{ id: "p_default", name: "默认项目" }],
  activePartitionId: "all", // 'all' 或某个分区 id（仅用于过滤显示）
  files: [],
  ocrBusy: false,
  ocrMsg: "",
  staging: null, // 整理树（导入向导/重新整理）：{ tree, mode: 'import'|'reorg' }，确认才生效
  problemsOpen: false, // 问题弹窗（识别失败/无法读取/公司不一致 等需人工处理的事项）
});

// 汇总当前所有"需要人解决的问题"，问题弹窗和工具栏角标共用。
export function collectProblems() {
  const ocrFailed = store.files.filter((f) => f.ocrStatus === "error");
  const unreadable = store.files.filter((f) => f.renderError && !f.pages.length);
  const conflicts = store.files.filter((f) => f.companyConflict && f.companyOcr);
  const partial = store.files.filter((f) => f.ocrStatus === "done" && f.ocrPartial);
  return { ocrFailed, unreadable, conflicts, partial, total: ocrFailed.length + unreadable.length + conflicts.length + partial.length };
}

// 两个公司名是否指同一家：归一化相等，或经分供方库匹配到同一家。
function sameCompany(a, b) {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const suppliers = loadSuppliers();
  const ha = matchSupplier(suppliers, a);
  const hb = matchSupplier(suppliers, b);
  return Boolean(ha && hb && ha.supplier.id === hb.supplier.id);
}

// 建一条文件记录（addFiles 与 整理树应用 共用）。preset 来自整理树。
function makeFileRecord(file, partitionId, preset = {}) {
  const doc = makeDoc();
  if (preset.dateGuess) {
    doc.date = preset.dateGuess;
    doc.dateText = preset.dateGuess;
  }
  const f = reactive({
    id: uid("f"),
    name: file.name,
    blob: file,
    kind: /\.pdf$/i.test(file.name) ? "pdf" : "image",
    partitionId,
    pages: [],
    rendering: true,
    renderError: "",
    company: preset.company || "",
    companySource: preset.company ? "folder" : "", // ''|folder|ocr|manual（CONTEXT：公司来源三层）
    companyOcr: "",
    companyConflict: false,
    specialGroup: preset.special ? preset.groupName || "" : "",
    origin: preset.origin || "",
    merge: true,
    docs: [doc],
    ocrText: "",
    ocrStatus: "idle",
    ocrError: "",
    ocrPartial: "",
    itemCandidates: [],
    note: preset.special && preset.groupName ? `特殊组：${preset.groupName}` : "",
  });
  store.files.push(f);
  renderFileToPages(file)
    .then((r) => {
      f.pages = r.pages;
      f.kind = r.kind;
      f.rendering = false;
      if (r.unsupported) {
        f.renderError = "未从该 PDF 提取到图片（可能是文字版 PDF，非扫描件）。仍可手动填写公司/明细并导出。";
      }
    })
    .catch((e) => {
      f.rendering = false;
      f.renderError = String((e && e.message) || e);
    });
  return f;
}

export const actions = {
  // —— 分区 ——
  addPartition(name) {
    const nm = (name || "").trim() || `项目${store.partitions.length + 1}`;
    const p = { id: uid("p"), name: nm };
    store.partitions.push(p);
    store.activePartitionId = p.id;
    return p;
  },
  renamePartition(id, name) {
    const p = store.partitions.find((x) => x.id === id);
    if (p && name && name.trim()) p.name = name.trim();
  },
  removePartition(id) {
    if (store.partitions.length <= 1) return false; // 至少保留一个
    const idx = store.partitions.findIndex((x) => x.id === id);
    if (idx < 0) return false;
    const fallback = store.partitions[idx === 0 ? 1 : 0].id;
    for (const f of store.files) if (f.partitionId === id) f.partitionId = fallback;
    store.partitions.splice(idx, 1);
    if (store.activePartitionId === id) store.activePartitionId = "all";
    return true;
  },
  setActivePartition(id) {
    store.activePartitionId = id;
  },

  // —— 文件 ——
  async addFiles(fileList, partitionId) {
    const target = partitionId || (store.activePartitionId !== "all" ? store.activePartitionId : store.partitions[0].id);
    const arr = Array.from(fileList).filter((f) => /\.(pdf|png|jpe?g|bmp|webp|gif|tiff?)$/i.test(f.name));
    for (const file of arr) makeFileRecord(file, target);
  },

  // —— 整理树（导入向导 / 重新整理；确认才生效）——
  stageEntries(entries) {
    store.staging = { tree: buildTree(entries, loadSuppliers()), mode: "import" };
    return store.staging.tree;
  },
  stageFromStore() {
    store.staging = { tree: buildTreeFromStore(store.partitions, store.files), mode: "reorg" };
    return store.staging.tree;
  },
  discardStaging() {
    store.staging = null;
  },
  // 应用整理树：新文件建档（公司=文件夹预填），已入库文件改 工地/公司。
  applyStaging() {
    if (!store.staging) return { added: 0, moved: 0 };
    const flat = flattenForApply(store.staging.tree);
    const partByName = new Map(store.partitions.map((p) => [p.name, p]));
    const ensurePartition = (name) => {
      const nm = (name || "").trim() || "默认项目";
      if (partByName.has(nm)) return partByName.get(nm);
      const p = { id: uid("p"), name: nm };
      store.partitions.push(p);
      partByName.set(nm, p);
      return p;
    };
    let added = 0;
    let moved = 0;
    for (const e of flat) {
      const partition = ensurePartition(e.siteName);
      if (e.file) {
        makeFileRecord(e.file, partition.id, e);
        added++;
      } else if (e.fileId) {
        const f = store.files.find((x) => x.id === e.fileId);
        if (!f) continue;
        let touched = false;
        if (f.partitionId !== partition.id) {
          f.partitionId = partition.id;
          touched = true;
        }
        const company = (e.company || "").trim();
        // 重新整理只动"非手动"的公司（手动输入优先级最高，见 CONTEXT 公司来源三层）
        if (company && f.companySource !== "manual" && f.company !== company) {
          f.company = company;
          f.companySource = "folder";
          f.companyConflict = Boolean(f.companyOcr) && !sameCompany(company, f.companyOcr);
          touched = true;
        }
        if (touched) moved++;
      }
    }
    store.staging = null;
    store.activePartitionId = "all";
    return { added, moved };
  },
  moveFile(fileId, partitionId) {
    const f = store.files.find((x) => x.id === fileId);
    if (f) f.partitionId = partitionId;
  },
  removeFile(fileId) {
    const i = store.files.findIndex((x) => x.id === fileId);
    if (i >= 0) store.files.splice(i, 1);
  },
  // —— 公司冲突处理（亮牌上的两个按钮 + 手动输入入口）——
  adoptOcrCompany(f) {
    if (!f.companyOcr) return;
    f.company = f.companyOcr;
    f.companySource = "ocr";
    f.companyConflict = false;
  },
  dismissCompanyConflict(f) {
    f.companyConflict = false;
  },
  setCompanyManual(f, value) {
    f.company = value;
    f.companySource = value ? "manual" : "";
    f.companyConflict = Boolean(value) && Boolean(f.companyOcr) && !sameCompany(value, f.companyOcr);
  },

  addDoc(f) {
    f.docs.push(makeDoc());
  },
  removeDoc(f, docId) {
    const i = f.docs.findIndex((d) => d.id === docId);
    if (i >= 0 && f.docs.length > 1) f.docs.splice(i, 1);
  },

  // —— OCR ——
  // 公司三层来源的统一应用（VL/本地两条路共用）。
  _applyCompanyFromOcr(f, company) {
    f.companyOcr = company || "";
    if (!company) return;
    if (!f.company) {
      f.company = company;
      f.companySource = "ocr";
      f.companyConflict = false;
    } else if (sameCompany(f.company, company)) {
      if (f.companySource === "folder") f.companySource = "ocr";
      f.companyConflict = false;
    } else {
      f.companyConflict = true;
    }
  },

  // 云识别（PaddleOCR-VL）：手写/表格强，自动转正方向；表格直接出材料明细，
  // 一页多张单自动按表格拆成 单1/单2…（ADR-0001）。
  async _runOcrVl(f) {
    store.ocrMsg = "云识别中（PaddleOCR-VL）…";
    const res = await vlParseDocument({ blob: f.blob, filename: f.name }, (m) => (store.ocrMsg = m));
    const parsed = parseVlToDocs(res.markdownPages);
    f.ocrText = parsed.rawText;
    const dateGuess = f.docs[0] && f.docs[0].date; // 文件名预填的日期，VL 没识别出时兜底
    const newDocs = parsed.docs.map((d) => {
      const doc = makeDoc();
      doc.date = d.date || (parsed.docs.length === 1 ? dateGuess : null) || null;
      doc.dateText = doc.date || "";
      doc.orderNo = d.orderNo || "";
      if (d.items.length) doc.items = d.items.map((it) => ({ ...makeItem(), ...it }));
      const notes = [];
      if (d.note) notes.push(d.note); // 行级算术/合计对账 待复核（issue #9）
      if (d.itemsSource === "line") notes.push("材料明细来自散行识别，需复核");
      if (notes.length) doc.note = notes.join("；");
      return doc;
    });
    f.docs.splice(0, f.docs.length, ...newDocs);
    actions._applyCompanyFromOcr(f, parsed.company);
    f.ocrPartial = "";
    f.itemCandidates = [];
    f.ocrEngine = "vl";
    return parsed;
  },

  // 本地识别（内置小模型，离线兜底）：0 行时自动旋转 90/270 重试（横躺扫描件）。
  async _runOcrLocal(f) {
    let pages = f.pages;
    let lines = await recognizePages(pages, (m) => (store.ocrMsg = m));
    if (!lines.length) {
      for (const deg of [90, 270]) {
        store.ocrMsg = `没识别到文字，旋转${deg}°重试…`;
        const rotated = [];
        for (const p of f.pages) rotated.push({ dataUrl: await rotateImageUrl(p.dataUrl, deg) });
        lines = await recognizePages(rotated, (m) => (store.ocrMsg = m));
        if (lines.length) break;
      }
    }
    f.ocrText = lines.join("\n");
    const p = parseDoc(lines);
    const d0 = f.docs[0];
    if (p.date) {
      d0.date = p.date;
      d0.dateText = p.date;
    }
    if (p.orderNo && !d0.orderNo) d0.orderNo = p.orderNo;
    if (p.items && p.items.length) {
      d0.items = p.items.map((it) => ({ ...makeItem(), ...it }));
      d0.note = "材料明细来自散行识别，需复核";
    }
    actions._applyCompanyFromOcr(f, p.company);
    f.itemCandidates = p.itemCandidates;
    const failedPages = recognizePages.lastFailedPages || [];
    f.ocrPartial = failedPages.length ? failedPages.map((x) => `第${x.page}页：${x.reason}`).join("；") : "";
    recognizePages.lastFailedPages = [];
    f.ocrEngine = "local";
  },

  async runOcr(f) {
    if (f.rendering) return;
    f.ocrStatus = "running";
    f.ocrError = "";
    store.ocrBusy = true;
    try {
      if (vlConfigured()) {
        try {
          await actions._runOcrVl(f);
        } catch (e) {
          // 云失败回退本地：提示但不中断
          toastWarn(`云识别失败，已转本地识别。\n${String((e && e.message) || e)}`);
          if (!f.pages.length) throw e;
          await actions._runOcrLocal(f);
        }
      } else {
        if (!f.pages.length) throw new Error("该文件没有可识别的页图（文字版 PDF 请配置云识别或手动录入）。");
        await actions._runOcrLocal(f);
      }
      f.ocrStatus = "done";
      store.ocrMsg = "识别完成，请人工核对。";
    } catch (e) {
      f.ocrStatus = "error";
      f.ocrError = String((e && e.message) || e);
      store.ocrMsg = "OCR 失败：" + f.ocrError;
    } finally {
      store.ocrBusy = false;
    }
  },
  async runOcrAll() {
    for (const f of store.files) {
      if (f.ocrStatus !== "done") await actions.runOcr(f);
    }
    // 批量结束：有需要人工处理的问题就弹窗逐项列出（用户要求）
    if (collectProblems().total > 0) store.problemsOpen = true;
  },
  // 重试所有识别失败的文件（问题弹窗里的按钮）
  async retryFailedOcr() {
    const failed = store.files.filter((f) => f.ocrStatus === "error");
    for (const f of failed) {
      f.ocrStatus = "idle";
      f.ocrError = "";
      await actions.runOcr(f);
    }
    if (collectProblems().total > 0) store.problemsOpen = true;
  },
};

export function partitionName(id) {
  const p = store.partitions.find((x) => x.id === id);
  return p ? p.name : "(已删除)";
}
export function filesIn(partitionId) {
  return store.files.filter((f) => f.partitionId === partitionId);
}
