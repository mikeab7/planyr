/* NEW-1 / NEW-2 / NEW-3 — the baked FEMA NFHL flood tiles.
 *
 * Three properties are pinned here, and each one is a thing that would otherwise only be
 * observable by unplugging a server:
 *   1. THE FALLBACK. Every way the tile path can be unavailable resolves to "live". Adding tiles
 *      must never be able to make flood data disappear, and that is a property of a pure
 *      function rather than a hope about a network.
 *   2. THE DROP RULE. What the build removes, stated once and asserted against the classifier
 *      the APP uses at runtime — so the shipped archive and the app's understanding of it cannot
 *      drift.
 *   3. THE VINTAGE STAMP. It never disappears. An unreadable manifest says "unknown"; it does
 *      not silently omit the line (the B1093 honest-empty-state rule).
 *
 * The last block reads the REAL archives in public/flood/ and asserts the shipped BYTES honour
 * the rule. A test of the build script's intentions is not a test of what was committed.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PMTiles } from "pmtiles";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import {
  FLOOD_TILE_COUNTIES, FLOOD_TILE_FIELDS, FLOOD_TILE_MIN_ZOOM, FLOOD_TILE_MAX_ZOOM,
  FLOOD_TILE_LAYER_NAME, TILE_DROPPED_VARIANTS, keepInTiles,
  floodArchiveName, floodArchiveUrl, hasFloodTiles, floodTileCountyKeys,
  floodTilesEnabled, resolveFloodSource, manifestCounty, floodVintageStamp, formatVintage,
  floodAbsenceKindFor,
} from "../src/shared/gis/floodTiles.js";
import { resolveFloodZone } from "../src/workspaces/site-planner/lib/floodZone.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const FLOOD_DIR = path.join(ROOT, "public", "flood");
const manifest = JSON.parse(fs.readFileSync(path.join(FLOOD_DIR, "manifest.json"), "utf8"));

describe("archive naming", () => {
  it("carries the state, so two same-named counties can never collide", () => {
    // Texas and Colorado both have an El Paso and a Jefferson (see counties.countyKeyForName).
    expect(floodArchiveName("harris")).toBe("flood-tx-harris.pmtiles");
    expect(floodArchiveName("co_larimer")).toBe("flood-co-larimer.pmtiles");
    const names = floodTileCountyKeys().map(floodArchiveName);
    expect(new Set(names).size).toBe(names.length);
  });
  it("answers null for a county with no archive, which is the ordinary case", () => {
    expect(floodArchiveName("bexar")).toBeNull();
    expect(floodArchiveUrl("bexar")).toBeNull();
    expect(hasFloodTiles("bexar")).toBe(false);
    expect(hasFloodTiles(null)).toBe(false);
  });
});

describe("the flag is OFF by default", () => {
  it("only an explicit opt-in turns tiles on", () => {
    expect(floodTilesEnabled({})).toBe(false);
    expect(floodTilesEnabled({ VITE_FLOOD_TILES: "0" })).toBe(false);
    expect(floodTilesEnabled({ VITE_FLOOD_TILES: "off" })).toBe(false);
    expect(floodTilesEnabled({ VITE_FLOOD_TILES: "" })).toBe(false);
    expect(floodTilesEnabled({ VITE_FLOOD_TILES: "yes" })).toBe(false); // not a recognised truthy
    for (const v of ["1", "true", "TRUE", "on"]) expect(floodTilesEnabled({ VITE_FLOOD_TILES: v })).toBe(true);
  });
});

describe("resolveFloodSource — the fail-soft guarantee", () => {
  const tiles = { enabled: true, countyKey: "harris", archiveState: "unknown" };

  it("uses tiles only when the flag is on, the county has an archive, and it has not failed", () => {
    expect(resolveFloodSource(tiles).source).toBe("tiles");
    expect(resolveFloodSource(tiles).archiveUrl).toBe("/flood/flood-tx-harris.pmtiles");
  });

  // Each of these is a way the fast path can be unavailable. ALL of them must land on live.
  const FALLBACKS = [
    ["the flag is off", { ...tiles, enabled: false }],
    ["the plan has no county", { ...tiles, countyKey: null }],
    ["the county has no baked archive", { ...tiles, countyKey: "bexar" }],
    ["the archive failed earlier this session", { ...tiles, archiveState: "missing" }],
    ["nothing was passed at all", undefined],
  ];
  for (const [why, input] of FALLBACKS) {
    it(`falls back to live FEMA when ${why}`, () => {
      const r = resolveFloodSource(input);
      expect(r.source).toBe("live");
      expect(r.archiveUrl).toBeNull();
      expect(r.reason).toBeTruthy(); // never a silent fallback — the status channel gets a reason
    });
  }

  it("resolves a mixed-case county key (NEW-4)", () => {
    expect(resolveFloodSource({ ...tiles, countyKey: "Harris" }).source).toBe("tiles");
  });
});

describe("the drop rule", () => {
  const zone = (FLD_ZONE, ZONE_SUBTY, SFHA_TF = "F") => resolveFloodZone({ FLD_ZONE, ZONE_SUBTY, SFHA_TF });

  it("drops unshaded Zone X — FEMA's own renderer paints nothing for it", () => {
    expect(keepInTiles(zone("X", "AREA OF MINIMAL FLOOD HAZARD"))).toBe(false);
    expect(keepInTiles(zone("X", null))).toBe(false); // X with no subtype stated
  });

  it("KEEPS shaded Zone X — the 0.2% band drives real rules a developer is held to", () => {
    expect(keepInTiles(zone("X", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD"))).toBe(true);
    // The wider vocabulary floodZone.js documents — 54k polygons nationally that a substring
    // test for "0.2 PCT" would have thrown away.
    expect(keepInTiles(zone("X", "1 PCT DEPTH LESS THAN 1 FOOT"))).toBe(true);
    expect(keepInTiles(zone("X", "1 PCT DRAINAGE AREA LESS THAN 1 SQUARE MILE"))).toBe(true);
  });

  it("keeps the SFHA, the floodway, Zone D, and FEMA's own separate X classes", () => {
    expect(keepInTiles(zone("AE", null, "T"))).toBe(true);
    expect(keepInTiles(zone("AE", "FLOODWAY", "T"))).toBe(true);
    expect(keepInTiles(zone("D", null))).toBe(true);
    expect(keepInTiles(zone("X", "1 PCT FUTURE CONDITIONS"))).toBe(true);
    expect(keepInTiles(zone("X", "AREA WITH REDUCED FLOOD RISK DUE TO LEVEE"))).toBe(true);
  });

  it("refuses a polygon with no zone at all rather than shipping it unclassified", () => {
    expect(keepInTiles(resolveFloodZone({}))).toBe(false);
    expect(keepInTiles(null)).toBe(false);
  });

  it("names exactly the two variants it drops", () => {
    expect([...TILE_DROPPED_VARIANTS].sort()).toEqual(["unshaded-x", "x-unstated"]);
  });
});

describe("the vintage stamp (NEW-3)", () => {
  it("reads the county's effective date out of the manifest", () => {
    const s = floodVintageStamp(manifest, "harris");
    expect(s.known).toBe(true);
    expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.text).toBe(`NFHL as of ${formatVintage(s.date)}`);
  });

  it("SAYS SO rather than disappearing when the vintage cannot be read", () => {
    // Every way the stamp can fail. None of them may produce an empty string.
    for (const bad of [null, undefined, {}, { counties: null }, { counties: {} },
                       { counties: { harris: {} } },
                       { counties: { harris: { nfhlEffectiveDate: "" } } },
                       { counties: { harris: { nfhlEffectiveDate: "sometime in 2019" } } }]) {
      const s = floodVintageStamp(bad, "harris");
      expect(s.known).toBe(false);
      expect(s.date).toBeNull();
      expect(s.text).toMatch(/unknown/i);
      expect(s.text.length).toBeGreaterThan(0);
    }
  });

  it("resolves a mixed-case county key", () => {
    expect(floodVintageStamp(manifest, "Harris")).toEqual(floodVintageStamp(manifest, "harris"));
    expect(manifestCounty(manifest, "Harris")).toBe(manifestCounty(manifest, "harris"));
  });

  it("spells the month out, because a slashed date is ambiguous by hemisphere", () => {
    expect(formatVintage("2019-11-15")).toBe("Nov 15, 2019");
    expect(formatVintage("2021-01-29")).toBe("Jan 29, 2021");
  });
});

describe("the absence rule differs by source, and that is the point", () => {
  it("no polygon on tiles means OUTSIDE the mapped floodplain", () => {
    expect(floodAbsenceKindFor("tiles")).toBe("outside-mapped");
  });
  it("no polygon on the live layer means NO EFFECTIVE MAP — the opposite risk position", () => {
    expect(floodAbsenceKindFor("live")).toBe("no-map");
    expect(floodAbsenceKindFor(null)).toBe("no-map"); // unknown source takes the cautious wording
  });
});

/* ---------------------------------------------------------------------------
 * THE SHIPPED BYTES. Everything above tests intentions; this reads what was committed.
 * ------------------------------------------------------------------------- */
class NodeSource {
  constructor(p) { this.p = p; this.fd = fs.openSync(p, "r"); }
  getKey() { return this.p; }
  async getBytes(offset, length) {
    const b = Buffer.alloc(length);
    fs.readSync(this.fd, b, 0, length, offset);
    return { data: b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
  }
}
const decompress = async (buf, compression) => (compression === 2 ? zlib.gunzipSync(Buffer.from(buf)) : Buffer.from(buf));
const MAX_BYTES = 25 * 1024 * 1024; // Cloudflare Pages free: 25 MiB per single file

describe("the committed archives", () => {
  const built = Object.keys(manifest.counties);

  it("the manifest records the provenance a reader would need to check it", () => {
    expect(manifest.source.service).toMatch(/hazards\.fema\.gov/);
    expect(manifest.source.layerId).toBe(28);
    expect(manifest.fields).toEqual(FLOOD_TILE_FIELDS);
    expect(manifest.dropRule).toMatch(/unshaded/i);
    expect(built.length).toBeGreaterThan(0);
  });

  it("every archive in the manifest is a county the app knows how to route to", () => {
    for (const key of built) expect(FLOOD_TILE_COUNTIES[key], key).toBeTruthy();
  });

  for (const key of Object.keys(manifest.counties)) {
    const row = manifest.counties[key];
    const file = path.join(FLOOD_DIR, row.archive);

    it(`${key}: the file named in the manifest exists and matches its recorded size`, () => {
      expect(fs.existsSync(file), row.archive).toBe(true);
      expect(fs.statSync(file).size).toBe(row.bytes);
    });

    it(`${key}: fits under the 25 MiB Cloudflare Pages per-file cap`, () => {
      // The binding constraint on this whole design. If this ever goes red the answer is a
      // product decision (split by watershed, or drop a zoom level) — never a silent workaround.
      expect(row.bytes).toBeLessThanOrEqual(MAX_BYTES);
    });

    it(`${key}: carries a real NFHL effective date`, () => {
      expect(row.nfhlEffectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.dfirmIds.length).toBeGreaterThan(0);
    });

    it(`${key}: is a readable PMTiles archive with the expected pyramid and fields`, async () => {
      const pm = new PMTiles(new NodeSource(file), undefined, decompress);
      const header = await pm.getHeader();
      expect(header.tileType).toBe(1); // MVT
      expect(header.minZoom).toBe(FLOOD_TILE_MIN_ZOOM);
      expect(header.maxZoom).toBe(FLOOD_TILE_MAX_ZOOM);
      const md = await pm.getMetadata();
      const layer = (md.vector_layers || []).find((l) => l.id === FLOOD_TILE_LAYER_NAME);
      expect(layer, "the tiles must carry the layer name the renderer asks for").toBeTruthy();
      // A subset is fine — a county with no BFE anywhere legitimately has no STATIC_BFE column.
      for (const f of Object.keys(layer.fields)) expect(FLOOD_TILE_FIELDS).toContain(f);
    });
  }

  it("Harris (the worst case in the set) holds real polygons and no dropped variant", async () => {
    const row = manifest.counties.harris;
    const pm = new PMTiles(new NodeSource(path.join(FLOOD_DIR, row.archive)), undefined, decompress);
    const h = await pm.getHeader();
    // Sample a spread of z13 tiles across the county rather than one, so a single empty tile
    // cannot pass this as "clean".
    let seen = 0;
    for (let i = 1; i <= 4; i++) {
      for (let j = 1; j <= 4; j++) {
        const lon = h.minLon + ((h.maxLon - h.minLon) * i) / 5;
        const lat = h.minLat + ((h.maxLat - h.minLat) * j) / 5;
        const n = 2 ** 13;
        const x = Math.floor(((lon + 180) / 360) * n);
        const r = (lat * Math.PI) / 180;
        const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
        const t = await pm.getZxy(13, x, y);
        if (!t) continue;
        const layer = new VectorTile(new Pbf(t.data)).layers[FLOOD_TILE_LAYER_NAME];
        if (!layer) continue;
        for (let k = 0; k < layer.length; k++) {
          const props = layer.feature(k).properties;
          const resolved = resolveFloodZone(props);
          expect(TILE_DROPPED_VARIANTS.has(resolved && resolved.variant), JSON.stringify(props)).toBe(false);
          expect(props.STATIC_BFE == null || props.STATIC_BFE > -9998).toBe(true); // no -9999 sentinel
          seen++;
        }
      }
    }
    expect(seen, "the sampled tiles must actually contain polygons").toBeGreaterThan(50);
  });
});
