// Payment evidence has no invoice number or company buyer. Never infer either from transaction IDs.
export function parsePaymentEvidence(rawText) {
  const text = String(rawText || '').normalize('NFKC');
  const lines = text.split(/\n+/).map(line => line.replace(/\s+/g, '').replace(/·/g, '.')).filter(Boolean);
  const amounts = lines.flatMap(line => {
    const labelled = line.match(/^(?:实付金额|实际支付|付款金额|支付金额|转账金额|缴费金额)[:：]?[¥￥]?(\d{1,9}(?:\.\d{1,2})?)(?:元)?$/);
    if (labelled) return [Number(labelled[1])];
    const match = line.match(/^(?:支出|付款金额[:：]?|转账金额[:：]?|缴费金额[:：]?)?[-一—−+]?[¥￥]?(\d{1,9}\.\d{2})(?:元)?$/);
    return match ? [Number(match[1])] : [];
  });
  const totals = [...new Set(amounts)];
  const dates = [...text.replace(/\s+/g, '').matchAll(/(20\d{2})[年一—./-](\d{1,2})[月一—./-](\d{1,2})(?:日)?/g)].map(match => {
    const [, year, month, day] = match;
    const value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? value : '';
  }).filter(Boolean);
  let seller = '';
  for (let index = 0; index < lines.length; index++) {
    const tagged = lines[index].match(/^(?:商户全称|收款方|收款人|对方账户名称)[:：](.+)$/);
    if (tagged) seller = tagged[1];
    if (/^(商户全称|收款方|收款人|对方账户名称)[:：]?$/.test(lines[index])) {
      const next = lines[index + 1] || '';
      if (!/^(收单机构|支付方式|支付时间|当前状态|商品|交易单号|商户单号|\d)/.test(next)) seller = next;
    }
  }
  if (!seller) {
    const title = lines.map(line => line.match(/^(?:扫二维码付款[一—-]?给|转账[一—-]?转给|转账给|付款给)(.+)$/)).find(Boolean);
    if (title) seller = title[1];
  }
  if (!seller && lines.some(line => /^商户全称[:：]?$/.test(line))) {
    // Some OCR engines read the complete label column before reading the values.
    // Only accept one distinct commercial name, excluding payment/clearing institutions.
    const merchants = [...new Set(lines.filter(line =>
      /(?:公司|商行|经营部|加油站|餐厅|饭店|门市|店)(?:\([^)]*\))?$/.test(line) &&
      !/银行|财付通|网联|银联|清算|收单机构|银通支付|支付科技/.test(line)
    ))];
    if (merchants.length === 1) seller = merchants[0];
  }
  const income = lines.some(line => /^\+\d/.test(line) || /转账[一—-]?来自|已存入零钱|收款成功/.test(line));
  const counterparty = lines.map(line => line.match(/转账[一—-]?来自(.+)/)?.[1]).find(Boolean) || '';
  const uniqueDates = [...new Set(dates)];
  const ids = label => {
    const found = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(new RegExp('^(?:' + label + ')[:：]?([A-Za-z0-9-]{6,})(?:复制)?$'));
      if (match) found.push(match[1]);
      else if (new RegExp('^(?:' + label + ')[:：]?$').test(lines[i]) && /^[A-Za-z0-9-]{6,}$/.test(lines[i + 1] || '')) found.push(lines[i + 1]);
    }
    const unique = [...new Set(found)];
    return unique.length === 1 ? unique[0] : '';
  };
  const transactionId = ids('交易单号|支付单号|转账单号|流水号');
  const orderId = ids('订单号|订单编号|商户单号');
  const kind = /订单详情|订单信息|商品总额|订单总额|订单总金额|订单金额|应付金额/.test(text) ? 'order' : /支付|付款|缴费|转账|对方已收钱|已存入零钱|交易成功|交易单号/.test(text) ? 'payment' : 'unknown';
  const success = /支付成功|付款成功|交易成功|转账成功|对方已收钱|缴费成功/.test(text);
  const failed = /支付失败|交易失败|已关闭|已取消|退款成功|已退款/.test(text);
  const pending = /待支付|未支付|待付款/.test(text);
  const paymentStatus = failed ? 'failed' : pending ? 'pending' : success ? 'success' : 'unknown';
  const message = text.match(/(?:付款留言|转账说明|付款说明|收款留言)[:：]?[^\S\r\n]*(?:\r?\n[^\S\r\n]*)?([^\r\n]+)/)?.[1]?.trim() || '';
  return { date: uniqueDates.length === 1 ? uniqueDates[0] : '', seller: income ? '' : seller, total: kind === 'payment' && totals.length === 1 ? totals[0] : '', direction: income ? 'income' : 'expense', counterparty, kind, paymentStatus, transactionId, orderId, ...(message ? { message } : {}) };
}

// Recognize repeated utility-payment cards as separate, reviewable observations.
// A cut-off card is retained, never inferred from another card with the same amount.
export function parsePaymentTransactions(rawText) {
  const text = String(rawText || '').normalize('NFKC');
  const utility=/普表缴费/.test(text);
  // Split only at repeated card headings. A free-form list with no reliable
  // boundaries stays a single review item and is never summed by amount.
  const heading=/^(?:付款详情|支付详情|交易详情|缴费详情)\s*$/gm;
  if (!utility && [...text.matchAll(heading)].length<2) return [];
  const chunks=utility ? text.split(/(?=普表缴费)/) : text.split(/(?=^(?:付款详情|支付详情|交易详情|缴费详情)\s*$)/m);
  const results = [];
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const fields = parsePaymentEvidence(chunk);
    if (!fields.date && fields.total === '' && !fields.orderId && !fields.transactionId) continue;
    if (utility && fields.kind==='unknown') fields.kind='payment';
    const complete = !!fields.date && fields.total !== '' && !!(fields.transactionId || fields.orderId) && fields.paymentStatus === 'success';
    results.push({ ...fields, complete, text: chunk.trim() });
  }
  return results;
}
