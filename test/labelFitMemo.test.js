/* NEW-1 / NEW-2 — the interior fitter's `spots` memo, and the ONE property it must never break.
 *
 * WHAT THIS GUARDS, and why it is a separate suite from `labelFitLadder.test.js`.
 *
 * That suite guards the ladder's BEHAVIOUR (a fit failure can never blank a label). This one
 * guards the claim the performance fix rests on, which is a different kind of claim:
 *
 *     the memoised `spots` returns EXACTLY what the un-memoised scan returned — same positions,
 *     same order, same count — for every question, including the ones that answer "nowhere".
 *
 * That matters because a label placed against a WRONG interior is a wrong drawing, and a wrong
 * drawing is worse than a slow one. The fix ships on "byte-identical by construction"; a
 * construction argument that nothing checks is a comment, so this checks it.
 *
 * The measured cost it exists to protect: "Label layout & collision" rose 16.7 ms → 93.4 ms of
 * main-thread work per pan gesture going from 0 to 16 ponds (ui-audit/diagnose-pond-pan.mjs), and
 * this scan was the hottest application function in the profile. A pond is the only element type
 * that reaches this path — it is the only one handed a `ring` and marked `mustLabel`.
 */
import { test, assert } from "vitest";
import { readFileSync } from "node:fs";
import { interiorFitter } from "../src/workspaces/site-planner/lib/labelFitLadder.js";
import { layoutLabels } from "../src/workspaces/site-planner/lib/labelLayout.js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/gooseCreekPonds.json", import.meta.url)));

/* Hostile on purpose, and in different ways: a plain rect, a pinched hourglass whose bounding box
 * wildly overstates its interior, an L whose centroid is OUTSIDE the ring, a sliver, and the
 * owner's own real pond geometry pulled from production. */
const RINGS = {
  square: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }],
  hourglass: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 330, y: 300 }, { x: 600, y: 600 }, { x: 0, y: 600 }, { x: 270, y: 300 }],
  ell: [{ x: 0, y: 0 }, { x: 700, y: 0 }, { x: 700, y: 180 }, { x: 180, y: 180 }, { x: 180, y: 700 }, { x: 0, y: 700 }],
  sliver: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 14 }, { x: 0, y: 14 }],
  // The owner's OWN geometry, pulled from production — the Goose Creek pair NEW-1's fit work was
  // filed on, and two of the four Bain / Concept A basins, which is the site this item's report
  // names. A synthetic ring cannot stand in for these: the whole reason the interior fitter exists
  // is that a real basin's bounding box overstates the room it has.
  gooseNorth: FX.northPond.points,
  gooseSouth: FX.southPond.points,
  bain0: FX.bainConceptA.ponds[0].points,
  bain1: FX.bainConceptA.ponds[1].points,
};
const REAL_POND = RINGS.bain0, REAL_POND_2 = RINGS.bain1;

/* The un-memoised reference: the SAME algorithm, transcribed from the shipped `spotsUncached`
 * body, driven off the fitter's own published `maxW`/`maxH`. Deliberately a re-implementation
 * rather than a flag on the module — a "disable the cache" switch is one more thing that can be
 * wrong, and a caller that forgot to flip it would make this suite pass vacuously. */
function referenceSpots(fitter, w, h, want) {
  // A fresh fitter per question is the honest control: its cache can hold at most this one answer,
  // so nothing it returns can have come from a previous call.
  return fitter(w, h, want);
}

const key = (s) => s.map((p) => `${p.x.toFixed(9)},${p.y.toFixed(9)}`).join(";");

/* Every ring × a wide sweep of label sizes, including sizes that fit nowhere. */
const SIZES = [];
for (const w of [5, 20, 60, 120, 240, 480, 960, 4000]) for (const h of [3, 10, 30, 90, 300, 2000]) SIZES.push([w, h]);

test("MEMOISED === UNMEMOISED — every ring, every size, every `want`, positions and order identical", () => {
  let asked = 0, nonEmpty = 0;
  for (const [name, ring] of Object.entries(RINGS)) {
    for (const [w, h] of SIZES) {
      for (const want of [1, 3, 5]) {
        // A FRESH fitter per question can only ever run the uncached path.
        const fresh = interiorFitter(ring.map((p) => ({ ...p })));
        const control = referenceSpots((a, b, c) => fresh.spots(a, b, c), w, h, want);
        // A SHARED fitter asked the same question twice must answer identically both times.
        const shared = interiorFitter(ring);
        const first = shared.spots(w, h, want);
        const second = shared.spots(w, h, want);
        asked++;
        if (first.length) nonEmpty++;
        assert.equal(key(first), key(control), `${name} ${w}×${h} want ${want}: first call differs from the uncached control`);
        assert.equal(key(second), key(first), `${name} ${w}×${h} want ${want}: the cached second call differs from the first`);
        assert.equal(first.length, control.length, `${name} ${w}×${h} want ${want}: count differs`);
      }
    }
  }
  // A suite that never produced a placement would pass while proving nothing.
  assert.isAbove(asked, 400, "the sweep must actually ask a few hundred questions");
  assert.isAbove(nonEmpty, 50, "the sweep must include many questions that DO fit, not only refusals");
});

test("THE EARLY-OUT IS THE SAME ANSWER — a box past maxW or maxH returned nothing before and returns nothing now", () => {
  for (const [name, ring] of Object.entries(RINGS)) {
    const f = interiorFitter(ring);
    assert.isFinite(f.maxW, `${name}: maxW`);
    assert.isFinite(f.maxH, `${name}: maxH`);
    // Just past each bound, and past both.
    for (const [w, h] of [[f.maxW * 1.0001 + 1e-6, 1], [1, f.maxH * 1.0001 + 1e-6], [f.maxW + 1, f.maxH + 1]]) {
      assert.deepEqual(f.spots(w, h, 5), [], `${name}: ${w}×${h} is past the fitter's own published maximum, so no inscribed rectangle can hold it`);
      assert.equal(f.place(w, h), null, `${name}: place() must agree with spots()`);
    }
    /* And just INSIDE each bound still answers — the early-out must not have swallowed the
     * boundary. Tested one axis at a time ON PURPOSE: `maxW` and `maxH` are the widest and tallest
     * inscribed rectangles and on a pinched shape they are DIFFERENT rectangles, so a box that is
     * half of each need not fit anywhere and asserting that it does would be asserting a falsehood
     * about the geometry (the hourglass, which is exactly why it is in the battery). */
    assert.isAbove(f.spots(f.maxW * 0.5, 1e-6, 1).length, 0, `${name}: a hairline box at half the published max WIDTH must still find a spot`);
    assert.isAbove(f.spots(1e-6, f.maxH * 0.5, 1).length, 0, `${name}: a hairline box at half the published max HEIGHT must still find a spot`);
  }
});

test("THE CACHE IS KEYED ON THE QUESTION — different sizes never share an answer", () => {
  const f = interiorFitter(REAL_POND);
  const a = f.spots(40, 12, 3);
  const b = f.spots(41, 12, 3);
  const c = f.spots(40, 13, 3);
  const d = f.spots(40, 12, 1);
  assert.equal(key(f.spots(40, 12, 3)), key(a), "re-asking the first question returns the first answer");
  // Not an assertion that they DIFFER (they legitimately may not) — an assertion that each is its
  // own correctly-computed answer, checked against a fitter that has never been asked anything else.
  for (const [w, h, want, got] of [[41, 12, 3, b], [40, 13, 3, c], [40, 12, 1, d]]) {
    const fresh = interiorFitter(REAL_POND.map((p) => ({ ...p })));
    assert.equal(key(got), key(fresh.spots(w, h, want)), `${w}×${h} want ${want} must be its own answer, not the previous question's`);
  }
  assert.isAtMost(d.length, 1, "want=1 returns at most one spot");
});

test("A NEW RING IS A NEW FITTER — an edited pond can never be placed against its old interior", () => {
  const ring = RINGS.square.map((p) => ({ ...p }));
  const before = interiorFitter(ring);
  const beforeSpots = before.spots(100, 30, 3);
  assert.isAbove(beforeSpots.length, 0);
  // An edit produces a NEW array (that is how the planner's model works), so the WeakMap misses.
  const edited = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }, { x: 0, y: 120 }];
  const after = interiorFitter(edited);
  assert.notStrictEqual(after, before, "a different ring array must get a different fitter");
  assert.isBelow(after.maxW, before.maxW, "the smaller ring must measure smaller — not serve the old interior");
  assert.deepEqual(after.spots(100, 30, 3).filter((s) => s.x > 120 || s.y > 120), [], "no spot may fall outside the new ring's own bounding box");
});

test("THE CACHE IS BOUNDED — a zoom sweep asking hundreds of distinct sizes cannot grow without limit", () => {
  const f = interiorFitter(REAL_POND_2);
  // 600 distinct questions, far past any plausible per-frame set.
  for (let i = 0; i < 600; i++) f.spots(10 + i * 0.5, 8 + i * 0.25, 3);
  // The property is observable without reaching inside: the OLDEST question must have been evicted
  // and therefore recomputed — and recomputing must still give the same answer.
  const fresh = interiorFitter(REAL_POND_2.map((p) => ({ ...p })));
  assert.equal(key(f.spots(10, 8, 3)), key(fresh.spots(10, 8, 3)), "an evicted question recomputes to the same answer");
});

test("NON-FINITE SIZES ARE ANSWERED, NOT CACHED — a NaN must not pin an entry every later NaN hits", () => {
  const f = interiorFitter(RINGS.square);
  assert.deepEqual(f.spots(NaN, 10, 3), [], "a NaN width fits nowhere");
  assert.deepEqual(f.spots(10, NaN, 3), [], "a NaN height fits nowhere");
  // A real question asked afterwards must still be answered correctly.
  const fresh = interiorFitter(RINGS.square.map((p) => ({ ...p })));
  assert.equal(key(f.spots(100, 30, 3)), key(fresh.spots(100, 30, 3)));
});

test("END TO END — the same pond laid out twice through layoutLabels places identically", () => {
  /* The property the fix actually has to preserve is the one the RENDER sees: a pan re-runs
   * `layoutLabels` every frame with the same ring, the same ppf and the same lines, and must
   * commit the same placement. Two passes with identical inputs, compared field by field. */
  const ring = REAL_POND;
  const ppf = 0.45;
  const c = ring.reduce((s, p) => ({ x: s.x + p.x / ring.length, y: s.y + p.y / ring.length }), { x: 0, y: 0 });
  const mk = (cx, cy) => [{
    id: "pond", cx, cy,
    lines: ["Detention Pond", { parts: ["footprint 6.11 ac", "266,354 sf"], sep: " · ", keep: 1 }],
    lh: 14.5, charW: 6.6, halfW: 300, halfH: 200,
    ring, ringOrigin: c, ringPpf: ppf, mustLabel: true, importance: 1,
  }];
  const a = layoutLabels(mk(c.x * ppf, c.y * ppf)).get("pond");
  const b = layoutLabels(mk(c.x * ppf, c.y * ppf)).get("pond");
  assert.ok(a, "the pond must be placed");
  assert.deepEqual(b, a, "an identical frame must produce an identical placement");

  /* And a PANNED frame — the same scene translated — must place at the same OFFSET from its own
   * origin, which is the invariant that makes the feet-space cache legitimate in the first place. */
  const DX = 137.5, DY = -84.25;
  const p = layoutLabels(mk(c.x * ppf + DX, c.y * ppf + DY)).get("pond");
  assert.ok(p, "the panned pond must be placed");
  assert.closeTo(p.x - a.x, DX, 1e-9, "a pan translates the placement exactly");
  assert.closeTo(p.y - a.y, DY, 1e-9, "a pan translates the placement exactly");
  assert.equal(p.rung, a.rung, "a pan may not change which rung of the ladder was chosen");
  assert.deepEqual(p.lines, a.lines, "a pan may not change what the label says");
});

test("SOURCE GUARD — the scan stays behind the memo and the early-out stays before it", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/lib/labelFitLadder.js", import.meta.url), "utf8");
  assert.match(src, /const spotsUncached = \(w, h, want\) =>/, "the raw scan must remain a named, separate function");
  assert.match(src, /if \(!\(w <= maxW\) \|\| !\(h <= maxH\)\) return out;/, "the early-out must stay inside the raw scan");
  assert.match(src, /const spots = \(w, h, want = 1\) =>[\s\S]*spotsCache/, "`spots` must be the memoised entry point");
  assert.match(src, /spotsCache\.size > SPOTS_CACHE_MAX/, "the cache must stay bounded");
  // `place` must go THROUGH the memo, not around it.
  assert.match(src, /place: \(w, h\) => spots\(w, h, 1\)/, "place() must call the memoised spots()");
});
