const utf8 = new TextDecoder();
const xml = (book, part) => utf8.decode(book.files?.[part]?.content);
const attribute = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`))?.slice(1).find(value => value !== undefined);
const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
const dayMs = 86400000;
const march1900 = Date.UTC(1900, 2, 1);
const epoch1900 = Date.UTC(1899, 11, 31);
const epoch1904 = Date.UTC(1904, 0, 1);

function relationships(book, part) {
  const targets = new Map();
  const rels = part.replace(/([^/]+)$/, '_rels/$1.rels');
  for (const [tag] of xml(book, rels).matchAll(/<(?:[\w.-]+:)?Relationship\s[^>]+>/g)) {
    const id = attribute(tag, 'Id');
    const target = attribute(tag, 'Target');
    if (!id || target === undefined) continue;
    targets.set(id, target.replace(/&(amp|quot|apos|lt|gt|#x[\da-fA-F]+|#\d+);/g, (entity, name) => {
      if (entities[name]) return entities[name];
      const code = name.startsWith('#x') ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }));
  }
  return targets;
}

function restoreIsoTimes(sheet, sheetXml, date1904) {
  for (const [, attrs, data] of sheetXml.matchAll(/<(?:[\w.-]+:)?c\b([^<>]*\st\s*=\s*["']d["'][^<>]*)(?<!\/)>([\s\S]*?)<\/(?:[\w.-]+:)?c>/g)) {
    const cell = sheet[attribute(attrs, 'r')];
    const iso = data.match(/<(?:[\w.-]+:)?v>([^<]+)<\/(?:[\w.-]+:)?v>/)?.[1];
    if (!cell || !iso) continue;
    // ISO worksheet dates carry the source clock time. Excel serials have no timezone.
    const parts = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(iso);
    if (!parts) continue;
    const [, day, hour = '0', minute = '0', second = '0'] = parts;
    const midnight = Date.parse(day);
    if (!Number.isFinite(midnight)) continue;
    const serial = (midnight - (date1904 ? epoch1904 : epoch1900)) / dayMs;
    const leapDay = !date1904 && midnight >= march1900 ? 1 : 0;
    const seconds = Number(hour) * 3600 + Number(minute) * 60 + Number(second);
    cell.t = 'n';
    cell.v = serial + leapDay + seconds / 86400;
    if (!cell.z || cell.z === 'General') cell.z = seconds ? 'yyyy-mm-dd hh:mm:ss' : 'yyyy-mm-dd';
    delete cell.w;
  }
}

export function restoreInvoiceExcelSource(book) {
  const workbookTargets = relationships(book, 'xl/workbook.xml');
  const date1904 = !!book.Workbook?.WBProps?.date1904;
  for (const { id, name } of book.Workbook?.Sheets || []) {
    const target = workbookTargets.get(id);
    const sheet = book.Sheets[name];
    if (!target || !sheet) continue;
    const part = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    restoreIsoTimes(sheet, xml(book, part), date1904);
    const links = relationships(book, part);
    if (!links.size) continue;
    for (const cell of Object.values(sheet)) {
      const link = cell?.l;
      const addr = links.get(link?.Rel?.Id);
      if (addr === undefined) continue;
      // SheetJS reads ZIP relationship targets as bytes and leaves XML entities escaped.
      // Read the original UTF-8 text once, keeping any worksheet location on the link.
      cell.l = { ...link, Target: addr + link.Target.slice(link.Rel.Target.length), Rel: { ...link.Rel, Target: addr } };
    }
  }
}
