# Responsive breakpoints for tablet and mobile

Date: 2026-07-21
Status: design approved, not yet implemented

## Problem

The app has **no `@media` rules at all** - `grep -rn "@media" src/` returns
nothing. The viewport meta tag is present and correct, so the layout simply was
never made responsive.

The result is a page with a fixed minimum layout width. Measured against the dev
server, `document.documentElement.scrollWidth` is **1130px regardless of
viewport** - identical at a 485px viewport and an 805px one. Every device
narrower than that scrolls horizontally, including a tablet in portrait.

The cause is one rule in `App.vue`:

```css
.body { grid-template-columns: minmax(480px, 1fr) minmax(420px, 1fr); }
```

480 + 420 + gap + padding is the 1130px floor, and neither column ever yields.
At a 485px viewport that is 645px of overflow. Measured offenders confirm it:
`div.editor` sits at exactly 480px and `aside.preview` at exactly 420px.

Two smaller faults compound it. `PresetBar` and `ActionBar` are both
`display: flex` with **no `flex-wrap`**, so their contents clip rather than wrap
(visible in a 485px screenshot: "Create", "Seed", "New seed" and the whole
action row are cut off). And the shared `.control-table` rules in `factorio.css`
pin a 210px label column plus a 92px "Appears on" column.

## Scope

Layout shell only. **No control is redesigned and no markup changes.** Sliders
remain draggable on a phone - they are small enough to violate touch-target
guidelines, and that is accepted for now rather than fixed here. Every change is
CSS, in a `<style>` block or in `factorio.css`.

Explicitly out of scope: touch-target sizing, reflowing control rows into cards,
and any change to the control components themselves.

## Decisions

| Question         | Decision                                                        |
| ---------------- | --------------------------------------------------------------- |
| Mobile goal      | Everything vertical; controls untouched                          |
| Control tables   | Tighten the pinned columns below a breakpoint (not scroll, not stack) |
| Breakpoint count | Two, each tied to a measured number: 900px and 600px             |

### Why tighten the columns rather than scroll or stack

At a 390px phone there is ~358px of content width. The pinned columns eat 302 of
it, leaving about **18px per slider** - the slider is `width: 100%` with a 14px
thumb and no `min-width`, so it collapses to a hairline. Stacking the page
vertically therefore does *not*, on its own, make the control tables usable.

Tightening the two pinned columns is the smallest change that fixes this. It is
confined to a media query over rules that already exist and are already shared
by every control table, it needs no markup change, and the labels are short
enough to wrap at 120px ("Sulfuric acid geyser" is the longest).

Rejected: horizontal scroll inside each panel (preserves density but imposes
two-axis scrolling), and stacking each row into a card (most usable, but a
markup change per row that drifts into the control redesign this work excludes).

### Why 900px

The two columns need 908px to coexist, so they must stack below roughly that.

### Why 600px, and not 520px

600px was chosen by arithmetic, correcting an earlier guess of 520px.

The table needs at minimum 210 (label) + 92 (appears-on) + 3 sliders at ~80px =
542px, plus 32px of app and editor padding, so **~574px of viewport** before the
desktop columns become cramped.

A 520px breakpoint would leave a dead band from 521-620px: still using the wide
columns, but with only ~62px per slider - *narrower than what phones get below
the breakpoint*. The layout would get worse as the screen got bigger.

At 600px there is no such band. Just above (601px) the wide columns still give
~89px per slider; just below (600px) the tightened columns give ~137px.

## The changes

### `src/App.vue`

```css
@media (max-width: 900px) {
  .body { grid-template-columns: 1fr; }
}
```

The editor stacks above the server-preview panel, in DOM order. Editor first
because that is what the user came to use, and the preview panel is a large
mostly-empty box until Generate is pressed.

### `src/components/PresetBar.vue` and `src/components/ActionBar.vue`

Add `flex-wrap: wrap` to each bar's flex container. **Not** inside a media query:
they clip at any width narrow enough to matter, so wrapping is correct at every
size, and above 900px it is inert because the contents already fit on one line.

This matches existing practice - commit `4718547` fixed the preview toolbar the
same way, for the same reason.

### `src/ui/factorio.css`

```css
@media (max-width: 600px) {
  .control-table thead th:first-child,
  .control-table tbody td.label { width: 120px; }
  .control-table thead th:first-child { padding-left: 22px; }
  .control-table thead th.appears-on-th,
  .control-table tbody td.appears-on { width: 36px; }
  :root { --f-preview-media-max: 100%; }
}
```

On a 390px phone: 358px content, 156px pinned, leaving **~67px per slider**.

Two values deserve explanation:

- `padding-left` drops 30 → 22. That indent exists to line the "Resource" header
  up over the checkbox-gutter-indented row labels; against a 120px column the
  original 30px eats too much of it.
- The preview media is handled entirely by re-pointing `--f-preview-media-max`
  to `100%`. That variable exists so the client canvas and the server PNG render
  at the same size; changing it in one place preserves that invariant, which is
  what the `.f-preview-media` comment in `factorio.css` is protecting.

"Appears on" narrows to 36px rather than being hidden - it carries the planet
icon, which is the only thing distinguishing the duplicate resource names in the
list (there are two "Coal" rows and two "Stone" rows across planets).

## Testing

**These changes are not unit-testable in this project, and no unit test will be
written for them.** Tests run under happy-dom, which has no layout engine: it
does not evaluate media queries, resolve `grid-template-columns`, or compute
element widths. All 815 existing tests pass whether the breakpoints work
perfectly or not at all.

A test asserting that `factorio.css` contains the string
`@media (max-width: 600px)` would prove only that the rule was typed, not that it
works. A test that cannot distinguish working from broken is worse than no test,
because it reads as coverage.

Verification is therefore browser-based, and the report must state what was
actually measured.

**Objective assertion:** `document.documentElement.scrollWidth <=
document.documentElement.clientWidth` - no horizontal overflow. That is the
actual bug, it is a number, and it is the measurement that diagnosed the problem
at 1130px.

**Widths, chosen to bracket both boundaries:**

| width      | expectation                                        |
| ---------- | -------------------------------------------------- |
| 390        | no overflow, tightened columns                     |
| 600, 601   | both sides of the table breakpoint - no dead band  |
| 820        | tablet portrait, no overflow (it scrolls today)    |
| 899, 901   | both sides of the stack boundary                   |
| 1280       | desktop, visually unchanged                        |

**Slider-width check** at the narrowest verified width: measure a rendered
slider's computed width and assert it exceeds ~50px. "The page does not scroll"
would otherwise be satisfied by sliders collapsed to hairlines.

**Known limitation:** `resize_page` clamped at 485px in exploration - Chrome's
minimum window width - so 390px could not be rendered that way. Implementation
should try CDP device emulation for a true 390px viewport; **if that also fails,
report 485px as the narrowest verified width rather than implying a phone was
tested.**

Desktop regression risk is low by construction: above 900px the only new rule is
`flex-wrap: wrap` on two bars, inert when their contents already fit.

## Out of scope

- Touch-target sizing and any control redesign (explicitly deferred).
- A large-desktop breakpoint above 1200px - nothing is broken there today.
- The control tables on the Terrain and Enemy tabs are covered automatically,
  since the pinned widths live in the shared `.control-table` rules rather than
  per-tab.
