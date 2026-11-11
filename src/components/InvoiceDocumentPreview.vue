<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { invoiceActions } from "../invoiceStore";
import { createPreviewPan } from "../lib/preview-pan";
import MiddleEllipsis from "./MiddleEllipsis.vue";
import DocumentImage from './DocumentImage.vue';
import RecognitionOverlay from './RecognitionOverlay.vue';

const props = defineProps({ invoice: { type: Object, default: null }, showRegions: Boolean });
const page = ref(0);
const zoom = ref(1);
const viewport = ref(null);
const dragging = ref(false);
const pan = createPreviewPan(() => viewport.value, value => { dragging.value = value; });
const pages = computed(() => props.invoice?.renderedPages || []);
watch(() => props.invoice?.id, () => { pan.cancel(); page.value = 0; zoom.value = 1; });
watch(() => pages.value.length, count => { if (page.value >= count) page.value = Math.max(0, count - 1); });
function changeZoom(delta) { zoom.value = Math.max(1, Math.min(4, Math.round((zoom.value + delta) * 100) / 100)); }
function onWheel(event) { if (event.ctrlKey || event.metaKey) { event.preventDefault(); changeZoom(event.deltaY < 0 ? .25 : -.25); } }
onBeforeUnmount(pan.cancel);
</script>

<template>
  <section class="work-panel invoice-document">
    <div class="panel-heading preview-title"><div><h2>发票预览</h2><p v-if="invoice"><MiddleEllipsis :text="invoice.name" /></p></div>
      <div class="preview-controls" v-if="invoice">
        <button type="button" aria-label="缩小" title="缩小" @click="changeZoom(-.25)">−</button><span>{{ Math.round(zoom * 100) }}%</span><button type="button" aria-label="放大" title="放大" @click="changeZoom(.25)">＋</button>
        <button type="button" @click="zoom = 1">适应窗口</button><button type="button" title="旋转 90 度" aria-label="旋转 90 度" :disabled="invoice.rendering" @click="invoiceActions.rotateInvoice(invoice)">↻</button>
      </div>
    </div>
    <div ref="viewport" class="document-canvas" :class="{ 'can-pan': pages[page], dragging }" tabindex="0" aria-label="票面预览，按住拖动平移，使用工具栏缩放" @pointerdown="pan.down" @pointermove="pan.move" @pointerup="pan.up" @pointercancel="pan.up" @lostpointercapture="pan.up" @wheel="onWheel">
      <div v-if="pages[page]" class="document-page" :style="{ width: `${zoom * 100}%` }">
        <DocumentImage :file="invoice.blob" :name="invoice.name" :src="pages[page]" :page-number="page + 1" :rotation="invoice.rotation" style="width: 100%" :alt="`发票预览：${invoice.name}，第 ${page + 1} 页`" draggable="false" @dragstart.prevent />
        <RecognitionOverlay v-if="showRegions" :fields="invoice.fields" :regions="invoice.recognitionRegions" :page="page" :rotation="invoice.rotation" />
      </div>
      <div v-else class="work-empty">{{ invoice?.rendering || invoice?.previewStatus === 'running' || invoice?.previewStatus === 'queued' ? '正在加载票面…' : invoice ? '暂无票面预览' : '请选择发票' }}</div>
    </div>
    <div v-if="pages.length > 1" class="document-pages"><button class="btn" :disabled="page === 0" @click="page--">上一页</button><span>{{ page + 1 }} / {{ pages.length }}</span><button class="btn" :disabled="page >= pages.length - 1" @click="page++">下一页</button></div>
  </section>
</template>

<style scoped>
.document-page { position: relative; flex: none; margin: auto; }
</style>
