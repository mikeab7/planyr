/* lib/roadCrossSection.js — a road's cross-section: an ORDERED LIST OF TYPED BANDS measured across
 * the centerline (NEW-1, chat brief 2026-08-26 — "I want to draw a road properly... 12 foot lane,
 * 12 foot lane, 20' median, 12' lane, 12' lane").
 *
 * AUDIT FIRST turned up nothing to reconcile: a road element carries `travelW` (pavement, curb face
 * to curb face), `curb` (the 6" curb added outside it), `roadClass` and `vtx` (per-vertex corner
 * treatment) — see `lib/roadGeometry.js` / `lib/roadClasses.js`. There is NO existing `lanes` or
 * `median`/`medianFt` field on a road anywhere in this codebase; the only `medianFt` in the repo is
 * an unrelated STATISTICAL median of ground elevation used by the flood-WSE sanity check
 * (`lib/estimateChallenge.js`). So this is greenfield — no parallel model to avoid, nothing to
 * migrate away from. What this module DOES extend is `travelW`: when a road carries a cross-section,
 * `travelW` is kept, literally, as the sum of the section's WITHIN-CURB band widths, so every
 * existing consumer (`roadStripRing`, `roadCurbLines`, the dissolved-network junction math, the
 * impervious-area rollup) keeps reading `el.travelW` unchanged and needs no edits at all. A road with
 * no `xsection` (every road drawn before this shipped) is simply the single-band case — see
 * `xsectionFromRoad`. That is the whole migration story: absence of the field IS the legacy state.
 *
 * A band is `{ type, w }` — `type` one of BAND_TYPES' keys, `w` a width in feet. Two derived widths
 * matter, and they are NOT the same number:
 *   • curb-to-curb (`curbToCurbWidth`) — every WITHIN-CURB band's width summed. This is what the
 *     existing curb/pavement/junction geometry means by "travelW": the whole paved corridor between
 *     the two curb lines, INCLUDING a grass or painted median (a median sits between the curbs, even
 *     when it isn't asphalt — the curbs bound the divided cross-section, not the driving surface).
 *   • paved / asphalt (`pavedWidth`) — only the band types that are actually driven on. A median is
 *     explicitly excluded (it is landscaped or painted, not asphalt), matching how the app already
 *     treats a curb-and-gutter's concrete pan as separate from the asphalt paving figure
 *     (`lib/costTakeoff.js`'s DEFAULT_PAN_WIDTH trim — the same "not all of the curb-to-curb width is
 *     asphalt" idea, generalised).
 * Sidewalk / parkway-landscape-strip / ditch-swale bands are OUTSIDE the curb line (`withinCurb:
 * false`) — they extend the right-of-way (`rowWidth`) but never widen the curb-to-curb pavement a
 * junction dissolves or a detention calc treats as impervious.
 *
 * `bandLayout` turns a section into offsets from the CENTERLINE using the same sign convention
 * `roadCurbLines` already uses (±travelW/2 = the two face-of-curb lines): the within-curb run is
 * centered on the road's stored centerline exactly as it always was, so adding a cross-section to an
 * existing road never shifts the drawn alignment. Any flank bands (sidewalk/parkway/ditch) extend the
 * assembly further out from there, in list order.
 *
 * Pure (no React, no canvas) — unit-tested in test/roadCrossSection.test.js. */

// key            label                              default ft  paved?  within the curb line?
export const BAND_TYPES = [
  { key: "travel",     label: "Travel lane",               defaultFt: 12, paved: true,  withinCurb: true },
  { key: "turnLane",   label: "Centre turn lane",          defaultFt: 12, paved: true,  withinCurb: true },
  { key: "median",     label: "Median",                    defaultFt: 16, paved: false, withinCurb: true },
  { key: "shoulder",   label: "Shoulder",                  defaultFt: 8,  paved: true,  withinCurb: true },
  { key: "curbGutter", label: "Curb & gutter",             defaultFt: 2,  paved: false, withinCurb: true },
  { key: "parking",    label: "Parking lane",              defaultFt: 8,  paved: true,  withinCurb: true },
  { key: "bike",       label: "Bike lane",                 defaultFt: 5,  paved: true,  withinCurb: true },
  { key: "sidewalk",   label: "Sidewalk",                  defaultFt: 5,  paved: false, withinCurb: false },
  { key: "parkway",    label: "Parkway / landscape strip", defaultFt: 6,  paved: false, withinCurb: false },
  { key: "ditch",      label: "Ditch / swale",             defaultFt: 10, paved: false, withinCurb: false },
];
export const BAND_TYPE_BY_KEY = Object.fromEntries(BAND_TYPES.map((t) => [t.key, t]));
export const DEFAULT_BAND_TYPE = "travel";

// A schematic fill token per type — reused named theme tokens (never raw hex), the same idiom
// PondSection.jsx already uses for a diagram that isn't literally "this token's usual meaning".
// Travel/turn-lane bands deliberately carry NO distinct fill: undifferentiated asphalt, same as
// every road today, cued instead by lane striping (bandStripeMarks) — matching how a real cross
// section reads (a turn lane is asphalt with yellow hatching, not a different-colored surface).
export const BAND_FILL_TOKEN = {
  median: "var(--success-text)",
  shoulder: "var(--text-tertiary)",
  curbGutter: "var(--text-secondary)",
  parking: "var(--info-text)",
  bike: "var(--accent-library-text)",
  sidewalk: "var(--text-tertiary)",
  parkway: "var(--success-text)",
  ditch: "var(--info-text)",
};
export const BAND_FILL_OPACITY = {
  median: 0.22, shoulder: 0.28, curbGutter: 0.35, parking: 0.14, bike: 0.2,
  sidewalk: 0.22, parkway: 0.22, ditch: 0.18,
};

export function bandTypeOf(key) { return BAND_TYPE_BY_KEY[key] || BAND_TYPE_BY_KEY[DEFAULT_BAND_TYPE]; }

// The floor a band width is clamped to AT COMMIT (never while typing) — matches the dialog's
// pre-existing `Math.max(0.1, …)` clamp; named here so the dialog and its tests share one number.
export const MIN_BAND_WIDTH_FT = 0.1;

/* NEW-1 follow-up (owner report, 2026-08-26 — "when I type two it seems to bug out … I'm just
 * typing 2 to get to 25"): A PREFIX OF A VALID NUMBER IS NOT AN ERROR. RoadCrossSectionDialog's
 * band-width field calls this at COMMIT time only (blur / Enter — never on keystroke) to decide
 * whether a draft string is a real, final width. Returns the parsed number, or `null` for every
 * legitimate mid-typing state — an empty field, a lone ".", "0" on its way to "0.5", a trailing
 * "12." on its way to "12.5", a leading zero like "08" (which parses fine — that branch is real,
 * not an example of returning null), or pasted text that isn't a plain decimal yet — so the caller
 * leaves committed state, and therefore the live preview, untouched rather than ever treating one
 * of these as an error. The caller clamps the MIN_BAND_WIDTH_FT floor only at commit, never here. */
export function parseWidthDraft(text) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (t === "" || !/^\d*\.?\d*$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* A band list from anything (a raw preset, a stored xsection, user input) → a clean array of
 * { type, w }. Unknown type → DEFAULT_BAND_TYPE; missing/invalid width → that type's default. */
export function normalizeBands(bands) {
  const out = [];
  for (const b of Array.isArray(bands) ? bands : []) {
    if (!b) continue;
    const type = BAND_TYPE_BY_KEY[b.type] ? b.type : DEFAULT_BAND_TYPE;
    const w = Number.isFinite(+b.w) && +b.w > 0 ? +b.w : bandTypeOf(type).defaultFt;
    out.push({ type, w });
  }
  return out;
}

/* NEW-1 — `rowDesignFt` is optional and deliberately OMITTED (never written as null/undefined) when
 * not a real, positive number: presence of the key is the "has this road's ROW been designated"
 * signal every caller (the dialog, the canvas, the Properties panel) reads via `designatedRowFt`. */
export function makeXSection(bands, rowDesignFt) {
  const x = { bands: normalizeBands(bands) };
  const r = designatedRowFt({ rowDesignFt });
  if (r != null) x.rowDesignFt = r;
  return x;
}

/* A road's cross-section for the dialog to open with: its OWN stored xsection if it has one
 * (rowDesignFt carried through unchanged, so re-opening the dialog on an already-designated road
 * doesn't silently drop it), otherwise a single travel-lane band matching its current travelW (or
 * 24' if it has none yet) — never a stored migration, since (per the header above) there is nothing
 * to migrate FROM. */
export function xsectionFromRoad(el) {
  if (el && el.xsection && Array.isArray(el.xsection.bands) && el.xsection.bands.length) {
    return makeXSection(el.xsection.bands, el.xsection.rowDesignFt);
  }
  const w = Number.isFinite(+(el && el.travelW)) && +el.travelW > 0 ? +el.travelW : 24;
  return makeXSection([{ type: "travel", w }]);
}

/* Whether a road element carries a REAL, multi-band designed section — as opposed to no xsection at
 * all, or the dialog's own single-band wrapper (xsectionFromRoad). This is the ONE gate every
 * consumer (the Properties panel, the cost rollup, the canvas renderer) uses to decide "does this
 * road's width now mean a designed cross-section, or is it still the plain single number it always
 * was" — kept here, not as a component-local helper, because `renderElPx` (the canvas paint
 * function) is a MODULE-LEVEL function outside the planner component's closure and needs it too. */
export function hasXSection(el) {
  return !!(el && el.xsection && Array.isArray(el.xsection.bands) && el.xsection.bands.length > 1);
}

export function curbToCurbWidth(xsection) {
  return normalizeBands(xsection && xsection.bands).reduce((s, b) => s + (bandTypeOf(b.type).withinCurb ? b.w : 0), 0);
}
export function pavedWidth(xsection) {
  return normalizeBands(xsection && xsection.bands).reduce((s, b) => s + (bandTypeOf(b.type).paved ? b.w : 0), 0);
}
export function rowWidth(xsection) {
  return normalizeBands(xsection && xsection.bands).reduce((s, b) => s + b.w, 0);
}

/* NEW-1 (owner report, 2026-08-26 — "id like to designate the ROW to like a 100' row should be
 * shown") — a DESIGNATED right-of-way, distinct from `rowWidth` above, which only ever DERIVES the
 * modeled-band total. A real ROW is a legal dedication, normally WIDER than every band the section
 * models, with the remainder an undesignated margin either side (a legal setback strip beyond the
 * last modeled band — outside even an explicit parkway/sidewalk/ditch). Stored as
 * `xsection.rowDesignFt`, deliberately not named `rowW`/`rowWidth`/anything close: `rowW` already
 * names an unrelated TABLE ROW WIDTH in AppHeader, and `rowWidth()` above is the DERIVED band-total
 * function — a name near either would read as the same concept and isn't.
 *
 * PRESENCE IS THE SIGNAL, not a numeric comparison against the band total: a road with no
 * `rowDesignFt` at all has never had a ROW designated, and callers (the dialog, the canvas, the
 * Properties panel) all gate on `designatedRowFt(...) != null` — never on "does it differ from the
 * band total" — so a designated ROW that happens to exactly match the modeled bands (a real, valid
 * case: every foot of the legal ROW is accounted for by drawn bands) still reads as designated. */
export function designatedRowFt(xsection) {
  const v = xsection && +xsection.rowDesignFt;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/* The undesignated margin PER SIDE, beyond every modeled band — split evenly, per the brief's own
 * "(Y-X)/2 each side". X here is the FULL modeled band total (`rowWidth`, which already includes any
 * explicit outside-curb sidewalk/parkway/ditch band), not the curb-to-curb width alone: an explicit
 * parkway band is already accounted-for ROW, not "margin", so double-counting it as margin ON TOP of
 * its own modeled width would overstate the true undesignated strip. This is also why the dialog's
 * ROW field defaults to the band total — an untouched default then reads as zero margin, not some
 * mystery leftover.
 *
 * Returns `null` (never a negative number) when the section is not designated, OR when the modeled
 * band total already EXCEEDS the designated ROW — that invalid state is surfaced as a loud warning
 * by the caller (never silently clamped), and `null` here is what keeps the canvas from drawing a
 * ROW boundary that would sit INSIDE the paved section. */
export function rowMarginFt(xsection) {
  const designated = designatedRowFt(xsection);
  if (designated == null) return null;
  const modeled = rowWidth(xsection);
  if (modeled > designated) return null;
  return (designated - modeled) / 2;
}

/* Pavement area from a paved width + a centerline length — mirrors costTakeoff's SF_PER_SY. */
export const XSEC_SF_PER_SY = 9;
export function pavementArea(xsection, lengthFt) {
  const L = Math.max(0, +lengthFt || 0);
  const sf = pavedWidth(xsection) * L;
  return { sf, sy: sf / XSEC_SF_PER_SY };
}

/* Offsets from the CENTERLINE for every band's near/far edge, in list order, using the SAME sign
 * convention roadCurbLines already uses (offsetPolyline's "+" = the left normal; ±travelW/2 = the
 * two face-of-curb lines). The within-curb run's own centerline is exactly the road's stored
 * centerline — a flank band (sidewalk/parkway/ditch) before the first within-curb band pushes the
 * LEFT edge further out; one after the last within-curb band extends the RIGHT edge. Offset 0 is
 * therefore always the road's real drawn centerline, regardless of how many flank bands exist —
 * which is what lets bandStripeMarks find "the seam nearest the centerline" without special-casing.
 * Returns { edges:[{index,band,from,to}], curbToCurb, rowW }. `from > to` for every edge (from = the
 * "left"/near-positive side, to = the "right"/far side, matching the walk direction). */
export function bandLayout(xsection) {
  const bands = normalizeBands(xsection && xsection.bands);
  const c2c = curbToCurbWidth(xsection);
  const firstInIdx = bands.findIndex((b) => bandTypeOf(b.type).withinCurb);
  const preFlank = firstInIdx < 0 ? 0 : bands.slice(0, firstInIdx).reduce((s, b) => s + b.w, 0);
  let off = firstInIdx < 0 ? rowWidth(xsection) / 2 : c2c / 2 + preFlank;
  const edges = bands.map((b, index) => { const e = { index, band: b, from: off, to: off - b.w }; off -= b.w; return e; });
  return { edges, curbToCurb: c2c, rowW: rowWidth(xsection) };
}

/* Lane-marking seams between adjacent WITHIN-CURB bands — a deliberately simplified striping
 * convention for visual clarity (this is a site-planning screening tool, not a striping plan):
 *   • either side of a median or a centre turn lane → solid yellow (the opposing-flow edge)
 *   • two adjacent travel lanes with a median/turn-lane anywhere in the section → dashed white
 *     (both are the same direction of travel, separated only by a lane line)
 *   • two adjacent travel lanes with NO median/turn-lane anywhere (a fully undivided road) → the ONE
 *     seam nearest the road's real centerline (offset 0) is double solid yellow (the opposing-flow
 *     split); every other travel/travel seam is dashed white
 *   • the edge of a shoulder / parking lane / bike lane → solid white
 * Returns [{ atOffset, style }], style one of "yellow-solid" | "white-dash" | "yellow-double" |
 * "white-solid", in section order. */
export function bandStripeMarks(xsection) {
  const { edges } = bandLayout(xsection);
  const within = edges.filter((e) => bandTypeOf(e.band.type).withinCurb);
  if (within.length < 2) return [];
  const hasSplit = within.some((e) => e.band.type === "median" || e.band.type === "turnLane");
  const seams = [];
  for (let i = 0; i < within.length - 1; i++) {
    const a = within[i], b = within[i + 1];
    const atOffset = a.to; // == b.from
    let style;
    if (a.band.type === "median" || b.band.type === "median" || a.band.type === "turnLane" || b.band.type === "turnLane") {
      style = "yellow-solid";
    } else if (a.band.type === "travel" && b.band.type === "travel") {
      style = "white-dash"; // resolved to yellow-double below for the undivided case's center seam
    } else {
      style = "white-solid";
    }
    seams.push({ atOffset, style, i });
  }
  if (!hasSplit) {
    let centerI = -1, centerD = Infinity;
    seams.forEach((s, i) => { if (s.style === "white-dash") { const d = Math.abs(s.atOffset); if (d < centerD) { centerD = d; centerI = i; } } });
    if (centerI >= 0) seams[centerI].style = "yellow-double";
  }
  return seams.map(({ atOffset, style }) => ({ atOffset, style }));
}

// A handful of sensible built-ins so the dialog is useful the first time it opens — one matches the
// owner's own worked example verbatim (12/12/20-median/12/12).
export const BUILT_IN_XSECTION_PRESETS = [
  { id: "builtin-2lane", name: "2-lane local road", builtin: true, bands: [{ type: "travel", w: 12 }, { type: "travel", w: 12 }] },
  { id: "builtin-2lane-turn", name: "2-lane with centre turn lane", builtin: true, bands: [{ type: "travel", w: 12 }, { type: "turnLane", w: 12 }, { type: "travel", w: 12 }] },
  { id: "builtin-4lane-divided", name: "4-lane divided boulevard", builtin: true, bands: [{ type: "travel", w: 12 }, { type: "travel", w: 12 }, { type: "median", w: 20 }, { type: "travel", w: 12 }, { type: "travel", w: 12 }] },
  { id: "builtin-private-drive", name: "Private drive", builtin: true, bands: [{ type: "travel", w: 24 }] },
];
