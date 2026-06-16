<script setup>
// 送货单操作区「保存(入库)」（issue #14 / ADR-0003）：把已识别的送货单写进识别明细库，
// 供「分供方详情」「单价对比」共读。与「导出归档」(ExportPanel) 解耦、互不替代。
// 键=工地+公司+单号；缺公司/单号本批扣下；键命中且内容有变 → 逐条核对（默认不勾，勾中才覆盖）。
import { ref, computed, onMounted, onUnmounted } from "vue";
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { store, partitionName } from "../store";
import { useRecognizedStore } from "../stores/recognized";
import { buildRecordsFromFiles, classifyUpsert, applyUpsert } from "../lib/recognized-store";
import { toast, toastWarn, toastInfo } from "../lib/toast";

const recognized = useRecognizedStore();
const busy = ref(false);
const reviewOpen = ref(false);
const reviewConflicts = ref([]); // [{ site, key, old, incoming, checked }]
const pendingSiteCls = ref({});
const heldBackList = ref([]);

// 待入库（已识别但库里没有或有变）的单数 → 角标 + 离开提醒
const pending = computed(() => {
  try {
    const { records } = buildRecordsFromFiles(store.files, store.partitions);
    let n = 0;
    for (const r of records) {
      const cls = classifyUpsert(recognized.bySite.value[r.site] || [], [r]);
      if (cls.inserted.length || cls.conflicts.length) n++;
    }
    return n;
  } catch (e) {
    return 0;
  }
});

function itemsBrief(rec) {
  const n = (rec.items || []).length;
  return `日期 ${rec.date || "—"}，${n} 行明细`;
}

async function saveToStore() {
  if (!store.files.length) { toastWarn("还没有文件可入库。"); return; }
  busy.value = true;
  try {
    await recognized.ensureLoaded();
    const { records, heldBack } = buildRecordsFromFiles(store.files, store.partitions);
    heldBackList.value = heldBack;
    const bySite = new Map();
    for (const r of records) { if (!bySite.has(r.site)) bySite.set(r.site, []); bySite.get(r.site).push(r); }
    const siteCls = {};
    const conflicts = [];
    let inserted = 0;
    for (const [site, recs] of bySite) {
      const existing = recognized.bySite.value[site] || [];
      const cls = classifyUpsert(existing, recs);
      siteCls[site] = { existing, cls };
      inserted += cls.inserted.length;
      for (const c of cls.conflicts) conflicts.push({ site, key: c.key, old: c.old, incoming: c.incoming, checked: false });
    }
    if (conflicts.length) {
      reviewConflicts.value = conflicts;
      pendingSiteCls.value = siteCls;
      reviewOpen.value = true;
    } else {
      for (const [site, { existing, cls }] of Object.entries(siteCls)) {
        if (cls.inserted.length) await recognized.saveSite(site, applyUpsert(existing, cls, []));
      }
      finishToast(inserted, 0);
    }
  } finally {
    busy.value = false;
  }
}

async function confirmReview() {
  const owBySite = {};
  for (const c of reviewConflicts.value) if (c.checked) (owBySite[c.site] = owBySite[c.site] || []).push(c.key);
  let ins = 0;
  let upd = 0;
  for (const [site, { existing, cls }] of Object.entries(pendingSiteCls.value)) {
    const ow = owBySite[site] || [];
    ins += cls.inserted.length;
    upd += ow.length;
    await recognized.saveSite(site, applyUpsert(existing, cls, ow));
  }
  reviewOpen.value = false;
  finishToast(ins, upd);
}

function finishToast(inserted, updated) {
  if (inserted || updated) toast(`已入库：新增 ${inserted} 单${updated ? `，覆盖 ${updated} 单` : ""}。分供方/单价对比已可见。`);
  else toastInfo("没有新单可入库（可能都已入库）。");
  if (heldBackList.value.length) toastWarn(`${heldBackList.value.length} 单缺公司/单号未入库——单号是入库必填，补全后再保存。`);
}

function onBeforeUnload(e) {
  if (pending.value > 0) { e.preventDefault(); e.returnValue = ""; }
}
onMounted(() => { recognized.ensureLoaded(); window.addEventListener("beforeunload", onBeforeUnload); });
onUnmounted(() => window.removeEventListener("beforeunload", onBeforeUnload));
</script>

<template>
  <button
    class="btn px-3 py-1.75 font-700 border-brand text-brand bg-brand-soft disabled:opacity-50 disabled:cursor-default"
    :disabled="busy || !store.files.length"
    title="把已识别的送货单入库；入库后『分供方 / 单价对比』才显示、重开仍在。缺单号的单不会入库。"
    @click="saveToStore"
  >
    💾 保存到 分供方 &amp; 单价对比{{ pending ? `（${pending} 单待入库）` : "" }}
  </button>

  <!-- 冲突核对弹窗：键命中但内容有变，逐条勾选，默认不勾，勾中才覆盖 -->
  <DialogRoot :open="reviewOpen" @update:open="reviewOpen = $event">
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 z-50 bg-black/40" />
        <DialogContent class="fixed z-51 top-[6vh] left-1/2 -translate-x-1/2 w-[min(760px,94vw)] max-h-[86vh] overflow-auto bg-bg rounded-card shadow-pop p-4 outline-none">
          <DialogTitle class="m-0 text-base font-700">入库核对：{{ reviewConflicts.length }} 单与库中已有不同</DialogTitle>
          <DialogDescription class="mt-1 text-[13px] text-ink-soft">同「工地+公司+单号」但内容有变。勾选要用新值覆盖的（默认不勾＝保留库中旧值）。全新单已静默入库。</DialogDescription>
          <div class="mt-3 flex flex-col gap-2">
            <label v-for="c in reviewConflicts" :key="c.key" class="flex items-start gap-2.5 px-2.5 py-2 rounded-md bg-white border border-line cursor-pointer">
              <input type="checkbox" v-model="c.checked" class="mt-1" />
              <div class="min-w-0 flex-1 text-[13px]">
                <div class="font-600">{{ c.incoming.company }} · 单号 {{ c.incoming.orderNo }} <span class="text-ink-soft font-400">· {{ c.site }}</span></div>
                <div class="text-ink-soft">库中旧：{{ itemsBrief(c.old) }}</div>
                <div class="text-brand">本次新：{{ itemsBrief(c.incoming) }}</div>
              </div>
            </label>
          </div>
          <div class="mt-4 flex items-center justify-end gap-2">
            <button class="btn px-3 py-1.5" @click="reviewOpen = false">取消</button>
            <button class="btn-primary px-3 py-1.5" @click="confirmReview">确认入库（按勾选覆盖）</button>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
</template>
