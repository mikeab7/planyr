/* statePlane — the FULL state-plane resolver: county-first zone resolution on top of `statePlaneCore.js` (zones, projections,
 * units, the point resolver). Imports the generated county table (statePlaneCounties.js, ~22 KB), so import THIS only where a county
 * is in hand; point-only callers import `statePlaneCore.js` directly. Everything in the core is re-exported unchanged.
 * See docs/incidents/STATE-PLANE-AUDIT.md. */
import {
  SP_ZONES, SINGLE_ZONE_STATE, stateCode, withZone, WA_GRANT_SPLIT_LAT, alaskaZoneId, hawaiiZoneId, zoneForPoint,
  gridConvergenceDegIn,
} from "./statePlaneCore.js";
import { COUNTY_TABLE, COUNTY_ALIASES, DECIDED_COUNTIES, SPLIT_COUNTIES } from "./statePlaneCounties.js";
export * from "./statePlaneCore.js";

/* Per-county zone assignment for the nine Colorado counties Planyr targets, plus the Texas
 * counties it already serves. `decided:true` marks an assignment this project MADE rather than
 * read off the statute — today that is Broomfield alone, and it carries its reasoning. */
export const COUNTY_ZONE = {
  // Texas (unchanged — every existing site).
  "TX:harris": { zone: "tx_sc" },
  "TX:fortbend": { zone: "tx_sc" },
  "TX:chambers": { zone: "tx_sc" },
  "TX:waller": { zone: "tx_sc" },
  /* ⛔ A KNOWN DISAGREEMENT WITH EPSG/NGS, kept on purpose and SAID. EPSG's own county list puts Montgomery County in Texas CENTRAL
   * (EPSG:2277), not South Central. The app has always projected Montgomery sites on tx_sc, test/statePlane.test.js pins that
   * ("keeps every Texas county on the app's original zone"), and the brief for the all-states work was that Texas South Central
   * stays bit-for-bit identical — so the assignment is kept and marked decided. Flipping it is the one line below plus that test;
   * it is an OWNER DECISION (docs/incidents/STATE-PLANE-AUDIT.md §4). */
  "TX:montgomery": {
    zone: "tx_sc",
    decided: true,
    decisionNote:
      "EPSG/NGS lists Montgomery County in Texas CENTRAL (EPSG:2277). Planyr has always placed Montgomery sites on Texas South " +
      "Central (EPSG:2278) like the rest of its Houston-area counties, and keeps doing so until the owner decides otherwise; " +
      "the difference is a small scale/convergence effect at screening grade. Confirm against the survey for anything else.",
  },
  // Colorado NORTH (C.R.S. 38-52-101).
  "CO:larimer": { zone: "co_north" },
  "CO:weld": { zone: "co_north" },
  "CO:boulder": { zone: "co_north" },
  "CO:adams": { zone: "co_north" },
  // Colorado CENTRAL (C.R.S. 38-52-101).
  "CO:denver": { zone: "co_central" },
  "CO:arapahoe": { zone: "co_central" },
  "CO:jefferson": { zone: "co_central" },
  "CO:elpaso": { zone: "co_central" },
  // The one DECIDED assignment.
  "CO:broomfield": {
    zone: "co_north",
    decided: true,
    decisionNote:
      "Broomfield is not named in C.R.S. 38-52-101 — the statute predates the county, which was " +
      "created in 2001 from parts of Adams, Boulder, Jefferson and Weld. Planyr assigns it to " +
      "Colorado NORTH: three of its four parent counties are North zone, and Broomfield's own " +
      "published parcel service uses EPSG:2876 (NAD83(HARN) / Colorado North, ftUS). Confirm " +
      "against the survey before using a Broomfield state-plane coordinate for anything but screening.",
  },
};

/* County names arrive from several sources in several shapes — "Adams", "ADAMS COUNTY",
 * "City and County of Denver", "El Paso County", "Orleans Parish", "Doña Ana". The slug is letters only, with the designation
 * words removed, accents folded and the state ROUTING PREFIX stripped.
 *
 * ⛔ NEW-2 — THE `co_` ROUTING PREFIX IS STRIPPED FIRST, and leaving it out was a silent
 * wrong-zone bug. The app PERSISTS a non-Texas county as its routing key (`co_denver`, `ga_gwinnett`, `fl_stjohns` —
 * `counties.js`, prefixed because states share county names) and that is the value a plan's `county` field carries. Without the
 * strip `zoneForCounty("CO", "co_denver")` slugs to `codenver`, matches nothing, returns null, and `resolveZone` falls through to
 * the COARSE point envelope. Measured: Denver then resolved to **Colorado NORTH (2231)** instead of Central (2232). Generalised
 * from `co_` to any two-letter state prefix when the other 47 states were added. MUST stay identical to `slug()` in
 * scripts/gen-state-plane-zones.py (test/statePlaneAllZones.test.js pins every county in the nationwide polygons asset). */
const slugCounty = (c) =>
  String(c || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/^[a-z]{2}_/, "")
    .replace(/\b(city|and|county|parish|borough|census area|municipality|of)\b/g, "")
    .replace(/[^a-z]/g, "");

/* The nationwide table, folded once (lazily) into "ST:slug" -> zone id. */
let COUNTY_INDEX = null;
const countyIndex = () => {
  if (COUNTY_INDEX) return COUNTY_INDEX;
  const m = new Map();
  for (const [st, zones] of Object.entries(COUNTY_TABLE)) {
    for (const [zid, list] of Object.entries(zones)) for (const k of list.split(",")) m.set(`${st}:${k}`, zid);
  }
  COUNTY_INDEX = m;
  return m;
};

/* The zone for a county, when the app knows one. `state` is a USPS code (case-insensitive). `point` ({lat}) is only needed for
 * the one county a parallel splits (Grant, WA). Returns null for a county this project has not assigned — an HONEST null,
 * never a guess: a caller must render "state plane zone not established here", not a plausible wrong zone. */
export function zoneForCounty(state, county, point = null) {
  const st = stateCode(state);
  const k = slugCounty(county);
  const key = `${st}:${k}`;
  const rec = COUNTY_ZONE[key];                    // hand-written: Texas's original five, Colorado's nine, Broomfield
  if (rec) return { ...SP_ZONES[rec.zone], decided: rec.decided === true, decisionNote: rec.decisionNote || null, via: "county" };
  if (SINGLE_ZONE_STATE[st]) return withZone(SINGLE_ZONE_STATE[st], { via: "state" });
  if (st === "AK") return null;                    // boroughs straddle the meridian bands — position decides
  const canon = COUNTY_ALIASES[key] ? `${st}:${COUNTY_ALIASES[key]}` : key;
  const split = SPLIT_COUNTIES[canon];
  if (split) {
    const la = point && Number.isFinite(Number(point.lat)) ? Number(point.lat) : null;
    if (la == null) return null;                   // a split county cannot be answered without a latitude — honest null
    return withZone(la >= WA_GRANT_SPLIT_LAT ? split.north : split.south, {
      via: "county", decided: true,
      decisionNote: `${county} County is split by ${WA_GRANT_SPLIT_LAT}°N (EPSG: north of approximately 47°30'N is the North zone, south is the South zone); assigned from the site's latitude.`,
    });
  }
  const dec = DECIDED_COUNTIES[canon];
  if (dec) {
    return withZone(dec.zone, {
      via: "county", decided: true,
      decisionNote: dec.note || (dec.surroundedBy
        ? `Independent city: EPSG's zone list does not name it, so it takes the zone of the county that surrounds it (${dec.surroundedBy}).`
        : null),
    });
  }
  const zid = countyIndex().get(canon);
  return zid ? withZone(zid, { via: "county" }) : null;
}

/* THE resolver every consumer should call: county first (authoritative — zone boundaries ARE county lines), a single-zone state
 * on its own, Alaska by meridian / Hawaii by island, the point envelope last, honest null after that. NEVER Texas by default. */
export function resolveZone({ state = null, county = null, lat = null, lon = null } = {}) {
  const st = state ? stateCode(state) : null;
  const la = lat == null ? NaN : Number(lat), lo = lon == null ? NaN : Number(lon);
  const havePoint = Number.isFinite(la) && Number.isFinite(lo);
  if (st === "AK") {
    const id = havePoint ? alaskaZoneId(la, lo) : null;
    return id ? withZone(id, { via: "position" }) : null;
  }
  if (st === "HI" && havePoint) {
    const id = hawaiiZoneId(la, lo);
    if (id) return withZone(id, { via: "position" });
  }
  const byCounty = st && (county || SINGLE_ZONE_STATE[st]) ? zoneForCounty(st, county, havePoint ? { lat: la } : null) : null;
  if (byCounty) return byCounty;
  // A county with no assignment is a KNOWN gap, not an excuse to fall through to a coarse
  // envelope that would answer confidently for a county we deliberately never assigned.
  if (st && county) {
    const inState = havePoint ? zoneForPoint(la, lo, st) : null;
    if (inState && inState.state === st) return { ...inState, unassignedCounty: String(county) };
    return null;
  }
  if (st) return havePoint ? zoneForPoint(la, lo, st) : null;
  return havePoint ? zoneForPoint(la, lo) : null;
}

/* Grid-north-vs-true-north convergence at a point, in degrees (positive = grid north EAST of true north), in the zone that resolves
 * for {state, county} / the point, or the `zone` handed in. Returns **null** — an honest unknown, never 0 — where no zone resolves
 * (0 is a real answer: "on the central meridian"). Moved here from `deedAlign.js` (B1134752); `deedAlign.js` re-exports it. */
export function gridConvergenceDeg(lat, lon, { state = null, county = null, zone: given = null } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const zone = given || resolveZone({ state, county, lat, lon });
  if (!zone) return null; // no modelled zone here — refuse, never guess
  return gridConvergenceDegIn(lat, lon, zone);
}
