export function invoiceTypeTags(entry = {}) {
  const values = [entry.type, entry.taxKind, entry.typeLabel].map(v => String(v || '').trim()).filter(Boolean);
  if (!values.length && entry.docType) values.push(String(entry.docType));
  const tags = [];
  const add = (label, tone = 'neutral') => { if (!tags.some(t => t.label === label)) tags.push({ label, tone }); };
  for (const text of values) {
    let recognized = false;
    if (/数电/.test(text)) { add('数电'); recognized = true; }
    else if (/电子/.test(text)) { add('电子'); recognized = true; }
    if (/专用|专票/.test(text)) { add('专票', 'blue'); recognized = true; }
    if (/普通|普票/.test(text)) { add('普票', 'green'); recognized = true; }
    if (/通行费/.test(text)) { add('通行费', 'amber'); recognized = true; }
    if (/医疗/.test(text)) { add('医疗', 'blue'); recognized = true; }
    if (/行程单/.test(text)) { add('行程单', 'blue'); recognized = true; }
    if (/货物运输凭证/.test(text)) { add('货运凭证', 'blue'); recognized = true; }
    if (!recognized) add(text);
  }
  return tags;
}
