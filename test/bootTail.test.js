/* The post-draw-tail instrument's pure half (NEW-1, speed program phase 4).
 *
 * The browser half needs Chromium and a real boot. These are the parts that can go red in
 * `npm test`, and — as with bootTimeline's suite — they are the parts whose failure would be
 * INVISIBLE in the report rather than loud. Four properties, each of which the whole instrument
 * rests on, and each of which has already been wrong once in this file's short life:
 *
 *   1. A WINDOW THAT NEVER WENT QUIET IS NOT A TAIL. `settlePoint` must refuse to report a settle
 *      it did not observe, rather than rounding the observation ceiling down into a number.
 *   2. THE LEDGER MUST EMIT EMPTY BUCKETS. A gap is a finding; a table that silently omits the
 *      quiet stretch makes a busy tail out of an idle one.
 *   3. A CANDIDATE THAT NEVER FIRED IS A REFUTATION, and must be reported as one — never dropped.
 *      (The first run of this instrument reported "no tile ever arrived" while 246 were being
 *      served, because the matcher was reading the last path segment of an extensionless tile URL.
 *      The verdict was structurally right and factually wrong, which is the worst combination.)
 *   4. THE LADDER'S FLOOR CARRIES NO FRAME QUANTUM. `noiseFloor` in lib/longSession.mjs floors at
 *      one 16.7 ms frame, which is correct for a frame median and would silently make a real
 *      difference in an un-quantised work metric unreportable.
 */
import { describe, it, expect } from "vitest";
import {
  settlePoint, tailQuality, ledgerBuckets, firstSightings, workNoiseFloor, ladderVerdict, median,
  DEFAULT_QUIET_MS,
} from "../ui-audit/lib/bootTail.mjs";

const ev = (tMs, kind = "mutation", name = null, count = 1) => ({ tMs, kind, name, count });

describe("settlePoint — the window may only end where silence was OBSERVED", () => {
  it("settles at the last event before a quiet run of at least quietMs", () => {
    const s = settlePoint([ev(100), ev(400), ev(900)], { from: 0, observedTo: 3000, quietMs: 750 });
    expect(s.settled).toBe(true);
    expect(s.settledAtMs).toBe(900);
    expect(s.tailMs).toBe(900);
    expect(s.lastEvent.tMs).toBe(900);
  });

  it("takes the FIRST qualifying gap, not the last event of the run", () => {
    // A burst, a long silence, then a late straggler. The tail ended at the burst.
    const s = settlePoint([ev(100), ev(200), ev(5000)], { from: 0, observedTo: 6000, quietMs: 750 });
    expect(s.settledAtMs).toBe(200);
    expect(s.tailMs).toBe(200);
  });

  it("REFUSES to settle when the harness simply stopped watching", () => {
    // Events right up to the end: this is a truncation, not a settle, and must never be reported
    // as a 900 ms tail just because 900 ms is where we stopped looking.
    const s = settlePoint([ev(100), ev(500), ev(900)], { from: 0, observedTo: 1000, quietMs: 750 });
    expect(s.settled).toBe(false);
    expect(s.settledAtMs).toBeNull();
    expect(s.tailMs).toBeNull();
    expect(s.why).toMatch(/never went quiet/);
    expect(s.why).toMatch(/AT LEAST 1000 ms/);
  });

  it("an empty window is a settle only if it was watched for long enough", () => {
    expect(settlePoint([], { from: 0, observedTo: 2000, quietMs: 750 }).settled).toBe(true);
    expect(settlePoint([], { from: 0, observedTo: 2000, quietMs: 750 }).tailMs).toBe(0);
    const short = settlePoint([], { from: 0, observedTo: 300, quietMs: 750 });
    expect(short.settled).toBe(false);
    expect(short.why).toMatch(/only watched for 300 ms/);
  });

  it("ignores everything at or before the window start", () => {
    const s = settlePoint([ev(10), ev(50), ev(600)], { from: 100, observedTo: 3000, quietMs: 750 });
    expect(s.settledAtMs).toBe(600);
    expect(s.events).toBe(1);
  });

  it("has a stated default quiet run", () => {
    expect(DEFAULT_QUIET_MS).toBe(750);
  });
});

describe("tailQuality — busy vs idle first, and the UNATTRIBUTED share stated against B1431's standard", () => {
  const phases = [
    { phase: "idle — main thread free", ms: 60, pct: 60 },
    { phase: "React render & commit", ms: 30, pct: 30 },
    { phase: "UNATTRIBUTED", ms: 10, pct: 10 },
  ];
  it("splits busy from idle and totals exactly", () => {
    const q = tailQuality({ phases });
    expect(q.totalMs).toBe(100);
    expect(q.idleMs).toBe(60);
    expect(q.busyMs).toBe(40);
    expect(q.busyPct).toBe(40);
  });
  it("fails the standard loudly when too much is unnamed", () => {
    const q = tailQuality({ phases });
    expect(q.unattributedPct).toBe(10);
    expect(q.meetsStandard).toBe(false);
  });
  it("passes at B1431's 0.8%", () => {
    const q = tailQuality({ phases: [{ phase: "React render & commit", ms: 99.5, pct: 99.5 }, { phase: "UNATTRIBUTED", ms: 0.5, pct: 0.5 }] });
    expect(q.meetsStandard).toBe(true);
  });
});

describe("ledgerBuckets — a gap is a finding, so empty buckets are emitted", () => {
  it("emits every bucket in the window, including the empty ones", () => {
    const b = ledgerBuckets([ev(10), ev(20), ev(760)], { from: 0, to: 1000, bucketMs: 250 });
    expect(b.length).toBe(4);
    expect(b[0].total).toBe(2);
    expect(b[1].total).toBe(0);
    expect(b[2].total).toBe(0);
    expect(b[3].total).toBe(1);
  });
  it("counts multi-record events by their count, not as one", () => {
    const b = ledgerBuckets([ev(10, "mutation", "canvas", 3200)], { from: 0, to: 250, bucketMs: 250 });
    expect(b[0].byKind.mutation).toBe(3200);
  });
  it("puts an event exactly on the last edge in the last bucket, never off the end", () => {
    const b = ledgerBuckets([ev(249.9)], { from: 0, to: 250, bucketMs: 250 });
    expect(b.length).toBe(1);
    expect(b[0].total).toBe(1);
  });
});

describe("firstSightings — a candidate that never fired is a RESULT, not an omission", () => {
  const events = [ev(300, "network", "tile"), ev(400, "idb", "kv.get"), ev(500, "network", "tile")];
  it("reports the FIRST occurrence", () => {
    const s = firstSightings(events, [{ label: "tile", kind: "network", match: /^tile$/ }]);
    expect(s[0].atMs).toBe(300);
    expect(s[0].verdict).toBe("OBSERVED");
  });
  it("reports a never-fired candidate as a refutation, and keeps its row", () => {
    const s = firstSightings(events, [{ label: "supabase", kind: "network", match: /^supabase$/ }]);
    expect(s.length).toBe(1);
    expect(s[0].atMs).toBeNull();
    expect(s[0].verdict).toMatch(/refuted/);
  });
  it("does not match a different kind that happens to share a name", () => {
    const s = firstSightings([ev(100, "mutation", "tile")], [{ label: "tile", kind: "network", match: /^tile$/ }]);
    expect(s[0].atMs).toBeNull();
  });
});

describe("workNoiseFloor — no frame quantum, deliberately", () => {
  it("is spread over median, with nothing floored in", () => {
    const f = workNoiseFloor([100, 102, 104]);
    expect(f.median).toBe(102);
    expect(f.floorPct).toBe(3.9); // 4/102
  });
  it("does NOT impose lib/longSession's 16.7 ms frame quantum on a work metric", () => {
    // A 500 ms gesture whose repeats agree to 2 ms. The frame-quantum floor would call this ±3.3%;
    // this metric has no frame grid in it, so the honest floor is ±0.4%.
    const f = workNoiseFloor([500, 501, 502]);
    expect(f.floorPct).toBeLessThan(1);
  });
  it("refuses to state a floor from one repeat", () => {
    expect(workNoiseFloor([500]).floorPct).toBeNull();
    expect(workNoiseFloor([500]).why).toMatch(/fewer than two/);
  });
});

describe("ladderVerdict — the one-line answer, and it may not be given without a floor", () => {
  const rungs = [
    { tSec: 1, workMs: [100, 102, 101] },
    { tSec: 2, workMs: [103, 104, 102] },
    { tSec: 3, workMs: [140, 142, 141] },
  ];
  it("says YES when the rise clears the floor", () => {
    const v = ladderVerdict(rungs, { floorPct: 5 });
    expect(v.answer).toMatch(/^YES/);
    expect(v.rows.find((r) => r.tSec === 3).deltaPct).toBeCloseTo(39.6, 0);
  });
  it("says NO when the rise is inside the floor", () => {
    const v = ladderVerdict(rungs, { floorPct: 60 });
    expect(v.answer).toMatch(/^NO/);
    expect(v.answer).toMatch(/INSIDE the measured/);
  });
  it("REFUSES to answer without a measured floor", () => {
    const v = ladderVerdict(rungs, { floorPct: null });
    expect(v.answer).toMatch(/^CANNOT SAY/);
    expect(v.answer).toMatch(/not a finding/);
  });
  it("REFUSES to answer when a rung produced no clean measurement", () => {
    const v = ladderVerdict([{ tSec: 1, workMs: [100] }, { tSec: 3, workMs: [] }], { floorPct: 5 });
    expect(v.answer).toMatch(/^CANNOT SAY/);
  });
  it("orders rungs by delay however they arrive", () => {
    const v = ladderVerdict([{ tSec: 3, workMs: [1] }, { tSec: 1, workMs: [1] }], { floorPct: 5 });
    expect(v.rows.map((r) => r.tSec)).toEqual([1, 3]);
  });
});

describe("median", () => {
  it("is the upper-middle for an even count, and null for nothing", () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBeNull();
    expect(median(undefined)).toBeNull();
  });
});
