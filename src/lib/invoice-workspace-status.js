export function workspaceInvoiceStatus(invoice, decision, supplementCount = 0) {
  if (invoice.status === 'error') return { tone: 'danger', label: '识别失败', reason: invoice.error || '请检查文件后重新识别。', group: 'issue' };
  if (invoice.duplicateReason) return { tone: 'danger', label: '重复发票', reason: invoice.duplicateReason, group: 'issue' };
  if (decision.state === 'review') {
    const blocked = decision.label === '同号信息冲突' || invoice.fields?.direction === 'income';
    return { tone: blocked ? 'danger' : 'warn', label: decision.label, reason: decision.reason, group: 'issue' };
  }
  if (invoice.paymentMatchNote) return { tone: 'warn', label: '付款待核对', reason: invoice.paymentMatchNote, group: 'pending' };
  if (invoice.systemNote) return { tone: 'warn', label: '票面待核对', reason: invoice.systemNote, group: 'pending' };
  if (invoice.historyAutoExcluded) return { tone: 'warn', label: '已有使用记录', reason: '已按台账使用记录默认取消勾选；请确认后再加入打印或报销。', group: 'pending' };
  if (supplementCount) return { tone: 'brand', label: `含附件（${supplementCount}）`, group: 'ready' };
  if (['supplement', 'attachment-saved', 'linked'].includes(decision.state)) {
    return { tone: 'brand', label: decision.label, group: decision.state === 'linked' ? 'ready' : 'pending' };
  }
  if (invoice.history?.entry?.reimbursement === '已报销') return { tone: 'ok', label: '已报销', group: 'ready' };
  if (['ready', 'saved', 'payment-saved'].includes(decision.state)) return { tone: 'ok', label: decision.label, group: 'ready' };
  if (invoice.status === 'running' || invoice.rendering) return { tone: 'neutral', label: '处理中', group: 'pending' };
  return { tone: 'neutral', label: decision.label, group: 'pending' };
}
