// 已识别的非增值税凭证使用固定类型目录，不依赖购买方或分目录设置。
export function standaloneDocumentType(fields = {}) {
  const docType = String(fields.docType || '').trim();
  const type = docType && docType !== '未识别' ? docType : String(fields.type || '').trim();
  if (type === '行程单') return '行程单';
  if (['医疗票据', '医疗单', '医疗门诊票据'].includes(type)) return '医疗票据';
  return '';
}
