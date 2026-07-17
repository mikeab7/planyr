// B832 (chat NEW-12) — drainage facts auto-revalidate: the pure decision layer.
// Load-kind (missing/stale/incomplete snapshot) vs edit-kind (envelope exit /
// anchor drift) and the never-refetch-inside-the-envelope rule. Pure — no browser.
import { describe, it, expect } from "vitest";
import { envelopeOf, envelopeContains, anchorDriftFt, revalidationNeed, ANCHOR_DRIFT_FT, fetchStaleForEdit, FETCH_TTL_MS, canonEnv, ENV_TOL_FT, DRAIN_STUCK_MS, fetchWatchdogFired } from "../src/workspaces/site-planner/lib/factRevalidation.js";

const ENV = { mnX: 0, mnY: 0, mxX: 1000, mxY: 1000 };
const IN = { mnX: 100, mnY: 100, mxX: 900, mxY: 900 };
const OUT = { mnX: 100, mnY: 100, mxX: 1400, mxY: 900 };
const P = (x, y) => ({ x, y });
const LC = (over = {}) => ({
  sig: "sig-1",
  fetch: { env: ENV, anchorPt: P(500, 500), groundPt: P(400, 400), mode: "manual" },
  ...over,
});

describe("envelope + drift primitives", () => {
  it("envelopeOf builds the bbox and skips junk points", () => {
    expect(envelopeOf([P(0, 0), P(10, 20), { x: NaN, y: 1 }, P(-5, 3)])).toEqual({ mnX: -5, mnY: 0, mxX: 10, mxY: 20 });
    expect(envelopeOf([])).toBeNull();
  });
  it("envelopeContains is inclusive at the edges and honors tolerance", () => {
    expect(envelopeContains(ENV, ENV)).toBe(true);
    expect(envelopeContains(ENV, IN)).toBe(true);
    expect(envelopeContains(ENV, OUT)).toBe(false);
    expect(envelopeContains(ENV, { ...IN, mxX: 1005 }, 10)).toBe(true);
  });
  it("anchorDriftFt is euclidean; null on missing points", () => {
    expect(anchorDriftFt(P(0, 0), P(30, 40))).toBe(50);
    expect(anchorDriftFt(null, P(0, 0))).toBeNull();
  });
});

describe("revalidationNeed — load kind", () => {
  it("no snapshot at all → load/no-check", () => {
    const r = revalidationNeed({ hasSessionCtx: false, lastCheck: null, sigNow: "s" });
    expect(r).toMatchObject({ need: true, kind: "load", reason: "no-check" });
  });
  it("stale sig → load/stale-sig; matching fresh snapshot → no need", () => {
    expect(revalidationNeed({ hasSessionCtx: false, lastCheck: LC(), sigNow: "sig-OTHER", bboxNow: IN, anchorNow: P(500, 500), groundNow: P(400, 400) }))
      .toMatchObject({ need: true, kind: "load", reason: "stale-sig" });
    expect(revalidationNeed({ hasSessionCtx: false, lastCheck: LC(), sigNow: "sig-1", bboxNow: IN, anchorNow: P(500, 500), groundNow: P(400, 400) }).need).toBe(false);
  });
  it("geometry-incomplete snapshot (the B804/B829 class) → load/incomplete", () => {
    const r = revalidationNeed({ hasSessionCtx: false, lastCheck: LC(), sigNow: "sig-1", incomplete: true, bboxNow: IN, anchorNow: P(500, 500), groundNow: P(400, 400) });
    expect(r).toMatchObject({ need: true, kind: "load", reason: "incomplete" });
  });
  it("a live in-session check suppresses every load-kind trigger", () => {
    const r = revalidationNeed({ hasSessionCtx: true, lastCheck: null, sigNow: "s", bboxNow: IN });
    expect(r.need).toBe(false);
  });
});

describe("revalidationNeed — edit kind (the envelope rule)", () => {
  const base = { hasSessionCtx: true, lastCheck: LC(), sigNow: "sig-2", anchorNow: P(500, 500), groundNow: P(400, 400) };
  it("moves INSIDE the fetched envelope never refetch — even with a stale sig", () => {
    expect(revalidationNeed({ ...base, bboxNow: IN }).need).toBe(false);
  });
  it("the envelope exit refetches (edit/env-exit)", () => {
    expect(revalidationNeed({ ...base, bboxNow: OUT })).toMatchObject({ need: true, kind: "edit", reason: "env-exit" });
  });
  it("anchor drift beyond ~100 ft refetches; under it does not", () => {
    expect(revalidationNeed({ ...base, bboxNow: IN, anchorNow: P(500 + ANCHOR_DRIFT_FT + 5, 500) }))
      .toMatchObject({ need: true, kind: "edit", reason: "anchor-moved" });
    expect(revalidationNeed({ ...base, bboxNow: IN, anchorNow: P(500 + ANCHOR_DRIFT_FT - 5, 500) }).need).toBe(false);
    expect(revalidationNeed({ ...base, bboxNow: IN, groundNow: P(400, 400 + ANCHOR_DRIFT_FT + 5) }))
      .toMatchObject({ need: true, kind: "edit", reason: "ground-moved" });
  });
  it("a legacy snapshot without a fetch record never edit-triggers (nothing to compare)", () => {
    expect(revalidationNeed({ ...base, lastCheck: { sig: "sig-2" }, bboxNow: OUT }).need).toBe(false);
  });
  it("keys are stable per target and change when the target moves", () => {
    const a = revalidationNeed({ ...base, bboxNow: OUT });
    const b = revalidationNeed({ ...base, bboxNow: OUT });
    const c = revalidationNeed({ ...base, bboxNow: { ...OUT, mxX: 2400 } });
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
  });
});

describe("B860 (chat NEW-1) — TTL refresh-on-open", () => {
  const NOW = 1_000_000_000_000;
  it("a remembered snapshot older than the TTL background-refreshes once on open (load/ttl-aged)", () => {
    const lc = { sig: "sig-1", checkedAt: NOW - FETCH_TTL_MS - 60_000, fetch: { env: ENV } };
    const r = revalidationNeed({ hasSessionCtx: false, lastCheck: lc, sigNow: "sig-1", bboxNow: IN, nowMs: NOW });
    expect(r).toMatchObject({ need: true, kind: "load", reason: "ttl-aged" });
  });
  it("a fresh remembered snapshot within the TTL does NOT refresh", () => {
    const lc = { sig: "sig-1", checkedAt: NOW - 60_000, fetch: { env: ENV } };
    expect(revalidationNeed({ hasSessionCtx: false, lastCheck: lc, sigNow: "sig-1", bboxNow: IN, nowMs: NOW }).need).toBe(false);
  });
  it("TTL check is skipped without a clock (nowMs omitted) — pure default off", () => {
    const lc = { sig: "sig-1", checkedAt: 1, fetch: { env: ENV } };
    expect(revalidationNeed({ hasSessionCtx: false, lastCheck: lc, sigNow: "sig-1", bboxNow: IN }).need).toBe(false);
  });
  it("a live in-session check suppresses the TTL trigger too", () => {
    const lc = { sig: "sig-1", checkedAt: NOW - FETCH_TTL_MS - 60_000, fetch: { env: ENV } };
    expect(revalidationNeed({ hasSessionCtx: true, lastCheck: lc, sigNow: "sig-1", bboxNow: IN, nowMs: NOW }).need).toBe(false);
  });
  it("the TTL key buckets by TTL window so it fires a single attempt, not per render", () => {
    const lc = { sig: "sig-1", checkedAt: 0, fetch: { env: ENV } };
    const a = revalidationNeed({ hasSessionCtx: false, lastCheck: lc, sigNow: "sig-1", bboxNow: IN, nowMs: NOW });
    const b = revalidationNeed({ hasSessionCtx: false, lastCheck: lc, sigNow: "sig-1", bboxNow: IN, nowMs: NOW + 5_000 });
    expect(a.key).toBe(b.key); // same TTL bucket → same key → one attempt
  });
});

describe("B860 (chat NEW-1) — fetchStaleForEdit (the UI flag mirrors edit-kind)", () => {
  const REC = { env: ENV, anchorPt: P(500, 500), groundPt: P(400, 400) };
  it("in-envelope geometry is NOT fetch-stale (numbers recompute live)", () => {
    expect(fetchStaleForEdit(REC, { bboxNow: IN, anchorNow: P(500, 500), groundNow: P(400, 400) })).toBe(false);
  });
  it("an envelope exit IS fetch-stale", () => {
    expect(fetchStaleForEdit(REC, { bboxNow: OUT, anchorNow: P(500, 500), groundNow: P(400, 400) })).toBe(true);
  });
  it("anchor / ground drift beyond the threshold is fetch-stale", () => {
    expect(fetchStaleForEdit(REC, { bboxNow: IN, anchorNow: P(500 + ANCHOR_DRIFT_FT + 5, 500), groundNow: P(400, 400) })).toBe(true);
    expect(fetchStaleForEdit(REC, { bboxNow: IN, anchorNow: P(500, 500), groundNow: P(400, 400 + ANCHOR_DRIFT_FT + 5) })).toBe(true);
  });
  it("no fetch record or no geometry → never stale (guards)", () => {
    expect(fetchStaleForEdit(null, { bboxNow: OUT })).toBe(false);
    expect(fetchStaleForEdit(REC, { bboxNow: null })).toBe(false);
  });
});

describe("B874 — canonEnv + tolerance kill the ambient stuck-refresh (rounding can't shrink the env)", () => {
  it("canonEnv rounds OUTWARD (floor mins, ceil maxs) so it always CONTAINS the source geometry", () => {
    const raw = { mnX: 100.6, mnY: 50.4, mxX: 900.4, mxY: 800.6 };
    const c = canonEnv(raw);
    expect(c).toEqual({ mnX: 100, mnY: 50, mxX: 901, mxY: 801 });
    // the canonical env contains the raw bbox it was measured from (the whole point)
    expect(envelopeContains(c, raw)).toBe(true);
  });

  it("REGRESSION: the OLD Math.round writer shrank the env → env-exit tripped on UNCHANGED geometry", () => {
    // A fractional bbox whose min rounds UP and max rounds DOWN (both shrink the env).
    const raw = { mnX: 100.6, mnY: 100.6, mxX: 900.4, mxY: 900.4 };
    const oldRounded = { mnX: Math.round(raw.mnX), mnY: Math.round(raw.mnY), mxX: Math.round(raw.mxX), mxY: Math.round(raw.mxY) };
    expect(oldRounded).toEqual({ mnX: 101, mnY: 101, mxX: 900, mxY: 900 });
    // Old behavior (tol 0): the stored env does NOT contain the true geometry → false stale.
    expect(envelopeContains(oldRounded, raw, 0)).toBe(false);
    // New behavior: canonEnv + the ENV_TOL_FT slack → contained → NOT stale (no ambient trigger).
    expect(envelopeContains(canonEnv(raw), raw, ENV_TOL_FT)).toBe(true);
  });

  it("fetchStaleForEdit: unchanged geometry stored via canonEnv is NOT stale (ambient load stays quiet)", () => {
    const raw = { mnX: 12.3, mnY: 45.6, mxX: 678.9, mxY: 234.1 };
    const rec = { env: canonEnv(raw), anchorPt: P(300, 150), groundPt: P(300, 150), mode: "manual" };
    // bboxNow is the raw un-rounded geometry (exactly what drainFactsNow feeds).
    expect(fetchStaleForEdit(rec, { bboxNow: raw, anchorNow: P(300, 150), groundNow: P(300, 150) })).toBe(false);
  });

  it("revalidationNeed: unchanged geometry via canonEnv fires NO edit-kind refetch (need:false)", () => {
    const raw = { mnX: 12.3, mnY: 45.6, mxX: 678.9, mxY: 234.1 };
    const lc = { sig: "sig-1", fetch: { env: canonEnv(raw), anchorPt: P(300, 150), groundPt: P(300, 150), mode: "auto" } };
    const r = revalidationNeed({ hasSessionCtx: true, lastCheck: lc, sigNow: "sig-1", bboxNow: raw, anchorNow: P(300, 150), groundNow: P(300, 150) });
    expect(r.need).toBe(false);
  });

  it("a REAL boundary growth (many feet past the env) still trips env-exit — the slack doesn't mask staleness", () => {
    const raw = { mnX: 100, mnY: 100, mxX: 900, mxY: 900 };
    const rec = { env: canonEnv(raw), anchorPt: P(500, 500), groundPt: P(500, 500), mode: "manual" };
    const grown = { mnX: 100, mnY: 100, mxX: 1500, mxY: 900 }; // grew 600 ft east
    expect(fetchStaleForEdit(rec, { bboxNow: grown, anchorNow: P(500, 500), groundNow: P(500, 500) })).toBe(true);
  });

  it("canonEnv guards: null / non-finite → null", () => {
    expect(canonEnv(null)).toBeNull();
    expect(canonEnv({ mnX: NaN, mnY: 0, mxX: 1, mxY: 1 })).toBeNull();
  });
});

describe("B874 (edit-path recurrence) — fetchWatchdogFired bounds the refresh spinner", () => {
  it("the hard ceiling exceeds the 30 s fetch timeout so a slow-but-completing pull isn't cut off", () => {
    expect(DRAIN_STUCK_MS).toBeGreaterThan(30000);
  });

  it("a fresh episode has NOT fired; one older than the ceiling HAS", () => {
    const start = 1_000_000;
    expect(fetchWatchdogFired(start, start)).toBe(false); // just began
    expect(fetchWatchdogFired(start, start + DRAIN_STUCK_MS)).toBe(false); // exactly at ceiling — not yet
    expect(fetchWatchdogFired(start, start + DRAIN_STUCK_MS + 1)).toBe(true); // over → terminal
  });

  it("respects a custom ceiling (the busy and armed watchdogs pass DRAIN_STUCK_MS)", () => {
    expect(fetchWatchdogFired(0 + 1, 0 + 1 + 5001, 5000)).toBe(true);
    expect(fetchWatchdogFired(1, 1 + 4999, 5000)).toBe(false);
  });

  it("no episode running (startedMs 0/null) is NEVER stuck — the spinner is simply idle", () => {
    expect(fetchWatchdogFired(0, 9_999_999)).toBe(false);
    expect(fetchWatchdogFired(null, 9_999_999)).toBe(false);
    expect(fetchWatchdogFired(undefined, 9_999_999)).toBe(false);
  });

  it("guards non-finite now", () => {
    expect(fetchWatchdogFired(1000, NaN)).toBe(false);
  });
});
