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
  const m = /^(\d{3})([A-Z]{0,4})(\d{3})(\d{2})(\d{3})?$/.exec(compact);
  if (!m) return null;
  const [, map, letters, parcel, dec, si] = m;
  /* one letter: ambiguous (read as the map letter); two: (map letter)(group); three or four: Rutherford's two-letter map letters ("091NB") then the group ("C") */
  const cut = letters.length >= 3 ? 2 : letters.length === 2 ? 1 : letters.length;
  const letter = letters.slice(0, cut), group = letters.slice(cut);
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
  { county: "tn_hamilton", name: "Hamilton", countyId: 33, kind: "link", linkField: "GISLINK", prefixed: true },
  { county: "tn_montgomery", name: "Montgomery", countyId: 63, kind: "link", linkField: "gislink_1", prefixed: true },
  { county: "tn_hickman", name: "Hickman", countyId: 41, kind: "link", linkField: "GISLINK", prefixed: true },
  { county: "tn_chester", name: "Chester", countyId: 12, kind: "link", linkField: "L15Parce_2", prefixed: true },
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
/* A Tennessee assessor number is "control map [letters] · group · parcel [.decimals] · special interest". The CAMA family stores the first three as one fixed-width LINK —
 * map(3) · map letter(s) · group · parcel(5 digits, the decimal point dropped) — padded with spaces ("050B A 01400", "104    01308", "091NB C 00800"). Map letters and the group can each be
 * one or two characters, so a typed or stored reading is reduced to { map, tag, parcel5 } where `tag` is the letters and group run together ("BA", "NBC", ""), which is exactly what no
 * amount of spacing can change. */
const LETTERS = "[A-Z]{0,4}";
/** { map:"050", tag:"BA", parcel5:"01400" } from a stored link ("050B A 01400", "006050B A 01400", "104    01308", "091NB C 00800"), or null. A leading county id (3 digits before the map) is dropped. */
export function parseStoredLink(str) {
  if (str == null) return null;
  const s = String(str).toUpperCase();
  const m = /^(\d{3})([A-Z]{0,2}) *([A-Z]{0,2}) *(\d{5})(?!\d)/.exec(s) || /^\d{3}(\d{3})([A-Z]{0,2}) *([A-Z]{0,2}) *(\d{5})(?!\d)/.exec(s);
  return m ? { map: m[1], tag: `${m[2]}${m[3]}`, parcel5: m[4] } : null;
}
/** The same parts from the Comptroller layer's separate columns (CMAP "050B", GP "A" or " ", PARCEL "014.00"). */
export function storedPartsFromColumns(attrs) {
  if (!attrs) return null;
  const cm = /^(\d{3})([A-Z]{0,2})\s*$/.exec(String(attrs.CMAP == null ? "" : attrs.CMAP).trim().toUpperCase());
  const pm = /^(\d{1,3})\.(\d{2})$/.exec(String(attrs.PARCEL == null ? "" : attrs.PARCEL).trim());
  if (!cm || !pm) return parseStoredLink(attrs.GISLINK);
  return { map: cm[1], tag: `${cm[2]}${String(attrs.GP == null ? "" : attrs.GP).trim().toUpperCase()}`, parcel5: `${pm[1].padStart(3, "0")}${pm[2]}` };
}

/** Every reading of a typed string as a control-map link. Each: { map, tag, parcel5, si?, countyId?, via }. Several readings of one string are all returned; the caller asks them all and never
 *  guesses between them. */
export function linkForms(text) {
  const u = stripIdLabel(text);
  if (!u || !ID_CHARS_RE.test(u)) return [];
  const compact = u.replace(/[^A-Z0-9]/g, "");
  const out = [];
  const add = (f) => { if (!out.some((o) => o.map === f.map && o.tag === f.tag && o.parcel5 === f.parcel5 && o.countyId === f.countyId && o.via === f.via)) out.push(f); };
  const cty = (n) => (n >= 1 && n <= 95 ? n : undefined);
  const R = (body) => new RegExp(`^${body}$`);
  let m;
  /* the Comptroller's PARCELID as the card shows it: county · map · parcel · special interest · tax year  ("001 073    17102 000 2026") */
  if ((m = R(`(\\d{3})(\\d{3})(${LETTERS})(\\d{5})(\\d{3})(\\d{4})`).exec(compact)) && cty(+m[1])) add({ map: m[2], tag: m[3], parcel5: m[4], si: m[5], countyId: +m[1], via: "state-id" });
  /* a CaptureCAMA id as the card shows it: the fixed link, then a letter or space, five digits and the map again ("104    01308 00005104", "063J D 00100C00109063J": Williamson / Hickman / Chester) */
  if ((m = R(`(\\d{3})(${LETTERS})(\\d{5})([A-Z]?)(\\d{5})(\\d{3})([A-Z]{0,2})`).exec(compact)) && m[6] === m[1]) add({ map: m[1], tag: m[2], parcel5: m[3], via: "tail-id" });
  /* a county-prefixed link ("006050B A 01400", Chester "012045    05501") */
  if ((m = R(`(\\d{3})(\\d{3})(${LETTERS})(\\d{5})`).exec(compact)) && cty(+m[1])) add({ map: m[2], tag: m[3], parcel5: m[4], countyId: +m[1], via: "county-link" });
  /* map · parcel [.dd] [· special interest] — the form an owner types, and Montgomery's / Rutherford's own ("090 00203 000", "156-027.00-000", "091NB-C-008.00-000") */
  if ((m = R(`(\\d{3})(${LETTERS})(\\d{3})(\\d{2})(\\d{3})?`).exec(compact))) add({ map: m[1], tag: m[2], parcel5: `${m[3]}${m[4]}`, si: m[5], via: "control" });
  /* Hamilton's tax-map number ("066  018", "057F B 003", "130 001.18"): map · parcel with no decimals unless there are some. Only when the text SHOWS a separator between the map and the parcel, so a bare six-digit number is never an id. */
  if (/^\d{3}[A-Z]{0,2}[ ._\-/]*[A-Z]{0,2}[ ._\-/]+\d{3}(?:\.\d{2})?$/.test(u) && (m = R(`(\\d{3})(${LETTERS})(\\d{3})(\\d{2})?`).exec(compact))) add({ map: m[1], tag: m[2], parcel5: `${m[3]}${m[4] || "00"}`, via: "tax-map" });
  return out;
}

/** Shelby's assessor number, spaces and case ignored ("072124 A00048", "G0231   00121C", "C0244W H00045") → "072124A00048", else null. Strict shape so an ordinary number is never read as one. */
export function shelbyPaid(text) {
  const u = stripIdLabel(text);
  if (!u || !ID_CHARS_RE.test(u)) return null;
  const c = u.replace(/[^A-Z0-9]/g, "");
  return /^(?:\d{6}|[A-Z]\d{4}[A-Z]?)[A-Z]?\d{5}[A-Z]?$/.test(c) ? c : null;
}

/** Does a stored link's parts satisfy the typed reading? 2 = map, letters and parcel all equal; 1 = equal apart from letters the person did not type; 0 = no. */
export function linkMatch(stored, f) {
  if (!stored || !f) return 0;
  if (stored.map !== f.map || stored.parcel5 !== f.parcel5) return 0;
  if (stored.tag === f.tag) return 2;
  return f.tag === "" || stored.tag.startsWith(f.tag) ? 1 : 0;
}

/** The SQL where for a link reading against one source. Values are alnum-only by construction (regex-matched above), so nothing here can carry quotes. The server only narrows by map and parcel;
 *  the letters are settled client-side by `linkMatch` (they sit in two differently-padded columns). */
export function linkWhere(src, f, countyId) {
  if (src.statewide) {
    const parcel = `${f.parcel5.slice(0, 3)}.${f.parcel5.slice(3)}`;
    const trimmed = `${+f.parcel5.slice(0, 3)}.${f.parcel5.slice(3)}`;
    const t = f.tag;
    /* letters narrow the scan when typed: two or more start the CMAP; one is the map letter OR a group with no lettered map */
    const cmap = !t ? `CMAP LIKE '${f.map}%'` : t.length === 1 ? `(CMAP LIKE '${f.map}${t}%' OR UPPER(GP)='${t}')` : `CMAP LIKE '${f.map}${t[0]}%'`;
    const w = [cmap, `(PARCEL='${parcel}' OR PARCEL='${trimmed}')`];
    if (countyId) w.push(`COUNTY_ID=${countyId}`);
    return w.join(" AND ");
  }
  /* anchored at the map (a county-prefixed link like "033066    01800" has three characters before it, an unprefixed one none) with the typed letters in order between the map and the parcel — a bare map%parcel
   * matches every lettered map of that number and the 50-row answer can miss the one asked for */
  const letters = f.tag ? `%${f.tag.split("").join("%")}` : "";
  return `UPPER(${src.linkField}) LIKE '${src.prefixed ? "___" : ""}${f.map}${letters}%${f.parcel5}'`;
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
    return `${f.map}${f.tag.slice(0, 2)}%${par}`;
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
        const canonical = `${f.map}${f.tag}-${f.parcel5}`;
        plan.push({ county: s.county, name: s.name, kind: "link", value: canonical, canonical, typed: stripIdLabel(body).replace(/[^A-Z0-9]/g, ""), where: linkWhere(s, f, cid), form: f, src: s });
      }
    }
  }
  /* two readings of one string can build the same clause ("073 171.02" is both a control-map and a tax-map reading): ask each distinct question once */
  return plan.filter((p, i) => plan.findIndex((q) => q.county === p.county && q.where === p.where && q.value === p.value) === i);
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
