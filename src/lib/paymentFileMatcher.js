const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, '');
const brandAliases = [['速停车', '泊云速停车'], ['货省省', '江苏运满满'], ['货车司机', '人间清醒']];

export function paymentSellerMatch(left, right, aliases = brandAliases) {
  const first = normalize(left), second = normalize(right);
  if (!first || !second) return '';
  if (first === second) return 'exact';
  return aliases.some(group => group.includes(first) && group.includes(second)) ? 'alias' : '';
}

export function paymentAmountDifference(expected, actual) {
  if ([expected, actual].some(value => value === '' || value == null || !Number.isFinite(Number(value)))) return null;
  return (Math.round(Number(actual) * 100) - Math.round(Number(expected) * 100)) / 100;
}
