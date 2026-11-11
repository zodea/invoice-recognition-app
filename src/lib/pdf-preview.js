// 按显示宽度选择 PDF 渲染倍率，同时限制单页画布，避免大幅图纸占满内存。
export function pdfRenderScale(width, height, { scale = 2, targetWidth = 0, maxPixels = 16000000 } = {}) {
  const requested = Math.max(scale, targetWidth / width);
  return Math.min(requested, Math.sqrt(maxPixels / (width * height)), 8192 / Math.max(width, height));
}
