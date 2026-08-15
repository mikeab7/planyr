// NEW-21 / NEW-26 (owner live-verify 2026-07-24) — the ONE shared mitigationCredit() so the site
// ledger, the Yield verdict, the pond-sizing optimizer, and the ⚡ Optimize card can never compute
// "provided mitigation" two different ways (the SHORT 0.0 verdict vs the card's "already covers 0.2"
// — the exact contradiction the owner caught).
//
// NEW-26 supersedes the NEW-21 berm-seal + role gates: a below-WSE cut is compensating storage BY
// DEFAULT, because every detention pond is hydraulically connected to the floodplain through its own
// outfall (the flood backs in through the outlet). Credit is ZERO in exactly two cases: the outfall
// is GATED (a flap valve, `split.outletGated` / `det.outletGated`) or there is NO outfall
// (`split.hasOutfall === false`). Neither the pond's ROLE nor its BERM gates any more.
// Pure + a SitePlanner source-scan for the wiring (vitest is DOM-free). Fixture-driven.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mitigationCredit, accumulatePondLedger } from "../src/workspaces/site-planner/lib/pondLedger.js";
import { bandedStorage } from "../src/workspaces/site-planner/lib/pondGeom.js";
import { sizePondForTargets } from "../src/workspaces/site-planner/lib/pondSizing.js";

const SQ = (s = 200) => [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }];
const AC = 43560;
// A pond anchored at TOB 100 (floor ~90, water surface ~99) with a mid-column flood at 95 → a real
// below-WSE mitigation candidate. Outfall ungated + present unless a test says otherwise.
const det = { depth: 10, freeboard: 1, slope: 3, tobElev: 100 };
const bands = bandedStorage(SQ(200), det, { wseFt: 95 });
const splitOpen = { mode: "anchored", bands, wseFt: 95, grossCf: bands.grossCf };

describe("mitigationCredit — connected by DEFAULT (NEW-26)", () => {
  it("an ungated, connected pond credits the FULL candidate regardless of role (reason null)", () => {
    expect(bands.mitigationCandidateCf).toBeGreaterThan(0);
    for (const role of ["detention", "mitigation", "dual", null, undefined]) {
      const c = mitigationCredit({ role }, splitOpen);
      expect(c.candidateCf).toBeCloseTo(bands.mitigationCandidateCf, 6);
      expect(c.creditedCf).toBeCloseTo(bands.mitigationCandidateCf, 6);
      expect(c.reason).toBe(null);
    }
  });

  it("a GATED outfall on the split → zero credit, reason outlet-gated", () => {
    const c = mitigationCredit({ role: "detention" }, { ...splitOpen, outletGated: true });
    expect(c.candidateCf).toBeGreaterThan(0);
    expect(c.creditedCf).toBe(0);
    expect(c.reason).toBe("outlet-gated");
  });

  it("a GATED outfall passed on the det arg → zero credit, reason outlet-gated", () => {
    const c = mitigationCredit({ role: "mitigation", outletGated: true }, splitOpen);
    expect(c.creditedCf).toBe(0);
    expect(c.reason).toBe("outlet-gated");
  });

  it("NO outfall (hasOutfall === false) → zero credit, reason no-outfall", () => {
    const c = mitigationCredit({ role: "detention" }, { ...splitOpen, hasOutfall: false });
    expect(c.candidateCf).toBeGreaterThan(0);
    expect(c.creditedCf).toBe(0);
    expect(c.reason).toBe("no-outfall");
  });

  it("the BERM no longer gates — a bermed, connected pond still credits (NEW-26 supersedes NEW-21)", () => {
    // Under NEW-21 a bermed rim above the flood WSE zeroed the credit; NEW-26 credits it (the flood
    // reaches the cut through the outfall, not over the berm).
    const c = mitigationCredit({ role: "mitigation" }, { ...splitOpen, bermed: true });
    expect(c.creditedCf).toBeCloseTo(bands.mitigationCandidateCf, 6);
    expect(c.reason).toBe(null);
  });

  it("no candidate → zero credit, no reason", () => {
    const dry = { mode: "anchored", bands: { mitigationCandidateCf: 0, elevations: {} }, wseFt: 95, grossCf: 1 };
    expect(mitigationCredit({ role: "mitigation" }, dry)).toEqual({ creditedCf: 0, candidateCf: 0, reason: null });
  });
});

describe("NEW-26 — the ledger and the optimizer AGREE (both read mitigationCredit)", () => {
  const entry = (extra = {}) => ({
    id: "p1", mode: "anchored", usableCf: bands.usableCf, deadCf: 0, grossCf: bands.grossCf, bands,
    wseFt: 95, inTrigger: true, factsKnown: true, role: "detention", ...extra,
  });

  it("the ledger credits an ungated detention pond the FULL candidate, no gate reason", () => {
    // NEW-1 (B1032) — the credit is now DEDICATED against the site's mitigation requirement (the
    // same acre-foot can't also count for detention), so the fold is given a requirement big
    // enough for the whole band. With no requirement it dedicates nothing — asserted below.
    const led = accumulatePondLedger([entry()], { mitigationRequiredCf: 1e9 });
    expect(led.creditedMitCf).toBeCloseTo(bands.mitigationCandidateCf, 6);
    expect(led.uncreditedMitCf).toBe(0);
    expect(led.mitGatedReason).toBe(null);
    expect(led.creditedPondCount).toBe(1);
  });

  it("the ledger credits ZERO and records outlet-gated when the split is gated", () => {
    const led = accumulatePondLedger([entry({ outletGated: true })], { mitigationRequiredCf: 1e9 });
    expect(led.creditedMitCf).toBe(0);
    expect(led.uncreditedMitCf).toBeCloseTo(bands.mitigationCandidateCf, 6);
    expect(led.mitGatedReason).toBe("outlet-gated");
  });

  it("the ledger records no-outfall when the split has no outfall", () => {
    const led = accumulatePondLedger([entry({ hasOutfall: false })], { mitigationRequiredCf: 1e9 });
    expect(led.creditedMitCf).toBe(0);
    expect(led.mitGatedReason).toBe("no-outfall");
  });

  it("sizePondForTargets on a connected (ungated) pond is NOT gated — it credits + covers", () => {
    const r = sizePondForTargets({ ring: SQ(200), det: { ...det, role: "detention" }, wseFt: 95, mitTargetCf: 0.2 * AC, detTargetCf: 0 });
    expect(r.ok).toBe(true);
    expect(r.mitigation.gated).toBe(null);
    expect(r.mitigation.providedCf).toBeGreaterThan(0);
    expect(r.mitigation.covered).toBe(true); // the candidate dwarfs the small 0.2 AC-FT target
  });

  it("sizePondForTargets on a GATED outfall GATES mitigation (never 'covered'), matching the ledger's 0", () => {
    const r = sizePondForTargets({ ring: SQ(200), det: { ...det, role: "detention", outletGated: true }, wseFt: 95, mitTargetCf: 0.2 * AC, detTargetCf: 0 });
    expect(r.ok).toBe(true);
    expect(r.mitigation.providedCf).toBe(0);       // SAME zero the ledger/verdict show (not the raw candidate)
    expect(r.mitigation.covered).toBe(false);      // never a false "already covers"
    expect(r.mitigation.gated).toBe("outlet-gated");
    expect(r.actions.some((a) => a.kind === "mitigation-gated")).toBe(true);
    expect(r.actions.some((a) => a.kind === "deepen")).toBe(false); // no futile dig on a gated pond
  });
});

describe("NEW-26 / 22 / 23 — SitePlanner wiring (source scan)", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

  it("NEW-26 — the Optimize card names the outfall gate reason + fix (never a false 'sized toward'/'already covers')", () => {
    expect(src).toContain("} else if (pass2.mitigation.gated) {");
    expect(src).toContain('mitGapNote = pass2.mitigation.gated === "no-outfall"');
    expect(src).toContain("This pond has no outfall to the floodplain");
    expect(src).toContain("This pond's outfall is marked gated");
  });

  it("NEW-26 — pondSplitFor stamps `outletGated`, and the drainage object exposes the gate reason", () => {
    expect(src).toContain("const outletGated = !!(e.det && e.det.outletGated);");
    expect(src).toContain("factsKnown: true, outletGated };");
    expect(src).toContain("gatedReason: pondLedger.mitGatedReason");
    // the Mitigation-detail panel explains a gated SHORT (not just the card)
    expect(src).toContain("d.mitProvided.gatedReason");
    expect(src).toContain('"mit-gated"');
  });

  it("NEW-26 — the pond inspector carries an `outletGated` toggle (default off = connected)", () => {
    expect(src).toContain("setDet({ outletGated: e.target.checked ? true : null })");
  });

  it("NEW-26 — the credited cut flags its ASSUMED open-outfall connection (BKDD citation target)", () => {
    expect(src).toContain("Credited cut assumes an OPEN (ungated) outfall connection");
    expect(src).toContain("BKDD Rules 22-01");
  });

  it("NEW-22 — the freshness line no longer duplicates 'ago' (formatAge already supplies it)", () => {
    expect(src).toContain("`Flood data ${formatAge(floodAgeMs)}`");
    expect(src.includes("`Flood data ${formatAge(floodAgeMs)} ago`")).toBe(false);
  });

  it("NEW-23 — the per-pond 'holds' chip reads the DRAWN-ring gross (ties out to the explainer)", () => {
    expect(src).toContain("drawnGrossCf: detentionStorage(ringOf(e), e.det?.depth ?? 8, e.det?.freeboard ?? 1, e.det?.slope ?? 3).vol,");
    expect(src).toContain("holdsAcFt: (p.drawnGrossCf != null ? p.drawnGrossCf : (p.grossCf || 0)) / 43560,");
  });
});
