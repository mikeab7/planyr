/* BrandMark — the Planyr coral mark, rendered inline as SVG so it stays crisp at
 * any size and theme-aware (the wordmark colour flips with the surface behind it).
 *
 * One mark, two levels of detail (the responsive-logo rule):
 *   variant="favicon" — simplified SOLID coral stack (small use / favicon parity)
 *   variant="mark"    — full finish: gridded base · glass middle · wireframe top
 *   variant="auto"    — favicon at <=32px, the full mark above it (default)
 *
 * Props
 *   size      px — width & height of the mark glyph (default 28)
 *   variant   "auto" | "favicon" | "mark"
 *   wordmark  bool — render the horizontal "<mark> planyr" lockup
 *   surface   "dark" | "light" — picks the wordmark colour
 *   tile      bool — draw the rounded dark backing tile (default true)
 *   title     a11y label (default "Planyr")
 *
 * Geometry mirrors brand/planyr-favicon.svg + brand/planyr-mark.svg — the canonical
 * source of record, and what the raster favicons are generated from. If the artwork
 * changes, update those SVGs, re-run brand/generate-icons.mjs, and update this glyph.
 */
import { BRAND } from "./tokens.js";

const C = BRAND.coral;

// The three isometric tiers (viewBox 0 0 100 100): top face + two side faces.
const TIERS = {
  base: { face: "50,60 70,68 50,76 30,68", sideL: "30,68 50,76 50,79 30,71", sideR: "50,76 70,68 70,71 50,79", c: C.base },
  mid:  { face: "50,39 70,47 50,55 30,47", sideL: "30,47 50,55 50,58 30,50", sideR: "50,55 70,47 70,50 50,58", c: C.mid },
  top:  { face: "50,18 70,26 50,34 30,26", sideL: "30,26 50,34 50,37 30,29", sideR: "50,34 70,26 70,29 50,37", c: C.top },
};

function SolidTier({ t }) {
  return (
    <>
      <polygon points={t.face} fill={t.c.face} />
      <polygon points={t.sideL} fill={t.c.sideL} />
      <polygon points={t.sideR} fill={t.c.sideR} />
    </>
  );
}

// Full-finish glyph: solid+gridded base, half-glass middle, wireframe top.
function FullGlyph() {
  const { grid, glassEdge, wire } = BRAND.line;
  return (
    <>
      <SolidTier t={TIERS.base} />
      <g stroke={grid} strokeWidth="0.6">
        <line x1="36.7" y1="70.7" x2="56.7" y2="62.7" />
        <line x1="43.3" y1="73.3" x2="63.3" y2="65.3" />
        <line x1="36.7" y1="65.3" x2="56.7" y2="73.3" />
        <line x1="43.3" y1="62.7" x2="63.3" y2="70.7" />
      </g>
      <g fillOpacity="0.5">
        <polygon points={TIERS.mid.face} fill={C.mid.face} />
        <polygon points={TIERS.mid.sideL} fill={C.mid.sideL} />
        <polygon points={TIERS.mid.sideR} fill={C.mid.sideR} />
      </g>
      <polygon points={TIERS.mid.face} fill="none" stroke={glassEdge} strokeWidth="1" />
      <path d="M30,47 V50 M50,55 V58 M70,47 V50 M30,50 L50,58 L70,50" fill="none" stroke={glassEdge} strokeWidth="0.8" />
      <polygon points={TIERS.top.face} fill="none" stroke={wire} strokeWidth="1.4" />
      <path d="M30,26 V29 M50,34 V37 M70,26 V29 M30,29 L50,37 L70,29" fill="none" stroke={wire} strokeWidth="1.4" />
    </>
  );
}

function SolidGlyph() {
  return (
    <>
      <SolidTier t={TIERS.base} />
      <SolidTier t={TIERS.mid} />
      <SolidTier t={TIERS.top} />
    </>
  );
}

export default function BrandMark({
  size = 28,
  variant = "auto",
  wordmark = false,
  surface = "dark",
  tile = true,
  title = "Planyr",
  style,
  ...rest
}) {
  const v = variant === "auto" ? (size <= 32 ? "favicon" : "mark") : variant;
  const glyph = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={title}
      style={{ display: "block", flex: "none" }}
    >
      <title>{title}</title>
      {tile && <rect width="100" height="100" rx="22" fill={BRAND.surface.ink} />}
      {v === "mark" ? <FullGlyph /> : <SolidGlyph />}
    </svg>
  );

  if (!wordmark) {
    return (
      <span style={{ display: "inline-flex", lineHeight: 0, ...style }} {...rest}>
        {glyph}
      </span>
    );
  }

  const wordColor = surface === "light" ? BRAND.wordmark.onLight : BRAND.wordmark.onDark;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.34), ...style }} {...rest}>
      {glyph}
      <span style={{ fontWeight: 800, fontSize: Math.round(size * 7.4) / 10, color: wordColor, letterSpacing: "-0.01em", lineHeight: 1 }}>
        planyr
      </span>
    </span>
  );
}
