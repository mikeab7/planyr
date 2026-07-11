/* Pure, config-driven transform from an ArcGIS GeoJSON feature → a `thoroughfare_segments` upsert
 * row (B721). The reusable heart of every jurisdiction adapter: B721 (Houston) and B722 (the rest)
 * supply only a config; this file is the shared normalization + geometry logic. No I/O — the
 * runnable adapter (server/ingest/thoroughfare.mjs) does the fetch + DB upsert.
 *
 * Geometry: ArcGIS polylines can be MULTI-PART, so every centerline is emitted as a PostGIS
 * MULTILINESTRING (a single LineString is wrapped as a one-part multi). Two EWKT copies are built:
 * `geom` in WGS84 (SRID 4326, as published) and `geom_2278` projected to EPSG:2278 US survey feet
 * via the shared coordinate spine (src/shared/coordinates) so B724 can measure in feet. */
import { normalizeClassification, normalizeStatus } from "./classification.js";
import { projectToGrid } from "../coordinates/index.js";

// Coordinate precision: ~0.1 m in lon/lat, sub-mm in feet — compact EWKT without lossy rounding.
const f6 = (n) => Number(n.toFixed(6));
const f3 = (n) => Number(n.toFixed(3));

/* Normalize a GeoJSON line geometry to an array of parts (each part = array of [lon, lat]).
 * Points / polygons / null → [] (not a centerline). */
export function geometryToParts(geometry) {
  if (!geometry || !geometry.coordinates) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

const partValid = (p) =>
  Array.isArray(p) && p.length >= 2 &&
  p.every((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));

/** EWKT MULTILINESTRING in WGS84 (lon lat), as published. */
export function ewkt4326(parts) {
  const body = parts
    .map((part) => "(" + part.map(([lon, lat]) => `${f6(lon)} ${f6(lat)}`).join(", ") + ")")
    .join(", ");
  return `SRID=4326;MULTILINESTRING(${body})`;
}

/** EWKT MULTILINESTRING projected to EPSG:2278 (US survey feet) via the shared coordinate spine. */
export function ewkt2278(parts) {
  const body = parts
    .map((part) => "(" + part.map(([lon, lat]) => {
      const { x, y } = projectToGrid(lat, lon);
      return `${f3(x)} ${f3(y)}`;
    }).join(", ") + ")")
    .join(", ");
  return `SRID=2278;MULTILINESTRING(${body})`;
}

// First present, non-blank property among candidate field names (jurisdictions differ on names).
const pick = (props, fields) => {
  for (const f of fields || []) {
    const v = props?.[f];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
};

/* Transform one GeoJSON feature → a thoroughfare_segments upsert row per a jurisdiction `config`.
 * Returns null (caller counts it as skipped) when the feature has no usable line geometry or no
 * stable source id — never throws on a single bad feature (LOUD-FAILURE stays at the batch level). */
export function featureToRow(feature, config) {
  const props = feature?.properties || {};
  const parts = geometryToParts(feature?.geometry).filter(partValid);
  if (!parts.length) return null;

  const sourceId = pick(props, [config.idField]);
  if (sourceId === null) return null;

  const rawClass = pick(props, config.fieldMap.classification);
  const classification = normalizeClassification(rawClass, config.classificationCrosswalk);
  const status = normalizeStatus(pick(props, config.fieldMap.status));
  const std = (config.standards && config.standards[classification]) || {};

  return {
    jurisdiction: config.jurisdiction,
    source_feature_id: String(sourceId),
    street_name: pick(props, config.fieldMap.street_name),
    classification,
    raw_classification: rawClass === null ? null : String(rawClass),
    status,
    ultimate_row_ft: std.ultimate_row_ft ?? null,
    building_line_ft: std.building_line_ft ?? null,
    plan_name: config.planName ?? null,
    plan_adopted_date: config.planAdoptedDate ?? null,
    source_url: config.sourceUrl ?? null,
    geom: ewkt4326(parts),
    geom_2278: ewkt2278(parts),
  };
}

/* Build a paged ArcGIS REST query URL (GeoJSON output, reprojected to WGS84). `resultOffset`
 * paging assumes the layer advertises pagination; the live run confirms that (else fall back to
 * OBJECTID-window paging — noted on V274). */
export function buildQueryUrl(config, { offset = 0, pageSize = 1000 } = {}) {
  const p = new URLSearchParams({
    where: config.where || "1=1",
    outFields: "*",
    outSR: "4326",
    f: "geojson",
    returnGeometry: "true",
    resultOffset: String(offset),
    resultRecordCount: String(pageSize),
  });
  return `${config.serviceUrl}/query?${p.toString()}`;
}
