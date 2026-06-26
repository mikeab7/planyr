import { describe, it, expect, beforeEach, vi } from "vitest";

// B473 — when the on-device store is full, (1) writeSites must shed inline rasters from ALL three homes
// (underlay/sheetOverlays/parcelDrawings) so geometry still persists, and (2) the cloud save must never
// be blocked by a local failure — pushModelToCloud ships the LIVE model (not a re-read of the failed
// store). Mock the cloud layer so the push is observable without a network.
const upserts = [];
vi.mock("../src/workspaces/site-planner/lib/cloudSync.js", () => ({
  cloudUpsert: vi.fn(async (uid, model) => { upserts.push({ uid, model }); return { ok: true }; }),
  cloudDelete: vi.fn(async () => ({ ok: true })),
  cloudList: vi.fn(async () => []),
  clearSiteVersions: vi.fn(),
  keepaliveCloudPush: vi.fn(() => true),
}));

import { saveSite, loadSite, pushModelToCloud, setActiveUser } from "../src/workspaces/site-planner/lib/storage.js";

const bld = (id) => ({ id, type: "building", cx: 0, cy: 0, w: 10, h: 10 });
const BIG = "data:image/png;base64," + "A".repeat(120 * 1024); // 120KB inline raster

function mockLocalStorage({ quotaBytes = Infinity } = {}) {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      const s = String(v);
      if (s.length > quotaBytes) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
      store[k] = s;
    },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
  return store;
}

describe("B473 — device-full degrades gracefully + the cloud save is never blocked", () => {
  beforeEach(() => { upserts.length = 0; setActiveUser(null); });

  it("a full store sheds inline rasters from sheetOverlays/parcelDrawings/underlay so ALL geometry still persists", () => {
    mockLocalStorage({ quotaBytes: 60 * 1024 }); // the raster-laden record won't fit; the slim one will
    const ok = saveSite({
      id: "s1", site: "X", els: [bld("a"), bld("b")],
      sheetOverlays: [{ id: "o1", src: BIG }],
      parcelDrawings: [{ id: "d1", src: BIG }],
      underlay: { src: BIG },
    });
    expect(ok).toBe(true);                                  // the write SUCCEEDED via the slim retry — no total loss
    const back = loadSite("s1");
    expect(back.els.map((e) => e.id).sort()).toEqual(["a", "b"]); // every drawn item survived
    expect(back.sheetOverlays[0].src ?? null).toBe(null);          // raster shed...
    expect(back.sheetOverlays[0].strippedForCloud).toBe(true);     // ...and flagged to re-fetch from cloud
    expect(back.parcelDrawings[0].src ?? null).toBe(null);
    expect(back.underlay?.src ?? null).toBe(null);
  });

  it("a normal (non-quota) save KEEPS inline rasters — stripping is ONLY under pressure", () => {
    mockLocalStorage({ quotaBytes: Infinity });
    saveSite({ id: "s2", els: [bld("a")], sheetOverlays: [{ id: "o1", src: BIG }] });
    expect(loadSite("s2").sheetOverlays[0].src).toBe(BIG);  // preserved when there's room
  });

  it("pushModelToCloud is a no-op when logged out", async () => {
    mockLocalStorage();
    const r = await pushModelToCloud({ id: "s3", els: [bld("a")] });
    expect(r.skipped).toBe(true);
    expect(upserts.length).toBe(0);
  });

  it("pushModelToCloud ships the LIVE model — the cure, not a re-read of a failed local store", async () => {
    mockLocalStorage();
    setActiveUser("u1");
    const r = await pushModelToCloud({ id: "s4", els: [bld("a"), bld("b"), bld("c")] });
    expect(r.ok).toBe(true);
    expect(upserts.length).toBe(1);
    expect(upserts[0].uid).toBe("u1");
    expect(upserts[0].model.id).toBe("s4");
    expect(upserts[0].model.els.length).toBe(3);           // the live 3 items reached the cloud, normalized
  });

  it("pushModelToCloud rejects a model with no id (never push junk)", async () => {
    mockLocalStorage();
    setActiveUser("u1");
    const r = await pushModelToCloud({ els: [bld("a")] });
    expect(r.ok).toBe(false);
    expect(upserts.length).toBe(0);
  });
});

describe("B474 — IndexedDB-backed raster src is dropped from the persisted record (off the cap)", () => {
  beforeEach(() => { upserts.length = 0; setActiveUser(null); mockLocalStorage(); });

  it("drops underlay src when it's idb-backed (idbKey present), keeping geometry + the ref", () => {
    saveSite({ id: "u1", els: [bld("a")], underlay: { src: BIG, idbKey: "raster:u1:underlay", imgW: 10, imgH: 10 } });
    const back = loadSite("u1");
    expect(back.els.map((e) => e.id)).toEqual(["a"]);          // geometry kept
    expect(back.underlay.src ?? null).toBe(null);              // heavy raster dropped from the record
    expect(back.underlay.idbKey).toBe("raster:u1:underlay");   // ref kept → rehydrate on load
  });

  it("KEEPS underlay src when it is NOT idb-backed (no idbKey) — safe fallback, no data loss", () => {
    saveSite({ id: "u2", els: [bld("a")], underlay: { src: BIG, imgW: 10, imgH: 10 } });
    expect(loadSite("u2").underlay.src).toBe(BIG);             // not idb-backed → src preserved in the record
  });

  it("over-quota with MIXED rasters: dropIdbBackedSrc sheds the idb-backed one; the still-too-big record then sheds the inline one too (#30)", () => {
    mockLocalStorage({ quotaBytes: 60 * 1024 });
    const ok = saveSite({ id: "u4", els: [bld("a")],
      underlay: { src: BIG, idbKey: "raster:u4:underlay", imgW: 10, imgH: 10 },  // idb-backed → shed by dropIdbBackedSrc
      sheetOverlays: [{ id: "o1", src: BIG }] });                                 // NOT idb-backed → only the over-quota stripDataUrls sheds it
    expect(ok).toBe(true);                                                        // persisted via the slim retry
    const back = loadSite("u4");
    expect(back.els.map((e) => e.id)).toEqual(["a"]);            // geometry survived
    expect(back.underlay.src ?? null).toBe(null);               // idb-backed underlay shed
    expect(back.underlay.idbKey).toBe("raster:u4:underlay");    // ref kept → rehydrate from idb
    expect(back.sheetOverlays[0].src ?? null).toBe(null);       // inline overlay shed by the quota fallback
    expect(back.sheetOverlays[0].strippedForCloud).toBe(true);  // flagged to re-fetch from cloud
  });

  it("drops sheetOverlay + parcelDrawing src ONLY when idb-backed (keeps non-backed = safe)", () => {
    saveSite({ id: "u3", els: [bld("a")],
      sheetOverlays: [{ id: "o1", src: BIG, idbKey: "raster:u3:overlay:o1" }, { id: "o2", src: BIG }],
      parcelDrawings: [{ id: "d1", src: BIG, idbKey: "raster:u3:drawing:d1" }, { id: "d2", src: BIG }] });
    const back = loadSite("u3");
    expect(back.sheetOverlays.find((o) => o.id === "o1").src ?? null).toBe(null);  // idb-backed → dropped
    expect(back.sheetOverlays.find((o) => o.id === "o1").idbKey).toBe("raster:u3:overlay:o1"); // ref kept
    expect(back.sheetOverlays.find((o) => o.id === "o2").src).toBe(BIG);           // NOT backed → src kept
    expect(back.parcelDrawings.find((d) => d.id === "d1").src ?? null).toBe(null); // idb-backed → dropped
    expect(back.parcelDrawings.find((d) => d.id === "d2").src).toBe(BIG);          // NOT backed → src kept
  });
});
