<script setup>
import { ref } from "vue";
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { appSettings, saveAppSettings, vlConfigured } from "../lib/app-settings";
import { vlParseDocument } from "../lib/ocr-vl";
import { toast, toastError, toastInfo } from "../lib/toast";

defineProps({ open: Boolean });
const emit = defineEmits(["update:open"]);

const testing = ref(false);

function save() {
  appSettings.vlApiUrl = (appSettings.vlApiUrl || "").trim();
  appSettings.vlToken = (appSettings.vlToken || "").trim();
  saveAppSettings();
  toast("设置已保存（仅存本机）。");
}

// 用一张小测试图实测一次云识别，验证 地址+令牌+网络 三件事
async function testConnection() {
  save();
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
      <DialogContent class="fixed z-51 top-[10vh] left-1/2 -translate-x-1/2 w-[min(640px,94vw)] bg-bg rounded-card shadow-pop p-4 outline-none">
        <div class="flex items-center mb-3">
          <DialogTitle class="m-0 text-base font-700 flex items-center gap-2">
            <span class="i-lucide-settings w-5 h-5 text-ink-soft"></span>
            设置 — 云识别（PaddleOCR-VL）
          </DialogTitle>
          <DialogClose class="ml-auto inline-flex items-center justify-center w-8 h-8 rounded-btn border border-line bg-white text-ink-soft hover:(border-brand text-brand) transition">
            <span class="i-lucide-x w-4 h-4"></span>
          </DialogClose>
        </div>

        <div class="panel p-3 flex flex-col gap-2.5">
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
          <p class="m-0 text-ink-soft text-[11px]">令牌只保存在本机（localStorage），不会写入任何文件或上传；识别时单据图片会发送到百度星河平台处理。</p>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
