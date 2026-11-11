// 浏览器识别与 Node 回归脚本共用 PDF 文字排序，避免两套抽取规则产生偏差。
export function groupPdfTextLines(items, yTolerance = 3) {
  const sorted = items
    .filter(item => item.str != null)
    .map(item => ({ str: item.str, x: item.transform[4], y: item.transform[5] }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of sorted) {
    let line = lines.find(candidate => Math.abs(candidate.y - item.y) <= yTolerance);
    if (!line) {
      line = { y: item.y, parts: [] };
      lines.push(line);
    }
    line.parts.push(item);
  }
  return lines.map(line => ({
    y: line.y,
    text: line.parts.sort((a, b) => a.x - b.x).map(part => part.str).join(' ').replace(/\s+/g, ' ').trim(),
  }));
}
