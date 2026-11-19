<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import { centerPreviewAt, visiblePreviewRegion } from '../lib/preview-navigation.js';

const props = defineProps({ viewport: Object, page: Object, src: String, enabled: Boolean });
const map = ref(null);
const region = ref(null);
let observer, observedViewport, animation, pointerId = null;

function measure() {
  animation = null;
  if (!props.viewport || !props.page) { region.value = null; return; }
  const rect = props.viewport.getBoundingClientRect();
  region.value = visiblePreviewRegion({ left: rect.left + props.viewport.clientLeft, top: rect.top + props.viewport.clientTop, width: props.viewport.clientWidth, height: props.viewport.clientHeight }, props.page.getBoundingClientRect());
}
function schedule() {
  if (animation == null) animation = requestAnimationFrame(measure);
}
function disconnect() {
  observer?.disconnect();
  observedViewport?.removeEventListener('scroll', schedule);
  if (animation != null) cancelAnimationFrame(animation);
  animation = null;
  cancelDrag();
}
watch([() => props.viewport, () => props.page, () => props.src, () => props.enabled], () => {
  disconnect();
  observedViewport = props.viewport;
  if (props.viewport && props.page) {
    observer = new ResizeObserver(schedule);
    observer.observe(props.viewport);
    observer.observe(props.page);
    props.viewport.addEventListener('scroll', schedule, { passive: true });
  }
  schedule();
}, { flush: 'post', immediate: true });

function navigate(event) {
  const rect = map.value?.getBoundingClientRect();
  if (!rect?.width || !rect?.height) return;
  centerPreviewAt(props.viewport, props.page, { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
  schedule();
}
function down(event) {
  if (event.button !== 0 || pointerId !== null) return;
  event.preventDefault();
  pointerId = event.pointerId;
  map.value?.setPointerCapture(pointerId);
  navigate(event);
}
function move(event) { if (event.pointerId === pointerId) navigate(event); }
function cancelDrag() {
  const id = pointerId;
  pointerId = null;
  if (id != null && map.value?.hasPointerCapture(id)) map.value.releasePointerCapture(id);
}
function up(event) { if (event.pointerId === pointerId) cancelDrag(); }
function keydown(event) {
  const viewport = props.viewport;
  if (!viewport) return;
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (delta) {
    event.preventDefault();
    viewport.scrollLeft += delta[0] * viewport.clientWidth * .3;
    viewport.scrollTop += delta[1] * viewport.clientHeight * .3;
    schedule();
  }
}
function keyboardClick(event) {
  if (event.detail === 0) { centerPreviewAt(props.viewport, props.page, { x: .5, y: .5 }); schedule(); }
}
onBeforeUnmount(disconnect);
</script>

<template>
  <aside v-if="enabled && src && region" class="preview-minimap" aria-label="票面鸟瞰图">
    <span class="minimap-heading">鸟瞰 <small>当前区域</small></span>
    <button ref="map" type="button" class="minimap-map" aria-label="鸟瞰定位：点击或拖动查看区域，方向键平移" @pointerdown.stop="down" @pointermove.stop="move" @pointerup.stop="up" @pointercancel="up" @lostpointercapture="up" @keydown="keydown" @click="keyboardClick">
      <img :src="src" alt="整张票面缩略图" draggable="false" @dragstart.prevent @load="schedule" />
      <svg class="minimap-frame" viewBox="0 0 1 1" preserveAspectRatio="none"><rect :x="region.x" :y="region.y" :width="region.width" :height="region.height" vector-effect="non-scaling-stroke"/></svg>
    </button>
  </aside>
</template>

<style scoped>
.preview-minimap { grid-area:1/1;place-self:end;margin:12px; z-index: 3; padding: 6px; border: 1px solid #cbd5e1; border-radius: 7px; background: #fffffff2; box-shadow: 0 2px 10px #0f172a24; }
.minimap-heading { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; font-size: 11px; color: #334155; }
.minimap-heading small { color: #2563eb; font-size: 10px; }
.minimap-map { display:grid; margin: auto; padding: 0; border: 0; background: white; cursor: crosshair; touch-action: none; }
.minimap-map img { display: block; max-width: 128px; max-height: 100px; width: auto; height: auto; user-select: none; -webkit-user-drag: none; }
.minimap-map>*{grid-area:1/1}.minimap-frame{width:100%;height:100%;min-width:0;min-height:0;fill:#2563eb1a;stroke:#2563eb;stroke-width:2px;pointer-events:none}
.minimap-map:focus-visible { outline: 2px solid #2563eb; outline-offset: 3px; }
</style>
