/* B265536 / B265537 / B265540 — THE CI-RUNNABLE HALF OF THE CAPTURE-PIPE PROOF.
 *
 * `ui-audit/verify-capture-pipe.mjs` drives a real browser and a real HTTP request; it cannot run
 * in this repo's CI. What CAN run here is the property underneath it: a telemetry write REPORTS its
 * own outcome, and a rejected one is distinguishable from an accepted one at every seam between the
 * sink and the owner's button. Before B265536 there was nothing to test — the sink's failure path
 * was `() => {}` under a comment saying it made a telemetry failure invisible.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildPerfRow } from "../src/shared/telemetry/perfInstrument.js";
import { NOTE_VOCAB, assertCaptureClean, buildCapture, encodeCapture, CAPTURE_MAX_CHARS } from "../src/shared/telemetry/perfCapture.js";
import { bindPerfDelivery, perfCaptureDelivery, __resetPerfHandle } from "../src/shared/telemetry/perfRecorderHandle.js";

const srcOf = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const clientErrors = srcOf("../src/shared/telemetry/clientErrors.js");
const recorder = srcOf("../src/shared/telemetry/perfRecorder.js");
const planner = srcOf("../src/workspaces/site-planner/SitePlanner.jsx");

describe("B265536 — the telemetry sink can no longer swallow its own failure", () => {
  it("the fire-and-forget swallow is GONE from the source", () => {
    // The exact line that made every rejected write invisible.
    expect(clientErrors.includes("p.then(() => {}, () => {})")).toBe(false);
    expect(clientErrors).toContain("export function lastTelemetrySend()");
    expect(clientErrors).toContain("export function telemetryDelivery()");
  });

  it("both reporters RETURN the outcome instead of dropping it on the floor", () => {
    // Every early return is a described non-send, not a bare `return`.
    for (const reason of ['notSent("empty")', 'notSent("suppressed")', 'notSent("threw")']) {
      expect(clientErrors, `${reason} missing`).toContain(reason);
    }
    expect(clientErrors).toContain("    return sink(row);");
  });

  it("a failed write is never reported THROUGH the sink — that is a loop over a broken pipe", () => {
    const at = clientErrors.indexOf("function sink(row)");
    const body = clientErrors.slice(at, clientErrors.indexOf("\nexport function lastTelemetrySend", at));
    expect(body.includes("reportClientEvent")).toBe(false);
    expect(body.includes("reportClientError")).toBe(false);
  });

  it("the live handle exposes the delivery state, so a check needs no database round trip", () => {
    expect(clientErrors).toContain("lastSend: lastTelemetrySend");
    expect(clientErrors).toContain("delivery: telemetryDelivery");
    expect(clientErrors).toContain("configured: () => !!supabase");
  });
});

describe("B265536 — TAKEN and DELIVERED are different facts all the way to the button", () => {
  beforeEach(() => __resetPerfHandle());

  it("the handle reports UNKNOWN (null), never success, before any capture", () => {
    expect(perfCaptureDelivery()).toBe(null);
  });

  it("the recorder binds a delivery promise the UI can await", async () => {
    bindPerfDelivery(() => Promise.resolve({ ok: false, reason: "rejected" }));
    await expect(perfCaptureDelivery()).resolves.toEqual({ ok: false, reason: "rejected" });
  });

  it("a throwing binding degrades to null rather than into the app", () => {
    bindPerfDelivery(() => { throw new Error("boom"); });
    expect(perfCaptureDelivery()).toBe(null);
  });

  it("the recorder tracks each capture's delivery and counts the undelivered", () => {
    expect(recorder).toContain("bindPerfDelivery(() => _lastDelivery);");
    expect(recorder).toContain("if (!r.ok) _undelivered++;");
    expect(recorder).toContain("undelivered: _undelivered");
  });

  /* ⛔ THE BUTTON IS THE POINT. It used to set "ok" the instant a capture was BUILT, so his own
   * highest-value signal reported ✓ for rows that never left the machine. */
  it("the ✓ waits for the server; a rejection reads as a warning, not as success", () => {
    const at = planner.indexOf('data-testid="report-slow"');
    const block = planner.slice(at - 1200, at + 2600);
    expect(block).toContain('setSlowNote("sending")');
    expect(block).toContain("perfCaptureDelivery()");
    expect(block).toContain('setSlowNote(ok ? "ok" : "undelivered")');
    // The old shape — ✓ straight off the local capture — must not come back.
    expect(planner.includes('setSlowNote(ok ? "ok" : "fail");')).toBe(false);
  });
});

describe("B265540 — an empty frame track SAYS it is empty", () => {
  it("`no-frames` is in the fixed note vocabulary", () => {
    expect(NOTE_VOCAB).toContain("no-frames");
  });

  it("the recorder prefers it over the baseline notes — the payload's own state comes first", () => {
    expect(recorder).toContain('note: deltas.length === 0 ? "no-frames"');
  });

  it("a capture carrying the note still passes the privacy allowlist and still encodes", () => {
    const cap = buildCapture({ kind: "manual", atMs: 10, atWall: 1, frameDeltas: [], note: "no-frames", frameStats: { frames: 0 } });
    expect(assertCaptureClean(cap)).toEqual([]);
    expect(cap.note).toBe("no-frames");
    const enc = encodeCapture(cap, { maxChars: CAPTURE_MAX_CHARS });
    expect(enc.fits).toBe(true);
    expect(JSON.parse(enc.text).note).toBe("no-frames");
  });

  it("a note outside the vocabulary is still refused", () => {
    const cap = buildCapture({ kind: "manual", atMs: 1, atWall: 1, note: "whatever he typed" });
    expect(cap.note).toBeUndefined();
  });
});

/* ⛔ B265537 — THE COUNTER THAT ALMOST PRODUCED THIS PROGRAMME'S FIFTH FALSE FINDING.
 *
 * `t` is WALL-CLOCK SECONDS since load. Read as milliseconds off the owner's own 2026-08-07 series,
 * a 237-SECOND gap became an apparent 237 ms one, and 19 long tasks with 1,835 ms of blocking inside
 * it read as work landing outside interaction — a real-sounding lead. Corrected: 1,835 ms over 237 s
 * is a 0.8% duty cycle, which is ordinary. The arithmetic is pinned here so the reading cannot drift
 * again, and every row now carries its own deltas so no reader has to difference the right pair. */
describe("B265537 — `t` is wall seconds, and the row carries deltas so it cannot be misread", () => {
  const snap = (secondsSinceLoad, longtaskMs, longtasks) => ({ secondsSinceLoad, longtaskMs, longtasks, kind: "longtask" });

  it("the FIRST row from a tab carries no deltas (there is nothing to difference against)", () => {
    const row = buildPerfRow(snap(9955, 2826, 16), null);
    expect(row.t).toBe(9955);
    expect(row.dt).toBeUndefined();
    expect(row.dlt).toBeUndefined();
    expect(row.dltn).toBeUndefined();
  });

  it("a later row carries the elapsed time and the blocked-time/long-task deltas", () => {
    const prev = snap(14436, 5467, 40);
    const row = buildPerfRow(snap(14673, 7302, 59), prev);
    expect(row.dt).toBe(237);      // SECONDS — the owner's real pair, four minutes apart
    expect(row.dlt).toBe(1835);
    expect(row.dltn).toBe(19);
  });

  it("the reading the deltas make impossible: 1,835 ms over 237 s is under one percent", () => {
    const row = buildPerfRow(snap(14673, 7302, 59), snap(14436, 5467, 40));
    expect(row.dlt / (row.dt * 1000)).toBeLessThan(0.01);
  });

  it("`t` reconciles with wall clock on his real series — 5.14 h of rows, 18,502 s of `t`", () => {
    // 2026-08-07 21:52:38Z (t=9955) → 2026-08-08 03:01:00Z (t=28457)
    const wallSeconds = (Date.parse("2026-08-08T03:01:00Z") - Date.parse("2026-08-07T21:52:38Z")) / 1000;
    expect(28457 - 9955).toBe(wallSeconds);
  });

  it("the cumulative columns are documented as cumulative at the source", () => {
    const src = srcOf("../src/shared/telemetry/perfInstrument.js");
    expect(src).toContain("WALL seconds since load");
    expect(src).toContain("CUMULATIVE total long-task ms since load");
    expect(src).toContain("a high-water mark");
  });
});

/* ⛔ B265539 — the telemetry carried `ly 4` and nothing that said WHICH four, so the fixture arm
 * built from it could only ever be a guess. A count cannot be turned into a scene. */
describe("B265539 — the layer KEYS ride the capture, sanitised and bounded", () => {
  beforeEach(() => __resetPerfHandle());
  const handle = () => import("../src/shared/telemetry/perfRecorderHandle.js");

  it("only layers that are ON are recorded, sorted for stability", async () => {
    const { noteLayerContext, perfContext } = await handle();
    noteLayerContext({ fema: { on: true }, contours: { on: false }, jur_county: { on: true } });
    expect(perfContext().layers).toBe("fema,jur_county");
  });

  it("a long list is CUT with a `+`, never silently truncated into a complete-looking one", async () => {
    const { noteLayerContext, perfContext } = await handle();
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`layer_key_${i}`, { on: true }]));
    noteLayerContext(many);
    const v = perfContext().layers;
    expect(v.length).toBeLessThanOrEqual(45);
    expect(v.endsWith("+")).toBe(true);
  });

  it("garbage in a key cannot escape the sanitiser, and a bad input never throws", async () => {
    const { noteLayerContext, perfContext } = await handle();
    noteLayerContext({ "fe ma<script>": { on: true } });
    expect(perfContext().layers).toBe("femascript");
    expect(() => noteLayerContext(null)).not.toThrow();
  });

  it("the field passes the capture allowlist, and an unsanitised one is REFUSED", () => {
    expect(assertCaptureClean(buildCapture({ kind: "auto", atMs: 1, atWall: 1, layers: "fema,contours+" }))).toEqual([]);
    expect(assertCaptureClean({ v: 1, layers: "fema; drop table" })).toContain("layers: unsanitised");
  });
});

/* ⛔ B265541 — FOUND BY THE NEW HARNESS ON ITS FIRST REAL STALL, and it is the worst-aimed defect
 * in the encoder: the jankier the episode, the likelier the row arrived with NO frame track at all.
 * A frame over 63 ms will not fit the packed track's one base-64 digit, so it is ALSO carried in
 * `fx` at about ten characters apiece — nothing on a smooth capture, nearly every frame on a real
 * stall. The shed stopped dead at 60 frames, and a row that still overran fell through to the bare
 * last-resort row, which drops every series. */
describe("B265541 — a capture of a BAD moment keeps its episode", () => {
  /* A stall: ~120 frames, almost all past the 63 ms clamp, so nearly every one also costs an `fx`
   * pair — plus a full task list and a full counter history. This is the shape that fell through. */
  const stallCapture = () => buildCapture({
    kind: "auto", atMs: 44000, atWall: 1786175655484, activeMs: 2809,
    route: "project", build: "c6a4b94", plan: "bain-concept-original", planIdKind: "id",
    visibility: "visible", layers: "contours,fema,jur_county,txrrc_pipe",
    frameDeltas: Array.from({ length: 120 }, (_, i) => 88 + (i % 17)),
    tasks: Array.from({ length: 24 }, (_, i) => [40000 + i * 37, 170 - i, 114 - i, i % 6]),
    taskNames: ["unknown", "other", "z", "m", "TimerHandler:setTimeout", "FrameRequestCallback"],
    counters: Array.from({ length: 20 }, (_, i) => [41000 + i * 500, 33.57, 1899, 754, 52, 4, 0, 326, 0.23, 0, 0, 2.43]),
    counterColumns: ["t", "heap", "dom", "cv", "el", "ly", "pn", "tiles", "ppf", "ed", "sw", "act"],
    frameStats: { frames: 120, p50Ms: 92, p95Ms: 103, p99Ms: 104, maxMs: 104, jankFrames: 120 },
  });

  it("the row fits, and it still carries frames", () => {
    const enc = encodeCapture(stallCapture(), { maxChars: CAPTURE_MAX_CHARS });
    const row = JSON.parse(enc.text);
    expect(enc.fits).toBe(true);
    expect(row.ft.length, "the whole episode was dropped — this is the B265541 defect").toBeGreaterThan(0);
    expect(row.note).not.toBe("trimmed-hard");
  });

  it("the shed steps DOWN past 60 rather than falling off it", () => {
    // Squeeze hard enough that 60 frames cannot possibly fit, and require real frames anyway.
    const enc = encodeCapture(stallCapture(), { maxChars: 900 });
    const row = JSON.parse(enc.text);
    expect(row.ft.length).toBeGreaterThanOrEqual(8);
    expect(row.ft.length).toBeLessThan(60);
    expect(enc.text.length).toBeLessThanOrEqual(900);
  });

  it("what was dropped is still stated — a shorter episode may never read as a calmer one", () => {
    const enc = encodeCapture(stallCapture(), { maxChars: 900 });
    const row = JSON.parse(enc.text);
    expect(row.framesKept).toBe(row.ft.length);
    expect(row.framesDropped).toBe(120 - row.ft.length);
    expect(row.note).toBe("trimmed");
  });

  it("the bare last-resort row is still reachable when even the smallest floor will not fit", () => {
    const enc = encodeCapture(stallCapture(), { maxChars: 320 });
    const row = JSON.parse(enc.text);
    expect(row.note).toBe("trimmed-hard");
    expect(row.framesKept).toBe(0);
    expect(row.framesDropped).toBe(120);       // says so, rather than looking like a quiet capture
  });
});

describe("B265536 — the row the sink builds fits the column it rides in", () => {
  it("a maximal capture plus the tab prefix stays under the 2000-char message cap", () => {
    const cap = buildCapture({
      kind: "auto", atMs: 1, atWall: 1,
      frameDeltas: Array.from({ length: 4096 }, (_, i) => (i % 7) * 30),
      tasks: Array.from({ length: 192 }, (_, i) => [i, 200 + i, 100, 1]),
      taskNames: Array.from({ length: 24 }, (_, i) => `chunk-${i}.js`),
      counters: Array.from({ length: 96 }, (_, i) => [i, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
      counterColumns: ["t", "heap", "dom", "cv", "el", "ly", "pn", "tiles", "ppf", "ed", "sw", "act"],
      frameStats: { frames: 4096, p50Ms: 16.7, p95Ms: 90, p99Ms: 98, maxMs: 632, jankFrames: 400 },
    });
    const enc = encodeCapture(cap, { maxChars: CAPTURE_MAX_CHARS });
    const withPrefix = `[tab abcdef12] ${enc.text}`;
    expect(withPrefix.length).toBeLessThanOrEqual(2000);
    // …and it still parses after the trim, which is the whole reason the encoder trims at all.
    expect(() => JSON.parse(enc.text)).not.toThrow();
  });
});
