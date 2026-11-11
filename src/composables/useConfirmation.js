import { onBeforeUnmount, ref } from 'vue';

export function useConfirmation() {
  const confirmation = ref(null);
  let resolveAnswer = null;
  function answerConfirmation(accepted) {
    const resolve = resolveAnswer;
    resolveAnswer = null;
    confirmation.value = null;
    resolve?.(accepted);
  }
  function requestConfirmation(title, message, confirmLabel = '确认删除') {
    if (resolveAnswer) return Promise.resolve(false);
    confirmation.value = { title, message, confirmLabel };
    return new Promise(resolve => { resolveAnswer = resolve; });
  }
  onBeforeUnmount(() => answerConfirmation(false));
  return { confirmation, requestConfirmation, answerConfirmation };
}
