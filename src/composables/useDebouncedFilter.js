import { ref, toValue, watch } from 'vue';

// Clear immediately so reset and navigation see the entire list in the same tick.
export function useDebouncedFilter(source) {
  const applied = ref(toValue(source));
  watch(source, (value, _, onCleanup) => {
    if (value === '' || value == null) { applied.value = value; return; }
    const timer = setTimeout(() => { applied.value = value; }, 180);
    onCleanup(() => clearTimeout(timer));
  }, { flush: 'sync' });
  function flush() { applied.value = toValue(source); }
  return { applied, flush };
}
