/* Neutral SELECTION CHROME (B569 — NEW-1). ONE visual for both workspaces.
 *
 * A high-contrast, HUE-FREE treatment: a light casing stroke UNDER a dark line, plus solid
 * corner grips. Hue-free on purpose — every colour in the locked palette is already a status
 * or module accent, so a coloured outline would collide or blend (a green outline vanishes on
 * the green parcel). The light-under-dark two-tone stays legible on aerial/satellite backdrops
 * in either theme. Per the design system: solid fills, hierarchy via weight/size, never opacity
 * (the marquee's faint fill is a transient rubber-band tint, not a content surface).
 *
 * Coordinates are SCREEN space ({ x, y, w, h } in px). `casing`/`line` are concrete colours
 * (PAL.selCasing / PAL.selLine — var() does not resolve in SVG presentation attributes).
 *   grips — draw the four solid corner grips (a SELECTED object)
 *   fill  — draw the faint neutral fill tint (the MARQUEE rubber-band box)
 */
import { SEL, cornerGrips } from "./selection.js";

export default function SelectionChrome({ x, y, w, h, casing, line, grips = false, fill = false, rx = 1 }) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  const rect = { x, y, w, h };
  return (
    <g pointerEvents="none">
      {fill && <rect x={x} y={y} width={w} height={h} rx={rx} fill={casing} fillOpacity={0.14} />}
      {/* light casing UNDERNEATH (drawn first / wider) */}
      <rect x={x} y={y} width={w} height={h} rx={rx} fill="none" stroke={casing} strokeWidth={SEL.casingW} />
      {/* dark line ON TOP (thinner) */}
      <rect x={x} y={y} width={w} height={h} rx={rx} fill="none" stroke={line} strokeWidth={SEL.lineW} />
      {grips && cornerGrips(rect).map((g, i) => (
        <rect key={i} x={g.x} y={g.y} width={g.w} height={g.h} fill={line} stroke={casing} strokeWidth={SEL.gripStrokeW} />
      ))}
    </g>
  );
}
