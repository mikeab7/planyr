/* Tennessee parcel-ID search — what a person types into the Site search box, turned into lookups on the counties
 * that publish their own parcels (NEW-2, TN non-state counties, 2026-10-21).
 *
 * A Tennessee parcel id is "control map + group + parcel + special interest": `156-027.00-000` is control map 156,
 * (no group), parcel 027.00, special-interest 000; `046E-A-001.00-000` is control map 046E, group A, parcel 001.00.
 * People write it with spaces, dots, dashes or nothing at all ("156 027.00 000", "15602700000", "Parcel ID: 156-027.00"), so
 * `parseControlMapId` reads the SHAPE from the characters and rebuilds the canonical dashed form the county layer stores.
 * Davidson County publishes the 11-digit STANPAR instead ("10508026600"), so the same digits are also offered to it.
 * Ambiguity is resolved by ASKING BOTH — an 11-digit number is a valid control-map id and a valid STANPAR — never by guessing.
 *
 * Pure: no network, no DOM. The caller runs each lookup through `lookupParcels` (parcelQuery.js), the one id/address query. */

const PREFIX_RE = /^(?:tn\s*)?(?:tax\s*)?(?:parcel\s*(?:id|number|no|#)?|pid|apn|map\s*(?:and|&)\s*parcel|id)?\s*[#:]*\s*/i;

/* Characters a person may legitimately type inside an id. Anything else (a comma, a street word) is an address. */
const ID_CHARS_RE = /^[A-Z0-9 .\-_/]+$/;

/** The text with a leading "Parcel ID:" / "APN" / "#" label removed, upper-cased and trimmed. */
export function stripIdLabel(text) {
  return String(text == null ? "" : text).trim().replace(PREFIX_RE, "").trim().toUpperCase();
}

/** Parse a Tennessee control-map id. Returns { canonical, prefix, parts } or null.
 *   canonical — the dashed form the county layer stores ("156-027.00-000", or "156-027.00" when no special-interest part was typed)
 *   prefix    — the value to hand to an `UPPER(idField) LIKE '%v%'` search: the canonical form, or for a lettered control map typed
 *               without its group letter ("046E 001.00") a wildcard form that still finds it. */
export function parseControlMapId(text) {
  const u = stripIdLabel(text);
  if (!u || !ID_CHARS_RE.test(u)) return null;
  const compact = u.replace(/[^A-Z0-9]/g, "");
  const m = /^(\d{3})([A-Z]?)([A-Z]?)(\d{3})(\d{2})(\d{3})?$/.exec(compact);
  if (!m) return null;
  const [, map, letter, group, parcel, dec, si] = m;
  /* Two letters then digits can only be (map letter)(group); one letter is ambiguous (map letter, or a group with no lettered map).
   * A group with a lettered map is how the layer writes it ("046E-A-001.00-000"); a lone letter is read as the map letter. */
  const head = `${map}${letter}`;
  const tail = `${parcel}.${dec}${si ? `-${si}` : ""}`;
  const canonical = group ? `${head}-${group}-${tail}` : `${head}-${tail}`;
  const prefix = letter && !group ? `${head}%${tail}` : canonical;
  return { canonical, prefix, parts: { map, letter, group, parcel: `${parcel}.${dec}`, specialInterest: si || null } };
}

/** The digits of an all-numeric id (Davidson's STANPAR), or null. Exactly 11 digits — measured 2026-10-21: 154,003 of Davidson's 287,729 numbers are 11 characters, none are 9, 10 or 12,
 *  and the rest (condo units, "188100A01000CO") carry letters. A shorter or longer digit string is not a Metro number. */
export function digitsOnlyId(text) {
  const u = stripIdLabel(text);
  if (!u || !/^[0-9 .\-_/]+$/.test(u)) return null;
  const d = u.replace(/\D/g, "");
  return d.length === 11 ? d : null;
}

/* The counties whose own layer can answer an id search, and the shape each wants. One row per county; a Tennessee county with no
 * entry here simply is not asked (it has no source, or its id format is not read yet — Shelby's and Chester's are county-specific). */
export const TN_ID_SOURCES = [
  { county: "tn_rutherford", name: "Rutherford", kind: "control" },
  { county: "tn_davidson", name: "Davidson", kind: "digits" },
];

/** Does this look like something a person would type to find a Tennessee parcel by id rather than an address or a place? */
export function looksLikeTnParcelId(text) {
  return tnParcelIdPlan(text).length > 0;
}

/** The lookups to run for one typed string: [{ county, name, value, canonical }], most specific first. Empty → not an id. */
export function tnParcelIdPlan(text) {
  const plan = [];
  const ctl = parseControlMapId(text);
  const dig = digitsOnlyId(text);
  for (const s of TN_ID_SOURCES) {
    if (s.kind === "control" && ctl) plan.push({ county: s.county, name: s.name, value: ctl.prefix, canonical: ctl.canonical });
    else if (s.kind === "digits" && dig) plan.push({ county: s.county, name: s.name, value: dig, canonical: dig });
  }
  return plan;
}

/** Normalise an id typed into a county's own parcel-ID lookup (the in-planner search box) the way that county stores it. Unknown counties and
 *  unparseable text pass through untouched, so nothing a person typed is ever rewritten into something else. */
export function normalizeIdFor(idNormalizer, text) {
  if (idNormalizer === "tn-control") {
    const p = parseControlMapId(text);
    return p ? p.prefix : text;
  }
  return text;
}

/** Which of the features a lookup returned IS the id typed? Exact match on the canonical value wins; otherwise a single feature is the answer and
 *  several are ambiguous (null — the caller says so rather than choosing one). `attrOf(feat)` reads the id attribute. */
export function pickIdMatch(feats, canonical, attrOf) {
  const list = feats || [];
  if (!list.length) return null;
  const norm = (v) => String(v == null ? "" : v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const want = norm(canonical);
  const exact = list.filter((f) => norm(attrOf(f)) === want);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return exact[0]; // the same id twice (a split record) — the first is as good as any, both are the same lot
  /* No exact: an id typed without its special-interest part ("156-027.00") matches "156-027.00-000" by prefix. One lot → that lot. */
  const pre = list.filter((f) => norm(attrOf(f)).startsWith(want));
  if (pre.length === 1) return pre[0];
  return list.length === 1 ? list[0] : null;
}
