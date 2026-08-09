/* NEW-4 — THE CLICK-CONTRACT AUDIT: does a double-click open Properties, on every drawable thing?
 *
 * Nothing in this repo could see the double-click contract end to end. `e2e/click-contract.spec.js`
 * drives nine declared types; the source guards read code, not pixels. So a defect that killed the
 * gesture on the OWNER's plan (Bain / "Concept A — Quiddity Hydrologic") survived every green build
 * — and the type it actually broke, a centerline road, was the one nothing drove.
 *
 * This harness seeds ONE of every element type and every markup kind — including all THREE easement
 * modes — double-clicks each on the real canvas, and asserts `[data-testid="property-panel"]`
 * appears. It is a screening sweep for the whole surface, not a substitute for the specs.
 *
 *   node ui-audit/audit-doubleclick-properties.mjs            # every feature, at its shape CENTRE
 *   node ui-audit/audit-doubleclick-properties.mjs --labels   # …at its LABEL / dimension number
 *   node ui-audit/audit-doubleclick-properties.mjs --locked   # …with every feature LOCKED
 *
 * Needs `npm run preview` on :4173 (or BASE_URL). Runs logged out, no external GIS, no real data.
 *
 * ── THE --labels VARIANT IS NOT AN EXTRA, AND IT PRIMES THE SELECTION FIRST — ON PURPOSE. The
 *    owner double-clicks where his EYE is, and his eye is on the label, not on the centroid of the
 *    polygon. Two of the three defects this audit was built for live off-centre: a road's width
 *    number is painted on the pavement (NEW-3), and a pond's label can overhang its basin.
 *    Crucially, a detail-tier dimension number DOES NOT EXIST until its element is selected — so an
 *    unprimed probe cannot find it, silently falls back to the shape centre, and reports a green
 *    that proves nothing. (Verified: with NEW-3's fix reverted, the unprimed centre probe still
 *    passed, because press 2 landed on the dimension GRAB BAND instead of the number.) That is the
 *    named CHROME-NEVER-EATS-A-PRESS worst case — chrome a static reading cannot see — so this mode
 *    selects the feature, waits for the tap record to lapse, and then probes what appeared.
 *
 * ── ⛔ THE TWO-PRESS INVARIANT (B233153) IS THE PROBE SHAPE EVERYTHING ELSE HERE WAS MISSING, and
 *    it is run for every feature. Between press 1 and press 2 the harness asks the APP's own
 *    resolver what a double-click at that point would now address, and requires the answer to still
 *    be the feature. Chrome that only exists once the gesture is half-finished is invisible to every
 *    other check in this file, because they all read the DOM before the interaction. Two defects it
 *    would have caught outright: the road dimension number (NEW-3), and the one it was written for —
 *    a detention pond whose OWN vertex handle, mounted by press 1, ate press 2.
 *
 *    Its sibling, HALF FIVE, drives that case deliberately: select the feature, find a point where
 *    one of its own grips lands over its own body, deselect, and double-click there.
 *
 * ── THE --locked VARIANT MAKES A CARVE-OUT INTO A DECISION. A locked feature is select-only: the
 *    double-click selects it and does NOT open Properties. That is deliberate (locking guards the
 *    object from stray edits) but it was never written down or tested, so it was indistinguishable
 *    from a bug. Here it is asserted in the direction it actually holds, so changing it is a choice.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ⛔ FIXTURE TRAPS — recorded so nobody pays for them twice. Every one of these cost a debugging
 *    session on the first run of this audit, and every one is silent (green build, wrong picture):
 *
 *  1. A CENTERLINE ROAD SEEDED WITHOUT ITS STRIP BBOX gives NaN bounds, and zoom-to-fit then
 *     collapses the ENTIRE SCENE into the top-left corner — every other feature's coordinates go
 *     wrong at once, so it reads as "the whole harness is broken". A road row is `{ pts, vtx }`
 *     PLUS the `roadStripBBox(pts, vtx, travelW, curb, { defaultRadius })` spread (cx/cy/w/h/rot).
 *     This harness derives that spread itself (`roadBBox` below) rather than hand-writing numbers.
 *
 *  2. A `utilRoute` WITHOUT `pad` CRASHES THE WHOLE WORKSPACE RENDER — "Cannot read properties of
 *     undefined (reading 'map')" — because the render maps `m.pad` unconditionally. Not a blank
 *     markup: a blank app. Seed `pts` + `corridor` + `pad` together, always.
 *
 *  3. `[title="Zoom to fit"]` MATCHES THE HEADER'S FULLSCREEN GLYPH FIRST. There are two controls
 *     with that title and the header one wins the query, so "fit the view" silently did nothing.
 *     Take the fit control from INSIDE the canvas zoom stack (see `fitView`).
 *
 *  4. A MARKUP CANNOT BE LOCATED BY AN nth-MATCH ON A SHARED PATTERN FILL. Several kinds paint with
 *     the same hatch, so an index-based pick crossed the boundary easement with the polyline — the
 *     pass/fail verdict was right and the NAME on it was wrong, which is worse than a plain failure.
 *     Every seeded markup here carries its OWN unique stroke colour, and is located by that colour.
 *
 *  5. ZOOM-TO-FIT FRAMES PARCELS + ELEMENTS + THE UNDERLAY. IT DOES NOT LOOK AT MARKUPS. So a
 *     fixture that puts its markups outside the ELEMENT extent renders half of them off-canvas and
 *     every one of those probes fails looking exactly like a broken contract. The layout below
 *     therefore parks elements in the FIRST and LAST grid rows on purpose, so the element bounds
 *     enclose every markup. (`fit` is at SitePlanner.jsx's `const fit = useCallback`; the harness
 *     also asserts the plan really is on screen before probing anything — see `contentFill`.)
 *
 *  6. AN ELEMENT IS CENTRED ON `cx`/`cy`, NOT `x`/`y`, AND SO IS A `rect`/`ellipse` MARKUP. Seeding
 *     x/y leaves the centre undefined, every derived corner is NaN, and the whole plan lands off
 *     the canvas — TRAP 1's symptom again, from a different cause. Both are silent.
 *
 *  7. AN OPEN-PATH MARKUP (line, polyline, traced, infwater) DRAWN AXIS-ALIGNED HAS A ZERO-HEIGHT
 *     BOUNDING BOX. A probe that requires both width AND height skips it and reports "did not
 *     render", which reads as a missing feature rather than a flat one.
 *
 *  8. ⛔ A TYPE NAME IN A FIXTURE IS NOT A CLASS, AND NEITHER IS A SHAPE — VERTEX COUNT IS ITS OWN
 *     VARIABLE (B233153). Six pond variants (bare rect · polygon · +detention · +expansion baseline
 *     · grouped) all passed on the build the owner's pond was dead on, because every one of them is
 *     a FOUR-vertex ring whose grips sit at four distant corners. A surveyed basin has dozens, so
 *     selecting it peppers its edge with 18px hit squares. Hence `surveyRing` and the 44-vertex row.
 *     The grid grew a SIXTH COLUMN rather than a sixth row on purpose: the layout is height-bound
 *     against 16:9, so a column is free while a row shrinks the whole plan — and the handle
 *     decimation is measured in SCREEN pixels, so shrinking it would thin out the grips under test.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { roadStripBBox } from "../src/workspaces/site-planner/lib/siteModel.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const LOCKED = process.argv.includes("--locked");
const LABELS = process.argv.includes("--labels");
const MODE = LOCKED ? "locked" : LABELS ? "labels" : "centres";

/* ---- the fixture ---------------------------------------------------------------------------
 * One of everything, laid out on a grid in world FEET so nothing overlaps and every probe point
 * is unambiguous. Each row declares how to find itself on screen (`find`) and, for --labels, where
 * its label / dimension number sits relative to the shape (`labelAt`).
 */
const SITE_ID = "zz-dblclick-audit";
const COL = 520, ROW = 430;                      // grid pitch, feet — 5 wide × 4 deep ≈ the viewport
const at = (c, r) => ({ x: 400 + c * COL, y: 400 + r * ROW });
/* ⛔ AN ELEMENT IS CENTRED ON `cx`/`cy`, NOT `x`/`y` (and so is a `rect`/`ellipse` MARKUP). Seeding
 * x/y leaves cx/cy undefined, every derived corner comes out NaN, and zoom-to-fit then puts the
 * whole plan off the canvas — the same silent, whole-scene symptom as TRAP 1. */
const rect = (c, r, w = 300, h = 200, extra = {}) => { const p = at(c, r); return { cx: p.x, cy: p.y, w, h, rot: 0, ...extra }; };
const ring = (cx, cy, w, h) => [
  { x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 },
  { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 },
];
/* ⛔ B233153 — A SURVEYED RING, AND ITS VERTEX COUNT IS THE WHOLE POINT.
 *
 * Every pond variant below this line certified GREEN on the exact build the owner's detention pond
 * was dead on, and the reason is NOT the shape — polygon, detention record and expansion baseline
 * were all already covered. It is VERTEX COUNT AGAINST HANDLE SIZE AT THE PROBE POINT. Each of those
 * rings has four vertices, so once selected its grips sit at the four corners, nowhere near where a
 * centre probe presses. A real detention basin is digitized with dozens, so selecting it peppers its
 * perimeter band with 18px transparent hit squares — and press 1 is what mounts them, under a
 * pointer that has not moved. A test that passes on a four-vertex pond proves nothing about this.
 *
 * Deterministic (no RNG — a fixture that differs run to run cannot be a guard). The wobble is not
 * decoration: `decimatedHandles` ranks by CORNER-NESS and thins to 22px on screen, so a smooth
 * ellipse would keep only a handful of grips and a rectangle only its four. */
const surveyRing = (cx, cy, rx, ry, n = 44) => Array.from({ length: n }, (_, i) => {
  const t = (i / n) * Math.PI * 2;
  const k = 1 + 0.16 * Math.sin(t * 5) + 0.07 * Math.cos(t * 11);
  return { x: cx + Math.cos(t) * rx * k, y: cy + Math.sin(t) * ry * k };
});

/* TRAP 1 — a centerline road MUST carry its derived strip bbox or the whole scene's fit breaks. */
function roadBBox(pts, travelW, curb) {
  const vtx = pts.map(() => ({}));
  return { pts, vtx, travelW, curb, ...roadStripBBox(pts, vtx, travelW, curb, { defaultRadius: 40 }) };
}

let n = 0;
const eid = () => `zzel${++n}`;
const mid = () => `zzmk${++n}`;

/* ELEMENTS — every drawable type. TRAP 5: they occupy the FIRST and LAST grid rows so the element
 * extent (which is all zoom-to-fit looks at) encloses every markup seeded between them. */
const ELS = [
  { id: eid(), type: "building", ...rect(0, 0, 360, 220), label: "Building" },
  { id: eid(), type: "parking", ...rect(1, 0, 300, 180), label: "Car Parking" },
  { id: eid(), type: "paving", ...rect(2, 0, 300, 180), label: "Paving" },
  { id: eid(), type: "trailer", ...rect(3, 0, 300, 120), label: "Trailer Parking" },
  { id: eid(), type: "sidewalk", ...rect(4, 0, 300, 60), label: "Sidewalk" },
  { id: eid(), type: "pond", ...rect(0, 3, 320, 220), label: "Detention Pond" },
  /* ⛔ THE FIXTURE'S POND USED TO BE THE BARE RECT ABOVE, AND THAT IS HOW THIS HARNESS CERTIFIED A
   * POND 19/19 WHILE THE OWNER'S REAL DETENTION POND WAS REPORTED DEAD ON THE SAME BUILD (B227940).
   * A real pond is not a rect with a label: it carries a detention record, it is often an irregular
   * POLYGON rather than a rect (so it renders through a different branch of renderElPx entirely),
   * and it may carry an expansion BASELINE that paints a second fill over the basin. Each of those
   * is a different render path, so each gets a row — a type name in a fixture is not a class. */
  { id: eid(), type: "pond", variant: "polygon", ...rect(3, 3, 320, 220), points: ring(at(3, 3).x, at(3, 3).y, 320, 220), label: "Pond (irregular)" },
  { id: eid(), type: "pond", variant: "rect + detention", ...rect(0, 4, 320, 220), det: { role: "detention", depth: 8, tobElev: 100, poolElev: 96, freeboard: 1, slope: 3, outlet: "weir", contourInterval: 1, contours: true, daAcres: 12, daImpPct: 70, releaseRateCfs: 5 }, label: "Pond (detention)" },
  { id: eid(), type: "pond", variant: "polygon + detention", ...rect(1, 4, 320, 220), points: ring(at(1, 4).x, at(1, 4).y, 320, 220), det: { role: "detention", depth: 8, tobElev: 100, poolElev: 96, freeboard: 1, slope: 3, outlet: "weir", contourInterval: 1, contours: true, daAcres: 12, daImpPct: 70, releaseRateCfs: 5 }, label: "Pond (irregular, detention)" },
  { id: eid(), type: "pond", variant: "polygon + expansion baseline", ...rect(2, 4, 320, 220), points: ring(at(2, 4).x, at(2, 4).y, 320, 220),
    det: { ...{ role: "detention", depth: 8, tobElev: 100, poolElev: 96, freeboard: 1, slope: 3, outlet: "weir", contourInterval: 1, contours: true, daAcres: 12, daImpPct: 70, releaseRateCfs: 5 }, baseline: { ring: ring(at(2, 4).x, at(2, 4).y, 200, 140) } }, label: "Pond (expanded)" },
  /* A GROUPED pair. Its double-click is B261 DRILL-IN, not Properties — asserted in the direction it
   * actually holds (below), so the one element class whose double-click deliberately does NOT open
   * the panel is PINNED rather than left to look like a pass. */
  { id: eid(), type: "pond", variant: "grouped", groupId: "zzgrp1", ...rect(3, 4, 320, 220), det: { role: "detention", depth: 8, tobElev: 100, poolElev: 96, freeboard: 1, slope: 3, outlet: "weir", contourInterval: 1, contours: true, daAcres: 12, daImpPct: 70, releaseRateCfs: 5 }, label: "Pond (grouped)", drillOnly: true },
  { id: eid(), type: "building", variant: "grouped", groupId: "zzgrp1", ...rect(4, 4, 240, 160), label: "Building (grouped)", drillOnly: true },
  /* ⛔ B233153 — THE OWNER'S CASE, and the row every earlier pond variant was missing. A surveyed
   * ring: 44 vertices, so its selected grips blanket the basin edge instead of sitting on four
   * distant corners. This is the row the grip-covered probe below exercises. Parked in a SIXTH
   * COLUMN on purpose: the fixture is height-bound against a 16:9 viewport (5 × 520 wide against
   * 5 × 430 deep), so a new column costs nothing, while a new ROW would shrink every feature on
   * screen — and the handle decimation is measured in SCREEN pixels, so shrinking the plan would
   * quietly thin out the very grips this row exists to produce. */
  { id: eid(), type: "pond", variant: "surveyed ring (44 vertices)", ...rect(5, 3, 420, 300),
    points: surveyRing(at(5, 3).x, at(5, 3).y, 170, 120),
    det: { role: "detention", depth: 8, tobElev: 100, poolElev: 96, freeboard: 1, slope: 3, outlet: "weir", contourInterval: 1, contours: true, daAcres: 12, daImpPct: 70, releaseRateCfs: 5 },
    label: "Pond (surveyed)", gripProbe: true },
  // TRAP 1 in action: pts + vtx + the roadStripBBox spread, never hand-written bounds.
  { id: eid(), type: "road", label: "Road", roadClass: "truck",
    ...roadBBox([{ x: at(4, 3).x - 200, y: at(4, 3).y }, { x: at(4, 3).x + 200, y: at(4, 3).y }], 30, 1) },
  /* ⛔ NEW-1 — THE FEATURE IS SMALLER THAN ITS OWN CHROME, and until this row the fixture had no
   * case of it at all. #963 gave this audit a 44-vertex surveyed ring — a feature whose grips are
   * DENSE — and that is a different variable from a feature whose grips are BIGGER THAN IT IS.
   *
   * The owner's case, live on Bain: a road stub whose whole rendered body is 6×12 CSS px, wearing a
   * 12 px endpoint handle inside a 15×22 px handle box. Not one pixel of it is uncovered once it is
   * selected, so press 2 can only resolve to whatever lies under the chrome.
   *
   * The stub below is that condition at this fixture's zoom (≈0.38 px/ft, so ~16 × 32 ft), and its
   * corners are deliberately tighter than the truck class can hold — which is not decoration
   * either. A short road between two others is exactly the geometry that trips the min-radius
   * warning, and that warning paints a 7 px corner dot with an "!" on it: on a body this size the
   * REVIEW CHROME IS WIDER THAN THE ROAD. Measured on the pre-fix build: 0 selection nodes after
   * press 1 (nothing selected, no panel — the owner's report verbatim) and the road's path data
   * CHANGED after press 2, because the flag's click ran the corner fix. A double-click re-cut his
   * alignment and burnt an undo frame, silently.
   *
   * The paving row is the same condition on a NON-ROAD kind, so the case is not filed as a road
   * quirk: a 16 × 32 ft rect mounts eight resize grips and a rotate arm that together span several
   * times its own body. */
  { id: eid(), type: "road", label: "Stub", roadClass: "truck", variant: "smaller than its own chrome",
    ...roadBBox([{ x: at(5, 0).x, y: at(5, 0).y }, { x: at(5, 0).x + 9, y: at(5, 0).y + 12 },
      { x: at(5, 0).x, y: at(5, 0).y + 24 }, { x: at(5, 0).x + 8, y: at(5, 0).y + 34 }], 14, 1) },
  { id: eid(), type: "paving", variant: "smaller than its own chrome", ...rect(5, 4, 16, 32), label: "Chip" },
];

/* MARKUPS — every kind, with all THREE easement modes, parked in the two middle rows plus the two
 * free slots on the bottom row. TRAP 4: each carries a UNIQUE stroke colour and is located by it,
 * never by an nth-match on a shared hatch fill. */
const MK_SLOTS = [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [1, 3], [2, 3]];
let sl = 0;
const mkAt = () => { const [c, r] = MK_SLOTS[sl++]; return at(c, r); };
const MARKUPS = [
  (() => { const p = mkAt(); return { id: mid(), kind: "easement", mode: "centerline", stroke: "#ff0001", width: 60,
    centerline: [{ x: p.x - 180, y: p.y }, { x: p.x + 180, y: p.y }],
    pts: [{ x: p.x - 180, y: p.y - 30 }, { x: p.x + 180, y: p.y - 30 }, { x: p.x + 180, y: p.y + 30 }, { x: p.x - 180, y: p.y + 30 }] }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "easement", mode: "boundary", stroke: "#ff0002", pts: ring(p.x, p.y, 300, 180) }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "easement", mode: "parceledge", stroke: "#ff0003", width: 50,
    centerline: [{ x: p.x - 150, y: p.y }, { x: p.x + 150, y: p.y }],
    pts: [{ x: p.x - 150, y: p.y }, { x: p.x + 150, y: p.y }, { x: p.x + 150, y: p.y + 50 }, { x: p.x - 150, y: p.y + 50 }] }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "line", stroke: "#ff0004", weight: 3, a: { x: p.x - 150, y: p.y }, b: { x: p.x + 150, y: p.y } }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "polyline", stroke: "#ff0005", weight: 3, pts: [{ x: p.x - 150, y: p.y + 60 }, { x: p.x, y: p.y - 60 }, { x: p.x + 150, y: p.y + 60 }] }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "polygon", stroke: "#ff0006", weight: 3, fill: "#ff0006", fillOpacity: 0.25, pts: ring(p.x, p.y, 280, 180) }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "rect", stroke: "#ff0007", weight: 3, fill: "#ff0007", fillOpacity: 0.25, cx: p.x, cy: p.y, w: 280, h: 180, rot: 0 }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "ellipse", stroke: "#ff0008", weight: 3, fill: "#ff0008", fillOpacity: 0.25, cx: p.x, cy: p.y, w: 280, h: 180, rot: 0 }; })(),
  // TRAP 2 — `pad` is not optional: without it the WORKSPACE render throws and the app is blank.
  (() => { const p = mkAt(); const c = { x: p.x + 150, y: p.y };
    return { id: mid(), kind: "utilRoute", util: "water", stroke: "#ff0009", width: 40, label: "Water service",
      pts: [{ x: p.x - 150, y: p.y }, { x: p.x + 150, y: p.y }],
      corridor: [{ x: p.x - 150, y: p.y - 20 }, { x: p.x + 150, y: p.y - 20 }, { x: p.x + 150, y: p.y + 20 }, { x: p.x - 150, y: p.y + 20 }],
      pad: ring(c.x, c.y, 40, 40) }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "traced", stroke: "#ff000a", weight: 3, label: "Overhead electric (traced)", pts: [{ x: p.x - 150, y: p.y }, { x: p.x + 150, y: p.y }] }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "infwater", stroke: "#ff000b", weight: 3, dash: "dashed", label: "Inferred water main", pts: [{ x: p.x - 150, y: p.y }, { x: p.x + 150, y: p.y }] }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "encumbrance", stroke: "#ff000c", weight: 3, label: "Encumbrance", pts: ring(p.x, p.y, 280, 180), centerline: [] }; })(),
];

const NAMES = new Map([
  ...ELS.map((e) => [e.id, `element ${e.type}${e.variant ? ` · ${e.variant}` : ""}`]),
  ...MARKUPS.map((m) => [m.id, `markup ${m.kind}${m.mode ? ` (${m.mode})` : ""}`]),
]);

/* ⛔ B280402 — A LOT WHOSE ACREAGE BADGE LANDS ON THE TINY STUB, and it is the fixture condition the
 * repeat-gesture row was missing. The badge is anchored at the lot's POLYLABEL (B1186 — the pole of
 * inaccessibility, guaranteed inside the ring), so a small square lot centred on the stub puts its
 * badge squarely over it. That is not contrived: a lot with a driveway stub in its middle is the
 * ordinary case, and it is exactly the geometry on the owner's Bain plan. Without a parcel
 * OVERLAPPING a feature smaller than its own chrome, nothing here can bite. */
const AUDIT_LOT = (() => { const p = at(5, 0); const w = 210, d = 160;
  return { id: "zzlot1", points: [{ x: p.x - w, y: p.y - d }, { x: p.x + w, y: p.y - d }, { x: p.x + w, y: p.y + d }, { x: p.x - w, y: p.y + d }] }; })();
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Double-click audit", name: "Plan 1",
  origin: null, county: null, parcels: [AUDIT_LOT], measures: [], callouts: [], underlay: null,
  els: ELS.map(({ variant, drillOnly, gripProbe, ...e }) => ({ ...e, locked: LOCKED || undefined })),
  markups: MARKUPS.map((m) => ({ ...m, locked: LOCKED || undefined })),
  settings: { showDims: true }, updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ [SITE_ID]: site }))});
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

/* ---- reporting ------------------------------------------------------------------------------ */
const results = [];
const ok = (name, pass, extra = "") => {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`);
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "audit-doubleclick-properties");
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1800);
  /* Open the seeded project through the real project picker. Seeding `currentSite` instead looks
   * like a shortcut and is not one — the app boots to the landing / map surface and the planner
   * canvas never mounts, so every probe below times out for a reason that has nothing to do with
   * the contract under test. */
  await page.locator('button[title="Choose a project"]:visible, button[title="Switch project"]:visible').first().click();
  await page.waitForTimeout(400);
  await page.locator(`button:has-text(${JSON.stringify(site.site)})`).first().click();
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 25000 });
  await page.waitForTimeout(1200);

  // TRAP 2's tripwire: a fixture that crashes the render leaves a blank workspace and every probe
  // below then "fails" for the wrong reason. Say so once, loudly, instead of 19 times misleadingly.
  if (pageErrors.length) {
    console.log("\n⛔ THE FIXTURE CRASHED THE RENDER — every result below would be meaningless:");
    pageErrors.slice(0, 3).forEach((e) => console.log("   " + e.slice(0, 200)));
    process.exit(1);
  }

  /* TRAP 3 — take the fit control from INSIDE the canvas zoom stack. `[title="Zoom to fit"]` also
   * matches the header's fullscreen glyph, which wins the query and silently does nothing. */
  /* How much of the canvas the seeded plan actually occupies. This is the CHECK that turns TRAP 3
   * from a comment into something the harness can notice: a fit that silently did nothing leaves
   * every feature a few px across, huddled at the top-left, and then all 19 probes "fail" for a
   * reason that has nothing to do with the click contract. */
  const contentFill = () => page.evaluate(() => {
    const c = document.querySelector('[data-testid="planner-canvas"]').getBoundingClientRect();
    /* NEW-2 — measured across every drawn kind, not the element + markup pair alone. */
    const boxes = [...document.querySelectorAll("[data-feature]")].map((g) => g.getBoundingClientRect()).filter((b) => b.width && b.height);
    if (!boxes.length) return 0;
    const x0 = Math.min(...boxes.map((b) => b.left)), x1 = Math.max(...boxes.map((b) => b.right));
    const y0 = Math.min(...boxes.map((b) => b.top)), y1 = Math.max(...boxes.map((b) => b.bottom));
    return Math.min((x1 - x0) / c.width, (y1 - y0) / c.height);
  });

  async function fitView() {
    /* TRAP 3 — `[title="Zoom to fit"]` matches the HEADER's fullscreen glyph as well as the canvas
     * zoom stack's real fit control, and the header one wins a naive query. Try every match until
     * the plan is actually on screen, rather than trusting one of them. */
    const fits = page.locator('button[title="Zoom to fit"]');
    const n = await fits.count();
    for (let i = n - 1; i >= 0; i--) {                       // the canvas stack's is the LAST one
      await fits.nth(i).click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(600);
      if (await contentFill() > 0.3) return true;
    }
    return false;
  }
  if (!await fitView()) {
    console.log(`\n⛔ ZOOM-TO-FIT DID NOTHING — the plan is not on screen (fill ${(await contentFill()).toFixed(3)}).`);
    console.log("   Every probe below would fail for the wrong reason. See TRAP 1 and TRAP 3 in the header.");
    process.exit(1);
  }

  const panelOpen = () => page.locator('[data-testid="property-panel"]').count().then((c) => c > 0);
  /* ⛔ SELECTION HAS TO BE READ, NOT ASSUMED — and it has to be able to reach ZERO first.
   * The owner's pond report was "no panel, NO SELECTION", and this harness could not see the second
   * half at all: it asserted the panel and nothing else, so a feature that silently refuses to
   * select was indistinguishable from one that selects fine. Elements carry no per-feature
   * "selected" stamp, so selection is read off the ONE handle layer; a markup also stamps itself.
   * The deselect below is a PRECONDITION, not politeness: if handles never clear, `handles > 0`
   * would pass for every feature whether or not the press did anything — a green that means
   * nothing, which is the exact failure mode this whole audit exists to prevent. */
  const selectionCount = () => page.evaluate(() =>
    document.querySelectorAll('[data-handle-layer] *').length
    + document.querySelectorAll('[data-testid="markup-selected"], [data-testid="measure-selected"], [data-testid="selection-chrome"], [data-testid="selection-ring"]').length);
  /* Escape alone does NOT reliably clear the canvas selection (measured: it closed the panel and
   * left 45 handle nodes up), so the deselect presses EMPTY CANVAS — the same way a user drops a
   * selection. The empty point is found by asking the document, never hard-coded: a fixture whose
   * layout shifts would otherwise "clear" by pressing some other feature. */
  async function emptyPoint() {
    return page.evaluate(() => {
      const c = document.querySelector('[data-testid="planner-canvas"]').getBoundingClientRect();
      for (const fx of [0.5, 0.08, 0.92]) for (const fy of [0.06, 0.94, 0.5]) {
        const x = Math.round(c.left + c.width * fx), y = Math.round(c.top + c.height * fy);
        const n = document.elementFromPoint(x, y);
        if (n && n.closest && !n.closest("[data-feature]") && !n.closest("[data-handle-layer]")) return { x, y };
      }
      return null;
    });
  }
  async function deselect() {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
    if (await selectionCount() > 0) {
      const e0 = await emptyPoint();
      if (e0) { await page.mouse.click(e0.x, e0.y); await page.waitForTimeout(200); }
    }
    return await selectionCount();
  }
  const closePanel = async () => {
    const x = page.locator('button[aria-label="Close properties"]');
    if (await x.count()) await x.first().click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
  };

  /* WHERE TO PRESS FOR A FEATURE — and the point must be one the feature actually ANSWERS TO.
   *
   * A bounding-box centre is not good enough and the failures are instructive: a polyline drawn as
   * a "V" has its box centre in the empty air between the arms, and a `traced` line's box is
   * inflated by its own text label so the centre slides off the stroke. Both would have been
   * reported as "double-click does nothing" — a false accusation against a working contract, which
   * is worse than no audit at all.
   *
   * So candidates are generated from the RENDERED geometry (segment midpoints, then the box
   * centre) and each is validated with `elementFromPoint`: the first point whose topmost node
   * resolves to THIS feature's `data-feature` stamp wins. That is the same question the browser
   * asks when the user presses, so a point that passes here is a point the user could have hit.
   *
   * In `labels` mode the dimension number / map label is tried FIRST — the owner double-clicks
   * where his eye is, and his eye is on the label. If the label is pointer-transparent the press
   * falls through to the shape and still resolves to the same feature, which is a pass and is
   * reported as such (`via`), not hidden. */
  async function probePoint(id, kind, labels = LABELS) {
    return page.evaluate(({ id, kind, labels }) => {
      const key = `${kind}:${id}`;
      const sel = kind === "el" ? `[data-el-id="${id}"]` : `[data-mk-id="${id}"]`;
      const g = document.querySelector(sel);
      if (!g) return null;

      /* ⛔ IN CENTRES MODE THE POINT MUST LAND ON THE FEATURE'S BODY, NOT ON ITS DIMENSION CHROME
       * (B227940). This is the hole that let this harness certify a pond that could not be clicked
       * at all: `pointer-events` is INHERITED, but a child may override it, and the dimension
       * number sets its own `pointer-events: all`. So a pond whose entire group was pointer-DEAD
       * still had one live child, the probe found it, NEW-3 forwarded the press from the number to
       * the body's action, and the row passed — 19/19 green over an element the user cannot press.
       * Proven, not theorised: with the pond group forced to `pointer-events: none` the suite still
       * reported 50/50 before this guard, and goes red with it.
       * `--labels` is the deliberate exception: probing the label/number IS its whole purpose. */
      /* ⛔ THE PROBE POINT IS JUDGED AS PRESS 1 WILL SEE IT — WITH NOTHING SELECTED, so the handle
       * layer is made pointer-inert for the duration (it is restored in the `finally` below).
       * `--labels` PRIMES the selection to make a detail-tier dimension number exist, and on a
       * feature SMALLER THAN ITS OWN CHROME that priming blankets the whole body in grips: every
       * candidate then came back UNANSWERED and the row read "unreachable by pointer" for a feature
       * that is perfectly reachable. Press 1 always lands on a deselected feature, so that is the
       * state the point has to be valid in. In `centres` mode nothing is selected and there is no
       * handle layer, so this changes nothing at all. */
      const hl = document.querySelector("[data-handle-layer]");
      const hlPrev = hl ? hl.style.pointerEvents : null;
      if (hl) hl.style.pointerEvents = "none";
      const answers = (x, y) => {
        const n = document.elementFromPoint(x, y);
        const f = n && n.closest ? n.closest("[data-feature]") : null;
        if (!f || f.getAttribute("data-feature") !== key) return false;
        if (!labels) {
          // The BODY is geometry. Text chrome (the map label's <text>/<tspan>, the dimension
          // number) is what --labels exists to probe, and accepting it here is exactly how a
          // pointer-DEAD pond passed: its label stayed live and forwarded the press to Properties.
          if (n.closest('[data-el-dim], [data-testid="el-dim"], [data-label-for]')) return false;
          const tag = (n.tagName || "").toLowerCase();
          if (tag === "text" || tag === "tspan") return false;
        }
        return true;
      };
      const push = (out, x, y, via) => { if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x: Math.round(x), y: Math.round(y), via }); };

      const cands = [];
      if (labels) {
        const dim = g.querySelector('[data-testid="el-dim"]');
        const lab = document.querySelector(`[data-label-for="${id}"]`);
        for (const [node, via] of [[dim, "dimension number"], [lab, "label"]]) {
          if (!node) continue;
          const r = node.getBoundingClientRect();
          if (r.width || r.height) push(cands, r.left + r.width / 2, r.top + r.height / 2, via);
        }
      }
      /* Segment midpoints off the rendered geometry — this is what puts the probe ON a stroke rather
       * than in the hollow of a shape. ⛔ A `points` / `x1` attribute is in SVG USER UNITS and the
       * canvas carries a pan+zoom transform, so those numbers are NOT client coordinates: feeding
       * them straight to `elementFromPoint` silently probes somewhere else entirely. Map them
       * through the node's own screen CTM. */
      const svg = g.ownerSVGElement || g.closest("svg");
      const toClient = (n, x, y) => {
        const m = n.getScreenCTM && n.getScreenCTM();
        if (!m || !svg || !svg.createSVGPoint) return null;
        const p = svg.createSVGPoint(); p.x = x; p.y = y;
        const q = p.matrixTransform(m);
        return { x: q.x, y: q.y };
      };
      for (const n of g.querySelectorAll("line, polyline, polygon, rect, ellipse, circle, path")) {
        const r = n.getBoundingClientRect();
        const mid = (x1, y1, x2, y2) => { const c = toClient(n, (x1 + x2) / 2, (y1 + y2) / 2); if (c) push(cands, c.x, c.y, "segment midpoint"); };
        if (n.tagName === "line") { mid(+n.getAttribute("x1"), +n.getAttribute("y1"), +n.getAttribute("x2"), +n.getAttribute("y2")); continue; }
        const raw = n.getAttribute("points");
        if (raw) {
          const pts = raw.trim().split(/\s+/).map((t) => t.split(",").map(Number)).filter((q) => q.length === 2 && q.every(Number.isFinite));
          for (let i = 0; i + 1 < pts.length; i++) mid(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
          if (pts.length > 2) mid(pts[0][0], pts[0][1], pts[pts.length - 1][0], pts[pts.length - 1][1]);
        }
        if (r.width && r.height) push(cands, r.left + r.width / 2, r.top + r.height / 2, "shape centre");
      }
      const box = g.getBoundingClientRect();
      if (box.width || box.height) push(cands, box.left + box.width / 2, box.top + box.height / 2, "group centre");
      /* INTERIOR POINTS OFF THE CENTRE. A filled feature usually carries its map label AT its
       * centre, so every centre-ish candidate resolves to the label's <text>/<tspan> — which the
       * centres-mode body rule (above) correctly rejects. Without these the probe would then
       * report a perfectly clickable pond as unreachable. These are what a user actually does:
       * press the basin somewhere that is not the writing. */
      for (const fy of [0.28, 0.72, 0.5]) for (const fx of [0.28, 0.72, 0.5]) {
        if (fx === 0.5 && fy === 0.5) continue;
        push(cands, box.left + box.width * fx, box.top + box.height * fy, "interior point");
      }

      try {
        for (const c of cands) if (answers(c.x, c.y)) return c;
        return cands.length ? { ...cands[0], via: cands[0].via + " (UNANSWERED — nothing under it claims this feature)" } : null;
      } finally { if (hl) hl.style.pointerEvents = hlPrev; }
    }, { id, kind, labels });
  }

  /* ⛔ IS THIS POINT STILL THIS FEATURE'S, RIGHT NOW? Asked of a DESELECTED plan, because that is
   * the state press 1 lands in. `--labels` primes the selection to make a detail-tier number exist,
   * and for most features that number sits ON the body (B592 clamps a rect's onto the footprint; a
   * road's is anchored to the centreline midpoint) so the point is still the feature's once the
   * priming is dropped — which is the whole CHROME-NEVER-EATS-A-PRESS case the mode exists to
   * drive. On a feature SMALLER THAN ITS OWN CHROME the number cannot fit on the body, so it is
   * placed in clear space, vanishes with the selection, and the probe was aiming at bare canvas:
   * three rows went red describing a point that does not exist at the moment of the gesture. That
   * is a broken probe, not a defect, so the mode falls back to the body and SAYS it did. */
  const answersAt = (id, kind, x, y) => page.evaluate(({ id, kind, x, y }) => {
    const n = document.elementFromPoint(x, y);
    const f = n && n.closest ? n.closest("[data-feature]") : null;
    return !!f && f.getAttribute("data-feature") === `${kind}:${id}`;
  }, { id, kind, x, y });

  /* ── THE TWO-PRESS INVARIANT (B233153) ────────────────────────────────────────────────────────
   *
   * Ask the app — BETWEEN press 1 and press 2 — what a double-click at this exact point would now
   * address. That is the only probe shape that can see chrome which DOES NOT EXIST until the gesture
   * is half-finished, and it is the shape this harness was missing. On the owner's pond, press 1
   * selected it, that mounted the pond's own 41-node handle layer, and one 18px hit square landed on
   * the point already under the cursor: press 2 hit a grip the FIRST PRESS HAD CREATED, so the pair
   * could not form and the native dblclick retargeted to the root with nothing to resolve. Every
   * check in this file read the DOM before the interaction, so every one of them was blind to it.
   *
   * ⛔ IT ASKS THE APP'S OWN RESOLVER (`window.__plannerHitTarget`, E2E-gated, read-only) rather than
   * re-implementing the rule here. A second copy of the hit-test is free to disagree with the one the
   * product uses — the trap lib/featureTarget.js's header names — and a harness that agrees with
   * itself while the app fails is precisely how a pond got certified 19/19. */
  const resolveAt = (x, y) => page.evaluate(({ x, y }) => {
    if (typeof window.__plannerHitTarget !== "function") return { missing: true };
    try { return { target: window.__plannerHitTarget(x, y) }; } catch (e) { return { threw: String(e) }; }
  }, { x, y });
  const resolvedKey = (r) => (r && r.target ? (r.target.kind === "measure" ? `measure:${r.target.i}` : `${r.target.kind}:${r.target.id}`) : null);

  /* WHERE ONE OF THIS FEATURE'S OWN GRIPS COVERS ITS OWN BODY — the owner's press point, found
   * rather than guessed. Call it with the feature ALREADY SELECTED, so the grips exist to be read.
   *
   * The grips are read off the live render and each is sampled INSIDE its box (not merely at its
   * centre: a grip centred on a ring vertex is half outside the shape, and it is the overlapping
   * part that traps a press). The handle layer is made pointer-inert for the duration, so
   * `elementFromPoint` answers with what lies UNDERNEATH — i.e. what the user was aiming at before
   * press 1 mounted anything. A point that comes back is, by construction, a point that resolves to
   * this feature's BODY when nothing is selected and to a grip the instant it is. */
  async function gripCoveredPoint(id, kind) {
    return page.evaluate(({ id, kind }) => {
      const key = `${kind}:${id}`;
      const layer = document.querySelector("[data-handle-layer]");
      if (!layer) return { grips: 0 };
      /* ⛔ LEAVES ONLY. A wrapper `<g>` in this layer has a bounding box spanning every grip inside
       * it — sampling that box lands on ordinary body pixels no grip covers, and the probe then
       * reports a "grip-covered press" that is nothing of the sort (measured: it named `g` and
       * pressed the element's own centre). A grip is a leaf: the node that actually paints and
       * actually carries the `onPointerDown`. */
      const grips = [...layer.querySelectorAll("*")].filter((n) => {
        if (n.children.length) return false;
        const b = n.getBoundingClientRect();
        return b.width >= 6 && b.height >= 6 && getComputedStyle(n).pointerEvents !== "none";
      });
      if (!grips.length) return { grips: 0 };
      const prev = layer.style.pointerEvents;
      layer.style.pointerEvents = "none";
      try {
        for (const g of grips) {
          const b = g.getBoundingClientRect();
          for (const fy of [0.5, 0.25, 0.75]) for (const fx of [0.5, 0.25, 0.75]) {
            const x = Math.round(b.left + b.width * fx), y = Math.round(b.top + b.height * fy);
            const n = document.elementFromPoint(x, y);
            const f = n && n.closest ? n.closest("[data-feature]") : null;
            if (!f || f.getAttribute("data-feature") !== key) continue;
            // The BODY is geometry. Text chrome and the dimension number have their own routes
            // (--labels / NEW-3) and accepting one here would re-open the hole B227940 closed.
            const tag = (n.tagName || "").toLowerCase();
            if (tag === "text" || tag === "tspan") continue;
            if (n.closest('[data-el-dim], [data-testid="el-dim"], [data-label-for]')) continue;
            return { grips: grips.length, x, y, grip: g.getAttribute("data-testid") || g.tagName.toLowerCase() };
          }
        }
      } finally { layer.style.pointerEvents = prev; }
      return { grips: grips.length };
    }, { id, kind });
  }

  /* ⛔ NEW-1 — A FINGERPRINT OF EVERY DRAWN COORDINATE ON THE PLAN.
   *
   * A double-click IDENTIFIES a feature; it must never EDIT one. Nothing here could see the
   * difference: every assertion in this file asks whether a panel appeared, so a gesture that opened
   * Properties AND silently re-cut a road's alignment scored a clean pass. That is not hypothetical —
   * it is what the road-radius flag did to the owner's stub, and the panel opened on the way past.
   *
   * Read off the RENDERED geometry rather than through a state hook, because the render is what a
   * change has to reach to matter, and it needs no new production surface to observe. Deliberately
   * whole-plan, not per-feature: the press that edits is often not on the thing it edits (a flag
   * belonging to road A sits on road B), and a per-feature check would miss exactly that.
   *
   * ⛔ IT IS ALWAYS READ WITH NOTHING SELECTED, and that is what makes it mean anything. Selection
   * MOUNTS geometry — the dimension grab band, the outline cut, review chrome — so a fingerprint
   * taken while something is selected differs from one taken when nothing is, for reasons that have
   * nothing to do with an edit. Measured: comparing across that boundary reported all 27 features as
   * modified, which is a broken instrument, not 27 findings. Chrome the export already knows to drop
   * (`data-export="skip"`) and the dimension group are excluded for the same reason. */
  /* ⛔ AND IT FINGERPRINTS EVERY DRAWN KIND, NOT ELEMENTS AND MARKUPS (NEW-2). Clause 6 of
   * CHROME-NEVER-EATS-A-PRESS is that a gesture contracted to OPEN PROPERTIES must never edit the
   * plan — and on an el+markup fingerprint, a double-click that silently moved a measurement, a
   * callout or a parcel passed as "the plan did not change". */
  const planFingerprint = () => page.evaluate(() =>
    [...document.querySelectorAll("[data-feature] path[d], [data-feature] polygon[points], [data-feature] polyline[points]")]
      .filter((n) => !n.closest('[data-export="skip"], [data-el-dim], [data-handle-layer]'))
      .map((n) => `${n.closest("[data-feature]").getAttribute("data-feature")}=${n.getAttribute("d") || n.getAttribute("points")}`)
      /* ⛔ AT A THOUSANDTH OF A PIXEL, not at string equality. A re-render re-derives these
       * coordinates through the same maths and lands on a different LAST BIT — measured:
       * 558.0385597644689 against 558.0385597644688, 56 paths' worth, on a plan nobody touched.
       * That is a double, not an edit. Every edit this guard exists to catch (a re-cut alignment, a
       * moved vertex) is orders of magnitude larger, so the rounding costs no sensitivity. */
      .map((s) => s.replace(/-?\d+\.\d+/g, (m) => (+m).toFixed(3)))
      .sort());
  /* ⛔ AND IT IS READ ONCE THE PLAN HAS STOPPED MOVING. The first probe of a run read a plan that was
   * still settling after load (56 paths across five ponds and two markups moved with nothing
   * touched), which would have shipped as a permanent, meaningless red on whichever feature happens
   * to be first in the fixture. Two consecutive identical samples, or the run says so out loud —
   * "it never settled" is a finding about the instrument, not a licence to compare anyway. */
  async function settledFingerprint(tries = 12) {
    let prev = await planFingerprint();
    for (let i = 0; i < tries; i++) {
      await page.waitForTimeout(150);
      const now = await planFingerprint();
      if (now.length === prev.length && now.every((s, k) => s === prev[k])) return now;
      prev = now;
    }
    return { unsettled: true, sample: prev };
  }
  /* WHICH feature changed, named — a bare "the plan changed" sends the next reader back to the
   * browser to find out what. */
  const fingerprintDiff = (a, b) => {
    if (!Array.isArray(a) || !Array.isArray(b)) return { changed: -1, who: ["the plan never stopped moving — this comparison cannot mean anything"] };
    const bs = new Set(b), as = new Set(a);
    const gone = a.filter((s) => !bs.has(s)), came = b.filter((s) => !as.has(s));
    const who = [...new Set([...gone, ...came].map((s) => s.slice(0, s.indexOf("="))))];
    return { changed: gone.length + came.length, who, was: (gone[0] || "").slice(0, 90), now: (came[0] || "").slice(0, 90) };
  };

  /* Two separate down/up pairs at one point — pointer capture releases on the first up before the
   * second down, which a fast `dblclick()` / `click({clickCount:2})` cannot promise.
   *
   * ⛔ THE `clickCount` METADATA IS NOT COSMETIC, AND ITS ABSENCE BLINDED THIS HARNESS TO B233153.
   * Chromium synthesises a native `dblclick` only when the second press is stamped `clickCount: 2`;
   * two bare pairs leave the counter at 1 and NO dblclick is ever delivered. So every row here was
   * passing on the reconstructed double-TAP alone (`isDoubleTap`, in the feature's own pointerdown)
   * and the root resolver — the half that carries a REAL user double-click — was never exercised at
   * all. That is exactly the half a grip kills: when press 2 lands on chrome, the feature's handler
   * never runs, the tap cannot pair, and only the native dblclick at the root is left. A harness
   * that cannot deliver one cannot see the bug. The presses stay separate; only the stamp changes. */
  /* ⛔ AND IT TAKES NO READING BETWEEN THE TWO PRESSES — A PROBE THAT OBSERVES THE MIDDLE OF A
   * GESTURE HAS CHANGED THE GESTURE. A `page.evaluate` between the presses costs hundreds of ms and
   * pushes the pair past DBLTAP_MS, at which point it is two clicks, not a double-click, and it
   * "reproduces" failures that mean nothing. (Measured: a 900 ms read between presses did exactly
   * that.) The gap is therefore MEASURED from the events' own timestamps and asserted afterwards,
   * never assumed — see `gestureGaps`. The deliberate exception is the two-press invariant, which is
   * a SINGLE press followed by a question; it is not a double-click and does not claim to be. */
  async function doubleClick(x, y) {
    await page.evaluate(() => { window.__pressTimes = []; });   // ⛔ the WINDOW is the gesture, not the session
    await page.mouse.move(x, y);
    await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 });
    await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
    await page.waitForTimeout(180);
    return page.evaluate(() => window.__pressTimes.map((t, i, a) => Math.round(t - a[i - 1])).slice(1));
  }
  /* Every press's OWN timeStamp (the gesture's clock, never the harness's — the same rule
   * lib/doubleTap.js is built on). Raw timestamps rather than running gaps, because a gap carried
   * across the reset measures the wrong pair: the first version recorded deselect→press-1 (852 ms)
   * beside press-1→press-2 (34 ms) and reported the gesture as too slow. The instrument caught its
   * own defect on its first run, which is the whole reason the gap is measured instead of assumed. */
  await page.evaluate(() => {
    window.__pressTimes = [];
    document.querySelector('[data-testid="planner-canvas"]')
      .addEventListener("pointerdown", (e) => window.__pressTimes.push(e.timeStamp), true);
  });
  const DBLTAP_MS = 350;
  const gapOk = (gaps) => gaps.length > 0 && gaps.every((g) => g >= 0 && g < DBLTAP_MS);

  const targets = [
    ...ELS.map((e) => ({ id: e.id, kind: "el", drillOnly: !!e.drillOnly, gripProbe: !!e.gripProbe })),
    ...MARKUPS.map((m) => ({ id: m.id, kind: "markup" })),
  ];

  console.log(`\n=== double-click → Properties · ${targets.length} features · mode: ${MODE} ===\n`);

  /* ⛔ A GUARD NOBODY HAS SEEN RUN IS A GUARD THAT ROTS GREEN. The two halves added for B233153 both
   * depend on an app-side hook and on grips actually mounting, and either can quietly stop
   * happening — at which point the suite keeps printing a clean score while measuring less than it
   * did. Both are COUNTED, and a zero is a hard failure at the end of the run, not a shrug. */
  let invariantsRun = 0, gripProbesRun = 0, hoverProbesRun = 0;
  const hookLive = await page.evaluate(() => typeof window.__plannerHitTarget === "function");
  ok("the app exposes its double-click resolution to the harness (window.__plannerHitTarget)", hookLive,
    hookLive ? "" : "⛔ the two-press invariant cannot measure the product without it — see lib/featureTarget.js");

  for (const t of targets) {
    const name = NAMES.get(t.id);
    await closePanel();
    await page.waitForTimeout(400);          // clear the pending tap record (DBLTAP_MS = 350)

    if (LABELS) {
      /* Prime the selection so selection-only chrome EXISTS to be probed — a detail-tier dimension
       * number renders only once its element is selected, which is precisely how it ends up taking
       * press 2 of a real double-click. Then let the tap record lapse so the double-click that
       * follows is a clean pair rather than press 3 of this one. */
      const seed = await probePoint(t.id, t.kind);
      if (seed) { await page.mouse.click(seed.x, seed.y); await page.waitForTimeout(450); }
    }
    let pt = await probePoint(t.id, t.kind);
    if (!pt) { ok(`${name} — double-click opens Properties`, false, "feature did not render / has no box"); continue; }
    if (LABELS && !String(pt.via).includes("UNANSWERED")) {
      await deselect();                              // drop the priming — press 1 lands on a bare plan
      await page.waitForTimeout(260);
      if (!await answersAt(t.id, t.kind, pt.x, pt.y)) {
        const body = await probePoint(t.id, t.kind, false);
        if (body) pt = { ...body, via: `${body.via} (its ${pt.via} exists only while selected and sits OFF the body — probed the body instead)` };
      }
    }
    /* ⛔ AN UNANSWERED PROBE POINT IS A FAILURE, NOT SOMETHING TO PRESS ANYWAY (B227940).
     * This is THE hole that let the suite certify a pond nobody can click. `probePoint` falls back
     * to its first candidate when no point resolves to the feature — and the loop then pressed it,
     * the press landed on whatever lay beneath, SOME panel opened, and `panelOpen()` — which only
     * ever asked "is a panel up", never "is it THIS feature's panel" — reported a pass.
     * Measured, not argued: with the pond's own group forced to `pointer-events: none` (a pond the
     * user provably cannot press) the suite still reported 50/50; with this check it reports the
     * pond rows red and names the reason. If nothing under a feature claims it, the user cannot
     * reach it either, and that IS the bug being hunted. */
    if (String(pt.via).includes("UNANSWERED")) {
      ok(`${name} — single click selects`, false, `⛔ no point on this feature answers to it — it is unreachable by pointer (probed ${pt.x},${pt.y})`);
      ok(`${name} — double-click opens Properties`, false, `⛔ UNREACHABLE: ${pt.via}`);
      continue;
    }

    /* HALF ONE — A SINGLE CLICK SELECTS. New with B227940. This is the half the owner reported
     * ("no panel, no selection") that nothing in the repo could see. It holds in EVERY mode: a
     * locked feature is select-only (B922) and a grouped one selects its whole group (B261), so
     * "something is selected" is the common floor even where the panel deliberately stays shut. */
    const zeroed = await deselect();
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(280);
    const selN = await selectionCount();
    if (LOCKED && t.drillOnly) {
      /* ⛔ NOT A PASS, AND DELIBERATELY NOT SILENT (B227940). A LOCKED + GROUPED element paints
       * NOTHING the DOM can see when it is selected: locked suppresses the handles (B922) and an
       * element — unlike a markup — carries no per-feature "selected" stamp, so `sel` moves in
       * state with no observable consequence. That is a real gap in the selection contract and it
       * is filed, not waved through; it is reported here rather than asserted because asserting
       * either direction would pin behaviour nobody has decided on yet. */
      console.log(`SKIP — ${name} — single click selects  ::  locked+grouped paints no DOM-observable selection (filed, B227940)`);
    } else {
      ok(`${name} — single click selects`, zeroed === 0 && selN > 0,
        zeroed === 0 ? `${selN} selection node(s)` : `⛔ PRECONDITION: Escape left ${zeroed} selection node(s) — this assertion cannot mean anything until that is fixed`);
    }

    /* ── ⛔ HALF ONE-AND-A-QUARTER — HOVER-ARMED CHROME (B280402). ────────────────────────────────
     *
     * Some chrome becomes a hit target merely because the CURSOR IS RESTING ON IT — the parcel
     * acreage badge is gated on hover (B1327) precisely so it can be dragged. A cursor resting on a
     * point is what a cursor DOES between the two presses of a double-click, so that chrome arms
     * itself mid-gesture and takes press 2. Measured on the owner's plan and reproduced here: at one
     * point, with nothing selected, the stack reads `["el:<stub>"]` after touching another feature
     * and `["parcel:<lot>", "el:<stub>"]` after resting on it — the parcel does not move above the
     * element, IT ENTERS, and the element is still there, second, unchanged.
     *
     * This is invisible to every other check in this file: they all read after a click, never after
     * a plain HOVER. So the cursor is parked on the probe point, given time to arm whatever it arms,
     * and the resolver is asked again — it must still name this feature. */
    await page.mouse.move(pt.x, pt.y);
    await page.waitForTimeout(260);                    // let a hover latch arm and re-render
    if (hookLive) {
      const hov = await resolveAt(pt.x, pt.y);
      const held = resolvedKey(hov) === `${t.kind}:${t.id}`;
      hoverProbesRun++;
      ok(`${name} — resting the cursor on it does not arm chrome that steals the gesture`, held,
        held ? "" : `⛔ B280402: with the cursor merely hovering, this point resolves to ${resolvedKey(hov) || "NOTHING"} instead`);
    }

    /* HALF ONE-AND-A-HALF — THE TWO-PRESS INVARIANT (B233153). The click above IS press 1, and the
     * feature is now selected with all its selection-only chrome mounted. Ask the app, right here in
     * the middle of the gesture, what press 2 would resolve to. It must still be this feature. */
    if (hookLive) {
      const mid = await resolveAt(pt.x, pt.y);
      const held = resolvedKey(mid) === `${t.kind}:${t.id}`;
      invariantsRun++;
      ok(`${name} — press 1 does not summon chrome that eats press 2`, held,
        held ? `still resolves to ${resolvedKey(mid)}`
          : mid.threw ? `⛔ the resolver threw: ${mid.threw}`
            : resolvedKey(mid) === null
              ? `⛔ after press 1 this point resolves to NOTHING — press 2 has nowhere to land (${pt.via} at ${pt.x},${pt.y})`
              : `⛔ after press 1 this point resolves to ${resolvedKey(mid)} instead`);
    }

    await closePanel();
    await page.waitForTimeout(420);            // let the tap record lapse (DBLTAP_MS = 350)

    // HALF TWO — the double-click contract itself.
    await deselect();                          // …so the fingerprint below is read from a bare plan
    await page.waitForTimeout(420);
    const before = await settledFingerprint();
    const gaps1 = await doubleClick(pt.x, pt.y);
    const opened = await panelOpen();
    ok(`${name} — the probe delivered a real double-click (press gap inside DBLTAP_MS)`, gapOk(gaps1),
      gapOk(gaps1) ? `${gaps1.join(",")} ms` : `⛔ press gap ${gaps1.join(",") || "none"} ms — this was not a double-click, so the verdict below means nothing`);

    if (t.drillOnly) {
      /* B261 drill-in: a GROUPED element's double-click selects the member and deliberately does
       * NOT open Properties. Asserted in the direction it holds so it reads as the decision it is.
       * If this ever flips it is a product change, not a silent drift. */
      ok(`${name} — GROUPED: double-click drills in, Properties stays shut`, !opened, pt.via);
    } else if (LOCKED) {
      // The carve-out, asserted in the direction it actually holds: a locked feature SELECTS and
      // stays select-only. If this flips, it is a product decision, not a silent drift.
      const selected = await page.evaluate((id) => !!document.querySelector(`[data-mk-id="${id}"][data-testid="markup-selected"]`) || !!document.querySelector('[data-handle-layer] *'), t.id);
      ok(`${name} — LOCKED: select-only, Properties stays shut`, !opened, `${pt.via}${selected ? "" : " · nothing appeared selected either"}`);
    } else {
      ok(`${name} — double-click opens Properties`, opened, `via the ${pt.via} at ${pt.x},${pt.y}`);
      /* ⛔ NEW-1 — AND IT MAY NEVER CLOSE ONE. The owner's second symptom on the 6×12 px stub: the
       * panel was up after press 1 and GONE after press 2. A gesture whose contract is "always opens
       * Properties" has no state in which it shuts it, so the same double-click is run a second time
       * with the panel already open and the panel is required to survive it. This is the only
       * assertion here that starts from a NON-empty state, which is why it caught nothing before. */
      if (opened) {
        await page.waitForTimeout(420);          // let the tap record lapse, so this is a fresh pair
        await doubleClick(pt.x, pt.y);
        const stillOpen = await panelOpen();
        ok(`${name} — a second double-click does not CLOSE Properties`, stillOpen,
          stillOpen ? "" : "⛔ the panel was open before this gesture and gone after it");
      }

      /* ── ⛔ HALF THREE — THE REPEAT GESTURE, AND NOTHING IN THIS SUITE REPEATED ONE BEFORE. ────
       *
       * B278578, live on the owner's Bain plan with #965 on the edge: the FIRST double-click on the
       * 6×12 px stub opened Properties, and an immediate SECOND one on the same stub failed straight
       * back to the pre-fix signature — 28 grips, no panel. Deterministic over two full cycles. The
       * discriminators named the cause: a six-second wait still failed (so not a time expiry) while
       * one single click on ANOTHER feature fixed it (so a per-feature latch), and deselecting to
       * bare canvas did NOT clear it.
       *
       * ⛔ THIS IS THE TEXTURE OF THE ORIGINAL REPORT — it works, then it does not, then it does —
       * AND A SUITE THAT DOUBLE-CLICKS EACH FEATURE ONCE SHIPS GREEN THROUGH IT. So the gesture is
       * run TWICE on the same target, with a verified deselect between, exactly as a user repeats
       * it. Run for every feature, like identifies-not-edits and never-closes-a-panel, because a
       * guard that names one component protects one component. */
      await closePanel();
      const zeroed2 = await deselect();
      await page.waitForTimeout(420);
      const gaps2 = await doubleClick(pt.x, pt.y);
      const reopened = await panelOpen();
      ok(`${name} — the SAME feature double-clicks a SECOND time (B278578)`, zeroed2 === 0 && gapOk(gaps2) && reopened,
        zeroed2 !== 0 ? `⛔ PRECONDITION: the deselect left ${zeroed2} selection node(s)`
          : !gapOk(gaps2) ? `⛔ press gap ${gaps2.join(",")} ms — not a double-click`
            : reopened ? `gap ${gaps2.join(",")} ms`
              : "⛔ it opened the first time and not the second — a per-gesture latch survived the deselect");
    }

    /* HALF TWO-AND-A-HALF — IT IDENTIFIES, IT DOES NOT EDIT (NEW-1). Read from a bare plan on both
     * sides (see `planFingerprint`), so what is compared is the drawing, never the selection chrome.
     * Asserted for every feature: the plan the owner double-clicked is the plan he still has. */
    await closePanel();
    await deselect();
    await page.waitForTimeout(300);
    const after = await settledFingerprint();
    const fd = fingerprintDiff(before, after);
    ok(`${name} — the double-click did not change the plan`, fd.changed === 0,
      fd.changed === 0 ? "" : `⛔ a gesture that only IDENTIFIES a feature edited geometry — ${fd.changed} path(s) on ${fd.who.join(", ")}\n        was ${fd.was}\n        now ${fd.now}`);

    /* ── HALF FIVE — THE GRIP-COVERED PRESS. B233153 VERBATIM. ─────────────────────────────────
     *
     * Press where one of THIS feature's own grips will land once it is selected. Nothing is
     * selected when press 1 goes down, so it reaches the body and selects; that mounts the grip
     * squarely under the unmoved pointer; press 2 lands on the grip. On the pre-fix build the root
     * resolver saw a handle on top and answered "nothing was double-clicked" — silently.
     *
     * A locked feature paints no grips (B922) and there is nothing to cover the press, so the case
     * does not exist in `--locked` mode. That is REPORTED, never silently skipped. */
    if (!LOCKED) {
      await closePanel();
      await deselect();
      await page.mouse.click(pt.x, pt.y);            // select, so the grips exist to be read
      await page.waitForTimeout(300);
      const gp = await gripCoveredPoint(t.id, t.kind);
      await deselect();
      await page.waitForTimeout(420);                 // …and let the tap record lapse
      if (gp && Number.isFinite(gp.x)) {
        gripProbesRun++;
        /* The two-press invariant, run WHERE IT BITES. Measured between the presses of one real
         * double-click: press 1 lands on the body and mounts the grip, and the question is whether
         * press 2 still has this feature to resolve to. This is the assertion that goes red on the
         * pre-fix build — the invariant at an ordinary body point does not, because no grip lands
         * there, which is the whole reason the earlier fixture could not see this. */
        await page.mouse.move(gp.x, gp.y);
        await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 });
        const held = await resolveAt(gp.x, gp.y);
        const same = resolvedKey(held) === `${t.kind}:${t.id}`;
        ok(`${name} — press 1's own ${gp.grip} does not blank the target for press 2`, same,
          same ? `still resolves to ${resolvedKey(held)} at ${gp.x},${gp.y}`
            : `⛔ B233153: with the ${gp.grip} press 1 just mounted, this point resolves to ${resolvedKey(held) || "NOTHING"}`);
        await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
        await page.waitForTimeout(220);
        const gOpened = await panelOpen();
        const label = `${name} — a grip mounted BY press 1 does not eat press 2 (${gp.grip})`;
        if (t.drillOnly) ok(`${label} — GROUPED: drills in, Properties stays shut`, !gOpened, `at ${gp.x},${gp.y}`);
        else ok(label, gOpened, gOpened ? `at ${gp.x},${gp.y}` : `⛔ B233153: double-click at ${gp.x},${gp.y} opened nothing — its own ${gp.grip} took press 2`);
      } else {
        console.log(`SKIP — ${name} — grip-covered press  ::  ${gp && gp.grips ? `${gp.grips} grip(s), none overlapping this feature's own body` : "this feature paints no grips when selected"}`);
      }
    }
  }

  /* ⛔ THE OBSERVED-OR-FAIL CHECK. Both B233153 halves can stop measuring without anything going
   * red — the hook disappears, or a fixture change leaves no grip over any body — and the suite
   * would go on printing a full score. An unobserved guard is the failure mode VIEW-INDEPENDENT-ONCE
   * §6 names, so it is asserted here rather than hoped for. */
  ok("the two-press invariant actually ran", invariantsRun > 0, `${invariantsRun} feature(s)`);
  ok("the hover-armed-chrome probe actually ran (B280402's own case)", hoverProbesRun > 0, `${hoverProbesRun} feature(s)`);
  if (!LOCKED) {
    ok("the grip-covered press actually ran (B233153's own case)", gripProbesRun > 0,
      gripProbesRun > 0 ? `${gripProbesRun} feature(s)` : "⛔ no grip landed over any feature's body — the surveyed-ring pond fixture is not doing its job");
  }

  if (pageErrors.length) console.log("\nPAGE ERRORS:\n" + pageErrors.slice(0, 5).join("\n"));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed (mode: ${MODE})`);
if (failed.length) {
  console.log("FAILED:\n" + failed.map((f) => "  · " + f.name).join("\n"));
  process.exit(1);
}
