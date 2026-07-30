/* Flood & drainage layer GROUP model (NEW-2 / NEW-3, B1076 / B1077) — pure.
 *
 * THE PROBLEM THIS SOLVES. The owner turned flood layers on at a Waller-County site
 * (Tsakiris) next to an obvious drainage channel and nothing painted. Nothing was broken:
 * HCFCD correctly returns nothing outside Harris County, FEMA correctly reports Zone X,
 * and FEMA never maps channels at all. But the panel said none of that — it just went
 * silent, which reads exactly like a broken layer. Two fixes live here:
 *
 *  (NEW-2) The flood layers become ONE GROUP with ONE MASTER TOGGLE and four labeled
 *          TIERS — never a single merged layer. Merging would destroy the distinction
 *          between a REGULATORY line (FEMA's SFHA, which a floodplain administrator
 *          enforces) and an ADVISORY MODEL (a master-plan Atlas-14 floodplain, which
 *          nobody enforces). That distinction is the whole point of the group.
 *          District-specific rows are AUTO-SCOPED: only the drainage authority that
 *          actually governs the site renders; the others are suppressed with a reason.
 *
 *  (NEW-3) "No features" must say WHY. Three distinct honest states per source:
 *            (a) covers this site, reports no hazard  → name the finding
 *            (b) does not cover this site             → name the right source instead
 *            (c) unavailable / slow                   → the existing B790 amber
 *          Plus one standing line, stated ONCE in the group: FEMA maps flood ZONES, not
 *          channels. A channel with no flood ribbon is normal, not missing data.
 *
 * Pure: no DOM, no network, no leaflet. LayerPanel.jsx renders what this decides.
 */

// ---------------------------------------------------------------------------
// The four tiers, in decision order. A layer config joins a tier via `floodTier`.
// ---------------------------------------------------------------------------
export const FLOOD_TIERS = [
  {
    key: "regulatory",
    label: "Regulatory",
    note: "Adopted flood maps a floodplain administrator enforces (FEMA NFHL zones, floodway, BFE).",
  },
  {
    key: "local",
    label: "Local drainage authority",
    note: "The district that actually reviews drainage here — its channels, easements and basins. Only the governing district is listed.",
  },
  {
    key: "hydrography",
    label: "Physical hydrography",
    note: "Where water physically runs. An inventory available everywhere — not a regulatory line.",
  },
  {
    key: "advisory",
    label: "Advisory models",
    note: "Study results, not adopted regulation. Never treat an advisory floodplain as an SFHA.",
  },
];

export const FLOOD_TIER_ORDER = FLOOD_TIERS.map((t) => t.key);
export const floodTierLabel = (key) => (FLOOD_TIERS.find((t) => t.key === key) || {}).label || key;

/* The standing honesty line for the whole group (NEW-3, stated ONCE — never repeated per
 * row). This is the sentence that would have answered the original report on its own. */
export const FEMA_ZONES_NOT_CHANNELS =
  "FEMA maps flood ZONES, not channels. A channel with no flood ribbon next to it is normal — not missing data.";

// ---------------------------------------------------------------------------
// Local drainage authorities. `counties` is where the district's data actually reaches —
// used to explain an off-district suppression in the user's own terms.
// ---------------------------------------------------------------------------
export const DRAINAGE_DISTRICTS = {
  hcfcd: { id: "hcfcd", name: "Harris County Flood Control District", short: "HCFCD", counties: ["harris"] },
  fbcdd: { id: "fbcdd", name: "Fort Bend County Drainage District", short: "FBCDD", counties: ["fortbend"] },
  bkdd: {
    id: "bkdd",
    name: "Brookshire–Katy Drainage District",
    short: "BKDD",
    // BKDD spans three counties, which is exactly why a county lookup alone can never
    // decide WHICH district governs — only the point-in-district boundary test can (see
    // governingDistrict). It can still decide which districts are IMPOSSIBLE here, which
    // is what districtReaches does when no boundary answer has arrived (B1091).
    counties: ["waller", "harris", "fortbend"],
  },
};

export const districtName = (id) => (DRAINAGE_DISTRICTS[id] || {}).name || null;
export const districtShort = (id) => (DRAINAGE_DISTRICTS[id] || {}).short || null;

/* (B1091) COUNTY KEYS. The same county arrives spelled three ways — the panel's
 * jurisdiction key ("fortbend"), the identify field's CNTY_NM ("Fort Bend"), and free
 * text ("Fort Bend County"). Canonicalise to letters-only so a lookup can never miss on
 * a space: the pre-B1091 COUNTY_DISTRICT key "fort bend" NEVER matched the panel's own
 * "fortbend", so a Fort Bend site silently resolved no district at all. */
export const countyKey = (c) => String(c || "").toLowerCase().replace(/county/g, "").replace(/[^a-z]/g, "") || null;

/* Display spellings for the counties whose canonical key isn't just a capitalised word. */
export const COUNTY_LABEL = { fortbend: "Fort Bend", sanjacinto: "San Jacinto" };
export const countyName = (c) => {
  const k = countyKey(c);
  if (!k) return "this area";
  return `${COUNTY_LABEL[k] || k.replace(/\b\w/g, (m) => m.toUpperCase())} County`;
};

/* County key → the county-wide flood-control district, where one exists. Waller
 * deliberately has NO entry: the county has no county-wide flood-control district, so a
 * Waller site's authority can only come from the district boundary test. */
export const COUNTY_DISTRICT = { harris: "hcfcd", fortbend: "fbcdd" };

/* Which local drainage authority governs this site?
 *
 *   detected  — district ids whose BOUNDARY POLYGON contains the site (the BKDD
 *               Boundaries/129 point test, B1075). Authoritative: a boundary hit is a
 *               fact, and it WINS over any county heuristic.
 *   county    — the identify county, lowercased. The fallback for county-wide districts.
 *   tested    — district ids whose boundary test ACTUALLY RAN and answered cleanly this
 *               check (B1091(×2)). A clean NEGATIVE is a fact too: it is the only thing that
 *               licenses a county-derived answer to say another district does NOT govern.
 *               An outage leaves the id out, so a failed query can never masquerade as a
 *               negative (LOUD-FAILURE).
 *
 * Returns { id, source: "boundary"|"county"|null, reason, exclusive }.
 *
 * `exclusive` (B1091(×2)) is the fix for the inversion this function shipped at Tsakiris: it
 * answers "may this result be used to say some OTHER district doesn't govern?" A boundary
 * containment is exclusive — the site is inside THAT district. A county heuristic is NOT,
 * because districts overlap counties: BKDD spans Waller, Harris and Fort Bend, so
 * "the site is in Harris → HCFCD" is no evidence whatsoever that BKDD doesn't govern.
 * Reading a county guess as exclusive is exactly how the panel came to tell the owner
 * that HCFCD governs a Waller-County tract that sits inside BKDD. A county-derived answer
 * becomes exclusive only once every OTHER district's boundary test has cleanly excluded
 * the site (`tested`).
 *
 * A null id is an honest "we don't know which district governs" — the panel then shows
 * every district row rather than hiding data behind a guess (fail open, the
 * coverage-engine rule). Pure. */
export function governingDistrict({ detected = null, county = null, tested = null } = {}) {
  const hits = (Array.isArray(detected) ? detected : []).filter((d) => DRAINAGE_DISTRICTS[d]);
  if (hits.length) {
    return { id: hits[0], source: "boundary", exclusive: true, reason: `${districtName(hits[0])} boundary contains this site` };
  }
  const c = countyKey(county);
  const byCounty = c ? COUNTY_DISTRICT[c] : null;
  if (byCounty) {
    // Every district that could ALSO reach this county must have been boundary-tested and
    // come back empty before this guess may exclude anything.
    const cleared = Array.isArray(tested) ? tested : [];
    const rivals = Object.keys(DRAINAGE_DISTRICTS)
      .filter((d) => d !== byCounty && districtReaches(d, c) !== false);
    return {
      id: byCounty, source: "county",
      exclusive: rivals.length > 0 && rivals.every((d) => cleared.includes(d)),
      reason: `${districtName(byCounty)} covers ${countyName(c)}`,
    };
  }
  return { id: null, source: null, exclusive: false, reason: c ? `no county-wide flood-control district in ${countyName(c)}` : "site location not resolved yet" };
}

// ---------------------------------------------------------------------------
// Tiering + district scoping of the flood group's rows.
// ---------------------------------------------------------------------------

/* Does this district's published data REACH this county at all?
 *   true  — the county is in the district's service area
 *   false — it is not, so nothing this district publishes can ever paint here
 *   null  — county unknown (or the district declares no counties) → fail open
 * This is the cheap, always-available half of the scoping question. The boundary test in
 * governingDistrict answers "which district governs"; this answers "which districts are
 * IMPOSSIBLE here", and it needs no network and no drainage check. Pure. */
export function districtReaches(districtId, county) {
  const d = DRAINAGE_DISTRICTS[districtId];
  const c = countyKey(county);
  if (!d || !c || !Array.isArray(d.counties) || !d.counties.length) return null;
  return d.counties.map(countyKey).includes(c);
}

const listCounties = (arr) => {
  const names = (arr || []).map((c) => countyName(c)).filter(Boolean);
  if (!names.length) return "its own area";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

/* (B1091) IS THIS ROW RELEVANT AT THIS SITE — and if not, WHY, in the user's own terms?
 *
 * The bug this exists for: at the Tsakiris tract (Waller County, inside BKDD) the panel
 * listed "Drainage channels & ROW — HCFCD" and "Storm sewer — City of Houston" under LOCAL
 * DRAINAGE AUTHORITY with no explanation. Neither agency has so much as a pipe in Waller
 * County. The pre-B1091 scoping could only act on `governing`, so the moment the drainage
 * check hadn't run (or ran before B1080 saved a district into the remembered snapshot) it
 * fell open and showed everything — which is exactly the confusion B1071 set out to end.
 *
 * ONE mechanism, four ordered reasons, all of them already-computed signals:
 *   1. a district row for a district that is NOT the governing one   (boundary test)
 *   2. a district row whose district does not reach this county      (county reach)
 *   3. a row whose agency's service area is another county entirely  (cfg.areaCounties)
 *   4. a row whose service's own published extent misses the view    (coverage engine —
 *      the SAME signal that gates the Master Plan row, reused rather than reinvented)
 *
 * (B1091(×2)) SIGNAL 1 IS NOT ALWAYS AVAILABLE, AND PRETENDING IT IS INVERTS THE ANSWER.
 * B1091 shipped reason 1 against ANY non-null `governing`, including one the county
 * heuristic merely guessed. Districts overlap counties — BKDD spans Waller, Harris and
 * Fort Bend — so "this county's flood-control district is HCFCD" is no evidence at all
 * that BKDD doesn't govern. At the Tsakiris tract that guess suppressed every BKDD row
 * with the sentence "Brookshire–Katy Drainage District doesn't govern drainage at this
 * site — Harris County Flood Control District does", which is the exact reverse of the
 * truth (the district's own boundary layer contains that point; HCFCD's jurisdiction
 * stops at the Harris County line). Saying nothing was bad; asserting the opposite is
 * worse. So reason 1 now requires `governingExclusive` — a boundary containment, or a
 * county answer whose rivals have each been boundary-tested and cleanly excluded. A guess
 * may still demote a district that CANNOT reach this county (reason 2, checkable), and
 * otherwise fails OPEN.
 *
 * Returns { relevant, reason }. `reason` is null when relevant. Pure. */
export function floodRowRelevance(cfg = {}, { governing = null, governingExclusive = false, county = null, coverage = null } = {}) {
  const agency = cfg.agency || cfg.source || "This source";
  const gov = governing ? districtName(governing) : null;
  const where = countyName(county);

  if (cfg.district) {
    const reaches = districtReaches(cfg.district, county);
    const name = districtName(cfg.district) || agency;
    // Checkable on its own: this district's published data cannot reach this county at
    // all. True whether or not anything is known about who governs.
    if (reaches === false) {
      return {
        relevant: false,
        reason: governing && cfg.district !== governing
          ? `${name} doesn't cover ${where} — ${gov} is shown instead.`
          : `${name} doesn't cover ${where}.`,
      };
    }
    // Both districts reach this county — only an EXCLUSIVE answer can pick between them.
    if (governing && cfg.district !== governing && governingExclusive) {
      return { relevant: false, reason: `${name} doesn't govern drainage at this site — ${gov} does.` };
    }
    return { relevant: true, reason: null };
  }

  const area = Array.isArray(cfg.areaCounties) ? cfg.areaCounties : null;
  const c = countyKey(county);
  if (area && area.length && c && !area.map(countyKey).includes(c)) {
    return { relevant: false, reason: `${agency}'s system doesn't reach ${where} — it maps ${listCounties(area)} only.` };
  }

  if (coverage === "out") return { relevant: false, reason: `${agency}'s data doesn't reach this area.` };

  return { relevant: true, reason: null };
}

/* Split the flood group's [id, cfg] entries into ordered tiers, DEMOTING every row that
 * can't have anything to say at this site (floodRowRelevance above).
 *
 * A demoted row is never deleted — it moves to `offRows` so the panel can list it behind
 * one collapsed line WITH its reason, which keeps discoverability (you can still turn it
 * on if you think the scoping is wrong) while the default view stays short.
 *
 * `isOn(id)` is the one exception: a row the user has ALREADY TURNED ON stays in its tier
 * whatever the scoping says — you must always see what you enabled — and carries its
 * reason as a caption instead. Injected, so this stays pure.
 *
 * Returns { tiers: [{ key, label, note, rows }], offRows: [[id, cfg]], notes: {id: reason},
 *           suppressed: [districtId] }. */
export function scopeFloodEntries(entries = [], { governing = null, governingExclusive = false, county = null, coverage = null, isOn = null } = {}) {
  const suppressed = new Set();
  const notes = {};
  const kept = [];
  const offRows = [];
  for (const e of entries) {
    const [id, cfg = {}] = e;
    const cov = coverage && typeof coverage === "object" ? coverage[id] : null;
    const { relevant, reason } = floodRowRelevance(cfg, { governing, governingExclusive, county, coverage: cov });
    if (relevant) { kept.push(e); continue; }
    notes[id] = reason;
    if (cfg.district) suppressed.add(cfg.district);
    if (isOn && isOn(id)) kept.push(e); else offRows.push(e);
  }
  const inTier = (list, key) => list
    .filter(([, cfg]) => ((cfg || {}).floodTier || "regulatory") === key)
    .sort((a, b) => ((a[1] || {}).order ?? 99) - ((b[1] || {}).order ?? 99));
  const tiers = FLOOD_TIERS.map((t) => ({ ...t, rows: inTier(kept, t.key) })).filter((t) => t.rows.length);
  offRows.sort((a, b) => FLOOD_TIER_ORDER.indexOf((a[1] || {}).floodTier || "regulatory")
    - FLOOD_TIER_ORDER.indexOf((b[1] || {}).floodTier || "regulatory")
    || ((a[1] || {}).order ?? 99) - ((b[1] || {}).order ?? 99));
  return { tiers, offRows, notes, suppressed: [...suppressed] };
}

/* (NEW-2) Master-toggle state for the whole group: the ids it drives, and whether it
 * currently reads on. "On" means EVERY listed row is on — so the box is a true
 * all-or-nothing switch and clicking it when some are on turns the rest on (never off).
 * Pure. */
export function floodMasterState(tiers = [], overlays = {}) {
  const ids = [];
  for (const t of tiers) for (const [id] of t.rows) ids.push(id);
  const onCount = ids.filter((id) => overlays[id] && overlays[id].on).length;
  return { ids, onCount, all: ids.length > 0 && onCount === ids.length, any: onCount > 0 };
}

// ---------------------------------------------------------------------------
// (NEW-3a) The FEMA verdict — say what FEMA actually reported, never nothing.
// ---------------------------------------------------------------------------

/* Is a FEMA zone code a Special Flood Hazard Area (the 1%-annual-chance floodplain a
 * floodplain administrator regulates)? A/V zones are; X (and D, undetermined) are not. */
export const isSfhaZone = (zone) => /^(A|V)/i.test(String(zone || "").trim());

/* ⛔ `femaZoneVerdict` MOVED to `floodZoneCopy.js` (2026-07-30). It is pure COPY plus NEW-3
 * provenance, and this module rides the site-route chunk through LayerPanel — keeping the verdict
 * here would have pinned every flood sentence and the FIPS tables to the boot path. LayerPanel
 * dynamic-imports it; `isSfhaZone` below stays because the row-scoping logic here uses it.
 * See floodZoneCopy.js's header for the split rule. */

/* (NEW-2) THE GROUP MUST NEVER BE BLANK — the honest state when the facts aren't in hand.
 *
 * The gap this closes, found by driving the real panel with the Tsakiris tract's actual
 * remembered check (sites.id smrjdgmlinea): every honest line in this group is conditional
 * on a resolved drainage context. `femaZoneVerdict` returns null without one, and
 * `floodRowRelevance` can only demote a row once the county (or the governing district) is
 * known. So a surface that has NO context — the map finder's copy of this panel, or any
 * site whose flood check has never run — renders the group with NO verdict line and NO
 * row reasons: it goes completely silent, which is the exact failure B1077 was written to
 * end. Every OTHER state in this file says something; this is the one that said nothing.
 *
 * Two states, one short line each, and they are MUTUALLY EXCLUSIVE with the FEMA verdict
 * (LayerPanel renders this OR that, never both — panel-brevity: this replaces silence, it
 * never accumulates on top of a working readout):
 *
 *   no context at all      → nothing has been checked here yet. Say so.
 *   context, county open   → the check ran but the site's county didn't resolve (a straddle,
 *                            or an identify that never answered), so the district scoping
 *                            deliberately fails OPEN and lists every source. Name that,
 *                            rather than letting a full list read as a scoped one.
 *
 * Returns { text, tone } or null once the facts ARE in hand (the verdict lines speak then).
 * Pure. */
export function floodFactsNote({ hasContext = false, county = null } = {}) {
  if (!hasContext) {
    return { text: "Flood zone and drainage district not checked here yet.", tone: "warn" };
  }
  if (!countyKey(county)) {
    return { text: "County here didn't resolve — every drainage source is listed until it does.", tone: "warn" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// (NEW-6 / B1080) The Stormwater readout's district line.
// ---------------------------------------------------------------------------

/* ONE line naming who governs drainage here and what was actually found — the answer the
 * readout could only give as "unknown" before the district tier existed.
 *
 * Deliberately does NOT restate detention criteria: BKDD's rules ARE modelled (rate control,
 * Post ≤ Pre — see DETENTION_RULES.bkdd), and its rate-vs-volume nature is already stated
 * once by BKDD_OVERLAY_SHORT. Saying it twice would be the accumulation this repo's
 * panel-brevity rule exists to stop.
 *
 * Returns { text, tone } or null when there's nothing honest to say yet. Pure. */
export function districtDrainageNote(ctx) {
  if (!ctx) return null;
  const districtId = ctx.drainageDistrict?.id || null;
  const ch = ctx.channel || {};
  const ease = ctx.easements || null;
  // HCFCD keeps its own long-standing wording (the Auto/Yes/No control) — don't duplicate it.
  if (districtId === "hcfcd") return null;

  const bits = [];
  if (ch.state === "loaded" && ch.near) {
    const name = ch.name || ch.kindLabel || "a watercourse";
    const kind = ch.kindLabel && ch.name ? ` (${ch.kindLabel})` : "";
    const dist = ch.distFt != null ? ` within ~${Math.round(ch.distFt)} ft` : "";
    bits.push(`${name}${kind}${dist}`);
  }
  if (ease && ease.present && ease.maxWidthFt) {
    const ex = ease.items.find((e) => e.exhibit);
    bits.push(`district drainage easement ${ease.maxWidthFt} ft${ex ? ` (exhibit ${ex.exhibit})` : ""}`);
  }
  const ws = ctx.watershed;
  if (ws && ws.state === "loaded" && ws.names && ws.names.length) {
    bits.push(`sub-watershed “${ws.names[0]}”${ws.sqMiles ? ` (${ws.sqMiles} sq mi)` : ""}`);
  }

  if (districtId) {
    const short = districtShort(districtId) || districtName(districtId);
    if (!bits.length) {
      if (ch.state === "failed") return { text: `${short} governs drainage here, but its map service didn't answer — channel and easement status unknown, not clear.`, tone: "warn" };
      return { text: `${short} governs drainage here; nothing of its mapped drainage reaches this site.`, tone: "ok" };
    }
    return { text: `${short} governs drainage here — ${bits.join("; ")}.`, tone: "ok" };
  }

  // No drainage district at all → tier 3. Say WHICH source answered, and that it's an
  // inventory: an NHD hit proves a channel exists, never that you may discharge to it.
  if (ch.inventoryOnly && bits.length) {
    return { text: `No drainage district publishes maps here — USGS hydrography shows ${bits.join("; ")}. An inventory: it confirms the channel exists, not that it can take your discharge.`, tone: "ok" };
  }
  if (ch.state === "failed") return { text: "Couldn't reach any drainage map service for this site — channel status unknown, not clear.", tone: "warn" };
  if (ch.state === "empty") return { text: "No drainage district publishes maps here, and national hydrography shows no watercourse at this site.", tone: "ok" };
  return null;
}

/* The honest caption for a district-scoped layer that is ON but whose service reported
 * nothing here, vs one whose study area doesn't reach here. `studyArea` marks the
 * advisory master-plan family, whose empty means "outside the study area" — a completely
 * different statement from "no floodplain". Pure. */
export function emptyReason(cfg = {}, { coverage = null } = {}) {
  const agency = cfg.agency || cfg.source || "This source";
  if (cfg.studyArea && (coverage === "out" || coverage === "unknown")) {
    return `Outside this study area — ${agency}'s model doesn't extend here. Not a finding of "no floodplain".`;
  }
  if (cfg.studyArea) return `${agency} modelled this area and mapped nothing here.`;
  if (coverage === "out") return `${agency}'s data doesn't reach this area.`;
  return `${agency} covers this area and reports nothing at this site.`;
}
