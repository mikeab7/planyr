# Design tokens — the "design bible" (B809906, 2026-08-27)

Owner: *"shouldn't we have some sort of bible for design definitions, we keep having different
radii on buttons and it seems like a design bible would fix this."* This doc is that reference,
plus the audit that backs it. Read `src/shared/ui/radius.js` and `src/shared/ui/designTokens.js`
for the actual token values — this file explains what they're for and what they replace.

## The audit (before touching anything)

An exhaustive scan of every `<button>` element in the app — **738 buttons, 573 files** — found:

| Property | Distinct raw values found on `<button>` alone |
|---|---|
| `borderRadius` | 22 (incl. already-tokenized) |
| `height` | 17 |
| `fontSize` | 15 |
| `padding` | 94 |

The radius spread, which is what the owner named: `7` (×43, the single most common value with no
token), `6` (×34), `8` (×33), `999` (×27, "pill"), `10` (×9), `5` (×6), `99` (×5, **a *second*,
narrower "pill" value — a real inconsistency, not just a style choice: 99px fails to fully round a
button taller than 99px, 999px never does**), plus `4`, `9`, `3`, `2`, `14`, `20` at 1-3 sites each.
Height and font-size are similarly fragmented (full numbers in this doc's history / the item's
own audit output) — see "What's still open" below.

## The four token categories

1. **Border radius** — `src/shared/ui/radius.js` → `RADIUS = { pill: 999, sm: 6, md: 8, lg: 12 }`.
   **This already existed** (B427411, 2026-08-06) — a prior owner report of this exact symptom.
   CSS mirror: `--radius-*` in `src/index.css`. `nestedIn(outer, gap)` computes the concentric
   radius for a control nested inside another rounded surface.
2. **Spacing** — `src/shared/ui/designTokens.js` → `SPACE = { xxs:2, xs:4, sm:6, md:8, lg:10,
   xl:12, xxl:16 }`. CSS mirror: `--space-*`.
3. **Type scale** — same file → `FONT_SIZE = { xs:10, sm:10.5, base:11, md:11.5, lg:12, xl:12.5,
   xxl:13, display:14 }`. CSS mirror: `--font-*`. Deliberately six-plus steps, not force-collapsed
   to three or four — see "What's still open."
4. **Control heights** — same file → `CONTROL_H = { sm:22, md:26, lg:30 }`. CSS mirror:
   `--control-h-*`. These already split into three clean, well-separated real tiers, unlike
   padding/font-size — no judgement call needed here.

Every number above is **the tree's own dominant value, promoted** — never invented. That's the
same rule `radius.js`'s own header states, extended to the three categories it never covered.

There's also `src/shared/ui/controls.jsx`'s own `RADIUS = { control: 8, pill: 999, panel: 12 }` +
`PAD` + `FONT` — a **partial**, pre-existing scale that predates `radius.js` and agrees with it by
value (`control === md`, `panel === lg`). It stays as its own literal copy on purpose: seven Notes
components mirror it locally too, and `test/notesModule.test.js` regex-parses the digits out of
that exact line — replacing the numbers with an import breaks that build-time contract. Full
reasoning in `controls.jsx`'s own header comment.

## What shipped this session (mechanical, zero visual change)

Per the brief's own instruction — *"apply the tokens mechanically to buttons only, choosing
values that match what's already most common so the app does not visually change"* — every
`<button>` whose **literal** `borderRadius` exactly equalled an existing token's pixel value was
repointed at the token instead of the raw number. Same pixel value either way; the only change is
that it can no longer drift independently of the other buttons that share that value:

- `999` / `99` → `RADIUS.pill` (also closes the real 99-vs-999 pill inconsistency above)
- `8` → `RADIUS.md`
- `6` → `RADIUS.sm`
- `12` → `RADIUS.lg`

Applied across 22 files (Notes' seven components already used their own tokenized mirror and
needed nothing). `RADIUS` newly imported from `shared/ui/radius.js` in files that had no radius
token at all yet.

## What's still open — genuine judgement calls, not decided here

Two things the audit surfaced that are real product decisions, not mechanical dedup, per this
item's own instruction to stop and ask rather than silently pick:

1. **The `7` radius.** It's the single most common *raw* button radius (43 sites) and sits exactly
   between `RADIUS.sm` (6) and `RADIUS.md` (8) — nudging it either way is a real, if small (1px),
   visual change across 43 buttons. Options: (a) leave `7` alone as a legitimate fifth scale step
   the tree has actually converged on, (b) fold it into `sm` or `md` and accept the 1px nudge, or
   (c) audit those 43 sites individually to see whether they're all genuinely the same kind of
   control (in which case (b) is easy to justify) or a mix (in which case they need different
   answers). Not decided here.
2. **Padding and font-size.** 94 distinct padding strings and a 15-step font-size ladder are real,
   but collapsing them onto the new `SPACE`/`FONT_SIZE` scales retroactively would touch visual
   proportions on a large fraction of the app's buttons — a scope the owner explicitly ruled out
   this session ("do NOT redesign anything"). The scales exist now as the target for **new** work;
   retrofitting old call sites is a separate, larger, deliberately-scoped follow-up.

## Using the tokens in new code

```js
import { RADIUS } from "src/shared/ui/radius.js";
import { SPACE, FONT_SIZE, CONTROL_H } from "src/shared/ui/designTokens.js";

<button style={{
  borderRadius: RADIUS.md,
  padding: `${SPACE.sm}px ${SPACE.xl}px`,
  fontSize: FONT_SIZE.lg,
  height: CONTROL_H.md,
}}>
```

Or reach for the ready-made `Button` / `ToggleChip` / `IconButton` components in
`src/shared/ui/controls.jsx`, which already wire the radius/padding/font scale together — the
right choice for anything that doesn't need bespoke styling.
