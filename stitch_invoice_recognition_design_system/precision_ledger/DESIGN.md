---
name: Precision Ledger
colors:
  surface: '#f8f9fb'
  surface-dim: '#d9dadc'
  surface-bright: '#f8f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f6'
  surface-container: '#edeef0'
  surface-container-high: '#e7e8ea'
  surface-container-highest: '#e1e2e4'
  on-surface: '#191c1e'
  on-surface-variant: '#434655'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f3'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#4059aa'
  on-secondary: '#ffffff'
  secondary-container: '#8fa7fe'
  on-secondary-container: '#1d3989'
  tertiary: '#006329'
  on-tertiary: '#ffffff'
  tertiary-container: '#007f36'
  on-tertiary-container: '#c7ffca'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#dce1ff'
  secondary-fixed-dim: '#b6c4ff'
  on-secondary-fixed: '#00164e'
  on-secondary-fixed-variant: '#264191'
  tertiary-fixed: '#7ffc97'
  tertiary-fixed-dim: '#62df7d'
  on-tertiary-fixed: '#002109'
  on-tertiary-fixed-variant: '#005320'
  background: '#f8f9fb'
  on-background: '#191c1e'
  surface-variant: '#e1e2e4'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '700'
    lineHeight: 24px
  title-sm:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '700'
    lineHeight: 24px
  body-base:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-caps:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 20px
  caption:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  gutter: 16px
  container-max: 1480px
---

## Brand & Style

The visual identity of the design system is centered on **utilitarian precision** and **analytical clarity**. It is designed for high-stakes business environments where data accuracy is paramount. The aesthetic follows a **Corporate Modern** approach with hints of **Minimalism**, prioritizing a "software-as-a-tool" feel rather than a "software-as-a-service" marketing look.

The UI should evoke a sense of reliability and meticulous order. This is achieved through a cool-toned canvas, highly structured card-based layouts, and a disciplined application of whitespace that separates distinct data clusters without sacrificing information density. The interaction model is snappy and predictable, mimicking the responsiveness of a high-end native desktop utility.

## Colors

This design system utilizes a **disciplined professional palette** grounded in blue and cool grays.

- **Primary & Secondary**: Royal Blue (#2563eb) serves as the primary interactive signal, while Midnight Blue (#1e3a8a) is reserved for high-level navigation and deep-contrast headers.
- **Canvas & Surface**: The application background uses a very light cool gray (#f5f6f8) to provide depth against pure white (#ffffff) content panels.
- **Functional States**: Success, Error, and Warning states use a three-tier system: a high-contrast ink for text, a medium-contrast border, and a low-saturation pastel background for the container (e.g., Warning uses #92400e text on #fffbeb background).
- **Interactive States**: Use `#e8f0fe` (Brand Soft) for hover backgrounds on list items or ghost buttons to maintain a cohesive blue-tinted experience.

## Typography

Typography is optimized for **legibility of mixed alphanumeric strings** (invoice numbers, dates, and currency).

- **Primary Sans**: Hanken Grotesk provides a sharp, contemporary feel that remains professional and highly readable at small sizes.
- **Data Monospace**: JetBrains Mono is used specifically for numeric values, invoice IDs, and tax codes within tables to ensure character alignment and prevent "number jumping" during rapid scanning.
- **Hierarchy**: Use `label-caps` for field headers to create a clear distinction between the "descriptor" and the "value."
- **Scale**: Keep body text primarily at 14px for standard desktop use, dropping to 13px for dense data tables.

## Layout & Spacing

The layout utilizes a **Fixed-Width Fluid Hybrid** approach. While the main container is capped at 1480px to prevent excessive line lengths on ultrawide monitors, internal grids use fluid percentages.

- **Grid Model**: A standard 12-column grid is used for the main dashboard. Complex OCR views often use a 40/60 split (40% Image Preview / 60% Data Entry).
- **Rhythm**: A strict 4px baseline grid ensures vertical consistency. Gaps between related form fields should be 12px (`md`), while gaps between distinct card sections should be 16px (`lg`).
- **Fixed Chrome & Internal Scroll**: Global headers, workflow headers, and action toolbars must stay visually fixed while the content below them scrolls. Long lists, preview panes, and data tables should own their own `overflow-y-auto` regions with stable heights so scrolling a list does not shift the surrounding shell or reflow the whole page.
- **Responsive**: On viewports smaller than 1024px, the side-by-side columns must stack vertically to prioritize the data entry form, allowing the image preview to remain as a sticky header or collapsible drawer.

## Elevation & Depth

This design system uses **Tonal Layering** combined with high-precision **Low-Contrast Outlines** to define hierarchy.

- **Surface Levels**:
  - **Level 0 (Canvas)**: Background (#f5f6f8).
  - **Level 1 (Card)**: Pure white surface (#ffffff) with a 1px border (#e3e6ea).
  - **Level 2 (Overlay/Modal)**: White surface with a 1px border and a more pronounced diffused shadow: `0 10px 15px -3px rgba(0, 0, 0, 0.1)`.
- **Interactive Depth**: Avoid heavy shadows on buttons. Instead, use flat color shifts. When a card is "Active" or "Selected," use a 2px blue ring (`#2563eb`) with a soft 4px outer glow of the same color at 15% opacity.

## Shapes

The shape language is **structured and balanced**. 

- **Cards/Panels**: Use `rounded-lg` (16px / 1rem) for major containers to soften the technical nature of the app.
- **Buttons & Inputs**: Use the base `rounded` (8px / 0.5rem) to maintain a crisp, professional appearance. 
- **Status Tags/Chips**: Use the `pill-shaped` (999px) setting for status indicators (e.g., "Paid", "Pending") to differentiate them from interactive buttons or input fields.

## Components

### Buttons
- **Primary**: Solid blue background (#2563eb), white text, bold weight.
- **Secondary/Outline**: White background, strong gray border (#c9ced6), primary text (#1f2329).
- **Ghost**: No background/border, secondary text (#5b6470), appearing only on hover with a light blue tint.

### Input Fields
- Labels must be placed *above* the input in `label-caps` style using secondary text color.
- Inputs feature a solid white background and a 1px border (#c9ced6). Focus state changes border to Primary Blue with a 2px soft outer glow.

### Data Tables
- Use a "Compact Row" approach: 40px height per row.
- Header row uses a light gray tint (#f9fafb) and 1px bottom border.
- Highlight current row on hover with `#f5f6f8`.

### File Upload Zone
- A large container with a dashed border (2px, #c9ced6).
- Drag-over state: Border changes to Primary Blue, background changes to Brand Soft (#e8f0fe).

### Status Chips
- Contextual colors only. Success uses green, Error uses red, and Warning uses amber. All chips must use a light background and a darker border/text for accessibility.
