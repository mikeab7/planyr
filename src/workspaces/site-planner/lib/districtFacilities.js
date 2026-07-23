/* PR-K (K7) — DRAINAGE-DISTRICT FACILITIES INGEST (scaffold).
 *
 * The Brookshire–Katy Drainage District (BKDD, Waller County) publishes its facilities — channels,
 * district-designated floodways / drainage rights-of-way — through an ArcGIS Web AppBuilder viewer at
 * gisclient.quiddity.com (item 4e6a1941ed214fa6b702db63f5d28202). This module DISCOVERS the ArcGIS
 * REST feature services behind that viewer and ingests the facilities so the pond logic can tell when
 * a pond sits under a DISTRICT-designated floodway / ROW (a permit + no-encroachment concern that is
 * DISTINCT from a FEMA regulatory floodway) and can name the receiving channel for the outfall line.
 *
 * DESIGN RULES:
 *  • Pure + injectable I/O. Every network call goes through a `fetchJson(url) => Promise<object>` the
 *    caller supplies (real fetch adapted to JSON), so this whole module is Node/vitest-testable and
 *    never touches the DOM. It performs NO fetch on its own.
 *  • GRACEFUL DEGRADATION, never fake data. If the config can't be read, the services can't be
 *    discovered, or a query is auth-walled, we return `{ degraded: true }` carrying the district id and
 *    a log of every attempt — and the caller labels the receiving channel "district facility (assumed)"
 *    rather than inventing a name. We never synthesize a facility we didn't actually read.
 *  • DISTRICT ≠ FEMA. A district-designated floodway/ROW gets DISTRICT copy (permit + district review),
 *    never the FEMA "no-rise certification" language — they are separate regulatory regimes.
 *
 * ⚠ The live fetch is egress-blocked in the sandbox (external GIS host), so wiring the live ingest is a
 * LIVE-VERIFY item; this scaffold + its unit tests ship now behind the injectable seam. */

// The known BKDD Web AppBuilder viewer. `portal` is the ArcGIS portal that serves the item data; the
// WAB app's config (item data) points at a web map whose operational layers carry the REST service URLs.
export const BKDD_APPVIEWER = Object.freeze({
  districtId: "bkdd",
  districtLabel: "Brookshire–Katy Drainage District",
  portal: "https://gisclient.quiddity.com/portal",
  itemId: "4e6a1941ed214fa6b702db63f5d28202",
});

// The receiving-channel label to show when the district's facilities could NOT be read — honest about
// the gap (an assumption), never a fabricated channel name.
export const ASSUMED_CHANNEL_TAG = "district facility (assumed)";

/* Plain-English DISTRICT flag copy — deliberately NOT the FEMA no-rise language. Names the district and
 * the permit concern. Pure; em-dash-free. */
export function districtFloodwayNote(districtLabel = BKDD_APPVIEWER.districtLabel) {
  return (
    `In the ${districtLabel}'s designated floodway or drainage right-of-way: a district permit and a ` +
    `no-encroachment review apply. This is a DISTRICT designation, separate from a FEMA regulatory ` +
    `floodway. Confirm the setback and permit path with the district before berming or building here.`
  );
}

/* Screening note shown when we know the district but not its facilities (degraded path). Pure. */
export function districtIdNote(districtLabel = BKDD_APPVIEWER.districtLabel) {
  return (
    `This site falls inside the ${districtLabel}. The district's facilities layer could not be read ` +
    `automatically, so any receiving channel is shown as an assumption. Confirm district floodway / ROW ` +
    `and the receiving channel with the district.`
  );
}

// Classify a facility layer/feature by its name into the categories the pond logic cares about. A
// district "floodway" or "ROW / easement" is the encroachment concern; a "channel" feeds the outfall
// identity; everything else is context only. Pure, case-insensitive, heuristic (screening).
export function facilityKind(name = "") {
  const s = String(name).toLowerCase();
  if (/floodway/.test(s)) return "floodway";
  if (/\brow\b|right[-\s]?of[-\s]?way|easement/.test(s)) return "row";
  if (/channel|ditch|bayou|creek|drainage way|drainageway|outfall|conveyance/.test(s)) return "channel";
  return "other";
}

// Walk a web map's operationalLayers (group layers nest under `.layers`) into a flat list of layers
// that carry a REST `url`. Pure.
function collectOperationalLayers(mapData) {
  const out = [];
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const l of arr) {
      if (l && typeof l === "object") {
        if (l.url) out.push({ url: String(l.url), name: l.title || l.id || "" });
        if (Array.isArray(l.layers)) walk(l.layers);
      }
    }
  };
  walk(mapData && mapData.operationalLayers);
  return out;
}

async function tryFetch(url, fetchJson, attempts) {
  try {
    const data = await fetchJson(url);
    attempts.push({ url, ok: true });
    return data;
  } catch (e) {
    attempts.push({ url, ok: false, error: String((e && e.message) || e) });
    return null;
  }
}

function degraded(appviewer, attempts, reason) {
  return {
    ok: false,
    degraded: true,
    districtId: appviewer.districtId,
    districtLabel: appviewer.districtLabel,
    services: [],
    attempts,
    reason,
  };
}

/* Discover the ArcGIS REST feature services behind the district's Web AppBuilder viewer:
 *   item data (WAB config) -> map.itemId -> web map data -> operationalLayers[].url
 * Returns { ok, degraded, districtId, districtLabel, services:[{url,name,kind}], attempts, reason? }.
 * Never throws — every failure degrades gracefully with the attempt log. */
export async function discoverDistrictServices({ appviewer = BKDD_APPVIEWER, fetchJson } = {}) {
  const attempts = [];
  if (typeof fetchJson !== "function") return degraded(appviewer, attempts, "no fetchJson provided");
  const appData = await tryFetch(`${appviewer.portal}/sharing/rest/content/items/${appviewer.itemId}/data?f=json`, fetchJson, attempts);
  const webmapId = appData && appData.map && appData.map.itemId;
  if (!webmapId) return degraded(appviewer, attempts, "app config carried no web map");
  const mapData = await tryFetch(`${appviewer.portal}/sharing/rest/content/items/${webmapId}/data?f=json`, fetchJson, attempts);
  const layers = collectOperationalLayers(mapData);
  const services = layers.map((l) => ({ url: l.url, name: l.name, kind: facilityKind(l.name) }));
  if (!services.length) return degraded(appviewer, attempts, "web map carried no REST service layers");
  return { ok: true, degraded: false, districtId: appviewer.districtId, districtLabel: appviewer.districtLabel, services, attempts };
}

/* Pure decision layer over an already-ingested facility set: does the district designate a floodway /
 * ROW here, and what is the receiving channel's name? Facilities are the caller's ingested features,
 * each `{ kind, name }` (kind from `facilityKind`, geometry-intersection is the caller's job / already
 * filtered to the site). Returns a structured verdict the pond logic renders. Pure.
 *   - hasDistrictFloodway: a district floodway or ROW overlaps -> DISTRICT amber flag + permit note.
 *   - channelName: the nearest named district channel for the outfall/tailwater identity (or null).
 *   - degraded: pass the discovery/query degraded flag through so the caller can show the assumed tag. */
export function classifyDistrictFacilities({ facilities = [], degraded: wasDegraded = false, districtLabel = BKDD_APPVIEWER.districtLabel } = {}) {
  const fw = facilities.filter((f) => f && (f.kind === "floodway" || f.kind === "row"));
  const channels = facilities.filter((f) => f && f.kind === "channel" && f.name);
  const hasDistrictFloodway = fw.length > 0;
  return {
    districtLabel,
    degraded: !!wasDegraded,
    hasDistrictFloodway,
    // DISTRICT flag copy (never the FEMA no-rise language) when a district floodway/ROW is present.
    flagNote: hasDistrictFloodway ? districtFloodwayNote(districtLabel) : null,
    // The receiving channel identity for the outfall/tailwater line, or the honest assumed tag.
    channelName: channels.length ? channels[0].name : null,
    channelTag: channels.length ? "district facility" : ASSUMED_CHANNEL_TAG,
  };
}
