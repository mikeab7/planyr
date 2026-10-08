/* NEW-1 (B2217648) — a map-captured aerial snapshot is DATA on a located plan, not an Overlays row.
 * Owner, 2026-10-08: "I don't need it if we're using the map. Now, if it's to print, okay, sure, but
 * like we don't need to show that." Hide, don't delete: the record stays (print fallback, calibration). */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { visibleReferenceRows, isHiddenMapSnapshot } from "../src/workspaces/site-planner/lib/overlayOrder.js";
import { offerable } from "../src/workspaces/site-planner/lib/siblingOverlays.js";

const snap = { id: "legacy-aerial", name: "Aerial backdrop", fromMap: true };
const real = { id: "ov1", name: "Site plan.pdf", storageKey: "u/ov1.pdf" };
const shot = { id: "ov2", name: "screenshot.png" }; // hand-dropped image: NOT fromMap
const origin = { lat: 29.7, lon: -95.4 };

describe("visibleReferenceRows", () => {
  it("hides the map snapshot on a located plan — the empty state", () => {
    expect(visibleReferenceRows([snap], origin)).toEqual([]);
  });
  it("keeps every record the user added, in order", () => {
    expect(visibleReferenceRows([snap, real, shot], origin)).toEqual([real, shot]);
  });
  it("a hand-dropped screenshot (not fromMap) is a real overlay and stays", () => {
    expect(isHiddenMapSnapshot(shot, origin)).toBe(false);
    expect(visibleReferenceRows([shot], origin)).toEqual([shot]);
  });
  it("a fromMap record on a plan with NO origin stays visible (never orphaned)", () => {
    expect(visibleReferenceRows([snap], null)).toEqual([snap]);
  });
  it("does not mutate or drop data — the input still holds the snapshot", () => {
    const list = [snap, real];
    visibleReferenceRows(list, origin);
    expect(list).toEqual([snap, real]);
  });
  it("tolerates junk input", () => {
    expect(visibleReferenceRows(undefined, origin)).toEqual([]);
  });
});

describe("sibling offers and wiring", () => {
  it("the map snapshot is never offered to a sibling plan", () => {
    expect(offerable({ ...snap, storageKey: "x" }).ok).toBe(false);
  });
  it("the panel and the View menu read the filtered list; the record is kept for print/calibration", () => {
    const sp = fs.readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");
    expect(sp).toMatch(/const refRows = visibleReferenceRows\(sheetOverlays, origin\)/);
    expect(sp).toMatch(/overlays=\{\[\.\.\.refRows, \.\.\.foreignOverlays\.rows/); // the redesigned OverlaysPanel (B2158080) is handed the filtered list
    expect(sp).toMatch(/overlays=\{refRows\}/);
    expect(sp).toMatch(/const mapRef = sheetOverlays\.find\(isPinnedMapReference\)/); // untouched
  });
});
