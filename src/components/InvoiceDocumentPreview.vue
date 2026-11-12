<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { invoiceActions, invoiceStore } from "../invoiceStore.js";
import { createPreviewPan } from "../lib/preview-pan";
import MiddleEllipsis from "./MiddleEllipsis.vue";
import DocumentImage from './DocumentImage.vue';
import RecognitionOverlay from './RecognitionOverlay.vue';
import PreviewMinimap from './PreviewMinimap.vue';
import { centerPreviewAt, previewCenter } from '../lib/preview-navigation.js';

const props = defineProps({ invoice: { type: Object, default: null } });
const page = ref(0);
const zoom = ref(1);
const showRegions = ref(false);
const showText = ref(false);
const viewport = ref(null);
const pageElement = ref(null);
const zoomPercent = computed({ get: () => Math.round(zoom.value * 100), set: value => { zoom.value = Math.max(1, Math.min(4, Number(value) / 100)); } });
const dragging = ref(false);
const pan = createPreviewPan(() => viewport.value, value => { dragging.value = value; });
const pages = computed(() => props.invoice?.renderedPages || []);
watch(() => props.invoice?.id, () => { pan.cancel(); page.value = 0; zoom.value = 1; showRegions.value = false; showText.value = false; });
watch(() => pages.value.length, count => { if (page.value >= count) page.value = Math.max(0, count - 1); });
watch(zoom, async () => {
  const frame = viewport.value, content = pageElement.value;
  if (!frame || !content) return;
  const point = previewCenter(frame.getBoundingClientRect(), content.getBoundingClientRect());
  await nextTick();
  if (frame === viewport.value && content === pageElement.value) centerPreviewAt(frame, content, point);
});
watch([() => props.invoice?.id, page, () => props.invoice?.rotation], async () => {
  pan.cancel();
  await nextTick();
  viewport.value?.scrollTo({ left: 0, top: 0 });
});
function changeZoom(delta) { zoom.value = Math.max(1, Math.min(4, Math.round((zoom.value + delta) * 100) / 100)); }
function onWheel(event) { if (event.ctrlKey || event.metaKey) { event.preventDefault(); changeZoom(event.deltaY < 0 ? .25 : -.25); } }
onBeforeUnmount(pan.cancel);
</script>

<template>
  <section class="work-panel invoice-document">
    <div class="panel-heading preview-title"><div><h2>发票预览</h2><p v-if="invoice"><MiddleEllipsis :text="invoice.name" /></p></div>
      <div class="preview-controls" v-if="invoice">
        <button type="button" aria-label="缩小" title="缩小" @click="changeZoom(-.25)">−</button><span>{{ Math.round(zoom * 100) }}%</span><button type="button" aria-label="放大" title="放大" @click="changeZoom(.25)">＋</button>
        <button type="button" @click="zoom = 1">适应窗口</button>
      </div>
    </div>
    <div v-if="invoice" class="document-actions" role="group" aria-label="预览与识别操作">
      <button class="btn" type="button" :disabled="invoice.rendering || invoiceStore.busy" @click="invoiceActions.recognizeOne(invoice)">{{ invoice.status === 'running' ? '识别中…' : '识别' }}</button>
      <button v-if="invoice.rawText" class="btn" type="button" :aria-expanded="showText" aria-controls="invoice-recognized-text" @click="showText = !showText">{{ showText ? '收起文本' : '文本' }}</button>
      <button class="btn" type="button" title="顺时针旋转 90°（影响预览与打印）" aria-label="旋转 90 度" :disabled="invoice.rendering || ['queued', 'running'].includes(invoice.previewStatus)" @click="invoiceActions.rotateInvoice(invoice)">↻ 方向<span v-if="invoice.rotation"> {{ invoice.rotation }}°</span></button>
      <button class="btn" type="button" :disabled="invoice.status !== 'done'" :aria-pressed="showRegions" title="复用识别位置，不重新识别。框线用于对照票面，不代表已核实正确。" @click="showRegions = !showRegions">{{ showRegions ? '隐藏识别区域' : '显示识别区域' }}</button>
    </div>
    <label v-if="invoice" class="document-zoom"><span>缩放</span><input v-model.number="zoomPercent" type="range" min="100" max="400" step="1" aria-label="票面缩放比例" /><output>{{ zoomPercent }}%</output><span class="zoom-help">拖拽票面移动</span></label>
    <p v-if="showRegions && !invoice?.recognitionRegions?.length" class="document-hint" role="status">暂无可定位文字；文件名补录或无位置数据的结果不画框。</p>
    <section v-if="showText && invoice?.rawText" id="invoice-recognized-text" class="document-text" aria-label="识别文本"><pre>{{ invoice.rawText }}</pre></section>
    <div class="document-stage">
    <div ref="viewport" class="document-canvas" :class="{ 'can-pan': pages[page], dragging }" tabindex="0" aria-label="票面预览，按住拖动平移，使用工具栏缩放" @pointerdown="pan.down" @pointermove="pan.move" @pointerup="pan.up" @pointercancel="pan.up" @lostpointercapture="pan.up" @wheel="onWheel">
      <div v-if="pages[page]" ref="pageElement" class="document-page" :style="{ width: `${zoom * 100}%` }">
        <DocumentImage :file="invoice.blob" :name="invoice.name" :src="pages[page]" :page-number="page + 1" :rotation="invoice.rotation" style="width: 100%" :alt="`发票预览：${invoice.name}，第 ${page + 1} 页`" draggable="false" @dragstart.prevent />
        <RecognitionOverlay v-if="showRegions" :fields="invoice.fields" :regions="invoice.recognitionRegions" :page="page" :rotation="invoice.rotation" />
      </div>
      <div v-else class="work-empty">{{ invoice?.rendering || invoice?.previewStatus === 'running' || invoice?.previewStatus === 'queued' ? '正在加载票面…' : invoice ? '暂无票面预览' : '请选择发票' }}</div>
    </div>
    <PreviewMinimap :viewport="viewport" :page="pageElement" :src="pages[page]" :enabled="zoom > 1.5" />
    </div>
    <div v-if="pages.length > 1" class="document-pages"><button class="btn" :disabled="page === 0" @click="page--">上一页</button><span>{{ page + 1 }} / {{ pages.length }}</span><button class="btn" :disabled="page >= pages.length - 1" @click="page++">下一页</button></div>
  </section>
</template>

<style scoped>
.document-page { position: relative; flex: none; margin: auto; }
.document-stage { position: relative; }
.document-zoom { display: flex; align-items: center; gap: 8px; padding: 6px 12px; color: #64748b; font-size: 12px; }
.document-zoom input { flex: 1; min-width: 50px; height: 22px; padding: 0; accent-color: #2563eb; cursor: ew-resize; }
.document-zoom output { min-width: 35px; font-variant-numeric: tabular-nums; }
.zoom-help { font-size: 11px; white-space: nowrap; }
.document-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 8px 12px; border-bottom: 1px solid #e5eaf1; }
.document-actions .btn { padding: 4px 8px; font-size: 12px; }
.document-actions [aria-pressed="true"], .document-actions [aria-expanded="true"] { color: #1d4ed8; border-color: #93c5fd; background: #eff6ff; }
.document-hint { margin: 0; padding: 8px 12px; color: #64748b; font-size: 12px; }
.document-text { padding: 10px 12px; background: #f8fafc; border-bottom: 1px solid #e5eaf1; }
.document-text pre { margin: 0; max-height: 180px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
</style>
