/* Metro Nashville & Davidson County — district NAMES for the zoning codes (NEW-1, 2026-11-12; owner constraint #46).
 *
 * #46: a zoning code shows its district NAME wherever the code is shown, sourced from that jurisdiction's own ordinance — NEVER from memory; a code that cannot be sourced shows the BARE CODE.
 *
 * SOURCE: the Metropolitan Code of Laws, Title 17 (Zoning), Chapter 17.08, § 17.08.010 "Zoning districts established" (library.municode.com/tn/metro_government_of_nashville_and_davidson_county).
 * Metro's zoning layer carries the CODE only (ZONE_DESC; its coded-value domain repeats the codes as the names — measured 2026-11-12), so a name has to come from the ordinance.
 *
 * ⛔ WHAT IS AND IS NOT IN THIS TABLE — stated plainly, because the item asked for a name for every legend code and this table does not have one:
 *   · Municode (library.municode.com), Metro's own sites (nashville.gov, legisarchive.nashville.gov) and the elaws.us mirror of Title 17 are all OUTSIDE the network the session that wrote this
 *     could reach (every fetch failed to resolve / CONNECT 403, 2026-11-12). The ONLY text of § 17.08.010 that session could read was a search excerpt of the code that listed the
 *     industrial group verbatim — "IWD Industrial Warehousing/Distribution · IR Industrial Restrictive · IG Industrial General" — so those three are the whole table.
 *   · Every other code (the agricultural, residential, mixed-use, office, commercial, shopping-center, downtown, specific-plan and "-A" / "-NS" variants) is DELIBERATELY absent and renders as its bare
 *     code. Third-party zoning sites list names for them; a third-party copy is not the ordinance and was not used.
 *   · Adding a name is a one-line data change here plus the code in the test's pinned domain list — nothing else reads the words. The follow-up item names the blocker (the ordinance host) and the fix
 *     (read § 17.08.010 where it is reachable, key each district by the exact code Metro's layer uses, keep the citation). */

export const NASH_ZONING_CITATION = "Metropolitan Code of Laws, Title 17 (Zoning), § 17.08.010 — Zoning districts established";

export const NASH_ZONE_NAMES = Object.freeze({
  IWD: "Industrial Warehousing/Distribution",
  IR: "Industrial Restrictive",
  IG: "Industrial General",
});

/* The ordinance name for a code exactly as Metro's layer spells it, or null (the caller shows the bare code). */
export const nashZoneName = (code) => {
  const c = String(code == null ? "" : code).trim();
  return Object.prototype.hasOwnProperty.call(NASH_ZONE_NAMES, c) ? NASH_ZONE_NAMES[c] : null;
};
