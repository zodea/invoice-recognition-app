import * as XLSX from 'xlsx/xlsx.mjs';

export const archiveKinds = {
  buyers: '购买方公司', projects: '工地', allocations: '费用归属', people: '报销人',
  purposes: '常用用途', tags: '自定义标签', paymentMethods: '付款方式',
};
const kindsByLabel = new Map(Object.entries(archiveKinds).map(([key, label]) => [label, key]));
const sections = [
  ['基础档案', ['档案类型', '档案名称']],
  ['厂家归属', ['厂家', '购买方公司', '工地']],
  ['档案回收站', ['档案类型', '档案名称', '删除时间']],
  ['别名映射', ['别名', '档案类型', '标准名']],
  ['别名回收站', ['别名', '档案类型', '标准名', '删除时间']],
];

export function exportDirectoryWorkbook(directory) {
  const rows = [
    Object.entries(archiveKinds).flatMap(([kind, label]) => directory[kind].map(name => [label, name])),
    directory.rules.map(rule => [rule.seller, rule.buyer, rule.project]),
    directory.deletedArchives.filter(row => row.kind !== 'aliases').map(row => [archiveKinds[row.kind], row.value, row.deletedAt]),
    (directory.aliases || []).map(alias => [alias.name, archiveKinds[alias.kind], alias.target]),
    directory.deletedArchives.filter(row => row.kind === 'aliases').map(({ alias, deletedAt }) => [alias.name, archiveKinds[alias.kind], alias.target, deletedAt]),
  ];
  const book = XLSX.utils.book_new();
  sections.forEach(([title, header], index) => {
    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows[index]]);
    sheet['!cols'] = header.map(() => ({ wch: 32 }));
    XLSX.utils.book_append_sheet(book, sheet, title);
  });
  return XLSX.write(book, { bookType: 'xlsx', type: 'array' });
}

export function readDirectoryWorkbook(bytes) {
  const book = XLSX.read(bytes, { type: 'array' });
  if (!sections.some(([title]) => book.Sheets[title])) throw Error('未找到基础档案工作表，请使用本页导出的 Excel。');
  const data = { archives: [], rules: [], trash: [], aliases: [] };
  for (const [title, headers] of sections) {
    const sheet = book.Sheets[title];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', range: 0 });
    const columns = headers.map(h => rows[0]?.findIndex(v => String(v).trim() === h) ?? -1);
    if (columns.includes(-1)) throw Error(title + ' 缺少表头：' + headers.filter((_, i) => columns[i] < 0).join('、'));
    for (const [index, row] of rows.entries()) {
      if (index === 0 || !row.some(v => String(v).trim())) continue;
      const values = columns.map(i => String(row[i] ?? '').trim());
      const at = title + ' 第 ' + (index + 1) + ' 行：';
      if (values.includes('')) throw Error(at + '请填写' + headers.filter((_, i) => !values[i]).join('、'));
      if (title === '厂家归属') {
        const [seller, buyer, project] = values;
        data.rules.push({ seller, buyer, project });
      } else if (title === '别名映射' || title === '别名回收站') {
        const [name, label, target, deletedAt] = values;
        const kind = kindsByLabel.get(label);
        if (kind !== 'buyers' && kind !== 'projects') throw Error(at + '别名类型必须为购买方公司或工地');
        const alias = { name, kind, target };
        if (title === '别名映射') data.aliases.push(alias);
        else data.trash.push({ kind: 'aliases', value: name, alias, deletedAt });
      } else {
        const [label, value, deletedAt] = values;
        const kind = kindsByLabel.get(label);
        if (!kind) throw Error(at + '未知档案类型“' + label + '”');
        if (title === '基础档案') data.archives.push({ kind, value });
        else data.trash.push({ kind, value, deletedAt });
      }
    }
  }
  return data;
}

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
