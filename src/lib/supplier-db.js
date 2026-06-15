// 分供方（供应商）资料库：公司全称、简称/别名、税号、开户行、银行账号、联系人等。
// 本地持久化（localStorage，沿用台账模式）；提供 名称归一化 + 模糊匹配，
// 供送货单子文件夹简称（大板东 / 兆鑫建 材 / 智道(1)）对应到公司全称。issue #6
import * as XLSX from "xlsx";

const STORAGE_KEY = "supplierDb.v1";

let seq = 0;
const uid = () => `sup_${Date.now().toString(36)}_${(seq++).toString(36)}`;

// Node 自测环境没有 localStorage，用内存兜底（不持久化）。
const mem = { v: "" };
function storageGet() {
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(STORAGE_KEY) || "";
  } catch (e) { /* ignore */ }
  return mem.v;
}
function storageSet(v) {
  try {
    if (typeof localStorage !== "undefined") { localStorage.setItem(STORAGE_KEY, v); return; }
  } catch (e) { /* ignore */ }
  mem.v = v;
}

export function emptySupplier() {
  return {
    id: uid(),
    name: "",
    aliases: [],
    taxNo: "",
    legalRep: "", // 法人(法定代表人) —— 营业执照/法人身份证回填
    address: "",  // 注册地址 —— 营业执照回填
    bank: "",
    bankAccount: "",
    contact: "",
    phone: "",
    note: "",
    source: "manual",
    attachments: [], // 附件档案 [{id,category,fileName,relPath,ext,addedAt}]（ADR-0002）
    purchases: [], // 采购记录 [{id,date,site,item,unit,quantity,unitPrice,total,note}]
    payments: [],  // 支付记录 [{id,date,site,amount,method,note}]
  };
}

// 附件类别（取自 送货单/公司信息 模板的命名）。
export const ATTACHMENT_CATEGORIES = ["营业执照", "法人身份证", "银行开户许可证", "签约代表身份证", "品牌授权证明", "其他"];

export function emptyPurchase() {
  return { id: uid(), date: "", site: "", item: "", unit: "", quantity: "", unitPrice: "", total: "", note: "" };
}
export function emptyPayment() {
  return { id: uid(), date: "", site: "", amount: "", method: "", note: "" };
}

export function loadSuppliers() {
  try {
    const raw = storageGet();
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((s) => s && s.name) : [];
  } catch (e) {
    return [];
  }
}

export function saveSuppliers(list) {
  storageSet(JSON.stringify(list || []));
}

// —— 名称归一化：全半角(NFKC)、去所有空白、去尾部 (1)/（2）序号、去常见公司后缀 ——
// 「兆鑫建 材」->「兆鑫建材」；「佛山市智道建筑材料有限公司(1)」->「佛山市智道建筑材料有限公司」
export function normalizeCompanyName(s) {
  return String(s || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[（(]\s*\d+\s*[）)]\s*$/g, "")
    .toLowerCase();
}

// 比对用的“核心名”：在归一化之上再去掉 省市区前缀常见字 和 公司后缀，
// 让「大板东」能命中「广州市大板东建材有限公司」。
const SUFFIX_RE = /(股份有限公司|有限责任公司|有限公司|经营部|商行|商贸|贸易|建材|科技|实业|工程|公司|厂|店)+$/;
export function coreCompanyName(s) {
  let t = normalizeCompanyName(s);
  t = t.replace(SUFFIX_RE, "");
  return t;
}

// 在供应商列表里匹配一个名字（文件夹名/识别出的章名）。返回 { supplier, via } 或 null。
// 优先级：全称精确 > 别名精确 > 核心名包含（短名⊂全称 或 全称核心⊂短名，长度≥2）。
export function matchSupplier(list, rawName) {
  const n = normalizeCompanyName(rawName);
  if (!n) return null;
  for (const s of list) {
    if (normalizeCompanyName(s.name) === n) return { supplier: s, via: "name" };
  }
  for (const s of list) {
    for (const a of s.aliases || []) {
      if (normalizeCompanyName(a) === n) return { supplier: s, via: "alias" };
    }
  }
  const core = coreCompanyName(rawName);
  if (core.length >= 2) {
    let best = null;
    for (const s of list) {
      const sCore = coreCompanyName(s.name);
      const aliasCores = (s.aliases || []).map(coreCompanyName);
      const hit =
        sCore.includes(core) || core.includes(sCore) ||
        aliasCores.some((a) => a && (a.includes(core) || core.includes(a)));
      if (hit) {
        // 取核心名更长（更具体）的那个，避免「建材」这种过泛匹配
        if (!best || sCore.length > coreCompanyName(best.name).length) best = s;
      }
    }
    if (best) return { supplier: best, via: "fuzzy" };
  }
  return null;
}

// 从识别完的发票收集销售方：新名字入库，已有的补税号/别名。返回 {added, updated}
// 发票字段没单独存销售方税号，从 rawText 里取第 2 个统一社会信用代码（购在前、销在后）。
export function sellerTaxNoFromRawText(rawText) {
  const codes = [...String(rawText || "").matchAll(/纳税人识别号\s*[:：]?\s*([0-9A-Z]{15,20})/g)].map((m) => m[1]);
  return codes.length >= 2 ? codes[1] : "";
}

export function collectFromInvoices(list, invoices) {
  let added = 0;
  let updated = 0;
  for (const inv of invoices || []) {
    const name = ((inv.fields && inv.fields.seller) || "").trim();
    if (!name) continue;
    const taxNo = sellerTaxNoFromRawText(inv.rawText);
    const hit = matchSupplier(list, name);
    if (!hit) {
      const s = emptySupplier();
      s.name = name;
      s.taxNo = taxNo;
      s.source = "invoice";
      list.push(s);
      added++;
    } else {
      const s = hit.supplier;
      let touched = false;
      if (taxNo && !s.taxNo) { s.taxNo = taxNo; touched = true; }
      // 识别名和库里全称不同（如简称命中），记成别名方便下次直配
      if (hit.via !== "name" && normalizeCompanyName(s.name) !== normalizeCompanyName(name)) {
        const aliases = s.aliases || (s.aliases = []);
        if (!aliases.some((a) => normalizeCompanyName(a) === normalizeCompanyName(name))) {
          aliases.push(name);
          touched = true;
        }
      }
      if (touched) updated++;
    }
  }
  return { added, updated };
}

// —— Excel 导入/导出 ——
const EXPORT_HEADERS = ["公司全称", "简称/别名", "公司税号", "法人", "注册地址", "开户行", "银行账号", "联系人", "电话", "备注"];

export function exportSuppliersWorkbookBytes(list) {
  const rows = [EXPORT_HEADERS.slice()];
  for (const s of list) {
    rows.push([s.name, (s.aliases || []).join("、"), s.taxNo, s.legalRep || "", s.address || "", s.bank, s.bankAccount, s.contact, s.phone, s.note]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 30 }, { wch: 20 }, { wch: 22 }, { wch: 10 }, { wch: 30 }, { wch: 24 }, { wch: 22 }, { wch: 10 }, { wch: 14 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "分供方");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

// 表头按关键词模糊认列，兼容台账类 Excel。
function headerIndex(headers, keys) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || "").replace(/\s/g, "");
    if (keys.some((k) => h.includes(k))) return i;
  }
  return -1;
}

export function importSuppliersWorkbookBytes(list, bytes) {
  const wb = XLSX.read(bytes, { type: "array" });
  let imported = 0;
  let added = 0;
  let updated = 0;
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    if (!rows.length) continue;
    const head = rows[0].map(String);
    const iName = headerIndex(head, ["公司全称", "公司名称", "销售方", "供应商", "单位名称", "名称"]);
    if (iName < 0) continue;
    const iAlias = headerIndex(head, ["简称", "别名"]);
    const iTax = headerIndex(head, ["税号", "纳税人识别号", "信用代码"]);
    const iLegalRep = headerIndex(head, ["法人", "法定代表人"]);
    const iAddress = headerIndex(head, ["注册地址", "地址"]);
    const iBank = headerIndex(head, ["开户行", "开户银行"]);
    const iAcct = headerIndex(head, ["银行账号", "账号", "账户"]);
    const iContact = headerIndex(head, ["联系人"]);
    const iPhone = headerIndex(head, ["电话", "手机"]);
    const iNote = headerIndex(head, ["备注"]);
    for (const r of rows.slice(1)) {
      const name = String(r[iName] || "").trim();
      if (!name || name.length < 2) continue;
      imported++;
      const aliases = iAlias >= 0 ? String(r[iAlias] || "").split(/[、,，;；/]+/).map((x) => x.trim()).filter(Boolean) : [];
      const patch = {
        taxNo: iTax >= 0 ? String(r[iTax] || "").trim() : "",
        legalRep: iLegalRep >= 0 ? String(r[iLegalRep] || "").trim() : "",
        address: iAddress >= 0 ? String(r[iAddress] || "").trim() : "",
        bank: iBank >= 0 ? String(r[iBank] || "").trim() : "",
        bankAccount: iAcct >= 0 ? String(r[iAcct] || "").trim() : "",
        contact: iContact >= 0 ? String(r[iContact] || "").trim() : "",
        phone: iPhone >= 0 ? String(r[iPhone] || "").trim() : "",
        note: iNote >= 0 ? String(r[iNote] || "").trim() : "",
      };
      const hit = matchSupplier(list, name);
      if (!hit) {
        const s = emptySupplier();
        s.name = name;
        s.aliases = aliases;
        Object.assign(s, patch);
        s.source = "excel";
        list.push(s);
        added++;
      } else {
        const s = hit.supplier;
        let touched = false;
        for (const k of Object.keys(patch)) {
          if (patch[k] && !s[k]) { s[k] = patch[k]; touched = true; }
        }
        const al = s.aliases || (s.aliases = []);
        for (const a of aliases) {
          if (!al.some((x) => normalizeCompanyName(x) === normalizeCompanyName(a))) { al.push(a); touched = true; }
        }
        if (touched) updated++;
      }
    }
    break; // 只取第一个有公司列的工作表
  }
  return { imported, added, updated };
}

// 公司信息查询：用爱企查（百度，免登录可看基本信息；企查查要登录体验差）
export function companySearchUrl(name) {
  return `https://aiqicha.baidu.com/s?q=${encodeURIComponent(String(name || "").trim())}`;
}

// —— 合作数据聚合：从送货单整理的数据里，汇总该分供方的 合作工地 / 材料明细 ——
// files: 送货单 store.files；partitions: store.partitions。
// 按 file.company 与分供方（全称/别名/模糊）匹配；返回 { sites, items, totalAmount }。
export function aggregateSupplierDelivery(supplier, files, partitions) {
  const partName = (id) => (partitions.find((p) => p.id === id) || {}).name || "(未分区)";
  const sites = new Map(); // siteName -> { name, fileCount, amount }
  const items = [];
  let totalAmount = 0;
  for (const f of files || []) {
    const company = (f.company || "").trim();
    if (!company) continue;
    const hit = matchSupplier([supplier], company);
    if (!hit) continue;
    const site = partName(f.partitionId);
    if (!sites.has(site)) sites.set(site, { name: site, fileCount: 0, amount: 0 });
    const s = sites.get(site);
    s.fileCount++;
    for (const d of f.docs || []) {
      for (const it of d.items || []) {
        const total = Number(it.total) || 0;
        s.amount += total;
        totalAmount += total;
        items.push({
          site,
          date: d.date || d.dateText || "",
          name: it.name || "",
          unit: it.unit || "",
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          total: it.total,
        });
      }
    }
  }
  items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { sites: [...sites.values()], items, totalAmount: Math.round(totalAmount * 100) / 100 };
}
