# Design System: DeepPrompt Editorial Archive

> This is the closed token layer for the archive UI. New interface code uses the
> semantic tokens documented here; the generated prompt corpus remains verbatim.

## 0. Meta

```yaml
version: 1.1.0
last_updated: 2026-08-17
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

DeepPrompt is a model observatory and evidence archive, not a dashboard. Cold
paper, ink-blue structure, condensed technical display type and mono metadata
make the source material feel inspectable and traceable. Interaction should
reveal relationships without competing with the prompt: the homepage is the
specimen catalogue, the reader is the evidence desk, and annotation motion is
an explanatory instrument rather than decoration.

The homepage's signature element is the **identity spectrum ledger**: fourteen
real navigation nodes use the same Agent colors as the reader rail. It is a
compact index rather than a decorative rainbow; semantic annotation colors
remain a separate system.

**Principles:**

1. Verbatim source text remains the dominant layer.
2. A visible annotation always has a visible source anchor.
3. Global synthesis belongs to the catalogue; Agent-specific inference belongs to the reader.
4. Motion communicates navigation or provenance and respects reduced-motion.
5. WCAG 2.2 AA, keyboard access and 44px targets are release gates.

## 2. Color System

```tokens color.primitive
- paper       (color): #eef0ec
- paper-deep  (color): #e2e6e1
- ink         (color): #172027
- ink-soft    (color): #526065
- rule        (color): #aeb8b3
- rule-soft   (color): #d4dad5
- white       (color): #ffffff
- goal        (color): oklch(0.48 0.09 176)
- engineering (color): oklch(0.53 0.09 224)
- persona     (color): oklch(0.62 0.12 78)
- safety      (color): oklch(0.52 0.16 28)
- tool        (color): oklch(0.49 0.12 291)
- success     (color): #2f766d
- danger      (color): #b64a3a
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

### 2.2 Agent identity layer

The paper and ink remain neutral; `--agent-color` changes with the active reader
and is used for the page glow, masthead identity, focus ring and spectrum rail.
It never replaces the five semantic annotation colors.

| Agent | Identity color | Agent | Identity color |
|---|---:|---|---:|
| Codex | `#2f766d` | Claude Code | `#c15f3c` |
| Antigravity | `#5367d9` | Grok | `#36414b` |
| Kimi Code | `#6553b8` | MiniMax | `#2f78bc` |
| MiMo | `#d34f3a` | OpenClaw | `#c53b32` |
| Hermes | `#c58a2a` | Kimi CLI | `#8a4f9e` |
| opencode | `#4d7c4d` | Oh My Pi | `#9a4d79` |
| Pi | `#8b6f32` | DeepSeek Harness | `#356aa0` |

### 2.2 Forced-colors

```css
@media (forced-colors: active) {
  button, a { border-color: ButtonText; }
  :focus-visible { outline: 3px solid Highlight; outline-offset: 2px; }
}
```

## 3. Typography

```tokens font.family
- display (fontFamily): ["IBM Plex Sans Condensed", "Noto Serif SC", "sans-serif"]
- body    (fontFamily): ["Source Serif 4", "Noto Serif SC", "serif"]
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
- quiet (shadow): "0 0.875rem 2.125rem -1.75rem rgb(23 32 39 / 0.34)"
- float (shadow): "0 1.25rem 3rem -1.75rem rgb(23 32 39 / 0.42)"
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
| Identity ledger node | numbered Agent color mark | tinted identity surface | double focus ring | opens Agent evidence page | — |
| Spectrum node | identity-colored icon on a curved rail | raised paper node + one name tooltip | double focus ring + tooltip | enlarged identity ring; drag preview | hidden from tab order |
| Top-bar tool | cell in one continuous paper rail | quiet surface tint | double focus ring | inset 2% | opacity 50% |
| Filter chip | outlined | ink border | double focus ring | category state | opacity 50% |
| Annotation | quiet | source preview | double focus ring | one connector visible | collapsed with source |

Every actionable surface has a minimum 44×44 CSS pixel target and visible
`focus-visible`; disabled items are non-interactive and exposed as disabled.

## 9. Layout & Responsive

- Catalogue: left-aligned observatory masthead plus the 14-node identity spectrum ledger, followed by a uniform responsive Agent specimen grid, then the global seven-axis and five-theme synthesis.
- Reader ≥ 1280px: a 112px identity spectrum rail, left annotation cards, 600–720px source column and right annotation cards occupy separate grid tracks. The annotation tracks explicitly clear legacy offsets and keep a 20–32px safety gutter from the source column. A short press remains a native button click; pointer capture begins only after the drag threshold. The rail supports wheel rotation, directional keys and vertical drag-to-preview with release-to-commit.
- Reader < 1280px: the switcher becomes an icon-only bottom dock and annotations become distinct inline cards. Horizontal drag, wheel and directional-key behavior match the desktop rail.
- Test widths: 320, 375, 768, 1024, 1440 and 1920; no horizontal scrolling.
- Use `dvh` for viewport-relative reader controls and safe-area insets for mobile docks.

## 10. Agent Prompt Guide

When extending this archive, preserve the homepage/reader boundary, keep global
analysis singular, and never expose a margin annotation whose source is inside a
closed disclosure. Connect only the currently focused pair; passive annotations
use matching category color and shared identity, not a web of persistent lines.
New controls require default, hover, focus-visible, active and disabled states.

## 11. Runtime Architecture

- `index.html` is a lightweight catalogue shell and must not contain `.agentview` sections.
- `data/agents/{id}.html` owns one complete Agent reader section.
- `scripts/archive-ui.js` fetches only the selected fragment, keeps parsed nodes in an in-memory cache, and exposes an actionable HTTP-service error state.
- The homepage remains useful before any fragment request; direct `file://` reading is not a supported full-product mode.
