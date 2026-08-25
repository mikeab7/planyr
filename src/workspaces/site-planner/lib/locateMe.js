/* "Locate me" — the browser's own position, honestly presented (NEW — the mobile pinch/locate/
 * telemetry lap). Pure decision + formatting only; the Leaflet control and the geolocation call
 * itself live in MapFinder.jsx (this module has no window/Leaflet dependency, so it's unit-testable
 * away from a browser).
 *
 * A phone's GPS fix is genuinely precise (tens of feet); a laptop with no GPS chip falls back to
 * Wi-Fi/IP-based positioning, which the SAME browser API reports through the SAME `accuracy` field
 * (a radius in meters) but which can be miles off. Presenting both the same way — a tight "you are
 * here" dot with a snug accuracy ring — would tell the desktop user something false. So drawing the
 * accuracy circle (the part that visually claims "this precise") is gated on a threshold: the map
 * still centers on whatever position was reported (it's the best guess available), but a vague fix
 * says so in words instead of drawing a circle that implies more confidence than the data has.
 */
import { metersToFeet } from "../../../shared/coordinates/index.js";

// Meters. A phone GPS fix is normally tens of feet (worst case ~100 ft / 30 m indoors/urban
// canyon); Wi-Fi-based positioning on a laptop commonly lands in the hundreds of meters; a pure
// IP-address guess is routinely multiple KILOMETERS. 500 m sits above ordinary GPS/Wi-Fi noise
// and below "this only knows roughly which side of town I'm on" — worth restating if a live
// reading on real devices says otherwise, but it is not a guess pulled from nowhere.
export const ACCURACY_CIRCLE_THRESHOLD_M = 500;

// Pure: is this accuracy (meters, from GeolocationPosition.coords.accuracy) tight enough that
// drawing a "you are here" accuracy circle is honest rather than misleading?
export function shouldShowAccuracyCircle(accuracyMeters) {
  return Number.isFinite(accuracyMeters) && accuracyMeters > 0 && accuracyMeters <= ACCURACY_CIRCLE_THRESHOLD_M;
}

const FT_PER_MI = 5280;

// Pure: format an accuracy radius (meters) the way this app states distances — feet below a
// mile, miles above (mirrors how the rest of the app switches units by magnitude rather than
// ever printing "26400 ft").
export function formatAccuracyFt(accuracyMeters) {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters <= 0) return null;
  const ft = metersToFeet(accuracyMeters);
  if (ft < FT_PER_MI) return `±${Math.round(ft).toLocaleString()} ft`;
  return `±${(ft / FT_PER_MI).toFixed(1)} mi`;
}

// Pure: the browser's GeolocationPositionError.code → a short, honest, owner-facing sentence.
// Never a raw error.message (browser-authored, inconsistent wording) and never silent.
export function locateErrorMessage(code) {
  if (code === 1) return "Location access was denied — allow location access for this site in your browser settings to use this.";
  if (code === 3) return "Finding your location took too long — try again, or move somewhere with a clearer signal.";
  return "Couldn't determine your location right now.";
}

/* NEW-MAPCTRL-2 — "spinning then timing out on every click is wrong for a permanently-denied
 * environment" (a company Chrome policy that blocks Location Services outright).
 *
 * ⛔ CORRECTED (owner measurement, same day as the original report): `locateAvailability`'s
 * 'blocked' state was first written assuming an enterprise policy would show up as
 * `navigator.permissions.query({name:'geolocation'})` resolving 'denied'. Measured on the
 * owner's real machine against the real deployed app: it resolves **'prompt'**. A policy of
 * this shape blocks the geolocation REQUEST itself, silently, without pre-announcing through
 * the Permissions API — so this function's 'blocked' branch does NOT catch his case, and never
 * claimed to be a dependency for the reactive path (see `MapFinder.jsx`'s own corrected note).
 * It stays useful for what it CAN see — an explicit HTTPS/API/permission absence — but the
 * actual fix for a request that silently never resolves is the caller's own bounded timeout
 * plus an independent watchdog, not a prediction made ahead of time. */

// How far a reported fix may be off before it stops being a USABLE location at all — distinct
// from ACCURACY_CIRCLE_THRESHOLD_M above, which only decides whether to draw a TIGHT ring.
// Desktop IP-based geolocation (no GPS chip, no Wi-Fi positioning database hit) commonly reports
// 20-50 km of accuracy. Flying the map there — or drawing a multi-mile "you are here" circle over
// half a county — presents a guess as an answer. 15 km sits above ordinary Wi-Fi/cellular
// positioning (typically hundreds of metres to a few km) and below the range a bare IP lookup
// actually returns, so it separates "a real, if loose, fix" from "not really a location".
export const ACCURACY_USABLE_THRESHOLD_M = 15000;

// Pure: is this accuracy good enough to act on AT ALL — move the map, drop a marker — as opposed
// to merely not warranting the tight ring (shouldShowAccuracyCircle, above).
export function isAccuracyUsable(accuracyMeters) {
  return Number.isFinite(accuracyMeters) && accuracyMeters > 0 && accuracyMeters <= ACCURACY_USABLE_THRESHOLD_M;
}

// Pure: the honest sentence for a fix too vague to use — never silently kept, never flown to.
export function garbageAccuracyMessage(accuracyMeters) {
  const acc = formatAccuracyFt(accuracyMeters);
  return acc
    ? `That fix isn't accurate enough to use (accuracy ${acc}) — it looks like a rough network guess rather than a real location. Try a device with GPS, or move somewhere with a clearer signal.`
    : "That fix isn't accurate enough to use — it looks like a rough network guess rather than a real location.";
}

/* Pure: why the control cannot be used right now, given what the environment reports — asked
 * BEFORE ever calling getCurrentPosition, so a permanently-blocked control never spins.
 *   'ready'       — normal: a click may prompt, succeed, or fail; that's the click handler's job.
 *   'insecure'    — geolocation requires HTTPS, and this page isn't served over one.
 *   'unsupported' — this browser/environment exposes no Geolocation API at all.
 *   'blocked'     — the browser, an enterprise/network policy, or a Permissions-Policy header has
 *                   already denied the permission — no prompt will ever appear. */
export function locateAvailability({ isSecureContext, hasGeolocation, permissionState } = {}) {
  if (isSecureContext === false) return "insecure";
  if (hasGeolocation === false) return "unsupported";
  if (permissionState === "denied") return "blocked";
  return "ready";
}

// Pure: the tooltip/aria text for a control `locateAvailability` says cannot be used right now —
// rendered on the control itself (an anchored tooltip), never as a page-covering banner, because
// a permanently-blocked state is not a failed ATTEMPT, it's a standing fact about the environment.
export function locateUnavailableTooltip(availability) {
  if (availability === "insecure") return "Finding your location needs a secure (https) connection — unavailable on this preview.";
  if (availability === "unsupported") return "This browser doesn't support finding your location.";
  if (availability === "blocked") return "Location is blocked by your browser or a company network policy.";
  return "Find my location";
}
