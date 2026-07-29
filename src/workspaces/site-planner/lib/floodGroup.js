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
  fbcdd: { id: "fbcdd", name: "Fort Bend County Drainage District", short: "FBCDD", counties: ["fort bend"] },
  bkdd: {
    id: "bkdd",
    name: "Brookshire–Katy Drainage District",
    short: "BKDD",
    // BKDD spans three counties, which is exactly why a county lookup alone can never
    // decide it — only the point-in-district boundary test can (see governingDistrict).
    counties: ["waller", "harris", "fort bend"],
  },
};

export const districtName = (id) => (DRAINAGE_DISTRICTS[id] || {}).name || null;
export const districtShort = (id) => (DRAINAGE_DISTRICTS[id] || {}).short || null;

/* County (lowercased TxDOT CNTY_NM) → the county-wide flood-control district, where one
 * exists. Waller deliberately has NO entry: the county has no county-wide flood-control
 * district, so a Waller site's authority can only come from the district boundary test. */
export const COUNTY_DISTRICT = { harris: "hcfcd", "fort bend": "fbcdd" };

/* Which local drainage authority governs this site?
 *
 *   detected  — district ids whose BOUNDARY POLYGON contains the site (the BKDD
 *               Boundaries/129 point test, B1075). Authoritative: a boundary hit is a
 *               fact, and it WINS over any county heuristic.
 *   county    — the identify county, lowercased. The fallback for county-wide districts.
 *
 * Returns { id, source: "boundary"|"county"|null, reason }. A null id is an honest "we
 * don't know which district governs" — the panel then shows every district row rather
 * than hiding data behind a guess (fail open, the coverage-engine rule). Pure. */
export function governingDistrict({ detected = null, county = null } = {}) {
  const hits = (Array.isArray(detected) ? detected : []).filter((d) => DRAINAGE_DISTRICTS[d]);
  if (hits.length) {
    return { id: hits[0], source: "boundary", reason: `${districtName(hits[0])} boundary contains this site` };
  }
  const c = county ? String(county).toLowerCase().trim() : null;
  const byCounty = c ? COUNTY_DISTRICT[c] : null;
  if (byCounty) {
    return { id: byCounty, source: "county", reason: `${districtName(byCounty)} covers ${titleCounty(c)}` };
  }
  return { id: null, source: null, reason: c ? `no county-wide flood-control district in ${titleCounty(c)}` : "site location not resolved yet" };
}

const titleCounty = (c) => String(c || "").replace(/\b\w/g, (m) => m.toUpperCase()) + " County";

// ---------------------------------------------------------------------------
// Tiering + district scoping of the flood group's rows.
// ---------------------------------------------------------------------------

/* Split the flood group's [id, cfg] entries into ordered tiers, dropping rows that belong
 * to a district that does NOT govern this site.
 *
 * A row opts into district scoping with `cfg.district`. Rows with no `district` are always
 * listed (FEMA, NHD, city storm sewer — none of them are district-exclusive).
 *
 * When the governing district is UNKNOWN (`governing` null) nothing is suppressed: showing
 * every district beats hiding the right one behind a guess. Pure.
 *
 * Returns { tiers: [{ key, label, note, rows }], suppressed: [districtId] }. */
export function scopeFloodEntries(entries = [], { governing = null } = {}) {
  const suppressed = new Set();
  const kept = [];
  for (const e of entries) {
    const cfg = e[1] || {};
    if (cfg.district && governing && cfg.district !== governing) { suppressed.add(cfg.district); continue; }
    kept.push(e);
  }
  const tiers = FLOOD_TIERS.map((t) => ({
    ...t,
    rows: kept
      .filter(([, cfg]) => (cfg.floodTier || "regulatory") === t.key)
      .sort((a, b) => (a[1].order ?? 99) - (b[1].order ?? 99)),
  })).filter((t) => t.rows.length);
  return { tiers, suppressed: [...suppressed] };
}

/* (NEW-3b) The off-district explanation, in the owner's own terms: name the source that
 * does NOT cover here AND the one that does. Returns null when nothing was suppressed (so
 * the panel renders no line at all rather than an empty one). Pure. */
export function districtSwapNote({ governing = null, suppressed = [], county = null } = {}) {
  const others = (suppressed || []).filter((d) => d && d !== governing);
  if (!others.length) return null;
  const away = others.map((d) => districtName(d)).filter(Boolean);
  if (!away.length) return null;
  const where = county ? titleCounty(String(county).toLowerCase()) : "this area";
  const gov = governing ? districtName(governing) : null;
  const doesnt = away.length === 1 ? `${away[0]} doesn't cover ${where}` : `${away.join(" and ")} don't cover ${where}`;
  return gov ? `${doesnt} — showing ${gov} instead.` : `${doesnt}.`;
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

/* Turn resolveDrainageContext's `flood` block ({ zones, state }) into ONE honest line.
 *
 * The three states this function exists to distinguish (NEW-3):
 *   failed          → we could not reach FEMA. NOT "no flood zone."
 *   empty           → FEMA answered, and has no zone polygon mapped at this point.
 *   loaded, no SFHA → FEMA answered Zone X: minimal hazard, no SFHA here. THE ANSWER.
 *   loaded, SFHA    → an SFHA is mapped; name the zone.
 *
 * Returns { text, tone } where tone is "ok" | "warn" | "alert" — or null when there is
 * nothing yet to report (no check has run). Pure. */
export function femaZoneVerdict(flood) {
  if (!flood || !flood.state) return null;
  if (flood.state === "failed") {
    return { text: "FEMA's flood map service didn't answer — flood status here is unknown, not clear.", tone: "warn" };
  }
  const zones = Array.isArray(flood.zones) ? flood.zones : [];
  if (!zones.length) {
    return { text: "FEMA's effective map shows no flood zone mapped at this site.", tone: "ok" };
  }
  const sfha = zones.filter((z) => isSfhaZone(z.zone));
  if (sfha.length) {
    const names = [...new Set(sfha.map((z) => `Zone ${z.zone}`))].join(" + ");
    const floodway = sfha.some((z) => /FLOODWAY/i.test(String(z.subtype || "")));
    return {
      text: `FEMA effective FIRM: ${names}${floodway ? " including regulatory floodway" : ""} — a special flood hazard area IS mapped here.`,
      tone: "alert",
    };
  }
  const z = zones[0];
  const sub = String(z.subtype || "").trim();
  const subtle = sub && !/^AREA OF MINIMAL FLOOD HAZARD$/i.test(sub) ? `, ${sub.toLowerCase()}` : ", area of minimal flood hazard";
  return { text: `FEMA effective FIRM: Zone ${z.zone}${subtle} — no special flood hazard area mapped here.`, tone: "ok" };
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
