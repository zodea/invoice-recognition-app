const clamp = value => Math.max(0, Math.min(1, value));

// 坐标均来自页面实际显示尺寸，兼容居中留白、滚动条及旋转后的宽高。
export function visiblePreviewRegion(viewport, page) {
  if (!(page.width > 0 && page.height > 0)) return null;
  const x = clamp((viewport.left - page.left) / page.width);
  const y = clamp((viewport.top - page.top) / page.height);
  return {
    x, y,
    width: clamp((viewport.left + viewport.width - page.left) / page.width) - x,
    height: clamp((viewport.top + viewport.height - page.top) / page.height) - y,
  };
}

export function previewCenter(viewport, page) {
  if (!(page.width > 0 && page.height > 0)) return { x: .5, y: .5 };
  return {
    x: clamp((viewport.left + viewport.width / 2 - page.left) / page.width),
    y: clamp((viewport.top + viewport.height / 2 - page.top) / page.height),
  };
}

export function centerPreviewAt(viewport, page, point) {
  if (!viewport || !page) return;
  const frame = viewport.getBoundingClientRect();
  const image = page.getBoundingClientRect();
  viewport.scrollLeft += image.left + clamp(point.x) * image.width - frame.left - viewport.clientLeft - viewport.clientWidth / 2;
  viewport.scrollTop += image.top + clamp(point.y) * image.height - frame.top - viewport.clientTop - viewport.clientHeight / 2;
}
