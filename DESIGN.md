---
name: Uptime
description: The iPhone stopwatch that was never stopped, running as an app.
colors:
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
typography:
  display:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "76px"
    fontWeight: 300
    lineHeight: 1
    letterSpacing: "-0.045em"
    fontFeature: "tnum 1, ss01 1"
  headline:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  readout:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 300
    lineHeight: 1.1
    letterSpacing: "normal"
    fontFeature: "tnum 1, ss01 1"
  title:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "normal"
  body:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "normal"
  body-secondary:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "normal"
  caption:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "normal"
  section-header:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.06em"
  tab-label:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.2
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
    backgroundColor: "{colors.void}"
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
    backgroundColor: "{colors.void}"
    textColor: "{colors.label-2}"
    rounded: "0px"
    padding: "8px 0"
    typography: "{typography.tab-label}"
  tab-active:
    textColor: "{colors.run}"
---

# Design System: Uptime

## Overview

**Creative North Star: "The Clock That Was Never Stopped"**

Uptime wears the iPhone Clock app's grammar because the product *is* that screen: a stopwatch somebody started and never stopped. The Timer's ring with its 60-tick track carries the check-in window; the Stopwatch's face carries the run, down to hundredths. Nothing quotes the Clock app decoratively — the whole surface is built out of its materials: a true-black ground, light-weight white numerals with tabular figures, hairline separators, full-bleed ruled rows, and pill controls filled with a low-alpha tint of their own colour.

Density is high and even. Every screen is one bounded column of rows on black, inset 20px from the leading edge, with a collapsing large title above and a solid tab bar below. There is no card stack, no flame, no gradient hero, no dashboard widgetry. The refused reference is explicit: the card-stack streak dashboard and its flame.

Colour is a law rather than a palette. Orange owns the live run, green owns banked time, red owns a lapse, grey owns everything else — and nothing else in the app gets an accent. Depth is done entirely with tonal layering (#000000 → #1c1c1e → #2c2c2e) and hairlines; there is not a single box-shadow in the build.

**Key Characteristics:**
- True-black ground (#000000), never a dark grey
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
- **Banked Green** (`{colors.bank}`): Time that has been earned and can be given away. Balance rows, Send controls, the handoff sweep gradient, and good-news notices.

### Tertiary
- **Lapse Red** (`{colors.lapse}`): A streak that ran out. The Stop control, broken-friend rows, validation messages, error notices, and the ring when a run has lapsed.

### Neutral
- **Void** (`{colors.void}`): The ground for every screen, the tab bar fill, and the dimming scrim behind a sheet (at 62%).
- **Raise** (`{colors.raise}`): The first tonal step up. Sheets, input fields, chip rests, segmented-control troughs, and the pressed state of a row.
- **Raise 2** (`{colors.raise-2}`): The second step. The ring's unfilled track, the sheet's grab handle, unselected preset buttons.
- **Hairline** (`{colors.hairline}`): Every separator and border, plus the 60 tick marks around the ring.
- **Label** (`{colors.label}`): Primary text and the running figure.
- **Label 2** (`{colors.label-2}`): Secondary text, the hundredths, inactive tabs, placeholders, captions.
- **Label 3** (`{colors.label-3}`): Idle and stopped state text, and leaderboard rank numerals. Chosen at 5.06:1 on black rather than the iOS tertiary grey, which measures 3.06:1 and cannot carry real text.

### Named Rules
**The One System One Colour Rule.** Orange means the run, green means banked time, red means a lapse, grey means everything else. A colour never appears for emphasis, decoration, category, or variety. If a new element has no system, it is grey.

**The Tint-18 Rule.** Coloured controls are never solid. They are a fill of `color-mix(in srgb, <colour> 18%, transparent)` with the full-strength colour as the label, so a control reads as its system at a glance. A selected state may go one notch up (20–22%); nothing goes solid.

**The Single Accent Per Scale Rule.** When a figure and its ring appear together, only one of them carries the accent. The ring takes the system colour and the numeral stays white; tinting both puts two accents at the same scale and flattens the hierarchy between "what this is" and "how long is left".

## Typography

**Display Font:** Inter Variable (with `ui-sans-serif`, `system-ui`, `sans-serif`)
**Body Font:** Inter Variable (same stack)
**Label/Mono Font:** none — Inter's tabular figures carry all numeric work.

**Character:** One family worked hard across a wide weight range: hairline-thin at display size, plain at body size, semibold only for headers and control labels. The personality comes from the figures rather than the letterforms — every number in this app is a measurement, so every number is tabular.

### Hierarchy
- **Display** (300, 76px, line-height 1, -0.045em, tabular): The day count at the centre of the ring. Drops to 68px in the idle "0" state. Nothing else uses this size.
- **Headline** (700, 34px, -0.02em): The large screen title in the scroll header; fades to zero opacity as it collapses.
- **Readout** (300, 24px, tabular): The running `HH:MM:SS` beneath the day count; the `.ss` hundredths sit at the same size in Label 2.
- **Title** (600, 20px): Sheet headings.
- **Body** (400, 17px): Row labels, row values, capsule labels, input text, and the collapsed compact-bar title (at 600).
- **Body Secondary** (400, 15px): Explanatory paragraphs, empty states, friend sub-figures, segmented-control labels.
- **Caption** (400, 13px): Sub-lines under rows, hints, notes, small pill buttons, the window label.
- **Section Header** (600, 13px, 0.06em, uppercase): The grouped-list header sitting above a section's leading rule.
- **Tab Label** (500, 10px, 0.01em): The tab bar only.

### Named Rules
**The Tabular Figures Rule.** Every figure in the app is a measurement, so every figure carries `font-variant-numeric: tabular-nums` plus `"tnum" 1, "ss01" 1` (the `.tnum` class). This is the detail that stops a stopwatch face jittering as it runs; a number rendered in proportional figures is a bug.

**The Light-at-Size Rule.** Weight falls as size rises. Display and readout are 300, body is 400, and 600/700 are reserved for headers, control labels, and the large title. A bold numeral at display size belongs to a fitness dashboard, not to a clock.

## Layout

One bounded column, centred, `max-width: 448px`, with left and right hairline borders above the `lg` breakpoint so the phone layout does not stretch across a desktop window (this ships as a Tauri window as well as a web app). Inside it: an absolutely-positioned compact bar at the top, a single scroll container, and a tab bar pinned to the bottom edge.

Rhythm is a 4px grid; the recurring steps are 4 / 8 / 12 / 20 / 28px. Rows have a 52px minimum height with 10px vertical padding, sections are separated by 28px, and the scrolling main reserves 112px of bottom padding for the tab bar. Safe-area insets are added to the top header, the compact bar, the tab bar, and the sheet's bottom padding.

Scroll behaviour: the 34px title fades out and the compact bar fades in over 200ms, with hysteresis (collapse past 44px, restore under 24px) so a title resting on the threshold cannot flicker. A tab change resets scroll and restores the large title.

### Named Rules
**The One Inset Definition Rule.** The leading margin is 20px and it is defined in exactly one place per element type: rows supply their own `padding-left: 20px`, and a section's leading rule is a separate 1px element with `margin-left: 20px`. Never put the inset on a section container that already holds padded rows — that path produced three different margins across four screens.

**The Full-Bleed Trailing Edge Rule.** Rows are inset on the leading edge only. The hairline under a row runs to the trailing edge of the column, the way a lap list does.

## Elevation & Depth

There are no shadows in this system — not ambient, not structural, not on hover. Depth is entirely tonal: `#000000` ground, `#1c1c1e` for a raised surface, `#2c2c2e` for the step above that, and `#38383a` hairlines to divide. The only blurred material in the build is the collapsed title bar, which sits on 92% void with `saturate(180%) blur(24px)`; the tab bar deliberately does **not** use a material, because translucency over true black is invisible by definition and at 94% it let content bleed through under the labels.

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
- **Header:** A 34px bold title inset 20px, fading into a centred 17px semibold compact bar on scroll.

### Stopwatch Face (signature)
The Timer's ring around the Stopwatch's face, and both halves are load-bearing. The ring is the check-in window draining — the only way this streak can die — animated on `stroke-dashoffset` over 600ms `cubic-bezier(0.16,1,0.3,1)`. The face is the run: the day count at 76px light, with its "days" unit hung outside the flow (absolutely positioned at `left: 100%`, plus 8px) so the numeral, the clock, and the ring all share one vertical axis; beneath it the `HH:MM:SS` in white with the `.hundredths` in `label-2`.

The hundredths tick on `requestAnimationFrame` and fall back to whole seconds under `prefers-reduced-motion`. The readout is `aria-hidden` and the enclosing section carries an `aria-label` instead, because a field changing a hundred times a second must never be announced.

## Do's and Don'ts

### Do:
- **Do** put new screens on `void` (#000000) with full-bleed hairline-ruled rows, inset 20px on the leading edge only.
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
- **Don't** introduce a fifth colour, or reuse `run` / `bank` / `lapse` for anything other than the live run, banked time, and a lapse.
- **Don't** make the tab bar translucent — over true black a material reads as a content leak, not as depth.
- **Don't** tint both a ring and the figure inside it.
- **Don't** add a third authored animation. Motion is `confirm` (the check-in press) and `handoff` (the sweep along the recipient's row); `rise` is entry-only for sheets and notices.
- **Don't** set a figure at display size in a weight above 300, or render any number in proportional figures.
- **Don't** reach for a flame, a gradient hero, a progress-dashboard widget, or a card stack — that is the exact reference this world refuses.
