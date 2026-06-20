# Planyr brand assets

Source-of-record for the Planyr logo. Everything visual about the brand mark starts
here; the files the browser actually loads are generated from these.

## The system — one mark, two levels of detail

An isometric stack of three floating tiers (a survey/parcel idea, abstracted):

| File | What it is | Where it's used |
| --- | --- | --- |
| `planyr-favicon.svg` | **Simplified, solid** coral stack on a rounded dark tile | favicon and any small/≤32px use |
| `planyr-mark.svg` | **Full finish** — gridded base · glass middle · wireframe top | app splash, large/display contexts |

**Responsive-logo rule:** small uses get the simplified solid version; large uses get
the full-finish mark. In the app, `BrandMark variant="auto"` applies this automatically
(simplified at ≤32px, full mark above).

## Palette

| Token | Hex | Notes |
| --- | --- | --- |
| coral-base | `#A8482B` | sides `#963F26` / `#823620` |
| coral-mid | `#DC6B42` | sides `#C85F3A` / `#B25431` |
| coral-top | `#F8946A` | sides `#E8825A` / `#D6744E` |
| grid (linework) | `#E89A78` | base grid, on dark |
| glass-edge | `#F0A888` | middle tier edge, on dark |
| wire | `#FBB89A` | top tier wireframe, on dark |
| ink (surface) | `#15171C` | the dark backing tile |
| cream (surface) | `#F4EFE6` | light surface |
| wordmark on dark | `#F4F1E9` | "planyr" on a dark surface |
| wordmark on light | `#2A211C` | "planyr" on a light surface |

These live as code in two mirrored places — keep all three (here + both) in sync:
- `src/index.css` `:root` → CSS custom properties (`--coral-*`, `--brand-*`)
- `src/shared/brand/tokens.js` → the `BRAND` object (for inline-styled components)

## In-app component

`src/shared/brand/BrandMark.jsx` renders the mark inline as SVG (crisp at any size,
theme-aware). Props: `size`, `variant` (`auto` | `favicon` | `mark`), `wordmark`
(horizontal "<mark> planyr" lockup), `surface` (`dark` | `light`), `tile`. The unified
header's logo (`src/shared/ui/AppHeader.jsx`) uses it.

## Regenerating the favicons

`generate-icons.mjs` turns `planyr-favicon.svg` into the raster set the browser/OS need
and copies the SVGs into `public/`. It has **no npm dependency** — it drives the Chromium
the web sandbox already ships (`--screenshot`) and assembles the PNG/ICO by hand.

```sh
node brand/generate-icons.mjs
```

Outputs (committed, served from the site root):
- `public/favicon.svg` — copy of the simplified mark (scalable favicon)
- `public/planyr-mark.svg` — copy of the full-finish display mark
- `public/favicon.ico` — 16/32/48 multi-size (PNG-embedded) legacy favicon
- `public/apple-touch-icon.png` — 180×180 iOS home-screen tile (dark full-bleed)

`index.html` references `favicon.svg` (preferred), `favicon.ico` (fallback), and
`apple-touch-icon.png`. **Favicons cache hard** — after a deploy, hard-refresh to confirm
a tab shows the new icon; a stale open tab is not proof of failure.

Verify the set + the in-app header with `node ui-audit/verify-brand-icons.mjs` (with a
`vite preview` running).
