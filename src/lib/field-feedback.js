export function flashAcceptedField(container) {
  if (!container || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const input = container.matches('input, textarea, select') ? container : container.querySelector('input, textarea, select');
  if (input) input.animate([{ backgroundColor: '#d9f4dc' }, { backgroundColor: getComputedStyle(input).backgroundColor }], { duration: 600, easing: 'ease-out' });
}
