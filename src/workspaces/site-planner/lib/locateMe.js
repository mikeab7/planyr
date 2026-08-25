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
