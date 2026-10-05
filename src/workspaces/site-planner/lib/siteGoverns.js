/* Site Analysis — "Who governs this site" and "Calls to make" (NEW-1, 2026-10-05). Pure.
 *
 * Both are PLAIN FACTS / PROMPTS, never verdicts: no colour, no severity, no INFO badge. The governing
 * answer is read from the SAME structured badge the header pill reads (`formatJurisdictionBadge`), so
 * the panel and the pill cannot disagree, and nothing here parses a rendered string. Where the plain
 * short form would lose a class the Baytown work insists on keeping (limited-purpose / strip annexation,
 * a disputed or released ETJ, a failed lookup, a Georgia/California county-governs note) the full
 * honest badge text is shown instead — compact only when compact is also complete.
 */

const list = (v) => (Array.isArray(v) ? v.filter((s) => s != null && s !== "").map(String) : []);
const join = (a, sep = " + ") => a.join(sep);

/* The city line. `b` is `formatJurisdictionBadge(...)` output (or null when it could not be built). */
export function cityLineOf(b) {
  if (!b) return { text: "Couldn't check", failed: true, note: null };
  const gov = list(b.governingCities), part = list(b.partialCities), etj = list(b.etjLabels);
  const complicated = !!b.state                       // GA / CA: the county governs — the badge says how
    || list(b.cityLimitedAreas).length > 0            // limited-purpose / strip annexation keeps its class
    || list(b.etjUndetermined).length > 0 || list(b.etjReleased).length > 0 || !!b.etjUnavailable
    || list(b.touchesCities).length > 0 || !!b.unresolved || b.shape === "unknown";
  if (complicated) return { text: b.jur || "Couldn't check", failed: b.shape === "unknown", note: b.tail || null };
  const share = b.citySharePct != null ? `${Math.round(b.citySharePct * 100)}% of the site by area is in city limits` : null;
  if (b.shape === "split") {
    return { text: `${join(part)}, part ${etj.length ? "ETJ" : "unincorporated"}`, failed: false, note: share || b.tail || null };
  }
  if (b.shape === "in-city") return { text: join(gov), failed: false, note: b.tail || null };
  if (b.shape === "in-city-etj") return { text: `${join(gov)}, plus ${join(etj)} ETJ`, failed: false, note: b.tail || null };
  if (b.shape === "etj") return { text: `${join(etj)} ETJ`, failed: false, note: b.tail || null };
  if (b.shape === "unincorporated") return { text: "Unincorporated", failed: false, note: b.tail || null };
  return { text: b.jur || "Couldn't check", failed: false, note: b.tail || null };
}

/* Road authority answers for SEVERAL rings (one per active parcel) → ONE answer. The engine reads the frontage of
 * the ring it is handed, so asking only the largest parcel hid every road the other parcels front (Goose Creek's
 * 6-parcel plan read "State maintains IH 10" while the same ground as 4 parcels read the county roads). Roads are
 * merged by name (route when unnamed): lengths add, the authority follows the longest piece. A parcel whose lookup
 * failed is REPORTED (`partialError`), never silently dropped; if every lookup failed the answer is the failure. */
export function mergeRoadAnswers(answers) {
  const list = (answers || []).filter(Boolean);
  if (!list.length) return { __error: new Error("no road answer") };
  if (list.every((a) => a.__notScreened)) return { __notScreened: true };
  const usable = list.filter((a) => !a.__error && !a.__notScreened);
  const failed = list.filter((a) => a.__error || (a.error && !(a.roads || []).length));
  if (!usable.length) return list.find((a) => a.__error) || { roads: [], error: (failed[0] && failed[0].error) || "Couldn't check" };
  const by = new Map();
  for (const a of usable) for (const r of a.roads || []) {
    const key = (r.name && String(r.name).toLowerCase()) || (r.route != null ? "route:" + r.route : null) || "u:" + by.size;
    const cur = by.get(key);
    if (!cur) { by.set(key, { ...r, _max: r.lengthM || 0 }); continue; }
    cur.lengthM = (cur.lengthM || 0) + (r.lengthM || 0);
    if ((r.lengthM || 0) > cur._max) { cur._max = r.lengthM || 0; cur.authority = r.authority; }
    if (r.funcClass != null && (cur.funcClass == null || Number(r.funcClass) < Number(cur.funcClass))) cur.funcClass = r.funcClass;
  }
  const roads = [...by.values()].map(({ _max, ...x }) => x).sort((a, b) => (b.lengthM || 0) - (a.lengthM || 0));
  return { roads, error: null, partialError: failed.length > 0 && failed.length < list.length };
}

/* The roads line from identifyRoadAuthority's `{ roads: [{ name, route, authority:{label} }], error }`.
 * kind: "all" (one maintainer for every road) · "mixed" (a per-road list) · "none" · "failed" · "not-screened". */
export function roadsLineOf(road, { notScreenedIn = null } = {}) {
  if (road && road.__notScreened) return { kind: "not-screened", text: `Not screened in ${notScreenedIn || "this state"}`, items: [] };
  if (!road || road.__error || (road.error && !(Array.isArray(road.roads) && road.roads.length))) return { kind: "failed", text: "Couldn't check", items: [] };
  const roads = Array.isArray(road.roads) ? road.roads : [];
  if (!roads.length) return { kind: "none", text: "No fronting road found", items: [] };
  const nameOf = (r) => r.name || (r.route ? `Route ${r.route}` : "Unnamed road");
  const authOf = (r) => (r.authority && r.authority.label) || "Unknown";
  const auths = [...new Set(roads.map(authOf))];
  const partial = road.partialError ? " (some parcels couldn't be checked)" : "";
  const names = roads.map(nameOf);
  if (auths.length === 1) {
    const a = auths[0];
    const head = a === "Unknown" ? (roads.length === 1 ? "Maintainer unknown" : `Maintainer unknown for all ${roads.length}`)
      : roads.length === 1 ? `${a} maintains` : `${a} maintains all ${roads.length}`;
    const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ", …" : "");
    return { kind: "all", text: (roads.length === 1 ? `${head} ${shown}` : `${head} · ${shown}`) + partial, items: roads.map((r) => ({ name: nameOf(r), authority: authOf(r) })) };
  }
  const items = roads.map((r) => ({ name: nameOf(r), authority: authOf(r) }));
  return { kind: "mixed", text: `Mixed — ${roads.length} roads${partial}`, items };
}

/* The whole "Who governs this site" model. */
export function buildGovernsModel(badge, road, { state = null, stateLabel = null, layerKeys = ["jur_city", "jur_etj"] } = {}) {
  const city = cityLineOf(badge);
  const isdText = !badge ? "Couldn't check" : badge.isd || null;
  return {
    county: badge ? (badge.county || null) : "Couldn't check",
    city: { ...city, straddles: !!(badge && badge.straddle) },
    // School district: a Texas (TEA) source. Off Texas ground a bare dash would read "no school district".
    school: state && state !== "TX" ? `Not screened in ${stateLabel || "this state"}` : isdText,
    roads: roadsLineOf(road, { notScreenedIn: stateLabel }),
    lineLayers: layerKeys,
  };
}

/* ── Calls to make ───────────────────────────────────────────────────────────────────────────── */
export const CALLS = Object.freeze({
  waterSewer: { id: "water-sewer", label: "Water and sewer provider" },
  zoning: { id: "zoning", label: "Zoning district" },
  pipelines811: { id: "pipelines-811", label: "Pipeline operators · 811" },
  power: { id: "power", label: "Power service" },
});

/* Only the items whose condition applies. These are PROMPTS — nothing here asserts a data claim.
 *   ccn      — { water, sewer } each true (a certificate covers the site) | false (none) | null (unknown / not screened)
 *   badge    — the structured jurisdiction badge (or null)
 *   rows     — the trusted-check rows (the pipelines row's colour decides the 811 prompt) */
export function buildCalls({ ccn = {}, badge = null, rows = [] } = {}) {
  const out = [];
  // A provider call is worth making unless BOTH certificates are positively on file.
  if (!(ccn.water === true && ccn.sewer === true)) out.push(CALLS.waterSewer);
  const inCity = badge && (list(badge.governingCities).length > 0 || list(badge.partialCities).length > 0);
  if (inCity) {
    const partial = badge.cityContainment === "partial" || list(badge.partialCities).length > 0;
    out.push({ ...CALLS.zoning, label: partial ? `${CALLS.zoning.label} · city part only` : CALLS.zoning.label });
  }
  const pipe = (rows || []).find((r) => r.id === "pipelines");
  if (pipe && (pipe.severity === "red" || pipe.severity === "amber")) out.push(CALLS.pipelines811);
  out.push(CALLS.power);
  return out;
}
