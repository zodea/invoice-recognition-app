export const archiveKinds = {
  buyers: '购买方公司', projects: '工地', allocations: '费用归属', people: '报销人',
  purposes: '常用用途', tags: '自定义标签', paymentMethods: '付款方式',
};

export function mergeDirectoryWorkbook(current, data) {
  const next = { ...current, rules: [...current.rules] };
  const active = {};
  for (const kind of Object.keys(archiveKinds)) active[kind] = new Set(current[kind]);
  const aliasKey = name => String(name || '').trim().normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
  const archiveKey = ({ kind, value }) => JSON.stringify([kind, kind === 'aliases' ? aliasKey(value) : value]);
  const ruleKey = ({ seller, buyer, project }) => JSON.stringify([seller, buyer, project]);
  const trash = new Map(current.deletedArchives.map(item => [archiveKey(item), item]));
  const rules = new Set(current.rules.map(ruleKey));
  const counts = { added: 0, restored: 0, rules: 0, trash: 0, skipped: 0 };
  const aliases = new Map((current.aliases || []).map(item => [aliasKey(item.name), item]));
  for (const item of data.archives) {
    if (active[item.kind].has(item.value)) { counts.skipped++; continue; }
    active[item.kind].add(item.value);
    if (trash.delete(archiveKey(item))) counts.restored++;
    else counts.added++;
  }
  for (const alias of data.aliases || []) {
    const key = aliasKey(alias.name);
    if (aliases.has(key) || [...active[alias.kind]].some(name => aliasKey(name) === key)) { counts.skipped++; continue; }
    aliases.set(key, alias);
    if (trash.delete(archiveKey({ kind: 'aliases', value: alias.name }))) counts.restored++;
    else counts.added++;
  }
  for (const item of data.trash) {
    const key = archiveKey(item);
    const isActive = item.kind === 'aliases' ? aliases.has(aliasKey(item.value)) : active[item.kind].has(item.value);
    if (isActive || trash.has(key)) { counts.skipped++; continue; }
    trash.set(key, item);
    counts.trash++;
  }
  for (const rule of data.rules) {
    const key = ruleKey(rule);
    if (rules.has(key)) { counts.skipped++; continue; }
    rules.add(key);
    next.rules.push(rule);
    counts.rules++;
  }
  for (const [kind, names] of Object.entries(active)) next[kind] = [...names];
  next.deletedArchives = [...trash.values()];
  if (aliases.size || current.aliases) next.aliases = [...aliases.values()];
  return { next, counts, changed: counts.added + counts.restored + counts.rules + counts.trash };
}
