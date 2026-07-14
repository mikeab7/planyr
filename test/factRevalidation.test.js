// B832 (chat NEW-12) — drainage facts auto-revalidate: the pure decision layer.
// Load-kind (missing/stale/incomplete snapshot) vs edit-kind (envelope exit /
// anchor drift) and the never-refetch-inside-the-envelope rule. Pure — no browser.
import { describe, it, expect } from "vitest";
import { envelopeOf, envelopeContains, anchorDriftFt, revalidationNeed, ANCHOR_DRIFT_FT } from "../src/workspaces/site-planner/lib/factRevalidation.js";

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
