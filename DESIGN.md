# Design System: DeepPrompt Editorial Archive

> This is the closed token layer for the archive UI. New interface code uses the
> semantic tokens documented here; the generated prompt corpus remains verbatim.

## 0. Meta

```yaml
version: 1.0.0
last_updated: 2026-08-09
upstream_source: https://phistory.cc
schema: https://github.com/Eldergenix/SUPER-DESIGN/schema/v1
framework:
  css: vanilla
  component_library: none
theme_modes: [light]
dark_mode_strategy: media
i18n:
  rtl_support: false
  logical_properties: true
```

## 1. Brand Narrative & Philosophy

DeepPrompt is an editorial archive, not a dashboard. Warm paper, restrained ink,
serif display type and mono metadata make the source material feel researched and
traceable. Interaction should reveal relationships without competing with the
prompt: the homepage is the catalogue, the reader is the evidence desk, and
annotation motion is an explanatory instrument rather than decoration.

**Principles:**

1. Verbatim source text remains the dominant layer.
2. A visible annotation always has a visible source anchor.
3. Global synthesis belongs to the catalogue; Agent-specific inference belongs to the reader.
4. Motion communicates navigation or provenance and respects reduced-motion.
5. WCAG 2.2 AA, keyboard access and 44px targets are release gates.

## 2. Color System

```tokens color.primitive
- paper       (color): #f7f4ec
- paper-deep  (color): #efe9dc
- ink         (color): #23201b
- ink-soft    (color): #565049
- rule        (color): #c9c0ac
- rule-soft   (color): #e3dccb
- white       (color): #ffffff
- goal        (color): oklch(0.55 0.16 28)
- engineering (color): oklch(0.52 0.10 200)
- persona     (color): oklch(0.56 0.13 65)
- safety      (color): oklch(0.50 0.15 20)
- tool        (color): oklch(0.50 0.15 285)
- success     (color): #4f7b53
- danger      (color): #a43f35
```

### 2.1 Semantic layer

The archive currently has one light editorial theme, so the dark column repeats
the light values to keep automated contrast auditing deterministic.

| Token | Light | Dark | Role | Required contrast |
|---|---|---|---|---|
| `--color-bg` | `{color.primitive.paper}` | `{color.primitive.paper}` | page background | — |
| `--color-bg-subtle` | `{color.primitive.paper-deep}` | `{color.primitive.paper-deep}` | quiet section background | — |
| `--color-surface` | `{color.primitive.white}` | `{color.primitive.white}` | cards and reader surface | — |
| `--color-surface-raised` | `{color.primitive.white}` | `{color.primitive.white}` | floating surface | — |
| `--color-fg` | `{color.primitive.ink}` | `{color.primitive.ink}` | primary text | 4.5:1 |
| `--color-fg-muted` | `{color.primitive.ink-soft}` | `{color.primitive.ink-soft}` | secondary text | 4.5:1 |
| `--color-fg-on-accent` | `{color.primitive.white}` | `{color.primitive.white}` | text on accent | 4.5:1 |
| `--color-border` | `{color.primitive.rule}` | `{color.primitive.rule}` | decorative boundary | 1.5:1 advisory |
| `--color-border-subtle` | `{color.primitive.rule-soft}` | `{color.primitive.rule-soft}` | quiet divider | — |
| `--color-border-strong` | `{color.primitive.ink-soft}` | `{color.primitive.ink-soft}` | sole UI boundary | 3:1 |
| `--color-accent` | `{color.primitive.goal}` | `{color.primitive.goal}` | primary interaction | 3:1 |
| `--color-accent-hover` | `{color.primitive.ink}` | `{color.primitive.ink}` | hover interaction | 4.5:1 |
| `--color-focus-ring` | `{color.primitive.goal}` | `{color.primitive.goal}` | focus indicator | 3:1 |
| `--color-danger` | `{color.primitive.danger}` | `{color.primitive.danger}` | destructive/error state | 4.5:1 |
| `--color-success` | `{color.primitive.success}` | `{color.primitive.success}` | source freshness state | 4.5:1 |

### 2.2 Forced-colors

```css
@media (forced-colors: active) {
  button, a { border-color: ButtonText; }
  :focus-visible { outline: 3px solid Highlight; outline-offset: 2px; }
}
```

## 3. Typography

```tokens font.family
- display (fontFamily): ["Fraunces", "Noto Serif SC", "serif"]
- body    (fontFamily): ["Newsreader", "Noto Serif SC", "serif"]
- cjk     (fontFamily): ["Noto Serif SC", "serif"]
- mono    (fontFamily): ["JetBrains Mono", "ui-monospace", "monospace"]
```

| Token | Value |
|---|---|
| `--text-xs` | `clamp(0.61rem, 0.59rem + 0.1vw, 0.68rem)` |
| `--text-sm` | `clamp(0.72rem, 0.68rem + 0.2vw, 0.84rem)` |
| `--text-base` | `clamp(0.9rem, 0.86rem + 0.2vw, 1rem)` |
| `--text-lg` | `clamp(1rem, 0.94rem + 0.35vw, 1.2rem)` |
| `--text-xl` | `clamp(1.2rem, 1.05rem + 0.75vw, 1.6rem)` |
| `--text-2xl` | `clamp(1.6rem, 1.25rem + 1.8vw, 2.5rem)` |
| `--text-3xl` | `clamp(2.2rem, 1.5rem + 3.5vw, 4rem)` |
| `--text-4xl` | `clamp(3rem, 2rem + 5vw, 5.5rem)` |

## 4. Spacing

```tokens space
- hairline (dimension): 1px
- 1 (dimension): 0.25rem
- 2 (dimension): 0.5rem
- 3 (dimension): 0.75rem
- 4 (dimension): 1rem
- 5 (dimension): 1.25rem
- 6 (dimension): 1.5rem
- 8 (dimension): 2rem
- 10 (dimension): 2.5rem
- 12 (dimension): 3rem
- 16 (dimension): 4rem
```

Components use logical properties (`padding-inline`, `margin-block`) whenever the
direction is structural rather than illustrative.

## 5. Radius & Shape

```tokens radius
- md   (dimension): 0.375rem
- lg   (dimension): 0.625rem
- xl   (dimension): 1rem
- full (dimension): 9999px
```

## 6. Elevation & Shadow

```tokens shadow
- quiet (shadow): "0 0.875rem 2.125rem -1.75rem rgb(40 30 10 / 0.5)"
- float (shadow): "0 1.25rem 3rem -1.75rem rgb(40 30 10 / 0.5)"
- focus (shadow): "0 0 0 2px var(--color-bg), 0 0 0 5px var(--color-focus-ring)"
```

The focus style is always a double-layer `box-shadow` so it remains distinct on
both paper and raised surfaces.

## 7. Motion

```tokens duration
- fast (duration): 150ms
- base (duration): 220ms
- slow (duration): 360ms
```

```tokens ease
- out (cubicBezier): [0.2, 0, 0, 1]
- in  (cubicBezier): [0.4, 0, 1, 1]
```

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

## 8. Component State Matrix

| Component | default | hover | focus-visible | active | disabled |
|---|---|---|---|---|---|
| Archive card | paper surface | raised, accent rule | double focus ring | inset 1% | opacity 50% |
| Arc item | muted icon on a fading orbit | raised paper node + one name tooltip | double focus ring + tooltip | paper surface with accent orbit ring; drag preview | hidden from tab order |
| Top-bar tool | cell in one continuous paper rail | quiet surface tint | double focus ring | inset 2% | opacity 50% |
| Filter chip | outlined | ink border | double focus ring | category state | opacity 50% |
| Annotation | quiet | source preview | double focus ring | one connector visible | collapsed with source |

Every actionable surface has a minimum 44×44 CSS pixel target and visible
`focus-visible`; disabled items are non-interactive and exposed as disabled.

## 9. Layout & Responsive

- Catalogue: centered hero, responsive Agent grid, then the global seven-axis and five-theme synthesis.
- Reader ≥ 1180px: icon-only fading quarter-orbit in the upper-left corner, centered source column, annotation margins. A short press remains a native button click; pointer capture begins only after the drag threshold. The orbit also supports wheel rotation, directional keys, and drag-to-preview with release-to-commit.
- Reader < 1180px: icon-only bottom switcher and inline annotations. Horizontal drag, wheel and directional-key behavior match the desktop orbit.
- Test widths: 320, 375, 768, 1024, 1440 and 1920; no horizontal scrolling.
- Use `dvh` for viewport-relative reader controls and safe-area insets for mobile docks.

## 10. Agent Prompt Guide

When extending this archive, preserve the homepage/reader boundary, keep global
analysis singular, and never expose a margin annotation whose source is inside a
closed disclosure. Connect only the currently focused pair; passive annotations
use matching category color and shared identity, not a web of persistent lines.
New controls require default, hover, focus-visible, active and disabled states.
