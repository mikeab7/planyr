/* compLocationText — B986096-HARDENING-9 (owner rule: "what is the purpose of having a location
 * when i placed the pin already, should this not say address??"). The comp entry sheet's
 * Location cell used to render only a confirmation of the action taken ("Pin", "2 parcels") —
 * dead weight once you already know you clicked it. This module is the pure half of turning it
 * into real information: three anchor kinds resolve to three DIFFERENT identities, and only one
 * of them is genuinely an address — substituting one for another would be a lie about what was
 * actually anchored (an APN is an identity, not an address; a site plan point is neither).
 *
 * Pure/synchronous here; the one thing that ISN'T synchronous — reverse-geocoding a bare pin's
 * lat/lon into a street address — lives in `site-planner/lib/geocode.js`'s
 * `reverseGeocodeLatLon` and is wired up + cached by `components/CompEntryGrid.jsx`. This module
 * supplies the SYNCHRONOUS fallback a pin shows before that resolves (or if it never does): the
 * anchor's own already-known county (real-estate comps always carry one once a pin is placed —
 * see `anchorCountyFlag` in `comps.js`), else the coordinates themselves. A pin's Location cell
 * therefore NEVER renders blank once a pin exists, exactly as required.
 */

/** kind: "parcel" — an APN when there is one parcel; "N parcels · County" for several. An APN is
 * an IDENTITY, never an address (`parcelApn` is a comma-joined string of account ids). */
export function parcelLocationText(anchor, countyDisplayName) {
  const apns = String(anchor?.parcelApn || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!apns.length) return null;
  if (apns.length === 1) return apns[0];
  const county = countyDisplayName ? countyDisplayName(anchor.county) : anchor?.county;
  return county ? `${apns.length} parcels · ${county}` : `${apns.length} parcels`;
}

/** kind: "site_plan" — the source document's title (falling back to its filename), because a
 * point pinned on an uploaded plan is identified by WHICH PLAN it's on, not a street address. No
 * per-point "building" sub-label exists anywhere in this app today (confirmed: a site-plan
 * overlay record carries no such field, and "multiple buildings" here means multiple separate
 * overlay ROWS, each with its own title) — so this reads as the plan's own name alone rather
 * than inventing a label the rest of the app has no way to set. */
export function siteplanLocationText(anchor, overlaysById) {
  const overlay = anchor?.sitePlanOverlayId && overlaysById ? overlaysById[anchor.sitePlanOverlayId] : null;
  if (!overlay) return null;
  return overlay.docTitle || overlay.sourceFileName || null;
}

/** kind: "pin" — the SYNCHRONOUS fallback while a reverse geocode is pending, failed, or hasn't
 * been attempted at all: the county already resolved at pin-drop time ("County, ST" — state is
 * read off the county-key's own registry entry, never guessed from the key's spelling), else the
 * coordinates themselves at 4 decimal places. Never null once lat/lon exist — a pin's Location
 * cell must never render blank. */
export function pinFallbackText(anchor, countyEntry) {
  if (typeof anchor?.lat !== "number" || typeof anchor?.lon !== "number") return null;
  if (anchor.county && countyEntry) {
    const entry = countyEntry(anchor.county);
    if (entry?.name) return entry.state ? `${entry.name}, ${entry.state}` : entry.name;
  }
  return `${anchor.lat.toFixed(4)}, ${anchor.lon.toFixed(4)}`;
}

/** ⛔ NEW-1 (B2010352, 2026-10-01) — THE ONE ANSWER to "what Location text does this comp show?",
 * for every surface: the comp detail panel, the list rows, and the KMZ balloon. The KMZ export used
 * to derive its own (`parcelLocationText` for a parcel anchor, i.e. the raw APN) while the panel
 * showed the resolved place — two derivations, two answers, the APN reading as an address. A pin
 * AND a parcel resolve identically: the reverse-geocoded street address when one is known
 * (`resolvedAddress`, from the shared pin-address cache), else the synchronous county/coordinate
 * fallback; a site plan reads as its own title. The APN is never a Location — it has its own row
 * (`comps.js`'s `compFieldRows`, "Parcel ID (APN)"). Pure; the caller supplies what it has. */
export function compLocationFor(anchor, { overlaysById = null, countyEntry = null, resolvedAddress = null } = {}) {
  if (!anchor) return null;
  if (anchor.kind === "site_plan") return siteplanLocationText(anchor, overlaysById) || pinFallbackText(anchor, countyEntry);
  return resolvedAddress || pinFallbackText(anchor, countyEntry);
}
