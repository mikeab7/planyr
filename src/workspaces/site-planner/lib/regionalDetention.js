/* NEW-C2 — REGIONAL DETENTION / FEE-IN-LIEU registry + the on-site-vs-fee comparison.
 *
 * Where a district lets a developer buy into a regional detention facility (or pay a fee in
 * lieu of building on-site detention), that can free the pond's land-take back to buildable
 * ground — a real deal lever. This is a CITED config registry (manual data per the owner's
 * scope note — no scraping): per-district entries stating whether such a program exists, its
 * fee basis, and its citation + verify flag. When a program is available, feeInLieuCompare
 * quantifies the trade: fee cost + avoided on-site pond earthwork VS the buildable SF recovered.
 *
 * Screening only — programs, eligibility, and fees change; confirm with the district. Every
 * value carries provenance + a verify flag. LOUD-FAILURE: an unknown/absent program is stated
 * plainly, never assumed available. Pure + Node-testable; no DOM/network. */

const SQFT_PER_ACRE = 43560;

/* Keyed by detention AUTHORITY id (matching detentionRules.js). `available` is tri-state:
 * true (a program exists), false (confirmed none), null (unknown — verify). Fee rates that
 * aren't published are null (never fabricated). */
export const REGIONAL_DETENTION = {
  hcfcd: {
    key: "hcfcd",
    authorityLabel: "Harris County Flood Control District",
    available: true,
    scope: "limited",
    program: "Fee-in-lieu of on-site detention (small projects) + HCFCD regional stormwater detention basins in select watersheds",
    feeBasis: "per ac-ft of required detention (project-specific) — small-project fee-in-lieu is capped by size",
    feeRatePerAcFt: null, // project/watershed-specific — confirm with HCFCD/HCED
    eligibilityNote: "HCED §2.15.12 limits fee-in-lieu of on-site detention to ≤1-ac projects; larger tracts may buy into a regional basin only where one serves the watershed.",
    citation: { name: "HCED Infrastructure Regulations §2.15.12 + HCFCD regional detention program", url: "https://www.hcfcd.org/" },
    verified: false,
  },
  fortbend: {
    key: "fortbend",
    authorityLabel: "Fort Bend County Drainage District",
    available: false,
    scope: "none",
    program: "No fee-in-lieu-of-detention program found in the FBCDD DCM",
    feeBasis: null,
    feeRatePerAcFt: null,
    eligibilityNote: "The FBCDD DCM requires on-site detention; no fee-in-lieu program is published. LID/MUD-level regional facilities may exist locally — confirm.",
    citation: { name: "FBCDD Drainage Criteria Manual, Ch. 6", url: "https://www.fortbendcountytx.gov/" },
    verified: false,
  },
  coh: {
    key: "coh",
    authorityLabel: "City of Houston",
    available: null,
    scope: "unknown",
    program: "Verify current City stormwater / regional-detention participation options",
    feeBasis: null,
    feeRatePerAcFt: null,
    eligibilityNote: "Confirm whether the City's IDM Ch. 9 permits a regional/off-site detention option for this watershed.",
    citation: { name: "City of Houston IDM Ch. 9", url: "https://www.houstonpermittingcenter.org/" },
    verified: false,
  },
};

/* Entries for a resolved authority id (or null when none modeled). Pure. */
export function regionalDetentionFor(authorityId) {
  return REGIONAL_DETENTION[authorityId] || null;
}

/* The on-site-vs-fee-in-lieu comparison. Inputs:
 *   pondLandTakeAc  — the land the on-site pond takes (water footprint + maintenance berm)
 *   requiredAcFt    — the required detention volume (drives the fee, when fee is per ac-ft)
 *   feeRatePerAcFt  — the district's fee rate ($/ac-ft), or null (unknown → cost side omitted)
 *   coverageRatio   — buildable coverage of the recovered land (screening default 0.40 industrial)
 *   onsitePondCost  — the on-site pond earthwork $ that fee-in-lieu AVOIDS (optional)
 *   landValuePerAc  — $/ac of the recovered land (optional, for a land-value line)
 * Returns { landRecoveredAc, buildableSfRecovered, feeCost, avoidedOnsiteCost, landValueRecovered,
 *           flags } — never fabricates a fee when the rate is unknown. Pure. */
export function feeInLieuCompare({ pondLandTakeAc = null, requiredAcFt = null, feeRatePerAcFt = null, coverageRatio = 0.4, onsitePondCost = null, landValuePerAc = null } = {}) {
  const flags = [];
  const land = num(pondLandTakeAc);
  if (land == null || land <= 0) return { landRecoveredAc: null, buildableSfRecovered: null, feeCost: null, avoidedOnsiteCost: num(onsitePondCost), landValueRecovered: null, flags: ["no-pond-land-take"] };
  const cov = num(coverageRatio) ?? 0.4;
  const buildableSfRecovered = Math.round(land * SQFT_PER_ACRE * cov);
  const rate = num(feeRatePerAcFt);
  const vol = num(requiredAcFt);
  let feeCost = null;
  if (rate != null && vol != null) feeCost = Math.round(rate * vol);
  else flags.push(rate == null ? "fee-rate-unknown" : "required-volume-unknown");
  const landValueRecovered = num(landValuePerAc) != null ? Math.round(num(landValuePerAc) * land) : null;
  return {
    landRecoveredAc: Math.round(land * 1000) / 1000,
    buildableSfRecovered,
    coverageRatio: cov,
    feeCost,
    avoidedOnsiteCost: num(onsitePondCost),
    landValueRecovered,
    flags,
    caveat: "Screening comparison — fee, eligibility and coverage vary; confirm the program with the district and your broker/GC.",
  };
}

/* Registry audit. Pure. */
export function problems(reg = REGIONAL_DETENTION) {
  const out = [];
  for (const [key, e] of Object.entries(reg)) {
    if (e.key !== key) out.push(`${key}: key mismatch`);
    if (!e.authorityLabel) out.push(`${key}: authorityLabel required`);
    if (![true, false, null].includes(e.available)) out.push(`${key}: available must be true/false/null`);
    if (!e.citation || !/^https:\/\//.test(e.citation.url || "")) out.push(`${key}: citation.url must be https://`);
    if (e.feeRatePerAcFt != null && !Number.isFinite(e.feeRatePerAcFt)) out.push(`${key}: feeRatePerAcFt must be a number or null`);
  }
  return out;
}

const num = (v) => (Number.isFinite(v) ? v : null);
