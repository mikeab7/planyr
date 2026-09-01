import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createFrameRing, pushFrame, createTaskRing, pushTask, createCounterRing, pushCounters,
  createStringTable, internString, ringOrder, ringOrderSince, COUNTER_COLUMNS, STRING_TABLE_MAX,
} from "../src/shared/telemetry/perfRing.js";
import {
  createTrigger, feedFrame, sealBaselineLate, triggerState, TRIGGER_DEFAULTS,
} from "../src/shared/telemetry/perfTrigger.js";
import {
  buildCapture, encodeCapture, decodeFrames, encodeFrames, assertCaptureClean, frameStats,
  safePlanId, sanitizeAttribution, attributionLabel, CAPTURE_MAX_CHARS, CAPTURE_NUMERIC_KEYS, CAPTURE_ENUM_KEYS,
} from "../src/shared/telemetry/perfCapture.js";
import {
  notePlanContext, noteViewScale, perfContext, requestPerfCapture, bindPerfRecorder,
  perfRecorderArmed, __resetPerfHandle,
} from "../src/shared/telemetry/perfRecorderHandle.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, "..", "src", p), "utf8");

/* NEW-1 — THE ALWAYS-ON PERFORMANCE RECORDER.
 *
 * Two properties have to hold and neither is visible from reading the code: it must not become the
 * defect it is looking for (no per-frame allocation, a bounded per-frame cost), and it must be able
 * to FIRE — a recorder that never trips is indistinguishable from a healthy app, which is the exact
 * failure mode decodeFault / annotationFault / count-pond-invocations --assert all exist to close.
 * Both are asserted here, plus the privacy boundary, which is an allowlist rather than a habit.
 *
 * The browser half of the same two guards is ui-audit/verify-perf-recorder.mjs: this file can prove
 * the trigger fires on a synthetic series, only a real browser can prove it fires on a real stall. */

/* ── the ring buffers ─────────────────────────────────────────────────────────────────────── */

describe("ring buffers — preallocated, written by index, never re-allocated", () => {
  it("keeps the identity of its backing arrays across a hundred thousand pushes", () => {
    const r = createFrameRing(512);
    const t = r.t, dt = r.dt;
    for (let i = 0; i < 100_000; i++) pushFrame(r, i * 16.7, 16.7);
    expect(r.t).toBe(t);
    expect(r.dt).toBe(dt);
    expect(r.count).toBe(512);
    expect(r.cap).toBe(512);
  });

  it("pushFrame returns nothing — a hot path that returns an object allocates one", () => {
    const r = createFrameRing(8);
    expect(pushFrame(r, 1, 1)).toBeUndefined();
    expect(pushCounters(createCounterRing(4), 1, new Float64Array(COUNTER_COLUMNS.length))).toBeUndefined();
    expect(pushTask(createTaskRing(4), 1, 60, 10, 0)).toBeUndefined();
  });

  it("wraps and reads back oldest → newest", () => {
    const r = createFrameRing(4);
    for (let i = 1; i <= 6; i++) pushFrame(r, i, i * 10);
    const order = ringOrder(r);
    expect(order.map((i) => r.t[i])).toEqual([3, 4, 5, 6]);
    expect(order.map((i) => r.dt[i])).toEqual([30, 40, 50, 60]);
  });

  it("ringOrderSince returns only the entries at or after a time", () => {
    const r = createFrameRing(8);
    for (let i = 1; i <= 6; i++) pushFrame(r, i * 100, 16);
    expect(ringOrderSince(r, 350).map((i) => r.t[i])).toEqual([400, 500, 600]);
    expect(ringOrderSince(r, 10_000)).toEqual([]);
  });

  it("the counter ring stores one column per declared counter, in order", () => {
    const r = createCounterRing(4);
    expect(r.cols.length).toBe(COUNTER_COLUMNS.length);
    const v = new Float64Array(COUNTER_COLUMNS.length);
    for (let c = 0; c < v.length; c++) v[c] = c + 1;
    pushCounters(r, 5, v);
    expect(r.t[0]).toBe(5);
    expect(r.cols.map((c) => c[0])).toEqual(COUNTER_COLUMNS.map((_, c) => c + 1));
  });

  it("the string table is bounded — a page minting a fresh name every frame cannot leak", () => {
    const t = createStringTable();
    const first = internString(t, "renderElPx");
    expect(internString(t, "renderElPx")).toBe(first);   // interning, not appending
    for (let i = 0; i < 500; i++) internString(t, `fn-${i}`);
    expect(t.list.length).toBeLessThanOrEqual(STRING_TABLE_MAX);
    expect(internString(t, "brand-new-after-the-cap")).toBe(1);  // the shared "(other)" slot
  });
});

/* ── the trigger ──────────────────────────────────────────────────────────────────────────── */

/* Drive a synthetic frame series through the real trigger. `dtAt(t)` supplies the delta. */
function drive(s, { fromMs, toMs, dtAt }) {
  let t = fromMs, fired = 0;
  while (t < toMs) {
    const dt = dtAt(t);
    t += dt;
    if (feedFrame(s, t, dt)) fired++;
  }
  return fired;
}

describe("the trigger is SELF-CALIBRATING — it compares the machine to itself", () => {
  it("takes no baseline from the boot window, then seals one from the window after it", () => {
    const s = createTrigger();
    drive(s, { fromMs: 0, toMs: TRIGGER_DEFAULTS.baselineSkipMs - 100, dtAt: () => 16 });
    expect(triggerState(s).baselineMs).toBe(null);
    expect(triggerState(s).baselineFrames).toBe(0);   // nothing before the skip is collected
    drive(s, { fromMs: TRIGGER_DEFAULTS.baselineSkipMs, toMs: 60_000, dtAt: () => 16 });
    expect(triggerState(s).baselineMs).toBe(16);
  });

  it("never fires before it has a baseline, however slow the frames are", () => {
    const s = createTrigger();
    const fired = drive(s, { fromMs: 0, toMs: TRIGGER_DEFAULTS.baselineSkipMs, dtAt: () => 400 });
    expect(fired).toBe(0);
    expect(triggerState(s).fires).toBe(0);
  });

  it("uses the MEDIAN, so a collection pause during calibration cannot raise the bar", () => {
    const s = createTrigger();
    let n = 0;
    drive(s, {
      fromMs: TRIGGER_DEFAULTS.baselineSkipMs, toMs: 60_000,
      dtAt: () => (++n % 40 === 0 ? 600 : 16),     // a 600 ms hitch every 40 frames
    });
    expect(triggerState(s).baselineMs).toBe(16);   // a mean would have been ~30
  });

  it("FIRES on a sustained doubling that also clears the perceptibility floor", () => {
    const s = createTrigger();
    drive(s, { fromMs: TRIGGER_DEFAULTS.baselineSkipMs, toMs: 60_000, dtAt: () => 20 });
    expect(triggerState(s).baselineMs).toBe(20);
    const fired = drive(s, { fromMs: 60_000, toMs: 66_000, dtAt: () => 55 });
    expect(fired).toBeGreaterThan(0);
    expect(s.lastVerdict.ratio).toBeGreaterThanOrEqual(2);
    expect(s.lastVerdict.windowFrames).toBeGreaterThanOrEqual(TRIGGER_DEFAULTS.sustainMinFrames);
  });

  /* ⛔ THE REGRESSION THIS FILE CAUGHT ONCE AND MUST KEEP CATCHING. The window used to be
   * qualified by a fixed frame COUNT (24 in two seconds), which made the trigger progressively
   * LESS able to fire the worse the lag got: past ~80 ms a frame there are never 24 of them in a
   * two-second window, so a session at four frames a second — the worst case, and the one the
   * owner would most want captured — could not produce a capture at all. The window is qualified
   * by the TIME it spans now. Both ends of the range are asserted. */
  it("still fires on a BADLY lagging session, where two seconds holds only a handful of frames", () => {
    const s = createTrigger();
    drive(s, { fromMs: TRIGGER_DEFAULTS.baselineSkipMs, toMs: 60_000, dtAt: () => 16 });
    const fired = drive(s, { fromMs: 60_000, toMs: 70_000, dtAt: () => 250 });  // 4 fps
    expect(fired).toBeGreaterThan(0);
    expect(s.lastVerdict.windowFrames).toBeLessThan(24);
  });

  it("fires the same way on a fast display, where two seconds holds a hundred and twenty", () => {
    const s = createTrigger();
    drive(s, { fromMs: TRIGGER_DEFAULTS.baselineSkipMs, toMs: 60_000, dtAt: () => 7 });   // 144 Hz
    expect(triggerState(s).baselineMs).toBe(7);
    // 21 ms is 3x the baseline but under the perceptibility floor — correctly silent…
    expect(drive(s, { fromMs: 60_000, toMs: 66_000, dtAt: () => 21 })).toBe(0);
    // …and 40 ms clears both.
    expect(drive(s, { fromMs: 66_000, toMs: 72_000, dtAt: () => 40 })).toBeGreaterThan(0);
  });

  it("does NOT fire on a single enormous frame — the garbage-collection case", () => {
    const s = createTrigger();
    drive(s, { fromMs: TRIGGER_DEFAULTS.baselineSkipMs, toMs: 60_000, dtAt: () => 16 });
    let n = 0;
    const fired = drive(s, { fromMs: 60_000, toMs: 70_000, dtAt: () => (++n === 30 ? 900 : 16) });
    expect(fired).toBe(0);
  });

  it("does NOT fire on a burst too short to be sustained", () => {
    const s = createTrigger();
    drive(s, { fromMs: TRIGGER_DEFAULTS.baselineSkipMs, toMs: 60_000, dtAt: () => 16 });
    // 700 ms of slow frames — a third of the sustain window
    const fired = drive(s, { fromMs: 60_000, toMs: 60_700, dtAt: () => 60 });
    expect(fired).toBe(0);
  });

  it("does NOT fire on a doubling that is still imperceptible — the FLOOR", () => {
    const s = createTrigger();
    drive(s, { fromMs: TRIGGER_DEFAULTS.baselineSkipMs, toMs: 60_000, dtAt: () => 4 });
    expect(triggerState(s).baselineMs).toBe(4);
    const fired = drive(s, { fromMs: 60_000, toMs: 70_000, dtAt: () => 12 });  // 3× but only 12 ms
    expect(fired).toBe(0);
  });

  it("is bounded — a permanently slow session cannot send an unbounded number of rows", () => {
    const s = createTrigger({ cooldownMs: 1 });
    drive(s, { fromMs: TRIGGER_DEFAULTS.baselineSkipMs, toMs: 60_000, dtAt: () => 16 });
    const fired = drive(s, { fromMs: 60_000, toMs: 400_000, dtAt: () => 90 });
    expect(fired).toBe(TRIGGER_DEFAULTS.maxAuto);
  });

  it("honours the cooldown between fires", () => {
    const s = createTrigger();
    drive(s, { fromMs: TRIGGER_DEFAULTS.baselineSkipMs, toMs: 60_000, dtAt: () => 16 });
    const fired = drive(s, { fromMs: 60_000, toMs: 60_000 + TRIGGER_DEFAULTS.cooldownMs - 5_000, dtAt: () => 90 });
    expect(fired).toBe(1);
  });

  it("ignores a delta that is not a frame at all (a debugger pause, a throttled tab)", () => {
    const s = createTrigger();
    drive(s, { fromMs: TRIGGER_DEFAULTS.baselineSkipMs, toMs: 60_000, dtAt: () => 16 });
    const before = triggerState(s).windowFrames;
    expect(feedFrame(s, 61_000, 900_000)).toBe(false);
    expect(triggerState(s).windowFrames).toBe(before);
  });

  it("seals a LATE baseline rather than staying unarmed forever, and says it was late", () => {
    const s = createTrigger();
    // Only 40 frames of interaction in the whole calibration window — under baselineMinFrames.
    let t = TRIGGER_DEFAULTS.baselineSkipMs;
    for (let i = 0; i < 40; i++) { t += 16; feedFrame(s, t, 16); }
    expect(triggerState(s).baselineMs).toBe(null);
    expect(sealBaselineLate(s, 120_000)).toBe(true);
    expect(triggerState(s).baselineMs).toBe(16);
    expect(triggerState(s).baselineLate).toBe(true);
  });

  /* ⛔ THE NO-ALLOCATION GUARD, and it is a SOURCE rule on purpose — that decision was measured,
   * not preferred. Two runtime approaches were built and both failed to discriminate:
   *   · the timing microbenchmark below cannot see it. Planting `_sink = { t, dt, s: \`frame ${t}\` }`
   *     in `onFrame` — a real object AND a real string every frame — moved it from 0.05 to 0.07
   *     µs/frame, because a young-generation bump allocation in a tight loop is ~20 ns.
   *   · a heap-delta arm over `performance.memory` in a real browser was worse: quantised to 100 KB
   *     and cached for 20 minutes without `--enable-precise-memory-info` (planted defect read 0 on
   *     every run), and with the flag the MAX read 33.6 bytes/frame on a CLEAN path while the MIN
   *     read −21.5 on the PLANTED one. Ambient growth only adds, a scavenge only subtracts, and no
   *     statistic survives both.
   * The property is structural, so the guard is structural: the hot path may contain no expression
   * that allocates. That fails on the planted object instantly and cannot be noisy. */
  it("the hot path allocates NOTHING — asserted structurally, because no runtime probe could", () => {
    const s = src("shared/telemetry/perfRecorder.js") + src("shared/telemetry/perfRing.js") + src("shared/telemetry/perfTrigger.js");
    /* The functions that run once per animation frame, and everything they call. */
    const HOT = ["onFrame", "pushFrame", "pushTask", "pushCounters", "feedFrame", "pushWindow", "evictWindow", "windowSpan"];
    const bodyOf = (name) => {
      const m = new RegExp(`(?:export )?function ${name}\\s*\\([^)]*\\)\\s*\\{`).exec(s);
      if (!m) return null;
      let i = m.index + m[0].length, depth = 1;
      while (i < s.length && depth > 0) { if (s[i] === "{") depth++; else if (s[i] === "}") depth--; i++; }
      return s.slice(m.index + m[0].length, i - 1);
    };
    const strip = (b) => b.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    /* Every construct that allocates on the JS heap. `sealBaseline`'s one `.slice()` is fine — it
     * runs ONCE per page, from the baseline branch, and is deliberately not in this list of
     * functions; if it ever moves into one, this goes red, which is the point. */
    const BANNED = [
      [/=\s*\{/, "an object literal"],
      [/\breturn\s*\{/, "an object literal"],
      [/=\s*\[/, "an array literal"],
      [/`/, "a template literal"],
      [/\bnew\s+[A-Z]/, "a constructor call"],
      [/\.\.\./, "a spread"],
      [/\.(push|map|filter|slice|concat|split|join|sort)\s*\(/, "an array method that allocates"],
      [/\bJSON\./, "a JSON call"],
      [/=>\s*/, "an arrow function (a closure per call)"],
    ];
    const missing = HOT.filter((n) => bodyOf(n) === null);
    // NOT OBSERVING: a rename that orphans a name here would leave this test trivially green.
    expect(missing).toEqual([]);
    for (const name of HOT) {
      const body = strip(bodyOf(name));
      for (const [re, what] of BANNED) {
        expect(`${name}: ${re.test(body) ? `contains ${what}` : "clean"}`).toBe(`${name}: clean`);
      }
    }
  });

  it("the per-frame cost of the whole hot path stays far under a frame budget", () => {
    /* A DIRECT measurement of the thing the design promises. The browser half measures the same
     * path under a real gesture; this is the CI-runnable floor, with a bound loose enough to
     * survive a loaded runner and tight enough that a per-frame allocation or an accidental
     * O(window) scan would blow straight through it. */
    const s = createTrigger();
    const r = createFrameRing(4096);
    const N = 200_000;
    let t = 6000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) { t += 16; pushFrame(r, t, 16); feedFrame(s, t, 16); }
    const usPerFrame = ((performance.now() - t0) / N) * 1000;
    expect(usPerFrame).toBeLessThan(10);   // stated bound: ≤ 10 µs/frame in CI
  });
});

/* ── the privacy boundary ─────────────────────────────────────────────────────────────────── */

/* A deliberately DIRTY set of inputs: everything the rule forbids, offered to the builder. */
const DIRTY = {
  planId: "Bain Tract — 4820 Katy Hockley Rd, Michael Abrams",
  ownerName: "Michael Abrams",
  address: "4820 Katy Hockley Cut Off Rd",
  calloutText: "Confirm easement with seller",
  geometry: [[100.5, 200.25], [300, 400]],
  parcelId: "R123456",
  rasterBytes: "data:image/png;base64,iVBORw0KGgo=",
};

describe("privacy — the payload is an allowlist and it is PROVED, not trusted", () => {
  const clean = () => buildCapture({
    ...DIRTY,
    kind: "manual", atMs: 61234.5, atWall: 1786000000000, activeMs: 12345,
    route: "site", build: "abc1234", visibility: "visible",
    baselineMs: 16.4, baselineFrames: 240, baselineSealedAtMs: 30000, baselineLate: false,
    windowMeanMs: 48.2, slowFraction: 0.72, ratio: 2.94, multiplier: 2, sustainMs: 2000, floorMs: 33, fires: 1,
    frameStats: frameStats([16, 18, 44, 90, 22], 33),
    longTasks: 4, longTaskMs: 512, longTaskMaxMs: 210,
    heapMB: 132.4, domNodes: 2200, canvasNodes: 4100, elementsDrawn: 62, layersOn: 9, panelsOpen: 3,
    tiles: 291, ppf: 0.418, editsSinceLoad: 27, planSwitches: 2,
    dpr: 2.15, viewportW: 1600, viewportH: 900, hardwareThreads: 12, deviceMemoryGB: 8,
    counterSamples: 12,
    frameDeltas: [16, 18, 44, 90, 22],
    gaps: [[3, 4200]],
    tasks: [[120, 210, 88, 2]],
    taskNames: ["(unknown)", "(other)", "SitePlannerApp-BxMJopPJ.js"],
    counters: [[0, 130.2, 2200, 4100, 62, 9, 3, 291, 0.418, 27, 2, 40]],
    counterColumns: ["t", ...COUNTER_COLUMNS],
  });

  it("carries no key outside the allowlist", () => {
    expect(assertCaptureClean(clean())).toEqual([]);
  });

  it("lets nothing sensitive through, anywhere in the encoded row", () => {
    const enc = encodeCapture(clean(), { maxChars: CAPTURE_MAX_CHARS }).text;
    for (const needle of ["Michael", "Abrams", "Katy", "Hockley", "easement", "R123456", "iVBORw", "200.25"]) {
      expect(enc).not.toContain(needle);
    }
  });

  it("demotes a plan id that looks like a typed NAME to a non-reversible hash", () => {
    const named = safePlanId("Bain Tract — Concept D");
    expect(named.planIdKind).toBe("hash");
    expect(named.plan).not.toContain("Bain");
    expect(/^[a-z0-9]+$/.test(named.plan)).toBe(true);
    expect(safePlanId("Bain Tract — Concept D").plan).toBe(named.plan);   // stable
  });

  it("passes an opaque plan id through, so 'is it always the same plan' is still answerable", () => {
    expect(safePlanId("s1a2b3c4d5e6")).toEqual({ plan: "s1a2b3c4d5e6", planIdKind: "id" });
  });

  it("strips a query string and a path from an attribution name (a URL can carry a plan id)", () => {
    expect(sanitizeAttribution("https://planyr.io/assets/SitePlannerApp-Bx.js?site=Bain%20Tract"))
      .toBe("SitePlannerApp-Bx.js");
    expect(sanitizeAttribution("weird name with spaces")).toBe("weirdnamewithspaces");
  });

  /* B844416 — every Leaflet-scheduled callback and every app-level requestAnimationFrame arrow is
   * an ANONYMOUS function, so `sourceFunctionName` is empty for the four worst blocks in the
   * owner's 2026-08-29 production capture. The old fallback chain (sourceFunctionName || invoker ||
   * sourceURL) never reached sourceURL, because `invoker` is a non-empty constant
   * ("FrameRequestCallback") for every one of those — so the capture said only "an animation frame
   * ran", true of most of the app. */
  it("names an anonymous long-animation-frame script by its invoker AND a compact source location", () => {
    const script = {
      sourceFunctionName: "",
      invoker: "FrameRequestCallback",
      sourceURL: "https://planyr.io/assets/index-4f2a.js?site=Bain%20Tract",
      sourceCharPosition: 81422,
    };
    expect(attributionLabel(script)).toBe("FrameRequestCallback:index-4f2a.js:81422");
  });

  it("still prefers a real function name when the platform provides one", () => {
    expect(attributionLabel({
      sourceFunctionName: "handleWheelZoom",
      invoker: "EventListener.wheel",
      sourceURL: "https://planyr.io/assets/index-4f2a.js",
      sourceCharPosition: 12,
    })).toBe("handleWheelZoom");
  });

  it("falls back gracefully when the location is unknown — invoker alone, never a bare colon", () => {
    expect(attributionLabel({ sourceFunctionName: "", invoker: "FrameRequestCallback", sourceURL: "", sourceCharPosition: -1 }))
      .toBe("FrameRequestCallback");
    expect(attributionLabel({ sourceFunctionName: "", invoker: "", sourceURL: "", sourceCharPosition: -1 })).toBe("");
  });

  it("the combined label still passes the ltNames sanitiser unchanged — no slash to mis-truncate on", () => {
    const label = attributionLabel({
      sourceFunctionName: "",
      invoker: "FrameRequestCallback",
      sourceURL: "https://planyr.io/assets/index-4f2a.js?site=Bain%20Tract",
      sourceCharPosition: 81422,
    });
    expect(sanitizeAttribution(label)).toBe(label);
    expect(label).toMatch(/^[A-Za-z0-9_.:-]*$/);
  });

  it("catches an injected key, a string in a number slot, and a note outside the vocabulary", () => {
    const bad = clean();
    bad.ownerName = "Michael";
    expect(assertCaptureClean(bad).join(" ")).toContain("not on the allowlist");

    const bad2 = clean(); bad2.heapMB = "132.4";
    expect(assertCaptureClean(bad2).join(" ")).toContain("heapMB");

    const bad3 = clean(); bad3.note = "the plan called Bain was slow";
    expect(assertCaptureClean(bad3).join(" ")).toContain("vocabulary");

    const bad4 = clean(); bad4.c = [[1, "text"]];
    expect(assertCaptureClean(bad4).join(" ")).toContain("non-numeric");
  });

  it("the two allowlists have no overlap and no duplicates", () => {
    const all = [...CAPTURE_NUMERIC_KEYS, ...CAPTURE_ENUM_KEYS];
    expect(new Set(all).size).toBe(all.length);
  });
});

/* ── encoding ─────────────────────────────────────────────────────────────────────────────── */

describe("encoding — a capture must FIT the telemetry column, and say what it dropped", () => {
  it("round-trips ordinary frame deltas", () => {
    const deltas = [16, 17, 16, 33, 21];
    const { track, spikes } = encodeFrames(deltas);
    expect(track.length).toBe(5);
    expect(spikes).toEqual([]);
    expect(decodeFrames(track, spikes)).toEqual(deltas);
  });

  it("carries a frame past the clamp EXPLICITLY, so a stall is never hidden by the packing", () => {
    const { track, spikes } = encodeFrames([16, 420, 16]);
    expect(spikes).toEqual([[1, 420]]);
    expect(decodeFrames(track, spikes)).toEqual([16, 420, 16]);
  });

  it("fits a long capture inside the column and reports the trim", () => {
    const cap = buildCapture({
      kind: "auto", atMs: 90_000, atWall: 1786000000000, activeMs: 60_000, route: "site", build: "abc1234",
      baselineMs: 16, multiplier: 2, sustainMs: 2000, floorMs: 33,
      frameDeltas: Array.from({ length: 4096 }, (_, i) => 16 + (i % 7)),
      counters: Array.from({ length: 96 }, (_, i) => [i * 2000, 130, 2200, 4100, 62, 9, 3, 291, 0.4, 27, 2, i]),
      counterColumns: ["t", ...COUNTER_COLUMNS],
      tasks: Array.from({ length: 24 }, (_, i) => [i * 100, 60 + i, 10, 2]),
      taskNames: ["(unknown)", "(other)", "renderElPx"],
    });
    const enc = encodeCapture(cap, { maxChars: CAPTURE_MAX_CHARS });
    expect(enc.fits).toBe(true);
    expect(enc.chars).toBeLessThanOrEqual(CAPTURE_MAX_CHARS);
    expect(enc.trimmedFrames).toBeGreaterThan(0);
    const parsed = JSON.parse(enc.text);
    expect(parsed.note).toBe("trimmed");
    expect(parsed.framesDropped).toBe(enc.trimmedFrames);
    expect(parsed.framesKept + parsed.framesDropped).toBe(4096);
    /* The KEPT frames must be the most recent ones — trimming the tail would make an episode read
     * as calmer than it was. */
    expect(parsed.ft.length).toBe(parsed.framesKept);
  });

  it("still emits parseable JSON when nothing will fit", () => {
    const cap = buildCapture({ kind: "auto", atMs: 1, atWall: 2, frameDeltas: Array.from({ length: 4096 }, () => 16) });
    // A budget below even the 60-frame floor: the row must still be PARSEABLE JSON, because a
    // truncated payload carries nothing at all, and it must say it gave up.
    const enc = encodeCapture(cap, { maxChars: 90 });
    expect(() => JSON.parse(enc.text)).not.toThrow();
    expect(JSON.parse(enc.text).note).toBe("trimmed-hard");
    expect(JSON.parse(enc.text).framesDropped).toBe(4096);
  });

  /* ⛔ NEW-2 (B846385) — THE WORST CAPTURES USED TO LOSE THEIR LONG-TASK ATTRIBUTION FIRST, WHICH
   * IS BACKWARDS: a frame track is mostly redundant once p50/p95/p99/jankFrames exist, but a
   * long-task row is the only place a script gets a NAME. Measured on the owner's real 2026-09-01
   * Richfield capture: 1,201 long tasks / 92,232 ms encoded to `framesKept:8` with NO `lt`/
   * `ltNames` at all — not one blocking task was attributed to anything.
   *
   * `legacyEncodeCapture` below is the PRE-FIX shedding order, copied verbatim (counters → smallest
   * tasks → frame ladder → wipe tasks+counters together → re-shed frames), so this test proves the
   * regression is real on a reproducing fixture rather than trusting a description of it: the old
   * order goes RED here, the shipped `encodeCapture` goes GREEN. */
  function legacyEncodeCapture(cap, { maxChars = CAPTURE_MAX_CHARS } = {}) {
    const base = { ...cap };
    const deltas = Array.isArray(base.f) ? base.f.slice() : [];
    delete base.f;
    const build = (frames, tasks, counters) => {
      const { track, spikes } = encodeFrames(frames);
      const row = { ...base, ft: track, fx: spikes, lt: tasks, c: counters };
      if (!row.fx.length) delete row.fx;
      if (!row.lt.length) { delete row.lt; delete row.ltNames; }
      if (!row.c.length) { delete row.c; delete row.cCols; }
      return JSON.stringify(row);
    };
    let frames = deltas;
    let tasks = Array.isArray(base.lt) ? base.lt.slice() : [];
    let counters = Array.isArray(base.c) ? base.c.slice() : [];
    let s = build(frames, tasks, counters);
    let trimmedFrames = 0, trimmedTasks = 0, trimmedCounters = 0;
    while (s.length > maxChars && counters.length > 6) { counters.shift(); trimmedCounters++; s = build(frames, tasks, counters); }
    while (s.length > maxChars && tasks.length > 4) {
      let min = 0;
      for (let i = 1; i < tasks.length; i++) if (tasks[i][1] < tasks[min][1]) min = i;
      tasks.splice(min, 1); trimmedTasks++; s = build(frames, tasks, counters);
    }
    const shedFrames = (floor) => {
      while (s.length > maxChars && frames.length > floor) {
        const drop = Math.max(1, Math.min(frames.length - floor, Math.ceil((s.length - maxChars) / 1.2)));
        frames = frames.slice(drop); trimmedFrames += drop; s = build(frames, tasks, counters);
      }
    };
    const shedToFit = () => { for (const floor of [60, 30, 16, 8]) { shedFrames(floor); if (s.length <= maxChars) return; } };
    shedToFit();
    if (trimmedFrames || trimmedTasks || trimmedCounters) {
      base.framesKept = frames.length; base.framesDropped = trimmedFrames; base.note = "trimmed";
      s = build(frames, tasks, counters);
      shedToFit();
      base.framesKept = frames.length; base.framesDropped = trimmedFrames;
      if (s.length > maxChars) base.note = "trimmed-hard";
      s = build(frames, tasks, counters);
    }
    if (s.length > maxChars) {
      tasks = []; counters = [];
      shedToFit();
      base.framesKept = frames.length; base.framesDropped = trimmedFrames; base.note = "trimmed";
      s = build(frames, tasks, counters);
      shedToFit();
      base.framesKept = frames.length; base.framesDropped = trimmedFrames;
      base.note = s.length > maxChars ? "trimmed-hard" : "trimmed";
      s = build(frames, tasks, counters);
    }
    if (s.length > maxChars) {
      const bare = { ...base, note: "trimmed-hard", framesKept: 0, framesDropped: deltas.length };
      delete bare.lt; delete bare.ltNames; delete bare.c; delete bare.cCols;
      s = JSON.stringify(bare);
    }
    return { text: s, chars: s.length, trimmedFrames, trimmedTasks, trimmedCounters, fits: s.length <= maxChars };
  }

  it("a severe episode (many long tasks, a jankful frame track) keeps long-task attribution — the pre-fix order did not", () => {
    const names = Array.from({ length: 24 }, (_, i) => `siteplanner/lib/reallyLongModuleNameXXXXXXXXXX${i}.js:8${i}12`);
    const taskNames = ["(unknown)", "(other)", ...names];
    const cap = buildCapture({
      kind: "auto", atMs: 1_462_568, atWall: 1_788_283_501_338, activeMs: 1_235_651, route: "site", build: "c5da2c1",
      baselineMs: 16.7, multiplier: 2, sustainMs: 2000, floorMs: 33,
      // A jankful gesture: most frames blow the 63ms clamp, so nearly every one also costs an
      // explicit `fx` [index, ms] pair — the exact mechanism B265541 already documents.
      frameDeltas: Array.from({ length: 4096 }, (_, i) => 70 + (i % 90)),
      counters: Array.from({ length: 96 }, (_, i) => [i * 2000, 130, 2200, 4100, 62, 9, 3, 291, 0.4, 27, 2, i]),
      counterColumns: ["t", ...COUNTER_COLUMNS],
      // 24 long tasks, each attributed to its OWN distinct (long) name — the shape a real session
      // with many different slow call sites produces.
      tasks: Array.from({ length: 24 }, (_, i) => [i * 1000, 60 + i * 90, 10 + i, 2 + i]),
      taskNames,
    });

    const legacy = legacyEncodeCapture(cap, { maxChars: CAPTURE_MAX_CHARS });
    const legacyParsed = JSON.parse(legacy.text);
    expect(legacyParsed.lt).toBeUndefined();
    expect(legacyParsed.ltNames).toBeUndefined();

    const fixed = encodeCapture(cap, { maxChars: CAPTURE_MAX_CHARS });
    expect(fixed.chars).toBeLessThanOrEqual(CAPTURE_MAX_CHARS);
    const parsed = JSON.parse(fixed.text);
    expect(Array.isArray(parsed.lt)).toBe(true);
    expect(parsed.lt.length).toBeGreaterThan(0);
    expect(Array.isArray(parsed.ltNames)).toBe(true);
    expect(parsed.ltNames.length).toBeGreaterThan(0);
    // Frames were cut before any task attribution was — the frame track is allowed to hit zero.
    expect(parsed.framesKept ?? 0).toBeLessThan(60);
  });

  it("re-indexes ltNames to only the names the KEPT tasks reference, not the whole session table", () => {
    // A session-wide string table can hold up to STRING_TABLE_MAX distinct long names; a capture
    // that only keeps a handful of tasks must not ship all of them.
    const names = Array.from({ length: STRING_TABLE_MAX }, (_, i) => `module${i}.js:${1000 + i}`);
    const cap = buildCapture({
      kind: "auto", atMs: 1, atWall: 2, route: "site", build: "abc1234",
      frameDeltas: [16, 17, 16],
      tasks: [[0, 200, 10, 5], [100, 300, 20, 5], [200, 250, 15, 9]], // only names[5] and names[9] used
      taskNames: names,
    });
    const enc = encodeCapture(cap, { maxChars: CAPTURE_MAX_CHARS });
    const parsed = JSON.parse(enc.text);
    expect(parsed.ltNames.length).toBe(2);
    expect(parsed.ltNames).toContain("module5.js:1005");
    expect(parsed.ltNames).toContain("module9.js:1009");
  });

  it("frameStats counts jank against the same bar the trigger fired on", () => {
    const fs = frameStats([16, 16, 40, 80, 16], 33);
    expect(fs.frames).toBe(5);
    expect(fs.jankFrames).toBe(2);
    expect(fs.maxMs).toBe(80);
    expect(fs.p50Ms).toBe(16);
  });

  it("an empty capture reports nothing rather than zero — they are different facts", () => {
    expect(frameStats([], 33)).toMatchObject({ frames: 0, p50Ms: null, maxMs: null });
  });
});

/* ── the always-loaded handle ─────────────────────────────────────────────────────────────── */

describe("the handle — safe to call before, or entirely without, the recorder", () => {
  it("reports honestly that nothing was recorded when no recorder is bound", () => {
    __resetPerfHandle();
    expect(perfRecorderArmed()).toBe(false);
    expect(requestPerfCapture("manual")).toBe(false);
  });

  it("routes a manual request to the bound recorder", () => {
    __resetPerfHandle();
    const seen = [];
    bindPerfRecorder((reason) => { seen.push(reason); return true; });
    expect(perfRecorderArmed()).toBe(true);
    expect(requestPerfCapture("manual")).toBe(true);
    expect(seen).toEqual(["manual"]);
  });

  it("never lets a recorder fault reach the caller", () => {
    __resetPerfHandle();
    bindPerfRecorder(() => { throw new Error("boom"); });
    expect(requestPerfCapture("manual")).toBe(false);
  });

  it("counts plan SWITCHES, not the first load, and ignores a repeat of the same plan", () => {
    __resetPerfHandle();
    notePlanContext("plan-a");
    expect(perfContext().planSwitches).toBe(0);
    notePlanContext("plan-a");
    expect(perfContext().planSwitches).toBe(0);
    notePlanContext("plan-b");
    notePlanContext("plan-c");
    expect(perfContext().planSwitches).toBe(2);
    expect(perfContext().planId).toBe("plan-c");
  });

  it("holds the zoom as a scalar", () => {
    __resetPerfHandle();
    noteViewScale(0.418);
    expect(perfContext().ppf).toBe(0.418);
    noteViewScale(undefined);
    expect(Number.isNaN(perfContext().ppf)).toBe(true);
  });
});

/* ── source guards — the wiring, which no property test can see ───────────────────────────── */

describe("wiring guards — the parts that only exist as a call site", () => {
  const recorder = src("shared/telemetry/perfRecorder.js");
  const main = src("main.jsx");
  const planner = src("workspaces/site-planner/SitePlanner.jsx");
  const census = src("shared/storage/storageCensus.js");
  const panel = src("shared/storage/StoragePanel.jsx");

  it("main.jsx installs the recorder by DYNAMIC import — a static edge charges every route", () => {
    expect(main).toMatch(/import\(\s*["']\.\/shared\/telemetry\/perfRecorder\.js["']\s*\)/);
    expect(main).not.toMatch(/^import .*perfRecorder\.js/m);
  });

  it("the recorder is installed unconditionally — it is not behind the 25% perf-sample gate", () => {
    const armBlock = main.slice(main.indexOf("perfRecorder.js") - 600, main.indexOf("perfRecorder.js") + 200);
    expect(armBlock).not.toContain("isEnrolled");
  });

  it("the frame loop is gated on interaction rather than running forever", () => {
    expect(recorder).toContain("idleStopMs");
    expect(recorder).toMatch(/if \(t < _activeUntil\) schedule\(\);/);
    expect(recorder).toMatch(/passive: true, capture: true/);
  });

  it("the capture is checked against the allowlist BEFORE it is sent", () => {
    const i = recorder.indexOf("assertCaptureClean(cap)");
    const j = recorder.indexOf('reportClientEvent("perfcap"');
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });

  it("a long-animation-frame's top script is named through attributionLabel — never the bare sourceFunctionName||invoker||sourceURL chain", () => {
    expect(recorder).toMatch(/import\s*\{[^}]*attributionLabel[^}]*\}\s*from\s*["']\.\/perfCapture\.js["']/);
    expect(recorder).toContain("name = attributionLabel(top)");
    expect(recorder).not.toContain('top.sourceFunctionName || top.invoker || top.sourceURL || ""');
  });

  it("the planner wires both context axes, and the zoom one on the SCALAR", () => {
    expect(planner).toContain("notePlanContext(siteId)");
    expect(planner).toMatch(/noteViewScale\(view\.ppf\)[^\n]*\}, \[view\.ppf\]\)/);
  });

  it("the planner offers the manual control and it says when it failed", () => {
    expect(planner).toContain('data-testid="report-slow"');
    expect(planner).toContain('requestPerfCapture("manual")');
    expect(planner).toContain('slowNote === "fail"');
  });

  it("captures are stored in the LARGE tier and are declared non-reclaimable", () => {
    expect(src("shared/telemetry/perfCaptureStore.js")).toContain("originStore.js");
    // The small tier is named in the header's rationale; what must never appear is a CALL into it.
    expect(src("shared/telemetry/perfCaptureStore.js")).not.toMatch(/localStorage\s*[.[]/);
    const cls = census.slice(census.indexOf('id: "perfcaptures"'), census.indexOf('id: "perfcaptures"') + 220);
    expect(cls).toContain("REBUILD.NONE");
    expect(cls).toContain("reclaimable: false");
  });

  it("the storage panel surfaces the recordings, so the class cannot grow unseen", () => {
    expect(panel).toContain('data-testid="perf-captures"');
    expect(panel).toContain('data-testid="clear-perf-captures"');
  });
});
