/* Baked FEMA NFHL flood tiles — the PURE model (NEW-1 / NEW-2 / NEW-3).
 *
 * WHY THIS EXISTS. The flood layer renders today by calling FEMA's NFHL `/export` live on
 * every pan and zoom. FEMA's server is the bottleneck — its own edge drops responses around
 * 10 s and a busy export takes 20–30 s (that is why `GIS_SOURCES.flood` carries a 20 s
 * per-source timeout instead of the 9 s default). No amount of client work fixes a slow
 * origin. So for the counties where sites actually live, the flood polygons are BAKED into
 * one PMTiles archive per county, shipped by the existing Cloudflare Pages deploy and read
 * by the browser with HTTP range requests: no new service, no new account, no cost.
 *
 * ⛔ THE LINE THAT MUST NOT MOVE — A TILE IS A PICTURE, NEVER A NUMBER.
 * Tiles are generalised (simplified per zoom, quantised to a tile grid). They are the right
 * source for the FAST PICTURE and the wrong source for anything a user acts on. Parcel-scale
 * authority is UNCHANGED: the live FEMA query still supplies the authoritative boundary and
 * the floodplain-intersection acreage that feeds the mitigation math. Fast picture from tiles,
 * exact number from FEMA.
 *
 * ⛔ AND THE ABSENCE RULE, WHICH IS NOT THE SAME AS THE LIVE LAYER'S.
 * The build DROPS unshaded Zone X (see `TILE_DROP_RULE`), so on the tiles "no polygon here"
 * means "outside the mapped floodplain" — a real finding. On the LIVE layer "no polygon here"
 * means "no effective flood map at this point" — the honest gap `layers.js` opts into with
 * `identifyGap: "flood"`, which is the opposite risk position. A readout must never show the
 * live layer's absence wording over a tile answer, or it turns a clean result into a scare.
 * `floodAbsenceKindFor(source)` is the one place that decides which wording applies.
 *
 * Pure — no DOM, no network, no Leaflet. */

import { normCountyKey } from "./countyKeys.js";

/* Where the archives are served from. Static assets under public/ ride the existing Pages
 * deploy; Pages serves them with Range support, which is the whole mechanism. */
export const FLOOD_TILE_DIR = "/flood";
export const FLOOD_MANIFEST_URL = `${FLOOD_TILE_DIR}/manifest.json`;

/* Tile pyramid the build emits. z13 is the deepest baked level; the client OVERZOOMS past it
 * (the same tile is scaled up) rather than the build paying for z14–z18, which is where a
 * county-scale polygon set gets expensive for no visible gain. */
export const FLOOD_TILE_MIN_ZOOM = 8;
export const FLOOD_TILE_MAX_ZOOM = 13;
/* Below this the archive holds nothing, so the layer must fall through to live FEMA rather
 * than paint an empty map that reads as "no flood hazard here". */
export const FLOOD_TILE_LAYER_NAME = "flood";

/* The four attributes the identify card needs, and nothing else. Every other NFHL column
 * (OBJECTID, V_DATUM, DEPTH, VELOCITY, SOURCE_CIT, the AR_* reversion fields, the geometry
 * area/length doubles) is dropped at build time — they are dead weight in every tile.
 * `resolveFloodZone` in site-planner/lib/floodZone.js reads exactly these names, which is why
 * they keep their NFHL spelling instead of being renamed to something friendlier. */
export const FLOOD_TILE_FIELDS = ["FLD_ZONE", "ZONE_SUBTY", "SFHA_TF", "STATIC_BFE"];

/* The build's drop rule, stated once so the script and the identify wording cannot drift.
 * `variant` values come from `resolveFloodZone`. */
export const TILE_DROPPED_VARIANTS = new Set(["unshaded-x", "x-unstated"]);
export const TILE_DROP_RULE =
  "Unshaded Zone X (areas of minimal flood hazard) is dropped — FEMA's own renderer paints " +
  "nothing for it, so absence of a polygon means outside the mapped floodplain. Shaded Zone X " +
  "(the 0.2% annual-chance band) is KEPT: it drives real rules a developer is held to.";

/* Should this NFHL polygon ride in the tiles? Pure, and shared by the build script and the
 * tests so the shipped archive and the documented rule are the same rule. */
export const keepInTiles = (resolved) => !!resolved && !TILE_DROPPED_VARIANTS.has(resolved.variant);

/* -------------------------------------------------------------------------
 * The counties that have an archive. Deliberately NOT every county — only the
 * ones with live sites (measured against public.sites 2026-08-09). Adding a county is a
 * one-line edit here plus a build run; nothing else in the app changes.
 * `fips` is the 5-digit county FIPS, which is also the NFHL `DFIRM_ID` prefix.
 * ----------------------------------------------------------------------- */
export const FLOOD_TILE_COUNTIES = {
  harris:      { fips: "48201", state: "TX", label: "Harris County, TX" },
  fortbend:    { fips: "48157", state: "TX", label: "Fort Bend County, TX" },
  waller:      { fips: "48473", state: "TX", label: "Waller County, TX" },
  chambers:    { fips: "48071", state: "TX", label: "Chambers County, TX" },
  co_adams:    { fips: "08001", state: "CO", label: "Adams County, CO" },
  co_larimer:  { fips: "08069", state: "CO", label: "Larimer County, CO" },
};

/* `co_larimer` → `larimer`; `harris` → `harris`. The archive filename carries the state
 * separately so two same-named counties in different states can never collide (Texas and
 * Colorado both have an El Paso and a Jefferson — see counties.js `countyKeyForName`). */
const bareName = (key) => String(key || "").replace(/^[a-z]{2}_/, "");

export function floodArchiveName(countyKey) {
  const key = normCountyKey(countyKey);
  const entry = key && FLOOD_TILE_COUNTIES[key];
  if (!entry) return null;
  return `flood-${entry.state.toLowerCase()}-${bareName(key)}.pmtiles`;
}

export function floodArchiveUrl(countyKey) {
  const name = floodArchiveName(countyKey);
  return name ? `${FLOOD_TILE_DIR}/${name}` : null;
}

/* Does a baked archive exist for this county at all? A `false` here is not a failure — it is
 * the ordinary case for the other 250-odd counties, and the layer simply stays on live FEMA. */
export const hasFloodTiles = (countyKey) => !!floodArchiveName(countyKey);

export const floodTileCountyKeys = () => Object.keys(FLOOD_TILE_COUNTIES);

/* -------------------------------------------------------------------------
 * Manifest reading (NEW-3). The build writes one manifest for all counties; the client reads
 * the vintage out of it so the panel can say WHICH edition of the NFHL it is drawing.
 * ----------------------------------------------------------------------- */

/* The per-county record, or null. Tolerant of a missing/!malformed manifest — a vintage we
 * cannot read is reported as unknown, never omitted (the B1093 honest-empty-state rule). */
export function manifestCounty(manifest, countyKey) {
  const key = normCountyKey(countyKey);
  if (!manifest || !key) return null;
  const counties = manifest.counties;
  if (!counties || typeof counties !== "object") return null;
  const row = counties[key];
  return row && typeof row === "object" ? row : null;
}

/* THE VINTAGE STAMP (NEW-3). Returns `{ text, known, date }` — never null, never an empty
 * string, because a baked tileset that is quietly six months stale is worse than a slow one
 * that is right. When the date cannot be read the stamp SAYS SO rather than disappearing. */
export function floodVintageStamp(manifest, countyKey) {
  const row = manifestCounty(manifest, countyKey);
  const date = row && typeof row.nfhlEffectiveDate === "string" ? row.nfhlEffectiveDate.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { text: "NFHL vintage unknown — this county's tiles carry no effective date", known: false, date: null };
  }
  return { text: `NFHL as of ${formatVintage(date)}`, known: true, date };
}

/* An ISO date → the spelling the panel shows. Deliberately month-name, not a slashed
 * numeric date: "11/15/2019" reads as a US date to Michael and as a day-first date to half
 * the world, and a FIRM effective date is a legal fact worth spelling unambiguously. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatVintage(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  const mon = MONTHS[Number(m[2]) - 1];
  if (!mon) return String(iso);
  return `${mon} ${Number(m[3])}, ${m[1]}`;
}

/* -------------------------------------------------------------------------
 * THE FLAG, and THE DECISION. (NEW-2)
 * ----------------------------------------------------------------------- */

/* Baked tiles are OFF by default and stay off until `VITE_FLOOD_TILES` says otherwise. This is
 * the opposite default from `gisProxyEnabled()` (on unless killed) and deliberately so: the
 * proxy is a pure enhancement over an unchanged render path, whereas this SWAPS the renderer
 * for the flood layer. A swap earns its way on, it is not assumed. */
export function floodTilesEnabled(env) {
  try {
    /* A HARNESS-ONLY OFF SWITCH. The flag is compiled in at build time, so a headless comparison of
     * "tiles" against "live" would otherwise need two servers and two builds — and the second build
     * would not be the one being shipped. This lets the verifier drive the SAME bytes down both
     * paths. It can only ever turn tiles OFF, never on, so it cannot make a production build do
     * something the flag did not already permit. */
    if (!env && typeof window !== "undefined" && window.__PLANYR_FLOOD_TILES_OFF) return false;
    const src = env || (typeof import.meta !== "undefined" && import.meta.env) || {};
    const v = String(src.VITE_FLOOD_TILES == null ? "" : src.VITE_FLOOD_TILES).toLowerCase();
    return v === "1" || v === "true" || v === "on";
  } catch (_) { return false; }
}

/* WHICH SOURCE PAINTS THE FLOOD LAYER — pure, so the fallback is a testable property rather
 * than something you have to unplug a server to observe.
 *
 * `archiveState`: "unknown" (not probed yet) · "ok" (the archive answered) · "missing" (404,
 * network error, or a header that would not parse). ANY answer other than a live, readable
 * archive resolves to "live" — that is the fail-soft guarantee in one line: adding tiles must
 * never be able to make flood data disappear.
 *
 * Returns { source: "tiles"|"live", archiveUrl, reason } — `reason` is for the layer's status
 * channel and for tests, never for a user. */
export function resolveFloodSource({ enabled = false, countyKey = null, archiveState = "unknown" } = {}) {
  const live = (reason) => ({ source: "live", archiveUrl: null, reason });
  if (!enabled) return live("flag off");
  const key = normCountyKey(countyKey);
  if (!key) return live("no county on this plan");
  const url = floodArchiveUrl(key);
  if (!url) return live(`no baked archive for ${key}`);
  if (archiveState === "missing") return live(`archive unreachable (${floodArchiveName(key)})`);
  // "unknown" is optimistic: the layer probes by READING the archive, and a failure there
  // engages the fallback. Blocking the fast path on a separate pre-probe would spend a round
  // trip to learn what the first range request is about to tell us anyway.
  return { source: "tiles", archiveUrl: url, reason: archiveState === "ok" ? "archive ready" : "archive assumed present" };
}

/* -------------------------------------------------------------------------
 * Which absence wording applies (see the header). `source` is "tiles" | "live".
 * ----------------------------------------------------------------------- */
export const floodAbsenceKindFor = (source) => (source === "tiles" ? "outside-mapped" : "no-map");

/* The sentence for each. Kept here beside the rule that picks it so the two cannot drift. */
export const FLOOD_TILE_ABSENCE_NOTE =
  "Outside the mapped floodplain on the baked FEMA tiles. The authoritative check for a parcel " +
  "is still the live FEMA query.";
