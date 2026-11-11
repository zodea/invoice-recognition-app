// 指针捕获让鼠标移出预览区域后仍能继续平移，释放或取消时及时清理状态。
export function createPreviewPan(getViewport, onChange = () => {}) {
  let pointerId = null;
  let lastX = 0;
  let lastY = 0;

  function down(event) {
    const viewport = getViewport();
    if (!viewport || pointerId !== null || (event.pointerType !== "touch" && event.button !== 0)) return;
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    event.preventDefault();
    viewport.setPointerCapture?.(pointerId);
    onChange(true);
  }
  function move(event) {
    const viewport = getViewport();
    if (!viewport || pointerId !== event.pointerId) return;
    viewport.scrollLeft -= event.clientX - lastX;
    viewport.scrollTop -= event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
  }
  function cancel() {
    if (pointerId === null) return;
    const viewport = getViewport();
    const id = pointerId;
    pointerId = null;
    if (viewport?.hasPointerCapture?.(id)) viewport.releasePointerCapture(id);
    onChange(false);
  }
  function up(event) { if (pointerId === event.pointerId) cancel(); }
  return { down, move, up, cancel };
}
