/* B2233521 — the KEPT planner (the plan you just left stays mounted, hidden, so switching back is a show, not a rebuild).
 *
 * The browser half — real edits on two plans, every write recorded, a reload and a sign-out with a plan hidden — is the ui-audit harness
 * verify-plan-keepalive-writes (red on the pre-change build for the sign-out leak, and on each of the three mutants named below). This is
 * the CI-runnable half: the pure rules, and source guards on the five things that make a hidden planner safe. Each guard names the
 * failure the harness measured when that piece was removed. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { nextPlannerSlots, slotKey, slotSiteId, PLANNER_KEEP } from "../src/workspaces/site-planner/lib/plannerKeepAlive.js";
import { sameSaveRecord, writeIsRedundant, mayWriteForAccount, SAVE_RECORD_KEYS } from "../src/workspaces/site-planner/lib/saveDedupe.js";
import { nextCanvasSize } from "../src/workspaces/site-planner/lib/canvasBox.js";
import { flattenTilePositions } from "../src/workspaces/site-planner/lib/tileLifecycle.js";

const src = (p) => readFileSync(new URL(`../src/workspaces/site-planner/${p}`, import.meta.url), "utf8");

describe("nextPlannerSlots — the plan on screen plus the one you came from", () => {
  const live = new Set(["a", "b", "c"]);
  it("keeps the previous plan behind the new one, most recent first, at most PLANNER_KEEP", () => {
    let s = nextPlannerSlots([], { current: slotKey("a", 0), live });
    expect(s).toEqual(["a:0"]);
    s = nextPlannerSlots(s, { current: slotKey("b", 0), live });
    expect(s).toEqual(["b:0", "a:0"]);
    s = nextPlannerSlots(s, { current: slotKey("c", 0), live });
    expect(s).toEqual(["c:0", "b:0"]);
    expect(s.length).toBe(PLANNER_KEEP);
  });
  it("is identity-stable when nothing changed (it is derived during render)", () => {
    const s = ["b:0", "a:0"];
    expect(nextPlannerSlots(s, { current: "b:0", live })).toBe(s);
  });
  it("switching back reorders rather than rebuilding", () => {
    expect(nextPlannerSlots(["b:0", "a:0"], { current: "a:0", live })).toEqual(["a:0", "b:0"]);
  });
  it("drops every kept planner from a previous epoch (a cloud pull replaced the store it snapshotted)", () => {
    expect(nextPlannerSlots(["b:0", "a:0"], { current: "b:1", live })).toEqual(["b:1"]);
  });
  it("drops a kept planner whose plan is gone (deleted / dropped) — but never the one on screen", () => {
    expect(nextPlannerSlots(["b:0", "a:0"], { current: "b:0", live: new Set(["b"]) })).toEqual(["b:0"]);
    expect(nextPlannerSlots(["a:0"], { current: "new:0", live })).toEqual(["new:0", "a:0"]);   // not listed yet, still shown
  });
  it("no plan open → nothing kept", () => {
    expect(nextPlannerSlots(["b:0", "a:0"], { current: null, live })).toEqual([]);
    const empty = []; expect(nextPlannerSlots(empty, { current: null })).toBe(empty);
  });
  it("slotSiteId undoes slotKey, including ids holding a colon", () => {
    expect(slotSiteId(slotKey("smun6o2o628f", 3))).toBe("smun6o2o628f");
    expect(slotSiteId("x:y:2")).toBe("x:y");
  });
});

describe("saveDedupe — a flush of exactly the last write is skipped, and only then", () => {
  const rec = { id: "a", site: "S", name: "P", groupId: "g", county: "harris", origin: { lat: 1, lon: 2 }, parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, sheetOverlays: [], deletedIds: [], layerOverrides: {}, layerAbove: {} };
  it("same values (collections by identity) → same record", () => {
    expect(sameSaveRecord(rec, { ...rec })).toBe(true);
  });
  it("any one field different → a real write", () => {
    for (const k of SAVE_RECORD_KEYS) expect(sameSaveRecord(rec, { ...rec, [k]: k === "name" || k === "site" || k === "id" ? "other" : Array.isArray(rec[k]) ? [] : {} })).toBe(false);
  });
  it("redundant only while the store still holds that write", () => {
    const last = { rec, stamp: "s1" };
    expect(writeIsRedundant(last, { ...rec }, (s) => s === "s1")).toBe(true);
    expect(writeIsRedundant(last, { ...rec }, () => false)).toBe(false);          // another writer touched the store
    expect(writeIsRedundant(null, rec, () => true)).toBe(false);
  });
});

describe("mayWriteForAccount — a plan opened under an account is never written into another store", () => {
  it("same account → write; signed out / another account → refuse", () => {
    expect(mayWriteForAccount("u1", "u1")).toBe(true);
    expect(mayWriteForAccount("u1", null)).toBe(false);     // the measured leak: sign-out, then persist-on-leave
    expect(mayWriteForAccount("u1", "u2")).toBe(false);
  });
  it("a planner opened with NO account (signed out, or before sign-in resolves at boot) is not gated", () => {
    expect(mayWriteForAccount(null, null)).toBe(true);
    expect(mayWriteForAccount(null, "u1")).toBe(true);
  });
});

describe("nextCanvasSize — a box with no area is not a size", () => {
  it("keeps the last real size while hidden (display:none or detached reads 0 × 0)", () => {
    const prev = { w: 1500, h: 619, rawW: 1500, rawH: 619 };
    expect(nextCanvasSize(prev, { width: 0, height: 0 })).toBe(prev);
  });
  it("a real pane, however narrow, still passes", () => {
    const prev = { w: 1500, h: 619, rawW: 1500, rawH: 619 };
    expect(nextCanvasSize(prev, { width: 152, height: 619 }).rawW).toBe(152);
  });
});

describe("source guards — the five things that make a hidden planner safe", () => {
  const app = src("SitePlannerApp.jsx"), sp = src("SitePlanner.jsx"), slot = src("components/PlannerSlot.jsx");
  it("kept planners are frozen against app re-renders (mutant M2: a hidden plan wrote the other plan's layers WHILE hidden)", () => {
    expect(app).toMatch(/const KeptPlanner = memo\(SitePlanner, \(a, b\) => a\.kept && b\.kept && a\.siteId === b\.siteId\)/);
    expect(app).toMatch(/<KeptPlanner\s+kept=\{!cur\}/);
  });
  it("a shown kept planner re-applies its OWN layer set before tracking resumes (mutant M1: B's layers saved into A)", () => {
    const restore = sp.indexOf("const layerRestoreArmed = useRef(false);");
    const track = sp.indexOf("const proj = overridesFromOverlays(overlays);");
    expect(restore).toBeGreaterThan(0); expect(track).toBeGreaterThan(restore);
    expect(sp).toMatch(/if \(!another\) return;\s*\n\s*layerApplied\.current = false;\s*\n\s*if \(setOverlays\) setOverlays\(overlaysWithOverrides\(layerOverrides, layerAbove\)\);/);
  });
  it("saves are gated on the account the plan was opened under (mutant M3 / main: the sign-out leak)", () => {
    expect(sp).toMatch(/const saveLive = \(rec\) => \{\s*\n\s*if \(!mayWriteForAccount\(openedUidRef\.current, activeUid\(\)\)\)/);
    expect(sp).toMatch(/const writeMirror = \(\) => \{\s*\n\s*if \(!mayWriteForAccount\(openedUidRef\.current, activeUid\(\)\)\)/);
    for (const flush of ["const flushSite = () =>", "const flush = () => { if (deletedSelfRef.current) return;"]) {
      const at = sp.indexOf(flush); expect(at).toBeGreaterThan(0);
      expect(sp.slice(at, at + 260)).toMatch(/saveLive\(/);
    }
  });
  it("a kept planner owns no window hook, no body-portaled panel, no Alt picker", () => {
    const hooks = ["__plannerViewChanges", "__plannerView", "__plannerLayers", "__plannerHitTarget", "__plannerForeign", "__plannerParcelOutlines", "__plannerRoadNet", "__plannerExportSvg"];
    for (const h of hooks) {
      const at = sp.indexOf(`window.${h} = hook`); expect(at, h).toBeGreaterThan(0);
      const effect = sp.lastIndexOf("useEffect(() => {", at);                     // the effect that publishes this hook
      expect(sp.slice(effect, at), h).toMatch(/if \(!active\) return undefined;/);
    }
    expect(sp).toMatch(/\{active && !narrow && Object\.keys\(floating\)\.map/);
    expect(sp).toMatch(/\{active && altPick && createPortal\(/);
    expect(sp).toMatch(/accountActive=\{accountActive && active\}/);
  });
  it("the slot attaches its box in the host's CALLBACK REF (before the planner's own layout effects measure it)", () => {
    expect(slot).toMatch(/const hostRef = useCallback\(\(host\) =>/);
    expect(slot).toMatch(/<div ref=\{hostRef\}[\s\S]*\{createPortal\(children, box\)\}/);
    expect(slot).not.toMatch(/useLayoutEffect\(/);
  });
});

describe("flattenTilePositions — tiles positioned flat, one compositor layer for the grid", () => {
  const fakeLayer = () => {
    const tiles = {};
    return {
      _tiles: tiles,
      _tileCoordsToKey: (c) => `${c.x}:${c.y}:${c.z}`,
      _addTile(c) { const el = { style: { transform: `translate3d(${c.x * 256}px, ${c.y * 256}px, 0px)` }, _leaflet_pos: { x: c.x * 256, y: c.y * 256 } }; tiles[this._tileCoordsToKey(c)] = { el }; return "added"; },
    };
  };
  it("re-expresses Leaflet's own position as left/top, leaving _leaflet_pos alone", () => {
    const l = flattenTilePositions(fakeLayer());
    expect(l._addTile({ x: 2, y: 3, z: 17 })).toBe("added");
    const el = l._tiles["2:3:17"].el;
    expect(el.style.transform).toBe(""); expect(el.style.left).toBe("512px"); expect(el.style.top).toBe("768px");
    expect(el._leaflet_pos).toEqual({ x: 512, y: 768 });
  });
  it("wraps once, and leaves a layer without the private hooks untouched", () => {
    const l = fakeLayer(); const first = flattenTilePositions(l)._addTile; expect(flattenTilePositions(l)._addTile).toBe(first);
    const bare = {}; expect(flattenTilePositions(bare)).toBe(bare); expect(bare.__pfFlat).toBeUndefined();
  });
  it("is wired to BOTH planner basemap layers", () => {
    const sp = src("SitePlanner.jsx");
    expect(sp).toMatch(/flattenTilePositions\(bf\)/); expect(sp).toMatch(/flattenTilePositions\(t\)/);
  });
});
