<script setup>
// 工人详情（路由页 /worker/:id，DESIGN-project-worker.md §2.4）：
// 个人信息卡片（只读，右上编辑）+ 证书档案（有效期着色）+ 出勤记录（按月）+ 工资支付 + 对账余额。
import { computed, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useWorkerStore } from "../stores/worker";
import { emptyAttendance, emptyWorkerPayment, certExpiryStatus, certStatusClass, certStatusLabel } from "../lib/worker-db";
import { toast, toastWarn } from "../lib/toast";
import WorkerFormDialog from "../components/WorkerFormDialog.vue";

const route = useRoute();
const router = useRouter();
const workerStore = useWorkerStore();

const worker = computed(() => workerStore.byId(route.params.id));
const formOpen = ref(false);

function onFormSubmit({ record }) {
  workerStore.update(record);
  formOpen.value = false;
  toast("已保存工人信息。");
}

const certs = computed(() => worker.value?.certs || []);
const attendance = computed(() => worker.value?.attendance || []);
const payments = computed(() => worker.value?.payments || []);

const totalDays = computed(() => attendance.value.reduce((s, a) => s + (Number(a.daysWorked) || 0), 0));
const paySum = computed(() => payments.value.reduce((s, p) => s + (Number(p.amount) || 0), 0));
const payable = computed(() => {
  const wage = Number(worker.value?.dailyWage) || 0;
  return Math.round((totalDays.value * wage - paySum.value) * 100) / 100;
});

const draftA = reactive(emptyAttendance());
const draftP = reactive(emptyWorkerPayment());

function addAttendance() {
  if (!worker.value) return;
  if (!draftA.month || !(Number(draftA.daysWorked) > 0)) { toastWarn("出勤记录需要 月份 和 出勤天数。"); return; }
  if (!worker.value.attendance) worker.value.attendance = [];
  worker.value.attendance.push({ ...draftA });
  Object.assign(draftA, emptyAttendance());
  workerStore.persist();
  toast("已添加出勤记录。");
}
function delAttendance(id) {
  const arr = worker.value?.attendance || [];
  const i = arr.findIndex((x) => x.id === id);
  if (i >= 0) arr.splice(i, 1);
  workerStore.persist();
}
function addPayment() {
  if (!worker.value) return;
  if (!draftP.date || !(Number(draftP.amount) > 0)) { toastWarn("支付记录需要 日期 和 金额。"); return; }
  if (!worker.value.payments) worker.value.payments = [];
  worker.value.payments.push({ ...draftP });
  Object.assign(draftP, emptyWorkerPayment());
  workerStore.persist();
  toast("已添加支付记录。");
}
function delPayment(id) {
  const arr = worker.value?.payments || [];
  const i = arr.findIndex((x) => x.id === id);
  if (i >= 0) arr.splice(i, 1);
  workerStore.persist();
}

const money = (v) => (Number(v) || 0).toFixed(2);

const infoRows = computed(() => {
  const w = worker.value || {};
  return [
    ["性别", w.gender], ["身份证号", w.idCard], ["联系电话", w.phone], ["籍贯", w.hometown],
    ["紧急联系人", [w.emergencyContact, w.emergencyPhone].filter(Boolean).join(" / ")],
    ["工种", w.trade], ["技能等级", w.skillLevel], ["日工资", w.dailyWage != null ? `¥${w.dailyWage}` : ""], ["所属班组", w.team],
    ["当前项目", w.currentProject], ["进场日期", w.entryDate], ["退场日期", w.exitDate], ["备注", w.note],
  ];
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="panel p-3 flex items-center gap-2.5 flex-wrap">
      <button class="btn px-2.5 py-1.5" @click="router.push('/worker')">
        <span class="i-lucide-arrow-left w-4 h-4 flex-none"></span>
        返回
      </button>
      <h2 class="m-0 text-base font-800">{{ worker?.name || "工人详情" }}</h2>
      <span v-if="worker" :class="worker.projectStatus === '已退场' ? 'chip bg-surface-3 text-ink-soft' : 'chip-brand'">{{ worker.projectStatus || "在场" }}</span>
      <span v-if="worker" class="text-ink-soft text-xs">{{ worker.trade || "工种?" }}　{{ worker.currentProject || "未分配项目" }}</span>
      <button v-if="worker" class="btn-primary px-2.5 py-1.5 ml-auto" @click="formOpen = true">
        <span class="i-lucide-square-pen w-4 h-4 flex-none"></span>
        编辑
      </button>
    </div>

    <div v-if="!worker" class="panel p-6 text-center text-ink-soft">未找到该工人，可能已被删除。<button class="btn px-2.5 py-1 ml-2" @click="router.push('/worker')">返回列表</button></div>

    <template v-else>
      <!-- 对账余额 -->
      <div class="panel p-2.5 flex gap-5 flex-wrap text-ink-soft text-[13px]">
        <span>累计出勤 <b class="text-ink text-[15px]">{{ totalDays }}</b> 天</span>
        <span>应发工资 <b class="text-ink text-[15px]">{{ money(totalDays * (Number(worker.dailyWage) || 0)) }}</b></span>
        <span>已支付合计 <b class="text-ok text-[15px]">{{ money(paySum) }}</b></span>
        <span>应付余额 <b :class="payable > 0 ? 'text-danger' : 'text-ok'" class="text-[15px]">{{ money(payable) }}</b></span>
      </div>

      <!-- 个人信息卡片 -->
      <div class="panel p-3">
        <h3 class="m-0 mb-3 text-sm font-700">个人信息</h3>
        <div class="grid grid-cols-2 lt-md:grid-cols-1 gap-x-8 gap-y-2">
          <div v-for="[label, val] in infoRows" :key="label" class="flex gap-3 text-sm border-b border-line/60 py-1.5">
            <span class="text-ink-soft w-24 flex-none">{{ label }}</span>
            <span class="text-ink min-w-0 break-all">{{ val || "—" }}</span>
          </div>
        </div>
      </div>

      <!-- 证书档案 -->
      <div class="panel p-3">
        <h3 class="m-0 mb-2 text-sm font-700">证书档案（{{ certs.length }} 项）</h3>
        <div v-if="certs.length" class="flex flex-col gap-1.5">
          <div v-for="c in certs" :key="c.id" class="flex items-center gap-2 border border-line rounded-md px-2.5 py-1.5 bg-white text-sm flex-wrap">
            <span class="font-600 text-ink">{{ c.category }}</span>
            <span v-if="c.subType" class="text-ink-soft text-xs">· {{ c.subType }}</span>
            <span class="text-ink-soft text-xs truncate min-w-0 flex-1" :title="c.fileName">{{ c.fileName || "（无文件）" }}</span>
            <span class="text-ink-soft text-xs">有效期 {{ c.expiryDate || "—" }}</span>
            <span :class="certStatusClass(certExpiryStatus(c.expiryDate))">{{ certStatusLabel(certExpiryStatus(c.expiryDate)) }}</span>
          </div>
        </div>
        <div v-else class="text-ink-soft text-xs">暂无证书。点右上「编辑」在弹窗里上传/录入证书与有效期。</div>
      </div>

      <!-- 出勤记录 -->
      <div class="panel p-2.5">
        <h3 class="m-0 mb-2 text-sm font-700">出勤记录（按月手记）</h3>
        <div class="grid grid-cols-4 lt-md:grid-cols-2 gap-1.5 mb-2">
          <input class="field-input" v-model="draftA.month" type="month" placeholder="月份" />
          <input class="field-input" v-model="draftA.daysWorked" placeholder="出勤天数" inputmode="decimal" />
          <input class="field-input" v-model="draftA.note" placeholder="备注" />
          <button class="btn-primary px-2 py-1" @click="addAttendance">＋ 添加</button>
        </div>
        <vxe-table v-if="attendance.length" :data="attendance" height="180" size="mini" border show-overflow>
          <vxe-column field="month" title="月份" width="120" fixed="left" />
          <vxe-column field="daysWorked" title="出勤天数" width="100" align="right" />
          <vxe-column field="note" title="备注" min-width="140" />
          <vxe-column title="" width="60" fixed="right">
            <template #default="{ row }">
              <button class="btn-danger px-1.5 py-0.5 text-xs" @click="delAttendance(row.id)">删</button>
            </template>
          </vxe-column>
        </vxe-table>
        <div v-else class="text-ink-soft text-xs">暂无出勤记录。</div>
      </div>

      <!-- 工资支付记录 -->
      <div class="panel p-2.5">
        <h3 class="m-0 mb-2 text-sm font-700">工资支付记录</h3>
        <div class="grid grid-cols-5 lt-md:grid-cols-2 gap-1.5 mb-2">
          <input class="field-input" v-model="draftP.date" type="date" placeholder="日期" />
          <input class="field-input" v-model="draftP.amount" placeholder="金额" inputmode="decimal" />
          <input class="field-input" v-model="draftP.method" placeholder="方式(转账/现金)" />
          <input class="field-input" v-model="draftP.note" placeholder="备注" />
          <button class="btn-primary px-2 py-1" @click="addPayment">＋ 添加</button>
        </div>
        <vxe-table v-if="payments.length" :data="payments" height="180" size="mini" border show-overflow>
          <vxe-column field="date" title="日期" width="110" fixed="left" />
          <vxe-column field="amount" title="金额" width="100" align="right" />
          <vxe-column field="method" title="方式" width="110" />
          <vxe-column field="note" title="备注" min-width="120" />
          <vxe-column title="" width="60" fixed="right">
            <template #default="{ row }">
              <button class="btn-danger px-1.5 py-0.5 text-xs" @click="delPayment(row.id)">删</button>
            </template>
          </vxe-column>
        </vxe-table>
        <div v-else class="text-ink-soft text-xs">暂无支付记录。</div>
      </div>
    </template>

    <WorkerFormDialog v-if="worker" v-model:open="formOpen" :worker="worker" @submit="onFormSubmit" />
  </div>
</template>
