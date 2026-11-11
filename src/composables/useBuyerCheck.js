import { computed, toValue } from 'vue';
import { directory } from '../lib/expense-directory.js';
import { createBuyerChecker } from '../lib/invoice-buyer-check.js';

export function useBuyerCheck(entries) {
  const checker = computed(() => createBuyerChecker(directory.buyers));
  const configured = computed(() => directory.buyers.some(name => String(name).trim()));
  const counts = computed(() => {
    const result = { missing: 0, unmatched: 0 };
    for (const entry of toValue(entries)) {
      const status = checker.value(entry);
      if (status in result) result[status]++;
    }
    return { ...result, issues: result.missing + result.unmatched };
  });
  return { checker, configured, counts };
}
