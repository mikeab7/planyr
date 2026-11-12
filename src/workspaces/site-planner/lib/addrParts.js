/* The DECLARED per-county situs shape — a leaf module (no imports) so `appraisal.js` (the card), `parcelQuery.js` (the
 * search) and the nightly registry health check can all read ONE declaration without a cycle.
 *
 * Some CAD layers split the street address across columns (HCAD: number · prefix · name · suffix · direction · city;
 * Chambers CCAD: Prop_Street_Number / _Dir / Prop_Street / _Suffix / Prop_City; Bartow: HOUSE_NO + STREET_NAM). A
 * county row says which column plays which role:
 *
 *   addrParts: { num, dir, name, sfx, postDir, city, zip }       (every value is a BARE column name; `name` is required)
 *
 *   num      the house number            (0 / null / blank = none, omitted)
 *   dir      a directional BEFORE the street name ("N")
 *   name     the street name             (required — a record with no name has no composed address)
 *   sfx      the street type ("RD")      (not appended again when the name already ends with it: CCAD bakes "FM 565 RD" into the name on some rows)
 *   postDir  a directional AFTER the type ("W")
 *   city     the situs city              (appended after a comma)
 *   zip      the situs ZIP               (appended after the city, or after a comma when there is no city)
 *
 * The ONE composer for the card is `appraisal.composeSitus`; the ONE where-builder for the search is
 * `parcelQuery.buildParcelWhere` (its `addrParts` argument). A column named here is matched on its LEAF name, case-blind,
 * because a joined layer publishes table-prefixed names ("ChambersCADWeb.DBO.Accounts.Prop_Street_Number"). */

export const ADDR_PART_ROLES = ["num", "dir", "name", "sfx", "postDir", "city", "zip"];

/** The last dotted segment of a column name. */
export const leafOf = (k) => String(k ?? "").replace(/^.*\./, "");

/** The first key (of `keys`) whose leaf equals the declared bare column name, case-blind; null when none. */
export function findColumn(keys, bare) {
  if (!bare) return null;
  const want = String(bare).toLowerCase();
  for (const k of keys || []) if (leafOf(k).toLowerCase() === want) return k;
  return null;
}

/** Is this a usable declaration? A plain object whose `name` role is set. */
export const hasAddrParts = (parts) => !!(parts && typeof parts === "object" && parts.name);

/** Every column a county row declares (id, address hint, each address role) as `[{ kind, name }]` — what the nightly health
 *  check holds against the live layer's field list. Pure. */
export function declaredColumns(cfg) {
  const out = [];
  if (!cfg) return out;
  if (cfg.idField) out.push({ kind: "idField", name: cfg.idField });
  if (cfg.addrField) out.push({ kind: "addrField", name: cfg.addrField });
  if (cfg.addrParts) for (const role of ADDR_PART_ROLES) if (cfg.addrParts[role]) out.push({ kind: `addrParts.${role}`, name: cfg.addrParts[role] });
  return out;
}

/** The declared columns that the live layer's field names do NOT carry (leaf match, case-blind). `[]` = the declaration is
 *  intact. A layer with no readable field list returns `[]` — an unreadable list is the sweep's own "unreachable", not this check's. */
export function missingDeclaredColumns(cfg, fieldNames) {
  if (!Array.isArray(fieldNames) || !fieldNames.length) return [];
  return declaredColumns(cfg).filter((c) => !findColumn(fieldNames, c.name));
}
