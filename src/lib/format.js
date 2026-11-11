const moneyFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(value) {
  if (value === '' || value == null) return '—';
  const amount = Number(value);
  return Number.isFinite(amount) ? moneyFormatter.format(amount) : '—';
}
