// B862 (chat NEW-3) — the shared required-vs-provided bullet bar geometry. Pure — no DOM.
import { describe, it, expect } from "vitest";
import { bulletBarLayout, stackedBarLayout, bulletBarMarks, stackedBarMarks, stormwaterBarSpecs } from "../src/workspaces/site-planner/lib/yieldBar.js";

const AF = 43560;

describe("bulletBarLayout — point requirement", () => {
  it("surplus: provided beyond a point requirement → positive delta, provided bar longer than the tick", () => {
    const L = bulletBarLayout({ provided: 15, required: 10 });
    expect(L.delta).toBeCloseTo(5, 5);
    expect(L.provFrac).toBeGreaterThan(L.reqFrac);
    expect(L.noneRequired).toBe(false);
  });
  it("shortfall: provided under the requirement → negative delta, provided bar shorter than the tick", () => {
    const L = bulletBarLayout({ provided: 6, required: 10 });
    expect(L.delta).toBeCloseTo(-4, 5);
    expect(L.provFrac).toBeLessThan(L.reqFrac);
  });
  it("scale leaves headroom so the longer of the two never hits the far edge", () => {
    const L = bulletBarLayout({ provided: 15, required: 10 });
    expect(L.provFrac).toBeLessThan(1); // headroom
    expect(L.scaleMax).toBeGreaterThan(15);
  });
});

describe("bulletBarLayout — band requirement renders a SPAN, not a tick", () => {
  it("a screening band produces spanFrac (a shaded span), no point tick, delta vs the high end", () => {
    const L = bulletBarLayout({ provided: 9, bandLo: 7.5, bandHi: 10 });
    expect(L.spanFrac).toHaveLength(2);
    expect(L.reqFrac).toBeNull();
    expect(L.delta).toBeCloseTo(9 - 10, 5); // conservative: vs the high end
  });
});

describe("bulletBarLayout — zero / unknown edge cases (never a misleading zero bar)", () => {
  it("zero required → noneRequired, no tick", () => {
    const L = bulletBarLayout({ provided: 3, required: 0 });
    expect(L.noneRequired).toBe(true);
    expect(L.delta).toBeNull();
  });
  it("null required → noneRequired (nothing to compare against)", () => {
    const L = bulletBarLayout({ provided: 3, required: null });
    expect(L.noneRequired).toBe(true);
  });
  it("unknown → hatched full-width bar, not zero-length", () => {
    const L = bulletBarLayout({ unknown: true });
    expect(L.unknown).toBe(true);
    expect(L.provFrac).toBe(1);
    const { marks } = bulletBarMarks(L, { w: 200 });
    expect(marks.some((m) => m.role === "hatch")).toBe(true);
    expect(marks.some((m) => m.role === "provided")).toBe(false);
  });
});

describe("bulletBarMarks — the shared primitive list", () => {
  it("point requirement emits a track, a provided rect, and a required tick", () => {
    const { marks } = bulletBarMarks(bulletBarLayout({ provided: 12, required: 10 }), { w: 200 });
    expect(marks.find((m) => m.role === "track")).toBeTruthy();
    expect(marks.find((m) => m.role === "provided")).toBeTruthy();
    expect(marks.find((m) => m.role === "required")).toBeTruthy();
    const delta = marks.find((m) => m.t === "text" && m.role === "good");
    expect(delta.s).toMatch(/\+2\.0 ac-ft/);
    expect(delta.mono).toBe(true);
  });
  it("band requirement emits a span rect + an edge tick, no point tick", () => {
    const { marks } = bulletBarMarks(bulletBarLayout({ provided: 9, bandLo: 7.5, bandHi: 10 }), { w: 200 });
    expect(marks.some((m) => m.role === "required-span")).toBe(true);
    expect(marks.some((m) => m.role === "required")).toBe(false);
  });
  it("a short provided still draws a visible (min-width) bar, never invisible", () => {
    const { marks } = bulletBarMarks(bulletBarLayout({ provided: 0.01, required: 100 }), { w: 200 });
    const prov = marks.find((m) => m.role === "provided");
    expect(prov.w).toBeGreaterThanOrEqual(2);
  });
  it("zero-required shows the explicit microcopy, not two orphaned numbers", () => {
    const { marks } = bulletBarMarks(bulletBarLayout({ provided: 3, required: 0 }), { w: 200 });
    expect(marks.some((m) => m.t === "text" && /nothing to offset/.test(m.s))).toBe(true);
  });
});

describe("stackedBarLayout — the per-pond three-band split", () => {
  it("segments partition the total; the flood-WSE marker sits at its fraction", () => {
    const L = stackedBarLayout({ segments: [{ key: "dead", value: 2 }, { key: "mit", value: 3 }, { key: "usable", value: 5 }], markerValue: 2 });
    expect(L.total).toBe(10);
    expect(L.segments.map((s) => s.key)).toEqual(["dead", "mit", "usable"]);
    expect(L.segments[0].x0).toBe(0);
    expect(L.segments[2].x1).toBeCloseTo(1, 5);
    expect(L.markerFrac).toBeCloseTo(0.2, 5);
    const { marks } = stackedBarMarks(L, { w: 200 });
    expect(marks.filter((m) => m.role === "seg")).toHaveLength(3);
    expect(marks.some((m) => m.role === "marker")).toBe(true);
  });
});

describe("stormwaterBarSpecs — the ONE shared derivation (screen == PDF)", () => {
  it("point detention: covered → +delta + covered status", () => {
    const d = { req: { kind: "point", requiredAcFt: 10 }, providedUsableCf: 15 * AF, providedCf: 15 * AF };
    const { det } = stormwaterBarSpecs(d);
    expect(det.status).toBe("covered");
    expect(det.verdict).toMatch(/\+5\.0 ac-ft/);
    expect(det.layout.delta).toBeCloseTo(5, 5);
  });
  it("point detention: short → −delta + short status", () => {
    const d = { req: { kind: "point", requiredAcFt: 10 }, providedUsableCf: 6 * AF, providedCf: 6 * AF };
    expect(stormwaterBarSpecs(d).det.status).toBe("short");
  });
  it("usable split unknown → an unknown (hatched) bar, never a fabricated surplus", () => {
    const d = { req: { kind: "point", requiredAcFt: 10 }, providedUsableCf: null, providedCf: 12 * AF };
    const { det } = stormwaterBarSpecs(d);
    expect(det.layout.unknown).toBe(true);
    expect(det.verdict).toMatch(/usable unknown/);
  });
  it("band detention → a span layout, status by where USABLE lands", () => {
    const d = { req: { kind: "band", bandAcFt: [7.5, 10] }, providedUsableCf: 9 * AF, providedCf: 9 * AF };
    const { det } = stormwaterBarSpecs(d);
    expect(det.layout.spanFrac).toHaveLength(2);
    expect(det.status).toBe("needs-input"); // between lo and hi
  });
  it("NEW-1 band detention computes off USABLE, not gross: usable 0 with gross large → SHORT", () => {
    // The Tsakiris repro: gross 38.84, usable 0.00 (fully inundated), band 28.62–33.82.
    const d = { req: { kind: "band", bandAcFt: [28.62, 33.82] }, providedUsableCf: 0, providedCf: 38.84 * AF };
    const { det } = stormwaterBarSpecs(d);
    expect(det.status).toBe("short"); // usable 0 < lo → short (never "covered" off gross 38.84)
    expect(det.layout.provFrac).toBe(0); // zero-length usable bar
    expect(det.layout.refFrac).toBeGreaterThan(0); // gross rides the de-emphasized reference tick
  });
  it("NEW-1 band detention with unknown usable → an unknown (hatched) bar, never gross-fed", () => {
    const d = { req: { kind: "band", bandAcFt: [7.5, 10] }, providedUsableCf: null, providedCf: 20 * AF };
    const { det } = stormwaterBarSpecs(d);
    expect(det.layout.unknown).toBe(true);
    expect(det.status).toBe("unknown");
  });
  it("NEW-1 point detention exposes the gross reference tick (usable < gross)", () => {
    const d = { req: { kind: "point", requiredAcFt: 10 }, providedUsableCf: 6 * AF, providedCf: 12 * AF };
    const { det } = stormwaterBarSpecs(d);
    expect(det.layout.refFrac).toBeGreaterThan(det.layout.provFrac); // gross tick right of the usable fill
  });
  it("NEW-2 mitigation: an over-provided cut reads COVERED (the OVER status is retired)", () => {
    const d = { mitigation: { intersectAcres: 2, volumeCf: 4 * AF, volumeAcFt: 4 }, mitProvided: { creditedCf: 8 * AF } };
    const { mit } = stormwaterBarSpecs(d);
    expect(mit.status).toBe("covered");
    expect(mit.verdict).toBe("covered");
  });
  it("NEW-2 mitigation shortfall stays loud (short)", () => {
    const d = { mitigation: { intersectAcres: 2, volumeCf: 8 * AF, volumeAcFt: 8 }, mitProvided: { creditedCf: 3 * AF } };
    const { mit } = stormwaterBarSpecs(d);
    expect(mit.status).toBe("short");
    expect(mit.verdict).toMatch(/−5\.0 ac-ft/);
  });
  it("mitigation volume UNKNOWN → an unknown bar", () => {
    const d = { mitigation: { intersectAcres: 2, volumeCf: null } };
    expect(stormwaterBarSpecs(d).mit.layout.unknown).toBe(true);
  });
  it("no drainage / no requirement → null specs (no bar)", () => {
    expect(stormwaterBarSpecs(null)).toEqual({ det: null, mit: null });
    expect(stormwaterBarSpecs({}).det).toBeNull();
  });
});

describe("B909 round 3 polish — a shortfall/requirement inside display-precision epsilon reads as MET, never a false SHORT", () => {
  it("mitigation: an epsilon requirement (1e-9 ac-ft) with zero provided is NOT SHORT — it's not required", () => {
    const d = { mitigation: { intersectAcres: 2, volumeCf: 1e-9 * AF, volumeAcFt: 1e-9 }, mitProvided: { creditedCf: 0 } };
    const { mit } = stormwaterBarSpecs(d);
    expect(mit.status).not.toBe("short");
    expect(mit.verdict).not.toMatch(/short/i);
    expect(mit.verdict).not.toMatch(/[−-]0\.0/i); // never a signed zero (1-decimal, B3)
  });
  it("mitigation: a real requirement met within epsilon (rounding residue) reads COVERED, not SHORT -0.00", () => {
    const d = { mitigation: { intersectAcres: 2, volumeCf: 4 * AF, volumeAcFt: 4 }, mitProvided: { creditedCf: (4 - 1e-9) * AF } };
    const { mit } = stormwaterBarSpecs(d);
    expect(mit.status).toBe("covered");
  });
  it("mitigation: a genuine shortfall beyond epsilon still reads SHORT (guardrail: epsilon isn't a loophole)", () => {
    const d = { mitigation: { intersectAcres: 2, volumeCf: 4 * AF, volumeAcFt: 4 }, mitProvided: { creditedCf: 3 * AF } };
    const { mit } = stormwaterBarSpecs(d);
    expect(mit.status).toBe("short");
  });
  it("detention point: an epsilon requirement (1e-9 ac-ft) with zero usable is NOT SHORT — none required", () => {
    const d = { req: { kind: "point", requiredAcFt: 1e-9 }, providedUsableCf: 0, providedCf: 0 };
    const { det } = stormwaterBarSpecs(d);
    expect(det.status).not.toBe("short");
    expect(det.verdict).toBe("none required");
  });
  it("detention band: usable inside epsilon of the band's low end reads covered/needs-input, never SHORT", () => {
    const d = { req: { kind: "band", bandAcFt: [10, 12] }, providedUsableCf: (10 - 1e-9) * AF, providedCf: (10 - 1e-9) * AF };
    const { det } = stormwaterBarSpecs(d);
    expect(det.status).not.toBe("short");
  });
});
