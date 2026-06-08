import { defineConfig, presetWind3 } from "unocss";

// 设计令牌沿用原 styles.css 的 CSS 变量值，保证重构后视觉一致。
export default defineConfig({
  presets: [presetWind3()],
  theme: {
    colors: {
      bg: "#f5f6f8",
      panel: "#ffffff",
      line: { DEFAULT: "#e3e6ea", strong: "#c9ced6" },
      ink: { DEFAULT: "#1f2329", soft: "#5b6470" },
      brand: { DEFAULT: "#2563eb", soft: "#e8f0fe", deep: "#1e3a8a" },
      danger: "#dc2626",
      ok: "#16a34a",
      warn: "#d97706",
    },
    borderRadius: { card: "10px" },
    boxShadow: {
      card: "0 1px 3px rgba(16,24,40,0.08), 0 1px 2px rgba(16,24,40,0.06)",
      pop: "0 12px 40px rgba(0,0,0,0.5)",
    },
  },
  shortcuts: {
    panel: "bg-panel border border-line rounded-card shadow-card",
    btn: "inline-flex items-center justify-center gap-1.5 border border-line-strong bg-white rounded-md px-3 py-2 font-700 text-sm transition-colors disabled:opacity-50 disabled:cursor-default",
    "btn-primary": "btn border-brand bg-brand text-white hover:bg-brand-deep",
    "btn-ghost": "btn border-transparent text-ink-soft hover:bg-line/40",
    "btn-danger": "btn text-danger",
    "field-label": "min-w-0 flex flex-col gap-0.75 text-ink-soft text-xs",
    "field-input": "w-full min-w-0 border border-line-strong rounded-md px-1.75 py-1.25 bg-white text-ink font-inherit",
    chip: "inline-flex items-center rounded-full px-2.25 py-1 text-xs font-700",
  },
  safelist: [],
});
