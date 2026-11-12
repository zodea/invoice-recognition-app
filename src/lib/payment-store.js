import { computed, reactive } from 'vue';

const STORAGE_KEY = 'paymentRecords.v1';
let rows = [];
try { rows = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { /* 首次运行或存储不可用 */ }
export const paymentStore = reactive({ rows });

export function needsPaymentEvidence(record) {
  return !record.supplementOnly && !record.evidenceConfirmed && !record.duplicateOf && !record.linkedLedgerKey;
}

export const pendingPaymentCount = computed(() => paymentStore.rows.filter(needsPaymentEvidence).length);

export function savePayments(rows) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  paymentStore.rows = rows;
}
