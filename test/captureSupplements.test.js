/* NEW-2 (B1317824) — A SLOW REPORT KEEPS ITS FRAME TRACK, ITS COUNTER CURVE AND ITS TASK TABLE EVEN WHEN THE
 * STALL IS THE WORST (recurrence of B265541 / B846385 / B1317824, ×4).
 *
 * The owner's 2026-10-06 manual capture (problem_reports 5f82f13a): 2,100 frames, 229 long tasks, 23 counter
 * samples → `note:"trimmed-both"`, `framesKept:8` (the SMOOTH tail after the stall — "RRRRRRRR"), 16 tasks, 6
 * counter samples. The three earlier fixes each re-ordered what sheds first; the row cannot hold it at any
 * order, so a trimmed capture now travels as the main row + continuation rows (perfCapture.encodeSupplements).
 *
 * The fixture below IS that capture's shape, not a tidy one (WRONG-CASE): ~4% of frames are spikes (each costs
 * ~10 extra characters in the packed track), tasks are many and worst-first, the counter series is full.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildCapture, encodeCapture, encodeSupplements, decodeSupplements, decodeFrames, frameWindowAroundWorst,
  assertCaptureClean, CAPTURE_MAX_CHARS, SUPPLEMENT_MAX_CHARS, CAPTURE_NUMERIC_KEYS, CAPTURE_ENUM_KEYS,
} from "../src/shared/telemetry/perfCapture.js";

const COLS = ["t", "heap", "dom", "cv", "el", "ly", "pn", "tiles", "ppf", "ed", "sw", "act"];

/* 2,100 frames: 16.7 ms steady, a 60-frame stall of 120–951 ms in the middle, scattered 70–220 ms spikes. */
function ownerFrames() {
  const f = [];
  for (let i = 0; i < 2100; i++) {
    let ms = 16.7;
    if (i >= 900 && i < 960) ms = 120 + ((i * 37) % 830);          // the stall (worst = a 951-class frame)
    else if (i % 53 === 0) ms = 70 + ((i * 11) % 150);             // ordinary jank
    f.push(ms);
  }
  f[930] = 951;                                                    // the single worst frame
  return f;
}
function ownerCapture(over = {}) {
  const tasks = Array.from({ length: 229 }, (_, i) => [1000 + i * 150, 1000 - i * 4, 800 - i * 3, i % 2]);   // worst-first
  const counters = Array.from({ length: 23 }, (_, i) => [33000 + i * 2000, 136 + (i % 5) * 50, 2548 + i, 1282 + i, 62, 3, 1, 167, 0.38, 38 + i, 2, 262 + i]);
  const deltas = ownerFrames();
  return buildCapture({
    kind: "manual", atMs: 289034, atWall: 1791302214410, activeMs: 274690, route: "project", build: "6338802", planId: "smu1t5vcp73y",
    frameDeltas: deltas, tasks, taskNames: ["P0", "B"], counters, counterColumns: COLS,
    longTasks: 229, longTaskMs: 41545, longTaskMaxMs: 1565, heapMB: 331.4, editsSinceLoad: 47,
    frameStats: { frames: deltas.length, p50Ms: 16.6, p95Ms: 29.9, p99Ms: 207.3, maxMs: 950.8, jankFrames: 81 },
    ...over,
  });
}

describe("the defect, reproduced — the single row alone throws the stall away", () => {
  it("encodeCapture alone keeps a handful of frames of a 2,100-frame capture (what shipped)", () => {
    const enc = encodeCapture(ownerCapture(), { maxChars: CAPTURE_MAX_CHARS });
    const row = JSON.parse(enc.text);
    expect(row.note).toBe("trimmed-both");
    expect(row.framesKept).toBeLessThanOrEqual(60);
    expect(row.framesDropped).toBeGreaterThan(2000);
    expect(row.countersDropped).toBeGreaterThan(10);
  });
});

describe("NEW-2 — the continuation rows carry what the main row shed", () => {
  const cap = ownerCapture();
  const withStub = { ...cap, suppRows: 3 };
  const enc = encodeCapture(withStub, { maxChars: CAPTURE_MAX_CHARS });
  const rows = encodeSupplements(cap, enc);

  it("sends continuation rows, each parseable and inside the column budget (with the tab prefix)", () => {
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      expect(() => JSON.parse(r)).not.toThrow();
      expect(r.length).toBeLessThanOrEqual(SUPPLEMENT_MAX_CHARS);
      expect(`[tab abcdef12] ${r}`.length).toBeLessThanOrEqual(2000);
    }
  });

  it("the WHOLE frame track survives (2,100 frames), spikes exact — the stall is on the record", () => {
    const d = decodeSupplements(rows);
    expect(d.frames.from).toBe(0);
    expect(d.frames.to).toBe(2100);
    expect(d.frames.deltas.length).toBe(2100);
    const orig = cap.f;
    for (let i = 0; i < 2100; i++) {
      const o = Math.round(orig[i]);
      // packed digits are whole ms, clamped to 63 in the track and EXACT for spikes through `fx`
      expect(d.frames.deltas[i], `frame ${i}`).toBe(Math.min(o, o > 63 ? o : 63));
    }
    expect(Math.max(...d.frames.deltas)).toBe(951);
  });

  it("the whole counter history survives, not 6 of 23", () => {
    const d = decodeSupplements(rows);
    expect(d.counters.length).toBe(23);
    expect(d.cCols).toEqual(COLS);
    expect(d.counters[0][0]).toBe(33000);
  });

  it("the tasks the main row shed ride along, still worst-first, with their own name table", () => {
    const d = decodeSupplements(rows);
    const kept = JSON.parse(enc.text).lt.length;
    expect(d.tasks.length).toBeGreaterThan(20);
    // continuation starts exactly where the main row's worst-first prefix stopped
    expect(d.tasks[0][1]).toBe(cap.lt[kept][1]);
    expect(d.tasks.every((t) => typeof t[3] === "string" && t[3].length > 0)).toBe(true);
    for (let i = 1; i < d.tasks.length; i++) expect(d.tasks[i][1]).toBeLessThanOrEqual(d.tasks[i - 1][1]);
  });

  it("rows number themselves seq/of so a reader can tell a missing one", () => {
    const parsed = rows.map((r) => JSON.parse(r));
    parsed.forEach((p, i) => { expect(p.seq).toBe(i); expect(p.of).toBe(rows.length); expect(p.atWall).toBe(cap.atWall); expect(p.kind).toBe("manual"); });
  });
});

describe("NEW-2 — when even the supplement budget cannot hold every frame, the window is the STALL, never the tail", () => {
  it("every frame is a spike (4,096 × ~300 ms): the kept window is contiguous and contains the worst frame", () => {
    const f = Array.from({ length: 4096 }, (_, i) => 250 + ((i * 7) % 90));
    f[1234] = 1488;
    const cap = ownerCapture({ frameDeltas: f, frameStats: { frames: 4096, maxMs: 1488 } });
    const enc = encodeCapture({ ...cap, suppRows: 3 }, { maxChars: CAPTURE_MAX_CHARS });
    const rows = encodeSupplements(cap, enc);
    const d = decodeSupplements(rows);
    expect(d.frames.from).toBeLessThanOrEqual(1234);
    expect(d.frames.to).toBeGreaterThan(1234);
    expect(d.frames.deltas.length).toBe(d.frames.to - d.frames.from);
    expect(d.frames.deltas).toContain(1488);
    expect(d.frames.to - d.frames.from).toBeGreaterThan(60);          // a meaningful track, not 8
    expect(d.frames.from).toBeGreaterThan(0);                         // it is a window, and says which one
    rows.forEach((r) => expect(r.length).toBeLessThanOrEqual(SUPPLEMENT_MAX_CHARS));
  });

  it("frameWindowAroundWorst: everything when it fits; centred on the worst when it does not", () => {
    expect(frameWindowAroundWorst([16, 16, 16], 100)).toEqual([0, 3]);
    const f = Array.from({ length: 1000 }, () => 100); f[700] = 900;
    const [a, b] = frameWindowAroundWorst(f, 13 * 50);
    expect(a).toBeLessThanOrEqual(700); expect(b).toBeGreaterThan(700);
    expect(b - a).toBe(50);
    expect(Math.abs((700 - a) - (b - 1 - 700))).toBeLessThanOrEqual(1);
  });
});

describe("NEW-2 — a capture that fits in one row sends no continuation, and nothing widens the privacy surface", () => {
  it("a small capture sends none", () => {
    const cap = buildCapture({ kind: "auto", atMs: 1, atWall: 1, frameDeltas: [16, 17, 18], frameStats: { frames: 3 }, counters: [], counterColumns: [] });
    const enc = encodeCapture(cap, { maxChars: CAPTURE_MAX_CHARS });
    expect(encodeSupplements(cap, enc)).toEqual([]);
  });

  it("every key of every continuation row is on the allowlist (or a packed-series key)", () => {
    const cap = ownerCapture();
    const enc = encodeCapture({ ...cap, suppRows: 3 }, { maxChars: CAPTURE_MAX_CHARS });
    const allowed = new Set([...CAPTURE_NUMERIC_KEYS, ...CAPTURE_ENUM_KEYS, "ft", "fx", "c", "cCols", "lt", "ltNames"]);
    for (const r of encodeSupplements(cap, enc)) for (const k of Object.keys(JSON.parse(r))) expect(allowed.has(k), `${k} is not allowlisted`).toBe(true);
  });

  it("the main row's new key is numeric and passes the privacy check", () => {
    expect(assertCaptureClean({ ...ownerCapture(), suppRows: 3 })).toEqual([]);
    expect(assertCaptureClean({ ...ownerCapture(), part: "z" }).join()).toMatch(/part/);
  });

  it("the main row names the continuation (suppRows) so a capture cannot silently read as complete", () => {
    const enc = encodeCapture({ ...ownerCapture(), suppRows: 3 }, { maxChars: CAPTURE_MAX_CHARS });
    expect(JSON.parse(enc.text).suppRows).toBe(3);
  });
});

describe("wiring — the recorder sends the continuation and a missing part is NOT a delivered capture", () => {
  const recorder = readFileSync(fileURLToPath(new URL("../src/shared/telemetry/perfRecorder.js", import.meta.url)), "utf8");
  it("calls encodeSupplements and sends every row through the same sink", () => {
    expect(recorder).toContain("encodeSupplements(cap, enc)");
    expect(recorder).toMatch(/supp\.map\(\(text\) => .*reportClientEvent\("perfcap", text\)/s);
  });
  it("delivery requires every part (LOUD-FAILURE)", () => {
    expect(recorder).toContain("part-undelivered");
  });
  it("perfcap rows have their OWN rate budget — six rows per capture must not be starved by (or starve) the error-storm window", () => {
    const ce = readFileSync(fileURLToPath(new URL("../src/shared/telemetry/clientErrors.js", import.meta.url)), "utf8");
    const ev = ce.slice(ce.indexOf("export function reportClientEvent"));
    expect(ev).toContain('const perf = k === "perfcap";');
    expect(ev).toContain("_perfState");
    expect(ev).toContain("PERFCAP_RATE_MAX");
    // …and the generic ERROR path is untouched: it has no `k` and must not reference the perf budget (a ReferenceError there silently kills ALL error reporting)
    const er = ce.slice(ce.indexOf("export function reportClientError"), ce.indexOf("export function reportClientEvent"));
    expect(er).not.toContain("_perfState");
    expect(er).not.toMatch(/\bk\b === /);
  });
  it("decodeFrames is the one decoder (the continuation reuses the main row's packing)", () => {
    expect(decodeFrames("AB", [])).toEqual([0, 1]);
  });
});
