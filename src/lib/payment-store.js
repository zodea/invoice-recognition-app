import { appStorage } from './app-storage.js';
import { computed, reactive } from 'vue';

const STORAGE_KEY = 'paymentRecords.v1';
let rows = [];
try { rows = JSON.parse(appStorage.getItem(STORAGE_KEY) || '[]'); } catch { /* 首次运行或存储不可用 */ }
export const paymentStore = reactive({ rows });

export function countPaymentExpense(record) {
  return !record.duplicateOf && !record.linkedLedgerKey && !record.supplementOnly && record.recordType !== '合计' &&
    (record.evidenceConfirmed || record.recordType === '现金无凭证' || record.cashWithoutEvidence);
}

export function needsPaymentEvidence(record) {
  return record.recordType !== '现金无凭证' && !record.cashWithoutEvidence && !record.supplementOnly && !record.evidenceConfirmed && !record.duplicateOf && !record.linkedLedgerKey;
}

export const pendingPaymentCount = computed(() => paymentStore.rows.filter(needsPaymentEvidence).length);

export function savePayments(rows) {
  appStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  paymentStore.rows = rows;
}
