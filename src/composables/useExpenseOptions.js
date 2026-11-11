import { computed } from 'vue';
import { directory } from '../lib/expense-directory';
import { invoiceStore } from '../invoiceStore';
import { paymentStore } from '../lib/payment-store';
import { expenseOptions } from '../lib/expense-options';
// 档案和台账都是共享状态；多个编辑表单共用一份候选缓存。
const choices = computed(() => expenseOptions(directory, [...Object.values(invoiceStore.ledger), ...paymentStore.rows]));

export function useExpenseOptions() {
  return choices;
}
