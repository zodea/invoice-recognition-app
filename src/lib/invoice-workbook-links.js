export function invoiceWorkbooksWithoutExportCopies(sources) {
  const stem = source => source.sourcePath.replace(source.hasCheckedColumns ? /_核对版(?:\(\d+\))?\.xlsx$/i : /\.xlsx?$/i, '');
  const signature = source => JSON.stringify(source.records.map(row => [row.sheet, row.rowIndex, row.number, row.numberUnsafe, row.date, row.total, row.seller, row.buyer, row.paymentSplits]));
  const checked = new Map();
  for (const source of sources.filter(source => source.hasCheckedColumns)) {
    const key = JSON.stringify([stem(source), signature(source)]);
    if (!checked.has(key)) checked.set(key, source);
  }
  return sources.filter(source => {
    const copy = checked.get(JSON.stringify([stem(source), signature(source)]));
    return !copy || copy === source;
  });
}

export function relativeLink(sourcePath, target) {
  const path = value => String(value || '').replaceAll('\\', '/').split('/');
  const valid = parts => parts.length && parts.every(part => part && part !== '.' && part !== '..' && !/[:\u0000-\u001f]/.test(part));
  const source = path(sourcePath), destination = path(target);
  if (!valid(source) || !valid(destination)) return '';
  source.pop();
  while (source[0] && source[0] === destination[0]) { source.shift(); destination.shift(); }
  return './' + [...source.map(() => '..'), ...destination].join('/');
}
