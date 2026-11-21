import { appStorage } from './app-storage.js';
// 分供方（供应商）资料库：公司全称、简称/别名、税号、开户行、银行账号、联系人等。
// 本地持久化（桌面版使用便携数据目录）；提供 名称归一化 + 模糊匹配，
// 供送货单子文件夹简称（大板东 / 兆鑫建 材 / 智道(1)）对应到公司全称。issue #6
import { reactive } from "vue";

const STORAGE_KEY = "supplierDb.v1";

let seq = 0;
const uid = () => `sup_${Date.now().toString(36)}_${(seq++).toString(36)}`;

// Node 自测环境没有 localStorage，用内存兜底（不持久化）。
const mem = { v: "" };
function storageGet() {
  try {
    if (typeof localStorage !== "undefined") return appStorage.getItem(STORAGE_KEY) || "";
  } catch (e) { /* ignore */ }
  return mem.v;
}
function storageSet(v) {
  try {
    if (typeof localStorage !== "undefined") { appStorage.setItem(STORAGE_KEY, v); return; }
  } catch (e) { throw new Error("分供方保存失败：" + e.message); }
  mem.v = v;
}

export function emptySupplier() {
  return {
    id: uid(),
    name: "",
    type: "大宗供应商", shortName: "", attachments: [], status: "待补全",
    aliases: [],
    taxNo: "",
    bank: "",
    bankAccount: "",
    contact: "",
    phone: "",
    note: "",
    source: "manual",
    purchases: [], // 采购记录 [{id,date,site,item,unit,quantity,unitPrice,total,note}]
    payments: [],  // 支付记录 [{id,date,site,amount,method,note}]
  };
}

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

export const supplierStore = reactive({ list: loadSuppliers() });
export function saveSuppliers(list) {
  const next = [...(list || [])];
  storageSet(JSON.stringify(next));
  supplierStore.list = next;
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
    const hit = matchSupplierExact(list, name);
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

export function matchSupplierExact(list, name) {
 const n=normalizeCompanyName(name);if(!n)return null;
 const hits=list.filter(s=>[s.name,s.shortName,s.invoiceName,...(s.aliases||[])].some(v=>v&&normalizeCompanyName(v)===n));
 return hits.length===1?{supplier:hits[0],via:normalizeCompanyName(hits[0].name)===n?'name':'alias'}:null;
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
    const hit = matchSupplierExact(supplierStore.list.some(s=>s.id===supplier.id)?supplierStore.list:[supplier], company);
    if (!hit || hit.supplier.id!==supplier.id) continue;
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
