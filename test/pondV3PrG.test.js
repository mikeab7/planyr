// v3 PR-G — buildability GATES the verdict; Optimize never over-promises.
//   G1 the buildable envelope (drainage cap · floodway no-fill · outfall/tailwater · soft excavation).
//   G2 GREEN "OK" only when the volume is met by a buildable design; else AMBER "not buildable as drawn".
//   G3 Optimize solves within the envelope; never berms in the floodway; footprint fixed.
//   G4 the success-toast sweep (grammar, drop 0.0-mitigation, remove "drag it clear", no em-dash).
// Pure behavior lives in buildableEnvelope.test.js + pondGeom (deadFloor) + floodplainMitigation
// (ringInFloodway); this guards the SitePlanner wiring by source scan (vitest is DOM-free).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bandedStorage, usablePondVolume } from "../src/workspaces/site-planner/lib/pondGeom.js";
import { detentionVerdict } from "../src/workspaces/site-planner/lib/pondVerdict.js";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
const at = (needle) => { const i = src.indexOf(needle); if (i < 0) throw new Error(`marker not found: ${needle}`); return i; };
const dp = src.slice(at("const designPond = () => {"), at("// (B789: drainChannelRelevant now computed up"));

const SQ = (s = 200) => [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }];
const AC = 43560;

describe("G1(c) — storage below the receiving-water (tailwater) is DEAD, not usable (pondGeom deadFloorFt)", () => {
  const det = { depth: 8, freeboard: 1, slope: 3, tobElev: 100 }; // floor 92, water surface 99

  it("a tailwater floor above the pond floor SHRINKS usable and GROWS dead", () => {
    const base = usablePondVolume(SQ(200), det, { wseFt: 90 });
    const withTw = usablePondVolume(SQ(200), det, { wseFt: 90, deadFloorFt: 95 });
    expect(withTw.usableCf).toBeLessThan(base.usableCf);
    expect(withTw.deadCf).toBeGreaterThan(base.deadCf);
    // gross is unchanged — only the split moved
    expect(withTw.grossCf).toBeCloseTo(base.grossCf, 3);
  });

  it("a tailwater above the water surface leaves ZERO usable (fully dead, can't drain by gravity)", () => {
    expect(bandedStorage(SQ(200), det, { wseFt: 90, deadFloorFt: 105 }).usableCf).toBe(0);
  });

  it("a tailwater ALONE (no flood WSE, no permanent pool) still triggers the banded split", () => {
    const twOnly = usablePondVolume(SQ(200), det, { deadFloorFt: 95 });
    expect(twOnly.mode).toBe("anchored");
    expect(twOnly.deadCf).toBeGreaterThan(0);
  });

  it("no tailwater → the split is byte-for-byte the classic result (additive, backward-compatible)", () => {
    const a = usablePondVolume(SQ(200), det, { wseFt: 90 });
    const b = usablePondVolume(SQ(200), det, { wseFt: 90, deadFloorFt: null });
    expect(b.usableCf).toBe(a.usableCf);
    expect(b.deadCf).toBe(a.deadCf);
  });
});

describe("G1(a/b) — the Optimize solver enforces the buildable envelope on the rim", () => {
  it("PR-K: the floodway is NO LONGER a rim cap — the solver may berm (only the physical caps bind)", () => {
    // PR-K reverses PR-H's inTrigger no-fill gate: a mapped floodway allows a berm WITH a no-rise
    // certification (44 CFR 60.3(d)(3)), so the old `maxRaiseFt = pondInFloodway ? 0` cap is gone;
    // the precise floodway tier only drives the no-rise requirement copy, not the rim clamp.
    expect(dp).toContain("const pondTier = pondFloodplainTier(ringOf(baseEl), fmZones);");
    expect(dp).toContain("const pondInFloodway = pondTier.inFloodway;");
    expect(dp.includes("maxRaiseFt = pondInFloodway ? 0")).toBe(false);
    expect(dp).toContain("const maxRaiseFt = gradeFt == null ? BERM_MAX_RAISE_FT");
  });
  it("the drainage cap still binds when NOT in the floodway (D5 preserved under the new gate)", () => {
    expect(dp).toContain("(Number.isFinite(bermCapFt) ? bermCapFt : BERM_MAX_RAISE_FT);");
  });
  it("the tailwater is read for the solver context (persisted as receivingFlowlineElev)", () => {
    expect(dp).toContain("const pondTailwaterFt = Number.isFinite(baseEl.det?.receivingFlowlineElev) ? baseEl.det.receivingFlowlineElev : null;");
  });
});

describe("G3 — PR-K: the floodway no longer blocks the berm (the old no-fill branch is gone)", () => {
  it("the '} else if (pondInFloodway) {' no-berm branch is removed, and no 'no fill' copy remains", () => {
    expect(dp.includes("} else if (pondInFloodway) {")).toBe(false);
    expect(dp.includes("no fill is allowed")).toBe(false);
    expect(dp.includes('code: "floodway-fill"')).toBe(false);
    // the no-berm case must NOT claim "already covers" unless the target is genuinely met
    expect(dp).toContain("const metNow = Number.isFinite(nowUsableCf) && nowUsableCf >= detTargetCf - 1;");
  });
});

describe("G1(c) — pondSplitFor threads the tailwater dead-floor into EVERY real split (verdict == rows)", () => {
  it("the tailwater dead-floor is derived once and passed to each usablePondVolume call", () => {
    expect(src).toContain("const twDeadFloorFt = Number.isFinite(e.det?.receivingFlowlineElev) ? e.det.receivingFlowlineElev : null;");
    expect(src.match(/deadFloorFt: twDeadFloorFt/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe("G2 — the verdict is GREEN only for a buildable design; else AMBER 'not buildable as drawn'", () => {
  it("the status card computes buildability and demotes a volume-met-but-unbuildable design to amber", () => {
    expect(src).toContain("const bld = assessPondBuildable(selEl);");
    // PR-K — amber when a HARD limit is broken (drainage cap / outfall-tailwater) OR a no-rise
    // requirement is outstanding (a floodway berm). The old "floodplain forbids the berm" gate is gone.
    expect(src).toContain("const hardBlocked = !bld.buildable;");
    expect(src).toContain("const needsNoRise = bld.requirements.length > 0;");
    expect(src.includes("const envelopeBlocked = short && inFw;")).toBe(false);
    // NEW-1 — both facts are now handed to the ONE pure verdict derivation, which preserves
    // this tone rule (amber whenever the design is unbuildable or carries an outstanding
    // requirement) and demotes the buildability answer off the headline to the qualifier line.
    expect(src).toContain("hardBlocked,\n                      needsNoRise,");
    expect(detentionVerdict({ providedAcFt: 80, requiredAcFt: 76.7, hardBlocked: true }).tone).toBe("amber");
    expect(detentionVerdict({ providedAcFt: 80, requiredAcFt: 76.7, needsNoRise: true }).tone).toBe("amber");
    expect(detentionVerdict({ providedAcFt: 40, requiredAcFt: 76.7 }).tone).toBe("short");
    expect(detentionVerdict({ providedAcFt: 80, requiredAcFt: 76.7 }).tone).toBe("ok");
    expect(detentionVerdict({ providedAcFt: 90, requiredAcFt: 76.7, hardBlocked: true }).heading).toBe("Detention volume met — not buildable as drawn");
  });
  it("the card render carries a three-way tone (short/amber/ok)", () => {
    expect(src).toContain('t === "short" ? PAL.danger : t === "amber" ? PAL.warn : PAL.success');
  });

  // NEW-1 (2026-07-28) — PR-G's other half ("the Optimize button rides any non-OK card") is REVERSED.
  // That coupling is what removed the optimizer from an all-green panel once B1031 kept an over-dug
  // ledger green: with no non-OK card there was no row for the button to ride, so it never mounted.
  it("the optimizer no longer rides a card at all — the tone→affordance coupling is gone for good", () => {
    // Match the executable forms only — the comments above the suggestion line deliberately
    // quote the old code so the next reader knows exactly what not to reintroduce.
    expect(src.includes("statusCards.findIndex((c)")).toBe(false);
    expect(src.includes("const optimizeIdx")).toBe(false);
    expect(src.includes("i === optimizeIdx")).toBe(false);
  });
});

describe("G1(c/d) — the tailwater + max-excavation inputs exist in the inspector", () => {
  it("the receiving-water (tailwater) field exists (PR-I pre-fills it with an EST estimate)", () => {
    expect(src).toContain('<Field label="Receiving water (100-yr tailwater) elev. (ft)">');
    // PR-I replaced the standalone EST note with a pre-filled EST-tagged estimate value.
    expect(src).toContain("setDet({ receivingFlowlineElev: Number.isFinite(n) ? n : null })");
  });
  it("the editable max-excavation-depth input exists (soft geotech screen)", () => {
    expect(src).toContain('<Field label="Max excavation depth (ft)">');
    expect(src).toContain("setDet({ maxExcavDepthFt: Number.isFinite(n) ? n : null })");
    // PR-I: the envelope's max-excav now defaults to the estimated depth-to-water (don't dig below groundwater).
    expect(src).toContain("estMaxExcavDepthFt({ depthToWaterFt: dtwEst }).valueFt");
  });
});

describe("G4 — the Optimize success-toast sweep", () => {
  it("the grammar fix: the raise message is the owner's exact sentence", () => {
    expect(dp).toContain("This pond's rim was raised above the flood level and sized for the required ${fmtAcFt(detTargetCf / 43560)} ac-ft of detention.");
    // the broken shared verb-prefix is gone
    expect(dp.includes('${isNew ? "Placed a pond — " : "This pond was "}')).toBe(false);
    expect(dp).toContain('${isNew ? "Placed a pond. " : ""}');
  });
  it("the '0.0 ac-ft of mitigation' filler is dropped when the requirement rounds to 0", () => {
    expect(dp).toContain("const mitReqShown = mitTargetCf / 43560 >= 0.05;");
    expect(dp).toContain('mitMsg = mitReqShown ? `This pond already covers the required ${fmtAcFt(mitTargetCf / 43560)} ac-ft of mitigation.` : "";');
  });
  it("the overlap note is NEUTRAL — no 'drag it clear' action (the footprint never moves)", () => {
    expect(dp).toContain("Note: the footprint overlaps");
    expect(dp.includes("drag it clear")).toBe(false);
  });
  it("NO em-dash (U+2014) appears anywhere in the designPond toast/message strings", () => {
    // every user-facing string literal fragment in the handler body
    const strings = dp.match(/`[^`]*`|"[^"]*"/g) || [];
    const offenders = strings.filter((s) => s.includes("—"));
    expect(offenders).toEqual([]);
  });
});
