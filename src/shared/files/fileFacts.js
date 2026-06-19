/* File facts + placement-readiness flags (B181 / NEW-2). Pure + dependency-free, so it
 * is shared by the filer (doc-review, which produces facts at filing time) AND the
 * placer (site-planner, which reads them to choose a "Place on map" method) without a
 * cross-workspace import. The actual title-block read pass (embedded coords, scale bar,
 * north arrow, boundary, dimensions) is a BACKEND job; this module defines the schema +
 * the cheap browser-capturable subset + the readiness derivation the cascade uses.
 *
 * Document classes (NEW-1): a file is `spatial` (can live on the map — drawings,
 * surveys, legal descriptions), `reference` (pulled and read, never a map object —
 * geotech, environmental, contracts), or `both` (a title commitment: reference as a
 * document, but Schedule A's legal description feeds the boundary polygon and Schedule
 * B's exceptions feed easement objects).
 */

export const DOC_CLASS = { SPATIAL: "spatial", REFERENCE: "reference", BOTH: "both" };

// Disciplines whose drawings are inherently spatial (a sheet that lives on the map).
const SPATIAL_DISCIPLINES = new Set(["Survey", "Civil", "Architectural", "Landscape", "CAD"]);
// Disciplines that are read-only references unless an item keyword says otherwise.
const REFERENCE_DISCIPLINES = new Set(["Geotech", "Environmental"]);

// Item keywords. Title commitments are dual-class; a legal description / plat is spatial.
const RE_TITLE = /\b(title\s*(commitment|policy|report)|commitment\s*for\s*title|schedule\s*[ab])\b/i;
const RE_LEGAL = /\b(metes|bounds|legal\s*desc|description\s*of|plat|deed)\b/i;
const RE_REFERENCE = /\b(geotech|soils?\b|boring|environmental|phase\s*[i12]|esa|contract|agreement|report|letter|memo)\b/i;

/* Classify a file into a document class from its discipline + item/title text. */
export function classifyDocClass({ discipline = "", item = "", title = "" } = {}) {
  const text = `${item} ${title}`;
  if (RE_TITLE.test(text)) return DOC_CLASS.BOTH;            // title commitment: read + boundary/easement source
  if (SPATIAL_DISCIPLINES.has(discipline)) return DOC_CLASS.SPATIAL;
  if (RE_LEGAL.test(text)) return DOC_CLASS.SPATIAL;          // a legal description / plat anywhere is spatial
  if (REFERENCE_DISCIPLINES.has(discipline)) return DOC_CLASS.REFERENCE;
  if (RE_REFERENCE.test(text)) return DOC_CLASS.REFERENCE;
  return DOC_CLASS.REFERENCE;                                 // default: read-only until proven spatial
}

// The placement-readiness flags a backend title-block pass is expected to fill. Listed
// here so the extractor and the cascade (placeOnMap.js) agree on one contract.
export const PLACEMENT_FLAG_KEYS = [
  "embeddedCoords", // { present, crs }            — drawing already in a known CRS → land exactly
  "boundary",       // { present }                 — visible parcel/property line → fit to held geometry
  "scaleBar",       // { present, lengthPx, realFt } — measurable graphic scale → resize-invariant scale
  "dimensions",     // [{ valueFt, label, p1, p2 }]  — labeled dimensions → scale + verification
  "statedScale",    // { text, feetPerInch }       — printed scale text (a claim about plot size)
  "northArrow",     // { present, deg }            — for rotation to ground north
  "pageSize",       // { wPt, hPt, std, label }    — standard plot size → a printed scale can be trusted
];

/* A fresh facts object with every flag defaulted to "unknown / absent". */
export function makeFileFacts(overrides = {}) {
  const base = {
    docClass: DOC_CLASS.REFERENCE,
    embeddedCoords: { present: false, crs: null },
    boundary: { present: false },
    scaleBar: { present: false, lengthPx: null, realFt: null },
    dimensions: [],
    statedScale: { text: null, feetPerInch: null },
    northArrow: { present: false, deg: null },
    pageSize: { wPt: null, hPt: null, std: false, label: null },
    capturedAt: null,
    source: null, // 'browser' | 'backend'
  };
  return mergeFacts(base, overrides);
}

/* Shallow-merge per flag (each flag is its own small object/array), so a backend pass
 * can fill the expensive flags over a browser pass without clobbering the cheap ones. */
export function mergeFacts(a = {}, b = {}) {
  const out = { ...a, ...b };
  for (const k of ["embeddedCoords", "boundary", "scaleBar", "statedScale", "northArrow", "pageSize"]) {
    if (a[k] || b[k]) out[k] = { ...(a[k] || {}), ...(b[k] || {}) };
  }
  if (b.dimensions) out.dimensions = b.dimensions;
  return out;
}

/* Capture the facts that are CHEAP browser-side at filing time (the rest wait for the
 * backend title-block pass). The caller parses the PDF (stated-scale text via
 * parseScaleNote, page size via detectSheet — both in site-planner/lib/overlayScale.js)
 * and passes the already-derived primitives in, so this module stays dependency-free.
 *   feetPerInch — number|null   from parseScaleNote(text)
 *   scaleText   — string|null   the raw note shown to the user
 *   sheet       — { std, label, wi, hi }|null  from detectSheet(wPt,hPt)
 *   pageWpt/Hpt — page intrinsic size in points
 */
export function captureBrowserFacts({ discipline, item, title, feetPerInch = null, scaleText = null, sheet = null, pageWpt = null, pageHpt = null } = {}) {
  return makeFileFacts({
    docClass: classifyDocClass({ discipline, item, title }),
    statedScale: { text: scaleText || null, feetPerInch: feetPerInch || null },
    pageSize: { wPt: pageWpt, hPt: pageHpt, std: !!(sheet && sheet.std), label: sheet ? sheet.label : null },
    capturedAt: Date.now(),
    source: "browser",
  });
}

/* Which placement rungs the facts support, best→fallback, with a reason per rung. Drives
 * the NEW-3 cascade so it never silently falls through a failed high rung. Rung ids match
 * placeOnMap.js: 'embedded' | 'boundary' | 'graphic' | 'manual'. */
export function placementReadiness(facts = {}) {
  const f = facts || {};
  const hasScaleGraphic = (f.scaleBar && f.scaleBar.present && f.scaleBar.lengthPx > 0 && f.scaleBar.realFt > 0)
    || (Array.isArray(f.dimensions) && f.dimensions.some((d) => d && d.valueFt > 0));
  return {
    embedded: {
      ready: !!(f.embeddedCoords && f.embeddedCoords.present),
      why: f.embeddedCoords && f.embeddedCoords.present
        ? `Embedded coordinates${f.embeddedCoords.crs ? ` (${f.embeddedCoords.crs})` : ""} — can land exactly.`
        : "No embedded real-world coordinates on the sheet.",
    },
    boundary: {
      ready: !!(f.boundary && f.boundary.present),
      why: f.boundary && f.boundary.present
        ? "A property boundary is on the sheet — fit it to the held parcel geometry."
        : "No detected parcel/property boundary to fit against.",
    },
    graphic: {
      ready: hasScaleGraphic,
      why: hasScaleGraphic
        ? "A measurable graphic (scale bar or labeled dimension) — scale is resize-invariant."
        : "No measurable scale bar or labeled dimension found.",
    },
    manual: { ready: true, why: "Trace a labeled dimension or two points by hand (always available)." },
  };
}
