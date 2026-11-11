import { computed } from 'vue';
import { directory } from '../lib/expense-directory';
import { invoiceStore } from '../invoiceStore';
import { paymentStore } from '../lib/payment-store';
import { expenseOptions } from '../lib/expense-options';
export function useExpenseOptions(){return computed(()=>expenseOptions(directory,[...Object.values(invoiceStore.ledger),...paymentStore.rows]));}
