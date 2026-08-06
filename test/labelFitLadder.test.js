// NEW-2 — the shared map-label fit ladder, and the ONE invariant that must never come back.
//
// NEW-1 fixed two pond labels. The property that actually broke, though, was not pond-specific:
// the fit chain's terminal branch was "say nothing". Without a guard, a shared module will let
// that return on a different element type the first time somebody adds a rung.
//
// The invariant, stated once: **a label may be relocated or abbreviated, but a FIT failure alone
// can never produce no label at all.** Hiding stays available to the COLLISION engine as a
// deliberate declutter decision; it is not, and may never be, the end of the fit ladder.
import { test, assert } from "vitest";
import { readFileSync } from "node:fs";
import { layoutLabels, boxOf } from "../src/workspaces/site-planner/lib/labelLayout.js";
import { labelForms, inlineLines, interiorFitter, pointInRing, LADDER_RUNGS } from "../src/workspaces/site-planner/lib/labelFitLadder.js";

// ── the battery ────────────────────────────────────────────────────────────────────────────
// Shapes chosen to be hostile to a fit test in different ways: a normal rect, a sliver, a
// pinched hourglass (bounding box wildly overstates the interior), an L (centroid falls OUTSIDE
// the ring), a long-thin bar and a tall-narrow column.
const RINGS = {
  square: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }],
  sliver: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 14 }, { x: 0, y: 14 }],
  hourglass: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 330, y: 300 }, { x: 600, y: 600 }, { x: 0, y: 600 }, { x: 270, y: 300 }],
  ell: [{ x: 0, y: 0 }, { x: 700, y: 0 }, { x: 700, y: 180 }, { x: 180, y: 180 }, { x: 180, y: 700 }, { x: 0, y: 700 }],
  bar: [{ x: 0, y: 0 }, { x: 1600, y: 0 }, { x: 1600, y: 130 }, { x: 0, y: 130 }],
  column: [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 1400 }, { x: 0, y: 1400 }],
};
const LABELS = {
  short: ["Pond"],
  reflowable: ["Detention Pond", { parts: ["footprint 6.11 ac", "266,354 sf"], sep: " · ", keep: 1 }],
  plainWide: ["A Very Long Element Name Indeed", "1,234,567 sf", "1,400′ × 900′"],
  fourLine: ["Building 12", "584,231 sf", "(incl. 4 bump-outs)", "516′ × 1,107′"],
};
const bbox = (r) => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const p of r) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); } return { x0, x1, y0, y1 }; };
const centroid = (r) => { let a = 0, cx = 0, cy = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; const f = p.x * q.y - q.x * p.y; a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f; } a /= 2; return { x: cx / (6 * a), y: cy / (6 * a) }; };

function item(ringKey, labelKey, ppf, extra = {}) {
  const ring = RINGS[ringKey], b = bbox(ring), c = centroid(ring);
  const ls = Math.max(0.34, Math.min(1, ppf / 0.45)), fs = 11 * ls;
  return {
    id: `${ringKey}/${labelKey}/${ppf}`, cx: c.x * ppf, cy: c.y * ppf,
    lines: LABELS[labelKey], lh: 14.5 * ls, charW: fs * 0.6,
    halfW: ((b.x1 - b.x0) / 2) * ppf, halfH: ((b.y1 - b.y0) / 2) * ppf,
    ring, ringOrigin: c, ringPpf: ppf, importance: 1, ...extra,
  };
}
const ZOOMS = [1.2, 0.45, 0.2, 0.08, 0.03];

test("INVARIANT — with nothing to collide with, EVERY label is placed", () => {
  // No obstacles means no collision can be blamed. Anything missing here is a pure fit failure,
  // which the ladder must make impossible. 6 shapes × 4 label sets × 5 zooms × rotation.
  let n = 0;
  for (const rk of Object.keys(RINGS)) for (const lk of Object.keys(LABELS)) for (const ppf of ZOOMS) for (const rot of [0, 90]) {
    const it = { ...item(rk, lk, ppf), rot };
    const p = layoutLabels([it], {}).get(it.id);
    assert.ok(p, `${it.id} rot${rot}: a fit failure alone must never blank a label`);
    assert.ok(p.lines.length >= 1 && p.lines[0], `${it.id} rot${rot}: the name line always survives`);
    assert.ok(LADDER_RUNGS.includes(p.rung), `${it.id}: rung "${p.rung}" is not in the ladder`);
    if (p.rung === "outside") assert.ok(p.leader, `${it.id}: an outside placement must carry a leader`);
    n++;
  }
  assert.equal(n, 6 * 4 * 5 * 2);
});

test("INVARIANT holds for RECT elements too (no ring — the bounding box is the interior)", () => {
  for (const lk of Object.keys(LABELS)) for (const ppf of ZOOMS) {
    const it = { id: `rect/${lk}/${ppf}`, cx: 0, cy: 0, lines: LABELS[lk], lh: 14.5, charW: 6.6,
      halfW: 40 * ppf, halfH: 25 * ppf, importance: 1 };
    const p = layoutLabels([it], {}).get(it.id);
    assert.ok(p, `${it.id}: a rect element must not be blanked by a fit failure either`);
  }
});

test("a mustLabel element survives a fully contested field; a plain one may still declutter", () => {
  const wall = boxOf(0, 0, 40000, 40000); // nothing anywhere can be placed cleanly
  const plain = item("square", "reflowable", 0.45);
  assert.equal(layoutLabels([plain], { obstacles: [wall] }).get(plain.id), undefined,
    "an ordinary label may still yield to a collision — that is declutter, not a fit failure");
  const must = { ...plain, id: "must", mustLabel: true };
  const p = layoutLabels([must], { obstacles: [wall] }).get("must");
  assert.ok(p && p.lines[0], "a mustLabel element (a pond) is never left unnamed");
});

test("noLeader keeps its B195 behaviour — overflow in place, never a leader", () => {
  // A trailer strip is sized to its own real-world extent and must not float outside itself.
  const it = { id: "tr", cx: 0, cy: 0, lines: ["50′ Trailer Parking", "14 trailers"],
    lh: 6, charW: 3, halfW: 8, halfH: 4, noLeader: true, importance: 1 };
  const p = layoutLabels([it], {}).get("tr");
  assert.ok(p, "a noLeader label still renders");
  assert.equal(p.leader, null, "a noLeader label is never leadered out");
  assert.equal(p.x, 0); assert.equal(p.y, 0);
});

test("the ladder REFLOWS before it DROPS information", () => {
  // A shape that can hold the stacked form but not the wide one must stack — not silently bin
  // the square footage, and not leader out. (The rung order is the owner-specified ladder.)
  const ring = [{ x: 0, y: 0 }, { x: 280, y: 0 }, { x: 280, y: 900 }, { x: 0, y: 900 }];
  const c = centroid(ring), ppf = 0.45;
  const it = { id: "p", cx: c.x * ppf, cy: c.y * ppf, ring, ringOrigin: c, ringPpf: ppf,
    lines: LABELS.reflowable, lh: 14.5, charW: 6.6, halfW: 140 * ppf, halfH: 450 * ppf, importance: 1 };
  const p = layoutLabels([it], {}).get("p");
  assert.equal(p.rung, "stacked");
  assert.equal(p.lines.length, 3, "acreage and square footage each get their own line");
  assert.equal(p.leader, null, "stacking fit, so nothing leadered out");
});

test("interiorFitter never reports a box that leaves the ring", () => {
  for (const [key, ring] of Object.entries(RINGS)) {
    const fit = interiorFitter(ring);
    assert.ok(fit, `${key}: fitter must build`);
    for (const [fw, fh] of [[0.9, 0.2], [0.5, 0.5], [0.2, 0.9], [0.3, 0.3]]) {
      const w = fit.maxW * fw, h = fit.maxH * fh;
      const s = fit.place(w, h);
      if (!s) continue;
      for (const dx of [-0.5, 0.5]) for (const dy of [-0.5, 0.5]) {
        assert.ok(pointInRing(ring, { x: s.x + dx * w, y: s.y + dy * h }),
          `${key}: a reported ${w.toFixed(0)}×${h.toFixed(0)} box must lie inside the ring`);
      }
    }
  }
});

test("interiorFitter sees through a pinch the bounding box cannot", () => {
  // The hourglass's bbox is 600 wide; its waist is 60. A bbox test would happily promise ~600.
  const fit = interiorFitter(RINGS.hourglass);
  assert.ok(fit.maxW < 600, "the interior is narrower than the bounding box");
  // A full-width band across the middle cannot fit — the waist forbids it.
  assert.equal(fit.place(560, 400), null);
});

test("interiorFitter handles a centroid that falls OUTSIDE its own ring (the L)", () => {
  // centroid of the L sits in the notch, i.e. outside the polygon — the case where anchoring a
  // label at the centroid puts it on nothing at all.
  assert.equal(pointInRing(RINGS.ell, centroid(RINGS.ell)), false, "precondition: centroid is outside the L");
  const fit = interiorFitter(RINGS.ell);
  // maxW and maxH belong to DIFFERENT arms of the L, so asking for both at once must fail —
  // that is the bounding-box mistake, refused.
  assert.equal(fit.place(fit.maxW * 0.9, fit.maxH * 0.9), null, "the two arms are not one rectangle");
  const s = fit.place(400, 120); // fits the horizontal arm
  assert.ok(s && pointInRing(RINGS.ell, s), "the fitter still lands the label on real ground");
});

test("labelForms / inlineLines never return an empty or object-valued line", () => {
  const cases = [[], null, [""], ["a"], LABELS.reflowable, LABELS.fourLine,
    [{ parts: [], sep: " · " }], [{ parts: ["one"], sep: " · " }],
    ["name", { parts: ["a", "b", "c"], sep: " · ", keep: 2 }]];
  for (const c of cases) {
    for (const f of labelForms(c)) {
      assert.ok(f.lines.length >= 1, "a form always has a line");
      for (const l of f.lines) assert.equal(typeof l, "string");
      assert.ok(LADDER_RUNGS.includes(f.rung));
    }
    for (const l of inlineLines(c)) assert.equal(typeof l, "string");
  }
  assert.deepEqual(labelForms(["name", { parts: ["a", "b", "c"], sep: " · ", keep: 2 }])
    .map((f) => f.lines), [["name", "a · b · c"], ["name", "a", "b", "c"], ["name", "a · b"]]);
});

// ── which label types consume the shared ladder ────────────────────────────────────────────
// Source guard: the planner must hand the ladder a RING for every polygon candidate and mark a
// pond `mustLabel`. Without this, somebody re-derives fit from the bounding box in a later edit
// and the interior measurement quietly stops happening.
test("SitePlanner feeds the shared ladder its ring, and marks ponds mustLabel", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  assert.match(src, /const ringOpts = poly \? \{ ring: el\.points, ringOrigin: fc, ringPpf: view\.ppf \} : null/,
    "every polygon label candidate must carry its ring");
  assert.match(src, /mustLabel: el\.type === "pond"/, "a pond label may never be blanked");
  assert.match(src, /ring: d\.ring, ringOrigin: d\.ringOrigin, ringPpf: d\.ringPpf, mustLabel: d\.mustLabel/,
    "the ring/mustLabel keys must actually reach layoutLabels");
  // NEW-1 — the pond's area line is now a single atom ("6.58 ac"), so there is nothing left to
  // pre-join; what this guard protects is that both pond call sites still go through ONE shared
  // builder rather than each growing its own string. The reflow rungs stay exercised by the
  // pond's "Holds … ac-ft usable · …′ rim to floor" line, asserted just below.
  assert.match(src, /lines\.push\(pondAreaLabelLine\(area\)\);/, "the pond area line comes from the shared builder");
  assert.match(src, /lines\.push\(pondAreaLabelLine\(exA\)\);/, "…and so does the existing-basin one");
  assert.ok(!/footprintLabelLine/.test(src), "the old footprint+sf line is gone, not merely unused");
  assert.match(src, /parts: \[`Holds \$\{f1\(usableAcFt\)\} ac-ft usable`/,
    "a reflowable multi-atom pond line must still exist, or the stacked/abbrev rungs go dead");
  // The ladder is the ONE place fit is decided: no second bounding-box fit test may grow beside it.
  const engine = readFileSync(new URL("../src/workspaces/site-planner/lib/labelLayout.js", import.meta.url), "utf8");
  assert.match(engine, /import \{ labelForms, interiorFitter \} from "\.\/labelFitLadder\.js"/,
    "the collision engine consumes the shared ladder rather than forking its own");
});
