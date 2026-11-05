/* noteTarget — what a map note is being attached TO, and where the map must put it so it stays
 * visible while the composer is open. Pure: no Leaflet, no DOM, no React (test/noteTarget.test.js).
 *
 * WHY THIS EXISTS (owner report 2026-10-08, iPhone): choosing "Add a note" used to clear the parcel
 * selection and the decide bar, so the thing being annotated vanished and the composer only said
 * "On a parcel". Three small answers fix that and all three are decisions, not drawing:
 *   1. NAME it           — `noteTargetLabel`: the saved site's name, else the parcel's address or
 *                          account, else the pin's coordinates. Never a bare "On a parcel".
 *   2. KEEP IT IN VIEW   — `panToFitRect`: the smallest pan that puts the target in the part of the
 *                          map the composer is NOT covering (and the on-screen keyboard is not).
 *   3. SIZE THE COMPOSER — `composerBox`: its bottom edge and tallest allowed height given the
 *                          keyboard, so the card and the target are both visible at once.
 */

const EARTH_M = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle metres between two lat/lon points (haversine). */
export function metersBetween(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function ringContains(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a GeoJSON Polygon/MultiPolygon contains the point (outer ring only — a site's origin is
 * never in a hole worth distinguishing for a label). */
export function geomContains(geom, lon, lat) {
  if (!geom || !geom.coordinates) return false;
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  return polys.some((p) => Array.isArray(p) && Array.isArray(p[0]) && ringContains(p[0], lon, lat));
}

/** How close a saved site's origin must be to a dropped pin to be "that site", in metres. */
export const SITE_NEAR_PIN_M = 100;

/** The saved site this anchor sits on, or null. A parcel anchor matches a site whose origin lies
 * inside the parcel (or within SITE_NEAR_PIN_M of the anchor's own point); a pin matches by
 * distance only. Nearest wins, so two adjacent sites never swap names. */
export function siteAtAnchor(anchor, sites) {
  if (!anchor || !Array.isArray(sites)) return null;
  let best = null, bestD = Infinity;
  for (const s of sites) {
    const o = s?.origin;
    if (!o || typeof o.lat !== "number" || typeof o.lon !== "number") continue;
    const d = metersBetween({ lat: anchor.lat, lon: anchor.lon }, o);
    const inside = anchor.kind === "parcel" && geomContains(anchor.parcelGeom, o.lon, o.lat);
    if (!inside && d > SITE_NEAR_PIN_M) continue;
    const rank = inside ? Math.min(d, SITE_NEAR_PIN_M) : d;
    if (rank < bestD) { best = s; bestD = rank; }
  }
  return best;
}

/** A readable name for the parcel selection (the address if it has one, else the account id), for
 * an anchor that has no saved site behind it. Several parcels read as a count, led by the first. */
export function selectionLabel(selected) {
  const list = Array.isArray(selected) ? selected : [];
  if (!list.length) return "";
  const one = (p) => String(p?.addr || "").trim() || (p?.acct ? `Account ${String(p.acct).trim()}` : "");
  const first = one(list[0]);
  if (list.length === 1) return first;
  return first ? `${first} + ${list.length - 1} more` : `${list.length} parcels`;
}

/** What the composer says the note is attached to. Always a NAME the owner can recognise:
 * `{ kind: "site"|"parcel"|"pin", text }`. `anchor.label` is the selection label stamped when the
 * composer opened from the decide bar; it is only a fallback behind a saved site's own name. */
export function noteTargetLabel(anchor, sites) {
  if (!anchor) return { kind: "pin", text: "" };
  const site = siteAtAnchor(anchor, sites);
  const siteName = String(site?.site || site?.name || "").trim();
  if (siteName) return { kind: "site", text: siteName };
  if (anchor.kind === "parcel") {
    const own = String(anchor.label || "").trim()
      || (anchor.parcelApn ? `Account ${String(anchor.parcelApn).split(",")[0].trim()}` : "");
    return { kind: "parcel", text: own || "selected parcel" };
  }
  const lat = Number(anchor.lat), lon = Number(anchor.lon);
  const where = Number.isFinite(lat) && Number.isFinite(lon) ? ` (${lat.toFixed(4)}, ${lon.toFixed(4)})` : "";
  return { kind: "pin", text: `dropped pin${where}` };
}

/** Where the composer sits and how tall it may be. `containerH` is the map's height, `kbInset` the
 * part of the map's bottom the on-screen keyboard covers (0 with no keyboard). */
export function composerBox({ containerH, kbInset = 0, bottomGap = 44, topReserve = 64 } = {}) {
  const bottom = Math.max(8, kbInset > 0 ? kbInset + 8 : bottomGap);
  const maxHeight = Math.max(160, Math.floor(containerH - bottom - topReserve));
  return { bottom, maxHeight };
}

/** The pan, in px, that puts a target rect inside the map's visible safe area.
 *   rect  {left, top, right, bottom} in map-container px   (a pin is a zero-size rect)
 *   size  {w, h} the map container
 *   inset {top, right, bottom, left} px the chrome covers (composer, toolbar, keyboard)
 * Returns {dx, dy}: how far the CONTENT must move (positive = right/down), or {0, 0} when it is
 * already inside. A target taller/wider than the safe area is centred in it instead of clipped.
 * The caller pans the map by (-dx, -dy). */
export function panToFitRect(rect, size, inset) {
  const safe = {
    left: inset.left, top: inset.top,
    right: size.w - inset.right, bottom: size.h - inset.bottom,
  };
  const axis = (lo, hi, sLo, sHi) => {
    if (sHi <= sLo) return 0;
    if (hi - lo > sHi - sLo) return (sLo + sHi) / 2 - (lo + hi) / 2;
    if (lo < sLo) return sLo - lo;
    if (hi > sHi) return sHi - hi;
    return 0;
  };
  return {
    dx: Math.round(axis(rect.left, rect.right, safe.left, safe.right)),
    dy: Math.round(axis(rect.top, rect.bottom, safe.top, safe.bottom)),
  };
}

/** The on-screen keyboard's overlap with the map's bottom edge, from the visual viewport. With no
 * visual viewport (desktop, old browsers) it is 0. `mapBottom` is the map container's
 * getBoundingClientRect().bottom in layout-viewport px. */
export function keyboardInset({ mapBottom, vvTop = 0, vvHeight, innerHeight }) {
  if (!(vvHeight > 0) || !(innerHeight > 0)) return 0;
  const visibleBottom = vvTop + vvHeight;
  const covered = mapBottom - visibleBottom;
  // A browser toolbar collapsing is not a keyboard: only a large overlap counts.
  return covered > 120 ? Math.round(covered) : 0;
}
