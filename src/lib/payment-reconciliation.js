import { paymentDate } from './payment-records.js';

const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');
const hasAmount = value => value !== '' && value != null && Number.isFinite(Number(value));
const sameAmount = (a, b) => hasAmount(a) && hasAmount(b) && Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
export function paymentEvidenceMetadata(name) {
  const text = String(name || '').normalize('NFKC');
  const date = paymentDate(text);
  const amount = text.match(/[-_=：:](\d+(?:\.\d{1,2})?)元(?:[-_.]|$)/);
  const receiver = date && amount ? text.slice(text.indexOf(date) + date.length, amount.index).replace(/^[-_：:]+|[-_：:]+$/g, '') : '';
  return { date, total: amount ? Number(amount[1]) : '', seller: receiver };
}
export function paymentEvidenceCandidates(record, files) {
  return files.flatMap(file => {
    const fields = file.fields || paymentEvidenceMetadata(file.name);
    if (!record.date || fields.date !== record.date || !sameAmount(fields.total, record.total)) return [];
    const sameSeller = !!normalize(record.seller) && normalize(fields.seller) === normalize(record.seller);
    return [{ file, sameSeller, hint: sameSeller ? '日期、金额、收款名称一致，仍需对照原件' : '仅日期金额一致，需核对收款方及备注' }];
  }).sort((a, b) => Number(b.sameSeller) - Number(a.sameSeller));
}
function sourceConflict(a, b) {
  return ['date', 'seller', 'payer', 'project', 'purpose'].some(key => normalize(a[key]) !== normalize(b[key])) || !sameAmount(a.total, b.total);
}
export function reviewPaymentImport(records, existing, files = [], period = '') {
  const seen = new Map(existing.map(row => [row.id, row]));
  const accepted = [];
  return records.map(record => {
    const prior = seen.get(record.id);
    let status = '可新增待核对', reason = '', canImport = true;
    if (prior) {
      status = sourceConflict(prior, record) ? '来源内容冲突' : '来源已存在';
      reason = status === '来源内容冲突' ? '同一来源行的日期、收款方、金额或归属已变化，请对照已有记录' : '保留已有记录、原件及报销状态';
      canImport = false;
    } else if (!record.date || !record.seller || !hasAmount(record.total)) {
      status = '信息不完整'; reason = '请补全实际日期、收款名称和有效实付金额'; canImport = false;
    } else if ([...existing, ...accepted].some(row => row.date === record.date && normalize(row.seller) === normalize(record.seller) && sameAmount(row.total, record.total))) {
      status = '疑似重复'; reason = '其他来源存在同日期、金额及收款方记录，请进一步核对备注和原件'; canImport = false;
    }
    const candidates = paymentEvidenceCandidates(record, files);
    const issues = [reason];
    if (!record.payer) issues.push('付款名称缺失，不能使用收款人代替');
    if (!candidates.length) issues.push('未找到文件名信息相符的凭证，可手动补充或先识别原件');
    else if (candidates.length > 1) issues.push(`${candidates.length} 份等额同日候选，需逐笔核对收款方和备注`);
    else issues.push(candidates[0].hint);
    const draft = { ...record, reimbursementPeriod: period || '', evidenceConfirmed: false };
    if (canImport) accepted.push(draft);
    seen.set(record.id, prior || record);
    return { record: draft, status, issues: issues.filter(Boolean), candidates, canImport };
  });
}
