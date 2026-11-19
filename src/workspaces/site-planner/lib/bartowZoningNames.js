/* Bartow County GA zoning — THE DISTRICT NAME behind a zone code (NEW-1, 2026-11-12; owner constraints #45 / #46 / #50).
 *
 * A code is shown with its district NAME wherever a user sees it (the click card, the legend in the Zoning dropdown). The rules are the owner's:
 *   • names come from the county's OWN ordinance — Bartow County Zoning Ordinance, Sec. 4.1 "Division into Districts" — never from memory;
 *   • a code that is not in that list shows the CODE AS WRITTEN — no invented name, no class word standing in for one;
 *   • the county's map spells a district several ways ("A-1", "A1CU", "A1 (wC)", "R-8 w/c", "BPD"); the base district is parsed out of the code and the suffix is
 *     said separately on the card — "(wC)" / "w/c" = WITH CONDITIONS, "CU" = CONDITIONAL USE — so a conditioned parcel is never presented as the plain district.
 *
 * SOURCE. Bartow County Zoning Ordinance (adopted 2019-09-11, amended through 2020-11-04 in the copy at
 * https://cms2.revize.com/revize/bartowga/ordinance%20updated%20thru%2011-04-20.pdf), Sec. 4.1, read by the dispatching chat 2026-11-01. The build sandbox
 * cannot reach that host (nor any text mirror of it), so this file was NOT re-read against the PDF on 2026-11-12, and a NEWER edition was NOT looked for: the county
 * updates its ordinance and publishes a newer "Zoning and Development Essentials" (2024) guide beside it. The citation below says "amended through November 4, 2020";
 * re-check a name against the current edition before relying on it for a rezoning. Names are exactly Sec. 4.1's wording plus the word "District"; where the ordinance
 * annotates a district in parentheses (R-2 duplex-quadraplex, R-3 multi-family, R-4 including manufactured housing) the annotation is kept as the ordinance wrote it.
 *
 * THE COUNTY'S "BPD" IS THE ORDINANCE'S "BP" (Business Park) — the county's GIS writes the code BPD, the ordinance's Sec. 4.1 lists BP; both resolve to the same row.
 *
 * NOT IN THE ORDINANCE LIST, so they stay bare: R-5 (no such district in Sec. 4.1), any code the county's map carries that does not parse to a Sec. 4.1 district, an empty code.
 * "Incorporated" is the county's marker for ground inside a city (Cartersville, Adairsville, Emerson… zone themselves) — it is not a district.
 *
 * Pure: no network, no React. */

export const BARTOW_ORDINANCE_URL = "https://cms2.revize.com/revize/bartowga/ordinance%20updated%20thru%2011-04-20.pdf";
export const BARTOW_ORDINANCE_CITATION = "Bartow County Zoning Ordinance, Sec. 4.1 (Division into Districts) — the edition amended through November 4, 2020; the county amends it from time to time, so confirm a district against the current ordinance.";

/* base district → { name, cls } — `cls` is the colour class (georgiaLayers BARTOW_COLORS). Names: Sec. 4.1. */
export const BARTOW_ZONING_NAMES = {
  "A-1": { name: "Agricultural District", cls: "agricultural" },
  "RE-1": { name: "Rural Estate District", cls: "residential" },
  "RE-2": { name: "Rural Estate District", cls: "residential" },
  "R-1": { name: "Residential District", cls: "residential" },
  "R-2": { name: "Residential District (duplex to quadraplex)", cls: "residential" },
  "R-3": { name: "Residential District (multi-family)", cls: "residential" },
  "R-4": { name: "Residential District (including manufactured housing)", cls: "residential" },
  "R-6": { name: "Manufactured Housing Park District", cls: "residential" },
  "R-7": { name: "Residential High-Density Multi-Family District", cls: "residential" },
  "R-8": { name: "Residential High-Density Single-Family District", cls: "residential" },
  "O/I": { name: "Office and Institutional District", cls: "commercial" },
  "C-N": { name: "Neighborhood Business District", cls: "commercial" },
  "C-1": { name: "General Business District", cls: "commercial" },
  "I-1": { name: "General Industrial District", cls: "industrial" },
  "I-2": { name: "Heavy Industrial District", cls: "industrial" },
  "M-1": { name: "Mining District", cls: "industrial" },
  PUD: { name: "Planned Unit Development District", cls: "planned" },
  BP: { name: "Business Park District", cls: "businessPark" },
};

/* What each suffix on the county's code means, said plainly on the card. */
export const MODIFIER_WORDS = {
  wc: "with conditions",
  cu: "conditional use",
};

/* The county's spelling → the Sec. 4.1 base district (compact form, no spaces / hyphens). */
const BASE_BY_COMPACT = {
  A1: "A-1", RE1: "RE-1", RE2: "RE-2", R1: "R-1", R2: "R-2", R3: "R-3", R4: "R-4", R6: "R-6", R7: "R-7", R8: "R-8",
  "O/I": "O/I", OI: "O/I", CN: "C-N", C1: "C-1", I1: "I-1", I2: "I-2", M1: "M-1", PUD: "PUD", BP: "BP", BPD: "BP",
};

/* One county code → { raw, city, base, mod, name, cls }.
 *  city  — the county's own "Incorporated" marker
 *  base  — the Sec. 4.1 district it parses to, or null (→ show the code as written)
 *  mod   — "wc" | "cu" | null */
export function parseBartowCode(code) {
  const raw = String(code == null ? "" : code).trim();
  const out = { raw, city: false, base: null, mod: null, name: null, cls: "other" };
  if (!raw) return out;
  if (/^incorporated$/i.test(raw)) return { ...out, city: true, cls: "city" };
  let s = raw.toUpperCase(), mod = null;
  if (/\(\s*WC\s*\)|\bW\/C\b/.test(s)) { mod = "wc"; s = s.replace(/\(\s*WC\s*\)/g, "").replace(/\bW\/C\b/g, ""); }
  s = s.replace(/[\s-]/g, "");
  if (/^[A-Z/]+\d?CU$/.test(s) || /^PUDCU$/.test(s)) { mod = mod || "cu"; s = s.replace(/CU$/, ""); }
  const base = BASE_BY_COMPACT[s] || null;
  const hit = base ? BARTOW_ZONING_NAMES[base] : null;
  if (!hit) return { ...out, mod };
  return { ...out, base, mod, name: hit.name, cls: hit.cls };
}

/* The district NAME for a county code, or null (→ the bare code). */
export const bartowZoneName = (code) => parseBartowCode(code).name;

/* "I-2 — Heavy Industrial District" when sourced, else null. (The card title.) */
export function bartowZoneTitle(code) {
  const p = parseBartowCode(code);
  return p.base && p.name ? `${p.base} — ${p.name}` : null;
}

/* What a suffix on the county's code means, or "" — "A1CU" → the conditional-use sentence. */
export const bartowModifierWords = (code) => { const m = parseBartowCode(code).mod; return m ? MODIFIER_WORDS[m] : ""; };

/* The Zoning dropdown legend for the codes in view, in the headed shape the dropdown renders (owner constraint #50): ONE heading naming the government, then ONE row per
 * district — "I-2 · Heavy Industrial District". The county's spellings of one district (I-2, I2 (wC), I2CU) FOLD into that district's row; a code that parses to no Sec. 4.1
 * district is listed as written; land the county marks Incorporated is one row saying the city zones it. `items` = [{ code, color }] (the colour the polygon is drawn in).
 * Order: the districts in ordinance order, then unparsed codes by name, then Incorporated. Pure. */
export function bartowLegend(items) {
  const rows = new Map();
  const order = Object.keys(BARTOW_ZONING_NAMES);
  for (const it of items || []) {
    const p = parseBartowCode(it && it.code);
    if (!p.raw) continue;
    const key = p.city ? "~city" : p.base || `?${p.raw.toUpperCase()}`;
    if (rows.has(key)) continue;
    const label = p.city ? "Incorporated · the city zones it" : p.base ? `${p.base} · ${p.name}` : p.raw;
    rows.set(key, { key, label, color: it.color, rank: p.city ? 1e6 : p.base ? order.indexOf(p.base) : 5e5, sort: p.raw });
  }
  if (!rows.size) return [];
  const sorted = [...rows.values()].sort((a, b) => a.rank - b.rank || a.sort.localeCompare(b.sort, undefined, { numeric: true }));
  return [{ heading: true, label: "Bartow County" }, ...sorted.map((r) => ({ label: r.label, color: r.color, row: true }))];
}
