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

**The resolution is not reclassifying either control.** A pill genuinely is the right shape for a
compound identity chip, and `md` genuinely is the right shape for a lone icon button — collapsing
that distinction to make two unrelated controls match would be worse than the mismatch it fixes (see
`controls.jsx`'s own `IconButton` primitive, which is `md` by design). **The binding rule instead:**

- **Two different radius families may sit in the same control row, but only with a visible boundary
  between them** — a divider, or genuine clear space (`docs/DESIGN.md`'s own reading of "gap" here is
  a real gap, not the small `SPACE.sm`/`SPACE.md` a same-family row uses between its own members).
  Flush adjacency (the app's ordinary flex `gap`, 6–8px, with nothing else between) is never
  acceptable between two families, however individually correct each one is.
- **The fix for the account-chip/fullscreen pair is a hairline divider** — `AppHeader.jsx`'s row-1
  right zone now inserts the same `1px` divider this header already uses between the wordmark and the
  breadcrumb, between the icon-button cluster (save badge, fullscreen, gear — all `md`) and the
  identity pill. This is the general pattern: a cluster boundary is drawn where a family boundary
  falls, not invented per pair.

**Machine-enforced:** `ui-audit/ui-inventory.mjs`'s `siblingMismatches()` groups the same on-scale
rounded-candidate pool `nestingMismatches()` builds by shared flex-row ancestor (not bare immediate
parent — a wrapped-one-level-deeper sibling, e.g. a popover-anchor `<div>`, must still be caught),
walks adjacent pairs left-to-right, and flags a pair whose families differ and whose gap reads as
flush. Findings print in `docs/UI-INVENTORY.md`'s "Sibling radius mismatches" section. It found a
second, independently pre-existing instance the owner never reported — the header's plan-name chip
had drifted to `RADIUS.sm` after the adjacent project-breadcrumb chip moved `sm`→`md`, silently
breaking that chip's own comment claiming they matched — fixed the same way this item shipped
(`SitePlanner.jsx`'s plan-name chip is `RADIUS.md` again).

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

## Spacing, type, and control-height scales (`src/shared/ui/designTokens.js`)

```js
export const SPACE      = { xxs: 2, xs: 4, sm: 6, md: 8, lg: 10, xl: 12, xxl: 16 };
export const FONT_SIZE  = { xs: 10, sm: 10.5, base: 11, md: 11.5, lg: 12, xl: 12.5, xxl: 13, display: 14 };
export const CONTROL_H  = { sm: 22, md: 26, lg: 30 };
```

CSS mirrors: `--space-*`, `--font-*`, `--control-h-*` in `index.css`. Every number is **the tree's
own dominant value, promoted** from a 738-button audit (B809906) — never invented. `FONT_SIZE`
deliberately keeps six-plus steps rather than force-collapsing to three or four (10/10.5/11 are
each real, separately-used values); collapsing them is a retrofit decision explicitly **not**
made yet (see `docs/DESIGN-TOKENS.md` for the full audit numbers and the open padding question).

`controls.jsx`'s own `PAD` / `FONT` constants are a **convenience layer built from the same
numbers**, not a competing scale:

```js
export const PAD  = { sm: "5px 10px", md: "7px 12px", lg: "9px 14px" };
export const FONT = { sm: 11.5, md: 12.5 };   // FONT.sm === FONT_SIZE.md, FONT.md === FONT_SIZE.xl
```

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
| **`Button`** (`variant`: primary/ghost/danger, `size`: sm/md/lg) | `RADIUS.control` (8) | `PAD[size]` | `FONT.sm` (11.5) at `size="sm"`, else `FONT.md` (12.5), weight 600 | `disabled` → `opacity: 0.5`. `active` renders a ghost as filled (a pressed toggle). `danger` (not active) → `--danger-text` border/text on `--surface-raised`. Rest shadow: a fixed neutral `0 1px 2px rgba(0,0,0,.05)` (token-independent by design — kills the old colored "ember" shadow bug). Hover/focus are inherited from the shared browser default plus the app's global keyboard-focus-ring rule; no per-component override. |
| **`ToggleChip`** (`active`) | `RADIUS.pill` (999) | `6px 11px` | `FONT.sm` (11.5), weight 650 active / 500 rest | `active` → filled with `accent`/`onAccent`, border = accent. Rest → `--surface-raised` / `--border-default` / `--text-primary`. |
| **`IconButton`** (`size` px, default 30, `active`) | `RADIUS.control` (8) | square `size × size`, zero padding, centered content | n/a (icon slot) | Same active/rest fill logic as `Button`. |
| **`Field`** | n/a (row, not a control) | `gap: 10`, `marginBottom: 8` | label `12px` / `--text-secondary` | A label + control row layout only — no interactive state of its own. |
| **`Section`** (collapsible group) | `RADIUS.panel` (12) | header `10px 12px`, body `0 12px 12px` | title `10.5px`/700/`0.09em` uppercase `--text-secondary` | `open`/`collapsed` (▶ rotates 90°, `.18s ease`). Keyboard: `role="button"` + `tabIndex={0}` + Enter/Space toggles, `aria-expanded` published. |
| **`MenuItem`** (flyout row, `active`) | `RADIUS.control` (8) | `7px 10px` | `FONT.md` (12.5), weight 650 active / 500 rest | `active` → `--hover-menu` background. Sits inside `menuPanelStyle` (`RADIUS.panel`, `--surface-raised`, `--border-default`, a two-layer drop shadow, `padding: 6`). |

See the live `/design` gallery (NEW-4) for every one of these rendered in every state, both
themes, side by side — use it to eyeball a new control against the existing set before writing one.

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
