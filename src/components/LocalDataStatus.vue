<script setup lang="ts">
import { computed } from 'vue';
import { localDataState as data, flushLocalData } from '../lib/local-data.js';
const label = computed(() => data.error ? '保存失败，请重试' : data.pending || data.fileWrites ? '正在保存到本地…' : '已保存到本地');
async function retry() { try { await flushLocalData(); data.notice = ''; } catch { /* persistent error remains visible */ } }
</script>

<template>
  <div v-if="data.desktop" class="local-data-status" aria-live="polite">
    <span :class="data.error ? 'text-danger' : 'text-ink-soft'" :title="data.root">{{ label }}</span>
    <div v-if="data.error || data.notice" class="local-data-error" role="alert">
      <span>{{ data.notice || '数据尚未保存到磁盘，请勿关闭软件。' }} {{ data.error }}</span>
      <button class="btn" :disabled="data.busy" @click="retry">重试保存</button>
    </div>
  </div>
</template>
