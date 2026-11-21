import { appStorage } from './app-storage.js';
import { reactive } from 'vue';
import { normalizeCompanyName, matchSupplierExact, supplierStore } from './supplier-directory.js';
const key='expenseDirectory.v1';
let saved={}; try { saved=JSON.parse(appStorage.getItem(key)||'{}'); } catch {}
export const directory=reactive({buyers:[],projects:[],allocations:[],people:[],tags:[],purposes:[],paymentMethods:["微信","支付宝","银行转账","现金","其他"],rules:[],aliases:[],deletedArchives:[],...saved});
export function saveDirectory(next) { appStorage.setItem(key,JSON.stringify(next)); Object.assign(directory,next); }
export function deleteArchive(kind, value) {
 if (!Array.isArray(directory[kind]) || !directory[kind].includes(value)) return;
 saveDirectory({...directory,[kind]:directory[kind].filter(v=>v!==value),deletedArchives:[...directory.deletedArchives.filter(r=>r.kind!==kind||r.value!==value),{kind,value,deletedAt:new Date().toISOString()}]});
}
export function restoreArchive(kind, value) {
 const record = directory.deletedArchives.find(r => r.kind === kind && r.value === value);
 if (!record) return;
 if (kind === 'aliases') {
   if (directory.aliases.some(item => archiveKey(item.name) === archiveKey(value))) throw new Error('已有同名别名，请先处理冲突。');
   saveDirectory({ ...directory, aliases: [...directory.aliases, record.alias],
     deletedArchives: directory.deletedArchives.filter(item => item !== record) });
   return;
 }
 saveDirectory({...directory,[kind]:[...new Set([...directory[kind],value])],deletedArchives:directory.deletedArchives.filter(r=>r.kind!==kind||r.value!==value)});
}
// 仅清理已删除档案备份，票据中的名称和现有档案不受影响。
export function purgeDeletedArchives(items) {
 const selected = new Set(items.map(item => JSON.stringify([item.kind, item.value])));
 const remaining = directory.deletedArchives.filter(item => !selected.has(JSON.stringify([item.kind, item.value])));
 const changed = directory.deletedArchives.length - remaining.length;
 if (changed) saveDirectory({ ...directory, deletedArchives: remaining });
 return changed;
}
export function isAllocationRuleActive(rule) { return directory.buyers.includes(rule.buyer) && directory.projects.includes(rule.project); }
export function suggestAllocation(seller,buyer='') {
 const rules=directory.rules.filter(r=>isAllocationRuleActive(r) && (normalizeCompanyName(r.seller)===normalizeCompanyName(seller) || (matchSupplierExact(supplierStore.list,r.seller)?.supplier.id && matchSupplierExact(supplierStore.list,r.seller)?.supplier.id===matchSupplierExact(supplierStore.list,seller)?.supplier.id)) && (!buyer || normalizeCompanyName(r.buyer)===normalizeCompanyName(buyer)));
 return rules.length===1 ? rules[0] : null;
}

const archiveKey = value => String(value || '').trim().normalize('NFKC').replace(/\s+/gu, '').toLowerCase();

export function resolveArchiveName(kind, value) {
  const normalized = archiveKey(value);
  if (!normalized) return value;
  const names = directory[kind] || [];
  const standard = names.find(name => archiveKey(name) === normalized);
  if (standard) return standard;
  const alias = directory.aliases.find(item => item.kind === kind && archiveKey(item.name) === normalized);
  return alias && names.includes(alias.target) ? alias.target : value;
}

export function addArchiveAlias(alias) {
  if (!['buyers', 'projects'].includes(alias.kind) || !directory[alias.kind].includes(alias.target) || !alias.name) {
    throw new Error('请输入别名并选择有效的档案标准名。');
  }
  const key = archiveKey(alias.name);
  if (directory[alias.kind].some(name => archiveKey(name) === key) || directory.aliases.some(item => archiveKey(item.name) === key)) {
    throw new Error('该名称与已有档案或别名重复。');
  }
  saveDirectory({ ...directory, aliases: [...directory.aliases, alias],
    deletedArchives: directory.deletedArchives.filter(item => item.kind !== 'aliases' || archiveKey(item.value) !== key) });
}

export function removeArchiveAlias(alias) {
  if (!directory.aliases.includes(alias)) return;
  saveDirectory({ ...directory, aliases: directory.aliases.filter(item => item !== alias),
    deletedArchives: [...directory.deletedArchives, { kind: 'aliases', value: alias.name, alias: { ...alias }, deletedAt: new Date().toISOString() }] });
}
