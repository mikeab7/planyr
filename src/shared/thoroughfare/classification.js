/* Canonical thoroughfare classification — the ONE normalized vocabulary shared by the schema
 * (the jurisdiction_row_standards / thoroughfare_segments CHECK constraints, B720), the
 * ingestion crosswalks (B721 Houston, B722 the rest), the map overlay legend (B723), and the
 * parcel ROW-dedication analysis (B724). Pure + unit-tested so the DB enum, the legend, and the
 * analysis can never drift apart.
 *
 * Each jurisdiction publishes its own category names (Houston's ROW_STATUS/HIER_TABLE, a county
 * FHWA class, …); ingestion maps each raw value THROUGH a per-jurisdiction crosswalk to one of
 * these canonical values. An unmatched value is never dropped or thrown — it lands in 'other'
 * with the verbatim source value kept in raw_classification for audit. */

// Ordered loudest → quietest: a freeway carries the widest ROW / most constraint, 'other' the
// least. The overlay legend (B723) and any salience ordering follow this order.
export const CLASSIFICATIONS = [
  "freeway",
  "major_thoroughfare",
  "transit_corridor",
  "collector_major",
  "collector_minor",
  "other",
];

// Human labels for the legend + click popup (B723). Exactly one per classification.
export const CLASSIFICATION_LABELS = {
  freeway: "Freeway",
  major_thoroughfare: "Major Thoroughfare",
  transit_corridor: "Transit Corridor",
  collector_major: "Major Collector",
  collector_minor: "Minor Collector",
  other: "Other",
};

const VALID = new Set(CLASSIFICATIONS);

/** True iff `v` is a canonical classification (matches the DB CHECK constraint). */
export const isClassification = (v) => VALID.has(v);

/* Normalize a raw source value to a canonical classification via a per-jurisdiction crosswalk.
 * `crosswalk` maps a normalized (trimmed, lowercased) raw value → canonical value. Anything not
 * matched — including null / blank / a crosswalk value that isn't itself canonical — falls back
 * to 'other'. Never throws; never returns a non-canonical value. */
export function normalizeClassification(raw, crosswalk = {}) {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return "other";
  const mapped = crosswalk[key];
  return mapped && VALID.has(mapped) ? mapped : "other";
}

// A segment is either as-built ('existing') or a planned/future alignment ('proposed'). The
// proposed ones drive the bisecting-alignment case in B724 (a strip sterilized by a future road).
export const STATUSES = ["existing", "proposed"];

/* Normalize a raw source status. Common "future road" spellings collapse to 'proposed';
 * everything else (including blank / null) defaults to 'existing'. */
export function normalizeStatus(raw) {
  const key = String(raw ?? "").trim().toLowerCase();
  return ["proposed", "future", "planned", "ultimate"].includes(key) ? "proposed" : "existing";
}
