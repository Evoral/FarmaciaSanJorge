---
version: alpha
name: farmacia-san-jorge-clinico
description: The "1a Clínico" identity of the Farmacia San Jorge management app. A cool white canvas with green-tinted zinc neutrals, near-black ink and the San Jorge logo's green as the only brand color. IBM Plex Sans carries the UI, IBM Plex Mono with tabular figures carries lots, quantities, amounts and hashes. Compact 4–6px radii, hairline borders and almost no shadow; light-only. Source of truth is app/globals.css (the @theme block and the component layer).

colors:
  brand: "#03b386"
  primary: "#037a5c"
  primary-hover: "#025f48"
  ink: "#0f1a17"
  surface: "#ffffff"
  canvas: "#f5f7f7"
  neutral-50: "#f5f7f7"
  neutral-100: "#eef1f0"
  neutral-200: "#e2e8e6"
  neutral-300: "#cbd5d2"
  neutral-400: "#97a5a0"
  neutral-500: "#65746f"
  neutral-600: "#4a5552"
  neutral-700: "#36403d"
  neutral-800: "#232c29"
  neutral-900: "#0f1a17"
  neutral-950: "#0a110f"
  on-primary: "#ffffff"
  success-bg: "#e7f5f0"
  success-border: "#9fd9c3"
  success-text: "#044c3a"
  warn: "#b45309"
  warn-bg: "#fef6e7"
  warn-border: "#edc78a"
  warn-text: "#62300a"
  danger: "#b42318"
  danger-hover: "#8f1c13"
  danger-bg: "#fdecea"
  danger-border: "#f6b8b1"
  danger-text: "#741911"
  focus-ring: "#03b386"

typography:
  h1:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: -0.01em
  panel-title:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: -0.01em
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-sm:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0
  caption:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: 0
  table-head:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0.05em
  badge:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0
  button:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0
  button-sm:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0
  metric:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: -0.02em
  metric-sm:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: 0
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0

rounded:
  sm: 4px
  md: 4px
  lg: 6px
  float: 10px
  pill: 999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px

components:
  page:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: 24px 16px 48px
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 14px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.neutral-900}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 14px
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "#8f1c13"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 14px
  button-danger-solid:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 14px
  button-sm:
    typography: "{typography.button-sm}"
    rounded: "{rounded.md}"
    padding: 4px 8px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  input-focused:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  input-disabled:
    backgroundColor: "{colors.neutral-50}"
    textColor: "{colors.neutral-500}"
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.panel-title}"
    rounded: "{rounded.lg}"
    padding: 20px
  panel-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger-text}"
    rounded: "{rounded.lg}"
  data-table:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
  data-table-head:
    backgroundColor: "{colors.neutral-50}"
    textColor: "{colors.neutral-500}"
    typography: "{typography.table-head}"
  badge:
    backgroundColor: "{colors.neutral-100}"
    textColor: "{colors.neutral-700}"
    typography: "{typography.badge}"
    rounded: "{rounded.sm}"
    padding: 2px 7px
  badge-success:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.primary}"
    typography: "{typography.badge}"
    rounded: "{rounded.sm}"
    padding: 2px 7px
  badge-danger:
    backgroundColor: "{colors.danger-bg}"
    textColor: "{colors.danger}"
    typography: "{typography.badge}"
    rounded: "{rounded.sm}"
    padding: 2px 7px
  alert-warn:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn-text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: 12px 14px
  alert-danger:
    backgroundColor: "{colors.danger-bg}"
    textColor: "{colors.danger-text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: 12px 14px
  alert-success:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success-text}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: 12px 14px
  tab:
    backgroundColor: transparent
    textColor: "{colors.neutral-500}"
    typography: "{typography.body}"
    padding: 10px 12px
  tab-active:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.body}"
  status-tab-active:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    padding: 14px 16px
  popover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.float}"
    padding: 6px
---

## Overview

The app is a pharmacy compounding tool used all day by staff at a counter and a bench, so the identity ("1a Clínico") is built for **density, legibility and calm**: cool white surfaces, near-black ink, hairline borders, small radii and one brand color. The brand color is the green of the San Jorge logo (`{colors.brand}` — #03b386); everything else is a green-tinted zinc neutral ramp.

Two typefaces, with a strict split: **IBM Plex Sans** for UI copy and **IBM Plex Mono with tabular figures** for anything that must align or be read exactly — lots, quantities, amounts, hashes, headline metrics. The app is **light-only**: `color-scheme: light`, and the `dark:` variant only applies under an explicit `.dark` class, never from the OS setting.

**Key Characteristics:**
- Cool white page (`{colors.surface}`) with a barely-green canvas (`{colors.canvas}` — #f5f7f7) for table heads, hovers and disabled fields.
- One brand color. `{colors.primary}` (#037a5c) is the interactive green (buttons, links in tables, active tab underline, focus border); `{colors.brand}` (#03b386) is the logo green, used for the focus ring, soft glows and the discrete progress segments.
- Green-tinted zinc neutrals (#f5f7f7 → #0f1a17) — never pure gray, never a blue-ish slate.
- Compact radii: 4px for controls, tables and badges; 6px for cards, panels and alerts.
- Depth from hairline borders (`{colors.neutral-200}`), not shadows. Shadows are reserved for floating surfaces.
- Plex Mono + `font-variant-numeric: tabular-nums` on tables, inputs and every number that has to line up.
- Warm amber for "warn" and a restrained red for "danger" — the only other hues, always paired with their pale background tint.

## Colors

All tokens live in the `@theme` block of `app/globals.css`. The default Tailwind palettes the app already uses (zinc, amber, red, emerald, green) are **remapped** to the identity's values, so a utility such as `text-zinc-500` or `bg-emerald-50` already resolves to the identity — no screen picks its own hex.

### Brand & Interactive
- **Brand** (`{colors.brand}` — #03b386): The logo's green. Focus ring (`outline: 2px solid`, 2px offset), focus glow (`0 0 0 3px rgb(3 179 134 / 0.18)`), "done" progress segments, soft background glows.
- **Primary** (`{colors.primary}` — #037a5c): Primary buttons, plain links inside tables, checkbox/radio accent, active tab underline, focused input border. This is `emerald-700`.
- **Primary Hover** (`{colors.primary-hover}` — #025f48): Hover/press darker variant (`emerald-800`).

### Neutrals (zinc, green-tinted)
- **Canvas / 50** (`{colors.neutral-50}` — #f5f7f7): Table heads, hovered rows, disabled inputs, info alerts.
- **100** (#eef1f0): Row dividers, panel-header rules, neutral badge and count-pill fill.
- **200** (#e2e8e6): The standard 1px border of cards, panels, tables, tabs and popovers.
- **300** (#cbd5d2): Input and secondary-button borders.
- **400** (#97a5a0): Placeholders, select chevron, hover border of inputs.
- **500** (#65746f): Secondary text, table-head labels, breadcrumbs, inactive tabs.
- **600** (#4a5552): Meta lines, inactive status tabs.
- **700** (#36403d): Labels, neutral badge text.
- **800 / 900 / 950** (#232c29 / #0f1a17 / #0a110f): Strong text. `{colors.ink}` (#0f1a17) is body and headline text.

### State colors
- **Warn** (`{colors.warn}` — #b45309, `amber-600`): Amber ramp #fef6e7 → #62300a. Alerts use 50 fill, 300 border, 900 text.
- **Danger** (`{colors.danger}` — #b42318, `red-600`): Red ramp #fdecea → #5e1710. Solid destructive buttons use `{colors.danger}` with hover `red-700`; outlined ones use `red-300` border and `red-700` text; alerts use 50 fill, 200 border, 800 text.
- **Success**: the brand greens. Alerts use `emerald-50` fill, `emerald-200` border, `emerald-900` text; badges use `emerald-50` fill and `{colors.primary}` text.
- Status badges, the status meter and the legend swatches share one `--tone` per estado (emerald-500 / amber-400 / red-400 / zinc-300) so a state reads identically everywhere.

## Typography

### Font Family
**IBM Plex Sans** (400 / 500 / 600) for all UI copy; **IBM Plex Mono** (400 / 500, plus 600 for metrics) for numerics. Both are loaded through `next/font/google` in `app/layout.tsx` and exposed as `--font-sans` / `--font-mono`. Fallbacks: `system-ui, sans-serif` and `ui-monospace, monospace`.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.h1}` | 24px | 600 | 32px | -0.01em | Page title (h1–h3 share the -0.01em tracking) |
| `{typography.panel-title}` | 15px | 600 | 1.4 | -0.01em | `.panel-header` h2 |
| `{typography.body}` | 14px | 400 | 1.5 | 0 | Body default, inputs, tabs |
| `{typography.body-sm}` | 13px | 400 | 1.45 | 0 | Table cells, alerts, meta lines, panel subtitles |
| `{typography.caption}` | 12px | 500 | 1.25 | 0 | Breadcrumbs, status-tab labels |
| `{typography.table-head}` | 11px | 500 | 1.4 | 0.05em | Table headers, UPPERCASE, `zinc-500` |
| `{typography.badge}` | 11px | 500 | 16px | 0 | Status pills, count pills (600) |
| `{typography.button}` | 14px | 500 | 20px | 0 | Buttons; `button-sm` is 12px / 16px |
| `{typography.metric}` | 32px | 600 | 1 | -0.02em | Headline metric in the status summary — Plex Mono |
| `{typography.metric-sm}` | 20px | 600 | 1 | 0 | Per-estado counts in status tabs — Plex Mono |

### Principles
Weights stay at 400 for running text, 500 for labels/controls, 600 for titles and metrics; never bold (700). No serif anywhere in the app. Tabular figures are switched on globally for `table`, `input`, `select` and `textarea`, so columns of amounts and quantities align without extra classes. Use Plex Mono (not just tabular figures) when the value is an identifier or must be read digit by digit: lots, hashes, metrics.

## Layout

### Spacing System
- **Base unit:** 4px (Tailwind scale). Common steps: 4 · 8 · 12 · 16 · 24 · 32 · 48.
- **Page container (`.page`):** full width up to `80rem`; padding `24px 16px 48px`, `32px 32px 48px` from 640px.
- **Panel:** header `14px 20px` with a `zinc-100` rule, body `20px`.
- **Page header:** column on mobile, row (`align-items: flex-end`, space-between) from 768px, 24px below.
- **Split screens (`.split-layout`):** main column + sticky 22rem aside from 1024px (summary, totals, submit, record data), 24px gap.

### Chrome
A floating glass sidebar panel (`.glass`: 60% white, 16px blur) sits over a green radial glow (`.app-backdrop`); page content stays white. Every page opens with a `PageHeader` whose first breadcrumb is *Inicio*.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Flat | White surface, 1px `{colors.neutral-200}` border | Cards, panels, tables, tabs, alerts |
| Soft | `--shadow-xs` `0 1px 2px rgb(15 26 23 / 0.05)` | Resting controls |
| Raised | `--shadow-sm` `0 1px 3px rgb(15 26 23 / 0.08), 0 1px 2px rgb(15 26 23 / 0.04)` | Small floating bits |
| Floating | `--shadow-popover` `0 14px 32px -10px rgb(15 26 23 / 0.25), 0 4px 12px -6px rgb(3 122 92 / 0.2)` | Popovers, menus, listboxes, toasts |

Primary and danger-solid buttons carry a very subtle "liquid glass" finish: a top specular gradient plus inset highlight/shade, static paint only (no backdrop-filter on buttons, so tables full of actions stay cheap). Hover swaps `background-color`, never the shorthand, so the gloss survives. `:active` drops the button 1px.

Motion is short and quiet: `--duration-fast` 120ms for color/background, `--duration-base` 200ms, `--ease-out-expo` for popovers (140ms).

## Shapes

| Token | Value | Use |
|---|---|---|
| `{rounded.sm}` | 4px | Badges |
| `{rounded.md}` | 4px | Buttons, inputs, tables, tab tops |
| `{rounded.lg}` | 6px | Cards, panels, alerts, status summary |
| `{rounded.float}` | 10px | Floating surfaces (popovers, menus) |
| `{rounded.pill}` | 999px | Count pills, the status meter bar |

### Brand imagery
Logo assets: `public/logo.png` (icon) and `public/logo-etiqueta.png` (icon + wordmark). These are the generic app assets (login, favicon, navbar fallback). Printed documents and XLSX exports carry only the tenant's own uploaded logo (`docs/specs/logo-farmacia.md` R6, R7), never these files. The brand green is the only brand color; no photography or illustration is part of the system.

## Components

All shared primitives are in the component layer of `app/globals.css` and mirrored by `shared/ui/`. Reuse them; do not restyle per screen.

### Buttons
**`.btn`** — inline-flex, 8px gap, 1px transparent border, radius 4px, padding `8px 14px`, 14px / 500. Disabled: 55% opacity.
- **`.btn-primary`** — `{colors.primary}` fill, white text, glass finish; hover `{colors.primary-hover}`.
- **`.btn-secondary`** — white fill, `zinc-300` border, `zinc-900` text; hover `zinc-50` fill and `zinc-400` border.
- **`.btn-danger`** — white fill, `red-300` border, `red-700` text; hover `red-50`. **`.btn-danger-solid`** — `{colors.danger}` fill, white text; hover `red-700`. Use solid only for the confirming step of an irreversible action.
- **`.btn-sm`** — padding `4px 8px`, 12px text. Ghost variants exist for row actions.

### Inputs & Forms
**`.input`** — white fill, 1px `zinc-300` border, radius 4px, padding `8px 12px`, 14px. Hover: `zinc-400` border. Focus: `{colors.primary}` border plus `0 0 0 3px rgb(3 179 134 / 0.18)`. Disabled: `zinc-50` fill, `zinc-500` text. Invalid (`aria-invalid="true"`): `{colors.danger}` border. Labels are `zinc-700`.
**Select** is a real `<select class="input">` with the identity chevron (`zinc-400`); browsers supporting `appearance: base-select` also get the open list styled as a `.popover` with `.option` rows.
Every paciente / cliente / proveedor / médico filter or picker is an autocomplete (Combobox), not a plain select. Forms keep the user's input on error (see `AGENTS.md`).

### Surfaces
**`.card`** — white, 1px `zinc-200` border, radius 6px. **`.panel`** — same surface with `.panel-header` (title 15px / 600, optional 13px `zinc-500` subtitle, `zinc-100` rule) and `.panel-body` (20px padding). `data-tone="danger"` marks an irreversible-action zone: `red-200` border, tinted header, `red-800` title.

### Tables
**`.table-wrap` + `.data-table`** — horizontally scrollable wrapper (1px `zinc-200` border, radius 4px) around a full-width, 13px table. Head: `zinc-50` fill, bottom `zinc-200` rule, 11px UPPERCASE labels at 0.05em in `zinc-500`. Rows: `zinc-100` divider, hover `rgb(245 247 247 / 0.7)`, last row without divider; selected rows and clickable rows are marked with `data-selected` / `.is-clickable`. Plain links in cells use `{colors.primary}`.

### Badges & State
**`.badge`** — inline-flex, radius 4px, padding `2px 7px`, 11px / 500. Colors come from the estado's tone (neutral `zinc-100/700`, success `emerald-50` / `{colors.primary}`, warn `amber-50/800`, danger `red-50` / `{colors.danger}`). A badge never carries a color the status meter does not.
**Alerts** (`.alert-danger | -warn | -info | -success`) — 1px border, radius 6px, padding `12px 14px`, 13px, optional 16px leading icon.

### Navigation
**`.tab-nav` / `.tab`** — underline tabs on a `zinc-200` rule: `zinc-500` text, hover `zinc-50` fill; `aria-current="page"` is `{colors.ink}` / 500 with an inset 2px `{colors.primary}` underline. `.tab-count` is a pill (`zinc-100`, 11px / 600) that turns `emerald-50` / `{colors.primary}` when active.
**`.status-summary` + `.status-tab`** — a headline metric (Plex Mono 32px) beside per-estado tabs that double as the estado filter, with a 6px segmented `.meter`. The active tab gets a `rgb(231 245 240 / 0.65)` fill and the primary underline; terminal estados are quieter (`data-secondary`).
**`.breadcrumbs`** — 12px `zinc-500`, hover `zinc-900` underlined; the first crumb is always *Inicio*.

### Overlays
**`.popover`** — shared by popovers, menus and listboxes: white, 1px `zinc-200` border, radius 10px, padding 6px, `--shadow-popover`. **`.option`** rows highlight with `data-active`, mark the selection with `aria-selected`, and may carry an `.option-description`. **`.toast`** lives in `.toast-region`, with `data-tone="error"` for failures. Surfaces stay opaque on purpose.

## Do's and Don'ts

### Do
- Take colors from the remapped palettes or the named tokens; never inline a hex in a screen.
- Reuse `shared/ui/` primitives and the component-layer classes before writing new CSS.
- Use `{colors.primary}` for the main action of a view and `{colors.brand}` for focus and progress; keep one primary button per region.
- Put numbers in tabular figures, and identifiers/metrics in Plex Mono.
- Pair every state color with its pale background tint (`-50`) and a dark text step (`-800`/`-900`).
- Keep radii at 4px (controls, tables, badges) and 6px (cards, panels, alerts).

### Don't
- Don't reintroduce a serif, a warm cream canvas, or a terracotta/coral accent: that was a previous, discarded direction.
- Don't add a second brand color or cool-blue slate neutrals; neutrals are the green-tinted zinc ramp.
- Don't add a dark theme: the identity is light-only (`.dark` is opt-in and unused).
- Don't use font weight 700, large radii (>6px) on in-page surfaces, or heavy shadows on resting elements.
- Don't use `backdrop-filter` or SVG filters on buttons or table rows.
- Don't gate options by `mode !== "editar"`: edit offers what the alta offers.

## Responsive Behavior

Breakpoints follow Tailwind's defaults; the ones the layer relies on are:

| Width | Key Changes |
|---|---|
| < 640px | `.page` uses 16px side padding; page header stacks; glass mobile top bar replaces the sidebar |
| ≥ 640px | `.page` padding 32px; notice-bar items sit side by side |
| ≥ 768px | `.page-header` becomes a row |
| ≥ 1024px | `.split-layout` shows the sticky 22rem aside |
| ≥ 1280px | `.status-summary` puts the headline metric beside the estado tabs |

Tables scroll horizontally inside `.table-wrap` instead of wrapping; status tabs scroll horizontally with snap. Filters collapse into a mobile sheet (the "Más filtros" popover becomes a plain section inside it).

## Documentos impresos (PDF)

Printed documents (hojas, listados) that are **branded** follow this same identity, translated to pdfkit:

- **Reference implementation:** `modules/entregas/infrastructure/envios-pdf.ts` (the repartidor's "hoja de envíos"). Copy its structure — brand band across the top edge (logo green fading into `{colors.primary}`), logo header on the first sheet, hairline-bordered rounded cards (`COLOR.border`, 4–6pt radii), pill-like status badges, a small continuation header on later sheets.
- **Palette:** the `COLOR` map in that file mirrors the tokens above (`brand` #03b386, `primary` #037a5c, `ink` #0f1a17, zinc 200/100/50 for borders and canvas, emerald-50 / red-50 for badge fills). Add values there from `app/globals.css`; do not invent new ones.
- **Fonts:** pdfkit's built-in **Helvetica / Helvetica-Bold** stands in for IBM Plex Sans; nothing is embedded. There is no Mono substitute — keep numbers right-aligned.
- **Logo:** load it through `shared/pdf/logo.ts` (`logoFarmacia()` and `LOGO_FARMACIA_PROPORCION`), which reads `public/logo.png`; without the file, fall back to the farmacia's name in bold.
- **Exception — libro recetario:** the sheets in `shared/pdf/hojas.ts` stay **neutral on purpose**. They are a legal document; they carry no brand band, color or logo styling and must not be restyled to match the app.

## Iteration Guide

1. Open `app/globals.css` first: the `@theme` block for tokens, the component layer for primitives. This document describes them; if the two disagree, the CSS wins — fix this file.
2. Focus on ONE component at a time. Reference its YAML key (`{component.panel}`, `{component.data-table}`).
3. Variants (`-hover`, `-focused`, `-disabled`, `-active`) live as separate entries in `components:`.
4. Use token references everywhere — never inline hex in a screen.
5. New screen? Start from `.page` → `PageHeader` (Inicio breadcrumbs) → `.panel`/`.card`/`.data-table`. No new surface tone.
6. When in doubt about emphasis: weight 500/600 and `{colors.ink}` before a new color.

## Known Gaps

- Plex Sans / Plex Mono are not embedded in PDFs; Helvetica stands in (see "Documentos impresos").
- Spacing is Tailwind's 4px scale and not a named token set in `globals.css`; the `spacing:` tokens above are documentation of the steps in use.
- Neutral/success/warn badge tones are defined by the `StatusBadge` component and its `--tone` mapping rather than by `.badge` itself; check `shared/ui/` for the exact estado → tone table.
- Dark mode is intentionally unsupported.
