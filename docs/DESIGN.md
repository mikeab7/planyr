# `docs/DESIGN.md` — the design bible (NEW-1, 2026-08-31)

**This is the single normative contract for Planyr's visual language.** Every session that adds
or changes UI reads this **before writing the first line of markup** — that pointer is in the
root `CLAUDE.md` (the always-loaded file) so it can't be missed by not knowing this file exists.

This is **not** a new design system. It is the write-up of tokens and primitives that were
already built, scattered across their own headers, plus two hard rules and a CI guard
(`ui-audit/design-drift-audit.mjs`, NEW-2) that keeps this document true instead of aspirational.
The 2026-07-06 "design-language convergence" pass first normalized control radius to 8 app-wide
and built `src/shared/ui/controls.jsx`; B427411 (2026-08-06) and B809906 (2026-08-27) then built
the token files this doc actually cites. If you're extending the scale, extend those files — never
invent a fifth radius, a ninth font size, or a new raw color literal because none of the existing
ones feel right for your control.

## The two hard rules

**(a) Components consume tokens and primitives.** A raw hex color, a raw `borderRadius` number, or
a raw `fontSize` number written directly in a component is a **defect**, not a style choice — even
if the number happens to match a token's value. Reference the token (`var(--accent)`, `RADIUS.md`,
`FONT_SIZE.lg`) so the value can never drift independently of every other control that means the
same thing. `ui-audit/design-drift-audit.mjs` enforces this mechanically (see "The CI guard" below).

**(b) A new control is never invented at the call site.** If none of the primitives in
`src/shared/ui/controls.jsx` fits, the primitive set is **extended** there and documented in this
file, and that extension ships in the same PR as whatever needed it. A one-off styled `<button>`
in a feature file is exactly how the app ended up with 22 raw button-radius values before B427411 —
don't re-create that.

## Color tokens (`src/index.css`)

Every color is a CSS custom property with a light value under `:root` and, where it differs, a
dark override under `[data-theme="dark"]`. **A component reads the token (`var(--text-primary)`),
never the hex behind it** — the hex values below are cited so this doc can be checked against the
CSS, not so you copy them into a component.

| Group | Tokens | Light | Dark | Notes |
|---|---|---|---|---|
| Surfaces | `--surface-page` / `--surface-raised` / `--surface-overlay` | `#F3F5F8` / `#FFFFFF` / `rgba(255,255,255,.94)` | `#14161B` / `#1D2027` / `rgba(24,27,33,.93)` | `-overlay` is the frosted floating-panel-over-the-map surface. |
| Borders | `--border-default` / `--border-strong` | `#E1E5EB` / `#CDD3DC` | `#2A2E37` / `#3A3F4B` | Subtle grays are correct **only** for borders, the drafting grid, and the Complete status badge — never for body/label text (see "Text hierarchy" below). |
| Text | `--text-primary` / `--text-secondary` / `--text-tertiary` | `#1B1E26` / `#353B49` / `#4B5263` | `#E8EBF0` / `#CAD0DA` / `#A4ABB8` | Every pair clears WCAG AA (≥4.5:1) on its surface, both themes — machine-checked, see below. |
| Planner surfaces | `--planner-panel` / `--planner-raised` / `--planner-border` | `#EAEEF3` / `#FFFFFF` / `#E1E5EB` | `#15171D` / `#191C22` / `#2E333D` | The Site Planner's own "drafting parchment" backdrop + card tier, distinct from the general app surfaces. |
| Chrome | `--chrome-bg` / `--chrome-bg-elev` / `--chrome-divider` / `--chrome-text` / `--chrome-muted` / `--chrome-tab-inactive` | `#EAEEF3` / `#FFFFFF` / `#D7DDE5` / `#1B1E26` / `#353B49` / `#454C5C` | `#111319` / `#171A21` / `#262A33` / `#ECEFF4` / `#A6ADBA` / `#C2C8D2` | The top bars / rail / status-bar family. **Chrome themes WITH the app** — never a permanently-dark bar over a light app. |
| Warn/save | `--warn-text` / `--save-badge` | `#8A5410` / `#0F6E56` | `#EFB54E` / `#7FD8B8` | `--warn-text` is the AA-amber saving/unsaved/offline label color — always this token, never a raw amber. |
| Semantic text | `--success-text` / `--danger-text` / `--info-text` | `#15803D` / `#B3361B` / `#1D4ED8` | `#4FBF7B` / `#F2706F` / `#6FB4F0` | Colored labels on themed panels. A hardcoded hex reads fine on a light card and fails AA on a dark one — this is exactly the class of bug the CI guard exists to catch. |
| Alert fill | `--danger` | `#E24B4A` | `#F2706F` | Reserved for genuine alert/error (cloud-off badge, failed-layer dot, destructive ×) — **never** an inert state (see the status-palette rule in root `CLAUDE.md`). |
| Banner tints | `--warn-bg`/`--warn-border`, `--danger-bg`/`--danger-border`, `--success-bg`/`--success-border` | tinted pastels | darker tinted | The panel a `-text` token sits on inside an inline notice/banner. |
| Module accents | `--accent-site` / `-schedule` / `-review` / `-library` / `-notes` / `-food` | `#1D9E75` / `#7F77DD` / `#EF9F27` / `#0E7490` / `#B8418C` / `#BE3B22` | (unchanged — see "on-fill" row) | Which **workspace** you're in — confined to the top tab row. Mirrored in JS by `src/shared/ui/moduleAccent.js` (fill values only; food is deliberately absent there, see its own comment). |
| On-fill (module) | `--on-accent-site` / `-schedule` / `-review` / `-library` / `-notes` / `-food` | white / white / `#412402` (dark) / white / white / white | same | Text/icon painted **ON** a solid module-accent fill. Review is the one amber fill and is the one that carries **dark** text — see "The fill-vs-text rule" below. |
| Accent-as-text | `--accent-site-text` / `-schedule-text` / `-review-text` / `-library-text` / `-notes-text` / `-food-text` | `#0F6E56` / `#534AB7` / `#8A5410` / `#0C677E` / `#8C2F69` / `#9E3019` | lighter per-theme values (see index.css) | The module accent used **as foreground** (an active tab label, a breadcrumb "current" label) — never the fill hex. |
| Status | `--status-pursuit` / `-active` / `-onhold` / `-complete` / `-dead` | `#D85A30` / `#378ADD` / `#BA7517` / `#888780` / `#888780` | lighter dark-mode values | The deal-STAGE palette (`src/shared/ui/statusTokens.js` is its JS source) — a **deliberately separate axis** from module accents; never source a status color from an accent token or vice versa. |
| Global accent | `--accent` / `--on-accent` | `#C2410C` / `#FFFFFF` | (unchanged) | The shared interactive "drafting" accent every primitive in `controls.jsx` defaults to. |
| Focus / hover | `--focus-ring` / `--focus-ring-soft` / `--hover-ghost` / `--hover-menu` / `--hover-chrome` | see index.css | see index.css | |
| Canvas / drafting | `--canvas-bg`, `--canvas-grid-*`, `--canvas-parcel`, `--canvas-selection`, `--canvas-chip-ink`, … | see index.css | see index.css | The Site Planner **drawing surface** — a different domain from app chrome; see "Canvas/SVG boundary" below. |
| Brand | `src/shared/brand/tokens.js` (`BRAND.coral.*`, `.line`, `.surface`, `.wordmark`) | fixed (not themed) | fixed | The coral isometric mark. Locked brand colors, not chrome — inline-styled components import this file directly (CSS can't reach it the same way `var()` can). |

### The fill-vs-text rule (B341)

A module or status color has **two** roles and **two** tokens, and they are never interchangeable:

- **Accent as a FILL** (a solid chip, an active tab underline, a filled button) → the fill token
  (`--accent-review`).
- **Accent as FOREGROUND** (text or an icon sitting on a plain surface) → the **`-text`** token
  (`--accent-review-text`), never the fill hex. The fill and the text color are tuned for different
  contrast pairings (fill-vs-white-or-black, text-vs-page) and are not interchangeable even when
  they look close. **This has already shipped as a bug once** — a chrome component that reached for
  the fill token as a text color read fine until the surface it sat on changed, which is exactly the
  failure mode a hardcoded literal produces too.

### On-fill text, including "amber carries dark text"

Text/icon painted on a solid accent fill uses the paired **`--on-accent*`** token, never a bare
`white`/`black`/hex. Five of the six module fills are dark enough that white clears AA
(`--on-accent-site/-schedule/-library/-notes/-food` are all `#FFFFFF`); **Review's amber fill is
the one exception — `--on-accent-review` is `#412402` (dark), not white**, because white-on-amber
fails contrast. The rule is "whichever text color clears AA on **this** fill," decided once per
token pair by the contrast audit — never assume white is always right for an accent fill.

### Text hierarchy — build it with weight/size/case, never by fading to background

Per the root `CLAUDE.md` KEY DECISION: hierarchy comes from **weight, size, and uppercase
letter-spacing** (see `Section`'s 10.5px/700/0.09em uppercase title in `controls.jsx`) — never by
fading text toward the background. Low-contrast gray body/label text is disallowed; subtle grays
are correct only for borders, the drafting grid, and the Complete status badge.

### Machine-checked

`ui-audit/contrast-audit.mjs` (`auditAll()`, consumed by `test/contrast.test.js` in `npm test`)
parses the real light/dark token blocks out of `src/index.css` and checks every meaningful
foreground/background pair against WCAG AA (4.5:1 text, 3:1 large/UI-graphic) in both themes. A
palette edit that drops a pair below its floor fails CI — this doc states the *shape* of the rule;
that script is the source of truth for the *numbers*.

## The radius scale

**`src/shared/ui/radius.js`** is the one source of truth:

```js
export const RADIUS = { pill: 999, sm: 6, md: 8, lg: 12 };
```

CSS mirror: `--radius-pill` / `--radius-sm` / `--radius-md` / `--radius-lg` in `index.css`.

| Step | Value | Use |
|---|---|---|
| `pill` | 999 | Fully rounded — status dots, toggle chips, any bar whose height *is* its shape. |
| `sm` | 6 | A control nested **inside** another rounded surface (an input in a panel, a button in a banner). |
| `md` | 8 | A standalone control — a button, a text field, a chip sitting on the map by itself. **This is the app-wide default control radius.** |
| `lg` | 12 | A surface that *contains* other things — a floating panel, a menu, a dialog. |

**Nesting rule:** a rounded thing inside another rounded thing must be **concentric** — the inner
radius is the outer radius minus the gap between them, computed by `nestedIn(outer, gap)`, floored
at 2px. Inside a `pill`, a control that runs the bar's full height is itself a pill — there is no
radius that reads as deliberate against a fully-round edge except another fully-round edge.

### The shape rule (NEW-1, 2026-08-31) — which step is for what, not just "which steps exist"

The table above says four values are allowed; it doesn't say **which one a given control must
use**, and two allowed-but-different values sitting side by side is drift the raw allowed-set can't
see — both pass, and the owner's eye still catches it (*"just on the landing page attached there
are a multitude of different radii and fillets for chips and i'd like to fix"*). The rule:

- **`pill` is reserved for a CONTAINER that holds other controls** — a segmented shell, the account
  chip, a toggle bar whose height *is* its shape. It is never a standalone action button's own
  resting shape; the table above already says `pill` is for "any bar whose height is its shape,"
  this just states the converse: nothing else may claim it.
- **`md` (8) is every standalone actionable control** — a button, a text field, a chip sitting on
  the map by itself, not nested inside another rounded surface.
- **`lg` (12) is every surface that contains other things** — a floating panel, a menu, a dialog.
- **`sm` (6) is a control nested inside one of the above**, resolved through `nestedIn()`, never
  picked by eye.
- Nothing else exists. A fifth value is never invented because a particular control "wants" one —
  see radius.js's own header for why that's exactly how the pre-consolidation eight got there.

**The binding clause: a NESTED control must never carry a different radius family than its own
container demands.** Not "must be on the scale somewhere" — must be the specific step `nestedIn()`
derives from *that* container. Two on-scale curves sitting flush against each other with different
families is the specific thing the owner sees as sloppy, because the eye compares the two curves
directly with no gap between them; a control that merely happens to be one of the four legal
numbers, but the wrong one for its container, reads exactly as broken as an off-scale number does.

**Worked example, from a real defect this rule closes (`MapFinder.jsx`'s `SiteCompSwitch`):** a
small Site/Comp toggle sits inset 2px inside its own switch shell. The shell is `sm` (6) — already
the smallest standalone step — so `nestedIn(RADIUS.sm, 2)` floors out at **4px, a fifth number no
step names.** This is the one case the rule has an explicit escape for: **when a container's own
radius is already `sm` (the smallest non-square step), a directly-nested control snaps to the
CONTAINER's radius instead of minting an off-scale derived value** — matching the container exactly
is "on the scale and in the right family" in a way that a perfectly-concentric-but-invented 4px is
not. This only fires at the bottom of the ladder; nesting inside `md`, `lg`, or `pill` always lands
on a real step (`nestedIn(8, gap)`, `nestedIn(12, gap)` and `nestedIn(999, gap)` all resolve to
`sm`, `sm`/`md`-range integers on the ladder, or `pill` respectively for the gaps this app actually
uses) and never needs the fallback.

**Machine-enforced (NEW-2):** `ui-audit/ui-inventory.mjs`'s `nestingMismatches()` walks the real,
rendered DOM for every crawled surface, finds each rounded control's nearest rounded, visually-
containing ancestor, and asserts the child's radius equals `nestedIn(ancestorRadius, measuredGap)`
(or, per the fallback above, equals the ancestor's own radius when the derived value would be
off-scale) — a check `design-drift-audit.mjs` cannot make, because that guard is a text scan with
no DOM and no geometry: it can confirm every number is *somewhere* on the scale without ever seeing
that two adjacent, on-scale curves disagree with each other. Findings are printed in
`docs/UI-INVENTORY.md`'s "Nesting mismatches" section, regenerated the same way as the rest of that
file.

### The sibling clause (B950320, 2026-08-31) — two correctly-shaped controls can still be wrong together

The nesting rule above governs a control against its **container**; it has nothing to say about two
controls that sit **beside** each other with no containment relationship at all. The owner found the
gap: the row-1 account chip (a `pill` — an avatar, a name and a caret, exactly the "container that
holds other controls" case the shape rule already blesses) sitting immediately next to the fullscreen
button (an `md` square — exactly the "standalone actionable control" case). Both are individually
on-scale and on-family per every rule above. The pair still reads as sloppy, because **the eye
compares two adjacent curves directly when there is no gap between them** — the same perceptual fact
the nesting rule's binding clause already turns on, just without a container in play.

**⛔ SUPERSEDED FOR THIS SPECIFIC PAIR, B972096, 2026-08-31 — a divider satisfied the RULE below
without ever converging the ROW, and the owner reported the same mismatch a third time.** The
original resolution here was a hairline divider between the icon-button cluster and the identity
pill (kept the pill a pill, kept the buttons `md`, drew a boundary between the two families). It
made every check pass and the owner still saw "a full pill next to a small square" — because a
divider makes two DIFFERENT families acceptable side by side, but it does not make the row itself
read as one consistent thing, which is what he was actually asking for. **The corrected resolution
for the account chip specifically: it was never really a container.** Per the shape rule below, a
`pill` is for something that genuinely holds several sub-controls with its own internal structure (a
segmented toggle, a bar whose height IS its shape); the account chip holds an avatar, a name and a
caret, but it is still fundamentally ONE control that opens ONE menu — the same shape as the row's
"File ▾" button, which nobody would call a pill. It, the "Cloud off" chip (its no-Supabase sibling),
and the presence "N here" chip (`SitePlanner.jsx`'s `saveSlot`) are now `RADIUS.md`, matching
`FullscreenButton`/`SettingsMenu`/`CloudSyncBadge` — one family across the whole row, no divider
needed, because there is no family boundary left to mark. **The general rule below is unchanged and
still governs every OTHER pair in the app**; only the specific claim that this pair's fix was "insert
a divider" is retracted. If a future control genuinely IS a container of several sub-controls, it is
still correctly a `pill`, and a divider is still the right way to mark it off from a `md` neighbor.

**The general rule, unchanged:**

- **Two different radius families may sit in the same control row, but only with a visible boundary
  between them** — a divider, or genuine clear space (`docs/DESIGN.md`'s own reading of "gap" here is
  a real gap, not the small `SPACE.sm`/`SPACE.md` a same-family row uses between its own members).
  Flush adjacency (the app's ordinary flex `gap`, 6–8px, with nothing else between) is never
  acceptable between two families, however individually correct each one is.
- A cluster boundary is drawn where a genuine family boundary falls — never invented per pair, and
  never reached for as the first fix when the honest fix is converging one of the two controls onto
  the other's family (as above).

**Machine-enforced, and — per B972097's own instruction not to overclaim — stated exactly:**
`ui-audit/ui-inventory.mjs`'s `siblingMismatches()` groups the same on-scale rounded-candidate pool
`nestingMismatches()` builds by shared flex-row ancestor (not bare immediate parent — a
wrapped-one-level-deeper sibling, e.g. a popover-anchor `<div>`, must still be caught), walks
adjacent pairs left-to-right, and flags a pair whose families differ and whose gap reads as flush.
Findings print in `docs/UI-INVENTORY.md`'s "Sibling radius mismatches" section. It found a second,
independently pre-existing instance the owner never reported — the header's plan-name chip had
drifted to `RADIUS.sm` after the adjacent project-breadcrumb chip moved `sm`→`md`, silently breaking
that chip's own comment claiming they matched — fixed the same way this item shipped
(`SitePlanner.jsx`'s plan-name chip is `RADIUS.md` again).

**B972097 (NEW-2) tightened the adjacency test itself, because the ORIGINAL version of this check
was the very thing that let the account-chip pair "pass" twice without converging:** a gap wider than
the threshold used to exempt a pair outright, so both the B950320 divider and the B958466
`CloudSyncBadge` token reclassification cleared the check by making the pair read as "not adjacent"
— never by making the row look right. The check now asks, for any pair whose gap exceeds the
threshold, whether a divider-shaped element (a real bar, not a stray pixel) sits inside that gap; if
one does, the pair is still judged as adjacent and still has to agree, and a finding on such a pair
is annotated `(divider-separated)` in the generated report. **Stated exactly, because a check like
this invites overclaiming both ways:**
- **What it now catches:** a mismatched pair separated ONLY by a divider (the literal B950320/B958466
  shape) can no longer clear the check by that separation alone. Proven with a teeth-check before
  shipping — reproducing the account-chip pair with a divider reinstated and its radius reverted to
  `pill` returns 6 findings, all `(divider-separated)`, where the pre-B972097 code returned 0 on the
  identical DOM.
- **What it still cannot tell:** whether a divider it finds is `docs/DESIGN.md`'s real divider spec
  (1px, the `--chrome-divider` token) or merely some other thin element that happens to fit the width
  budget — it does not check color or token use, only shape and position. Nor can it distinguish a
  genuine family boundary (two clusters that were never meant to visually agree — e.g. the row's
  logo/wordmark area vs. its action buttons) from a divider being used as a loophole to silence a
  mismatch that should have been converged instead. Both read identically as `(divider-separated)`
  in the report; a human still has to look at the flagged pair and judge which one it is. The check's
  job stops at "this still needs a human's attention" — it does not (and structurally cannot) decide
  whether that attention should end in a divider staying or a radius converging.

**`src/shared/ui/controls.jsx`** declares its own literal, smaller scale —
`RADIUS = { control: 8, pill: 999, panel: 12 }` — that predates `radius.js` and agrees with it by
value (`control === md`, `panel === lg`). **This is a deliberate, documented duplicate, not
drift**: seven Notes components mirror it locally too, and `test/notesModule.test.js` regex-parses
the literal digits out of that exact line as a build-time contract — replacing the numbers with an
`import` breaks that test. If you ever change one of these three numbers, change it in both places
in the same commit (`controls.jsx`'s own header comment says the same).

### Documented exceptions — every one, and why

1. **The raw `7` radius (43 sites, mostly in `SitePlanner.jsx`).** Sits exactly between `sm` (6)
   and `md` (8). B814914 explicitly left this **undecided** rather than nudge 43 live controls a
   visible pixel by fiat — folding it into `sm` or `md` is a real, if small, visual change and is
   an owner call, not a mechanical one. Still open; do not "clean it up" unilaterally.
2. **Canvas/SVG drawing geometry is not governed by this scale at all** — see "Canvas/SVG
   boundary" immediately below. A parcel corner, a road curb return, or a print-sheet title block
   has its own geometric reason to be the shape it is; it is not a UI control and citing `RADIUS`
   at it would be a category error, not a fix.
3. **A raw literal that already equals a token's pixel value** (e.g. `TB_R = dGhost.borderRadius`
   in `SitePlanner.jsx`'s toolbar, which is `8`) renders identically to using the token but can
   drift independently of it. Mechanically repointing these at the named constant is free,
   zero-visual-change cleanup and is exactly the kind of drift NEW-3's inventory is for — it is not
   a "documented exception" in the sense of being allowed to stay, it is backlog debt with a known,
   safe fix.
4. **Leaflet's own map controls (the zoom stack, the "Find my location" button, the scale bar) are
   third-party chrome, brought onto the scale where a curve is genuinely visible.** The zoom
   stack's own container and the locate button's own container both carry `border-radius:
   var(--radius-md)` overrides in `index.css` (scoped to the specific class each control renders,
   so no other Leaflet widget is touched), with a `.leaflet-touch` variant written out for each —
   Leaflet's own `.leaflet-touch .leaflet-bar a:first-child`/`:last-child` rule outranks a plainer
   override at equal specificity, so the touch-mode selector has to be matched explicitly or the
   override silently loses in exactly the environment this crawler runs in. **The scale bar is the
   deliberate exception, not an oversight:** it is a ruler (a bottom-and-side border with no fill),
   not a chip, so there is no filled box for a corner radius to make visible — rounding it would
   change nothing a person could see. Same category as the Scheduler iframe: out of scope for the
   token scale, but named here rather than left to look silently different.

## The divider rule (B958468, 2026-08-31)

A chrome row groups its controls with a plain **1px vertical divider** — never a filled tray,
never a full-height rule. Two things make it "the same divider" everywhere it appears, and both
are checked against the row it sits in, not picked by eye:

- **Height = the row's own control height minus 12px** — a 6px inset top and bottom. In every
  chrome row today that control height is `CONTROL_H.md` (26px), so the divider is **14px**. A row
  built at a different `CONTROL_H` step insets the same way against that step, not a copy of `14`.
- **Color = the theme's chrome-divider token** (`var(--chrome-divider)` in `AppHeader.jsx`,
  `PAL.chromeLine` in `SitePlanner.jsx` — the same CSS custom property, just reached through the
  CSS-var form or its JS mirror depending on which file you're in) — **never a raw color literal**,
  and never an alpha-blended white/black hack that assumes one theme's background. `rgba(255,255,255,0.12)`
  reads as a visible hairline on a dark row and is functionally **invisible on a light one** — exactly
  the KEY DECISIONS violation the token rule exists to prevent ("a hardcoded hex... reads fine until
  the chrome flips theme"). If a divider is disappearing in one theme, it is almost always this.
- **Width is always 1px.** Margin/gap around the divider is a per-instance spacing choice (how much
  air a given row wants between its groups), not part of the divider's own identity — `AppHeader.jsx`
  uses `0 4px` between the wordmark and the breadcrumb and `0 2px` between the icon-button cluster and
  the account pill; `SitePlanner.jsx`'s toolbar uses `0 6px` between its three control groups. All
  three are the same divider at different insets, not three different dividers.

**Worked example, from a real defect this rule closes:** the Site Planner's row-2 toolbar (`vSep`
in `SitePlanner.jsx`) used to be its own thing — `height:18` (not derived from the row), color
`rgba(255,255,255,0.12)` (a raw literal, invisible on the light theme's near-white row). Row 1's
own divider (`AppHeader.jsx`, added alongside the sibling-radius fix) already had the right shape;
row 2's was brought to match it exactly rather than staying a second, independently-invented divider
one row down. See the sibling clause above for the companion rule this pairs with: a divider is what
makes two different radius families sitting in one row acceptable — an invisible one doesn't count.

## Spacing, type, and control-height scales (`src/shared/ui/designTokens.js`)

```js
export const SPACE      = { xxs: 2, xs: 4, sm: 6, md: 8, lg: 10, xl: 12, xxl: 16 };
export const FONT_SIZE  = { micro: 10, label: 10.5, control: 12, emphasis: 13, display: 14 };
export const CONTROL_H  = { sm: 22, md: 26, lg: 30 };
```

CSS mirrors: `--space-*`, `--font-*`, `--control-h-*` in `index.css`. `SPACE`/`CONTROL_H` are **the
tree's own dominant value, promoted** from a 738-button audit (B809906) — never invented.

### The type scale's five roles (B915536's NEW-1, 2026-08-31) — a role for every step, not just a rung

`FONT_SIZE` used to keep the audit's raw eight-value half-point ladder (`xs 10 / sm 10.5 / base 11
/ md 11.5 / lg 12 / xl 12.5 / xxl 13 / display 14`) on the reasoning that each value was "real,
separately-used". That reasoning under-weighted the cost: eight values with four half-steps is
**a menu wide enough that almost anything looks legal and nothing has a defined role** — a session
could pick 11 or 11.5 or 12 for the same control and every choice would pass the guard. A quick
font fix once traded one wrong size for another under exactly this scale and was correctly backed
out rather than shipped as a wash (see `docs/UI-INVENTORY.md`'s history). The reduced scale names
what each step is **for**, so a future session can pick the right size without guessing:

| Step | Value | Role | Worked example |
|---|---|---|---|
| `micro` | 10 | Tiny numerals and decorative glyphs — a count badge, a single digit inside a pill dot, a compact segmented-toggle label. **Never running text.** | The Sites-panel group-header status-disc glyph (`MapFinder.jsx`); `Collapse`'s own count badge. |
| `label` | 10.5 | Uppercase section headers (weight 700, ~0.08em letter-spacing) **and** secondary/hint text sitting under a primary control or value. The one deliberate half-step, kept because it was already the app's own text-hierarchy worked example. | `Section`'s uppercase title in `controls.jsx`; `ThemePicker`'s per-option hint line ("Always dark", "Match your computer"). |
| `control` | 12 | The default, workhorse control/body text — buttons, menu items, field values, inputs, most running UI text. Reachable via `controls.jsx`'s `FONT.md`. | `Button`'s default/lg text; `MenuItem`; the top-row module-switcher tabs (`AppHeader.jsx`'s `ModuleTab`). |
| `emphasis` | 13 | A step up in weight for content that should stand out without being a headline — a larger button, a panel's primary number, a callout. | `ThemePicker`'s active-option checkmark; a Yield-panel headline figure. |
| `display` | 14 | Page/hero headlines — the one biggest size in the app. | The `/design` gallery's own `<h1>`; `SitePlanner.jsx`'s own zoom-stack `+`/`−`/`⤢` trio (a decorative glyph cluster sized to fill a 30px touch target, all three unified onto this step in the same item that shrank the scale). |

**Half-steps are gone except the one named above.** `sm`/`base`/`xl`/`xxl` from the old ladder are
retired; a future session is never asked to distinguish 10.5 from 11 from 11.5 again. Reducing the
legal set from 8 to 5 mechanically flags hundreds of pre-existing, unchanged call sites that used a
now-retired value — that is a redefinition of legality, not new drift, and the CI guard's own
ratchet ceiling absorbs it the same way it already absorbs the pre-existing hex/radius debt (see
"The CI guard" below); NEW-2 of the same item moved every one of `ui-inventory.mjs`'s computed-style
deviations it could see onto the new scale, and the remainder is real, honestly-inherited, future
work — see `ui-audit/design-drift-ceiling.json`'s own note for the exact numbers.

`controls.jsx`'s own `PAD` / `FONT` constants are a **convenience layer built from the same
numbers**, not a competing scale:

```js
export const PAD  = { sm: "5px 10px", md: "7px 12px", lg: "9px 14px" };
export const FONT = { sm: 10.5, md: 12 };   // FONT.sm === FONT_SIZE.label, FONT.md === FONT_SIZE.control
```

`FONT.sm` (compact controls — `ToggleChip`, `Button size="sm"`) and `FONT.md` (standard controls —
`Button` default/lg, `MenuItem`) now sit a full 1.5px apart rather than the old ladder's 1px, so
"compact" reads as a real, deliberate size difference rather than a rounding artifact.

Use `SPACE`/`FONT_SIZE`/`CONTROL_H` for a new gap/margin/padding/height/font-size value anywhere
in the app; use `PAD`/`FONT` when you're building a `controls.jsx` primitive itself or something
that needs to match one exactly.

## The primitives (`src/shared/ui/controls.jsx`)

Every one is **token-driven and theme-safe** — they reference CSS theme tokens only, never a raw
hex, which is why the contrast audit can guard every color they paint. All are **module-scope
functions** (never defined inside another component's render body — see MODULE-SCOPE-COMPONENTS
in root `CLAUDE.md`). Each accepts an `accent`/`onAccent` pair (default `var(--accent)` /
`var(--on-accent)`) so a host module can substitute its own accent (`accent="var(--accent-library)"
onAccent="var(--on-accent-library)"`) without forking the component — module accents are never
flattened into one shared color.

| Primitive | Radius | Padding / size | Type | States |
|---|---|---|---|---|
| **`Button`** (`variant`: primary/ghost/danger, `size`: sm/md/lg) | `RADIUS.control` (8) | `PAD[size]` | `FONT.sm` (10.5, `FONT_SIZE.label`) at `size="sm"`, else `FONT.md` (12, `FONT_SIZE.control`), weight 600 | `disabled` → `opacity: 0.5`. `active` renders a ghost as filled (a pressed toggle). `danger` (not active) → `--danger-text` border/text on `--surface-raised`. Rest shadow: a fixed neutral `0 1px 2px rgba(0,0,0,.05)` (token-independent by design — kills the old colored "ember" shadow bug). Hover/focus are inherited from the shared browser default plus the app's global keyboard-focus-ring rule; no per-component override. |
| **`ToggleChip`** (`active`) | `RADIUS.pill` (999) | `6px 11px` | `FONT.sm` (10.5, `FONT_SIZE.label`), weight 650 active / 500 rest | `active` → filled with `accent`/`onAccent`, border = accent. Rest → `--surface-raised` / `--border-default` / `--text-primary`. |
| **`IconButton`** (`size` px, default 30, `active`) | `RADIUS.control` (8) | square `size × size`, zero padding, centered content | n/a (icon slot) | Same active/rest fill logic as `Button`. |
| **`Field`** | n/a (row, not a control) | `gap: 10`, `marginBottom: 8` | label `12px` (`FONT_SIZE.control`) / `--text-secondary` | A label + control row layout only — no interactive state of its own. |
| **`Section`** (collapsible group) | `RADIUS.panel` (12) | header `10px 12px`, body `0 12px 12px` | title `10.5px` (`FONT_SIZE.label`)/700/`0.09em` uppercase `--text-secondary` | `open`/`collapsed` (▶ rotates 90°, `.18s ease`). Keyboard: `role="button"` + `tabIndex={0}` + Enter/Space toggles, `aria-expanded` published. |
| **`MenuItem`** (flyout row, `active`) | `RADIUS.control` (8) | `7px 10px` | `FONT.md` (12, `FONT_SIZE.control`), weight 650 active / 500 rest | `active` → `--hover-menu` background. Sits inside `menuPanelStyle` (`RADIUS.panel`, `--surface-raised`, `--border-default`, a two-layer drop shadow, `padding: 6`). |

See the live `/design` gallery (NEW-4) for every one of these rendered in every state, both
themes, side by side — use it to eyeball a new control against the existing set before writing one.

## Floating notifications (NEW-5, B1000400, 2026-09-01)

**Every FLOATING, APP-LEVEL notification — anything that overlays content to tell the user
something happened or how to proceed — renders bottom-centered**, through the one shared
primitive: `src/shared/ui/FloatingNotice.jsx`.

**The rule, stated exactly:** `position: fixed`, `bottom` (Toast's existing `18` is the dominant
value in this codebase — promoted, not reinvented), `left: "50%"`, `transform:
"translateX(-50%)"`, and **one shared z-index** (`NOTICE_Z`, `6500`). Before this, three surfaces
each invented their own position for the same job — `AppHeader.jsx`'s fullscreen-refused and
cross-tab-conflict notices and `ProjectBreadcrumb.jsx`'s at-risk-switch toast all sat at
`top: 84` (at three DIFFERENT z-indexes: 5999 / 6500 / 9000), and `MapFinder.jsx`'s
select-parcels guidance sat in a hand-built top-left column. Only `Toast.jsx` already had the
right shape. The owner's report that triggered this rule: the select-parcels guidance box sat
oversized at the top-left of the map, covering the aerial imagery and the +/- zoom controls.

**Multiple simultaneous notifications STACK vertically from the bottom, newest nearest the
bottom edge, with a fixed gap (`NOTICE_GAP`, `8`) — they must never overlap.** `FloatingNotice`
achieves this structurally rather than by pixel math: every mounted instance portals into ONE
shared host `<div>` (created lazily, appended once to `document.body`) that is itself the fixed,
bottom-centered flex column — the browser's own layout engine keeps stacked notices from ever
landing on the same pixels, regardless of which component mounted them or when.

**A max-width clamp is mandatory** (`NOTICE_MAX_WIDTH`, `"min(560px, calc(100vw - 16px))"` by
default, overridable per call) so a long message never spans a wide monitor edge-to-edge and
never exceeds the viewport on a phone.

**It must not sit under or over a mobile bottom sheet** (`src/workspaces/food/components/
BottomSheet.jsx`). `bottomSheetTracker.js` is a tiny module-scope publish/subscribe signal —
`BottomSheet` publishes its live height (mount, snap, drag, and back to `0` on unmount) and
`FloatingNotice` reads it, adding the sheet's height plus a gap to its own `bottom` offset
whenever a sheet is open. This is a signal, not a prop thread, because a floating notice can
mount from app-level chrome (`AppHeader`, `Shell`) that has no path down into a single
workspace's bottom sheet.

**What `FloatingNotice` owns vs. what it doesn't:** position, stacking, the max-width clamp, and
bottom-sheet clearance — never visual style. Each caller keeps its own border/background/color/
content layout (an amber warning and a blue info notice still read differently); only WHERE a
notice sits is shared.

**The boundary — read this before moving anything:** this rule governs **floating, app-level**
notifications only. An **inline** message that belongs to one panel, row, or form field **stays
exactly where it is** — floating it to the bottom would divorce the message from the thing it
describes. Examples that must NOT move: `src/shared/storage/StoragePanel.jsx`'s `msg` (inside the
panel), `src/workspaces/library/components/FolderTree.jsx`'s inline tree error row, and the inline
`role="alert"` blocks in `src/workspaces/notes/` (`Notes.jsx`, `NotesTree.jsx`,
`components/IntegrityBanner.jsx`). **`role="status"`/`role="alert"` is NOT the test —
floating-and-app-level is.** A component can carry either role and still be correctly inline.

**Machine-enforced:** `ui-audit/notification-position-audit.mjs` — a sibling of
`design-drift-audit.mjs`, wired into the same `npm test` step via `test/notificationPosition.test.js`
— checks a registered set of known floating-notice surfaces (by `data-testid`, immune to line
drift) against this rule and fails the build, naming the file and the actual offending value, if
any surface stops being bottom-centered or its `data-testid` goes missing entirely (a renamed or
removed testid is a failure, never a silent skip).

## Canvas/SVG boundary — what is "chrome" and what isn't

The Site Planner's drawing surface (parcels, buildings, roads, ponds, dimension chips, selection
handles), the map-marker icons (`sitePinIcon` and friends), and the print/export sheet
(`printSheet.js`, `notesPrint.js`, `exportSheet.js` and its helpers) are **not chrome**. Their
colors and shapes represent **drawn content** — a road is gray because pavement is gray, a
selection handle is a fixed size because it is a touch target on a drawing, a print sheet mirrors
the canvas exactly per PDF-PARITY. None of that is a UI-control decision the token scale above
governs, and citing `RADIUS`/`FONT_SIZE` at a road curb return would be a category error.

**The boundary is a stated, reviewable file/path list**, not a per-line judgment call — see
`DRAWING_SURFACE_PATHS` in `ui-audit/design-drift-audit.mjs`, currently:

- `src/workspaces/site-planner/SitePlanner.jsx` — the canvas render component. **Known limitation,
  stated rather than hidden:** this 27,000-line file also contains some chrome (menus, toolbar,
  inspector fields) not yet split from the canvas it renders — see `docs/PLAN-SITEPLANNER-DECOMPOSITION.md`
  (B287058), which is the tracked, deliberately-not-yet-started effort to separate them by state
  ownership. Until that lands, the whole file is exempted from the hex/rgb check as drawing
  surface; its few genuinely-chrome menus (the `File ▾` toolbar, its `AnchoredMenu` popovers)
  already consume `RADIUS`/`FONT_SIZE` correctly (see NEW-3's inventory) and are not where the
  debt actually is.
- `src/workspaces/site-planner/lib/{layers,vectorLayers,planStyle,easements,mitigationHeatmap,jurisdiction,printSheet}.js`
  — GIS/plan-geometry rendering and the PDF-PARITY export sheet.
- `src/workspaces/notes/lib/notesPrint.js` — print export.
- `src/workspaces/food/lib/ratingColor.js` — a measured, WCAG-verified 1–10 rating **color ramp**
  (data visualization, not decorative chrome — see the file's own header for why every step is
  independently contrast-checked).
- `src/shared/theme/familyInk.js` — the default **ink** (fill/stroke) table for each drawn markup
  family on the canvas; a content color registry, not a chrome one.

A file **not** on this list still gets counted by the guard — see "The CI guard" below for what
happens to the real, pre-existing debt outside this list (there is a lot of it; the guard doesn't
pretend otherwise).

## The token layer (exempt from the checks because it *is* the source)

These files **define** the numbers everything else consumes, so a literal hex/radius/font-size in
them is the source of truth, not a violation:

`src/index.css` · `src/shared/ui/moduleAccent.js` · `src/shared/ui/statusTokens.js` ·
`src/shared/brand/tokens.js` · `src/shared/ui/radius.js` · `src/shared/ui/designTokens.js` ·
`src/shared/theme/palette.js` (the JS mirror of the CSS tokens, needed because SVG/canvas
attributes can't use `var()`) · `src/shared/ui/controls.jsx` (the primitive layer itself — see the
literal-duplicate note in the radius section above for why its own three numbers are pinned).

## The CI guard (NEW-2 — `ui-audit/design-drift-audit.mjs`)

Modeled directly on `ui-audit/contrast-audit.mjs`: a pure `auditAll()` scanning every
`src/**/*.{js,jsx}` file (minus the token layer and the drawing-surface list above) for a raw hex
color / `rgb()`/`rgba()` literal, a `borderRadius`/`border-radius` numeric literal outside
`{6, 8, 12, 999}`, or a `fontSize`/`font-size` numeric literal outside the `FONT_SIZE` scale. It
runs through `test/designDrift.test.js` — i.e. inside `npm test`, which is already a required step
of `build.yml` on every PR, exactly like the contrast guard.

**Escape hatch:** an inline `// design-exempt: <reason>` comment on the flagged line. Every
exemption used — both the drawing-surface files and every inline comment — is **printed in the
guard's own output**, so the exempt list stays visible instead of quietly accumulating.

**⛔ Why this is a ratchet, not a zero-tolerance gate, and why that's the honest choice.** A real
sweep at the time this guard was written found **996 raw hex/rgba literals across 81 files**
outside the drawing-surface list — genuine, real chrome debt (dark-themed modals reimplementing a
whole palette instead of using tokens, hardcoded toast/banner colors, a locally-duplicated status
palette). Failing the build on all of it on day one would either (a) never land, or (b) land red
and train everyone to ignore it — the exact failure this item exists to prevent. So the guard reads
a checked-in ceiling (`ui-audit/design-drift-ceiling.json`, the same shape as
`scripts/verification-queue-ceiling.json`) and fails **only if a PR's count exceeds it** — new
drift is blocked from day one; today's debt is inherited honestly and whittled down over time.
Every fix lowers the ceiling in the same commit (regenerate with `--write-ceiling`), the same
discipline the verification-queue guard already established. NEW-3's inventory is the tool for
finding what to fix next; this guard is what stops it from growing while that happens.

### fontSize is gated the same way as hex/radius, and what "role" means for a text scan (B915536's NEW-1)

**An off-scale `fontSize` already fails the build exactly the way a raw hex or raw `borderRadius`
does** — `checkCeiling` runs the identical ratchet check over all three kinds (`hex`/`radius`/
`fontSize`), so this was true before the type-scale reduction and remains true after it; reducing
`FONT_SIZE` from 8 values to 5 did not change the MECHANISM, only the set of values a literal is
checked against (which is why the ceiling jumped — see `ui-audit/design-drift-ceiling.json`'s note).

**What the guard CANNOT do, stated plainly rather than implied: it cannot verify that a control's
size matches its documented ROLE.** `scanFile` is a regex sweep over source text — it has no DOM, no
component tree, and no idea whether a given `fontSize: 12` sits on a section header, a button, or a
stray `<div>`. It can only ever answer **"is this number one of the five legal values"**, never
**"is this the RIGHT one of the five for what this control is."** A session could pick `emphasis`
(13) for a hint line or `label` (10.5) for a primary button label and the guard would stay green —
that mistake is a design-review question, not a mechanically checkable one, the same way no guard in
this repo can tell whether a color is the RIGHT token for its surface, only that it IS a token.

The one axis this repo CAN and does check mechanically, geometrically rather than textually, is
`ui-inventory.mjs`'s **computed-style crawl** (`docs/UI-INVENTORY.md`) — it renders the real app and
reads what actually painted, so it catches the case a text scan structurally cannot: a control that
inherited an off-scale value from nowhere in the source at all (a browser UA default, an unstyled
`<div>`). It still can't judge ROLE either — it flags "off-scale", never "on-scale but the wrong
step" — but it is real evidence a reviewer can act on, which a silent inheritance never was.

## The Scheduler iframe is walled off, and is deliberately out of scope here

`public/sequence/index.html` (the Scheduler / Gantt module) is a separate, self-contained HTML
document with its own inline styles and its own color choices — it is not part of the React tree
this token system covers, ESLint's `.jsx`/`.js` glob never reaches it, and Vite copies it verbatim
as a static asset. It already has its own syntax guard (`ui-audit/stress/check-babel.mjs`, wired
into `build.yml`) for a different failure mode (a babel-transform syntax error). **It is out of
scope for the NEW-2 design-drift guard** — the guard's glob (`src/**/*.{js,jsx}`) does not reach
`public/`, and extending it there is not attempted by this work. If the Scheduler is ever folded
into the shared token system, that is its own, separately-scoped item.

## The `/design` gallery (NEW-4)

A dev-facing route at `#/design` (`src/workspaces/design-gallery/DesignGallery.jsx`, lazy-loaded
exactly like `#/admin` — see `src/app/route.js` / `src/app/Shell.jsx`) renders every primitive
above in every state (default/hover/active/disabled/focus), side by side, with a light/dark
toggle and each specimen labeled with the token names and scale values it consumes. It carries no
header tab and is not in the `WORKSPACES` registry, so it costs nothing on the shipped bundle
until someone navigates to it directly. Use it to compare a new control against the existing set
before writing one — the whole point of hard rule (b) above.

## Where to look next

- `docs/DESIGN-TOKENS.md` — the original B809906 audit numbers (738 buttons, 573 files) and the two
  genuine open judgment calls (the raw `7` radius; the padding/font-size retrofit).
- `docs/UI-INVENTORY.md` (NEW-3) — the generated, computed-style inventory of what's actually
  painting today, regenerated in CI so it can't go stale.
- `src/shared/ui/radius.js`, `src/shared/ui/designTokens.js`, `src/shared/ui/controls.jsx` — read
  their own headers for the full reasoning behind each number; this doc summarizes them, it doesn't
  replace them.
- `src/shared/ui/FloatingNotice.jsx` + `src/shared/ui/bottomSheetTracker.js` — the "Floating
  notifications" primitive above; read their own headers for the stacking/portal mechanics.
