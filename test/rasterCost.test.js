import { describe, it, expect } from "vitest";
import {
  bucketOf, bucketTrace, layerCensus, median, noiseFloorPct, armVerdict,
  decodeFault, annotationFault, renderedDecodedBytes, TRACE_BUCKETS, signTestP, pairedComparison,
} from "../ui-audit/lib/rasterCost.mjs";

/* NEW-1 — the half of a gesture's cost that every prior instrument in this program was structurally
 * blind to.
 *
 * The un-quantised work metric is `ScriptDuration + LayoutDuration + RecalcStyleDuration`. All three
 * are main-thread work that happens BEFORE a pixel exists, so none of them can see paint, raster,
 * image decode or compositing — which is exactly where a 4.5-megapixel 55%-alpha overlay spends its
 * time. These tests pin the properties that would otherwise fail silently: the unit conversion (a
 * trace is in MICROSECONDS and a 1000× error would read as a spectacular finding), the refusal to
 * charge unrelated events to render cost, and above all the decode assertion — an arm whose raster
 * never decoded looks exactly like an arm that is fast.
 */

const ev = (name, dur, ts = 0, ph = "X") => ({ name, dur, ts, ph });

describe("bucketing", () => {
  it("maps every declared name to its bucket, and nothing else", () => {
    for (const [bucket, names] of Object.entries(TRACE_BUCKETS)) {
      for (const n of names) expect(bucketOf(n)).toBe(bucket);
    }
    expect(bucketOf("MajorGC")).toBeNull();
  });

  it("converts MICROSECONDS to milliseconds — a 1000× error here would read as a finding", () => {
    const r = bucketTrace([ev("Paint", 1500), ev("RasterTask", 2500)]);
    expect(r.paintMs).toBe(1.5);
    expect(r.rasterMs).toBe(2.5);
    expect(r.totalMs).toBe(4);
  });

  it("counts only complete duration events — a split B/E pair cannot be attributed honestly", () => {
    expect(bucketTrace([ev("Paint", 1000, 0, "B"), ev("Paint", 1000, 0, "E")]).paintMs).toBe(0);
    expect(bucketTrace([{ name: "Paint", ph: "X", ts: 0 }]).paintMs).toBe(0); // no dur
  });

  it("respects the time window", () => {
    const es = [ev("Paint", 1000, 10), ev("Paint", 1000, 5000)];
    expect(bucketTrace(es, { fromUs: 0, toUs: 100 }).paintMs).toBe(1);
    expect(bucketTrace(es).paintMs).toBe(2);
  });

  it("does NOT sweep unrelated events into a render total", () => {
    const r = bucketTrace([ev("MajorGC", 50000), ev("TimerFire", 9000), ev("Paint", 1000)]);
    expect(r.totalMs).toBe(1);
    expect(r.otherNestedMs).toBe(0);
  });

  it("charges render-shaped but unrecognised events to a DIAGNOSTIC list and names them, so a renamed Chromium event is visible", () => {
    const r = bucketTrace([ev("SomeNewPaintThing", 3000)]);
    expect(r.otherNestedMs).toBe(3);
    expect(r.unaccounted[0]).toEqual({ name: "SomeNewPaintThing", ms: 3 });
  });

  /* ⛔ THE REGRESSION THIS PINS COST THIS HARNESS ITS FIRST SET OF NUMBERS. Chromium's render
   * events NEST — `ZeroCopyRasterBuffer::Playback` and `DisplayItemList::Raster` run inside a
   * `RasterTask` — so adding the unrecognised names into the total double-counts the same
   * microseconds and inflates every arm by a plausible-looking margin. */
  it("NEVER adds nested render-shaped events into the total", () => {
    const r = bucketTrace([ev("RasterTask", 5000), ev("ZeroCopyRasterBuffer::Playback", 4800), ev("DisplayItemList::Raster", 4000)]);
    expect(r.rasterMs).toBe(5);
    expect(r.totalMs).toBe(5);          // NOT 13.8
    expect(r.otherNestedMs).toBe(8.8);  // reported, but beside the total rather than inside it
  });

  it("survives junk input", () => {
    expect(bucketTrace(null).totalMs).toBe(0);
    expect(bucketTrace([null, undefined, {}]).totalMs).toBe(0);
  });
});

describe("layerCensus", () => {
  it("sums layer area and reports a NAMED proxy for raster memory", () => {
    const c = layerCensus([{ width: 100, height: 100 }, { width: 200, height: 50 }]);
    expect(c.count).toBe(2);
    expect(c.areaPx).toBe(20000);
    expect(c.rasterProxyMB).toBeCloseTo((20000 * 4) / 1048576, 2); // reported to 2 dp — a byte-exact figure would imply a precision the compositor does not offer
  });
  it("returns nulls rather than a reassuring zero when the layer tree was never read", () => {
    expect(layerCensus(null)).toEqual({ count: null, areaPx: null, rasterProxyMB: null });
  });
});

describe("statistics refuse to manufacture findings", () => {
  it("median handles even and odd lengths and ignores nulls", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([null, undefined, 5])).toBe(5);
    expect(median([])).toBeNull();
  });

  it("the noise floor is MEASURED from repeats, and is null with a single sample", () => {
    expect(noiseFloorPct([10])).toBeNull();
    expect(noiseFloorPct([10, 12])).toBeCloseTo(18.2, 1);
  });

  it("a difference inside the floor is INCONCLUSIVE, never a finding", () => {
    expect(armVerdict(100, 105, 10).verdict).toMatch(/INCONCLUSIVE/);
    expect(armVerdict(100, 140, 10).verdict).toMatch(/DEARER by 40%/);
    expect(armVerdict(100, 50, 10).verdict).toMatch(/CHEAPER by 50%/);
  });

  it("with no floor measured, a difference is explicitly NOT a finding", () => {
    expect(armVerdict(100, 200, null).verdict).toMatch(/NO FLOOR MEASURED/);
  });

  it("an unmeasured arm says so instead of returning 0%", () => {
    expect(armVerdict(null, 100, 5)).toEqual({ pct: null, verdict: "NOT MEASURED" });
    expect(armVerdict(0, 100, 5).pct).toBeNull();
  });
});

describe("the paired comparison — an analysis the interleaved design already supported", () => {
  it("signTestP matches the exact two-sided binomial at p=0.5", () => {
    expect(signTestP(5, 5)).toBeCloseTo(2 * (1 / 32), 6);
    expect(signTestP(0, 5)).toBeCloseTo(2 * (1 / 32), 6);
    expect(signTestP(3, 6)).toBeCloseTo(1, 6);          // dead even → nothing to see
    expect(signTestP(6, 6)).toBeCloseTo(2 / 64, 6);
    expect(signTestP(0, 0)).toBe(1);
  });

  /* ⛔ THE PROPERTY THAT MAKES THIS WORTH ADDING: one contaminated rep hits BOTH arms (they are
   * interleaved), so it must not decide the answer. The range floor cannot do this — a single hot
   * rep widens it until nothing can ever clear it. */
  it("is not decided by a rep that ran hot on BOTH arms", () => {
    const pairs = [[1000, 800], [1010, 810], [4000, 3200], [990, 790], [1005, 805], [995, 795]];
    const r = pairedComparison(pairs);
    expect(r.cheaper).toBe(6);
    expect(r.verdict).toMatch(/CHEAPER in 6\/6/);
    expect(r.medianPct).toBeLessThan(-15);
    // ...whereas the range floor over those same baseline values is enormous and settles nothing.
    expect(noiseFloorPct(pairs.map((p) => p[0]))).toBeGreaterThan(200);
  });

  it("refuses to separate arms that genuinely overlap", () => {
    const r = pairedComparison([[100, 101], [100, 99], [100, 102], [100, 98], [100, 103], [100, 97]]);
    expect(r.verdict).toMatch(/NOT SEPARATED/);
    expect(r.p).toBeGreaterThan(0.05);
  });

  it("reports DEARER as readily as CHEAPER — the test is two-sided", () => {
    expect(pairedComparison([[100, 130], [100, 125], [100, 140], [100, 128], [100, 135], [100, 132]]).verdict).toMatch(/DEARER in 6\/6/);
  });

  it("drops ties rather than counting them for either side", () => {
    const r = pairedComparison([[100, 100], [100, 90], [100, 91], [100, 92], [100, 93]]);
    expect(r.n).toBe(4);
  });

  /* ⛔ SIX PAIRED REPS IS THE MINIMUM THIS TEST CAN EVER SPEAK AT, and it is pinned here so nobody
   * runs five and wonders why a perfectly clean sweep came back silent. Five unanimous reps give a
   * two-sided p of 2/2^5 = 0.0625, which is OVER the 0.05 bar; six give 0.031. That is arithmetic,
   * not a tuning choice — no amount of effect size rescues a five-rep sign test. */
  it("cannot separate anything from five reps, however unanimous — and says so", () => {
    const five = pairedComparison([[100, 50], [100, 51], [100, 49], [100, 52], [100, 48]]);
    expect(five.cheaper).toBe(5);
    expect(five.p).toBeCloseTo(0.0625, 4);
    expect(five.verdict).toMatch(/NOT SEPARATED/);
  });

  it("refuses to report at all below three usable pairs", () => {
    expect(pairedComparison([[100, 90], [100, 91]]).verdict).toMatch(/TOO FEW/);
    expect(pairedComparison(null).verdict).toMatch(/TOO FEW/);
  });
});

describe("the decode assertion — the guard without which every number is a comfortable lie", () => {
  const overlay = { role: "sheetOverlay", imgW: 1728, imgH: 2592, visible: true };
  const underlay = { role: "underlay", imgW: 1800, imgH: 1167, visible: true };

  it("passes when every expected raster decoded at its expected size", () => {
    expect(decodeFault([{ decoded: true, intrinsicW: 1728, intrinsicH: 2592 }], [overlay])).toBeNull();
  });

  it("FAILS when the element is present but never decoded", () => {
    expect(decodeFault([{ decoded: false, intrinsicW: 1728, intrinsicH: 2592 }], [overlay]))
      .toMatch(/RASTER NEVER DECODED/);
  });

  it("FAILS when nothing was rendered at all — the real first-run failure of this harness", () => {
    expect(decodeFault([], [overlay, underlay])).toMatch(/sheetOverlay 1728×2592, underlay 1800×1167/);
  });

  it("FAILS when the wrong size decoded — a stale cached raster is not the arm under test", () => {
    expect(decodeFault([{ decoded: true, intrinsicW: 864, intrinsicH: 1296 }], [overlay]))
      .toMatch(/RASTER NEVER DECODED/);
  });

  it("does not fault an arm that deliberately expects nothing", () => {
    expect(decodeFault([], [])).toBeNull();
    expect(decodeFault([], [{ ...overlay, visible: false }])).toBeNull();
  });

  it("counts texture only for images that actually decoded", () => {
    expect(renderedDecodedBytes([
      { decoded: true, intrinsicW: 10, intrinsicH: 10 },
      { decoded: false, intrinsicW: 1000, intrinsicH: 1000 },
    ])).toBe(400);
  });
});

/* NEW-3 — the same refusal, on the annotation axis. An arm whose callouts, markups and measures
 * never rendered looks EXACTLY like an arm that is fast, which is the whole reason `decodeFault`
 * exists one describe-block up. This one is not hypothetical: on the first run of
 * `annotation-arms.mjs` every arm read 0 of 24 annotations on a page that was rendering all of
 * them, and nothing but this refusal would have caught it. */
describe("annotationFault refuses to report an arm whose annotations never rendered", () => {
  const want = { callouts: 16, markups: 6, measures: 2 };

  it("passes when the canvas holds exactly what the arm specifies", () => {
    expect(annotationFault({ callouts: 16, markups: 6, measures: 2 }, want)).toBeNull();
  });

  it("passes for a stripped arm that expects nothing — zero is a specification, not a failure", () => {
    expect(annotationFault({ callouts: 0, markups: 0, measures: 0 }, { callouts: 0, markups: 0, measures: 0 })).toBeNull();
  });

  it("FAULTS the real first-run failure: everything rendered, nothing counted", () => {
    const fault = annotationFault({ callouts: 0, markups: 0, measures: 0 }, want);
    expect(fault).toMatch(/ANNOTATIONS DID NOT RENDER/);
    expect(fault).toMatch(/callouts: expected 16 on the canvas, counted 0/);
    expect(fault).toMatch(/markups: expected 6/);
    expect(fault).toMatch(/measures: expected 2/);
  });

  it("FAULTS a partial render, which is the subtler and more dangerous case", () => {
    expect(annotationFault({ callouts: 15, markups: 6, measures: 2 }, want)).toMatch(/callouts: expected 16 on the canvas, counted 15/);
  });

  /* ⛔ MORE is a fault too, not a bonus. An arm that dropped the callouts and still counts 16 of
   * them did not take — it measured the baseline under another name, which is precisely the
   * false-null this guard exists to prevent. */
  it("FAULTS an arm that shows MORE than it specifies — the stripped arm that did not take", () => {
    expect(annotationFault({ callouts: 16, markups: 6, measures: 2 }, { callouts: 0, markups: 6, measures: 2 }))
      .toMatch(/callouts: expected 0 on the canvas, counted 16/);
  });

  it("FAULTS a page with no canvas at all rather than reading it as an empty plan", () => {
    expect(annotationFault(null, want)).toMatch(/no canvas/);
  });
});
