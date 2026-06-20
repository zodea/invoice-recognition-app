import { defineConfig, presetIcons, presetWind3 } from "unocss";

// Precision Ledger 设计系统令牌（ADR-0005 / issue #22）。核心色已对齐，这里补齐状态色阶、
// 圆角、阴影，并把 btn/input/chip/panel 等 shortcut 统一成设计系统观感（全应用经 shortcut 生效）。
// 交互态对齐 DESIGN「snappy native desktop」：hover=flat color shift；active=轻微 scale 压下反馈；
// transition 用全属性组（含 transform/opacity），旧的 transition-colors 不过渡缩放/透明，手感发生改变。
// 字体不在本期改（沿用现中文系统字体）。
export default defineConfig({
  presets: [presetWind3(), presetIcons({ scale: 1.2, extraProperties: { display: "inline-block", "vertical-align": "middle" } })],
  theme: {
    colors: {
      bg: "#f5f6f8", // Level 0 画布
      panel: "#ffffff", // Level 1 卡片
      line: { DEFAULT: "#e3e6ea", strong: "#c9ced6" },
      // 表面层次（DESIGN surface-container 系）：收敛此前散落的硬编码浅灰
      "surface-2": "#f8fafc", // 表头 / 卡片次级底
      "surface-3": "#f3f4f6", // 占位 / 行 hover 底
      "surface-sink": "#eef1f5", // 预览区凹底
      ink: { DEFAULT: "#1f2329", soft: "#5b6470", faint: "#8b93a1" },
      brand: { DEFAULT: "#2563eb", soft: "#e8f0fe", deep: "#1e3a8a" },
      // 功能状态三档：DEFAULT 实色 / soft 浅底 / ink 深字（DESIGN「三层系统」）
      ok: { DEFAULT: "#16a34a", soft: "#dcfce7", ink: "#166534" },
      warn: { DEFAULT: "#d97706", soft: "#fffbeb", ink: "#92400e" },
      danger: { DEFAULT: "#dc2626", soft: "#fef2f2", ink: "#991b1b" },
    },
    borderRadius: { card: "12px", btn: "8px" }, // 卡片 12 / 按钮·输入 8（DESIGN：容器更圆、控件更挺）
    boxShadow: {
      card: "0 1px 3px rgba(16,24,40,0.08), 0 1px 2px rgba(16,24,40,0.06)",
      pop: "0 10px 15px -3px rgba(16,24,40,0.12), 0 4px 6px -4px rgba(16,24,40,0.1)", // DESIGN Level 2 弹层：柔和扩散
    },
  },
  shortcuts: {
    panel: "bg-panel border border-line rounded-card shadow-card",
    // 按钮：默认=描边白底(secondary)；primary=实心蓝；ghost=无底悬停蓝；danger=红字描边。
    // 交互态（对齐 DESIGN code.html）：hover=flat color shift（secondary 浅灰底 / primary 微降透明 /
    // ghost 浅蓝底）；active=scale 压下反馈；transition 全属性让变色+缩放+focus 环都平滑。
    // 变体用 ! 覆盖 base 的 hover 底色/描边（避免被 secondary 的浅灰底盖掉）。
    btn: "inline-flex items-center justify-center gap-1.5 border border-line-strong bg-white rounded-btn px-3 py-2 font-600 text-sm text-ink transition active:scale-[.97] disabled:(opacity-50 cursor-default) hover:(bg-[#eceef1] border-ink-soft) focus-visible:(outline-none ring-2 ring-brand/30)",
    "btn-primary": "btn border-brand bg-brand text-white hover:(opacity-90 bg-brand! border-brand!)",
    "btn-ghost": "btn border-transparent bg-transparent text-ink-soft hover:(bg-brand-soft! text-brand border-transparent!)",
    "btn-danger": "btn text-danger hover:(bg-danger/5! border-danger!)",
    // 字段：label 在上（label-caps 风格——小号加粗、字距；中文不受 uppercase 影响）+ 输入焦点蓝环
    "field-label": "min-w-0 flex flex-col gap-1 text-ink-soft text-xs font-600 tracking-wide",
    "field-input": "w-full min-w-0 border border-line-strong rounded-btn px-2.5 py-1.5 bg-white text-ink font-inherit transition focus:(outline-none border-brand ring-2 ring-brand/25)",
    // 状态 chip：pill 浅底深字（非交互，无 hover/active）
    chip: "inline-flex items-center rounded-full px-2.25 py-0.75 text-xs font-600",
    "chip-ok": "chip bg-ok-soft text-ok-ink",
    "chip-warn": "chip bg-warn-soft text-warn-ink",
    "chip-danger": "chip bg-danger-soft text-danger-ink",
    "chip-brand": "chip bg-brand-soft text-brand",
    // 区块小标题（数据簇分隔）
    "section-title": "text-sm font-700 text-ink",
  },
  safelist: [],
});
