/* directions — the place-panel address link (NEW-2, owner: "Address is not shown on mobile,
 * and where it is shown it is inert text. It should be tappable and open directions"). A plain
 * maps URL, no SDK, no key, no paid API — Apple Maps on iOS/Safari (Michael's own device),
 * Google Maps' directions URL everywhere else. `ua` is an injectable parameter (defaulting to
 * `navigator.userAgent`) purely so this is unit-testable without a DOM.
 */

export function preferAppleMaps(ua) {
  const s = ua ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (!s) return false;
  const isIOS = /iPad|iPhone|iPod/.test(s);
  // Safari's own UA also contains "Safari", but so does Chrome's/Edge's/Opera's/Firefox's-on-iOS
  // (they all embed a WebKit "Safari" token for compatibility) — a genuine Safari UA is the one
  // that says "Safari" and none of the other engines' own markers.
  const isSafari = /Safari/i.test(s) && !/Chrome|CriOS|FxiOS|Edg|OPR|Android/i.test(s);
  return isIOS || isSafari;
}

/** null when there's nowhere to point to (no coordinates) — callers render no link at all. */
export function directionsUrl(lat, lon, ua) {
  if (lat == null || lon == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;
  return preferAppleMaps(ua)
    ? `https://maps.apple.com/?daddr=${lat},${lon}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}
