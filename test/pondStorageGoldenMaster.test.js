/* B227888 — GOLDEN MASTER: the stored volumes did not move. Not close. EQUAL.
 *
 * ⛔ THE CONSTRAINT THIS EXISTS FOR, from the owner, and it outranks every speed target in the
 * programme: these numbers size his detention basins. Stage storage feeds usable volume feeds
 * detention sizing feeds permitting. **An optimisation that shifts a stored volume by a fraction of
 * a percent is a WORSE outcome than one that saves 50 ms.**
 *
 * B227888's change is a memo and nothing else — no formula was touched — so the claim it has to
 * defend is EXACT equality, and it is asserted with `toBe`, not `toBeCloseTo`. There is no tolerance
 * here and none is justified: a cache either returns the value the function computed or it is
 * broken. If a future change to this path cannot hold `toBe`, the right response is to argue the
 * tolerance ON THE ITEM and not to loosen this file quietly.
 *
 * HOW IT IS ANCHORED, and why it is stronger than a table of committed numbers. A frozen literal
 * only ever proves the implementation still agrees with whatever it happened to produce the day the
 * literal was written — and it goes stale the first time anyone legitimately improves the physics.
 * So the master is computed by the SAME functions with every cache DEFEATED (a fresh ring array per
 * call, which is a guaranteed miss under identity keying), and compared against the cached path.
 * That asserts the property that actually matters — *the cache is transparent* — over the whole
 * stage range of the owner's REAL pond rings, at every setting combination below.
 *
 * The subject is his own geometry: both Bain quiddity basins (48 and 20 vertices) and the fast
 * plan's (7). `ui-audit/fixtures/` holds the plans; nothing here is synthetic.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pondStageModel, stageTable, pondElevations, areaAtElev, dutySplit, outfallSplit } from "../src/workspaces/site-planner/lib/pondStageModel.js";
import { usablePondVolume, detentionStorage, volumeBetween, excavationVolume } from "../src/workspaces/site-planner/lib/pondGeom.js";
import { maxInwardOffset, ringsArea, offsetInward } from "../src/workspaces/site-planner/lib/pondOffset.js";

const FX = join(process.cwd(), "ui-audit", "fixtures");
const load = (f) => JSON.parse(readFileSync(join(FX, f), "utf8"));
const pondsOf = (f, tag) => load(f).els.filter((e) => e.type === "pond").map((e) => ({ label: `${tag} ${e.id.slice(-6)}`, ring: e.points }));

const RINGS = [...pondsOf("bain-quiddity.json", "quiddity"), ...pondsOf("bain-concept-original.json", "original")];

/** A fresh array is a guaranteed cache MISS under identity keying — this is the un-memoised arm. */
const fresh = (ring) => ring.map((p) => ({ x: p.x, y: p.y }));

/* Every setting combination that can move a stored volume: design depth, freeboard, side slope,
 * the top-of-bank anchor, the governing flood elevation and the outfall invert. */
const DETS = [
  { depth: 8, freeboard: 1, slope: 3, tobElev: 100 },
  { depth: 8, freeboard: 1, slope: 4, tobElev: 100 },   // a flatter interior side slope
  { depth: 12, freeboard: 2, slope: 3, tobElev: 100 },  // deeper, more freeboard
  { depth: 21.7, freeboard: 1, slope: 3, tobElev: 151.86 }, // the owner's own original-plan values
  { depth: 6, freeboard: 0.5, slope: 3, tobElev: 40 },  // a shallow basin at a low datum
];

describe("B227888 · golden master — pond storage is unchanged by the memo", () => {
  for (const { label, ring } of RINGS) {
    for (const det of DETS) {
      const tag = `${label} · d${det.depth} fb${det.freeboard} s${det.slope} tob${det.tobElev}`;

      it(`stage table is EQUAL band for band — ${tag}`, () => {
        const master = stageTable(fresh(ring), det, { bandFt: 1 });
        const cached = stageTable(ring, det, { bandFt: 1 });
        if (master === null) { expect(cached).toBe(null); return; }
        expect(cached.bands.length).toBe(master.bands.length);
        expect(cached.totalCf).toBe(master.totalCf);
        cached.bands.forEach((b, i) => {
          const m = master.bands[i];
          expect(b.loFt).toBe(m.loFt);
          expect(b.hiFt).toBe(m.hiFt);
          expect(b.areaLoSf).toBe(m.areaLoSf);
          expect(b.areaHiSf).toBe(m.areaHiSf);
          expect(b.volCf).toBe(m.volCf);
          expect(b.cumCf).toBe(m.cumCf);
        });
      });

      it(`elevations, duty split and outfall split are EQUAL — ${tag}`, () => {
        const floodElevFt = det.tobElev - 3, outletInvertFt = det.tobElev - 5;
        expect(pondElevations(ring, det)).toEqual(pondElevations(fresh(ring), det));
        expect(dutySplit(ring, det, { floodElevFt })).toEqual(dutySplit(fresh(ring), det, { floodElevFt }));
        expect(outfallSplit(ring, det, { outletInvertFt })).toEqual(outfallSplit(fresh(ring), det, { outletInvertFt }));
      });

      it(`the whole assembled model is EQUAL — ${tag}`, () => {
        const opts = { floodElevFt: det.tobElev - 3, outletInvertFt: det.tobElev - 5, bandFt: 1, id: "p", name: "Pond" };
        expect(pondStageModel(ring, det, opts)).toEqual(pondStageModel(fresh(ring), det, opts));
      });

      it(`usable / gross / excavation volumes are EQUAL — ${tag}`, () => {
        const o = { wseFt: det.tobElev - 3, gradeFt: det.tobElev - 2 };
        expect(usablePondVolume(ring, det, o)).toEqual(usablePondVolume(fresh(ring), det, o));
        expect(detentionStorage(ring, det.depth, det.freeboard, det.slope))
          .toEqual(detentionStorage(fresh(ring), det.depth, det.freeboard, det.slope));
        expect(excavationVolume(ring, det)).toBe(excavationVolume(fresh(ring), det));
      });

      it(`storage is EQUAL at EVERY stage across the full range — ${tag}`, () => {
        /* Not just the endpoints: the volume and the wetted area are checked at a fine sweep from
         * the achievable floor to the top of bank, which is the curve a routing calculation and an
         * outlet rating actually read. */
        const el = pondElevations(ring, det);
        if (!el) return;
        for (let e = el.floorElev; e <= el.tobElev + 1e-9; e += 0.25) {
          expect(areaAtElev(ring, det, e)).toBe(areaAtElev(fresh(ring), det, e));
          expect(volumeBetween(ring, det, el.floorElev, e)).toBe(volumeBetween(fresh(ring), det, el.floorElev, e));
        }
      });
    }

    it(`the pinch-off reach and every inward offset are EQUAL — ${label}`, () => {
      expect(maxInwardOffset(ring)).toBe(maxInwardOffset(fresh(ring)));
      for (let d = 1; d < 60; d += 2.5) {
        expect(ringsArea(offsetInward(ring, d))).toBe(ringsArea(offsetInward(fresh(ring), d)));
      }
    });
  }
});
