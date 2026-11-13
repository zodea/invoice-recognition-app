<script setup lang="ts">
import { onMounted, shallowRef } from 'vue';
import { localDataState as data, withLocalDataPaused, flushLocalData } from '../lib/local-data.js';
import { invokeTauri } from '../lib/platform.js';
import { toast, toastError } from '../lib/toast.js';

type Summary = { ledger: number; payments: number; suppliers: number; trash: number; records: number; files: number; bytes: number };
type Preview = { path: string; summary: Summary };
const summary = shallowRef<Summary | null>(null);
const preview = shallowRef<Preview | null>(null);
const result = shallowRef('');
const working = shallowRef(false);
const restored = shallowRef(false);
onMounted(async () => { if (data.desktop) { try { summary.value = (await invokeTauri('local_data_init')).summary; } catch (e) { toastError(String(e)); } } });

async function run(operation: () => Promise<void>) {
  working.value = true;
  try { await withLocalDataPaused(operation); } catch (e) { toastError(String(e instanceof Error ? e.message : e)); }
  finally { working.value = false; }
}
async function backup() {
  await run(async () => {
    const path = await invokeTauri('local_data_backup');
    if (path) { result.value = '完整备份已保存：' + path; toast('完整数据备份已保存。'); }
  });
}
async function chooseBackup() {
  await run(async () => { preview.value = await invokeTauri('local_data_prepare_restore'); });
}
async function cancelRestore() {
  try { await invokeTauri('local_data_cancel_restore'); preview.value = null; } catch (e) { toastError(String(e)); }
}
async function restore() {
  await run(async () => {
    const path = await invokeTauri('local_data_restore');
    result.value = '恢复成功。恢复前的数据已自动备份至：' + path;
    restored.value = true; preview.value = null;
    // Keep the old stores frozen until a fresh boot reads the restored snapshot.
    location.reload();
  });
}
async function openFolder() {
  try { await invokeTauri('local_data_open_folder'); } catch (e) { toastError(String(e)); }
}
async function retrySave() {
  try { await flushLocalData(); data.notice = ''; toast('数据已保存到本地。'); }
  catch (e) { toastError(String(e instanceof Error ? e.message : e)); }
}
</script>

<template>
  <section class="panel p-3 flex flex-col gap-2.5" aria-labelledby="local-data-title">
    <h3 id="local-data-title" class="m-0 text-sm">本地数据与备份</h3>
    <template v-if="data.desktop">
      <p class="m-0 text-xs text-ink-soft">数据目录</p>
      <div class="flex items-center gap-2 min-w-0">
        <code class="local-data-path" :title="data.root">{{ data.root }}</code>
        <button class="btn" :disabled="working" @click="openFolder">打开目录</button>
      </div>
      <p v-if="summary" class="m-0 text-xs text-ink-soft">{{ summary.ledger }} 张发票 · {{ summary.payments }} 笔付款 · {{ summary.suppliers }} 家分供方 · {{ summary.files }} 份原件及附件</p>
      <p v-if="data.migration" class="m-0 text-xs text-ok" role="status">{{ data.migration }}</p>
      <div v-if="data.error" class="local-restore-preview" role="alert">
        <p>数据尚未写入磁盘，请勿关闭软件。{{ data.error }}</p>
        <button class="btn" :disabled="working" @click="retrySave">重试写入本地数据</button>
      </div>
      <p class="m-0 text-xs text-ink-soft leading-relaxed">换电脑时，先关闭软件，再复制“软件 exe ＋ 数据文件夹”到另一台电脑的同一文件夹。两边轮流使用，每次以最后使用的那份数据为准。</p>
      <div class="flex gap-2 flex-wrap">
        <button class="btn-primary" :disabled="working || restored || !!data.error" @click="backup">{{ working ? '正在处理…' : '一键完整备份' }}</button>
        <button class="btn" :disabled="working || restored || !!data.error" @click="chooseBackup">从备份恢复</button>
      </div>
      <p class="m-0 text-xs text-ink-soft leading-relaxed">备份包含台账、付款、档案、回收站、原件、附件及设置（含识别令牌），请妥善保管。当前未确认保存的识别批次仍是临时内容，换电脑前请先处理完成。</p>
      <div v-if="preview" class="local-restore-preview" role="region" aria-label="备份恢复确认">
        <strong class="text-sm">恢复这份完整备份？</strong>
        <p class="local-data-path" :title="preview.path">{{ preview.path }}</p>
        <p>备份内有 {{ preview.summary.ledger }} 张发票、{{ preview.summary.payments }} 笔付款、{{ preview.summary.files }} 份原件及附件，回收站 {{ preview.summary.trash }} 条。</p>
        <p>将替换当前整套数据，不合并两台电脑的修改。软件会先自动备份当前数据，恢复成功后重新载入。</p>
        <div class="flex gap-2">
          <button class="btn-primary" :disabled="working" @click="restore">确认恢复整套数据</button>
          <button class="btn" :disabled="working" @click="cancelRestore">取消</button>
        </div>
      </div>
      <p v-if="result" class="m-0 text-xs break-all" role="status">{{ result }}</p>
    </template>
    <p v-else class="m-0 text-xs text-ink-soft">桌面版支持随软件携带的数据目录和完整备份恢复。当前浏览器预览使用独立的浏览器存储。</p>
  </section>
</template>
