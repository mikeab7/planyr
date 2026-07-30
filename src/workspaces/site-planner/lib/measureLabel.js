/* How a measurement PRESENTS its numbers (NEW-3).
 *
 * WHAT WAS WRONG. An area measurement printed one run-on line —
 *     250,000 sf · 5.74 ac · 2,100′ perim
 * — three unrelated quantities at identical weight, painted as raw haloed text over aerial
 * photography. Nothing was dominant; both area units competed at equal weight when only one
 * matters at any given scale; an abbreviation ("perim") carried the same emphasis as the
 * headline number; and haloed text on imagery is the least legible option available.
 *
 * WHAT THIS BUILDS. One dominant value with the detail subordinate:
 *     line 1  headline   large tabular figures — the ONE number that matters
 *     line 2  detail     small muted text — the other unit and the perimeter
 * plus a name line above when the user has typed an inline label. The headline UNIT is chosen
 * by magnitude (square feet below roughly an acre, acres above it) instead of printing both.
 *
 * ONE FEET CONVENTION. The prime mark (′) is the app's feet notation everywhere else on the
 * drawing (element dimension callouts, parcel edge lengths), so it is the single convention
 * here too — "2,100′", never "2,100 ft" and never the bare abbreviation "perim" doing double
 * duty as a unit. "perimeter" is a quantity NAME and rides in the subordinate line.
 *
 * Pure presentation: geometry arrives as already-computed numbers so this module can never
 * disagree with the canvas about what a measurement measures. Tests: test/measureLabel.test.js.
 */

export const SQFT_PER_ACRE = 43560;

/* Number formatting, one convention for the whole measurement family (mirrors the planner's
 * f0/f2): thousands separators everywhere, acres to two decimals, feet and square feet to
 * zero. Rendered in tabular figures by the caller so digits never jitter between frames. */
export const fmtInt = (n) => Math.round(n).toLocaleString();
export const fmt2 = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtFeet = (n) => `${fmtInt(n)}′`;
export const fmtSf = (n) => `${fmtInt(n)} sf`;
export const fmtAcres = (n) => `${fmt2(n)} ac`;

/* Where the headline flips from square feet to acres. "Roughly an acre" — one acre exactly,
 * because that is the number a developer already thinks in and a fuzzed threshold would just
 * make the flip point unpredictable. */
export const ACRE_LEAD_MIN_SF = SQFT_PER_ACRE;

/**
 * The label model for one measurement.
 *
 * @param mode   "line" | "polyline" | "area" | "count"
 * @param vals   { areaSf, perimFt, lengthFt, count, segments } — whichever the mode needs
 * @param opts   { label (the user's own name), uncalibrated }
 * @returns { name, headline, detail, warn }
 *          `name` is null when the user typed none; `detail` is null when there is nothing
 *          worth subordinating (a plain two-point distance).
 */
export function measureLabelModel(mode, vals = {}, opts = {}) {
  const name = opts.label ? String(opts.label).trim() || null : null;
  const warn = !!opts.uncalibrated;
  let headline = "";
  let detail = null;

  if (mode === "count") {
    const n = Math.max(0, Math.round(vals.count || 0));
    // Big number, unit underneath — the dashboard convention. "12" then "items", never "12 items"
    // set at one weight where the digit has to fight the word.
    headline = fmtInt(n);
    detail = n === 1 ? "item" : "items";
  } else if (mode === "area") {
    const sf = Math.max(0, vals.areaSf || 0);
    const ac = sf / SQFT_PER_ACRE;
    const leadAcres = sf >= ACRE_LEAD_MIN_SF;
    headline = leadAcres ? fmtAcres(ac) : fmtSf(sf);
    const other = leadAcres ? fmtSf(sf) : fmtAcres(ac);
    const perim = vals.perimFt > 0 ? `${fmtFeet(vals.perimFt)} perimeter` : null;
    detail = [other, perim].filter(Boolean).join(" · ");
  } else {
    const ft = Math.max(0, vals.lengthFt || 0);
    headline = fmtFeet(ft);
    const segs = Math.max(0, Math.round(vals.segments || 0));
    // A multi-leg run says how many legs make up the total; a plain two-point distance has no
    // breakdown to give, so it gets no detail line rather than a padded one.
    detail = segs > 1 ? `${fmtInt(segs)} segments` : null;
  }

  return { name, headline, detail, warn };
}

/** The chip's lines, highest priority first — the order the collision engine drops them in. */
export function measureChipLines(model) {
  if (!model) return [];
  return [model.name, model.headline, model.detail].filter(Boolean);
}
/** Which of those lines is the headline (index), so the renderer knows which to set large. */
export const headlineIndex = (model) => (model && model.name ? 1 : 0);

/* ------------------------------------------------------------------ per-edge segment lengths
 *
 * What a civil reviewer expects on a polygon or polyline: the length of each leg, ON the leg.
 * This is the single biggest thing that makes the drawing read as a plan rather than a sketch.
 * Gated separately from the summary chip, because a long boundary can be worth dimensioning
 * well before the summary is worth showing (and vice-versa).
 */
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * One entry per edge, in FEET space: the edge midpoint, its length, and the angle to set the
 * text along (always readable left-to-right — an edge running right-to-left is flipped 180°
 * rather than printed upside down).
 * @param pts    the measurement's points, in feet
 * @param closed true for an area (the closing edge back to point 0 is included)
 */
export function measureSegments(pts, closed = false) {
  const p = Array.isArray(pts) ? pts : [];
  if (p.length < 2) return [];
  const out = [];
  const last = closed ? p.length : p.length - 1;
  for (let i = 0; i < last; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const ft = dist(a, b);
    if (!(ft > 0)) continue;
    // Keep the text upright: fold the edge bearing into (-90, 90]. A plain "+180 when it points
    // left" is not enough — a due-west edge is exactly 180° and would come back as 360°, i.e.
    // upside-down again. Modulo folds every direction, including the exact ones.
    const raw = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    const deg = (((raw + 90) % 180) + 180) % 180 - 90;
    out.push({ i, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ft, deg, label: fmtFeet(ft) });
  }
  return out;
}
