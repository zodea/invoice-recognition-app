// Payment evidence has no invoice number or company buyer. Never infer either from transaction IDs.
export function parsePaymentEvidence(rawText) {
  const text = String(rawText || '').normalize('NFKC');
  const lines = text.split(/\n+/).map(line => line.replace(/\s+/g, '').replace(/·/g, '.')).filter(Boolean);
  const amounts = lines.flatMap(line => {
    const match = line.match(/^(?:支出|付款金额[:：]?|转账金额[:：]?)?[-一—−+]?[¥￥]?(\d{1,9}\.\d{2})(?:元)?$/);
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
  return { date: uniqueDates.length === 1 ? uniqueDates[0] : '', seller: income ? '' : seller, total: totals.length === 1 ? totals[0] : '', direction: income ? 'income' : 'expense', counterparty };
}
