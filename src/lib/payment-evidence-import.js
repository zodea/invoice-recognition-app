// 识别只产生待核对候选；不修改或重命名用户文件。PDF 每页独立分析。
import { parsePaymentEvidence, parsePaymentTransactions } from './payment-evidence.js';
import { isPdf } from './file-utils.js';

export async function recognizePaymentEvidenceFile(file, options = {}) {
  if (!file) throw new Error('未选择凭证');
  const maxPages = Math.max(1, Math.min(50, options.maxPages || 20));
  const notify = options.onProgress || (() => {});
  const warnings = [];
  const loadPdf = options.pdfApi || (isPdf(file) ? await import('./pdftext.js') : null);
  const recognize = options.recognizePages || (await import('./ocr.js')).recognizePages;
  const parse = options.parse || parsePaymentEvidence;
  let texts = [], count = 1;
  if (isPdf(file)) {
    try {
      const extracted = await loadPdf.extractPdfText(file, { maxPages });
      count = Math.min(extracted.numPages, maxPages);
      texts = Array.from({ length: count }, (_, i) => (extracted.pages[i]?.lines || []).map(l => l.text).join('\n'));
      if (extracted.numPages > maxPages) warnings.push('PDF 超过识别页数上限，仅识别前 ' + maxPages + ' 页');
    } catch (error) {
      warnings.push('PDF 文字提取失败，将尝试页面 OCR：' + (error.message || error));
      texts = [];
    }
    // 页面为空时逐页渲染与识别，避免把多个页面的交易混成一笔。
    const missing = texts.length ? texts.map((t, i) => t.trim().length < 8 ? i : -1).filter(i => i >= 0) : null;
    if (missing === null || missing.length) {
      const urls = await loadPdf.renderPdfPages(file, { maxPages, scale: 2 });
      try {
        if (missing === null) { count = urls.length; texts = Array(count).fill(''); }
        const targets = missing || urls.map((_, i) => i);
        for (const i of targets) {
          if (!urls[i]) { warnings.push('第 ' + (i + 1) + ' 页渲染失败，请人工核对'); continue; }
          try {
            notify('识别第 ' + (i + 1) + '/' + count + ' 页');
            texts[i] = (await recognize([{ dataUrl: urls[i], pageIndex: i }])).join('\n');
          } catch (error) { warnings.push('第 ' + (i + 1) + ' 页识别失败：' + (error.message || error)); }
        }
      } finally { urls.forEach(url => { if (url) URL.revokeObjectURL(url); }); }
    }
  } else {
    const url = URL.createObjectURL(file);
    try { notify('识别图片内容'); texts = [(await recognize([{ dataUrl: url, pageIndex: 0 }])).join('\n')]; }
    finally { URL.revokeObjectURL(url); }
  }
  const pages = Array.from({length: count}, (_, i) => ({ page: i + 1, text: texts[i] || '', fields: parse(texts[i] || ''), transactions: parsePaymentTransactions(texts[i] || '') }));
  if (!pages.some(p => p.text.trim())) warnings.push('未识别到文字，请人工对照原件');
  // 多页字段冲突不能合成单笔；只输出唯一确定的共同字段。
  const keys = ['date','seller','total','direction','counterparty','kind','paymentStatus','transactionId','orderId'];
  const fields = {};
  for (const key of keys) {
    const values = [...new Set(pages.map(p => p.fields[key]).filter(v => v !== '' && v != null))];
    fields[key] = values.length === 1 ? values[0] : '';
    if (values.length > 1 && key !== 'direction') warnings.push('各页 ' + key + ' 不一致，请逐页核对');
  }
  const transactions = pages.flatMap(page => (page.transactions.length ? page.transactions : [page.fields]).map((fields, i) => ({ page: page.page, index: i + 1, fields })));
  if (transactions.length > 1 || pages.filter(page => page.text.trim()).length > 1) {
    warnings.push('多页凭证请逐页核对，不自动合并为一笔交易');
    for (const key of keys) fields[key] = '';
  }
  return { file, fields, pages, transactions, warnings };
}
