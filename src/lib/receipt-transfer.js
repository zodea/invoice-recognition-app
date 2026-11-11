export async function receiptHash(file) {
  const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2,'0')).join('');
}
export function buildReceiptPayment(inv, hash) {
  const f = inv.fields;
  return {
    id: 'receipt:'+hash, source: '票据识别 / '+inv.name, sourceKind: 'receipt', receiptType: f.docType || f.type || '其他票据',
    date: f.date || '', seller: f.seller || '', buyer: f.buyer || '', total: f.total === '' || f.total == null ? '' : Number(f.total),
    payer: f.payer || '', project: f.project || '', purpose: f.service || f.category || '', note: f.remark || '',
    tags: [...new Set(['其他票据', inv.otherReceiptTag || '', inv.expenseTag || ''].filter(Boolean))].join('、'),
    receiptFields: { ...f }, receiptNumber: f.number || '', lines: [], reimbursement: '未核对',
    evidenceHash: hash, evidenceName: inv.name, evidenceConfirmed: false, linkedLedgerKey: '',
  };
}
// 原件保存成功后才发布付款记录。失败时识别队列中的原票继续保留，可重试。
export async function transferReceipt(inv, { getRows, saveRows, saveAttachment, hashFile = receiptHash }) {
  if (!inv.blob) throw new Error('缺少票据原件，不能转存。');
  const hash = await hashFile(inv.blob), row = buildReceiptPayment(inv, hash);
  const existing = getRows().find(item => item.id === row.id || item.evidenceHash === hash);
  if (existing) return { row: existing, existing: true };
  await saveAttachment('payment:'+row.id, inv.blob);
  const latest = getRows();
  const concurrent = latest.find(item => item.id === row.id);
  if (concurrent) return { row: concurrent, existing: true };
  saveRows([...latest, row]);
  return { row, existing: false };
}
