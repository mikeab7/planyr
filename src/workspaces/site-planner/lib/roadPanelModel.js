/* lib/roadPanelModel.js — the pure words and numbers behind the redesigned ROAD Properties panel
 * (NEW-1, approved mockup "Road Properties Panel Redesign", 2026-10-16). No React, no DOM, so every
 * line the panel prints is unit-testable:
 *   · the header's title + one-line subtitle (length · width · ROW — ROW only when designated),
 *   · the to-scale cross-section strip (the section's bands, or curb · paving · curb for a plain road),
 *   · the strip's one muted caption and each collapsed section's one-line summary.
 * It READS the stored section through `roadCrossSection.js` (the one band model) and never re-derives a
 * width: the caller hands in the road's curb-to-curb width and curb so the strip matches the canvas. */
import { normalizeBands, bandTypeOf, hasXSection, rowWidth, designatedRowFt, BAND_FILL_TOKEN, BAND_FILL_OPACITY } from "./roadCrossSection.js";

const fmt = (n) => Math.round(Number.isFinite(+n) ? +n : 0).toLocaleString("en-US");

/* Paint for the two band kinds that have no entry in BAND_FILL_TOKEN: asphalt (travel / turn lanes —
 * undifferentiated, exactly as on the canvas) and the curb itself. Theme tokens only. */
export const STRIP_ASPHALT = { fill: "var(--text-secondary)", opacity: 0.45 };
export const STRIP_CURB = { fill: "var(--text-primary)", opacity: 0.8 };

export function roadPanelTitle(el) {
  const name = String((el && el.inlineLabel) || "").trim();
  return name || "Road";
}

/* "1,240 ft long · 36 ft wide · 60 ft ROW · locked" — ROW only when a ROW is designated. */
export function roadPanelSubtitle(el, { lengthFt, widthFt }) {
  const parts = [`${fmt(lengthFt)} ft long`, `${fmt(widthFt)} ft wide`];
  const row = designatedRowFt(el && el.xsection);
  if (row != null) parts.push(`${fmt(row)} ft ROW`);
  if (el && el.locked) parts.push("locked");
  return parts.join(" · ");
}

/* The strip's bands, left → right, each { key, type, w, fill, opacity } with `w` in feet — the strip is
 * drawn with flex-grow = w so it is to scale. A designed section is exactly what is stored; a plain road
 * is curb · paving · curb. */
export function xsStripBands(el, { travelFt, curbFt }) {
  if (hasXSection(el)) {
    return normalizeBands(el.xsection.bands).map((b, i) => {
      const t = b.type;
      const asphalt = t === "travel" || t === "turnLane";
      return {
        key: `${i}-${t}`, type: t, w: b.w,
        fill: asphalt ? STRIP_ASPHALT.fill : (BAND_FILL_TOKEN[t] || STRIP_ASPHALT.fill),
        opacity: asphalt ? STRIP_ASPHALT.opacity : (BAND_FILL_OPACITY[t] ?? 0.3),
      };
    });
  }
  const c = Math.max(0.5, +curbFt || 0.5);
  const w = Math.max(1, +travelFt || 1);
  return [
    { key: "curb-l", type: "curb", w: c, fill: STRIP_CURB.fill, opacity: STRIP_CURB.opacity },
    { key: "paving", type: "paving", w, fill: STRIP_ASPHALT.fill, opacity: STRIP_ASPHALT.opacity },
    { key: "curb-r", type: "curb", w: c, fill: STRIP_CURB.fill, opacity: STRIP_CURB.opacity },
  ];
}

const SHORT = { turnLane: "turn lane", median: "median", shoulder: "shoulder", curbGutter: "curb", parking: "parking", bike: "bike lane", sidewalk: "walk", parkway: "parkway", ditch: "swale" };

/* "Walk · 2 lanes · median · 2 lanes · walk" for a designed section (runs of one kind merge, travel
 * lanes are counted); "Curb face to curb face, 36 ft" for a plain road. */
export function xsCaption(el, { travelFt }) {
  if (!hasXSection(el)) return `Curb face to curb face, ${fmt(travelFt)} ft`;
  const runs = [];
  for (const b of normalizeBands(el.xsection.bands)) {
    const last = runs[runs.length - 1];
    if (last && last.type === b.type) last.n += 1; else runs.push({ type: b.type, n: 1 });
  }
  const words = runs.map((r) => (r.type === "travel" ? `${r.n} ${r.n === 1 ? "lane" : "lanes"}` : r.n > 1 ? `${r.n} ${SHORT[r.type] || bandTypeOf(r.type).label.toLowerCase()}s` : (SHORT[r.type] || bandTypeOf(r.type).label.toLowerCase())));
  const s = words.join(" · ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* The collapsed CROSS-SECTION header's value. */
export function xsSummary(el) {
  if (!hasXSection(el)) return "Plain road";
  const n = normalizeBands(el.xsection.bands).length;
  return `${n} bands · ${fmt(rowWidth(el.xsection))} ft`;
}

/* The collapsed LABEL header's value: the name, or "None". */
export function labelSummary(el) {
  const name = String((el && el.inlineLabel) || "").trim();
  return name || "None";
}

/* The cross-section button's wording follows whether a REAL section is stored (keep today's rule). */
export function xsButtonLabel(el) {
  return hasXSection(el) ? "Edit cross-section" : "Design cross-section";
}
