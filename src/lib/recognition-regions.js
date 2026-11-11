const FIELD_LABELS = { number: '发票号码', code: '发票代码', date: '开票日期', buyer: '购买方', seller: '销售方', amount: '金额', tax: '税额', total: '价税合计', rate: '税率' };
const normalize = value => String(value ?? '').normalize('NFKC').replace(/[\s,，￥¥]/g, '');

function bounds(points, width, height) {
  if (!(width > 0 && height > 0) || !points.length || points.some(point => !point.every(Number.isFinite))) return null;
  const left = Math.max(0, Math.min(...points.map(point => point[0])) / width);
  const top = Math.max(0, Math.min(...points.map(point => point[1])) / height);
  const right = Math.min(1, Math.max(...points.map(point => point[0])) / width);
  const bottom = Math.min(1, Math.max(...points.map(point => point[1])) / height);
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

export function ocrTextRegions(result, width, height, page = 0) {
  if (!Array.isArray(result?.text) || !Array.isArray(result?.points)) return [];
  return result.text.flatMap((text, index) => {
    const box = bounds(result.points[index] || [], width, height);
    return box && String(text).trim() ? [{ ...box, text: String(text), page }] : [];
  });
}

export function pdfTextRegions(content, viewport, page = 0) {
  const transform = viewport.transform || [1, 0, 0, -1, 0, viewport.height];
  const toScreen = (x, y) => [transform[0] * x + transform[2] * y + transform[4], transform[1] * x + transform[3] * y + transform[5]];
  return content.items.flatMap(item => {
    if (!item.str?.trim() || !item.transform) return [];
    const [a, b, c, d, x, y] = item.transform;
    const length = Math.hypot(a, b) || 1;
    const height = item.height || Math.hypot(c, d);
    const vertical = Math.hypot(c, d) || 1;
    const style = content.styles?.[item.fontName] || {};
    const ascent = (style.ascent ?? 0.8) * height;
    const descent = (style.descent ?? -0.2) * height;
    const point = (along, up) => toScreen(x + a / length * along + c / vertical * up, y + b / length * along + d / vertical * up);
    const box = bounds([point(0, descent), point(item.width, descent), point(item.width, ascent), point(0, ascent)], viewport.width, viewport.height);
    return box ? [{ ...box, text: item.str, page }] : [];
  });
}

function matchRange(text, key, value) {
  const target = normalize(value);
  if (!target) return null;
  if (['amount', 'tax', 'total'].includes(key)) {
    for (const match of text.matchAll(/-?\d+(?:\.\d+)?/g)) {
      if (Number(match[0]) === Number(target)) return [match.index, match.index + match[0].length];
    }
    return null;
  }
  if (key === 'date') {
    const parts = target.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (parts) {
      const match = new RegExp(`${parts[1]}[-/.年]0?${Number(parts[2])}[-/.月]0?${Number(parts[3])}(?:日)?(?!\\d)`).exec(text);
      return match ? [match.index, match.index + match[0].length] : null;
    }
  }
  const index = text.indexOf(target);
  if (index < 0) return null;
  if (['number', 'code'].includes(key) && (/\d/.test(text[index - 1] || '') || /\d/.test(text[index + target.length] || ''))) return null;
  return [index, index + target.length];
}

function union(regions) {
  const x = Math.min(...regions.map(region => region.x));
  const y = Math.min(...regions.map(region => region.y));
  return { x, y, width: Math.max(...regions.map(region => region.x + region.width)) - x, height: Math.max(...regions.map(region => region.y + region.height)) - y };
}

export function rotateRegion(region, rotation = 0) {
  const angle = ((rotation % 360) + 360) % 360;
  if (angle === 90) return { ...region, x: 1 - region.y - region.height, y: region.x, width: region.height, height: region.width };
  if (angle === 180) return { ...region, x: 1 - region.x - region.width, y: 1 - region.y - region.height };
  if (angle === 270) return { ...region, x: region.y, y: 1 - region.x - region.width, width: region.height, height: region.width };
  return region;
}

// 仅标记与当前字段值吻合的真实文字区域。文件名补录或人工改值找不到原文时不猜位置。
export function keyFieldRegions(fields, regions, page = 0, rotation = 0) {
  const source = (regions || []).filter(region => region.page === page);
  const rows = [];
  for (const region of source.slice().sort((a, b) => a.y - b.y || a.x - b.x)) {
    let row = rows.find(items => Math.abs(items[0].y + items[0].height / 2 - region.y - region.height / 2) < Math.max(items[0].height, region.height) / 2);
    if (!row) { row = []; rows.push(row); }
    row.push(region);
  }
  const result = [];
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const value = fields?.[key];
    if (value == null || value === '') continue;
    let hits = source.filter(region => matchRange(normalize(region.text), key, value));
    if (!hits.length) {
      hits = rows.flatMap(row => {
        const parts = row.slice().sort((a, b) => a.x - b.x);
        const range = matchRange(parts.map(part => normalize(part.text)).join(''), key, value);
        if (!range) return [];
        let offset = 0;
        const selected = parts.filter(part => {
          const start = offset; offset += normalize(part.text).length;
          return offset > range[0] && start < range[1];
        });
        return [{ ...union(selected), text: selected.map(part => part.text).join(''), page }];
      });
    }
    for (const hit of hits) result.push(rotateRegion({ ...hit, key, label, value: String(value) }, rotation));
  }
  return result;
}
