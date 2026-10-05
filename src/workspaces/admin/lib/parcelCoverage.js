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
 * SOURCE KIND, and why it is not a registry field. The registry says WHERE a parcel layer lives, not
 * WHO publishes it; that lives only as prose in countiesProvenance.js. So:
 *   statewide   — structural (a derived Texas county, a layer URL that is a statewide composite, a
 *                 `scopeWhere` slice of a shared layer that is not third-party, or a state with no
 *                 per-county entry at all).
 *   third-party — the provenance prose positively names a republisher (Westwood/CSRS, DesireLine,
 *                 Regrid schema, "republication", "rehost"); a sentence that DENIES it ("not a
 *                 republication", "rejected") is not counted.
 *   own         — a non-aggregator host (the county / state's own server), or an ArcGIS Online host
 *                 whose provenance positively says it is the county's own.
 *   unclassified— everything else. Never guessed into one of the three.
 */

export const SOURCE_KINDS = ["own", "statewide", "third-party", "unclassified"];

export const SOURCE_KIND_LABEL = {
  own: "County's own server",
  statewide: "Statewide layer",
  "third-party": "Third-party copy",
  unclassified: "Unclassified",
};

const THIRD_PARTY_RE = /westwood|csrs|desireline|regrid|loveland|third-party (nationwide|parcel|copy|rehost|republic|mirror)|republication|rehost/i;
const DENIED_RE = /(not|isn't|never) (a |an )?(third-party|republication|rehost|mirror)|reject/i;
const OWN_RE = /\b(own (gis|org|host|server|service|layer|arcgis|data)|county's own|parish's own|county-owned|parish-owned|authoritative|official)\b/i;
/* Generic hosting, where the host alone says nothing about who published the layer. */
const AGGREGATOR_HOST_RE = /(^|\.)(arcgis\.com|arcgisonline\.com)$/i;

export const hostOf = (url) => {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(url || "").trim());
  return m ? m[1].toLowerCase() : null;
};

/** True when the provenance prose positively labels the source as a third-party republication. */
export function provenanceSaysThirdParty(prov) {
  const text = `${(prov && prov.verifiedNote) || ""} ${(prov && prov.candidateProvenance) || ""}`;
  return text.split(/(?<=[.;])\s+/).some((s) => THIRD_PARTY_RE.test(s) && !DENIED_RE.test(s));
}

function provenanceSaysOwn(prov) {
  const text = `${(prov && prov.verifiedNote) || ""} ${(prov && prov.candidateProvenance) || ""}`;
  return text.split(/(?<=[.;])\s+/).some((s) => OWN_RE.test(s) && !THIRD_PARTY_RE.test(s));
}

/** The source kind of ONE registry entry. `entry` is the COUNTIES_MAP shape, `cfg` the COUNTIES shape. */
export function classifySourceKind({ entry, cfg, prov, isStatewideUrl }) {
  const url = (entry && (entry.layerUrl || entry.mapServer)) || (cfg && cfg.layerUrl) || "";
  if ((entry && entry.statewideDerived) || (cfg && cfg.statewideDerived) || isStatewideUrl(url)) return "statewide";
  // Third-party BEFORE the scope test: Lafayette Parish is a `scopeWhere` slice of a republisher's
  // multi-parish layer, and what the owner wants to know about it is who publishes it.
  if (provenanceSaysThirdParty(prov)) return "third-party";
  if (cfg && cfg.scopeWhere) return "statewide"; // a county's slice of one shared agency layer (Idaho, …)
  const host = hostOf(url);
  if (host && !AGGREGATOR_HOST_RE.test(host)) return "own";
  if (provenanceSaysOwn(prov)) return "own";
  return "unclassified";
}

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
 *   rows: Array<{ index, state, name, fips, displayName, wired, kind, key, host }>,
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
      return { ...base, wired: true, kind, key, host: hostOf(entry.layerUrl || entry.mapServer) };
    }
    // No per-county entry: covered only if the state's one parcel source is a statewide composite.
    // Texas is excluded exactly as `countyIdentity` excludes it (its composite is the derived tier).
    const sw = c.state === "TX" ? [] : statewideKeysForState(c.state);
    if (sw.length) return { ...base, wired: true, kind: "statewide", key: sw[0], host: hostOf(countiesMap[sw[0]].layerUrl) };
    return { ...base, wired: false, kind: null, key: null, host: null };
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
