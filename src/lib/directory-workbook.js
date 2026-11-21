import * as XLSX from 'xlsx/xlsx.mjs';

import { archiveKinds } from './directory-merge.js';
export { archiveKinds, mergeDirectoryWorkbook } from './directory-merge.js';

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
