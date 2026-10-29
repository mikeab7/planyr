import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as crop from "../src/shared/overlay/overlayCrop.js";
import * as placement from "../src/shared/overlay/overlayPlacement.js";
import { snapshotOverlayEngine } from "./helpers/overlayEngineSnapshot.js";

/* NEW-1 (one overlay engine) — the merged engine answers EXACTLY as the three modules it replaced
 * (overlayCrop in site-planner/lib, overlayGeoref in shared/sitePlans/lib, overlayAlign in
 * site-planner/lib). The fixture holds 1,085 recorded outputs captured from the PRE-refactor code:
 * crop clamp/normalise/clip for rect, legacy no-`kind` rect, poly and malformed shapes; placement
 * corners / image↔lat-lon round trips across Texas + Colorado + out-of-zone anchors; scale / rotate /
 * align on both a plain and a Y-scaled sheet; the Procrustes fits. */
const golden = JSON.parse(readFileSync(new URL("./fixtures/overlay-engine/golden-pre-refactor.json", import.meta.url), "utf8"));
const now = snapshotOverlayEngine({ ...crop, ...placement });

describe("overlay engine — golden snapshot from before the one-engine refactor", () => {
  it("every pre-refactor export is still exported (export surface kept)", () => {
    for (const name of golden.__exports) expect(now.__exports, name).toContain(name);
  });
  it("probed enough to mean something", () => { expect(Object.keys(golden).length).toBeGreaterThan(1000); });
  it("every recorded output is unchanged — bit-for-bit", () => {
    const bad = [];
    for (const k of Object.keys(golden)) {
      if (k === "__exports" || k === "__rerecorded" || k.startsWith("i2w.")) continue;
      if (JSON.stringify(now[k]) !== JSON.stringify(golden[k])) bad.push(k);
    }
    expect(bad).toEqual([]);
  });
  /* NEW-1 (STATE-PLANE-AUDIT): the two OUT-OF-ZONE anchors in this fixture (Dallas, New York) had recorded the old silent fallback to
   * the Texas South Central grid, i.e. the bug. They are re-recorded onto their own zones; Houston (0, 1) and Denver (3) are NOT touched
   * and the loop above holds them bit-for-bit, which is what proves Texas South Central and Colorado did not move. */
  it("only the Dallas (anchor 2) and New York (anchor 4) records were re-recorded — never Houston or Denver", () => {
    const keys = golden.__rerecorded.keys.filter((k) => k !== "feetBetween");
    expect(keys.length).toBeGreaterThan(40);
    for (const k of keys) expect(k, k).toMatch(/\.(2|4)(\.|$)/);
    expect(golden.__rerecorded.keys).toContain("feetBetween");     // only its Dallas element moved (checked when re-recording)
    expect(now.feetBetween[0]).toBe(golden.feetBetween[0]);          // Houston
    expect(now.feetBetween[2]).toBe(golden.feetBetween[2]);          // Denver
  });
  it("imagePointToWorld (canvas rotate) agrees to well under a micro-foot", () => {
    // The old copy inlined `C + c·dx − s·dy`; the single shared rotate helper adds in a different
    // order, so the last 1–2 digits of a rotated sheet's world point can differ (~1e-14 ft).
    const keys = Object.keys(golden).filter((k) => k.startsWith("i2w."));
    expect(keys.length).toBeGreaterThan(10);
    for (const k of keys) {
      expect(Math.abs(now[k].x - golden[k].x), k).toBeLessThan(1e-9);
      expect(Math.abs(now[k].y - golden[k].y), k).toBeLessThan(1e-9);
    }
  });
  it("an unrotated sheet is exactly bit-identical (no rounding path at all)", () => {
    for (const k of ["i2w.0.0", "i2w.0.1", "i2w.0.2", "i2w.0.3", "i2w.0.4"]) expect(now[k]).toEqual(golden[k]);
  });
});
