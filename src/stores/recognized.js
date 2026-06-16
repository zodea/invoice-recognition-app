// 识别明细库 pinia store（issue #14 / ADR-0003）：内存汇总所有工地 JSON，
// 供「分供方详情」「单价对比」跨工地读、「工地详情」单工地读；与当前会话 store.files 叠加由各页处理。
import { defineStore } from "pinia";
import { ref } from "vue";
import { loadAllRecognized, saveSiteRecognized } from "../lib/recognized-io";
import { recordsToDeliveryItems } from "../lib/recognized-store";

export const useRecognizedStore = defineStore("recognized", () => {
  const bySite = ref({}); // 工地名 -> records[]
  const loaded = ref(false);

  async function ensureLoaded() {
    if (loaded.value) return;
    bySite.value = await loadAllRecognized();
    loaded.value = true;
  }
  function allRecords() {
    return Object.values(bySite.value).flat();
  }
  // 供单价对比/分供方详情复用的"已入库"明细（与 aggregateItems 同形，normKey 由 price-compare 现补）。
  function allDeliveryItems() {
    return recordsToDeliveryItems(allRecords());
  }
  async function saveSite(site, records) {
    bySite.value = { ...bySite.value, [site]: records };
    return saveSiteRecognized(site, records);
  }

  return { bySite, loaded, ensureLoaded, allRecords, allDeliveryItems, saveSite };
});
