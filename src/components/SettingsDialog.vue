<script setup>
import { ref } from "vue";
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { appSettings, saveAppSettings, vlConfigured } from "../lib/app-settings";
import { vlParseDocument } from "../lib/ocr-vl";
import { toast, toastError, toastInfo } from "../lib/toast";
import LocalDataPanel from './LocalDataPanel.vue';
import { flushLocalData } from '../lib/local-data.js';

defineProps({ open: Boolean });
const emit = defineEmits(["update:open"]);

const testing = ref(false);

async function save() {
  appSettings.vlApiUrl = (appSettings.vlApiUrl || "").trim();
  appSettings.vlToken = (appSettings.vlToken || "").trim();
  try { saveAppSettings(); await flushLocalData(); toast("设置已保存到本地。"); return true; }
  catch (e) { toastError(String(e.message || e)); return false; }
}

// 用一张小测试图实测一次云识别，验证 地址+令牌+网络 三件事
async function testConnection() {
  if (!await save()) return;
  if (!vlConfigured()) {
    toastError("请先填写 API 地址（https 开头）和访问令牌。");
    return;
  }
  testing.value = true;
  try {
    const c = document.createElement("canvas");
    c.width = 220;
    c.height = 90;
    const x = c.getContext("2d");
    x.fillStyle = "#fff";
    x.fillRect(0, 0, 220, 90);
    x.fillStyle = "#000";
    x.font = "32px sans-serif";
    x.fillText("测试123", 30, 55);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const res = await vlParseDocument({ blob });
    const text = (res.markdownPages || []).join(" ").replace(/\s+/g, "");
    if (text.includes("测试") || text.includes("123")) toast(`连接成功 ✓ 云识别返回：「${text.slice(0, 30)}」`);
    else toastInfo(`已连通，返回内容：「${text.slice(0, 40) || "(空)"}」`);
  } catch (e) {
    toastError(String((e && e.message) || e));
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/40" />
      <DialogContent class="fixed z-51 top-[5vh] left-1/2 -translate-x-1/2 w-[min(680px,94vw)] max-h-[90vh] overflow-y-auto bg-bg rounded-card shadow-pop p-4 outline-none">
        <div class="flex items-center mb-3">
          <DialogTitle class="m-0 text-base font-700">设置</DialogTitle>
          <DialogClose class="ml-auto btn px-2.5 py-1">关闭 ✕</DialogClose>
        </div>

        <LocalDataPanel />
        <div class="panel p-3 mt-3 flex flex-col gap-2.5">
          <h3 class="m-0 text-sm">云识别（PaddleOCR-VL）</h3>
          <p class="m-0 text-ink-soft text-xs leading-relaxed">
            手写送货单识别需要云端大模型。到
            <b class="text-brand">aistudio.baidu.com/paddleocr/task</b>
            登录后，在「API 调用示例」里复制下面两项（免费额度内不收费）。填好后所有识别自动走云端，未填则用本地小模型（仅能识别印刷体）。
          </p>
          <label class="field-label">API 地址（官方异步接口，…/api/v2/ocr/jobs）
            <input class="field-input" v-model="appSettings.vlApiUrl" placeholder="https://paddleocr.aistudio-app.com/api/v2/ocr/jobs" />
          </label>
          <label class="field-label">访问令牌 Access Token
            <input class="field-input font-mono" v-model="appSettings.vlToken" placeholder="40 位字符" />
          </label>
          <div class="flex gap-2">
            <button class="btn-primary px-3 py-1.5" @click="save">保存</button>
            <button class="btn px-3 py-1.5" :disabled="testing" @click="testConnection">{{ testing ? "测试中…" : "测试连接" }}</button>
            <span class="ml-auto self-center text-xs" :class="vlConfigured() ? 'text-ok' : 'text-ink-soft'">
              {{ vlConfigured() ? "✓ 已配置：识别将走云端" : "未配置：识别走本地小模型" }}
            </span>
          </div>
          <p class="m-0 text-ink-soft text-[11px]">桌面版令牌保存在本地数据目录并随完整备份携带；识别时单据图片会发送到百度星河平台处理。</p>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
