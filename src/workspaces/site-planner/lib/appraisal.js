/* County appraisal-district attribute view — shared, pure helpers that turn the
 * raw county GIS attributes (the ones that ride along with a map-identified parcel)
 * into curated, human-labelled rows. Used by BOTH the planner's "Appraisal data"
 * panel (SitePlanner.jsx) and the map finder's address-search parcel info card
 * (MapFinder.jsx), so the two never diverge (B233). No React here — just data.
 */

/* ---- SITUS vs. the OWNER'S MAILING address (NEW-2) ---------------------------------------------
 *
 * A parcel record carries at least two addresses: where the LAND is (the situs) and where the tax
 * bill goes (the owner's mailing address). Everything user-facing — the address-search card's
 * title, the "Situs address" row, the name a new plan is seeded with — means the FIRST one.
 *
 * WHAT WENT WRONG, from the live record (Weld County, CO — site `sms7v3ua7ksy`, owner FORESTAR
 * (USA) REAL ESTATE GROUP INC). The county returns BOTH:
 *     SITUS    : "4050 CR 50   JOHNSTOWN"          ← the land
 *     ADDRESS1 : "2221 E LAMAR BLVD STE 790"       ← Forestar's head office, Arlington TX
 *     CITY/STATE/ZIPCODE: ARLINGTON / TX / 76006…  ← the MAILING city, on a Colorado parcel
 * The old resolver was ONE regex with `situs|…|^addr|address` alternatives, applied by
 * `findAttr` — "the first KEY in object order that matches ANY alternative". `ADDRESS1` matched
 * `address`, came first, and won. The plan was therefore named after the owner's head office, in
 * front of a client, on a site 800 miles away.
 *
 * Note what this was NOT: nothing in `ADDRESS1` says "mail". Excluding a mail/owner/billing key
 * family — the obvious fix — would not have caught this one. The defect is the MISSING PRECEDENCE:
 * with alternation there is no such thing as a preferred field, only whichever column the service
 * happened to list first.
 *
 * THE RULE: an ordered LADDER. Every key is tested against rung 1 before any key is tested against
 * rung 2, so a real situs column always beats a generic one no matter what order the service lists
 * them in. Mailing columns are excluded outright at every rung. When no rung answers, the result is
 * NULL — the caller falls back to what the user searched, never to the owner's address.
 */

/** Keys that are an OWNER / BILLING address by name. Excluded at every rung of the ladder. */
export const MAILING_KEY_RE =
  /(mail|owner_?addr|own_?addr|care_?of|^c_?o$|^c_?o_|billing|bill_?to|remit|correspond|agent_?addr|tax_?addr)/i;

/* Keys that are a NUMBERED address LINE (ADDRESS1 / ADDRESS2 / ADDR_LINE_2 / ADDR2). A line
 * number is the hallmark of a mailing block — a situs column is a single field, never "line 2" —
 * and Weld's `ADDRESS1` is exactly this shape while carrying no "mail" token at all. Excluded from
 * the generic rung only; a key that also says `situs`/`site`/`prop` still matches its own rung. */
export const ADDR_LINE_RE = /^(addr|address|addr_?line|address_?line)_?\d+$/i;

/** The ladder, most specific first. Applied in order across ALL keys — see the note above. */
export const SITUS_LADDER = [
  // 1 — a column that says outright that it is the situs.
  /situs/i,
  // 2 — the land's own address under another name. `prop_?street(?!_)` matches CCAD's Prop_Street
  //     (the situs street NAME) but not its Prop_Street_Number/Dir/Suffix sub-columns.
  /(site_?addr|prop(erty)?_?addr|prop_?street(?!_)|phys(ical)?_?addr|loc(ation)?_?addr|street_?addr|^location$)/i,
  // 3 — the generic catch-all, LAST. Plenty of CADs do name their situs column plainly
  //     ("ADDRESS", "FULL_ADDR"), so dropping this rung would regress them; it is simply no longer
  //     allowed to outrank rungs 1–2, and never sees a mailing key or a numbered line.
  /(full_?addr|^addr$|^address$|^addr_?\d?$|address)/i,
];

/** Union of the ladder's rungs — used only where a single pattern is required (see APPR_FIELDS). */
export const SITUS_FIELD = new RegExp(SITUS_LADDER.map((r) => r.source).join("|"), "i");

/** Is this key an owner-mailing column (by name or by being a numbered line)? Pure. */
const isMailingKey = (key, rung) => MAILING_KEY_RE.test(key) || (rung === 2 && ADDR_LINE_RE.test(key));

/**
 * The KEY holding the parcel's situs address, or null when the record does not carry one.
 * `skip` lets a caller exclude keys another row has already claimed (see `apprRows`). Pure.
 */
export function situsKey(attrs, { skip = null } = {}) {
  if (!attrs) return null;
  const keys = Object.keys(attrs);
  for (let rung = 0; rung < SITUS_LADDER.length; rung++) {
    const re = SITUS_LADDER[rung];
    for (const key of keys) {
      if (skip && skip.has(key)) continue;
      if (isMailingKey(key, rung)) continue;
      if (!re.test(key)) continue;
      const v = attrs[key];
      if (v == null) continue;
      if (String(v).replace(/\s+/g, " ").trim()) return key;
    }
  }
  return null;
}

/**
 * The parcel's SITUS address, or null when the record does not carry one.
 *
 * Never returns an owner-mailing value: a mailing key is excluded at every rung, and the generic
 * rung additionally refuses numbered address lines. Null is a real, useful answer — the callers
 * fall back to what the user typed, which is about the LAND by definition.
 *
 * @param attrs the county's raw attribute bag
 * @returns string | null  (whitespace collapsed — county columns are fixed-width padded)
 */
export function situsAddress(attrs, opts) {
  const k = situsKey(attrs, opts);
  return k ? String(attrs[k]).replace(/\s+/g, " ").trim() : null;
}

/** Every value the record files under a mailing / owner-address key, normalised for comparison. */
export function mailingAddressValues(attrs) {
  const out = new Set();
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === "") continue;
    if (!MAILING_KEY_RE.test(k) && !ADDR_LINE_RE.test(k)) continue;
    const s = String(v).replace(/\s+/g, " ").trim();
    if (s) out.add(s.toUpperCase());
  }
  return out;
}

/**
 * The name a new plan is seeded with from a picked parcel — the SITUS, else what the user actually
 * searched, else the account id, else "Untitled site".
 *
 * The last guard is deliberate belt-and-braces (LOUD-FAILURE's quieter cousin): whatever the
 * candidate is, if it EQUALS a value the record files under a mailing key it is refused and the
 * next fallback is taken. The ladder already prevents that on every schema we have seen; this
 * catches the one we have not.
 *
 * @param attrs      the parcel's attributes (may be null)
 * @param opts.addr  a situs already resolved by the caller (skips re-resolving)
 * @param opts.searched  the address string the user typed / the geocoder's label
 * @param opts.acct  the parcel's account id
 */
export function siteNameFromParcel(attrs, { addr = null, searched = null, acct = null } = {}) {
  const mailed = mailingAddressValues(attrs);
  const clean = (v) => (v == null ? null : String(v).replace(/\s+/g, " ").trim() || null);
  const ok = (v) => v && !mailed.has(v.toUpperCase());
  for (const cand of [clean(addr) || situsAddress(attrs), clean(searched), clean(acct)]) {
    if (ok(cand)) return cand;
  }
  return "Untitled site";
}

// Curated field order: regex that matches a county's column name → the label we show.
// Patterns cover the per-county CAD columns (HCAD / FBCAD / CCAD) AND the statewide TxGIO
// columns (prop_id, owner_name, situs_addr, legal_area/gis_area, land_value, imp_value,
// mkt_value, stat_land_use, year_built) so a parcel answered by any source — a county's
// own CAD or the statewide backup — surfaces the same curated rows (B244/B787).
export const APPR_FIELDS = [
  // ...|owner_?name matches TxGIO owner_name AND CCAD's Owner_Name.
  [/^(owner|own_?name|owner_?name|name|owner1)$/i, "Owner"],
  // The situs row is NOT a plain regex — it is the ordered ladder below (`situsAddress`), because a
  // single alternation plus "first key wins" resolved the OWNER'S MAILING address on real county
  // schemas. `SITUS_FIELD` is the union of the ladder's rungs, kept only so the row still claims its
  // key in `apprRows`' used-key bookkeeping; the VALUE always comes from `situsAddress`.
  [SITUS_FIELD, "Situs address"],
  // ...|parcel_?id matches CCAD's Parcel_Id; |account matches CCAD's Account.
  [/(hcad_?num|^acct|account|parcel_?id|prop_?id|geo_?id|quick_?ref|^pid)/i, "Account / ID"],
  // ...|land_?size_?ac matches FBCAD's LANDSIZEAC (acres) — NOT LANDSIZEFT (square feet);
  // ^acre matches CCAD's Acres.
  [/(gis_?acre|calc_?acre|legal_?acre|^acre|acreage|deed_?acre|legal_?area|gis_?area|land_?size_?ac)/i, "Acreage"],
  [/(land_?val|land_?mkt|land_?value)/i, "Land value"],
  [/(imp_?val|improvement_?val|bld_?val|impr_?val)/i, "Improvement value"],
  // ...|market_?val matches CCAD's Market_Value (and TxGIO mkt_value).
  [/(tot_?val|market_?val|appr_?val|assessed_?val|total_?val|tot_?mkt|mkt_?val|mkt_?value)/i, "Total value"],
  // ...|land_?state_?code matches FBCAD's Land_State_Code; |categor matches CCAD's
  // Primary_Category_Code (the state land-use category code).
  [/(land_?use|state_?use|use_?cd|use_?desc|^class|prop_?type|stat_?land_?use|land_?state_?code|categor)/i, "Land use"],
  [/zoning/i, "Zoning"],
  [/(year_?built|yr_?built)/i, "Year built"],
  // ...|^legal matches CCAD's Legal1–Legal4 (first match, Legal1, wins).
  [/(legal_?desc|^legal|subdiv|abstract|^abst)/i, "Legal"],
];

export const prettyKey = (k) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// The curated subset (only the recognized fields, in APPR_FIELDS order).
export const apprRows = (attrs) => {
  if (!attrs) return [];
  const used = new Set(), rows = [];
  for (const [re, label] of APPR_FIELDS) {
    // The situs row resolves through the ORDERED ladder, never "first key that matches" — that is
    // the whole point of `situsAddress` (a mailing column would otherwise win the row too).
    const k = label === "Situs address"
      ? situsKey(attrs, { skip: used })
      : Object.keys(attrs).find((key) => !used.has(key) && re.test(key) && attrs[key] != null && attrs[key] !== "");
    if (k) { used.add(k); rows.push({ label, value: label === "Situs address" ? String(attrs[k]).replace(/\s+/g, " ").trim() : attrs[k] }); }
  }
  return rows;
};

/* NEW-1 — the address-search parcel card's row split. The card's DEFAULT view is exactly
 * three rows — Owner, Account / ID, Acreage, in that order — because everything else (and
 * the Legal description in particular, an unbounded metes-and-bounds blob that routinely
 * wraps to ten-plus lines) made the card taller than the map controls beside it. The rest
 * of the curated data is NOT dropped: it moves behind the card's collapsed "More details"
 * disclosure. The situs address is the card's TITLE, so it never repeats as a row.
 *
 * Pure + exported so the card's shape is guarded by unit tests rather than by eyeballing
 * a rendered card (see test/parcelCard.test.js). `acct` is the identify hit's own account
 * id and `acres` its MEASURED acreage (computed from the returned ring) — both win over
 * the CAD's own columns when present, which is what the card has always shown. */
export const PARCEL_CARD_PRIMARY_LABELS = ["Owner", "Account / ID", "Acreage"];

export const parcelCardRows = (attrs, { acct = null, acres = null } = {}) => {
  const curated = apprRows(attrs);
  const pick = (label) => curated.find((r) => r.label === label);
  const primary = [];

  const owner = pick("Owner");
  if (owner) primary.push({ label: "Owner", value: apprVal("Owner", owner.value) });

  const cadAcct = pick("Account / ID");
  const acctVal = acct != null && String(acct) !== "" ? String(acct) : (cadAcct ? String(cadAcct.value) : null);
  if (acctVal) primary.push({ label: "Account / ID", value: acctVal });

  const cadAcres = pick("Acreage");
  if (Number.isFinite(acres)) primary.push({ label: "Acreage (measured)", value: `${Number(acres).toFixed(2)} ac` });
  else if (cadAcres) primary.push({ label: "Acreage", value: apprVal("Acreage", cadAcres.value) });

  // Everything curated that the three primary rows (and the title) don't already carry,
  // still in APPR_FIELDS order: Land value → Improvement value → Total value → Land use →
  // Zoning → Year built → Legal.
  const more = curated
    .filter((r) => !/^(situs address|owner|account \/ id|acreage)$/i.test(r.label))
    .map((r) => ({ label: r.label, value: apprVal(r.label, r.value) }));

  return { primary, more };
};

// Everything the county returned (minus geometry/system fields) — the "all fields" expander.
export const apprAll = (attrs) => Object.entries(attrs || {})
  .filter(([k, v]) => v != null && v !== "" && !/^(shape|objectid|globalid|geometry|st_area|st_length|shape_?area|shape_?len)/i.test(k))
  .map(([k, v]) => ({ label: prettyKey(k), value: v }));

// Format a value, adding $ + thousands for the money fields.
export const apprVal = (label, v) => (/value/i.test(label) && v !== "" && !isNaN(+v)) ? `$${(+v).toLocaleString()}` : String(v);

// First attribute whose key matches `re` and has a non-empty value, as a string.
export const findAttr = (attrs, re) => { const k = Object.keys(attrs || {}).find((key) => re.test(key) && attrs[key] != null && attrs[key] !== ""); return k ? String(attrs[k]) : null; };
