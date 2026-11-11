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
  function requestConfirmation(title, message) {
    if (resolveAnswer) return Promise.resolve(false);
    confirmation.value = { title, message };
    return new Promise(resolve => { resolveAnswer = resolve; });
  }
  onBeforeUnmount(() => answerConfirmation(false));
  return { confirmation, requestConfirmation, answerConfirmation };
}
