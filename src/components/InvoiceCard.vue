<script setup>
import { ref } from "vue";
import { invoiceStore, invoiceActions } from "../invoiceStore";

const props = defineProps({ inv: Object });
const showText = ref(false);
const preview = ref(null);
</script>

<template>
  <div class="card" :class="{ off: !inv.include }">
    <div class="preview">
      <label class="inc">
        <input type="checkbox" v-model="inv.include" /> 打印/汇总
      </label>
      <div v-if="inv.rendering" class="ph">读取中…</div>
      <div v-else-if="inv.pages.length" class="thumbwrap">
        <img :src="inv.pages[0].dataUrl" class="thumb" @click="preview = inv.pages[0].dataUrl" />
        <div v-if="inv.pages.length > 1" class="pc">共 {{ inv.pages.length }} 页</div>
      </div>
      <div v-else-if="inv.isTextPdf" class="ph epdf">🧾 电子发票PDF<br /><small>文字版，无需预览</small></div>
      <div v-else-if="inv.error" class="ph err">{{ inv.error }}</div>
      <div v-else class="ph">无预览</div>
    </div>

    <div class="detail">
      <div class="row1">
        <span class="fname" :title="inv.name">{{ inv.name }}</span>
        <button class="mini danger" @click="invoiceActions.removeInvoice(inv.id)">移除</button>
      </div>

      <div class="ocr-row">
        <button class="ocr-btn" :disabled="inv.rendering || invoiceStore.busy" @click="invoiceActions.recognizeOne(inv)">
          {{ inv.status === "running" ? "识别中…" : "🔍 识别发票" }}
        </button>
        <span v-if="inv.status === 'done'" class="ok">已识别，请核对</span>
        <span v-if="inv.status === 'error'" class="bad">{{ inv.error }}</span>
        <button v-if="inv.rawText" class="link" @click="showText = !showText">
          {{ showText ? "收起文本" : "查看识别文本" }}
        </button>
      </div>

      <div v-if="showText && inv.rawText" class="raw"><pre>{{ inv.rawText }}</pre></div>

      <div class="fields">
        <label>发票号码<input v-model="inv.fields.number" /></label>
        <label>开票日期<input v-model="inv.fields.dateText" placeholder="2026-03-09" /></label>
        <label class="wide">销售方<input v-model="inv.fields.seller" /></label>
        <label class="wide">购买方<input v-model="inv.fields.buyer" /></label>
        <label>金额<input v-model="inv.fields.amount" inputmode="decimal" /></label>
        <label>税额<input v-model="inv.fields.tax" inputmode="decimal" /></label>
        <label>价税合计<input v-model="inv.fields.total" inputmode="decimal" /></label>
        <label>类型<input v-model="inv.fields.type" /></label>
        <label class="wide">备注<input v-model="inv.note" placeholder="可留空" /></label>
      </div>
    </div>

    <div v-if="preview" class="lightbox" @click="preview = null"><img :src="preview" /></div>
  </div>
</template>

<style scoped>
.card {
  display: flex;
  gap: 14px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 12px;
  box-shadow: var(--shadow);
}
.card.off { opacity: 0.55; }
.preview { width: 160px; flex: 0 0 160px; }
.inc { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--ink-soft); margin-bottom: 4px; }
.thumb { width: 100%; border: 1px solid var(--line); border-radius: 6px; cursor: zoom-in; background: #fff; }
.pc { font-size: 12px; color: var(--ink-soft); }
.ph {
  height: 150px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: var(--ink-soft); border: 1px dashed var(--line-strong); border-radius: 6px; text-align: center; font-size: 13px;
}
.ph.epdf { color: var(--brand); background: var(--brand-soft); border-style: solid; border-color: var(--brand-soft); }
.ph.err { color: var(--danger); font-size: 12px; padding: 8px; }
.detail { flex: 1; min-width: 0; }
.row1 { display: flex; align-items: center; gap: 10px; }
.fname { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ocr-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 8px 0; }
.ocr-btn { border: 1px solid var(--brand); color: var(--brand); background: var(--brand-soft); border-radius: 6px; padding: 5px 12px; font-weight: 600; }
.ocr-btn:disabled { opacity: 0.5; cursor: default; }
.ok { color: var(--ok); }
.bad { color: var(--danger); font-size: 12px; }
.link { border: none; background: none; color: var(--brand); text-decoration: underline; }
.raw { background: #f8fafc; border: 1px solid var(--line); border-radius: 6px; padding: 8px; margin-bottom: 8px; }
.raw pre { margin: 0; max-height: 150px; overflow: auto; font-size: 12px; white-space: pre-wrap; }
.fields { display: flex; flex-wrap: wrap; gap: 8px; }
.fields label { display: flex; flex-direction: column; font-size: 12px; color: var(--ink-soft); gap: 3px; width: calc(25% - 6px); }
.fields label.wide { width: calc(50% - 4px); }
.fields input { border: 1px solid var(--line-strong); border-radius: 6px; padding: 5px 7px; font: inherit; background: #fff; }
.lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.8); display: flex; align-items: center; justify-content: center; z-index: 50; cursor: zoom-out; }
.lightbox img { max-width: 92vw; max-height: 92vh; }
</style>
