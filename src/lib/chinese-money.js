const digits = '零壹贰叁肆伍陆柒捌玖';
const places = ['', '拾', '佰', '仟'];
const groups = ['', '万', '亿', '兆'];

export function toChineseUpper(value) {
  const match = String(value ?? '').trim().normalize('NFKC').replace(/^[¥￥]/, '').replace(/,/g, '').match(/^(-?)(\d{1,16})(?:\.(\d{0,2}))?$/);
  if (!match) return '';
  const [, sign, integer, decimal = ''] = match;
  const blocks = integer.padStart(Math.ceil(integer.length / 4) * 4, '0').match(/.{4}/g);
  let whole = '', gap = false;
  for (const [index, block] of blocks.entries()) {
    if (!Number(block)) { gap ||= !!whole; continue; }
    if (whole && (gap || block[0] === '0')) whole += digits[0];
    let part = '', innerGap = false;
    for (const [position, digit] of [...block].entries()) {
      if (digit === '0') { innerGap ||= !!part; continue; }
      if (innerGap) part += digits[0];
      part += digits[digit] + places[3 - position];
      innerGap = false;
    }
    whole += part + groups[blocks.length - index - 1];
    gap = false;
  }
  const [jiao = '0', fen = '0'] = decimal;
  const fraction = (jiao !== '0' ? `${digits[jiao]}角` : '') + (fen !== '0' ? `${jiao === '0' && whole ? '零' : ''}${digits[fen]}分` : '');
  return `${sign && (whole || fraction) ? '负' : ''}${whole || '零'}元${fraction || '整'}`;
}
