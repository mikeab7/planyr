/* Georgia screening cards — the PURE interpretation half (Georgia screening, Part B). Network and registry live in
 * siteAnalysis.js; this holds only the words and the arithmetic, so they unit-test without either.
 *
 * Every card here is screening, never a determination, and every card that can read "none" says WHAT IT COULD NOT
 * SEE in the same sentence (an unrecorded cemetery, an unlisted historic site, a stream the buffer rule does not
 * cover) — a bare "none found" on an incomplete layer is the fabricated all-clear this whole surface exists to avoid. */
import { fmtDistFt } from "./proximityScreen.js";
import { isBufferedStream, GA_BUFFER_TIERS } from "./georgiaStreamBuffers.js";

const uniq = (a) => [...new Set(a.filter(Boolean))];

/* Streams card — NHD flowlines near the site, reduced to the ones Georgia's buffer applies to (streams, not ditches or
 * ephemeral channels). `scr` is `screenProximity`'s result; `total` its exact count (all flowline types), which is why
 * the buffered count is taken from `ranked`. A stream on the site is a PRESENT constraint (land comes off each side);
 * one nearby is info; none is a verified absence within the buffer radius. Pure. */
export function summarizeGaStreams(scr, { bufferMi = 0.1 } = {}) {
  const ranked = ((scr && scr.ranked) || []).filter((f) => isBufferedStream(f.attrs));
  const radius = `${Math.round(bufferMi * 5280)} ft`;
  if (!ranked.length) {
    return { status: "absent", summary: `No state-waters stream within ${radius} of the site (ditches, canals and ephemeral channels are not counted).`, detail: [] };
  }
  const near = ranked[0];
  const onSite = near.distFt != null && near.distFt <= 25;
  const rule = `${GA_BUFFER_TIERS.state.eachSideFt} ft each side (Georgia Erosion & Sedimentation Act) · ${GA_BUFFER_TIERS.trout.eachSideFt} ft on a DNR trout stream · typically ${GA_BUFFER_TIERS.district.eachSideFt} ft inside the Metro North Georgia Water District — confirm with the county`;
  const detail = ranked.slice(0, 6).map((f) => `${f.attrs.gnis_name || "unnamed stream"} · ${onSite && f === near ? "crosses the site" : fmtDistFt(f.distFt)}`);
  if (onSite) {
    const n = ranked.filter((f) => f.distFt != null && f.distFt <= 25).length;
    return { status: "present", summary: `${n} state-waters stream segment${n === 1 ? "" : "s"} cross${n === 1 ? "es" : ""} the site — stream buffer applies: ${rule}.`, detail };
  }
  return { status: "info", summary: `Nearest state-waters stream ${fmtDistFt(near.distFt)} from the site (${ranked.length} within ${radius}). Buffer if it reaches the site: ${rule}.`, detail };
}

/* Gopher tortoise soils card — which DNR tiers the site's soils fall in. `rows` are the intersecting polygons' attrs. */
export function gopherSummary(rows) {
  const tiers = uniq((rows || []).map((r) => r.Tier)).sort();
  return `Soils suitable for gopher tortoise on the site — DNR tier ${tiers.join(", ")}. A modeled screen, not a survey: a tortoise survey is the real check.`;
}

/* Critical habitat card. */
export function critHabitatSummary(rows) {
  const names = uniq((rows || []).map((r) => r.comname));
  return `USFWS critical habitat on the site: ${names.slice(0, 4).join(", ")}${names.length > 4 ? ` +${names.length - 4} more` : ""}.`;
}
export const critHabitatDetail = (rows) => uniq((rows || []).map((r) => [r.comname, r.sciname].filter(Boolean).join(" — "))).slice(0, 6);

/* HSI proxTag: EPD's own Class number, shown as EPD gives it (never reinterpreted). */
export const hsiTag = (attrs) => (attrs && attrs.Class != null && String(attrs.Class).trim() !== "" ? `Class ${String(attrs.Class).trim()}` : "");

/* UST facility proxTag: EPD's own facility type (Gas Station, Farm, Industrial…), as EPD gives it — a register entry, never a leak. */
export const ustTag = (attrs) => (attrs && attrs.LOCATION_TYPE != null && String(attrs.LOCATION_TYPE).trim() !== "" && !/^not marked$/i.test(String(attrs.LOCATION_TYPE).trim()) ? String(attrs.LOCATION_TYPE).trim() : "");
