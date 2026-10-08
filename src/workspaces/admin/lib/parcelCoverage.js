/* Admin parcel-coverage map — the PURE join (NEW-1). No DOM, no network, no module state.
 *
 * ONE SOURCE OF TRUTH: "wired" is decided here by asking the SAME registry the app routes a parcel
 * click with — COUNTIES_MAP / COUNTIES (counties.js), `countyKeyForName` (the one name→key rule,
 * Louisiana parish / Alaska borough / Virginia independent-city handling included) and
 * `statewideKeysForState` (a state whose only source is a statewide composite). Those are handed in
 * as `deps` (the section passes the live ones; the unit test passes the live ones too), so there is
 * no second copy of the registry and no list to keep in step: the day a county is wired it is wired
 * here. The decision mirrors `countyIdentity` — the app's own "does Planyr have a source for this
 * county" answer — rather than re-deriving it.
 *
 * SOURCE KIND IS DATA, NOT AN INFERENCE FROM PROSE (NEW-1 — owner-found: Calcasieu and Jefferson
 * Parish read "Third-party copy" because their notes name the Westwood copy they SUPERSEDE, and a
 * regex cannot tell "is a Westwood copy" from "replaced a Westwood copy"). Every provenance record in
 * countiesProvenance.js carries `publisher` ("own" | "statewide" | "third-party" | "unverified") and
 * `publisherName`; this file reads those and nothing else — there is no regex and no fallback.
 *   own         — the jurisdiction itself, its assessor / appraisal district, or a vendor / regional
 *                 commission hosting the layer on its behalf.
 *   statewide   — a state's own composite (Idaho, Florida, Colorado slices).
 *   third-party — a firm's, researcher's, individual's or other agency's REPUBLICATION.
 *   unverified  — the record says honestly that who publishes it was not established (shown as
 *                 "Unclassified"); never guessed into one of the others.
 * Registry-structural statewide (a derived Texas county, a layer URL that IS a statewide composite)
 * stays structural: that is the registry's own flag, not prose. A wired entry whose record lacks a valid
 * `publisher` is reported "unclassified" here and FAILS test/parcelCoverage.test.js, so a wiring
 * session cannot skip it.
 */

export const SOURCE_KINDS = ["own", "statewide", "third-party", "unclassified"];
export const PUBLISHERS = ["own", "statewide", "third-party", "unverified"];

export const SOURCE_KIND_LABEL = {
  own: "County's own server",
  statewide: "Statewide layer",
  "third-party": "Third-party copy",
  unclassified: "Unclassified",
};

export const hostOf = (url) => {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(url || "").trim());
  return m ? m[1].toLowerCase() : null;
};

/** The source kind of ONE registry entry, read from the provenance record's `publisher` field. */
export function classifySourceKind({ entry, cfg, prov, isStatewideUrl }) {
  const url = (entry && (entry.layerUrl || entry.mapServer)) || (cfg && cfg.layerUrl) || "";
  if ((entry && entry.statewideDerived) || (cfg && cfg.statewideDerived) || isStatewideUrl(url)) return "statewide";
  const p = prov && prov.publisher;
  if (p === "own" || p === "statewide" || p === "third-party") return p;
  return "unclassified"; // "unverified", or a record that lacks the field (the test fails on that)
}

/** Who publishes it, for the hover line; null when the registry alone says (structural statewide). */
export const publisherNameOf = (prov) => (prov && typeof prov.publisherName === "string" && prov.publisherName) || null;

/* The asset's bare names ("Harris", "Adams", "Alachua") need " County"; every other state's name
 * already carries its designation ("Orleans Parish", "Denali Borough", "Fairfax city"). */
const DESIGNATED_RE = /\b(county|parish|borough|census area|municipality|city|planning region|district of columbia)\b/i;
export const countyDisplayName = (name, state) =>
  `${DESIGNATED_RE.test(name) ? name : `${name} County`}, ${state}`;

/**
 * Join the polygon roster onto the registry.
 *
 * @param roster  [{ state, name, fips }] — the county-polygons asset's own rows
 * @param deps    { countiesMap, counties, keyForName, statewideKeysForState, isStatewideUrl, verification }
 * @returns {{
 *   rows: Array<{ index, state, name, fips, displayName, wired, kind, key, host, publisherName }>,
 *   notDrawn: string[],        // literal registry keys no polygon joined to (LOUD, never dropped)
 *   ambiguous: Array<{key, rows}>, // one key claimed by 2+ polygons (never expected — surfaced)
 *   totals: { counties, byKind, states }
 * }}
 */
export function buildCoverage(roster, deps) {
  const { countiesMap, counties, keyForName, statewideKeysForState, isStatewideUrl, verification } = deps;
  const claimed = new Map(); // registry key → [row index]
  const rows = roster.map((c, index) => {
    const base = { index, state: c.state, name: c.name, fips: c.fips || "", displayName: countyDisplayName(c.name, c.state) };
    const key = keyForName(c.name, c.state);
    const entry = key ? countiesMap[key] : null;
    if (entry && !entry.statewide) {
      if (!claimed.has(key)) claimed.set(key, []);
      claimed.get(key).push(index);
      const kind = classifySourceKind({ entry, cfg: counties[key], prov: verification[key], isStatewideUrl });
      return { ...base, wired: true, kind, key, host: hostOf(entry.layerUrl || entry.mapServer), publisherName: publisherNameOf(verification[key]) };
    }
    // No per-county entry: covered only if the state's one parcel source is a statewide composite.
    // Texas is excluded exactly as `countyIdentity` excludes it (its composite is the derived tier).
    const sw = c.state === "TX" ? [] : statewideKeysForState(c.state);
    if (sw.length) return { ...base, wired: true, kind: "statewide", key: sw[0], host: hostOf(countiesMap[sw[0]].layerUrl), publisherName: publisherNameOf(verification[sw[0]]) };
    return { ...base, wired: false, kind: null, key: null, host: null, publisherName: null };
  });

  const literal = Object.keys(countiesMap).filter((k) => !countiesMap[k].statewide);
  const notDrawn = literal.filter((k) => !claimed.has(k));
  const ambiguous = [...claimed].filter(([, idx]) => idx.length > 1).map(([key, idx]) => ({ key, rows: idx }));

  const byKind = Object.fromEntries(SOURCE_KINDS.map((k) => [k, 0]));
  const stateSet = new Set();
  let wired = 0;
  for (const r of rows) {
    if (!r.wired) continue;
    wired += 1;
    byKind[r.kind] += 1;
    stateSet.add(r.state);
  }
  return { rows, notDrawn, ambiguous, totals: { counties: wired, byKind, states: stateSet.size } };
}

/** The one-line total above the map. Unclassified is named only when there is some. */
export function totalLine(totals) {
  const { counties, byKind, states } = totals;
  const parts = [
    `${byKind.own} on the county's own server`,
    `${byKind.statewide} on a statewide layer`,
    `${byKind["third-party"]} on a third-party copy`,
  ];
  if (byKind.unclassified) parts.push(`${byKind.unclassified} unclassified`);
  return `${counties.toLocaleString("en-US")} counties wired — ${parts.join(" · ")} — in ${states} states.`;
}
