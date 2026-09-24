/* The decide bar's own dismiss rule (NEW-1, 2026-09-24) — a WIRING test, not a pure-module one,
 * because the defect it guards was never in a pure function: `clearSel()` correctly empties the
 * selection, but a verb that finishes WITHOUT leaving the map (Log a comp, Add a note) also needs
 * `selectMode` turned off, or the toolbar falls back to "Selecting…" (nothing selected, still in
 * select-parcels mode) instead of its normal AT-REST row. "Plan this site" never needed this
 * because planning a site flips `mode` away from the map, and the return-to-map effect resets
 * `selectMode` on the way out.
 *
 * Reported live: "selecting parcels → Record info → Add a note → placing the note" left the
 * "Selecting… Drop a pin Cancel" bar on screen instead of dismissing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const finder = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");

describe("finishGroundAction — the ONE way a decide-bar verb returns the map to AT-REST", () => {
  it("exists, and does both halves: clears the selection AND exits select mode", () => {
    const def = finder.slice(finder.indexOf("const finishGroundAction ="), finder.indexOf("const finishGroundAction =") + 200);
    expect(def).toMatch(/clearSel\(\)/);
    expect(def).toMatch(/setSelectMode\(false\)/);
  });

  it("is defined AFTER clearSel and BEFORE any decide-bar verb calls it", () => {
    const clearSelAt = finder.indexOf("const clearSel = ()");
    const helperAt = finder.indexOf("const finishGroundAction =");
    const verbsAt = finder.indexOf("const DECIDE_VERBS = [");
    expect(clearSelAt).toBeGreaterThan(0);
    expect(helperAt).toBeGreaterThan(clearSelAt);
    expect(verbsAt).toBeGreaterThan(helperAt);
  });

  it("the \"note\" verb's parcel-target branch calls it, not a bare clearSel()", () => {
    const noteRun = finder.slice(finder.indexOf('key: "note"'), finder.indexOf('key: "note"') + 1400);
    const parcelBranch = noteRun.slice(noteRun.indexOf('if (target === "parcels")'), noteRun.indexOf("const pin = droppedPin"));
    expect(parcelBranch, "must call the shared helper").toMatch(/finishGroundAction\(\)/);
    expect(parcelBranch, "must not have regressed to a bare clearSel()").not.toMatch(/\bclearSel\(\);/);
  });

  it("placeCompOnSelectedParcel (\"Log a comp\" from a parcel selection) calls it too — the same defect, the same fix", () => {
    const body = finder.slice(finder.indexOf("const placeCompOnSelectedParcel = ()"), finder.indexOf("const placeCompOnSelectedParcel = ()") + 700);
    expect(body).toMatch(/finishGroundAction\(\)/);
  });

  it("the decide bar's own ✕ 'Clear selection' button keeps calling clearSel() directly — clearing to reselect must NOT exit select mode", () => {
    const clearBtn = finder.slice(finder.indexOf('data-testid="map-decide-clear"') - 300, finder.indexOf('data-testid="map-decide-clear"'));
    expect(clearBtn).toMatch(/if \(decideTarget === "parcels"\) clearSel\(\); else clearDecidePin\(\);/);
  });
});
