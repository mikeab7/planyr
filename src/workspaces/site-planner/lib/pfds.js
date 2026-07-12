/* NOAA Atlas-14 PFDS text parser + WSE(0.2%) provider notes (Site Planner) — B763.
 *
 * Plain-English: NOAA publishes, for any point in the country, how deep a rainstorm of a
 * given rarity is expected to be (the "100-year 24-hour" storm, etc.). This file takes the
 * raw text NOAA hands back and turns it into a small, honest table you can read a number
 * out of — WITHOUT guessing. If the point is outside NOAA's coverage the text comes back
 * short and missing its data header; we return `null` (LOUD-FAILURE) rather than invent a
 * zero. It also parks the *research notes* for the Fort Bend / regional 0.2%-annual-chance
 * (500-year) water-surface-elevation providers we could NOT verify this session, so a
 * browser-equipped teammate can lock the real endpoint later.
 *
 * PURE + browser-free on purpose: `parsePfdsText` takes a string and returns data (no fetch,
 * no DOM), so it unit-tests in Node and can run in a Web Worker. The live NOAA endpoint has
 * NO CORS, so the browser must NOT fetch it directly — production routes it through a
 * same-origin proxy (`functions/api/pfds.js`); the endpoint string lives in
 * WSE02_PROVIDER_NOTES.noaaPfds below. Screening only: a PFDS depth is a design reference,
 * never a regulatory determination.
 *
 * Response shape (english / depth variant):
 *   line 1:  "Point precipitation frequency estimates (inches)"
 *   ~11 preamble/metadata lines (project, location, lat/lon, datum, …)
 *   a "PRECIPITATION FREQUENCY ESTIMATES" banner
 *   the header:  "by duration for ARI (years):, 1,2,5,10,25,50,100,200,500,1000"
 *   per-duration rows:  "24-hr:, v1, v2, …"   (cells comma-separated, each trimmed)
 * We locate the header by its "by duration for ARI" marker (that both strips the ~11
 * preamble lines AND is the coverage gate); return periods are matched BY VALUE
 * (periods.indexOf(100)/indexOf(500)), duration rows by the label before the ":".
 */

const ARI_HEADER_RE = /by duration for ARI/i;

/* Parse a NOAA PFDS text body into { periods:[years…], rows:{ "24-hr":[depths…], … } }.
 * Returns null when the "by duration for ARI" header is absent — the out-of-coverage /
 * short-body case (LOUD-FAILURE: an honest UNKNOWN, never a fabricated table of zeros).
 * Each comma-separated cell is trimmed; return periods and depths are parsed to numbers.
 * Pure. */
export function parsePfdsText(text) {
  if (typeof text !== "string" || !text.length) return null;
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((ln) => ARI_HEADER_RE.test(ln));
  if (headerIdx < 0) return null; // no data header → out of coverage / malformed → honest null

  // Header: first cell is the "by duration for ARI (years):" label, the rest are the
  // return periods. Trim each; drop any trailing empty cell (a trailing comma); to numbers.
  const headerCells = lines[headerIdx].split(",").map((c) => c.trim());
  const periods = headerCells
    .slice(1)
    .filter((c) => c !== "")
    .map((c) => Number(c));
  if (!periods.length) return null; // header present but no return-period columns → nothing to read

  // Data rows: everything after the header. A row's first cell is "<label>:" and the rest
  // are depths. Skip lines with no ":" (blank lines / trailing footer text) and rows that
  // carry no numeric depth.
  const rows = {};
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || raw.indexOf(":") < 0) continue;
    const cells = raw.split(",").map((c) => c.trim());
    const label = cells[0].split(":")[0].trim();
    if (!label) continue;
    const depths = cells
      .slice(1)
      .filter((c) => c !== "")
      .map((c) => Number(c));
    if (!depths.length) continue;
    rows[label] = depths;
  }

  return { periods, rows };
}

/* Read one depth out of a parsed PFDS table: the duration row matched by its label, at the
 * column whose return period equals returnPeriodYr (matched BY VALUE, not by position).
 * Returns a number, or null when the table is missing, the duration is absent, the return
 * period isn't a published column, or the cell isn't a finite number (LOUD-FAILURE — never
 * a coerced 0). Pure. */
export function pfdsDepthFor(parsed, durationLabel, returnPeriodYr) {
  if (!parsed || !parsed.rows || !Array.isArray(parsed.periods)) return null;
  const row = parsed.rows[durationLabel];
  if (!Array.isArray(row)) return null;
  const idx = parsed.periods.indexOf(returnPeriodYr);
  if (idx < 0) return null;
  const v = row[idx];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/* WSE(0.2% / 500-yr) provider research notes (B763; FBCDD resolved by the V279 live
 * discovery, 2026-07-11, and wired 2026-07-12). The FBCDD entry is now a LIVE, WIRED
 * source — its registry row is GIS_SOURCES.fbcddWse02 (shared/gis/sources.js) and its
 * sampler is site-planner/lib/fbcdWse.js; the entry here keeps the discovery facts for
 * provenance. The remaining entries are still pointers, each stating its status plainly. */
export const WSE02_PROVIDER_NOTES = {
  fbcdd: {
    name: "Fort Bend County Drainage District (FBCDD)",
    status: "LIVE — wired (registry row GIS_SOURCES.fbcddWse02; sampler lib/fbcdWse.js)",
    // The V279 discovery corrected the old assumption: the Atlas-14 watershed-study
    // results are NOT a FeatureServer layer/field — they are WSE RASTERS on the portal's
    // Image Server (per-watershed services + county-wide 500YR mosaics).
    restBase: "https://gisportal.fortbendcountytx.gov/image/rest/services",
    endpoint: "https://gisportal.fortbendcountytx.gov/image/rest/services/500YR_WSE/ImageServer",
    // Source-of-truth portal item (the old b1882e732fa042aeaa6e2fc7447f0377 pointer no
    // longer resolves on the county portal OR arcgis.com — replaced 2026-07-12):
    portalItem: "0d4791f2c9d143eeb62696850ce27e45", // "Fort Bend County Watershed Study Inundation Map All - 100YR and 500YR (Draft Results)"
    layerId: null, // raster mosaic — consumed via getSamples (no layer id / no field)
    field: null,
    note:
      "County-wide 0.2% (500-yr) WSE mosaic: F32 pixels in FEET (ft-NAVD88 by study convention), SR 2278, value range ~24–167. Consumed point-wise via getSamples (the 3DEP pattern); CORS-clean from planyr.io (no proxy needed). ⚠ DRAFT study results — derived values carry the draft-study screening label, never an effective/published elevation. The 100-yr rasters have NO county-wide mosaic (44 per-watershed services, e.g. Willow_Creek/Willow_100YR_Existing_WSE, plus _100YR_LOS_WSE variants) — an atlas14Wse100Ft feed would need per-watershed multiplexing.",
  },
  maapnext: {
    name: "MAAPnext (HCFCD Modeling, Assessment and Awareness Project)",
    status: "pointer only — draft product",
    url: "https://www.maapnext.org",
    note:
      "HCFCD's next-generation floodplain models; draft as of this session — a reference pointer only, not a queryable WSE endpoint yet.",
  },
  m3: {
    name: "M3 (m3models.org)",
    status: "pointer only — download-only",
    url: "https://www.m3models.org",
    note:
      "Regional H&H model repository; download-only (no live query service) — a reference pointer only.",
  },
  noaaPfds: {
    name: "NOAA Atlas 14 Precipitation Frequency Data Server (PFDS)",
    status: "live text endpoint — NO CORS (needs a same-origin proxy: functions/api/pfds.js)",
    endpoint:
      "https://hdsc.nws.noaa.gov/cgi-bin/hdsc/new/fe_text_mean.csv?lat=&lon=&data=depth&units=english&series=pds",
    note:
      "Point precipitation-frequency depths (inches), parsed by parsePfdsText here. Do NOT wire a browser fetch (no CORS) — route through the production proxy.",
  },
};
