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

const stripCity = (n) => String(n).replace(/^City of\s+/i, "");
const pct = (x) => `${Math.round(x * 100)}%`;
const LIMIT_WORD = { limited: "limited purpose", strip: "strip annexation", unknown: "class not stated" };

/* The class + area-share line under a city value: "Full purpose 4% · limited purpose 67% · rest ETJ". The classes are
 * kept honest and are never folded into the headline value — they ride a second muted line instead. Null when the site
 * carries no limited-purpose / strip area (the plain share note then applies). */
export function cityClassDetail(b) {
  const lim = Array.isArray(b && b.cityLimitedAreas) ? b.cityLimitedAreas : [];
  if (!lim.length) return null;
  const bits = [];
  const hasFull = list(b.governingCities).length > 0 || list(b.partialCities).length > 0;
  if (hasFull) bits.push(b.citySharePct != null ? `Full purpose ${pct(b.citySharePct)}` : "Full purpose");
  const multi = new Set(lim.map((a) => String(a.name))).size > 1;
  lim.forEach((a) => {
    const word = LIMIT_WORD[a.class] || LIMIT_WORD.unknown;
    const lead = multi ? `${stripCity(a.name)} ${word}` : (bits.length ? word : `${word[0].toUpperCase()}${word.slice(1)}`);
    bits.push(a.share != null ? `${lead} ${pct(a.share)}` : lead);
  });
  const etj = list(b.etjLabels);
  if (b.shape === "split" || hasFull || lim.length) bits.push(etj.length ? "rest ETJ" : b.shape === "split" ? "rest unincorporated" : null);
  return bits.filter(Boolean).join(" · ");
}

/* The city line. `b` is `formatJurisdictionBadge(...)` output (or null when it could not be built).
 * `text` is always a SHORT VALUE ("Baytown, part ETJ"); anything longer (class split, area shares, the touch tail) is
 * `note`, a second muted line. */
export function cityLineOf(b) {
  if (!b) return { text: "Couldn't check", failed: true, note: null };
  const gov = list(b.governingCities).map(stripCity), part = list(b.partialCities).map(stripCity), etj = list(b.etjLabels).map(stripCity);
  const limited = Array.isArray(b.cityLimitedAreas) ? b.cityLimitedAreas : [];
  const complicated = !!b.state                       // GA / CA: the county governs — the badge says how
    || list(b.etjUndetermined).length > 0 || list(b.etjReleased).length > 0 || !!b.etjUnavailable
    || list(b.touchesCities).length > 0 || !!b.unresolved || b.shape === "unknown";
  if (complicated) return { text: b.jur || "Couldn't check", failed: b.shape === "unknown", note: b.tail || null };
  const share = b.citySharePct != null ? `${pct(b.citySharePct)} of the site by area is in city limits` : null;
  const detail = cityClassDetail(b) || share || b.tail || null;
  if (b.shape === "split") {
    return { text: `${join(part)}, part ${etj.length ? "ETJ" : "unincorporated"}`, failed: false, note: detail };
  }
  if (b.shape === "in-city") return { text: join(gov), failed: false, note: detail };
  if (b.shape === "in-city-etj") return { text: `${join(gov)}, plus ${join(etj)} ETJ`, failed: false, note: detail };
  // No full-purpose city holds the site, but a limited-purpose / strip area does: say so in the value, never "Baytown".
  if (limited.length) {
    const names = [...new Set(limited.map((a) => stripCity(a.name)))];
    const word = LIMIT_WORD[limited[0].class] || LIMIT_WORD.unknown;
    return { text: `${join(names)}, ${word}`, failed: false, note: detail };
  }
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
    const key = (r.name && normalizeRoadName(r.name).toLowerCase()) || (r.route != null ? "route:" + r.route : null) || "u:" + by.size;
    const cur = by.get(key);
    if (!cur) { by.set(key, { ...r, _max: r.lengthM || 0 }); continue; }
    cur.lengthM = (cur.lengthM || 0) + (r.lengthM || 0);
    if ((r.lengthM || 0) > cur._max) { cur._max = r.lengthM || 0; cur.authority = r.authority; }
    if (r.funcClass != null && (cur.funcClass == null || Number(r.funcClass) < Number(cur.funcClass))) cur.funcClass = r.funcClass;
  }
  const roads = [...by.values()].map(({ _max, ...x }) => x).sort((a, b) => (b.lengthM || 0) - (a.lengthM || 0));
  return { roads, error: null, partialError: failed.length > 0 && failed.length < list.length };
}

/* ── Road names ──────────────────────────────────────────────────────────────────────────────────
 * The sources publish a street type twice ("Chambers Parkway Pkwy", "Lake Groove Lane Ln") and join a road's two names
 * with a bare hyphen. A name is cleaned here, once, so every row of the list reads the same way. */
const SUFFIX_FORMS = {
  parkway: ["pkwy", "pky"], lane: ["ln"], road: ["rd"], drive: ["dr"], street: ["st"], avenue: ["ave"], boulevard: ["blvd"],
  highway: ["hwy"], court: ["ct"], circle: ["cir"], trail: ["trl"], place: ["pl"], freeway: ["fwy"], expressway: ["expy", "expwy"],
  terrace: ["ter"], way: ["wy"],
};
const dedupeSuffix = (segment) => {
  const toks = segment.split(" ").filter(Boolean);
  const n = toks.length;
  if (n >= 3) {                                  // keep a bare "Lane Ln" style 2-word name untouched: needs a real name before it
    const a = toks[n - 2].toLowerCase().replace(/\.$/, ""), z = toks[n - 1].toLowerCase().replace(/\.$/, "");
    if ((SUFFIX_FORMS[a] && SUFFIX_FORMS[a].includes(z)) || (SUFFIX_FORMS[z] && SUFFIX_FORMS[z].includes(a))) {
      const keep = SUFFIX_FORMS[a] ? toks[n - 2] : toks[n - 1];  // the long form
      return [...toks.slice(0, n - 2), keep].join(" ");
    }
  }
  return toks.join(" ");
};
/* One clean road name: whitespace collapsed, a doubled street type removed, and a spaced hyphen / dash between two
 * names written as " / " (so no dash character is left to be mistaken for the name↔maintainer separator). */
export function normalizeRoadName(raw) {
  const s = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  return s.split(/\s+[-–—]\s+/).map(dedupeSuffix).filter(Boolean).join(" / ");
}

const AUTH_SHORT = { "State (TxDOT)": "state", County: "county", City: "city", Federal: "federal", Unknown: "unknown", "Toll / managed-lane authority": "toll" };
const AUTH_ORDER = ["state", "county", "city", "toll", "federal", "unknown"];
const authShort = (label) => AUTH_SHORT[label] || String(label).replace(/\s*\(.*?\)\s*/g, " ").trim().toLowerCase();
export const ROADS_LIST_MAX = 10;

/* The roads line from identifyRoadAuthority's `{ roads: [{ name, route, authority:{label} }], error }`.
 * kind: "all" (one maintainer for every road) · "mixed" (a per-road list) · "none" · "failed" · "not-screened".
 * The count in the headline IS the length of `items` — one array feeds both, so they cannot disagree. A road the source
 * names two ways collapses to one row. */
export function roadsLineOf(road, { notScreenedIn = null } = {}) {
  if (road && road.__notScreened) return { kind: "not-screened", text: `Not screened in ${notScreenedIn || "this state"}`, items: [] };
  if (!road || road.__error || (road.error && !(Array.isArray(road.roads) && road.roads.length))) return { kind: "failed", text: "Couldn't check", items: [] };
  const raw = Array.isArray(road.roads) ? road.roads : [];
  if (!raw.length) return { kind: "none", text: "No fronting road found", items: [] };
  const nameOf = (r) => normalizeRoadName(r.name || (r.route ? `Route ${r.route}` : "")) || "Unnamed road";
  const authOf = (r) => (r.authority && r.authority.label) || "Unknown";
  const seen = new Set();
  const items = [];
  for (const r of raw) {
    const name = nameOf(r), authority = authOf(r);
    const key = `${name.toLowerCase()}|${authority}`;
    if (name !== "Unnamed road" && seen.has(key)) continue;
    seen.add(key);
    items.push({ name, authority, authorityShort: authShort(authority) });
  }
  const n = items.length;
  const auths = [...new Set(items.map((i) => i.authority))];
  const partial = road.partialError ? " (some parcels couldn't be checked)" : "";
  const names = items.map((i) => i.name);
  if (auths.length === 1) {
    const a = auths[0];
    const head = a === "Unknown" ? (n === 1 ? "Maintainer unknown" : `Maintainer unknown for all ${n}`)
      : n === 1 ? `${a} maintains` : `${a} maintains all ${n}`;
    const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ", …" : "");
    return { kind: "all", text: (n === 1 ? `${head} ${shown}` : `${head} · ${shown}`) + partial, items };
  }
  const counts = new Map();
  items.forEach((i) => counts.set(i.authorityShort, (counts.get(i.authorityShort) || 0) + 1));
  const split = [...counts.entries()].sort((x, y) => (AUTH_ORDER.indexOf(x[0]) + 1 || 99) - (AUTH_ORDER.indexOf(y[0]) + 1 || 99)).map(([k, c]) => `${c} ${k}`).join(", ");
  return { kind: "mixed", text: `Mixed · ${n} road${n === 1 ? "" : "s"} · ${split}${partial}`, items, listed: items.slice(0, ROADS_LIST_MAX), more: Math.max(0, n - ROADS_LIST_MAX) };
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
