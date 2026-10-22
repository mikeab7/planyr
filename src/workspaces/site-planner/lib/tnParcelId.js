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

/** Davidson's lettered Metro numbers: a lettered parcel block ("082140A11800") and the condominium suffix ("082140A11800CO") — 12 to 14 characters, never all digits (those are `digitsOnlyId`'s).
 *  Measured on the layer 2026-10-22: `053030C90000CO`, `091053E10200CO`, `082030I00100CO`. Returns the compact upper-case number, or null. */
export function davidsonLetteredId(text) {
  const u = stripIdLabel(text);
  if (!u || !ID_CHARS_RE.test(u)) return null;
  const c = u.replace(/[^A-Z0-9]/g, "");
  return /^\d{6}[A-Z]\d{5}(?:[A-Z]{2})?$/.test(c) || /^\d{11}[A-Z]{2}$/.test(c) ? c : null;
}

/* The counties whose own layer can answer an id search, and the shape each wants. One row per source; `kind` says how the id is stored:
 *   control  — Rutherford's dashed control-map id ("156-027.00-000"), searched as text (NEW-2, 2026-10-21)
 *   digits   — Davidson's 11-digit STANPAR
 *   link     — the assessor's fixed-width control-map LINK ("104    01308": map(3) letter(1) ␠ group(1) ␠ parcel(5)), carried in `linkField` by every
 *              CAMA-family source — pass 2's Williamson / Hamilton / Montgomery / Hickman, Chester, and the Comptroller's statewide layer (which also has
 *              the same three parts in CMAP / GP / PARCEL, used instead of a text scan: `statewide: true`)
 *   paid     — Shelby's assessor number with the spaces removed (`PAID`)
 * (NEW-2 of the 95-county sweep: until now only Rutherford and Davidson were asked, so the id the card SHOWS for every other Tennessee lot could not be searched.) */
export const TN_ID_SOURCES = [
  { county: "tn_rutherford", name: "Rutherford", countyId: 75, kind: "control" },
  { county: "tn_davidson", name: "Davidson", countyId: 19, kind: "digits" },
  { county: "tn_williamson", name: "Williamson", countyId: 94, kind: "link", linkField: "GISLINK" },
  { county: "tn_hamilton", name: "Hamilton", countyId: 33, kind: "link", linkField: "GISLINK" },
  { county: "tn_montgomery", name: "Montgomery", countyId: 63, kind: "link", linkField: "gislink_1" },
  { county: "tn_hickman", name: "Hickman", countyId: 41, kind: "link", linkField: "GISLINK" },
  { county: "tn_chester", name: "Chester", countyId: 12, kind: "link", linkField: "L15Parce_2" },
  { county: "tn_shelby", name: "Shelby", countyId: 79, kind: "paid", paidField: "PAID" },
  { county: "tn_statewide", name: "Tennessee", kind: "link", statewide: true },
];

/* Tennessee's 95 counties in the state's own alphabetical id order (county id 1..95) — the Comptroller's COUNTY_ID, and the 3-digit prefix of the state
 * GISLINK / PARCELID. Pinned against the layer's own per-county count by test/tnNonStateCounties.test.js. */
export const TN_COUNTY_BY_ID = ["Anderson", "Bedford", "Benton", "Bledsoe", "Blount", "Bradley", "Campbell", "Cannon", "Carroll", "Carter", "Cheatham", "Chester", "Claiborne", "Clay", "Cocke", "Coffee",
  "Crockett", "Cumberland", "Davidson", "Decatur", "DeKalb", "Dickson", "Dyer", "Fayette", "Fentress", "Franklin", "Gibson", "Giles", "Grainger", "Greene", "Grundy", "Hamblen", "Hamilton",
  "Hancock", "Hardeman", "Hardin", "Hawkins", "Haywood", "Henderson", "Henry", "Hickman", "Houston", "Humphreys", "Jackson", "Jefferson", "Johnson", "Knox", "Lake", "Lauderdale", "Lawrence",
  "Lewis", "Lincoln", "Loudon", "McMinn", "McNairy", "Macon", "Madison", "Marion", "Marshall", "Maury", "Meigs", "Monroe", "Montgomery", "Moore", "Morgan", "Obion", "Overton", "Perry",
  "Pickett", "Polk", "Putnam", "Rhea", "Roane", "Robertson", "Rutherford", "Scott", "Sequatchie", "Sevier", "Shelby", "Smith", "Stewart", "Sullivan", "Sumner", "Tipton", "Trousdale", "Unicoi",
  "Union", "Van Buren", "Warren", "Washington", "Wayne", "Weakley", "White", "Williamson", "Wilson"];

const SLUG = (n) => String(n || "").toLowerCase().replace(/[^a-z]/g, "");
const COUNTY_BY_SLUG = new Map(TN_COUNTY_BY_ID.map((n, i) => [SLUG(n), { name: n, id: i + 1 }]));

/** A Tennessee county named in the text ("Anderson 073 171.02", "073-171.02 Anderson County") → { county:{name,id}, rest }, else null. Only a county name standing apart from the id
 *  (the first or last words, optionally followed by "County") counts; `rest` is what is parsed as the id. */
export function countyHintOf(text) {
  const t = stripIdLabel(text).replace(/\s+/g, " ");
  const named = (w) => COUNTY_BY_SLUG.get(SLUG(w));
  let m = /^([A-Z][A-Z ]*?)(?: COUNTY)? (\d.*)$/.exec(t);
  if (m && named(m[1])) return { county: named(m[1]), rest: m[2] };
  m = /^(.*\d) ([A-Z][A-Z ]*?)(?: COUNTY)?$/.exec(t);
  if (m && named(m[2])) return { county: named(m[2]), rest: m[1] };
  return null;
}

/* ---------- the fixed-width control-map LINK family ---------- */
const LETTER = "[A-Z]?";
const pad3 = (s) => String(s).padStart(3, "0");
/** { map:"050", letter:"B", group:"A", parcel5:"01400" } from a stored link ("050B A 01400", "006050B A 01400", "104    01308"), or null. Fixed offsets, county prefix optional. */
export function parseStoredLink(str) {
  if (str == null) return null;
  let s = String(str).toUpperCase();
  if (/^\d{3}\d{3}[A-Z ] [A-Z ] \d{5}/.test(s)) s = s.slice(3);
  const m = /^(\d{3})([A-Z ]) ([A-Z ]) (\d{5})/.exec(s);
  return m ? { map: m[1], letter: m[2].trim(), group: m[3].trim(), parcel5: m[4] } : null;
}
/** The same parts from the Comptroller layer's separate columns (CMAP "050B", GP "A" or " ", PARCEL "014.00"). */
export function storedPartsFromColumns(attrs) {
  if (!attrs) return null;
  const cm = /^(\d{3})([A-Z]?)\s*$/.exec(String(attrs.CMAP == null ? "" : attrs.CMAP).trim().toUpperCase());
  const pm = /^(\d{1,3})\.(\d{2})$/.exec(String(attrs.PARCEL == null ? "" : attrs.PARCEL).trim());
  if (!cm || !pm) return parseStoredLink(attrs.GISLINK);
  return { map: cm[1], letter: cm[2], group: String(attrs.GP == null ? "" : attrs.GP).trim().toUpperCase(), parcel5: `${pm[1].padStart(3, "0")}${pm[2]}` };
}

/** Every reading of a typed string as a control-map link. Each: { map, letter, group, parcel5, si?, countyId?, lone?, via }. `lone` = exactly one letter was typed (it is the map letter OR
 *  a group with no lettered map — the match accepts either). Several readings of one string are all returned; the caller asks them all and never guesses between them. */
export function linkForms(text) {
  const u = stripIdLabel(text);
  if (!u || !ID_CHARS_RE.test(u)) return [];
  const compact = u.replace(/[^A-Z0-9]/g, "");
    const out = [];
  const add = (f) => { if (!out.some((o) => o.map === f.map && o.letter === f.letter && o.group === f.group && o.parcel5 === f.parcel5 && o.countyId === f.countyId)) out.push(f); };
  const cty = (n) => (n >= 1 && n <= 95 ? n : undefined);
  let m;
  /* the Comptroller's PARCELID as the card shows it: county · map · parcel · special interest · tax year  ("001 073    17102 000 2026") */
  if ((m = new RegExp(`^(\\d{3})(\\d{3})(${LETTER})(${LETTER})(\\d{5})(\\d{3})(\\d{4})$`).exec(compact)) && cty(+m[1])) add({ map: m[2], letter: m[3], group: m[4], parcel5: m[5], si: m[6], countyId: +m[1], via: "state-id" });
  /* a CaptureCAMA id as the card shows it: the fixed link, then five digits and the map again ("104    01308 00005104", Williamson / Hickman / Chester) */
  if ((m = new RegExp(`^(\\d{3})(${LETTER})(${LETTER})(\\d{5})([A-Z]?)(\\d{5})(\\d{3})(${LETTER})$`).exec(compact)) && m[7] === m[1] && m[8] === m[2]) add({ map: m[1], letter: m[2], group: m[3], parcel5: m[4], via: "tail-id" });
  /* a county-prefixed link ("006050B A 01400", Chester "012045    05501") */
  if ((m = new RegExp(`^(\\d{3})(\\d{3})(${LETTER})(${LETTER})(\\d{5})$`).exec(compact)) && cty(+m[1])) add({ map: m[2], letter: m[3], group: m[4], parcel5: m[5], countyId: +m[1], via: "county-link" });
  /* map · parcel [.dd] [· special interest] — the form an owner types, and Montgomery's / Rutherford's own ("090 00203 000", "156-027.00-000") */
  if ((m = new RegExp(`^(\\d{3})(${LETTER})(${LETTER})(\\d{3})(\\d{2})(\\d{3})?$`).exec(compact))) add({ map: m[1], letter: m[2], group: m[3], parcel5: `${m[4]}${m[5]}`, si: m[6], via: "control" });
  /* Hamilton's tax-map number ("066  018", "057F B 003", "130 001.18"): map · parcel with no decimals unless there are some. Only when the text SHOWS a separator, so a bare six-digit number is never an id. */
  if (/^\d{3}[A-Z]?[ ._\-/]*[A-Z]?[ ._\-/]+\d{3}(?:\.\d{2})?$/.test(u) && (m = new RegExp(`^(\\d{3})(${LETTER})(${LETTER})(\\d{3})(\\d{2})?$`).exec(compact))) add({ map: m[1], letter: m[2], group: m[3], parcel5: `${m[4]}${m[5] || "00"}`, via: "tax-map" });
  /* each reading with ONE letter: it is the map letter or a group — flagged so the match accepts either */
  out.forEach((f) => { if (f.letter && !f.group) { f.lone = true; } else if (!f.letter && f.group) { f.letter = f.group; f.group = ""; f.lone = true; } });
  return out;
}

/** Shelby's assessor number, spaces and case ignored ("072124 A00048", "G0231   00121C", "C0244W H00045") → "072124A00048", else null. Strict shape so an ordinary number is never read as one. */
export function shelbyPaid(text) {
  const u = stripIdLabel(text);
  if (!u || !ID_CHARS_RE.test(u)) return null;
  const c = u.replace(/[^A-Z0-9]/g, "");
  return /^(?:\d{6}|[A-Z]\d{4}[A-Z]?)[A-Z]?\d{5}[A-Z]?$/.test(c) ? c : null;
}

/** Does a stored link's parts satisfy the typed reading? 2 = every part equal, 1 = equal apart from an unspecified group, 0 = no. */
export function linkMatch(stored, f) {
  if (!stored || !f) return 0;
  if (stored.map !== f.map || stored.parcel5 !== f.parcel5) return 0;
  if (f.lone) {
    if (stored.letter === f.letter && !stored.group) return 2;
    if (!stored.letter && stored.group === f.letter) return 2;
    return stored.letter === f.letter || stored.group === f.letter ? 1 : 0;
  }
  if (stored.letter !== f.letter) return f.letter ? 0 : stored.group === f.group ? 1 : 0;
  if (stored.group === f.group) return 2;
  return f.group ? 0 : 1;
}

/** The SQL where for a link reading against one source. Values are alnum-only by construction (regex-matched above), so nothing here can carry quotes. */
export function linkWhere(src, f, countyId) {
  const mapLike = `${f.map}${f.lone || !f.letter ? "" : f.letter}`;
  if (src.statewide) {
    const cmap = f.lone || !f.letter ? `CMAP LIKE '${f.map}%'` : `CMAP LIKE '${f.map}${f.letter}%'`;
    const parcel = `${f.parcel5.slice(0, 3)}.${f.parcel5.slice(3)}`;
    const trimmed = String(+f.parcel5.slice(0, 3)) + `.${f.parcel5.slice(3)}`;
    const w = [cmap, `(PARCEL='${parcel}' OR PARCEL='${trimmed}')`];
    if (f.group && !f.lone) w.push(`UPPER(GP)='${f.group}'`);
    if (countyId) w.push(`COUNTY_ID=${countyId}`);
    return w.join(" AND ");
  }
  return `UPPER(${src.linkField}) LIKE '%${mapLike}%${f.parcel5}'`;
}

/** The text a county's own in-planner ID box should search, for a county declaring `idNormalizer` "tn-link" / "tn-hamilton" / "tn-shelby": the typed id rebuilt as a LIKE pattern over the way that
 *  county stores it ("104%01308"), so any spacing finds it. Unparseable text is returned untouched. */
function wildcardFor(kind, text) {
  if (kind === "tn-shelby") {
    const c = shelbyPaid(text);
    if (!c) return text;
    const m = /^(.*?)([A-Z]?\d{5}[A-Z]?)$/.exec(c);
    return m && m[1] ? `${m[1]}%${m[2]}` : text;
  }
  const f = linkForms(text)[0];
  if (!f) return text;
  if (kind === "tn-hamilton") {
    const par = f.parcel5.slice(3) === "00" ? f.parcel5.slice(0, 3) : `${f.parcel5.slice(0, 3)}.${f.parcel5.slice(3)}`;
    return `${f.map}${f.lone || !f.letter ? "" : f.letter}%${par}`;
  }
  return `${f.map}%${f.parcel5}`;
}

/** Does this look like something a person would type to find a Tennessee parcel by id rather than an address or a place? */
export function looksLikeTnParcelId(text) {
  return tnParcelIdPlan(text).length > 0;
}

/** The lookups to run for one typed string: [{ county, name, kind, value, canonical, where?, form? }], most specific first. Empty → not an id.
 *  A county named in the text, or a county id carried by the id itself (the state's own form), narrows the plan to that county; otherwise EVERY source whose id shape the text could be is asked
 *  (an id that reads two ways — an 11-digit number is a control-map id, a Metro number and a Shelby number — asks them all, never guesses). */
export function tnParcelIdPlan(text) {
  const hint = countyHintOf(text);
  const body = hint ? hint.rest : text;
  const only = hint ? hint.county.id : null;
  const plan = [];
  const ctl = parseControlMapId(body);
  const dig = digitsOnlyId(body) || davidsonLetteredId(body);
  const paid = shelbyPaid(body);
  const forms = linkForms(body);
  const own = new Set(TN_ID_SOURCES.filter((s) => s.countyId).map((s) => s.countyId));
  for (const s of TN_ID_SOURCES) {
    if (only && s.countyId && s.countyId !== only) continue;
    if (only && s.statewide && own.has(only)) continue; // the Comptroller's layer holds none of that county
    if (s.kind === "control") { if (ctl) plan.push({ county: s.county, name: s.name, kind: "control", value: ctl.prefix, canonical: ctl.canonical }); }
    else if (s.kind === "digits") { if (dig) plan.push({ county: s.county, name: s.name, kind: "digits", value: dig, canonical: dig }); }
    else if (s.kind === "paid") { if (paid) plan.push({ county: s.county, name: s.name, kind: "paid", value: paid, canonical: paid, where: `UPPER(${s.paidField})='${paid}'` }); }
    else if (s.kind === "link") {
      for (const f of forms) {
        if (f.countyId && s.countyId && f.countyId !== s.countyId) continue;
        if (f.countyId && s.statewide && own.has(f.countyId)) continue;
        if (f.via === "tail-id" && !(s.countyId === 94 || s.countyId === 41 || s.countyId === 12)) continue; // the CaptureCAMA tail exists only on those three
        if (f.via === "state-id" && !s.statewide) continue; // the state's own id form is the state layer's
        const cid = s.statewide ? (f.countyId || only || null) : null;
        const canonical = `${f.map}${f.letter}${f.group}-${f.parcel5}`;
        plan.push({ county: s.county, name: s.name, kind: "link", value: canonical, canonical, where: linkWhere(s, f, cid), form: f, src: s });
      }
    }
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
  if (idNormalizer === "tn-link" || idNormalizer === "tn-hamilton" || idNormalizer === "tn-shelby") return wildcardFor(idNormalizer, text);
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
