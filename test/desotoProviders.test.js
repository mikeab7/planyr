/* DeSoto County MS — who serves a site, by provider name (B2507057), over the REAL Mississippi PSC service-area polygons (recorded 2026-10-29 from County_Web_Map 69–72).
 * A click anywhere in the county must say who serves WATER, SEWER, GAS and ELECTRIC without the person reading polygons, and never present a failed/unloaded set as "none". */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  providersFrom, providerRows, providerName, ensureProviders, providerCardAt, providersReady, _setProviders, PROVIDER_LAYERS, providerUrl,
} from "../src/workspaces/site-planner/lib/desotoProviders.js";
import { providerColor, providerStyle, DESOTO_LAYERS } from "../src/workspaces/site-planner/lib/desotoLayers.js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/desotoProviders.json", import.meta.url), "utf8")).layers;
const at = (lat, lng) => providerRows(providersFrom(FX, lat, lng));

describe("providerName", () => {
  it.each([
    ["Olive Branch, City of", "City of Olive Branch"], ["City of Olive Branch", "City of Olive Branch"], ["Entergy Mississippi, Inc.", "Entergy Mississippi"],
    ["  Walls   Water Assn., Inc. ", "Walls Water Assn."], ["Atmos Energy Corporation", "Atmos Energy Corporation"],
  ])("%j → %j", (raw, want) => expect(providerName(raw)).toBe(want));
  it.each([[null], [undefined], [""], ["   "]])("%j → null", (raw) => expect(providerName(raw)).toBeNull());
});

describe("the four services at real DeSoto points", () => {
  it("Olive Branch: the city for water, sewer and gas; Northcentral Mississippi EPA for electric", () => {
    expect(at(34.9618, -89.8295)).toEqual([
      { label: "Water", text: "City of Olive Branch · 662-892-9200" },
      { label: "Sewer", text: "City of Olive Branch" },
      { label: "Gas", text: "City of Olive Branch · 662-892-9200" },
      { label: "Electric", text: "Northcentral Mississippi EPA · 888-857-8114" },
    ]);
  });
  it("Southaven: the city's water, the Southaven Utility District's sewer, Atmos gas, Entergy electric", () => {
    const rows = Object.fromEntries(at(34.9889, -90.0126).map((r) => [r.label, r.text]));
    expect(rows.Water).toMatch(/^City of Southaven/);
    expect(rows.Sewer).toBe("Southaven Utility District");
    expect(rows.Gas).toMatch(/^Atmos Energy Corporation/);
    expect(rows.Electric).toMatch(/^Entergy Mississippi/);
  });
  it("a service the PSC layer maps nothing for says so plainly (Hernando's sewer) — a real empty answer, not 'Loading'", () => {
    const sewer = at(34.824, -89.9937).find((r) => r.label === "Sewer");
    expect(sewer.text).toBe("No certificated provider mapped here");
  });
  it("the card always lists the four services in the same order", () => {
    expect(at(34.9618, -89.8295).map((r) => r.label)).toEqual(["Water", "Sewer", "Gas", "Electric"]);
    expect(PROVIDER_LAYERS.map((l) => l.id)).toEqual([71, 72, 70, 69]);
  });
  it("a point outside every area is an empty list for each service, not null", () => {
    const r = providersFrom(FX, 29.76, -95.37);
    for (const k of ["water", "sewer", "gas", "electric"]) expect(r[k]).toEqual([]);
  });
});

describe("not loaded / partial is 'Loading…', never 'none'", () => {
  it("no collections at all → every row Loading", () => {
    expect(providerRows(providersFrom(null, 34.96, -89.83)).every((r) => r.text === "Loading…")).toBe(true);
  });
  it("one missing service is Loading while the rest answer", () => {
    const partial = { ...FX, gas: undefined };
    const rows = providerRows(providersFrom(partial, 34.9618, -89.8295));
    expect(rows.find((r) => r.label === "Gas").text).toBe("Loading…");
    expect(rows.find((r) => r.label === "Water").text).toMatch(/Olive Branch/);
  });
});

describe("ensureProviders — four small fetches through the relay, all-or-nothing, never cached on failure", () => {
  beforeEach(() => _setProviders(null));
  const serve = (broken = null) => vi.fn(async (url) => {
    const l = PROVIDER_LAYERS.find((x) => url === providerUrl(x));
    if (!l || l.key === broken) return { ok: false };
    return { ok: true, json: async () => FX[l.key] };
  });
  it("asks the four PSC layers on the county server through /gis-proxy, once", async () => {
    const f = serve();
    const got = await ensureProviders(f);
    expect(Object.keys(got).sort()).toEqual(["electric", "gas", "sewer", "water"]);
    expect(f).toHaveBeenCalledTimes(4);
    for (const [u] of f.mock.calls) expect(u.startsWith("/gis-proxy/gis.desotocountyms.gov/arcgis/rest/services/CountyWebMap/County_Web_Map/MapServer/")).toBe(true);
    await ensureProviders(f);
    expect(f).toHaveBeenCalledTimes(4);
    expect(providersReady()).toBe(true);
    expect(providerCardAt(34.9618, -89.8295).find((r) => r.label === "Electric").text).toMatch(/Northcentral/);
  });
  it("one service failing fails the load (a partial set would read as 'no electric provider') and is retried next time", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await ensureProviders(serve("sewer"))).toBeNull();
    expect(providersReady()).toBe(false);
    expect(err).toHaveBeenCalled();
    expect(await ensureProviders(serve())).not.toBeNull();
    err.mockRestore();
  });
});

describe("the four PSC layer rows", () => {
  const PSC = ["ms_psc_electric", "ms_psc_gas", "ms_psc_water", "ms_psc_sewer"];
  it("each answers the SAME card (one click → all four providers), deduped by one key", () => {
    _setProviders(FX);
    const cards = PSC.map((id) => DESOTO_LAYERS[id].identifyCard({}, { lat: 34.9618, lng: -89.8295 }));
    expect(new Set(cards.map((c) => c.dedupeKey)).size).toBe(1);
    for (const c of cards) { expect(c.title).toBe("Who serves this site"); expect(c.rows).toHaveLength(4); expect(c.note).toMatch(/not a will-serve letter/); }
    _setProviders(null);
  });
  it("their ArcGIS layers are the PSC layers 69 / 70 / 71 / 72 on the county server", () => {
    const ids = Object.fromEntries(PSC.map((id) => [id, DESOTO_LAYERS[id].url.match(/MapServer\/(\d+)$/)[1]]));
    expect(ids).toEqual({ ms_psc_electric: "69", ms_psc_gas: "70", ms_psc_water: "71", ms_psc_sewer: "72" });
  });
  it("a provider is the same colour on every layer and load, and the style carries it", () => {
    expect(providerColor("City of Olive Branch")).toBe(providerColor("CITY OF OLIVE BRANCH"));
    const s = providerStyle({ UTILITY_NA: "Entergy Mississippi, Inc." }, 0.4);
    expect(s).toMatchObject({ color: providerColor("Entergy Mississippi, Inc."), fill: true });
    expect(s.fillOpacity).toBeLessThanOrEqual(0.3);
  });
});
