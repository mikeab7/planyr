// B882 — labeling contract for the estimated-WSE providers. Every estimate source is
// recognized as an ESTIMATE (screening) and maps to a provider label + a caveat note that
// keeps it clearly NOT a regulatory/published BFE.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isEstimatedWseSrc, estWseNote, WSE_PROVIDER_LABEL, wseProvLabel, EST_WSE_SRCS,
  EST_EBFE_NOTE, EST_MAAPNEXT_NOTE, EST_BOUNDARY_WSE_NOTE, DERIVED_WSE100_DRAFT_NOTE,
} from "../src/workspaces/site-planner/lib/floodplainMitigation.js";

describe("isEstimatedWseSrc", () => {
  it("recognizes every accepted-estimate provider tag", () => {
    for (const src of ["est-boundary-grade", "est-ebfe", "est-fbcdd", "est-maapnext"]) {
      expect(isEstimatedWseSrc(src), src).toBe(true);
    }
    expect(EST_WSE_SRCS.size).toBe(4);
  });
  it("does NOT treat published/derived/manual as an estimate", () => {
    for (const src of ["static-bfe", "manual", "fbcdd-wse100-draft", "ebfe-wse02", null, undefined]) {
      expect(isEstimatedWseSrc(src), String(src)).toBe(false);
    }
  });
});

describe("estWseNote — the caveat matches the source and keeps the screening/regulatory boundary", () => {
  it("maps each estimate source to its note", () => {
    expect(estWseNote("est-ebfe")).toBe(EST_EBFE_NOTE);
    expect(estWseNote("est-maapnext")).toBe(EST_MAAPNEXT_NOTE);
    expect(estWseNote("est-fbcdd")).toBe(DERIVED_WSE100_DRAFT_NOTE);
    expect(estWseNote("est-boundary-grade")).toBe(EST_BOUNDARY_WSE_NOTE);
    expect(estWseNote("anything-else")).toBe(EST_BOUNDARY_WSE_NOTE); // safe default
  });
  it("the EBFE + MAAPnext notes state it is an ESTIMATE, not a regulatory/published BFE", () => {
    expect(EST_EBFE_NOTE).toMatch(/screening/i);
    expect(EST_EBFE_NOTE).toMatch(/not a regulatory or published/i);
    expect(EST_EBFE_NOTE).toMatch(/InFRM|Base Level Engineering/i);
    expect(EST_MAAPNEXT_NOTE).toMatch(/MAAPnext/);
    expect(EST_MAAPNEXT_NOTE).toMatch(/not a regulatory or published/i);
  });
});

describe("WSE_PROVIDER_LABEL", () => {
  it("names every new provider clearly (winning source is user-visible)", () => {
    expect(WSE_PROVIDER_LABEL["est-ebfe"]).toMatch(/InFRM|Base Level/i);
    expect(WSE_PROVIDER_LABEL["est-maapnext"]).toMatch(/MAAPnext/);
    expect(WSE_PROVIDER_LABEL["est-fbcdd"]).toMatch(/FBCDD/);
    expect(WSE_PROVIDER_LABEL["maapnext-wse02"]).toMatch(/MAAPnext/);
    expect(wseProvLabel("est-ebfe")).toBe(WSE_PROVIDER_LABEL["est-ebfe"]);
  });
  // B895 follow-up — every EST_WSE_SRCS label ALREADY reads "ESTIMATED (...)"; a caller that
  // wraps it in its own "is ESTIMATED (${wseProvLabel(src)})" doubles the word (the live
  // Tsakiris bug: "1% WSE is ESTIMATED (ESTIMATED (grade @ Zone A boundary)) — screening
  // only."). Documented here so a new caller reads `wseProvLabel`'s result directly instead
  // of re-wrapping it.
  it("every accepted-estimate label already reads ESTIMATED (...) — never re-wrap it", () => {
    for (const src of EST_WSE_SRCS) {
      expect(WSE_PROVIDER_LABEL[src], src).toMatch(/^ESTIMATED \(/);
    }
  });
});

describe("B895 — no caller re-wraps an already-ESTIMATED wseProvLabel result (the doubled-word bug)", () => {
  const sitePlannerSrc = readFileSync(
    fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)),
    "utf8",
  );
  it('no "ESTIMATED (${wseProvLabel(...)})" composition survives in SitePlanner.jsx', () => {
    expect(sitePlannerSrc).not.toMatch(/ESTIMATED \(\$\{wseProvLabel\(/);
  });
  it('no "screening estimate (${wseProvLabel(...)})" composition survives either (the 0.2% WSE variant)', () => {
    expect(sitePlannerSrc).not.toMatch(/screening estimate \(\$\{wseProvLabel\(/);
  });
});
