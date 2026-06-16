// 整理树：上传工地文件夹后的 工地→组→文件 模型与规则（issue #5）。
// 纯逻辑、不碰 DOM/File 内部，Node 可测。决策依据见 CONTEXT.md「整理树/特殊组/公司来源三层」。
//
// 构建规则（与用户逐条确认过）：
//   1) 默认最外层文件夹=工地；根文件夹名命中分供方简称 → 视为组，挂"（未命名工地）"。
//   2) 节点可升/降级（"是工地"复选框）：promoteGroupToSite / demoteSiteToGroup。
//   3) 工地内第一层子文件夹=组；更深层并入所属组。
//   4) 特殊组（未签合同/收据/协议/纯数字名等）只是中转：组名即临时公司名，识别后以红章为准。
//   5) 归一化后同名的组自动合并（"智道"与"智道(1)"、"兆鑫建 材"）。
//   6) 工地根目录散文件 → "（待分组）"；文件名命中本工地其它组 → 给"疑似→"建议（不自动移）。
//   7) 文件名里的日期（2026.5.23 / 2026-05-23）解析为 dateGuess 预填。
import { matchSupplier, normalizeCompanyName } from "./supplier-db.js";
import { isSupportedFile } from "./upload.js";

let seq = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export const UNNAMED_SITE = "（未命名工地）";
export const PENDING_GROUP = "（待分组）";

const SPECIAL_RE = /(未签合同|收据|协议|合同|台帐|台账|账户|凭证|杂项|其它|其他)/;
// 形如 "4-未签合同-送货单" 的序号前缀；"1" 这种纯数字文件夹也按特殊组处理
const NUM_PREFIX_RE = /^\d+\s*[-、.．]\s*/;

// 文件夹名 → 用于匹配/展示的干净名（去序号前缀、去首尾空白；不动中间内容）
export function cleanFolderName(name) {
  return String(name || "").replace(NUM_PREFIX_RE, "").trim();
}

// 工地名建议：去掉常见的"送货单共享文件夹"类后缀（原名保留在 rawName 里，可改回）
export function suggestSiteName(rawName) {
  const s = String(rawName || "").trim();
  const cleaned = s.replace(/(送货单)?(共享)?文件夹$/g, "").replace(/送货单$/g, "").trim();
  return cleaned || s;
}

export function isSpecialFolderName(name) {
  const raw = String(name || "").trim();
  if (!raw) return false;
  if (/^\d+$/.test(raw)) return true;
  return SPECIAL_RE.test(raw);
}

// 文件名日期：2026.5.23 / 2026-05-23 / 2026年5月23日 →  ISO；没有年份不猜。
export function dateFromFilename(name) {
  const m = String(name || "").match(/(20\d{2})\s*[年.\-\/]\s*(\d{1,2})\s*[月.\-\/]\s*(\d{1,2})/);
  if (!m) return "";
  const mo = +m[2];
  const d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function newFileNode(entry) {
  const name = entry.file ? entry.file.name : entry.name;
  return {
    key: uid("tf"),
    name,
    relPath: entry.relPath || name,
    file: entry.file || null, // 新导入：File 对象
    fileId: entry.fileId || "", // 重新整理：已入库文件 id
    dateGuess: dateFromFilename(name),
    suggestGroupKey: "", // 疑似归属（仅提示，不自动移）
    suggestLabel: "",
  };
}

function newGroupNode(rawName, suppliers) {
  const cleaned = cleanFolderName(rawName);
  const special = isSpecialFolderName(rawName) || !cleaned;
  let mappedName = "";
  let via = "";
  if (!special) {
    const hit = matchSupplier(suppliers, cleaned);
    if (hit) {
      mappedName = hit.supplier.name;
      via = hit.via;
    }
  }
  return {
    key: uid("tg"),
    rawName: String(rawName || "").trim(),
    kind: special ? "special" : "supplier",
    mappedName,
    via, // name/alias/fuzzy/""
    company: special ? cleaned || String(rawName || "").trim() : mappedName || cleaned,
    mergedFrom: [], // 被自动合并进来的原文件夹名
    files: [],
  };
}

function newSiteNode(rawName) {
  return {
    key: uid("ts"),
    rawName: String(rawName || "").trim(),
    name: suggestSiteName(rawName) || UNNAMED_SITE,
    groups: [],
  };
}

function findOrCreateGroup(site, rawName, suppliers) {
  const norm = normalizeCompanyName(cleanFolderName(rawName));
  let g = site.groups.find((x) => normalizeCompanyName(cleanFolderName(x.rawName)) === norm);
  if (g) {
    if (g.rawName !== String(rawName || "").trim() && !g.mergedFrom.includes(rawName)) g.mergedFrom.push(String(rawName).trim());
    return g;
  }
  g = newGroupNode(rawName, suppliers);
  site.groups.push(g);
  return g;
}

function pendingGroup(site) {
  let g = site.groups.find((x) => x.rawName === PENDING_GROUP);
  if (!g) {
    g = { key: uid("tg"), rawName: PENDING_GROUP, kind: "special", mappedName: "", via: "", company: "", mergedFrom: [], files: [] };
    site.groups.push(g);
  }
  return g;
}

// —— 主构建：entries [{file, relPath}] + 分供方列表 → { sites, ignored } ——
export function buildTree(entries, suppliers = []) {
  const tree = { sites: [], ignored: 0 };
  const siteByRoot = new Map();
  let unnamedSite = null;
  const ensureUnnamed = () => {
    if (!unnamedSite) {
      unnamedSite = newSiteNode(UNNAMED_SITE);
      unnamedSite.name = UNNAMED_SITE;
      tree.sites.push(unnamedSite);
    }
    return unnamedSite;
  };

  for (const entry of entries || []) {
    const file = entry.file;
    if (!isSupportedFile(file)) {
      tree.ignored++;
      continue;
    }
    const segs = String(entry.relPath || file.name).split("/").filter(Boolean);
    if (segs.length <= 1) {
      // 拖入的散文件：挂（未命名工地）/（待分组）
      pendingGroup(ensureUnnamed()).files.push(newFileNode(entry));
      continue;
    }
    const rootName = segs[0];
    // 根文件夹名命中分供方 → 它是组不是工地
    const rootHit = matchSupplier(suppliers, cleanFolderName(rootName));
    if (rootHit && !isSpecialFolderName(rootName)) {
      const site = ensureUnnamed();
      const g = findOrCreateGroup(site, rootName, suppliers);
      g.files.push(newFileNode(entry));
      continue;
    }
    let site = siteByRoot.get(rootName);
    if (!site) {
      site = newSiteNode(rootName);
      siteByRoot.set(rootName, site);
      tree.sites.push(site);
    }
    if (segs.length === 2) {
      // 工地根目录散文件
      pendingGroup(site).files.push(newFileNode(entry));
    } else {
      // segs[1] 是组；更深层并入该组
      const g = findOrCreateGroup(site, segs[1], suppliers);
      g.files.push(newFileNode(entry));
    }
  }

  computeSuggestions(tree);
  return tree;
}

// 特殊组/待分组里的文件名命中本工地某个供应商组 → 标"疑似→该组"
export function computeSuggestions(tree) {
  for (const site of tree.sites) {
    const supplierGroups = site.groups.filter((g) => g.kind === "supplier");
    for (const g of site.groups) {
      for (const f of g.files) {
        f.suggestGroupKey = "";
        f.suggestLabel = "";
        if (g.kind !== "special") continue;
        for (const sg of supplierGroups) {
          const names = [sg.company, sg.mappedName, cleanFolderName(sg.rawName)].filter(Boolean);
          const base = String(f.name).replace(/\.[^.]+$/, "");
          if (names.some((n) => n && base.includes(cleanFolderName(n).slice(0, 4)) && cleanFolderName(n).length >= 2 && base.includes(cleanFolderName(n)))) {
            f.suggestGroupKey = sg.key;
            f.suggestLabel = sg.company || sg.rawName;
            break;
          }
        }
      }
    }
  }
}

// —— 从已入库数据重建树（"重新整理"模式）——
export function buildTreeFromStore(partitions, files) {
  const tree = { sites: [], ignored: 0 };
  const siteByPartition = new Map();
  for (const p of partitions || []) {
    const site = newSiteNode(p.name);
    site.name = p.name;
    site.partitionId = p.id;
    siteByPartition.set(p.id, site);
    tree.sites.push(site);
  }
  for (const f of files || []) {
    const site = siteByPartition.get(f.partitionId) || tree.sites[0];
    if (!site) continue;
    const label = (f.company || "").trim() || PENDING_GROUP;
    let g = site.groups.find((x) => x.rawName === label);
    if (!g) {
      g = { key: uid("tg"), rawName: label, kind: label === PENDING_GROUP ? "special" : "supplier", mappedName: "", via: "", company: label === PENDING_GROUP ? "" : label, mergedFrom: [], files: [] };
      site.groups.push(g);
    }
    g.files.push(newFileNode({ fileId: f.id, name: f.name, relPath: f.name }));
  }
  return tree;
}

// —— 树操作（UI 调用）——
export function addSite(tree, name) {
  const s = newSiteNode(name || "新工地");
  s.name = (name || "").trim() || "新工地";
  tree.sites.push(s);
  return s;
}

export function findGroup(tree, groupKey) {
  for (const s of tree.sites) {
    const g = s.groups.find((x) => x.key === groupKey);
    if (g) return { site: s, group: g };
  }
  return null;
}

export function findFile(tree, fileKey) {
  for (const s of tree.sites) {
    for (const g of s.groups) {
      const i = g.files.findIndex((x) => x.key === fileKey);
      if (i >= 0) return { site: s, group: g, index: i, file: g.files[i] };
    }
  }
  return null;
}

export function moveFile(tree, fileKey, targetGroupKey) {
  const from = findFile(tree, fileKey);
  const to = findGroup(tree, targetGroupKey);
  if (!from || !to || from.group.key === targetGroupKey) return false;
  from.group.files.splice(from.index, 1);
  to.group.files.push(from.file);
  return true;
}

export function moveGroup(tree, groupKey, targetSiteKey) {
  const hit = findGroup(tree, groupKey);
  const target = tree.sites.find((s) => s.key === targetSiteKey);
  if (!hit || !target || hit.site.key === targetSiteKey) return false;
  hit.site.groups.splice(hit.site.groups.indexOf(hit.group), 1);
  target.groups.push(hit.group);
  return true;
}

// —— 删除（issue #15）：仅从 staging 树移除，不动磁盘原文件，确认导入后不入库 ——
export function removeFile(tree, fileKey) {
  const hit = findFile(tree, fileKey);
  if (!hit) return false;
  hit.group.files.splice(hit.index, 1);
  return true;
}

export function removeGroup(tree, groupKey) {
  const hit = findGroup(tree, groupKey);
  if (!hit) return false;
  hit.site.groups.splice(hit.site.groups.indexOf(hit.group), 1);
  return true;
}

export function removeSite(tree, siteKey) {
  const i = tree.sites.findIndex((s) => s.key === siteKey);
  if (i < 0) return false;
  tree.sites.splice(i, 1);
  return true;
}

// 组 → 升级为工地（"是工地"勾上）：新工地名取组名，文件归入"（待分组）"等待细分？
// 不——按用户场景（拖了父文件夹，第二层才是工地），升级后该组的文件多半还带着
// 第三层文件夹信息丢失，保守做法：整组变成新工地下的同名组。
export function promoteGroupToSite(tree, groupKey) {
  const hit = findGroup(tree, groupKey);
  if (!hit) return null;
  hit.site.groups.splice(hit.site.groups.indexOf(hit.group), 1);
  const s = newSiteNode(hit.group.rawName);
  s.groups.push(hit.group);
  tree.sites.push(s);
  if (!hit.site.groups.length) {
    const i = tree.sites.indexOf(hit.site);
    if (i >= 0) tree.sites.splice(i, 1); // 空工地顺手清掉
  }
  return s;
}

// 工地 → 降级为某工地下的组（"是工地"取消）：它的所有组并过去，保持各自公司
export function demoteSiteToGroup(tree, siteKey, targetSiteKey) {
  const site = tree.sites.find((s) => s.key === siteKey);
  const target = tree.sites.find((s) => s.key === targetSiteKey);
  if (!site || !target || site === target) return false;
  for (const g of site.groups) target.groups.push(g);
  tree.sites.splice(tree.sites.indexOf(site), 1);
  return true;
}

export function setGroupCompany(tree, groupKey, company) {
  const hit = findGroup(tree, groupKey);
  if (!hit) return false;
  hit.group.company = String(company || "").trim();
  return true;
}

export function addGroup(tree, siteKey, name) {
  const site = tree.sites.find((s) => s.key === siteKey);
  if (!site) return null;
  const g = newGroupNode(name || "新分组", []);
  g.company = cleanFolderName(name || "");
  site.groups.push(g);
  return g;
}

export function treeStats(tree) {
  let sites = 0;
  let groups = 0;
  let files = 0;
  let unmapped = 0;
  for (const s of tree.sites) {
    sites++;
    for (const g of s.groups) {
      groups++;
      files += g.files.length;
      if (g.kind === "supplier" && !g.mappedName) unmapped++;
    }
  }
  return { sites, groups, files, unmapped, ignored: tree.ignored || 0 };
}

// —— 确认应用：拍平成入库指令 ——
// 新文件（file）→ 建档；已入库（fileId）→ 改归属。company 为空的特殊组文件，
// 公司留空待识别填；非空则作为"文件夹预填"（companySource=folder）。
export function flattenForApply(tree) {
  const out = [];
  for (const s of tree.sites) {
    for (const g of s.groups) {
      for (const f of g.files) {
        out.push({
          file: f.file || null,
          fileId: f.fileId || "",
          siteName: s.name || s.rawName || UNNAMED_SITE,
          company: (g.company || "").trim(),
          special: g.kind === "special",
          groupName: cleanFolderName(g.rawName) || g.rawName,
          dateGuess: f.dateGuess || "",
          origin: f.relPath || f.name,
        });
      }
    }
  }
  return out;
}
