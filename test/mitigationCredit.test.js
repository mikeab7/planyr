// NEW-21 (owner live-verify 2026-07-24) — the ONE shared mitigationCredit() so the site ledger, the
// Yield verdict, the pond-sizing optimizer, and the ⚡ Optimize card can never compute "provided
// mitigation" two different ways (the SHORT 0.0 verdict vs the card's "already covers 0.2" — the exact
// contradiction the owner caught). A below-WSE cut credits ONLY when the floodplain can use it:
// hydraulically open (not berm-sealed) AND the pond is designated Mitigation/Hybrid.
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
// below-WSE mitigation candidate. bermed:false unless a test says otherwise.
const det = { depth: 10, freeboard: 1, slope: 3, tobElev: 100 };
const bands = bandedStorage(SQ(200), det, { wseFt: 95 });
const splitOpen = { mode: "anchored", bands, wseFt: 95, grossCf: bands.grossCf, bermed: false };

describe("mitigationCredit — the ONE shared gate (role + hydraulic seal)", () => {
  it("candidate exists but a DETENTION pond credits nothing (reason role-detention)", () => {
    const c = mitigationCredit({ role: "detention" }, splitOpen);
    expect(bands.mitigationCandidateCf).toBeGreaterThan(0);
    expect(c.candidateCf).toBeCloseTo(bands.mitigationCandidateCf, 6);
    expect(c.creditedCf).toBe(0);
    expect(c.reason).toBe("role-detention");
  });

  it("a MITIGATION or HYBRID pond credits the full candidate (reason null)", () => {
    for (const role of ["mitigation", "dual"]) {
      const c = mitigationCredit({ role }, splitOpen);
      expect(c.creditedCf).toBeCloseTo(bands.mitigationCandidateCf, 6);
      expect(c.reason).toBe(null);
    }
  });

  it("a BERMED pond whose rim clears the flood WSE is sealed → zero credit even as Mitigation (berm-sealed)", () => {
    // rim (TOB 100) above the flood WSE (95) + bermed → the berm keeps the flood out.
    const sealed = { ...splitOpen, bermed: true };
    const c = mitigationCredit({ role: "mitigation" }, sealed);
    expect(c.candidateCf).toBeGreaterThan(0);
    expect(c.creditedCf).toBe(0);
    expect(c.reason).toBe("berm-sealed");
  });

  it("a BERMED pond OVERTOPPED by the flood (rim below WSE) is NOT sealed — the role gate governs", () => {
    // TOB 94 below the flood WSE 96 → the flood overtops the berm, so the cut IS wetted.
    const det2 = { depth: 10, freeboard: 1, slope: 3, tobElev: 94 };
    const bands2 = bandedStorage(SQ(200), det2, { wseFt: 96 });
    const overtopped = { mode: "anchored", bands: bands2, wseFt: 96, grossCf: bands2.grossCf, bermed: true };
    expect(mitigationCredit({ role: "mitigation" }, overtopped).reason).toBe(null); // credits
    expect(mitigationCredit({ role: "detention" }, overtopped).reason).toBe("role-detention");
  });

  it("no candidate → zero credit, no reason", () => {
    const dry = { mode: "anchored", bands: { mitigationCandidateCf: 0, elevations: {} }, wseFt: 95, grossCf: 1, bermed: false };
    expect(mitigationCredit({ role: "mitigation" }, dry)).toEqual({ creditedCf: 0, candidateCf: 0, reason: null });
  });
});

describe("NEW-21 — the ledger and the optimizer AGREE (both read mitigationCredit)", () => {
  const entry = (role) => ({
    id: "p1", mode: "anchored", usableCf: bands.usableCf, deadCf: 0, grossCf: bands.grossCf, bands,
    wseFt: 95, inTrigger: true, factsKnown: true, role, bermed: false,
  });

  it("the ledger credits a detention pond ZERO and records the gate reason", () => {
    const led = accumulatePondLedger([entry("detention")]);
    expect(led.creditedMitCf).toBe(0);
    expect(led.uncreditedMitCf).toBeCloseTo(bands.mitigationCandidateCf, 6);
    expect(led.mitGatedReason).toBe("role-detention");
  });

  it("the ledger credits a mitigation pond the full candidate, no gate reason", () => {
    const led = accumulatePondLedger([entry("mitigation")]);
    expect(led.creditedMitCf).toBeCloseTo(bands.mitigationCandidateCf, 6);
    expect(led.mitGatedReason).toBe(null);
  });

  it("sizePondForTargets on a DETENTION pond GATES mitigation (never 'covered'), matching the ledger's 0", () => {
    const r = sizePondForTargets({ ring: SQ(200), det: { ...det, role: "detention" }, wseFt: 95, mitTargetCf: 0.2 * AC, detTargetCf: 0 });
    expect(r.ok).toBe(true);
    expect(r.mitigation.providedCf).toBe(0);       // SAME zero the ledger/verdict show (not the raw candidate)
    expect(r.mitigation.covered).toBe(false);      // never the false "already covers"
    expect(r.mitigation.gated).toBe("role-detention");
    expect(r.actions.some((a) => a.kind === "mitigation-gated")).toBe(true);
    expect(r.actions.some((a) => a.kind === "deepen")).toBe(false); // no futile dig on a gated pond
  });

  it("sizePondForTargets on a MITIGATION pond is NOT gated (credits + sizes as before)", () => {
    const r = sizePondForTargets({ ring: SQ(200), det: { ...det, role: "mitigation" }, wseFt: 95, mitTargetCf: 0.2 * AC, detTargetCf: 0 });
    expect(r.mitigation.gated).toBe(null);
    expect(r.mitigation.providedCf).toBeGreaterThan(0);
  });
});

describe("NEW-21/22/23 — SitePlanner wiring (source scan)", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

  it("NEW-21 — the Optimize card names the gate reason + options (never a false 'sized toward'/'already covers')", () => {
    expect(src).toContain("} else if (pass2.mitigation.gated) {");
    expect(src).toContain('mitGapNote = pass2.mitigation.gated === "berm-sealed"');
    expect(src).toContain("its berm seals it off from the floodplain");
    expect(src).toContain("set its purpose to Hybrid (Detention + Mitigation)");
  });

  it("NEW-21 — the pond ledger stamps `bermed`, and the drainage object exposes the gate reason", () => {
    expect(src).toContain("const bermed = gradeFt != null && Number.isFinite(det.tobElev) && det.tobElev > gradeFt + 0.02;");
    expect(src).toContain("gatedReason: pondLedger.mitGatedReason");
    // the Mitigation-detail panel explains a gated SHORT (not just the card)
    expect(src).toContain('d.mitProvided.gatedReason');
    expect(src).toContain('"mit-gated"');
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
