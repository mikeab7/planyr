/* CCN (Certificate of Convenience & Necessity) screening classifier — public-data
 * screening PHASE 1. Pure, unit-tested; the interpretation half of the ccnWater /
 * ccnSewer registry sources (endpoints live in shared/gis/sources.js).
 *
 * A CCN is the PUC of Texas retail monopoly to provide water or sewer inside a bounded
 * area. The two questions this answers for a site:
 *   1) WHO holds the certificate to serve it — and what KIND of provider is it
 *      (a city, a MUD, a Water Supply Corporation, a private utility …). The source has
 *      NO field for the utility kind, so it is inferred from the UTILITY name string.
 *   2) If NO polygon covers the site — there is no certificated provider: the site is
 *      likely city-served, or needs a well / septic / on-site treatment, or a new-CCN
 *      petition. That "none" is a screening FLAG worth surfacing, never a green all-clear.
 *
 * Screening only — the STATUS field distinguishes an approved certificate from one still
 * in a pending docket; confirm with the utility and the PUC.
 */

// Utility-kind inference from the UTILITY name. ORDER MATTERS — the first pattern that
// matches wins, so the specific district acronyms are tested before the generic
// "…DISTRICT" / company fallbacks. Each entry: a matcher + a short kind + a plain label.
export const CCN_UTILITY_TYPES = [
  { kind: "city", label: "a city", re: /\bCITY OF\b|\bTOWN OF\b|\bVILLAGE OF\b/i },
  { kind: "mud", label: "a MUD (municipal utility district)", re: /\bM\.?\s?U\.?\s?D\b|MUNICIPAL UTILITY DIST/i },
  { kind: "wcid", label: "a WCID (water control & improvement district)", re: /\bW\.?\s?C\.?\s?I\.?\s?D\b|WATER CONTROL/i },
  { kind: "fwsd", label: "an FWSD (fresh water supply district)", re: /\bF\.?\s?W\.?\s?S\.?\s?D\b|FRESH WATER SUPPLY/i },
  { kind: "sud", label: "a SUD (special utility district)", re: /\bS\.?\s?U\.?\s?D\b|SPECIAL UTILITY DIST/i },
  { kind: "wsc", label: "a WSC (water supply corporation)", re: /\bW\.?\s?S\.?\s?C\b|WATER SUPPLY CORP/i },
  { kind: "wid", label: "a water improvement district", re: /\bW\.?\s?I\.?\s?D\b|WATER IMPROVEMENT DIST/i },
  { kind: "ud", label: "a utility district", re: /\bP\.?\s?U\.?\s?D\b|\bUTILITY DIST/i },
  { kind: "district", label: "a water/utility district", re: /\bDISTRICT\b/i },
  { kind: "investor", label: "a private utility", re: /\b(?:L\.?L\.?C|L\.?P|INC|CORP(?:ORATION)?|COMPANY|CO|UTILITIES|WATER CO|WSC)\b/i },
];

/* Infer the utility KIND from a provider name → { kind, label }. Never throws; an
 * empty / unrecognized name resolves to the honest "other" kind. Pure. */
export function inferUtilityType(name) {
  const s = String(name == null ? "" : name).trim();
  if (!s) return { kind: "other", label: "a utility" };
  for (const t of CCN_UTILITY_TYPES) if (t.re.test(s)) return { kind: t.kind, label: t.label };
  return { kind: "other", label: "a utility" };
}

// A single holder as a display string: "NORTHWEST HARRIS COUNTY MUD 25 (a MUD …)".
export function describeHolder(name) {
  const nm = String(name == null ? "" : name).trim() || "Unnamed utility";
  return `${nm} (${inferUtilityType(nm).label})`;
}

// Distinct, non-empty UTILITY names from the fetched rows (a site can straddle CCNs).
export function ccnHolders(rows = []) {
  const seen = [];
  if (!Array.isArray(rows)) return seen;
  for (const r of rows) {
    const nm = r && r.UTILITY != null ? String(r.UTILITY).trim() : "";
    if (nm && !seen.includes(nm)) seen.push(nm);
  }
  return seen;
}

// Is any holder's certificate still in a pending PUC docket (not yet approved)? The STATUS
// field reads e.g. "Commission Approved" vs "Pending Final Order Docket No. 53459".
const isPending = (r) => /pending|docket|proposed|application/i.test(String(r && r.STATUS != null ? r.STATUS : ""));

/* Classify a CCN result into a finding (pure). CCN is a FACT, not a good/bad constraint,
 * so both outcomes are `info`:
 *   • holders present → "Served by <utility> (<kind>)" (+ a pending-docket note, + straddle)
 *   • none present    → "No certificated <service> provider" — a well/septic/new-CCN flag,
 *                       hedged for a REGIONAL source (empty may mean out-of-coverage, not none).
 * `opts.service` is "water" | "sewer"; `opts.regional` true softens the empty message for a
 * source whose coverage doesn't span the whole state (the sewer CCN). */
export function classifyCcn(rows, { service = "water", regional = false } = {}) {
  const svc = service === "sewer" ? "sewer" : "water";
  const list = Array.isArray(rows) ? rows : [];
  const holders = ccnHolders(list);

  if (!holders.length) {
    const base = svc === "water"
      ? "No certificated water provider on file — the site is likely city-served, or a well / new CCN is needed."
      : "No certificated sewer provider on file — the site likely needs septic / on-site treatment, or a new CCN.";
    const summary = regional
      ? base + " (Sewer CCN coverage is the Houston region — a site outside it reads as none; confirm.)"
      : base + " Confirm with the utility and the PUC.";
    return { status: "info", summary, detail: [] };
  }

  const pending = list.filter(isPending).length > 0;
  let summary;
  if (holders.length === 1) {
    summary = `${svc === "water" ? "Water" : "Sewer"} service: ${describeHolder(holders[0])}`;
  } else {
    summary = `${holders.length} certificated ${svc} providers (site straddles CCN boundaries): ` +
      holders.slice(0, 3).map((h) => String(h)).join(", ") + (holders.length > 3 ? "…" : "");
  }
  if (pending) summary += " — one or more certificates are still in a pending PUC docket (not yet final).";

  const detail = holders.slice(0, 8).map((h) => {
    const row = list.find((r) => r && String(r.UTILITY).trim() === h) || {};
    const st = row.STATUS ? ` — ${String(row.STATUS).trim()}` : "";
    const no = row.CCN_NO ? ` · CCN ${String(row.CCN_NO).trim()}` : "";
    return `${describeHolder(h)}${st}${no}`;
  });
  return { status: "info", summary, detail };
}
