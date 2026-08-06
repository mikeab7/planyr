import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { extractPlansInBrowser, snippet } from "../scripts/extract-plan.mjs";
import { redactPlan, fixtureCensus, fixtureSite, paintedRasters } from "../ui-audit/lib/planFixture.mjs";

/* NEW-2 — the extractor the owner pastes into his own browser to turn a plan he ACTUALLY WORKS IN
 * into a fixture the harness can drive.
 *
 * ⛔ THE PROPERTY THAT MATTERS MOST IS A NEGATIVE ONE: no raster bytes, no Storage key and no user
 * id may survive into the file he sends back. A leak here is invisible until it is committed to a
 * public repository, so it is tested as a string search over the entire output rather than field by
 * field — a new private field added to the plan shape in future would otherwise pass a per-field
 * test and still leak.
 *
 * It runs against `fake-indexeddb` and a localStorage stub, so the browser-side function is exercised
 * as real code rather than shipped as an untested template string.
 */

const UID = "b147d90d-b610-423d-af65-7e004f0ad72f";
const PLAN_ID = "smr9olizi5ue";
const OVERLAY_SRC = "data:image/png;base64," + "Q".repeat(4000);
const UNDERLAY_SRC = "data:image/png;base64," + "Z".repeat(2000);

const PLAN = {
  schemaVersion: 3, origin: { lat: 29.8, lon: -95.0 }, county: "harris",
  name: "Concept A", site: "Bain",
  els: [
    { id: "e1", type: "building", cx: 0, cy: 0, w: 900, h: 380, rot: 0 },
    { id: "e2", type: "pond", rot: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 9 }] },
  ],
  parcels: [{ id: "p1", acct: "652431", points: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }] }],
  callouts: [{ id: "c1", tip: { x: 1, y: 1 }, box: { x: 2, y: 2 }, text: "ring Bob re: the variance" }],
  measures: [], markups: [], parcelDrawings: [], elevation: { crossSections: [] },
  settings: { snap: 5, stallW: 9 }, layerOverrides: { fema: true }, layerAbove: {},
  underlay: { imgW: 1800, imgH: 1167, opacity: 1, ftPerPx: 1.3333, x: -1200, y: -778, src: UNDERLAY_SRC, idbKey: `raster:${PLAN_ID}:underlay`, fromMap: true },
  sheetOverlays: [{
    id: "ovbain1", imgW: 1728, imgH: 2592, opacity: 0.55, ftPerPx: 2.7778, x: -2400, y: -3600,
    rotation: 0, locked: true, page: 1, src: OVERLAY_SRC,
    idbKey: `raster:${PLAN_ID}:overlay:ovbain1`,
    storageKey: `${UID}/site-overlays/${PLAN_ID}/ovbain1.pdf`,
    rev: 17,
  }],
};

function fakeLocalStorage(entries) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
  };
}

async function seedIdb(entries) {
  const db = await new Promise((res) => {
    const r = indexedDB.open("planyr", 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("kv")) r.result.createObjectStore("kv"); };
    r.onsuccess = () => res(r.result);
  });
  for (const [k, v] of Object.entries(entries)) {
    await new Promise((res, rej) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(v, k);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }
  db.close();
}

let extracted;
beforeEach(async () => {
  globalThis.localStorage = fakeLocalStorage({
    [`planarfit:sites:cloud:${UID}`]: JSON.stringify({ [PLAN_ID]: PLAN }),
    "planarfit:currentSite:v1": PLAN_ID,
    "planarfit:measureMode": "line",
  });
  await seedIdb({
    [`raster:${PLAN_ID}:overlay:ovbain1`]: OVERLAY_SRC,
    [`raster:${PLAN_ID}:underlay`]: UNDERLAY_SRC,
    "planarfit:sites:history:v1": "[]",
  });
  extracted = await extractPlansInBrowser({ download: false });
});

describe("what the extractor takes", () => {
  it("finds the plan in the signed-in cloud mirror key, not only the logged-out one", () => {
    expect(extracted).toHaveLength(1);
    // ...and the store key is recorded with the uid MASKED — the key itself is `planarfit:sites:cloud:<uid>`,
    // so quoting it verbatim would leak the one identifier everything else here strips.
    expect(extracted[0]._source).toMatchObject({ store: "planarfit:sites:cloud:<uid redacted>", planId: PLAN_ID });
  });

  it("keeps the geometry verbatim — the coordinates are the thing being measured", () => {
    expect(extracted[0].els).toEqual(PLAN.els);
    expect(extracted[0].parcels[0].points).toEqual(PLAN.parcels[0].points);
    expect(extracted[0].settings).toEqual(PLAN.settings);
    expect(extracted[0].layerOverrides).toEqual({ fema: true });
  });

  it("measures each raster's parameters exactly — they are what the cost depends on", () => {
    const ov = extracted[0].rasters.find((r) => r.role === "sheetOverlay");
    expect(ov).toMatchObject({ imgW: 1728, imgH: 2592, opacity: 0.55, ftPerPx: 2.7778, locked: true, page: 1, fromIdb: true });
    expect(extracted[0].rasters.find((r) => r.role === "underlay")).toMatchObject({ imgW: 1800, imgH: 1167, opacity: 1, fromMap: true });
  });

  it("measures the STORED STRING LENGTH from IndexedDB — the figure the re-read half turns on", () => {
    const ov = extracted[0].rasters.find((r) => r.role === "sheetOverlay");
    expect(ov.encodedBytes).toBe(OVERLAY_SRC.length);
  });
});

describe("what the extractor refuses to take", () => {
  const all = () => JSON.stringify(extracted);

  it("carries NO raster bytes at all", () => {
    expect(all()).not.toContain("data:image");
    expect(all()).not.toContain("QQQQ");
    expect(all()).not.toContain("ZZZZ");
  });

  it("carries NO user id, anywhere — including inside a Storage key", () => {
    expect(all()).not.toContain(UID);
    expect(all()).not.toContain("site-overlays");
    // `storageKey` may appear in the `_redacted` LIST (that is the point — say what was removed),
    // but never as a field carrying a value.
    expect(all()).not.toContain('"storageKey":');
  });

  it("drops the cloud revision", () => {
    expect(all()).not.toMatch(/"rev"/);
  });

  it("replaces callout prose with a placeholder but keeps its geometry", () => {
    expect(extracted[0].callouts[0].text).toBe("Note 1");
    expect(all()).not.toContain("variance");
    expect(extracted[0].callouts[0].tip).toEqual({ x: 1, y: 1 });
  });

  it("drops display names by default and keeps them only when asked", async () => {
    expect(extracted[0].name).toBeUndefined();
    const kept = await extractPlansInBrowser({ download: false, keepNames: true });
    expect(kept[0].name).toBe("Concept A");
  });

  it("lists what it stripped rather than removing it quietly", () => {
    expect(extracted[0]._redacted.some((s) => /raster bytes/.test(s))).toBe(true);
    expect(extracted[0]._redacted.some((s) => /storageKey/.test(s))).toBe(true);
    expect(extracted[0]._redacted.some((s) => /callout text/.test(s))).toBe(true);
  });
});

describe("the extracted file is a fixture the harness can actually drive", () => {
  it("finds nothing further to strip — the browser side and the repo side agree", () => {
    const again = redactPlan(extracted[0], { keepNames: true });
    expect(again.stripped.filter((s) => /raster bytes|storageKey|rev /.test(s))).toHaveLength(0);
  });

  it("censuses to the plan it came from", () => {
    const c = fixtureCensus(extracted[0]);
    expect(c.elements).toBe(2);
    expect(c.ponds).toBe(1);
    expect(c.parcels).toBe(1);
    expect(c.rasters).toHaveLength(2);
    expect(c.decodedRasterBytes).toBe(1800 * 1167 * 4 + 1728 * 2592 * 4);
  });

  it("seeds into the app's own storage shape, on the IndexedDB path", () => {
    const site = fixtureSite(extracted[0], { id: "S9" });
    expect(site.sheetOverlays[0].src).toBeNull();
    expect(site.sheetOverlays[0].idbKey).toBe("raster:S9:overlay:ovbain1");
    expect(site.els).toHaveLength(2);
    expect(paintedRasters(extracted[0]).map((r) => r.role)).toEqual(["sheetOverlay"]);
  });
});

describe("the console snippet", () => {
  it("embeds the very function these tests exercise, so the two cannot drift", () => {
    const s = snippet();
    expect(s).toContain("planarfit:sites:cloud:");
    expect(s).toContain("planyr-fixture-");
    expect(s).toContain("keepNames: false");
    // The snippet is an immediately-invoked expression — a bare function declaration would paste
    // into a console and do nothing at all.
    expect(s).toMatch(/\(async function extractPlansInBrowser|\(async \(/);
    expect(s).toMatch(/\}\)\(\{ keepNames/);
  });
});
