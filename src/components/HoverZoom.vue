<script setup>
// 鼠标悬停放大镜（issue #12）：悬停预览图，在跟随光标的浮动面板里放大显示光标处区域，
// 便于核对手写明细。面板 Teleport 到 body，避免被卡片 overflow 裁切。可由外部 enabled 开关。
import { ref } from "vue";

const props = defineProps({
  src: String,
  imgClass: { type: String, default: "" },
  zoom: { type: Number, default: 4 }, // 相对缩略图的放大倍数
  enabled: { type: Boolean, default: true },
  panel: { type: Number, default: 420 }, // 放大面板边长(px)
});
const emit = defineEmits(["open"]);

const wrap = ref(null);
const show = ref(false);
const px = ref(0);
const py = ref(0);
const bgX = ref(0);
const bgY = ref(0);
const bgW = ref(0);
const bgH = ref(0);

function onMove(e) {
  if (!props.enabled || !wrap.value) return;
  const r = wrap.value.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  show.value = true;
  bgW.value = r.width * props.zoom;
  bgH.value = r.height * props.zoom;
  bgX.value = props.panel / 2 - x * props.zoom; // 让光标处对应点居中
  bgY.value = props.panel / 2 - y * props.zoom;
  const off = 24;
  let left = e.clientX + off;
  let top = e.clientY + off;
  if (left + props.panel > window.innerWidth) left = e.clientX - off - props.panel;
  if (top + props.panel > window.innerHeight) top = window.innerHeight - props.panel - 8;
  px.value = Math.max(8, left);
  py.value = Math.max(8, top);
}
</script>

<template>
  <div
    ref="wrap"
    class="relative"
    :class="enabled ? 'cursor-crosshair' : 'cursor-zoom-in'"
    @mousemove="onMove"
    @mouseleave="show = false"
    @click="emit('open')"
  >
    <img :src="src" :class="imgClass" />
    <Teleport to="body">
      <div
        v-if="enabled && show"
        class="fixed pointer-events-none rounded-lg border-2 border-brand shadow-pop bg-white bg-no-repeat z-[60]"
        :style="{
          left: px + 'px',
          top: py + 'px',
          width: panel + 'px',
          height: panel + 'px',
          backgroundImage: 'url(' + src + ')',
          backgroundSize: bgW + 'px ' + bgH + 'px',
          backgroundPosition: bgX + 'px ' + bgY + 'px',
        }"
      />
    </Teleport>
  </div>
</template>
