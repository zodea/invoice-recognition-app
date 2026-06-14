<script setup>
import { computed, ref } from "vue";
import { store, actions } from "../store";
import {
  treeStats,
  moveFile,
  moveGroup,
  promoteGroupToSite,
  demoteSiteToGroup,
  addSite,
  addGroup,
  computeSuggestions,
  PENDING_GROUP,
} from "../lib/delivery-tree";
import { loadSuppliers } from "../lib/supplier-db";
import { toast, toastInfo, toastWarn } from "../lib/toast";

const tree = computed(() => store.staging?.tree);
const mode = computed(() => store.staging?.mode);
const stats = computed(() => (tree.value ? treeStats(tree.value) : null));
const supplierNames = loadSuppliers().map((s) => s.name);

const dragHint = ref("");

function onFileDragStart(e, fileKey) {
  e.dataTransfer.setData("text/tree-file", fileKey);
  e.dataTransfer.effectAllowed = "move";
  dragHint.value = "拖到目标分组上放下";
}
function onGroupDragStart(e, groupKey) {
  e.dataTransfer.setData("text/tree-group", groupKey);
  e.dataTransfer.effectAllowed = "move";
  dragHint.value = "拖到目标工地上放下";
}
function onDropToGroup(e, groupKey) {
  const fk = e.dataTransfer.getData("text/tree-file");
  if (fk && moveFile(tree.value, fk, groupKey)) {
    computeSuggestions(tree.value);
  }
  dragHint.value = "";
}
function onDropToSite(e, siteKey) {
  const gk = e.dataTransfer.getData("text/tree-group");
  if (gk && moveGroup(tree.value, gk, siteKey)) {
    computeSuggestions(tree.value);
    return;
  }
  // 文件直接拖到工地标题 → 进该工地（待分组）
  const fk = e.dataTransfer.getData("text/tree-file");
  if (fk) {
    const site = tree.value.sites.find((s) => s.key === siteKey);
    if (site) {
      let g = site.groups.find((x) => x.rawName === PENDING_GROUP);
      if (!g) g = addGroup(tree.value, siteKey, PENDING_GROUP);
      moveFile(tree.value, fk, g.key);
      computeSuggestions(tree.value);
    }
  }
  dragHint.value = "";
}

function onSiteCheckbox(site, checked) {
  if (checked) return; // 已是工地
  if (tree.value.sites.length < 2) {
    toastWarn("只有一个工地，无法降级。先新建或保留。");
    return;
  }
  const target = tree.value.sites.find((s) => s.key !== site.key);
  demoteSiteToGroup(tree.value, site.key, target.key);
  toastInfo(`已并入「${target.name}」。`);
}
function onGroupCheckbox(group, checked) {
  if (!checked) return;
  const s = promoteGroupToSite(tree.value, group.key);
  if (s) toastInfo(`「${group.rawName}」已升级为工地。`);
}

function applySuggestion(f) {
  if (f.suggestGroupKey && moveFile(tree.value, f.key, f.suggestGroupKey)) {
    computeSuggestions(tree.value);
  }
}

function confirmApply() {
  const r = actions.applyStaging();
  toast(mode.value === "reorg" ? `调整完成：${r.moved} 个文件已更新归属。` : `导入完成：新增 ${r.added} 个文件${r.moved ? `，调整 ${r.moved} 个` : ""}。`);
}
function cancel() {
  actions.discardStaging();
  toastInfo("已取消，未做任何更改。");
}

const viaLabel = { name: "全称", alias: "别名", fuzzy: "模糊" };
</script>

<template>
  <div v-if="tree" class="panel p-3 border-2 !border-brand">
    <div class="flex items-center gap-2.5 flex-wrap mb-2">
      <h2 class="m-0 text-[15px] font-700">🌲 整理树 — {{ mode === "reorg" ? "重新整理已导入文件" : "导入前确认归属" }}</h2>
      <span class="text-ink-soft text-xs" v-if="stats">
        {{ stats.sites }} 个工地 · {{ stats.groups }} 组 · {{ stats.files }} 个文件
        <template v-if="stats.unmapped">　<b class="text-warn">{{ stats.unmapped }} 组未映射到分供方</b></template>
        <template v-if="stats.ignored">　（忽略不支持 {{ stats.ignored }} 个）</template>
      </span>
      <span class="text-brand text-xs" v-if="dragHint">{{ dragHint }}</span>
      <div class="ml-auto flex gap-2">
        <button class="btn px-2.5 py-1.5" @click="addSite(tree, '新工地')">＋ 新建工地</button>
        <button class="btn-primary px-3 py-1.5" @click="confirmApply">✓ 确认{{ mode === "reorg" ? "调整" : "导入" }}</button>
        <button class="btn-ghost px-2.5 py-1.5" @click="cancel">取消</button>
      </div>
    </div>
    <p class="m-0 mb-2 text-ink-soft text-xs">
      文件可拖到别的组；组可拖到别的工地。勾「是工地」把组升级成独立工地；公司名可改（特殊组只是中转，识别后以红章为准）。
    </p>

    <datalist id="supplier-name-list">
      <option v-for="n in supplierNames" :key="n" :value="n" />
    </datalist>

    <div class="flex flex-col gap-2.5 max-h-[60vh] overflow-auto pr-1">
      <section
        v-for="site in tree.sites"
        :key="site.key"
        class="border border-line-strong rounded-lg bg-white"
        @dragover.prevent
        @drop.prevent="onDropToSite($event, site.key)"
      >
        <header class="flex items-center gap-2 px-2.5 py-2 bg-[#f0f5ff] rounded-t-lg border-b border-line">
          <label class="inline-flex items-center gap-1 text-xs text-ink-soft" title="取消勾选=并入其它工地">
            <input type="checkbox" :checked="true" @change="onSiteCheckbox(site, $event.target.checked)" /> 是工地
          </label>
          <input
            v-model="site.name"
            class="field-input !w-60 font-700 text-ink"
            :placeholder="site.rawName || '工地名'"
            :title="'原文件夹名：' + (site.rawName || '（无）')"
          />
          <span class="text-ink-soft text-xs">{{ site.groups.reduce((n, g) => n + g.files.length, 0) }} 个文件 · Excel：{{ site.name || "工地" }}-送货单整理汇总.xlsx</span>
        </header>

        <div class="p-2 flex flex-col gap-1.5">
          <div
            v-for="g in site.groups"
            :key="g.key"
            class="border border-line rounded-md"
            @dragover.prevent
            @drop.prevent.stop="onDropToGroup($event, g.key)"
          >
            <div class="flex items-center gap-2 px-2 py-1.5 bg-[#fafbfc] rounded-t-md cursor-grab" draggable="true" @dragstart="onGroupDragStart($event, g.key)">
              <label class="inline-flex items-center gap-1 text-xs text-ink-soft" title="勾选=把这个组升级为独立工地">
                <input type="checkbox" :checked="false" @change="onGroupCheckbox(g, $event.target.checked)" /> 是工地
              </label>
              <b class="text-[13px]">{{ g.rawName }}</b>
              <span v-if="g.mergedFrom.length" class="chip bg-[#fef9c3] text-[#854d0e] px-1.5" :title="'已自动合并：' + g.mergedFrom.join('、')">+{{ g.mergedFrom.length }} 同名并入</span>
              <span v-if="g.kind === 'special'" class="chip bg-[#f3e8ff] text-[#7e22ce] px-1.5">特殊组(中转)</span>
              <template v-else>
                <span v-if="g.mappedName" class="chip bg-[#dcfce7] text-[#15803d] px-1.5" :title="'按' + (viaLabel[g.via] || '') + '匹配到分供方'">{{ viaLabel[g.via] || "已映射" }}</span>
                <span v-else class="chip bg-[#ffedd5] text-[#9a3412] px-1.5" title="分供方库里没有这家，可去分供方页补充别名">未映射</span>
              </template>
              <input
                v-model="g.company"
                list="supplier-name-list"
                class="field-input !w-70 ml-auto"
                :placeholder="g.kind === 'special' ? '（中转组，公司待识别）' : '导出用公司全称'"
              />
              <span class="text-ink-soft text-xs">{{ g.files.length }}</span>
            </div>
            <ul class="m-0 p-1 list-none flex flex-col">
              <li
                v-for="f in g.files"
                :key="f.key"
                class="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-brand-soft cursor-grab text-[13px]"
                draggable="true"
                @dragstart="onFileDragStart($event, f.key)"
              >
                <span class="text-ink-soft">📄</span>
                <span class="truncate" :title="f.relPath">{{ f.name }}</span>
                <span v-if="f.dateGuess" class="chip bg-[#e0f2fe] text-[#0369a1] px-1.5" title="按文件名预填日期">{{ f.dateGuess }}</span>
                <button
                  v-if="f.suggestGroupKey"
                  class="chip bg-[#fef9c3] text-[#854d0e] px-1.5 border-none cursor-pointer"
                  :title="'文件名疑似属于该组，点击移动'"
                  @click="applySuggestion(f)"
                >
                  疑似→{{ f.suggestLabel }}
                </button>
              </li>
              <li v-if="!g.files.length" class="px-1.5 py-1 text-ink-soft text-xs">（空组，可拖文件进来）</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
