const pad = value => String(value).padStart(2, '0');

export function paymentDate(value, date1904 = false) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 2958465) return '';
    // SheetJS treats the last 0.1 ms before midnight as the next day.
    let day = Math.floor(value + 0.0001 / 86400) + (date1904 ? 1462 : 0);
    // Excel's day zero and fictitious 1900-02-29 have no matching calendar date.
    if (day === 0 || day === 60) return '';
    if (day > 60) day--;
    value = new Date(Date.UTC(1899, 11, 31 + day)).toISOString().slice(0, 10);
  }
  if (value instanceof Date) return Number.isFinite(+value) ? [value.getFullYear(), pad(value.getMonth()+1), pad(value.getDate())].join('-') : '';
  const m = String(value ?? '').trim().match(/((?:19|20)\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?!\d)/);
  if (!m) return '';
  const date = [m[1], pad(m[2]), pad(m[3])].join('-');
  return Number.isFinite(Date.parse(date)) && new Date(date).toISOString().startsWith(date) ? date : '';
}
