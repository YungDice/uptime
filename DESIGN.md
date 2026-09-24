---
name: Uptime
description: The iPhone stopwatch that was never stopped, running as an app.
colors:
  page: "#0c0c0e"
  void: "#000000"
  raise: "#1c1c1e"
  raise-2: "#2c2c2e"
  hairline: "#38383a"
  label: "#ffffff"
  label-2: "#8e8e93"
  label-3: "#7c7c82"
  run: "#ff9f0a"
  bank: "#30d158"
  lapse: "#ff453a"
# Eleven steps, and the name of each one is the Tailwind utility that applies
# it: `text-display`, `text-title`, and so on, defined in `src/styles.css`.
# That is deliberate. An earlier version of this file named roles the code did
# not have - a 76px display that nothing rendered - so every call site invented
# its own pixel value instead, and the same role ended up at three sizes on
# three screens. A step here that you cannot type as a class is a step that
# will be ignored.
typography:
  display:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 300
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "tnum 1, ss01 1"
  title:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  numeral:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "normal"
    fontFeature: "tnum 1, ss01 1"
  body:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "normal"
  callout:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  footnote:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "normal"
  caption:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "normal"
  micro:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "normal"
  overline:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.14em"
  tab:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.01em"
rounded:
  pill: "9999px"
  sheet: "22px"
  panel: "16px"
  field: "12px"
  focus: "6px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lead: "20px"
  section: "28px"
  row-min: "52px"
  tab-clearance: "112px"
components:
  capsule-run:
    backgroundColor: "color-mix(in srgb, #ff9f0a 18%, transparent)"
    textColor: "{colors.run}"
    rounded: "{rounded.pill}"
    padding: "14px 24px"
    typography: "{typography.body}"
  capsule-bank:
    backgroundColor: "color-mix(in srgb, #30d158 18%, transparent)"
    textColor: "{colors.bank}"
    rounded: "{rounded.pill}"
    padding: "14px 24px"
    typography: "{typography.body}"
  capsule-lapse:
    backgroundColor: "color-mix(in srgb, #ff453a 18%, transparent)"
    textColor: "{colors.lapse}"
    rounded: "{rounded.pill}"
    padding: "14px 24px"
    typography: "{typography.body}"
  capsule-neutral:
    backgroundColor: "color-mix(in srgb, #ffffff 18%, transparent)"
    textColor: "{colors.label}"
    rounded: "{rounded.pill}"
    padding: "14px 24px"
    typography: "{typography.body}"
  capsule-disabled:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.label-3}"
    rounded: "{rounded.pill}"
    padding: "14px 24px"
  chip-inline:
    backgroundColor: "color-mix(in srgb, #30d158 18%, transparent)"
    textColor: "{colors.bank}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
    typography: "{typography.caption}"
  chip-filter:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.label-2}"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
    typography: "{typography.caption}"
  chip-filter-selected:
    backgroundColor: "color-mix(in srgb, #ff9f0a 18%, transparent)"
    textColor: "{colors.run}"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
  input-field:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.label}"
    rounded: "{rounded.field}"
    padding: "10px 16px"
    typography: "{typography.body}"
  row:
    backgroundColor: "{colors.page}"
    textColor: "{colors.label}"
    rounded: "0px"
    padding: "10px 20px"
    height: "52px"
    typography: "{typography.body}"
  row-pressed:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.label}"
  sheet:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.label}"
    rounded: "{rounded.sheet}"
    padding: "20px 20px 32px"
  tab-bar:
    backgroundColor: "{colors.page}"
    textColor: "{colors.label-2}"
    rounded: "0px"
    padding: "8px 0"
    typography: "{typography.tab}"
  tab-active:
    textColor: "{colors.run}"
---

# Design System: Uptime

## Overview

**Creative North Star: "The Clock That Was Never Stopped"**

Uptime wears the iPhone Clock app's grammar because the product *is* that screen: a stopwatch somebody started and never stopped. The Timer's ring with its 60-tick track carries the check-in window; the Stopwatch's face carries the run, days on top and `hours:minutes:seconds:milliseconds` beneath. Nothing quotes the Clock app decoratively — the whole surface is built out of its materials: a near-black ground, light-weight white numerals with tabular figures, hairline separators, full-bleed ruled rows, and pill controls filled with a low-alpha tint of their own colour.

Density is high and even. Every screen is one bounded column of rows on the page colour, inset 20px from the leading edge, with no screen title - each screen opens on its own content, because a title that repeated the lit tab label said nothing - and a solid tab bar below. There is no card stack, no flame, no gradient hero, no dashboard widgetry. The refused reference is explicit: the card-stack streak dashboard and its flame.

Colour is a law rather than a palette. Orange owns the live run, green owns time being given, red owns a lapse, grey owns everything else — and nothing else in the app gets an accent. Depth is done entirely with tonal layering (#0c0c0e → #1c1c1e → #2c2c2e) and hairlines; there is not a single box-shadow in the build.

**Key Characteristics:**
- Near-black ground (#0c0c0e) - lifted just off true black so a sheet reads as the next step up rather than as a different material
- Light-weight (300) tabular numerals for every measurement
- 0.5px hairlines at 2dppx, 1px below
- Pill controls with an 18% tinted fill and a full-strength label
- Four colour roles, each owning exactly one system
- Zero shadows, zero persistent cards
- Exactly two authored motion moments

## Colors

A near-monochrome dark field where three saturated signal colours each own one system and are never used for anything else.

### Primary
- **Clock Orange** (`{colors.run}`): The live run. Ring stroke while the streak is running, the active tab, the primary capsule, inline "Create one" links, follow/save actions, the focus ring, the selection tint, and the browser `accent-color` / `caret-color`.

### Secondary
- **Giving Green** (`{colors.bank}`): Time being given - which is your own running clock, since what you send comes straight off it. The give panel's figure, Send controls, the handoff sweep gradient, and good-news notices. The token keeps its old name, `bank`.

### Tertiary
- **Lapse Red** (`{colors.lapse}`): A streak that ran out. The Stop control, broken-friend rows, validation messages, error notices, and the ring when a run has lapsed.

### Neutral
- **Page** (`{colors.page}`): The ground for every screen and the tab bar fill.
- **Void** (`{colors.void}`): True black, and no longer a background. Two things still want the absence of a surface rather than the colour of one: the gap punched between an avatar and its ring, and the dimming scrim behind a sheet.
- **Raise** (`{colors.raise}`): The first tonal step up. Sheets, input fields, chip rests, segmented-control troughs, and the pressed state of a row.
- **Raise 2** (`{colors.raise-2}`): The second step. The ring's unfilled track, the sheet's grab handle, unselected preset buttons.
- **Hairline** (`{colors.hairline}`): Every separator and border, plus the 60 tick marks around the ring.
- **Label** (`{colors.label}`): Primary text and the running figure.
- **Label 2** (`{colors.label-2}`): Secondary text, the milliseconds, inactive tabs, placeholders, captions.
- **Label 3** (`{colors.label-3}`): Idle and stopped state text, and leaderboard rank numerals. Chosen at 5.06:1 on black rather than the iOS tertiary grey, which measures 3.06:1 and cannot carry real text.

### Named Rules
**The One System One Colour Rule.** Orange means the run, green means time being given, red means a lapse, grey means everything else. A colour never appears for emphasis, decoration, category, or variety. If a new element has no system, it is grey.

**The Tint-18 Rule.** Coloured controls are never solid. They are a fill of `color-mix(in srgb, <colour> 18%, transparent)` with the full-strength colour as the label, so a control reads as its system at a glance. A selected state may go one notch up (20–22%); nothing goes solid.

**The Single Accent Per Scale Rule.** When a figure and its ring appear together, only one of them carries the accent. The ring takes the system colour and the numeral stays white; tinting both puts two accents at the same scale and flattens the hierarchy between "what this is" and "how long is left".

## Typography

**Display Font:** Inter Variable (with `ui-sans-serif`, `system-ui`, `sans-serif`)
**Body Font:** Inter Variable (same stack)
**Label/Mono Font:** none — Inter's tabular figures carry all numeric work.

**Character:** One family worked hard across a wide weight range: hairline-thin at display size, plain at body size, semibold only for headers and control labels. The personality comes from the figures rather than the letterforms — every number in this app is a measurement, so every number is tabular.

### Hierarchy

Eleven steps. Each is a Tailwind utility of the same name (`text-display`,
`text-overline`, ...) and each carries its own line-height, tracking and weight,
so a call site names the role and gets the whole decision. No screen writes a
pixel size; `text-[20px]` in a diff is a bug.

- **`text-display`** (300, 44px, lh 1, -0.03em, tabular): The ticking readout, wherever it appears — the amount in the send sheet, a profile's counter, the sendable figure on the give panel. One size, because they are one thing seen in three places.
- **`text-title`** (600, 22px, -0.01em): Every heading below that — a sheet's title, a person's name on their profile or account.
- **`text-numeral`** (700, 22px, tabular): The figure struck into a podium block. Same size as a title and deliberately its own token: it is bold and untracked, and would follow a title's negative tracking into nonsense.
- **`text-body`** (400, 17px): Row labels, row values, capsule labels, input text.
- **`text-callout`** (400, 15px, lh 1.45): Explanatory paragraphs, empty states, friend sub-figures.
- **`text-footnote`** (400, 13px): Sub-lines under rows, hints, notes, the window label, medal captions.
- **`text-caption`** (400, 12px): Handles, board chips, relationship pills.
- **`text-micro`** (400, 11px): The smallest readable step, for text inside a tight grid — a medal's detail line, the "rising" indicator.
- **`text-overline`** (600, 11px, 0.14em, uppercase): Every all-caps label — RECORD, RUNNING, TO GIVE, RANK, ACHIEVEMENTS. One spelling, because three of them used to disagree.
- **`text-tab`** (500, 10px, 0.01em): The tab bar only, and the only 10px in the app.

### Named Rules
**The Tabular Figures Rule.** Every figure in the app is a measurement, so every figure carries `font-variant-numeric: tabular-nums` plus `"tnum" 1, "ss01" 1` (the `.tnum` class). This is the detail that stops a stopwatch face jittering as it runs; a number rendered in proportional figures is a bug.

**The Light-at-Size Rule.** Weight falls as size rises. `text-display` is 300, body and below are 400, and 600/700 are reserved for headings, all-caps labels, and the podium numeral. A bold numeral at display size belongs to a fitness dashboard, not to a clock.

## Layout

One bounded column, centred, `max-width: 448px`, with left and right hairline borders above the `lg` breakpoint so the phone layout does not stretch across a desktop window (this ships as a Tauri window as well as a web app). Inside it: a single scroll container and a tab bar pinned to the bottom edge.

Rhythm is a 4px grid; the recurring steps are 4 / 8 / 12 / 20 / 28px. Rows have a 52px minimum height with 10px vertical padding, sections are separated by 28px, and the scrolling main reserves 112px of bottom padding for the tab bar. Safe-area insets are added to the column's top edge (outside the scroller, so content scrolls beneath a still edge rather than under the status bar), the tab bar, and the sheet's bottom padding.

Scroll behaviour: a tab change resets scroll to the top. There is no title to collapse.

### Named Rules
**The One Inset Definition Rule.** The leading margin is 20px and it is defined in exactly one place per element type: rows supply their own `padding-left: 20px`, and a section's leading rule is a separate 1px element with `margin-left: 20px`. Never put the inset on a section container that already holds padded rows — that path produced three different margins across four screens.

**The Full-Bleed Trailing Edge Rule.** Rows are inset on the leading edge only. The hairline under a row runs to the trailing edge of the column, the way a lap list does.

## Elevation & Depth

There are no shadows in this system — not ambient, not structural, not on hover. Depth is entirely tonal: `#0c0c0e` ground, `#1c1c1e` for a raised surface, `#2c2c2e` for the step above that, and `#38383a` hairlines to divide. There is no blurred material in the build (the collapsing title bar that had one is gone); the tab bar deliberately does **not** use a material, because translucency over a ground this dark is invisible by definition and at 94% it let content bleed through under the labels.

### Named Rules
**The No Card Rule.** Persistent content is never boxed. Lists are full-bleed rows divided by hairlines and a screen's content sits directly on the void. Rounded tonal surfaces exist only for things that arrive and leave — the send sheet, the reminder offer, a notice banner — and even those are flat fills with no shadow and no border beyond the sheet's top hairline.

**The Hairline Rule.** A separator is `1px solid #38383a`, narrowed to `0.5px` at `min-resolution: 2dppx`. There is no other divider weight and no other divider colour.

## Shapes

Two silhouettes carry the whole system: the circle and the ruled line.

The circle is the hero — a 280px SVG face with a 6px ring, a 60-mark tick track outside it (every fifth tick at 2px and 0.9 opacity, the rest at 1px and 0.55), and an unfilled `raise-2` track beneath the accent arc. The arc is `stroke-linecap: round`, rotated -90°, and drains by `stroke-dashoffset`.

Everything interactive is a pill (`border-radius: 9999px`): capsules, chips, inline actions, the segmented control, the tab badge dot. Everything holding typed input or transient text is a soft rectangle: 12px for fields and notices, 16px for the reminder panel, 22px on the top corners only for the rising sheet. Rows have no radius at all. The focus ring is a 2px orange outline at 2px offset with a 6px radius.

## Components

### Buttons
- **Shape:** Fully pill (9999px).
- **Primary (Capsule):** An 18% tint of its tone with the full-strength tone as the label, 14px/24px padding, 17px medium. Tones are `run`, `bank`, `lapse`, and `neutral` (white). `wide` makes it flex-1 so a pair splits the column with a 12px gap.
- **Hover / Focus / Active:** Transitions are limited to `background-color` and `opacity`. The check-in capsule alone plays `.animate-confirm` — a 420ms `cubic-bezier(0.16,1,0.3,1)` scale to 0.965 and back. Focus is the global 2px `run` outline at 2px offset; it is never removed.
- **Disabled:** `raise` fill, `label-3` text, 35% opacity.
- **Inline action (small):** The same tint recipe at 13px medium with 6px/12px padding, used trailing inside a row (Send, Revive, Save name).

### Chips
- **Style:** Pill, 13px medium, 6px/14px padding.
- **State:** Unselected is a `raise` fill with `label-2` text; selected is an 18% `run` tint with `run` text. Board filters scroll horizontally in a single row with 6px gaps.

### Cards / Containers
There are no cards. Transient surfaces only:
- **Sheet:** Rises from the bottom edge (`.animate-rise`, 260ms), `raise` fill, 22px top corners, hairline top border, 20px padding, 32px plus safe-area at the bottom, 448px max width, over a 62% void scrim, with a 36×4px `raise-2` grab handle.
- **Notice banner:** 12px radius, a 15% tint of `bank` or `lapse` with matching text, 16px/12px padding, inset 20px from both edges.
- **Offer panel:** 16px radius, flat `raise` fill, 16px padding.
- **Shadow Strategy:** none, on any of them. See Elevation & Depth.

### Inputs / Fields
- **Style:** `raise` fill, 12px radius, no border, 16px/10px padding, 17px text, `label-2` placeholder.
- **Label / hint:** 13px `label-2` above and below the field.
- **Focus:** The field's own outline is suppressed; the global orange focus-visible ring carries it.
- **Disabled:** Expressed as 35% opacity on the paired action button rather than on the field.

### Navigation
- **Tab bar:** Pinned to the bottom of the column, a solid `void` fill (never translucent), a single hairline top border, four equal flex items. Each is an authored 26px SVG icon at 1.6 stroke weight with a 10px medium label 4px beneath. Active is `run`, inactive is `label-2`, and `aria-current="page"` marks the active tab. A 6px `run` dot pins to the icon's top-right while the session is still anonymous.
- **Header:** None. The tab bar already names the screen; the only thing at the top is the `Local` badge, right-aligned, when the app is running without a backend.

### Stopwatch Face (signature)
The Timer's ring around the Stopwatch's face, and both halves are load-bearing. The ring is the check-in window draining — the only way this streak can die — animated on `stroke-dashoffset` over 600ms `cubic-bezier(0.16,1,0.3,1)`. The face is the run: the day count at 76px light, with its "days" unit hung outside the flow (absolutely positioned at `left: 100%`, plus 8px) so the numeral, the clock, and the ring all share one vertical axis; beneath it `HH:MM:SS:mmm` - hours, minutes and seconds in white, milliseconds in `label-2` - with each group captioned `HR` / `MIN` / `SEC` / `MS` in 11px `label-3` so the readout says which part is which.

The milliseconds tick on `requestAnimationFrame` and fall back to whole seconds under `prefers-reduced-motion`. Only the face subscribes to the frame clock; everything else on screen ticks once a second. The readout is `aria-hidden` and the enclosing section carries an `aria-label` instead, because a field changing every frame must never be announced.

## The Mark

A stopwatch whose hand has gone past the edge of its own face. Files live in
`brand/`; every platform icon is generated from them with `npm run icons`.

**Construction** (on a 1024 grid, centre 512, 548):
- **The ring** is the check-in window: an outer circle of r 318 and an inner
  circle of r 226, so 92 thick at full weight. It is open at half past one.
  The leading end, towards twelve, is cut parallel to the hand. The trailing
  end tapers to a point over 120 degrees, on a single arc that leaves the outer
  circle at the tip and lands tangent on the inner one. It reads as moving
  clockwise, and there are no curves in it except circles.
- **The crown** is a pill on a short stem at twelve - the one detail that makes
  it a stopwatch rather than a gauge.
- **The hand** is the run: a needle through a round hub with the pivot cut out,
  pointing at half past one and passing through the opening, 122 units past
  the ring. Nothing stops it at the edge.

**Colour.** White ring and crown, Clock Orange hand, on the `page` tile. That
is the colour law applied to the icon: orange is the live run, and the only
thing in the mark that moves is the hand. `mark-mono.svg` is the one-colour
version, and takes `currentColor`.

**What it is not.** A flame. The first reference for the mark was a flame
wrapped round a clock face, and PRODUCT.md already rules the flame out for the
reason that matters: it is the default of every streak app this one is
compared against. The ring's taper keeps the motion that reference had
without the shape it came in.

**Files.**
- `app-icon.svg` - the mark on its 228-radius tile. Source for desktop and iOS.
- `mark.svg` - transparent, for dark grounds. The pivot is a real hole.
- `mark-mono.svg` - one colour.
- `android-*.svg` - adaptive-icon layers. The foreground is scaled to 0.72 so
  the needle's tip stays inside the launcher's 66dp safe circle.

## Do's and Don'ts

### Do:
- **Do** put new screens on `page` (#0c0c0e) with full-bleed hairline-ruled rows, inset 20px on the leading edge only.
- **Do** define that 20px inset once per element: `padding-left` on the row, `margin-left` on the section's leading rule.
- **Do** mark every figure with the `.tnum` class.
- **Do** tint coloured controls at 18% and keep the label at full strength.
- **Do** build depth with the tonal ladder (`void` → `raise` → `raise-2`) plus hairlines.
- **Do** author new icons as SVG paths at 1.6 stroke weight on a 24 viewBox, matching the existing four.
- **Do** disable any new animation under `prefers-reduced-motion`, and hide fast-changing numerals from the accessibility tree while labelling their container.
- **Do** keep text on `label-3` (#7c7c82) or lighter; the iOS tertiary grey is not contrast-safe here.

### Don't:
- **Don't** add a box-shadow anywhere, for any state.
- **Don't** put persistent content in a card; rounded tonal surfaces are for sheets, notices, and transient offers only.
- **Don't** introduce a fifth colour, or reuse `run` / `bank` / `lapse` for anything other than the live run, time being given, and a lapse.
- **Don't** make the tab bar translucent — over a ground this dark a material reads as a content leak, not as depth.
- **Don't** tint both a ring and the figure inside it.
- **Don't** add a third authored animation. Motion is `confirm` (the check-in press) and `handoff` (the sweep along the recipient's row); `rise` is entry-only for sheets and notices.
- **Don't** set a figure at display size in a weight above 300, or render any number in proportional figures.
- **Don't** reach for a flame, a gradient hero, a progress-dashboard widget, or a card stack — that is the exact reference this world refuses.
- **Don't** redraw the mark at a call site, recolour the ring, or put the hand in any colour but `run`. Use a file from `brand/`.
