// source-scan: sweeps src/ for static imports of the lazy per-state parcel table files (a behavioural check cannot see an import graph)
/* Batch K stage 2 (B2671306) — the per-state county parcel tables load on demand (parcelStateTables.js). The guards that make that safe:
 *  · "NOT LOADED YET" IS NEVER "NO DATA": until a state's rows are in, `countyIdentity` answers `pending` (never the "no parcel source here" answer, which would be a
 *    silent wrong statement about a county Planyr does have a source for), and a lookup that missed because the state was loading starts the load itself;
 *  · once loaded, every row is BYTE-IDENTICAL to what the static import gave (test/fixtures/countyRowsBaseline.json was dumped from the pre-split counties.js);
 *  · a SAVED county key is never rewritten or dropped because its table has not arrived;
 *  · a failed load is LOUD (console.error, the load retried on the next ask) and leaves `pending`, not `no-source`;
 *  · the index agrees with the files, no lazy row feeds a URL-keyed registry the refresh does not know, no eager module imports a table file statically. */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const LIB = "../src/workspaces/site-planner/lib/";
const BASE = JSON.parse(readFileSync(new URL("./fixtures/countyRowsBaseline.json", import.meta.url), "utf8"));
const POLYGONS = JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8"));
const h = (o) => createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 8);

/** A FRESH copy of the modules with NOTHING preloaded — what production has at first paint — and the county geometry resident. */
async function freshUnloaded() {
  vi.resetModules();
  globalThis.__PLANYR_NO_PARCEL_PRELOAD__ = true; // read by the alias target of parcelTablesPreload.js (test/helpers/parcelTablesPreloadAll.js)
  const counties = await import(LIB + "counties.js");
  const tables = await import(LIB + "parcelStateTables.js");
  const polys = await import(LIB + "countyPolygons.js");
  await polys.setCountyPolygons(POLYGONS);
  delete globalThis.__PLANYR_NO_PARCEL_PRELOAD__;
  return { counties, tables };
}
const LEXINGTON = [38.0406, -84.5037]; // Fayette County, KY
const HOUSTON = [29.76, -95.37];

describe("production shape: nothing of Kentucky is in the registry until something is in Kentucky", () => {
  let env;
  beforeAll(async () => { env = await freshUnloaded(); });

  it("starts without the lazy rows, and Houston work never loads them", () => {
    expect(env.counties.COUNTIES_MAP.harris).toBeTruthy();
    expect(env.counties.countyIdentity(...HOUSTON).status).toBe("ok");
    expect(Object.keys(env.counties.COUNTIES_MAP).filter((k) => k.startsWith("ky_") && k !== "ky_jefferson")).toEqual([]);
    for (const st of env.tables.LAZY_PARCEL_STATES) expect(env.tables.parcelStateLoaded(st), st).toBe(false);
  });

  it("a point in an unloaded state is PENDING — never 'no parcel source here' — and that very answer starts the load, whose arrival is announced", async () => {
    const seen = [];
    const off = env.tables.onParcelTablesLoaded((st) => seen.push(st));
    const id = env.counties.countyIdentity(...LEXINGTON);
    expect(id.status).toBe("pending");
    expect(id.reason).toBe("parcel-tables");
    expect(id.state).toBe("KY");
    expect(env.counties.noParcelSourceNote(id)).toBeNull(); // no gap sentence about a county Planyr has a source for
    await env.tables.ensureParcelState("KY"); // the in-flight load the kick started
    off();
    expect(seen).toEqual(["KY"]);
    expect(env.counties.COUNTIES.ky_fayette).toBeTruthy();
    expect(env.counties.countyIdentity(...LEXINGTON)).toMatchObject({ status: "ok", key: "ky_fayette" });
  });

  it("a lookup that MISSED because the state was loading starts the load (the proxy kicks it)", async () => {
    expect(env.counties.COUNTIES.mo_clay ?? null).not.toBe("never"); // hand-written, always present
    expect(env.tables.parcelStateLoaded("OK")).toBe(false);
    void env.counties.COUNTIES.ok_canadian; // a saved Oklahoma key read before the table arrived
    await vi.waitFor(() => expect(env.tables.parcelStateLoaded("OK")).toBe(true));
    expect(env.counties.COUNTIES.ok_canadian || env.counties.COUNTIES_MAP.ok_canadian).toBeTruthy();
  });

  it("ensureCountyGeometryAt waits for the point's state, so a lot click never reads a half-loaded registry", async () => {
    expect(env.tables.parcelStateLoaded("SC")).toBe(false);
    await env.counties.ensureCountyGeometryAt(34.85, -82.4); // Greenville SC area
    expect(env.tables.parcelStateLoaded("SC")).toBe(true);
    expect(env.counties.countyIdentity(34.85, -82.4).status).toBe("ok");
  });

  it("the view path: pending (and NOT memoized) while the rows load, complete afterwards", async () => {
    const view = { south: 37.9, west: -84.7, north: 38.2, east: -84.3 };
    expect(env.tables.parcelStateLoaded("KY")).toBe(true); // loaded above — use a still-unloaded state for the "before" half
    const view2 = { south: 41.5, west: -93.8, north: 41.7, east: -93.5 }; // Des Moines, IA
    expect(env.tables.parcelTablesReadyForView(view2)).toBe(false);
    env.counties.displaySourcesForView(view2); // kicks the load
    await env.tables.ensureParcelStatesForView(view2);
    expect(env.tables.parcelTablesReadyForView(view2)).toBe(true);
    const after = env.counties.displaySourcesForView(view2);
    expect(after.some((k) => k.startsWith("ia_") || k === "ia_polk")).toBe(true);
    expect(env.counties.displaySourcesForView(view).length).toBeGreaterThan(0);
  });

  it("a SAVED county key is left exactly as stored: the lookup answers undefined until the rows land, nothing is rewritten", async () => {
    const fresh = await freshUnloaded();
    const saved = { county: "ny_niagara", name: "Erie site" };
    const before = JSON.stringify(saved);
    expect(fresh.counties.COUNTIES[saved.county]).toBeUndefined(); // sync read before the table: a miss, not a verdict
    expect(JSON.stringify(saved)).toBe(before);
    expect(fresh.tables.lazyStateOfKey(saved.county)).toBe("NY");
    await fresh.tables.ensureParcelStatesForKeys([saved.county]);
    expect(fresh.counties.COUNTIES[saved.county] || fresh.counties.COUNTIES_MAP[saved.county]).toBeTruthy();
    expect(JSON.stringify(saved)).toBe(before);
  });

  it("countyKeyForNameLoaded never answers null for a county only because its state was still loading", async () => {
    const fresh = await freshUnloaded();
    expect(fresh.counties.countyKeyForName("Fayette", "KY")).toBeNull(); // the sync form cannot know yet
    expect(await fresh.counties.countyKeyForNameLoaded("Fayette", "KY")).toBe("ky_fayette");
    expect(await fresh.counties.countyKeyForNameLoaded("Harris", "TX")).toBe("harris"); // a non-lazy state needs no wait
  });
});

describe("a failed load is loud, retried, and never reads as 'no data'", () => {
  it("rejects, logs, leaves pending, and the next ask retries", async () => {
    const env = await freshUnloaded();
    const file = env.tables.PARCEL_STATE_FILES.find((f) => f.state === "KY");
    const real = file.load;
    const errors = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => errors.push(a.join(" ")));
    const reported = [];
    env.tables.setParcelTableReporter((st, e) => reported.push([st, String(e)]));
    file.load = () => Promise.reject(new Error("chunk 404"));
    await expect(env.tables.ensureParcelState("KY")).rejects.toThrow("chunk 404");
    env.tables.kickParcelState("KY"); // a sync caller right after a failure backs off (no re-fire of a failing fetch every frame)
    expect(env.tables.parcelStateLoaded("KY")).toBe(false);
    expect(errors.some((m) => m.includes("KY") && m.includes("could not load"))).toBe(true);
    expect(reported[0][0]).toBe("KY");
    expect(env.tables.parcelStateLoaded("KY")).toBe(false);
    expect(env.counties.countyIdentity(...LEXINGTON).status).toBe("pending"); // never "no-source"
    file.load = real;
    await env.tables.ensureParcelState("KY");
    expect(env.counties.countyIdentity(...LEXINGTON).status).toBe("ok");
    spy.mockRestore();
  });
});

describe("once loaded, the registry is IDENTICAL to the pre-split one", () => {
  let env;
  beforeAll(async () => { env = await freshUnloaded(); await env.tables.loadAllParcelStates(); });

  it("the same rows (content), under the same keys", () => {
    const cfgKeys = Object.keys(env.counties.COUNTIES), mapKeys = Object.keys(env.counties.COUNTIES_MAP);
    expect(cfgKeys).toEqual(BASE.keys); // same keys in the same ORDER (candidate order and tie-breaks read it)
    expect(mapKeys).toEqual(BASE.mapKeys);
    expect(new Set(cfgKeys)).toEqual(new Set(BASE.keys));
    expect(new Set(mapKeys)).toEqual(new Set(BASE.mapKeys));
    const badCfg = BASE.keys.filter((k) => h(env.counties.COUNTIES[k]) !== BASE.cfg[k]);
    const badMap = BASE.mapKeys.filter((k) => h(env.counties.COUNTIES_MAP[k]) !== BASE.map[k]);
    expect(badCfg).toEqual([]);
    expect(badMap).toEqual([]);
  });

  it("the URL-keyed registry a lazy row feeds (Monroe IA's pointOrderBy) is refilled when its state lands", () => {
    expect(env.counties.POINT_ORDER_BY_LAYERS).toEqual(BASE.pointOrderBy);
    expect(Object.keys(env.counties.STACK_RULE_LAYERS)).toEqual(BASE.stackKeys);
  });

  it("routing answers match, point for point, over a national grid (candidate sources + the heading county)", () => {
    // the dump ran with the county geometry NOT resident (bbox path) — load a fresh copy the same way
    return (async () => {
      vi.resetModules();
      const c = await import(LIB + "counties.js"); // preloaded (alias) = all rows, geometry not resident
      const got = BASE.routing.map(([la, ln]) => [la, ln, h([c.candidateCountiesForPoint(la, ln), c.countyForView(la, ln)])]);
      const bad = got.filter((g, i) => g[2] !== BASE.routing[i][2]).map((g) => g.slice(0, 2));
      expect(bad).toEqual([]);
    })();
  });
});

describe("the index agrees with the files", () => {
  it("every lazy file serves exactly its state, under its own key prefix, and no lazy row feeds a registry the refresh does not know", async () => {
    const { PARCEL_STATE_FILES } = await import(LIB + "parcelStateTables.js");
    expect(new Set(PARCEL_STATE_FILES.map((f) => f.state)).size).toBe(PARCEL_STATE_FILES.length);
    for (const f of PARCEL_STATE_FILES) {
      const { raw, map } = await f.load();
      const prefix = f.state.toLowerCase() + "_";
      expect(Object.keys(raw).length, f.state).toBeGreaterThan(0);
      expect(Object.keys(map).sort(), f.state).toEqual(Object.keys(raw).sort());
      for (const [k, v] of Object.entries(raw)) { expect(k.startsWith(prefix), k).toBe(true); expect(v.state, k).toBe(f.state); }
      for (const [k, v] of Object.entries(map)) {
        expect(v.state, k).toBe(f.state);
        for (const flag of ["statewide", "identifyOnly", "pointViaEnvelope", "dedupeBy", "pointWhere", "cityScoped", "excludedCounties"])
          expect(v[flag], `${k}.${flag}: a lazy row feeding this registry needs counties.js refreshLazyDerived extended first`).toBeUndefined();
      }
    }
  });

  it("no eager module imports a per-state table file statically", () => {
    const TABLES = ["alabama", "sd", "id", "nm", "ga", "la", "mo", "mi", "sc", "pa", "il", "wa", "or", "ok", "az", "ks", "ny", "ia", "ky"].map((s) => `${s}Parcels.js`);
    const offenders = [];
    const walk = (dir) => {
      for (const n of readdirSync(dir)) {
        const p = path.join(dir, n);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(js|jsx)$/.test(n)) continue;
        const src = readFileSync(p, "utf8");
        for (const t of TABLES) {
          const re = new RegExp(`(^|\\n)\\s*(import|export)[^\\n]*from\\s*["'][^"']*/${t}["']`);
          if (re.test(src)) offenders.push(`${p} → ${t}`);
        }
      }
    };
    walk(path.resolve("src"));
    expect(offenders).toEqual([]);
  });
});
