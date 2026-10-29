import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// layers.js pulls in Leaflet-facing modules that need a DOM — stub them (same pattern as layerPrefs.test.js).
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

/* A faithful JS twin of db/project_layer_opacity.sql's two functions (the SQL itself was exercised
 * against production in a rolled-back transaction): the project row is keyed (owner, group) and derived
 * from the PLAN the caller names; a write is a PATCH merged into the CURRENT row, null = remove. */
const h = vi.hoisted(() => ({ uid: "u1", plans: {}, rows: {}, calls: [], fail: null }));
vi.mock("../src/workspaces/site-planner/lib/activeUser.js", () => ({ activeUid: () => h.uid }));
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: (...a) => { h.events = [...(h.events || []), a[0]]; } }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    rpc: async (name, args) => {
      h.calls.push({ name, args, uid: h.uid });
      if (h.fail) return { data: null, error: h.fail };
      const p = h.plans[args.p_site_id];
      const visible = p && (p.owner === h.uid || (p.team && p.members.includes(h.uid)));
      const key = p && `${p.owner}|${p.group}`;
      if (name === "get_project_layer_opacity") return { data: visible ? { ...(h.rows[key] || {}) } : null, error: null };
      if (!visible) return { data: null, error: { code: "P0002", message: "That plan is not in the cloud yet." } };
      if (!(p.owner === h.uid || !p.locked)) return { data: null, error: { code: "42501", message: "view-only" } };
      const next = { ...(h.rows[key] || {}) };
      for (const [k, v] of Object.entries(args.p_patch)) { if (v === null) delete next[k]; else next[k] = v; }
      h.rows[key] = next;
      return { data: { ...next }, error: null };
    },
  },
}));

import { ALL_LAYERS, defaultOverlayState } from "../src/workspaces/site-planner/lib/layers.js";
import {
  sanitizeLayerOpacity, opacityFromOverlays, applyLayerOpacity, opacityPatch, applyPatch, opacitySig,
} from "../src/workspaces/site-planner/lib/layerOpacity.js";
import { overlaysWithOverrides } from "../src/workspaces/site-planner/lib/layerPrefs.js";
import {
  getProjectLayerOpacity, setProjectLayerOpacity, refreshProjectLayerOpacity, flushAllLayerOpacity, subscribeLayerOpacity, _resetLayerOpacityStore,
} from "../src/workspaces/site-planner/lib/layerOpacityStore.js";

const FEMA = "fema", NWI = "wetlands";
const dflt = (k) => defaultOverlayState()[k].opacity;
const withOp = (o) => { const base = defaultOverlayState(); for (const [k, v] of Object.entries(o)) base[k] = { ...base[k], opacity: v }; return base; };

describe("layerOpacity — the pure rules", () => {
  it("is SPARSE: only layers that differ from their default are kept; default, unknown and garbage are dropped", () => {
    expect(sanitizeLayerOpacity({ [FEMA]: 0.6, [NWI]: dflt(NWI), nope: 0.5, [ "x" ]: "a" })).toEqual({ [FEMA]: 0.6 });
    expect(sanitizeLayerOpacity(null)).toEqual({});
    expect(sanitizeLayerOpacity([0.5])).toEqual({});
    expect(sanitizeLayerOpacity({ [FEMA]: NaN })).toEqual({});
  });
  it("clamps to the slider's range and rounds float noise", () => {
    expect(sanitizeLayerOpacity({ [FEMA]: 5 })[FEMA]).toBe(1);
    expect(sanitizeLayerOpacity({ [FEMA]: 0 })[FEMA]).toBe(0.1);
    expect(sanitizeLayerOpacity({ [FEMA]: 0.6000000000000001 })[FEMA]).toBe(0.6);
  });
  it("round-trips through an overlays object and back (absent = default)", () => {
    const ov = applyLayerOpacity(defaultOverlayState(), { [FEMA]: 0.6 });
    expect(ov[FEMA].opacity).toBe(0.6);
    expect(ov[NWI].opacity).toBe(dflt(NWI));
    expect(opacityFromOverlays(ov)).toEqual({ [FEMA]: 0.6 });
    expect(opacityFromOverlays(defaultOverlayState())).toEqual({});
    // on / above survive
    const on = { ...defaultOverlayState(), [FEMA]: { ...defaultOverlayState()[FEMA], on: true } };
    expect(applyLayerOpacity(on, { [FEMA]: 0.4 })[FEMA].on).toBe(true);
  });
  it("applyLayerOpacity is reference-stable when nothing moves (the overlays identity is load-bearing)", () => {
    const ov = applyLayerOpacity(defaultOverlayState(), { [FEMA]: 0.6 });
    expect(applyLayerOpacity(ov, { [FEMA]: 0.6 })).toBe(ov);
    const defaults = defaultOverlayState();
    expect(applyLayerOpacity(defaults, {})).toBe(defaults);
  });
  it("a layer returned to its default is REMOVED (null in the patch), a removed registry layer self-prunes", () => {
    expect(opacityPatch({ [FEMA]: 0.6 }, {})).toEqual({ [FEMA]: null });
    expect(opacityPatch({}, { [FEMA]: 0.6 })).toEqual({ [FEMA]: 0.6 });
    expect(opacityPatch({ [FEMA]: 0.6 }, { [FEMA]: 0.6 })).toEqual({});
    expect(opacityPatch({ [FEMA]: 0.6 }, { [FEMA]: 0.6 }, { [FEMA]: 0.6, gone_layer: 0.3 })).toEqual({ gone_layer: null });
  });
  it("the patch holds ONLY what changed — it can never carry (and so never revert) a layer it did not touch", () => {
    expect(opacityPatch({ [FEMA]: 0.9, [NWI]: 0.3 }, { [FEMA]: 0.9, [NWI]: 0.5 })).toEqual({ [NWI]: 0.5 });
  });
  it("applyPatch lays a patch over a map; sig is order-independent", () => {
    expect(applyPatch({ [FEMA]: 0.6 }, { [FEMA]: null, [NWI]: 0.3 })).toEqual({ [NWI]: 0.3 });
    expect(opacitySig({ [NWI]: 0.3, [FEMA]: 0.6 })).toBe(opacitySig({ [FEMA]: 0.6, [NWI]: 0.3 }));
  });
  it("overlaysWithOverrides takes the project's opacity as an optional third argument; absent = today", () => {
    expect(overlaysWithOverrides({ [FEMA]: true }, null, { [FEMA]: 0.6 })[FEMA]).toMatchObject({ on: true, opacity: 0.6 });
    expect(overlaysWithOverrides({ [FEMA]: true })[FEMA].opacity).toBe(dflt(FEMA));
    expect(overlaysWithOverrides({ [FEMA]: true }, null, null)[NWI].opacity).toBe(dflt(NWI));
  });
});

describe("layerOpacityStore — the project's single row", () => {
  const store = {};
  beforeEach(() => {
    vi.useFakeTimers();
    for (const k of Object.keys(store)) delete store[k];
    globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
    Object.assign(h, { uid: "u1", rows: {}, calls: [], fail: null, events: [], plans: {
      a1: { owner: "u1", group: "g1" }, a2: { owner: "u1", group: "g1" }, // two plans of ONE project
      b1: { owner: "u1", group: "g2" },                                  // a plan in a DIFFERENT project
      t1: { owner: "boss", group: "gt", team: true, members: ["u1", "u2"], locked: false },
      t2: { owner: "boss", group: "gl", team: true, members: ["u1"], locked: true },
    } });
    _resetLayerOpacityStore();
  });
  afterEach(() => { vi.useRealTimers(); delete globalThis.localStorage; });

  const save = async () => { await vi.advanceTimersByTimeAsync(700); };
  const reopenDevice = () => _resetLayerOpacityStore(); // a reload / another tab: module memory gone, the device mirror stays

  it("set FEMA to 0.6 on plan A → it is on the server, and a reload still reads 0.6 SYNCHRONOUSLY (first paint is right)", async () => {
    setProjectLayerOpacity("g1", "a1", { [FEMA]: 0.6 });
    await save();
    expect(h.rows["u1|g1"]).toEqual({ [FEMA]: 0.6 });
    reopenDevice();
    expect(getProjectLayerOpacity("g1")).toEqual({ [FEMA]: 0.6 });
  });

  it("a sibling plan of the SAME project agrees, even on a device that never saw the change", async () => {
    setProjectLayerOpacity("g1", "a1", { [FEMA]: 0.6 });
    await save();
    for (const k of Object.keys(store)) delete store[k]; // a different device: empty mirror
    reopenDevice();
    expect(getProjectLayerOpacity("g1")).toEqual({});
    await refreshProjectLayerOpacity("g1", "a2");
    expect(getProjectLayerOpacity("g1")).toEqual({ [FEMA]: 0.6 });
  });

  it("a plan in a DIFFERENT project is unaffected (defaults)", async () => {
    setProjectLayerOpacity("g1", "a1", { [FEMA]: 0.6 });
    await save();
    await refreshProjectLayerOpacity("g2", "b1");
    expect(getProjectLayerOpacity("g2")).toEqual({});
    expect(h.rows["u1|g2"]).toBeUndefined();
  });

  it("drag-rate edits coalesce into ONE trailing write", async () => {
    for (const v of [0.5, 0.55, 0.6, 0.65]) setProjectLayerOpacity("g1", "a1", { [FEMA]: v });
    await save();
    expect(h.calls.filter((c) => c.name === "set_project_layer_opacity")).toHaveLength(1);
    expect(h.rows["u1|g1"]).toEqual({ [FEMA]: 0.65 });
  });

  it("returning a layer to its default removes the key (sparse), and the server row is the empty object", async () => {
    setProjectLayerOpacity("g1", "a1", { [FEMA]: 0.6 }); await save();
    setProjectLayerOpacity("g1", "a1", { [FEMA]: dflt(FEMA) }); await save();
    expect(h.rows["u1|g1"]).toEqual({});
    expect(getProjectLayerOpacity("g1")).toEqual({});
  });

  it("STALE DEVICE: a device holding an old copy that touches ONE layer cannot revert another", async () => {
    setProjectLayerOpacity("g1", "a1", { [FEMA]: 0.9 }); await save();      // device A: FEMA 0.9
    reopenDevice();                                                          // device B opens, mirror = {fema:.9}
    expect(getProjectLayerOpacity("g1")).toEqual({ [FEMA]: 0.9 });
    h.rows["u1|g1"] = { [FEMA]: 0.4, [NWI]: 0.3 };                           // meanwhile device A changed things on the server
    setProjectLayerOpacity("g1", "a1", { [FEMA]: 0.9, [NWI]: 0.5 });         // B (still thinking fema is .9) moves ONLY wetlands
    await save();
    expect(h.rows["u1|g1"]).toEqual({ [FEMA]: 0.4, [NWI]: 0.5 });            // fema .4 (A's newer value) survived
    expect(h.calls.at(-1).args.p_patch).toEqual({ [NWI]: 0.5 });             // the wire carried ONLY the touched layer
  });

  it("a refresh adopts what another device set; a pending local edit stays on top of it", async () => {
    h.rows["u1|g1"] = { [FEMA]: 0.4, [NWI]: 0.3 };
    h.fail = { code: "08006", message: "offline" };
    setProjectLayerOpacity("g1", "a1", { [NWI]: 0.7 });
    await save();                                                            // write failed → patch kept
    h.fail = null;
    await refreshProjectLayerOpacity("g1", "a1");                            // flushes the pending patch, adopts the merge
    expect(h.rows["u1|g1"]).toEqual({ [FEMA]: 0.4, [NWI]: 0.7 });
    expect(getProjectLayerOpacity("g1")).toEqual({ [FEMA]: 0.4, [NWI]: 0.7 });
  });

  it("subscribers hear a change from the server so a second surface repaints", async () => {
    const seen = [];
    subscribeLayerOpacity("g1", (m) => seen.push(m));
    h.rows["u1|g1"] = { [FEMA]: 0.4 };
    await refreshProjectLayerOpacity("g1", "a1");
    expect(seen.at(-1)).toEqual({ [FEMA]: 0.4 });
  });

  it("a plan that is not in the cloud yet (P0002) keeps its pending change and delivers it once the plan exists", async () => {
    setProjectLayerOpacity("g9", "new1", { [FEMA]: 0.6 });
    await save();
    expect(getProjectLayerOpacity("g9")).toEqual({ [FEMA]: 0.6 });           // shown locally meanwhile
    expect(h.rows["u1|g9"]).toBeUndefined();
    h.plans.new1 = { owner: "u1", group: "g9" };
    await refreshProjectLayerOpacity("g9", "new1");
    expect(h.rows["u1|g9"]).toEqual({ [FEMA]: 0.6 });
  });

  it("a teammate sees the project's opacity (follows the plan's sharing); on a LOCKED plan the write is refused loudly and not retried", async () => {
    h.rows["boss|gt"] = { [FEMA]: 0.45 };
    await refreshProjectLayerOpacity("gt", "t1");
    expect(getProjectLayerOpacity("gt")).toEqual({ [FEMA]: 0.45 });
    setProjectLayerOpacity("gt", "t1", { [FEMA]: 0.45, [NWI]: 0.2 }); await save();
    expect(h.rows["boss|gt"]).toEqual({ [FEMA]: 0.45, [NWI]: 0.2 });         // an unlocked shared plan is writable by a teammate
    setProjectLayerOpacity("gl", "t2", { [FEMA]: 0.2 }); await save();
    expect(h.rows["boss|gl"]).toBeUndefined();
    expect(h.events).toContain("layer-opacity-view-only");
    const before = h.calls.length; await save(); expect(h.calls.length).toBe(before);
  });

  it("a stranger cannot read or write a project they have no plan in", async () => {
    h.uid = "stranger";
    expect(await refreshProjectLayerOpacity("g1", "a1")).toBeNull();
    setProjectLayerOpacity("g1", "a1", { [FEMA]: 0.1 }); await save();
    expect(h.rows["u1|g1"]).toBeUndefined();
  });

  it("an un-migrated database degrades to this device only, and says so (once)", async () => {
    h.fail = { code: "PGRST202", message: "Could not find the function" };
    setProjectLayerOpacity("g1", "a1", { [FEMA]: 0.6 }); await save();
    expect(getProjectLayerOpacity("g1")).toEqual({ [FEMA]: 0.6 });
    expect(h.events).toContain("layer-opacity-unavailable");
  });

  it("SIGNED OUT: nothing is sent, the value is this device's only, and signing in does not inherit it", async () => {
    h.uid = null;
    setProjectLayerOpacity("g1", "a1", { [FEMA]: 0.6 }); await save();
    expect(h.calls).toHaveLength(0);
    reopenDevice();
    expect(getProjectLayerOpacity("g1")).toEqual({ [FEMA]: 0.6 });
    h.uid = "u1"; reopenDevice();
    expect(getProjectLayerOpacity("g1")).toEqual({});
  });

  it("a removed registry layer's stored key self-prunes on the next write", async () => {
    h.rows["u1|g1"] = { [FEMA]: 0.6, ghost_layer: 0.3 };
    await refreshProjectLayerOpacity("g1", "a1");
    expect(getProjectLayerOpacity("g1")).toEqual({ [FEMA]: 0.6 }); // ignored on read
    setProjectLayerOpacity("g1", "a1", { [FEMA]: 0.5 }); await save();
    expect(h.rows["u1|g1"]).toEqual({ [FEMA]: 0.5 });
  });

  it("flushAllLayerOpacity delivers a pending edit immediately (tab hidden / page leaving)", async () => {
    setProjectLayerOpacity("g1", "a1", { [FEMA]: 0.6 });
    flushAllLayerOpacity();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.rows["u1|g1"]).toEqual({ [FEMA]: 0.6 });
  });

  it("the registry really has the layers these tests lean on", () => {
    expect(ALL_LAYERS[FEMA]).toBeTruthy(); expect(ALL_LAYERS[NWI]).toBeTruthy();
  });
});
