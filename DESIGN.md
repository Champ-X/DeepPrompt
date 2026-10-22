# Design System: DeepPrompt Editorial Archive

> This is the canonical token layer for the archive UI. New interface code uses the
> semantic tokens documented here; the generated prompt corpus remains verbatim.

## 0. Meta

```yaml
version: 1.5.0
last_updated: 2026-10-22
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

DeepPrompt is a source-grounded field guide for people studying how coding
Agents behave. Its opening should explain the reading experience immediately:
a rule in its original language, an interpretation, and a link to inspect the
complete context. The page's job is to move a reader from discovery to evidence.

The signature is the **source-to-annotation preview**: a white source sheet with
a navy identity header and a pale green interpretation inset. The quote, annotation,
version and pinned upstream line link are generated from the same reviewed
registry as the reader. This is real archive content, never a fictional demo.
The compact identity index underneath offers direct Agent navigation without
competing with this reading example.

Palette: mist `#f3f5f8`, cool paper `#e7edf2`, ink `#23344c`, slate `#536479`,
navy `#263e59`, and mint `#b4e3d7`. Use Songti/Noto Serif SC for the Chinese
headline and editorial titles, IBM Plex Sans Condensed with system sans-serif
for catalogue controls and descriptions, and JetBrains Mono for verbatim text
and provenance. Keep Agent identity colors separate from annotation semantics.

Layout: a two-column introduction and evidence preview; a quiet snapshot strip;
a searchable three-column Agent catalogue; then the existing comparative essays.
On mobile, use the same linear reading order with a one-column catalogue.
The aesthetic emphasis lives in the evidence preview; avoid decorative grids,
rainbow chrome, large statistic tiles, and repeated arbitrary card numbering.

**Principles:**

1. Verbatim source text remains the dominant layer.
2. A visible annotation always has a visible source anchor.
3. Global synthesis belongs to the catalogue; Agent-specific inference belongs to the reader.
4. Motion communicates navigation or provenance and respects reduced-motion.
5. WCAG 2.2 AA, keyboard access and 44px targets are release gates.

## 2. Color System

```tokens color.primitive
- paper       (color): #f3f5f8
- paper-deep  (color): #e7edf2
- ink         (color): #23344c
- ink-soft    (color): #536479
- rule        (color): #b3bfcc
- rule-soft   (color): #dce3ea
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
| Claude Tag | `#a65c19` | Grokbot | `#4c5b73` |
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
- cjk     (fontFamily): ["Noto Serif SC", "Songti SC", "serif"]
- ui      (fontFamily): ["IBM Plex Sans Condensed", "-apple-system", "PingFang SC", "sans-serif"]
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
| Archive card | paper surface | identity border | double focus ring | pressed state | opacity 50% |
| Identity link | compact label and Agent color dot | tinted identity surface | visible outline | opens Agent evidence page | — |
| Catalogue search | labeled native search input | quiet boundary | visible focus-within ring | filters name, vendor and editorial lead | — |
| Catalogue sort | native select | quiet boundary | visible outline | default, name or annotation count | — |
| Spectrum node | 48px icon target on a curved rail | tinted surface + one name tooltip | visible outline + tooltip | single identity ring; dashed preview ring | hidden from tab order |
| Agent name menu | native select showing current name | quiet tint | visible outline | direct choice from every Agent | — |
| Top-bar tool | cell in one continuous paper rail | quiet surface tint | double focus ring | inset 2% | opacity 50% |
| Filter chip | outlined | ink border | double focus ring | category state | opacity 50% |
| Annotation | quiet | source preview | double focus ring | one connector visible | collapsed with source |

Buttons and standalone controls have a minimum 44×44 CSS pixel target and visible
`focus-visible`; inline evidence links remain part of the reading text. Disabled
items are non-interactive and exposed as disabled.

## 9. Layout & Responsive

- Catalogue: two-column introduction and source-bound preview, snapshot statistics and compact 16-Agent direct links, followed by a searchable three-column Agent grid, then the global seven-axis and five-theme synthesis. At 1023px the grid uses two columns; at 560px one. The hero becomes linear at 760px.
- Reader ≥ 1280px: a floating 128×352px Agent dial sits 12px from the left edge. Five 48px icon targets follow a restrained arc; a single colored ring marks the selected Agent, while the count and native name menu remain visible. Left annotation cards, a 600–720px source column and right annotation cards occupy separate grid tracks, with a 20–32px source safety gutter.
- Reader < 1280px: the switcher becomes a 232×108px bottom dock with three 48px targets and the current-name menu. Annotations become inline cards. The reader reserves enough bottom padding to keep the final content above the dock.
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

## 12. Editorial Evidence

- `data/annotations.json` owns annotation content and exact source positions; quoted text is generated from the reviewed anchor.
- `data/editorial.json` owns leads, profiles, axes and themes. Every synthesis includes links to supporting annotations at a pinned upstream commit and line range.
- Reader mastheads identify the annotated default capture and link to the complete local source, pinned upstream file and other captured variants.
- Source text and editorial inference remain separate. A captured title-generation request must not be presented as the full coding-agent system prompt.
- Mobile notes use unique IDs, retain the same evidence links and act as the active description and click target for their highlights.

## 13. Catalogue interactions and evidence preview

- Search matches Agent names, vendors and reviewed leads; multiple words narrow
  results. It does not fetch the full prompt corpus or claim to be full-text search.
- The result count is an ARIA live status. An empty state explains how to recover
  and offers a clear-search button. Escape clears; Command/Control K focuses search.
- Sorting moves real card nodes, preserving logical keyboard order. Switching
  back to default restores the original curated order.
- The homepage preview must rebuild from `codex-25`; a missing or retired note
  requires an explicit editorial replacement. Browser QA verifies its exact quote
  and pinned line URL against the registry.
- Native details, select and search controls retain their browser behavior.
  Long text wraps, focus remains visible, motion respects reduced-motion.

## 14. Agent dial input contract

- Non-zoom wheel events on the icon rail are always consumed. Normalize line/page
  deltas, accumulate small trackpad increments to 40px, and switch once per gesture.
  A 180ms idle period starts a new gesture; inertial tails cannot scroll the page
  or cause repeated switches. Control-wheel/pinch zoom stays with the browser.
- Only the icon rail is draggable; the native name menu keeps its own behavior.
  Capture the primary pointer after 8px of movement on the intended axis. Preview
  at 52px per Agent on desktop and 64px on mobile, with a small continuous offset.
- Preview uses a dashed ring and a release hint, while the committed Agent,
  aria-current, URL, live status and select value remain unchanged. Release commits
  one navigation; Escape, pointer cancellation, lost capture, blur or resize cancels.
  Suppress only the drag's synthetic click, not the next deliberate click.
- Keep focused content out of aria-hidden subtrees during a drag, then restore focus
  to the actual selection. Arrow keys switch; Home/End jump to first/last; ignore
  held-key repeat. Do not intercept the native select's own keyboard controls.
- Mobile horizontal gestures coexist with vertical page panning and pinch zoom.
  All node hit targets stay 48px; scale logos if needed, never shrink the buttons.


## 15. October 2026 reading polish

Art direction: a research desk, where the original rule and its interpretation
have separate surfaces. Keep mist `#f3f5f8`, white `#ffffff`, navy `#263e59`,
ink `#23344c`, slate `#536479`, and green `#326655` as the core palette.
Serif Chinese titles establish editorial character; sans-serif UI text stays
legible at 12–16px equivalents; monospace is reserved for quoted code and versions.
The hero aligns explanatory text beside an upright evidence sheet. The catalogue
uses consistent identity, version, metadata and lead positions for comparison.

The design review removed the tilted source card, accented headline fragment,
multicolor filter rail and tiny uppercase section labels. Meaningful differences
come from source evidence and Agent identities. Hover feedback changes borders,
without moving reading targets. Details use native disclosure behavior.

Reader interpretation is a collapsed `details.mh-philosophy` by default. Its title
remains visible; the expanded area labels the analysis as editorial inference and
shows the exact supporting source links. This shortens the path to verbatim text.
Category colors remain local to highlights and filters. Body and annotation
text sizes are increased, with no changes to the existing Agent dial input contract.

Complete single-line JSON tool definitions use native `details.rawblob` disclosures.
The summary names the tool and reports the source character count; the code block
preserves the complete original string and its annotation anchors. Names and source
text are HTML-escaped. Folding changes presentation only, including Grokbot's twelve
compact tool definitions before their expanded descriptions.

The font-sensitive `archive-header` container query controls the compact header.
At container widths up to 47.5rem, the search button expands a second header row. The native
search input supports Escape to clear and close, Command/Control K to open, and
focus restoration when closing, navigating or crossing the responsive breakpoint.
Header height is measured from content; its minimum height is independent of the
measured CSS variable, so repeated open/close cannot accumulate height.

OS text scaling is progressively enabled with `meta[name="text-scale"]`; unsupported
browsers retain normal zoom. Use relative text units and test 320px reflow and
200% text scaling. Grokbot is labeled as model self-report in both catalogue and
reader, including the unverified completeness/accuracy boundary; its date is a
capture label rather than a package publication date.
