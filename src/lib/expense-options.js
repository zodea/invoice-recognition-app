export function splitTags(value) {return [...new Set(String(value || '').split(/[,，;；、\n]+/).map(v=>v.trim()).filter(Boolean))];}
export function expenseOptions(config={}, records=[]) {
 const collect=(configured,key)=>[...new Set([...(configured||[]),...records.map(r=>r[key])].map(v=>String(v||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
 return {buyer:[...new Set((config.buyers||[]).map(v=>String(v||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN')),project:[...new Set((config.projects||[]).map(v=>String(v||'').trim()).filter(Boolean))],reimburser:collect(config.people,'reimburser'),payer:collect(config.people,'payer'),purpose:collect(config.purposes,'purpose'),payment:collect(config.paymentMethods,'payment'),tags:[...new Set([...(config.tags||[]),...records.flatMap(r=>splitTags(r.tags))])].filter(Boolean)};
}
