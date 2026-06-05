import { reactive } from "vue";
import { renderFileToPages } from "./lib/pdf";
import { recognizePages } from "./lib/ocr";
import { parseDoc } from "./lib/parse";

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
});

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
    for (const file of arr) {
      const f = reactive({
        id: uid("f"),
        name: file.name,
        blob: file,
        kind: /\.pdf$/i.test(file.name) ? "pdf" : "image",
        partitionId: target,
        pages: [],
        rendering: true,
        renderError: "",
        company: "",
        companySource: "",
        merge: true,
        docs: [makeDoc()],
        ocrText: "",
        ocrStatus: "idle",
        ocrError: "",
        itemCandidates: [],
        note: "",
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
    }
  },
  moveFile(fileId, partitionId) {
    const f = store.files.find((x) => x.id === fileId);
    if (f) f.partitionId = partitionId;
  },
  removeFile(fileId) {
    const i = store.files.findIndex((x) => x.id === fileId);
    if (i >= 0) store.files.splice(i, 1);
  },
  addDoc(f) {
    f.docs.push(makeDoc());
  },
  removeDoc(f, docId) {
    const i = f.docs.findIndex((d) => d.id === docId);
    if (i >= 0 && f.docs.length > 1) f.docs.splice(i, 1);
  },

  // —— OCR ——
  async runOcr(f) {
    if (f.rendering || !f.pages.length) return;
    f.ocrStatus = "running";
    f.ocrError = "";
    store.ocrBusy = true;
    try {
      const lines = await recognizePages(f.pages, (m) => (store.ocrMsg = m));
      f.ocrText = lines.join("\n");
      const p = parseDoc(lines);
      const d0 = f.docs[0];
      if (p.date) {
        d0.date = p.date;
        d0.dateText = p.date;
      }
      if (p.orderNo && !d0.orderNo) d0.orderNo = p.orderNo;
      if (p.company && !f.company) {
        f.company = p.company;
        f.companySource = "ocr";
      }
      f.itemCandidates = p.itemCandidates;
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
  },
};

export function partitionName(id) {
  const p = store.partitions.find((x) => x.id === id);
  return p ? p.name : "(已删除)";
}
export function filesIn(partitionId) {
  return store.files.filter((f) => f.partitionId === partitionId);
}
