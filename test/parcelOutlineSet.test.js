/* B2024624 — the Site planner's click-a-lot outline set: ONE source per area, no statewide
 * flash. Red on main: the effect mounted every COUNTIES_MAP source (36+ at Grand Port). */
import { describe, it, expect } from "vitest";
import { createOutlineSet } from "../src/workspaces/site-planner/lib/parcelOutlineSet.js";
import { displaySourcesForView, statewideKeysForState, COUNTIES_MAP, isStatewideLayerUrl } from "../src/workspaces/site-planner/lib/counties.js";

const GRAND_PORT = { south: 29.84, north: 29.87, west: -94.90, east: -94.86 };

function harness({ sources, urls, bounds = GRAND_PORT }) {
  const mountedLayers = [];
  const timers = [];
  const emitter = () => { const h = {}; return { on: (e, f) => { (h[e] ||= []).push(f); }, emit: (e) => (h[e] || []).forEach((f) => f()), h }; };
  const map = {
    getBounds: () => ({ getSouth: () => bounds.south, getNorth: () => bounds.north, getWest: () => bounds.west, getEast: () => bounds.east }),
    removeLayer: (l) => { l.mounted = false; },
  };
  const set = createOutlineSet({
    getMap: () => map,
    boundsOf: (m) => { const b = m.getBounds(); return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }; },
    resolveUrl: async (k) => urls[k],
    makeLayer: (url) => { const e = emitter(); const l = { url, mounted: false, ...e, addTo() { l.mounted = true; return l; } }; mountedLayers.push(l); return l; },
    sourcesForView: sources || displaySourcesForView,
    statewideKeysForState,
    stateOf: (k) => COUNTIES_MAP[k] && COUNTIES_MAP[k].state,
    isStatewideUrl: isStatewideLayerUrl,
    setTimer: (f, ms) => { const t = { f, ms }; timers.push(t); return t; },
    clearTimer: (t) => { t.dead = true; },
  });
  return { set, mountedLayers, timers };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const live = (h) => h.mountedLayers.filter((l) => l.mounted).map((l) => l.url);

describe("click-a-lot outline set", () => {
  it("(a) mounts only the sources whose area intersects the view — never the whole country", async () => {
    const urls = Object.fromEntries(Object.keys(COUNTIES_MAP).map((k) => [k, `https://x/${k}/MapServer/0`]));
    const h = harness({ urls });
    h.set.sync(); await flush(); await flush();
    const inView = new Set(displaySourcesForView(GRAND_PORT));
    expect(h.set.mounted().length).toBeGreaterThan(0);
    expect(h.set.mounted().every((k) => inView.has(k))).toBe(true);
    expect(h.set.mounted().length).toBeLessThan(10);
    expect(Object.keys(COUNTIES_MAP).length).toBeGreaterThan(36);
  });

  it("(b) with the county export pending, no statewide layer is ever mounted over it", async () => {
    const h = harness({ sources: () => ["chambers"], urls: { chambers: "https://c/MapServer/0", txgio_statewide: "https://stat/MapServer/0" } });
    h.set.sync(); await flush();
    expect(live(h)).toEqual(["https://c/MapServer/0"]);
    h.mountedLayers[0].emit("requeststart"); // the county image is reloading (pending) …
    h.set.sync(); await flush(); // … a pan re-syncs
    expect(live(h)).toEqual(["https://c/MapServer/0"]);
    expect(h.set.mounted()).toEqual(["chambers"]);
  });

  it("a county that FAILS is swapped for its statewide composite, once", async () => {
    const h = harness({ sources: () => ["chambers"], urls: { chambers: "https://c/MapServer/0", txgio_statewide: "https://stat/MapServer/0" } });
    h.set.sync(); await flush();
    h.mountedLayers[0].emit("requesterror"); await flush(); await flush();
    expect(live(h)).toEqual(["https://stat/MapServer/0"]);
    h.set.sync(); await flush();
    expect(h.mountedLayers.filter((l) => l.url.includes("stat")).length).toBe(1);
  });

  it("a county that never draws inside the timeout is swapped; one that draws is kept", async () => {
    const h = harness({ sources: () => ["chambers"], urls: { chambers: "https://c/MapServer/0", txgio_statewide: "https://stat/MapServer/0" } });
    h.set.sync(); await flush();
    const l = h.mountedLayers[0];
    l.emit("requeststart"); l.emit("load");
    expect(h.timers.every((t) => t.dead)).toBe(true);
    h.set.dispose();
    expect(live(h)).toEqual([]);
  });
});

describe("SitePlanner wiring (structural — fails on the pre-fix fan-out)", () => {
  it("the identify effect goes through the outline set, never a per-COUNTIES_MAP mount loop", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/createOutlineSet\(\{/);
    expect(src).not.toMatch(/Object\.keys\(COUNTIES_MAP\)\.forEach\(\(key\) => \{\s*resolveOneCountyLayer/);
    expect(src).not.toMatch(/makeParcelDisplayLayer\(url\); fl\.addTo/);
  });
  it("(B2024625) the cross-tab fold adopts per collection, never rewriting an unchanged one", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/adopt\("els", setEls\)/);
  });
});

/* NEW-1 (select-parcel first paint) — status(): what the lit-up outlines are doing, in one word. Red on main: no status() existed, so a
 * view below the layers' draw floor (a phone's view of a big site) drew nothing AND said nothing. */
describe("outline set status()", () => {
  function statusHarness({ zoom, floor = 16, lots = 0 }) {
    const urls = { chambers: "https://x/chambers/MapServer/0" };
    const h = harness({ urls, sources: () => ["chambers"] });
    const changes = [];
    let now = 1000;
    const map = { getZoom: () => zoom, getBounds: () => ({ getSouth: () => 29.84, getNorth: () => 29.87, getWest: () => -94.9, getEast: () => -94.86 }), removeLayer() {} };
    const mounted = [];
    const set = createOutlineSet({
      getMap: () => map,
      boundsOf: () => GRAND_PORT,
      resolveUrl: async (k) => urls[k],
      makeLayer: (url) => { const hs = {}; const l = { url, options: { minZoom: floor }, _layers: Object.fromEntries(Array.from({ length: lots }, (_, i) => [i, {}])), on: (e, f) => { (hs[e] ||= []).push(f); }, emit: (e) => (hs[e] || []).forEach((f) => f()), addTo() { return l; } }; mounted.push(l); return l; },
      sourcesForView: () => ["chambers"], statewideKeysForState, stateOf: () => "TX", isStatewideUrl: isStatewideLayerUrl,
      setTimer: () => 0, clearTimer: () => {}, onChange: () => changes.push(1), now: () => now,
    });
    return { set, mounted, changes, tick: (ms) => { now += ms; } };
  }
  it("below every layer's draw floor → zoom (and names the floor)", async () => {
    const h = statusHarness({ zoom: 14 });
    h.set.sync(); await flush(); await flush();
    expect(h.set.status()).toMatchObject({ phase: "zoom", lots: 0, floor: 16 });
  });
  it("in range, first request out → loading; loaded with lots → drawn", async () => {
    const h = statusHarness({ zoom: 17, lots: 0 });
    h.set.sync(); await flush(); await flush();
    expect(h.set.status().phase).toBe("loading");
    h.mounted[0]._layers = { a: {}, b: {}, c: {}, d: {} };
    h.mounted[0].emit("load");
    expect(h.set.status()).toMatchObject({ phase: "drawn", lots: 4 });
  });
  it("in range, loaded, zero lots → empty only after the settle beat", async () => {
    const h = statusHarness({ zoom: 17, lots: 0 });
    h.set.sync(); await flush(); await flush();
    h.mounted[0].emit("load");
    expect(h.set.status().phase).toBe("loading");
    h.tick(500);
    expect(h.set.status().phase).toBe("empty");
  });
  it("tells its listener when a layer finishes (no pointer needed)", async () => {
    const h = statusHarness({ zoom: 17, lots: 1 });
    h.set.sync(); await flush(); await flush();
    const before = h.changes.length;
    h.mounted[0].emit("load");
    expect(h.changes.length).toBeGreaterThan(before);
  });
});
