<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { formatMoney } from '../lib/format.js';

const props = defineProps({ queue: { type: Array, required: true }, progress: [Object, String], busy: Boolean });
const pinned = ref(null);
const progressText = computed(() => typeof props.progress === 'string' ? props.progress : props.progress?.text);
const running = computed(() => props.queue.find(task => task.state === '识别中'));
const chosen = computed(() => pinned.value || running.value || props.queue.at(-1));
const done = computed(() => props.queue.filter(task => task.state !== '识别中' && task.state !== '等待读取').length);
watch(() => props.queue, () => { pinned.value = null; });
async function navigate(event, index) {
  const last = props.queue.length - 1;
  const next = { ArrowDown: Math.min(index + 1, last), ArrowUp: Math.max(index - 1, 0), Home: 0, End: last }[event.key];
  if (next === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  const list = event.currentTarget.parentElement;
  pinned.value = props.queue[next];
  await nextTick();
  list.children[next]?.focus();
}
const fields = computed(() => chosen.value?.fields || {});
</script>
<template>
  <section class="recognition" aria-label="凭证识别">
    <header class="recognition-heading">
      <h2>凭证识别工作台</h2>
      <span v-if="busy" class="ui-badge-brand">正在读取批次</span>
    </header>
    <p v-if="!queue.length" class="queue-empty">{{ busy ? '正在读取清单与内嵌附件…' : '选择清单、凭证或文件夹，也可以将付款资料拖入此工作台。' }}</p>
    <div v-else class="queue-workbench">
      <section class="queue-pane" aria-label="凭证文件队列">
        <div class="queue-heading"><strong>凭证识别</strong><span class="ui-money">{{ done }} / {{ queue.length }}</span></div>
        <progress :value="done" :max="queue.length" aria-label="凭证识别进度"></progress>
        <p v-if="progressText" class="queue-status" :title="progressText" role="status">{{ progressText }}</p>
        <div class="queue-list">
          <button v-for="(task, index) in queue" :key="index" type="button" class="ui-focus queue-row" v-memo="[task, task.state, task.detail, chosen === task]" :aria-pressed="chosen === task" :tabindex="chosen === task ? 0 : -1" @click="pinned = task" @keydown="navigate($event, index)">
            <span class="task-name"><MiddleEllipsis :text="task.file.name" :tail="12" /><small v-if="task.detail" :title="task.detail">{{ task.detail }}</small></span>
            <span :class="task.state === '已识别' ? 'ui-badge-ok' : task.state === '识别中' ? 'ui-badge-brand' : 'ui-badge-neutral'">{{ task.state }}</span>
          </button>
        </div>
      </section>
      <section v-if="chosen" class="queue-pane preview-pane" aria-label="凭证预览及识别结果">
        <div class="queue-heading"><MiddleEllipsis :text="chosen.file.name" :tail="12" />
          <button v-if="busy && pinned" type="button" class="ui-btn-sm shrink-0" @click="pinned = null">跟随识别</button>
        </div>
        <EvidenceDocument :file="chosen.file" />
        <dl class="queue-fields">
          <div><dt>商户 / 收款人</dt><dd>{{ fields.seller || fields.counterparty || '待核对' }}</dd></div>
          <div><dt>金额</dt><dd>{{ fields.total != null && fields.total !== '' ? '¥' + formatMoney(fields.total) : '待核对' }}</dd></div>
          <div><dt>付款日期</dt><dd>{{ fields.date || '待核对' }}</dd></div>
          <div><dt>交易 / 订单号</dt><dd><TransactionNumber v-if="fields.transactionId || fields.orderId" :value="fields.transactionId || fields.orderId" /><template v-else>待核对</template></dd></div>
        </dl>
      </section>
    </div>
  </section>
</template>
<style scoped>
.recognition { container-type: inline-size; min-width: 0; }
.recognition-heading, .queue-heading { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; }
.recognition-heading { padding: 10px 2px; }
.queue-workbench { display: grid; grid-template-columns: minmax(320px, .85fr) minmax(0, 1.25fr); align-items: start; gap: 10px; }
.queue-pane { display: grid; min-width: 0; gap: 8px; border: 1px solid #dce4ed; border-radius: 8px; background: white; padding: 10px; }
.queue-pane progress { width: 100%; height: 6px; accent-color: #1867c0; }
.queue-list { max-height: 65dvh; overflow: auto; }
.queue-row { content-visibility: auto; contain-intrinsic-size: auto 38px; display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 8px 4px; border-bottom: 1px solid #e3eaf1; text-align: left; }
.queue-row[aria-pressed=true] { background: #eaf3fc; }
.task-name { display: grid; flex: 1; min-width: 0; }
.task-name small, .queue-status { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #62778c; font-size: 12px; }
.queue-row > :last-child { flex-shrink: 0; white-space: nowrap; }
.queue-fields { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; margin: 0; }
.queue-fields dt { color: #62778c; font-size: 12px; }
.queue-fields dd { margin: 2px 0; min-width: 0; overflow-wrap: anywhere; }
.queue-empty { margin: 0; padding: 20px; border: 1px dashed #aec7de; border-radius: 8px; color: #566b81; }
@container (max-width: 669px) {
  .queue-workbench { grid-template-columns: minmax(0,1fr); }
  .queue-list { max-height: 30dvh; }
}
@container (max-width: 360px) {
  .queue-fields { grid-template-columns: minmax(0,1fr); }
}
</style>
