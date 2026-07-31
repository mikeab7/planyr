/* measureSheet — how a MEASUREMENT renders on a SHEET (an export), as opposed to on the canvas.
 *
 * WHAT WAS WRONG (the owner's Sylvestri print). `buildExportSvg` CLONES the live `<svg>` and strips
 * only what is tagged `data-export="skip"`, so an export is, by construction, exactly what was on
 * screen at that instant. Two things then collided on a sheet printed from a whole-site zoom:
 *   1. the measurement's VALUE was zoom-gated (`measureLabelVisible`, plus B1152's per-measurement
 *      reveal zoom), so at that zoom the number was never in the DOM to clone; and
 *   2. the measurement's ENDPOINT MARKERS had NO gate and were sized in constant canvas px, so they
 *      kept their size against a drawing that had shrunk to fit several hundred acres.
 * The sheet therefore printed two fat discs joined by a stub, with no number anywhere — which is
 * worthless on an exhibit, because the number is the only thing the measurement exists to say.
 *
 * THE PRINCIPLE THIS MODULE ENCODES: **an export is a DOCUMENT, not a screenshot.** Level-of-detail
 * gating exists so the canvas stays readable while you WORK; none of that reasoning survives onto a
 * sheet that will be read at full size on paper. So on an export pass:
 *   • a measurement's value label renders regardless of any zoom gate (`measureLabelVisible`'s
 *     `sheet` option — B1152's per-measurement threshold governs the CANVAS only); and
 *   • the vertex discs — which are EDITING AFFORDANCES, not drawing content — are replaced by real
 *     drafting terminators (`terminatorTicks`) on an open run, and simply dropped elsewhere.
 * A COUNT measurement is the deliberate exception: its numbered markers ARE the content, so they
 * keep printing untouched.
 *
 * THE INVARIANT, asserted in code rather than left to review (`enforceMeasureValueOnSheet`): a
 * measurement must never print its geometry without its value. If for any reason the value cannot be
 * placed, the WHOLE measurement is omitted from the sheet rather than printing as anonymous marks.
 * LOUD-FAILURE: the enforcement returns what it dropped so the caller can warn — never a silent trim.
 *
 * Pure (no React / DOM construction; the one DOM-touching helper only reads and removes through the
 * standard `querySelectorAll` / `remove` interface, so it unit-tests against a plain stand-in).
 * Tests: test/measureSheet.test.js.
 */

/* The attributes the canvas render stamps so the export path can reason about a measurement without
 * re-deriving anything. Exported as constants so the renderer, the enforcement pass and the tests
 * can never drift onto three different spellings. */
export const MEASURE_GROUP_ATTR = "data-measure";        // on the measurement's outer <g> — carries its id
export const MEASURE_MODE_ATTR = "data-measure-mode";    // line | polyline | area | count
export const MEASURE_VERTEX_ATTR = "data-measure-vertex"; // an editing disc — must never reach a sheet
export const MEASURE_TERM_ATTR = "data-measure-term";    // a drafting terminator — the sheet's replacement
export const CHIP_TEXT_ATTR = "data-chip-text";          // a line of the summary chip (the VALUE)

/* Half-length of a drafting tick, in LABEL px (multiply by the label frame's `k` to land in canvas
 * px). Sized to read as a crisp terminator at sheet scale — the same order as the type beside it,
 * which is what a tick on a real dimension line looks like. */
export const TERMINATOR_HALF_PX = 5;

/* Terminator stroke weight, in LABEL px. The export's stroke-thinning pass retargets it to a
 * physical drafting weight from here, exactly as it does every other plan stroke. */
export const TERMINATOR_WEIGHT_PX = 1.4;

/* The measure modes whose ends get a drafting terminator. An AREA is a closed boundary — it reads
 * correctly as an outline and a tick on it would be meaningless; a COUNT has no run at all. */
export const TERMINATED_MODES = ["line", "polyline"];
export const terminatedMode = (mode) => TERMINATED_MODES.includes(mode);

/**
 * The two drafting ticks that terminate an open run — the architectural slash, set at 45° to the
 * run and centred on its end point, which is what a length annotation looks like on a real exhibit.
 *
 * @param pts     the run's points in CANVAS px, in order (>= 2)
 * @param halfPx  half the tick's length, in canvas px
 * @returns [{x1,y1,x2,y2}, …] — 0, 1 or 2 ticks (a degenerate end contributes none)
 */
export function terminatorTicks(pts, { halfPx = TERMINATOR_HALF_PX } = {}) {
  if (!Array.isArray(pts) || pts.length < 2 || !(halfPx > 0)) return [];
  const n = pts.length;
  // Each end, paired with its inboard neighbour so the tick can be set against the run's direction.
  const ends = [[pts[0], pts[1]], [pts[n - 1], pts[n - 2]]];
  const out = [];
  for (const [p, q] of ends) {
    if (!p || !q) continue;
    const dx = q.x - p.x, dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) continue; // coincident points — no direction to set a tick against
    const ux = dx / len, uy = dy / len;
    // Rotate the run direction by 45°: the classic drafting tick, which reads as a terminator at
    // any orientation (a perpendicular bar can disappear into a parallel neighbour).
    const c = Math.SQRT1_2;
    const tx = ux * c - uy * c, ty = ux * c + uy * c;
    out.push({
      x1: p.x - tx * halfPx, y1: p.y - ty * halfPx,
      x2: p.x + tx * halfPx, y2: p.y + ty * halfPx,
    });
  }
  return out;
}

/**
 * THE INVARIANT, as a pure decision over what the sheet is about to carry.
 *
 * @param entries [{ id, mode, hasValue }] — one per measurement group found on the sheet
 * @returns { keep: [ids], drop: [ids] } — `drop` is every measurement that would print geometry
 *          with no value, and must therefore be omitted from the sheet entirely.
 */
export function sheetMeasureVerdict(entries) {
  const keep = [], drop = [];
  for (const e of entries || []) {
    if (!e) continue;
    (e.hasValue ? keep : drop).push(e.id);
  }
  return { keep, drop };
}

/**
 * Enforce the invariant on a built sheet: remove every measurement group that carries no value text.
 *
 * Deliberately a REMOVAL, not a repair — by the time the clone exists the value could only be
 * fabricated, and a wrong number on an exhibit is worse than a missing annotation. Returns the
 * dropped ids so the caller can raise a LOUD warning instead of quietly shipping a thinner sheet.
 *
 * `root` needs only `querySelectorAll`; each match needs `getAttribute`, `querySelector` and
 * `remove` — the standard DOM surface, which is what makes this testable without a browser.
 */
export function enforceMeasureValueOnSheet(root) {
  if (!root || typeof root.querySelectorAll !== "function") return { dropped: [] };
  const groups = Array.from(root.querySelectorAll(`[${MEASURE_GROUP_ATTR}]`));
  const entries = groups.map((g) => ({
    id: g.getAttribute(MEASURE_GROUP_ATTR),
    mode: g.getAttribute(MEASURE_MODE_ATTR),
    hasValue: !!g.querySelector(`[${CHIP_TEXT_ATTR}]`),
    node: g,
  }));
  const { drop } = sheetMeasureVerdict(entries);
  const dropSet = new Set(drop);
  for (const e of entries) if (dropSet.has(e.id)) e.node.remove();
  return { dropped: drop };
}

/** The owner-facing warning for a dropped measurement — plain English, no counts of pixels. */
export function droppedMeasureWarning(dropped) {
  const n = (dropped || []).length;
  if (!n) return null;
  return n === 1
    ? "⚠ One measurement was left off the sheet because its value couldn't be placed — a measurement never prints without its number."
    : `⚠ ${n} measurements were left off the sheet because their values couldn't be placed — a measurement never prints without its number.`;
}
