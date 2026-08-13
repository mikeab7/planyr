/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * cityLimitClass — ⛔ NEW-1: "CITY LIMITS" IS NOT ONE THING, AND READING IT AS A BOOLEAN
 * OVERSTATES JURISDICTION ON MOST OF BAYTOWN'S OWN POLYGONS.
 *
 * Baytown publishes ONE layer (`BT_City_Limit`, layer 12 of the Citizen Map service) carrying
 * THREE different legal animals, separated only by its `FEATURE` column. Counted live
 * 2026-08-12 against the 38 published polygons:
 *
 *     CITY                14   full-purpose corporate limits
 *     LIMITED ANNEXATION  12   limited-purpose annexation (Tex. Loc. Gov't Code ch. 43 subch. C-1)
 *     StripAnnex          12   strip annexation
 *
 * (`FEATURE` is null on one polygon where `NAME` and `Comment` both say CITY — hence 13/12/12 on
 * `FEATURE` alone and 14/12/12 once the fallback columns are read. The reader takes them in that
 * order rather than trusting one column, and an unreadable value is `unknown`, never `full`.)
 *
 * **So 24 of 38 polygons are NOT full-purpose limits.** Reading any hit as "City of Baytown"
 * claims the city's whole regulatory reach — zoning, platting, building code, its floodplain
 * ordinance — over land where it holds a fraction of it. That is the owner's Grand Port site: it
 * sits inside `LIMITED ANNEXATION` polygon OID 1344 (`CL-20170711-007`) at 99% by area, which is
 * a real, nameable jurisdictional fact and is NOT the same fact as being in Baytown.
 *
 * ⛔ THE THREE ARE NEVER COLLAPSED TO A BOOLEAN, and the badge says which one it is. The plain-
 * English explanation of what each means rides the info popover, not the badge (PANEL-BREVITY:
 * a named state beats a sentence explaining the state).
 *
 * ⛔ AND THE GENERALISATION, which is the half that outlives Baytown: a layer NAMED "city limits"
 * is not required to mean full-purpose limits. Every city-limits row in the GIS registry must
 * DECLARE which — either the field that separates the classes (`limitClassField` + `limitClassMap`)
 * or `fullPurposeOnly: true`, an explicit claim that the source publishes nothing else. A row that
 * declares neither cannot answer the question and `declaredLimitClassing` says so; the registry
 * fixture test fails that row rather than letting it answer by assumption.
 *
 * Pure — no network, no DOM.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/* The classes, in descending order of how much authority they carry. `badge` is what the pill may
 * say; `gloss` is the popover's plain-English line; `governsFully` is the one machine-readable
 * fact downstream code (the floodplain administrator especially) needs. */
export const CITY_LIMIT_CLASSES = {
  full: {
    id: "full",
    badge: "limits",
    qualifier: "full purpose",
    governsFully: true,
    gloss: "Full-purpose city limits — the city's ordinances apply here in full: zoning, platting, building code and its floodplain rules.",
  },
  limited: {
    id: "limited",
    badge: "limited-purpose annexation",
    qualifier: "limited purpose",
    governsFully: false,
    gloss: "Limited-purpose annexation — the city has annexed this land for SOME purposes only (typically planning and land use). It is not inside the full city limits, and which ordinances reach it has to be confirmed with the city.",
  },
  strip: {
    id: "strip",
    badge: "strip annexation",
    qualifier: "strip",
    governsFully: false,
    gloss: "Strip annexation — a narrow annexed strip, usually a road or corridor taken in to carry the city's reach outward. It rarely means the land beside it is in the city.",
  },
  unknown: {
    id: "unknown",
    badge: "city-limits layer, class not stated",
    qualifier: "class unknown",
    governsFully: false,
    gloss: "This source publishes city-limits polygons without saying which are full-purpose limits and which are limited-purpose or strip annexation, so how far the city's authority reaches here is unconfirmed.",
  },
};

export const CITY_LIMIT_CLASS_ORDER = ["full", "limited", "strip", "unknown"];

/* ⚠ The per-source value→class mapping is DATA and lives on the registry row (`limitClassMap` in
 * `shared/gis/sources.js`), not here. Adding a city is adding a row; this module stays the generic
 * reader so no city gets its own branch. */

const norm = (v) => String(v == null ? "" : v).trim().toUpperCase();

/* Does this source declare how it separates the classes? Two acceptable answers and no third. */
export function declaredLimitClassing(source) {
  if (!source) return { ok: false, kind: null, reason: "no source" };
  if (source.limitClassField && source.limitClassMap) return { ok: true, kind: "class-field", field: source.limitClassField, reason: null };
  if (source.fullPurposeOnly === true) return { ok: true, kind: "full-purpose-only", field: null, reason: null };
  return {
    ok: false, kind: null, field: null,
    reason: `city-limits source "${source.id || source.key || "?"}" declares neither a class field (limitClassField + limitClassMap) nor fullPurposeOnly:true — it cannot say whether a hit is full-purpose limits, limited-purpose annexation or a strip`,
  };
}

/* Classify ONE feature's attributes. `unknown` is a real answer and is never quietly upgraded to
 * `full`: overstating jurisdiction is the defect this module exists for. */
export function classifyCityLimit(source, attrs) {
  const decl = declaredLimitClassing(source);
  if (!decl.ok) return CITY_LIMIT_CLASSES.unknown;
  if (decl.kind === "full-purpose-only") return CITY_LIMIT_CLASSES.full;
  const fields = [source.limitClassField, ...(source.limitClassFallbackFields || [])];
  for (const f of fields) {
    const raw = attrs ? attrs[f] : null;
    if (raw == null || String(raw).trim() === "") continue;
    const id = source.limitClassMap[norm(raw)];
    if (id && CITY_LIMIT_CLASSES[id]) return CITY_LIMIT_CLASSES[id];
  }
  return CITY_LIMIT_CLASSES.unknown;
}

/* The badge wording for one city × one class. The city NAME is never dropped — a limited-purpose
 * area is Baytown's, and saying so is the point — but "City of X" on its own is reserved for
 * full-purpose limits, because that phrase is what a reader takes to mean the whole ordinance set.
 * `share` (0..1) is folded in by the caller; this owns the noun. */
export function cityLimitLabel(city, classId) {
  const c = CITY_LIMIT_CLASSES[classId] || CITY_LIMIT_CLASSES.unknown;
  const name = String(city || "").replace(/^City of\s+/i, "");
  if (c.id === "full") return `City of ${name} limits`;
  if (c.id === "limited") return `${name} limited-purpose annexation`;
  if (c.id === "strip") return `${name} strip annexation`;
  return `${name} city-limits layer (class not stated)`;
}

/* The plain-English line for the info popover — the class's gloss, named to the city. */
export function cityLimitGloss(city, classId) {
  const c = CITY_LIMIT_CLASSES[classId] || CITY_LIMIT_CLASSES.unknown;
  const name = String(city || "the city").replace(/^City of\s+/i, "");
  return c.gloss.replace(/^the city's/i, `${name}'s`).replace(/\bthe city has\b/i, `${name} has`).replace(/\bthe city's\b/g, `${name}'s`);
}

/* Which class leads when a site touches more than one: the strongest present. */
export function dominantClass(classIds) {
  for (const id of CITY_LIMIT_CLASS_ORDER) if ((classIds || []).includes(id)) return id;
  return null;
}
