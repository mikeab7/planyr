/* B719778 — STALE settings.aerialHidden AFTER DELETING THE AERIAL.
 *
 * `aerialVisibility.js`'s pure functions (test/aerialVisibility.test.js) were correct and round-trip
 * cleanly; the defect was one wrong argument at the References panel's Remove (✕) button in
 * `SitePlanner.jsx`. It called `setShowAerial(false)` — which persists `settings.aerialHidden = true`
 * (withAerialVisible's `want:false` branch, "hide") — on REMOVE, so a plan with no aerial left at all
 * carried a stamped "hide the aerial" preference forever. Confirmed against production: plan
 * `smsz866fuql0` has `underlay: null` (deleted) and `settings.aerialHidden: "true"` (stale).
 *
 * PREDICTED SYMPTOM, now the regression this suite guards: dropping a FRESH aerial onto that plan
 * inherits the stale hidden flag and renders invisible (isAerialVisible/isAerialTileActive both read
 * false), with no on-screen explanation — the fresh aerial simply never appears.
 *
 * The fix: Remove clears the flag (`setShowAerial(true)`, which withAerialVisible's `want:true`
 * branch strips back to the sparse default) instead of setting it, since there is no longer an
 * aerial for the flag to describe.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isAerialVisible, withAerialVisible } from "../src/workspaces/site-planner/lib/aerialVisibility.js";

const src = readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");

describe("the References panel's aerial Remove button clears aerialHidden", () => {
  const removeButtonLine = src.split("\n").find((l) => l.includes('title="Remove"') && l.includes("releaseUnderlayAssets"));

  it("exists (the anchor text didn't move)", () => {
    expect(removeButtonLine).toBeTruthy();
  });
  it("calls setShowAerial(true) — clear, not hide", () => {
    expect(removeButtonLine).toMatch(/setShowAerial\(true\)/);
  });
  it("never calls setShowAerial(false) on removal (that is the exact pre-fix defect)", () => {
    expect(removeButtonLine).not.toMatch(/setShowAerial\(false\)/);
  });
});

describe("REPRODUCTION — the production shape (smsz866fuql0), pure end to end", () => {
  it("[pre-fix] Remove-as-hide leaves the flag stamped true, matching the production record", () => {
    let settings = { name: "ZZ TEST — aerial removed" };
    // Simulates the OLD onClick body: setUnderlay(null); setShowAerial(false);
    settings = withAerialVisible(settings, /* want shown */ false);
    expect(settings.aerialHidden).toBe(true); // == the production row's "true"
    expect(isAerialVisible(settings)).toBe(false);
  });

  it("[fixed] Remove-as-clear returns the plan to the sparse default — a later aerial isn't born hidden", () => {
    let settings = { name: "ZZ TEST — aerial removed", aerialHidden: true }; // some prior hide had already stamped it
    // Simulates the FIXED onClick body: setUnderlay(null); setShowAerial(true);
    settings = withAerialVisible(settings, /* want shown */ true);
    expect("aerialHidden" in settings).toBe(false);
    expect(isAerialVisible(settings)).toBe(true);

    // The predicted symptom, closed: a fresh aerial dropped onto this plan next reads as visible.
    expect(isAerialVisible(settings)).toBe(true);
  });

  it("removing an aerial that was never hidden stays a true no-op (identity-stable, no spurious save)", () => {
    const settings = { name: "plain plan" }; // never touched aerialHidden
    expect(withAerialVisible(settings, true)).toBe(settings);
  });
});
