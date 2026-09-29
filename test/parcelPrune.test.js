import { describe, it, expect } from "vitest";
import { pruneToLiveCells } from "../src/workspaces/site-planner/lib/parcelPrune.js";

/* B1976336 — esri-leaflet 3.0.19 never releases a fetched feature (cellLeave's `!_activeCells[key]`
 * test can never pass because _removeCell sets it first). pruneToLiveCells is the explicit release. */
function fakeLayer({ cells, cache, ids }) {
  const removed = [];
  const layers = {}; ids.forEach((id) => { layers[id] = { feature: { id } }; });
  const activeCells = {}; Object.keys(cells).forEach((k) => { activeCells[k] = {}; });
  activeCells["9:9:9"] = {}; // a cell that already left
  return {
    _cells: cells, _cache: cache, _layers: layers, _activeCells: activeCells, _currentSnapshot: [...ids],
    removeLayers(list, permanent) { list.forEach((id) => { removed.push([String(id), !!permanent]); if (permanent) delete layers[id]; }); },
    removed,
  };
}

describe("pruneToLiveCells", () => {
  it("drops features only stale cells hold, keeps every current cell's features", () => {
    const l = fakeLayer({
      cells: { "1:1:14": {}, "2:1:14": {} },                       // current cells (x:y:z)
      cache: { "14:1:1": [1, 2], "14:2:1": [2, 3], "15:5:5": [4, 5] }, // (z:x:y) — the last is stale
      ids: [1, 2, 3, 4, 5],
    });
    expect(pruneToLiveCells(l)).toBe(2);
    expect(l.removed.map((r) => r[0]).sort()).toEqual(["4", "5"]);
    expect(l.removed.every((r) => r[1] === true)).toBe(true); // permanent — not just off the map
    expect(Object.keys(l._layers).sort()).toEqual(["1", "2", "3"]);
  });

  it("a feature shared by a stale and a current cell is kept", () => {
    const l = fakeLayer({ cells: { "1:1:14": {} }, cache: { "14:1:1": [7], "15:0:0": [7, 8] }, ids: [7, 8] });
    pruneToLiveCells(l);
    expect(Object.keys(l._layers)).toEqual(["7"]);
  });

  it("forgets stale cells so returning to them re-requests instead of re-adding nothing", () => {
    const l = fakeLayer({ cells: { "1:1:14": {} }, cache: { "14:1:1": [1], "15:5:5": [2] }, ids: [1, 2] });
    pruneToLiveCells(l);
    expect(Object.keys(l._cache)).toEqual(["14:1:1"]);
    expect(Object.keys(l._activeCells)).toEqual(["1:1:14"]);
    expect(l._currentSnapshot).toEqual([1]);
  });

  it("is a no-op (never throws) when the library internals are missing", () => {
    expect(pruneToLiveCells({})).toBe(0);
    expect(pruneToLiveCells({ _cells: {}, _cache: {}, _layers: {} })).toBe(0);
  });

  it("bounded: a long pan/zoom history collapses to the current view's features", () => {
    const ids = Array.from({ length: 5000 }, (_, i) => i);
    const cache = { "14:1:1": ids.slice(0, 100) };
    for (let z = 10; z < 14; z++) cache[`${z}:0:0`] = ids.slice(100 + (z - 10) * 1000, 100 + (z - 9) * 1000);
    const l = fakeLayer({ cells: { "1:1:14": {} }, cache, ids });
    pruneToLiveCells(l);
    expect(Object.keys(l._layers).length).toBe(100);
  });
});
