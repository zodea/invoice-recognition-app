<script setup>
import { computed } from "vue";
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { store, actions, collectProblems, partitionName } from "../store";

const problems = computed(() => collectProblems());
const open = computed({
  get: () => store.problemsOpen,
  set: (v) => (store.problemsOpen = v),
});

const rowCls = "flex items-start gap-2 px-2 py-1.5 rounded-md bg-white border border-line text-[13px]";
</script>

<template>
  <DialogRoot :open="open" @update:open="open = $event">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/40" />
      <DialogContent
        class="fixed z-51 top-[6vh] left-1/2 -translate-x-1/2 w-[min(860px,94vw)] max-h-[88vh] overflow-auto bg-bg rounded-card shadow-pop p-4 outline-none"
      >
        <div class="flex items-center gap-2.5 mb-3">
          <DialogTitle class="m-0 text-base font-700">⚠ 需要处理的问题（{{ problems.total }} 项）</DialogTitle>
          <DialogClose class="ml-auto btn px-2.5 py-1">关闭 ✕</DialogClose>
        </div>

        <div v-if="!problems.total" class="text-ink-soft text-sm p-4 text-center">没有待处理的问题了 🎉</div>

        <!-- ① 识别失败 -->
        <section v-if="problems.ocrFailed.length" class="panel p-2.5 mb-3 border-l-4 !border-l-danger">
          <div class="flex items-center gap-2 mb-1.5">
            <h3 class="m-0 text-sm font-700 text-danger">识别失败（{{ problems.ocrFailed.length }}）</h3>
            <button class="btn px-2.5 py-1 text-xs ml-auto" :disabled="store.ocrBusy" @click="actions.retryFailedOcr()">↻ 全部重试</button>
          </div>
          <div class="flex flex-col gap-1.5">
            <div v-for="f in problems.ocrFailed" :key="f.id" :class="rowCls">
              <span class="flex-none">📄</span>
              <div class="min-w-0 flex-1">
                <div class="font-600 truncate" :title="f.name">{{ f.name }}<span class="text-ink-soft font-400">　{{ partitionName(f.partitionId) }}</span></div>
                <div class="text-danger">{{ f.ocrError }}</div>
              </div>
            </div>
          </div>
        </section>

        <!-- ② 无法读取/抽图 -->
        <section v-if="problems.unreadable.length" class="panel p-2.5 mb-3 border-l-4 !border-l-warn">
          <h3 class="m-0 mb-1.5 text-sm font-700 text-warn">无法读取页图（{{ problems.unreadable.length }}）</h3>
          <div class="flex flex-col gap-1.5">
            <div v-for="f in problems.unreadable" :key="f.id" :class="rowCls">
              <span class="flex-none">🚫</span>
              <div class="min-w-0 flex-1">
                <div class="font-600 truncate" :title="f.name">{{ f.name }}<span class="text-ink-soft font-400">　{{ partitionName(f.partitionId) }}</span></div>
                <div class="text-ink-soft">{{ f.renderError }}　→ 处理方式：在文件卡片里手动填写公司和明细，仍可正常导出。</div>
              </div>
            </div>
          </div>
        </section>

        <!-- ③ 公司不一致 -->
        <section v-if="problems.conflicts.length" class="panel p-2.5 mb-3 border-l-4 !border-l-warn">
          <h3 class="m-0 mb-1.5 text-sm font-700 text-[#92400e]">公司与识别不一致（{{ problems.conflicts.length }}）</h3>
          <div class="flex flex-col gap-1.5">
            <div v-for="f in problems.conflicts" :key="f.id" :class="rowCls">
              <span class="flex-none">🏷</span>
              <div class="min-w-0 flex-1">
                <div class="font-600 truncate" :title="f.name">{{ f.name }}<span class="text-ink-soft font-400">　{{ partitionName(f.partitionId) }}</span></div>
                <div>当前「<b>{{ f.company }}</b>」，红章识别「<b>{{ f.companyOcr }}</b>」</div>
              </div>
              <div class="flex-none flex gap-1.5">
                <button class="btn px-2 py-0.75 text-xs border-warn text-[#92400e]" @click="actions.adoptOcrCompany(f)">用识别的</button>
                <button class="btn px-2 py-0.75 text-xs" @click="actions.dismissCompanyConflict(f)">保留当前</button>
              </div>
            </div>
          </div>
        </section>

        <!-- ④ 部分页失败 -->
        <section v-if="problems.partial.length" class="panel p-2.5 border-l-4 !border-l-line-strong">
          <h3 class="m-0 mb-1.5 text-sm font-700 text-ink-soft">部分页未识别（{{ problems.partial.length }}，整体已完成）</h3>
          <div class="flex flex-col gap-1.5">
            <div v-for="f in problems.partial" :key="f.id" :class="rowCls">
              <span class="flex-none">📄</span>
              <div class="min-w-0 flex-1">
                <div class="font-600 truncate">{{ f.name }}</div>
                <div class="text-ink-soft">{{ f.ocrPartial }}　→ 缺的内容请人工补录。</div>
              </div>
            </div>
          </div>
        </section>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
