// v3 CRITERIA-TRUTH milestone, PR-R3 — NEW-19: the flood-data header and the WSE-driven
// numbers must read ONE truth. The header keyed "checked" off a LIVE fetch (floodGeo.ts)
// only, so a RESTORED plan — whose remembered facts drive definite pond/berm/mitigation
// numbers — showed "not checked" over them. Now a single floodChecked flag (live fetch OR a
// remembered check) drives the header, and the vintage falls back to the remembered
// checkedAt. Source-scan of the SitePlanner wiring (vitest is DOM-free).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

describe("NEW-19 — one flood-facts truth: header state == the facts the numbers use", () => {
  it("exposes a single floodChecked flag: a live fetch OR a remembered/restored check", () => {
    expect(src).toContain("floodChecked: !!(floodGeo && floodGeo.state === \"loaded\") || Number.isFinite(drainViewCtx?.checkedAt),");
  });
  it("the header vintage falls back to the remembered checkedAt (a restored plan shows 'as of', not 'not checked')", () => {
    expect(src).toContain("floodAgeMs: floodGeo && floodGeo.ts != null ? Date.now() - floodGeo.ts");
    expect(src).toContain("Number.isFinite(drainViewCtx?.checkedAt) ? Date.now() - drainViewCtx.checkedAt : null,");
  });
  it("the header reads 'not checked' ONLY when floodChecked is false (never over definite remembered numbers)", () => {
    expect(src).toContain('!drainage.floodChecked ? "Flood data: not checked" : floodAgeMs != null ? `Flood data ${formatAge(floodAgeMs)} ago` : "Flood data: checked"');
  });
  it("AUDIT — a restored view with no per-pond fact still returns UNKNOWN, never a fabricated definite split", () => {
    // The B804/NEW-9 guard: flood evidence but no persisted pond fact → factsKnown:false, not gross.
    expect(src).toContain('return { mode: "unknown", usableCf: null, deadCf: null, grossCf: usablePondVolume(pring, det, { gradeFt }).grossCf, bands: null, wseFt: null, inTrigger: false, estPoolDepthFt: null, factsKnown: false };');
  });
});
