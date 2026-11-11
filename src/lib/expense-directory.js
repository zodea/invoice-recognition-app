import { reactive } from 'vue';
const key='expenseDirectory.v1';
let saved={}; try { saved=JSON.parse(localStorage.getItem(key)||'{}'); } catch {}
export const directory=reactive({buyers:[],projects:[],people:[],tags:[],purposes:[],paymentMethods:["微信","支付宝","银行转账","现金","其他"],rules:[],deletedArchives:[],...saved});
export function saveDirectory(next) { localStorage.setItem(key,JSON.stringify(next)); Object.assign(directory,next); }
export function deleteArchive(kind, value) {
 if (!Array.isArray(directory[kind]) || !directory[kind].includes(value)) return;
 saveDirectory({...directory,[kind]:directory[kind].filter(v=>v!==value),deletedArchives:[...directory.deletedArchives.filter(r=>r.kind!==kind||r.value!==value),{kind,value,deletedAt:new Date().toISOString()}]});
}
export function restoreArchive(kind, value) {
 if (!directory.deletedArchives.some(r=>r.kind===kind&&r.value===value)) return;
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
 const rules=directory.rules.filter(r=>isAllocationRuleActive(r) && r.seller===seller && (!buyer || r.buyer===buyer));
 return rules.length===1 ? rules[0] : null;
}
