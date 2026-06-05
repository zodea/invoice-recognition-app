// 打印排版的“唯一几何来源”：预览（HTML 百分比）和导出（pdf-lib 点）都用它，
// 保证“所见即所得”——左侧预览的排版与导出的 PDF 完全一致。

export const A4 = { w: 595.28, h: 841.89 }; // pt
export const A4_RATIO = A4.h / A4.w; // 高/宽，预览容器按此比例

export function gridFor(perPage) {
  return { cols: perPage === 4 ? 2 : 1, rows: perPage === 1 ? 1 : 2 };
}

// 返回一页内每个槽位的几何（pdf 点坐标 + html 百分比坐标）。
// pdf 原点在左下；html 原点在左上。
export function planSlots(perPage, { margin = 18, gap = 12 } = {}) {
  const { cols, rows } = gridFor(perPage);
  const slotW = (A4.w - margin * 2 - gap * (cols - 1)) / cols;
  const slotH = (A4.h - margin * 2 - gap * (rows - 1)) / rows;
  const slots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const xPt = margin + c * (slotW + gap);
      const topPt = A4.h - margin - r * (slotH + gap); // 槽位上边（pdf 坐标）
      const yPt = topPt - slotH; // 槽位下边（pdf 坐标）
      slots.push({
        xPt,
        yPt,
        wPt: slotW,
        hPt: slotH,
        xPct: (xPt / A4.w) * 100,
        yPct: ((A4.h - topPt) / A4.h) * 100,
        wPct: (slotW / A4.w) * 100,
        hPct: (slotH / A4.h) * 100,
      });
    }
  }
  return slots;
}

export function perPageCount(perPage) {
  const { cols, rows } = gridFor(perPage);
  return cols * rows;
}
