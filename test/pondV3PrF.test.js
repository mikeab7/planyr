// v3 PR-F — three residuals from Michael's post-PR-D live verification of the pond inspector:
//   F1. the site status-card headline usable MUST be the SAME number the pond's
//       "Usable detention (above flood WSE)" row shows (the E4 single-number rule again).
//       Root cause: the headline read `providedDetCf − siteDeadCf` — a DRAWN-ring gross
//       minus the INWARD-model dead — which overstates usable for a bermed pond. Fixed by
//       reading the ledger's usableCf (the sum of each pond's inward usablePondVolume split),
//       which is exactly the number the per-pond row renders.
//   F2. the two new PR-D copy strings used an em-dash; the whole sizing-assistant actLine/
//       actApply region (where those strings render) must be em-dash-free.
//   F3. the non-monotonic peak solve (inward berm) must update the APPLIED rim — the interior
//       peak raise flows through the raise-tob action into applyPondSizingActions' tobElev.
//
// Behavior lives in the pure modules; this file proves the pure chain end-to-end and guards
// the SitePlanner wiring by source scan (vitest is DOM-free). Fixture-driven — never pins live
// project values (all expected numbers are computed from the same library the app uses).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { accumulatePondLedger } from "../src/workspaces/site-planner/lib/pondLedger.js";
import { usablePondVolume, bandedStorage, detentionStorage } from "../src/workspaces/site-planner/lib/pondGeom.js";
import { solveTobRaise, sizePondForTargets, applyPondSizingActions } from "../src/workspaces/site-planner/lib/pondSizing.js";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
const SQ = (s = 120) => [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }];
const AC_FT = 43560;

// Build the same per-pond ledger entry SitePlanner's pondSplitFor produces from a usablePondVolume
// result, so accumulatePondLedger's usableCf is exactly what the site headline reads.
const entryFrom = (split, extra = {}) => ({
  id: extra.id || "p1", mode: split.mode, usableCf: split.usableCf, deadCf: split.deadCf,
  grossCf: split.grossCf, bands: split.bands, wseFt: extra.wseFt ?? 98, inTrigger: extra.inTrigger ?? true,
  estPoolDepthFt: null, factsKnown: extra.factsKnown ?? true, anchoredTob: true, autoAnchored: false,
  excavationCf: 0, role: extra.role ?? "detention",
});

describe("F1 — the status-card headline usable IS the pond's Usable-detention row (same inward number)", () => {
  it("the headline reads the ledger's usableCf, not the drawn-gross-minus-dead formula that overstated it", () => {
    // The row: `pondRow('Usable detention (above flood WSE)', f1(split.usableCf / 43560))` (16825).
    expect(src).toContain('pondRow("Usable detention (above flood WSE)", `${f1(split.usableCf / 43560)} ac-ft`)');
    // The headline: providedUsableCf now = pondLedger.usableCf — the SAME per-pond usableCf, summed.
    expect(src).toContain("const providedUsableCf = pondLedger.usableCf;");
    // The old overstating formula is GONE.
    expect(src.includes("Math.max(0, providedDetCf - siteDeadCf)")).toBe(false);
  });

  it("for a bermed inward pond the ledger usable equals the row's inward number — and the old formula would have overstated it", () => {
    const ring = SQ(120), gradeFt = 100, wseFt = 98;
    const det = { depth: 8, freeboard: 1, slope: 3, tobElev: 104 }; // rim 4 ft above grade → inward berm
    const split = usablePondVolume(ring, det, { wseFt, gradeFt });
    expect(split.mode).toBe("anchored");
    // The per-pond row shows split.usableCf / 43560; the site headline (single pond) must match it.
    const ledger = accumulatePondLedger([entryFrom(split, { wseFt })]);
    expect(ledger.usableCf).toBe(split.usableCf); // headline number === row number, exactly
    // The retired formula (drawn-ring gross − inward dead) would have produced a DIFFERENT, larger
    // number — the exact 20.9-vs-15.3 overstatement Michael reported. Guard that the fix moved it.
    const drawnGross = detentionStorage(ring, det.depth, det.freeboard, det.slope).vol;
    const oldFormula = Math.max(0, drawnGross - split.deadCf);
    // Materially overstated — well beyond the ~1.37× ratio Michael saw (20.9 vs 15.3); here ~1.95×.
    expect(oldFormula).toBeGreaterThan(split.usableCf * 1.4);
  });

  it("an unknown split still poisons the headline to null (the LOUD-FAILURE guard is preserved)", () => {
    const ring = SQ(120);
    const known = usablePondVolume(ring, { depth: 8, freeboard: 1, slope: 3, tobElev: 104 }, { wseFt: 98, gradeFt: 100 });
    const ledger = accumulatePondLedger([
      entryFrom(known, { id: "pA", wseFt: 98 }),
      { id: "pB", mode: "unknown", usableCf: null, deadCf: null, grossCf: 5000, bands: null, wseFt: null, inTrigger: true, factsKnown: false, anchoredTob: true, excavationCf: 0, role: "detention" },
    ]);
    expect(ledger.usableCf).toBeNull(); // never a numeric headline that silently counts a gross-credited pond
  });
});

describe("F2 — the sizing-assistant copy region is em-dash-free (the two flagged strings + the whole actLine/actApply set)", () => {
  it("no em-dash (U+2014) appears on any actLine/actApply line — the region these strings render in", () => {
    const EM = "—";
    const offenders = src.split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => (line.includes("actLine(") || line.includes("actApply(")) && line.includes(EM));
    expect(offenders.map((o) => o.n)).toEqual([]); // any hit prints its 1-based line number
  });

  it("the two flagged strings render with a period / colon (never an em-dash)", () => {
    expect(src).toContain("Both bands cover their remaining site targets. No resize needed.");
    expect(src).toContain("This pond's purpose is Detention: its below-WSE cut is NOT credited to mitigation.");
    expect(src.includes("Both bands cover their remaining site targets —")).toBe(false);
    expect(src.includes("This pond's purpose is Detention —")).toBe(false);
  });
});

describe("F3 — the non-monotonic (inward berm) peak solve updates the APPLIED rim", () => {
  // A 120-ft square at grade 100, WSE at grade: raising the rim builds the berm inward, so usable
  // detention rises then FALLS to zero as the crest ring pinches the footprint closed (~20 ft). The
  // solver must report the interior PEAK raise, never the clamped/closed ceiling — and that peak
  // must be the height actually applied to the pond's top of bank.
  const ring = SQ(120), gradeFt = 100, wseFt = 100;
  const det = { depth: 8, freeboard: 0, slope: 3, tobElev: 100 };

  const usableAt = (h) => {
    const b = bandedStorage(ring, { ...det, depth: det.depth + h, tobElev: det.tobElev + h }, { wseFt, gradeFt });
    return b ? b.usableCf : 0;
  };

  it("usable is genuinely non-monotonic: it rises, peaks, then pinches to zero (a closed crest)", () => {
    expect(usableAt(1)).toBeGreaterThan(usableAt(0.5));   // rising early
    const peak = usableAt(4.5);
    expect(peak).toBeGreaterThan(usableAt(1));            // real interior peak
    expect(usableAt(8)).toBeLessThan(peak);               // falling past the peak
    expect(usableAt(20)).toBe(0);                         // crest closed → holds nothing
  });

  it("solveTobRaise returns the interior peak (well below the clamp), not the maxed-out ceiling", () => {
    const maxRaiseFt = 20; // the geometric ceiling; the pinch closes right about here
    const target = usableAt(4.5) * 1.5; // beyond anything the footprint can reach
    const r = solveTobRaise({ ring, det, wseFt, targetCf: target, maxRaiseFt, gradeFt });
    expect(r.ok).toBe(false);      // unreachable
    expect(r.partial).toBe(true);  // partial gain, honestly flagged
    expect(r.hFt).toBeGreaterThan(0);
    expect(r.hFt).toBeLessThan(maxRaiseFt - 1); // NOT the clamp — the interior peak
    // the returned raise really is at/near the best usable the footprint can hold
    expect(r.addCf).toBeGreaterThan(usableAt(1));
  });

  it("the peak raise flows through the raise-tob action into the applied tobElev/depth (the rim moves)", () => {
    const maxRaiseFt = 20;
    const target = usableAt(4.5) * 1.5;
    const result = sizePondForTargets({ ring, det, wseFt, gradeFt, detTargetCf: target, mitTargetCf: 0, maxRaiseFt });
    expect(result.ok).toBe(true);
    const raiseA = result.actions.find((a) => a.kind === "raise-tob");
    expect(raiseA).toBeTruthy();
    expect(raiseA.partial).toBe(true);
    expect(raiseA.hFt).toBeGreaterThan(0);
    expect(raiseA.hFt).toBeLessThan(maxRaiseFt - 1); // the peak, not the clamp

    const el = { id: "p1", type: "pond", points: ring.map((p) => ({ ...p })), rot: 0, det: { ...det } };
    const out = applyPondSizingActions(el, result.actions);
    // The applied rim IS raised by the peak amount — floor held, tobBerm provenance stamped.
    expect(out.det.tobElev).toBeCloseTo(det.tobElev + raiseA.hFt, 6);
    expect(out.det.depth).toBeCloseTo(det.depth + raiseA.hFt, 6);
    expect(out.det.tobBerm).toEqual({ h: raiseA.hFt, applied: Math.round((det.tobElev + raiseA.hFt) * 100) / 100 });
    expect(out.points).toEqual(ring); // footprint never touched (raise-tob is elevation-only)
  });

  it("designPond ALWAYS applies the elevation solve — full OR partial (C1) — so a peak-only solve still moves the rim", () => {
    // The source guard: the raise action is applied unconditionally when present, then the message
    // branches on raiseA.partial — the apply is NOT gated behind !partial.
    expect(src).toContain("finalEl = applyPondSizingActions({ ...finalEl, det: effDetProbe }, pass1.actions);");
    expect(src).toContain("if (!raiseA.partial) {");
    // and the dry-ground path threads the partial peak through too (hFt regardless of ok).
    expect(src).toContain("return r.hFt > 0 ? [{ kind: \"raise-tob\", hFt: r.hFt, addCf: r.addCf, partial: r.ok === false }] : [];");
  });
});
