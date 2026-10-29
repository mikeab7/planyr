/* Tennessee stream buffers — the PURE half (B2521584). No Leaflet, no DOM, no network.
 *
 * WHAT IS DRAWN. A 30 ft band on each side of every stream centreline — the natural riparian buffer zone the TDEC Construction General Permit
 * (TNR100000) requires between a waterbody and the limits of disturbance. The permit lets a project AVERAGE the width, with no point narrower than
 * half of it (15 ft), and averages each side of a stream on its own — so the band is the required AVERAGE, not a hard setback line.
 *
 * WHAT IS NOT DRAWN, and said on the layer. The permit asks 60 ft (average; no point under 30 ft) where the discharge is to Exceptional Tennessee
 * Waters or waters with unavailable siltation / habitat parameters. TDEC publishes those reaches as its "CGP Unavailable Waters" layer, but that server
 * (tdeconline.tn.gov) refuses the relay and cannot be read from a browser Planyr can verify — measured 2026-10-29 — so the 60 ft tier is NOT drawn and
 * the row says so rather than draw 30 ft as if it were the whole answer. Adding it is a data source, not a rewrite: widen `TN_BUFFER_TIERS`.
 *
 * Only streams are buffered (the same NHD rule the Georgia layer uses — `georgiaStreamBuffers.isBufferedStream`: ftype 460, not ephemeral; never
 * canals, ditches, artificial paths or pipelines). A wet-weather conveyance is not "waters of the state" and carries no buffer — NHD cannot tell one from
 * a stream, so a small headwater channel can be drawn that a TDEC hydrologic determination (rule 0400-40-17) would call a conveyance. Local governments
 * add their own post-construction buffers on top (an MS4 city such as Murfreesboro or Nashville) — NOT drawn: their width depends on drainage area and
 * stream class the data does not carry.
 *
 * ⛔ MEASURED FROM THE CENTRELINE, NOT THE BANK. The permit measures from the top of the stream bank; NHD gives a centreline, so the band is too narrow
 * by half the channel width on a wide stream. Said on the layer; a survey of the bank governs.
 *
 * Reuses `corridorRingLngLat` (the pipeline-corridor buffer: local flat-earth feet frame, no new dependency). */
import { corridorRingLngLat } from "./pipelineCorridor.js";
import { isBufferedStream, linePartsOf } from "./georgiaStreamBuffers.js";

export const TN_BUFFER_TIERS = {
  standard: { id: "standard", eachSideFt: 30, color: "#b45309", label: "30 ft construction buffer (average)" }, // design-exempt: map ink for a drawn buffer tier (cartography, not UI chrome)
};

/* THE FUNCTION: NHD flowlines → the bands to draw. returns [{ ring: [[lng,lat],…], tier }]. Pure. */
export function streamBufferBandsTn({ nhd = null } = {}) {
  const bands = [];
  for (const feature of (nhd && nhd.features) || []) {
    if (!isBufferedStream(feature.properties)) continue;
    for (const part of linePartsOf(feature)) {
      if (!part || part.length < 2) continue;
      const ring = corridorRingLngLat(part, TN_BUFFER_TIERS.standard.eachSideFt * 2);
      if (ring && ring.length >= 3) bands.push({ ring, tier: TN_BUFFER_TIERS.standard });
    }
  }
  return bands;
}

/* The legend/ⓘ line — the tier actually present in the bands. Pure. */
export function bufferLegendTn(bands) {
  return bands && bands.length ? [TN_BUFFER_TIERS.standard.label] : [];
}
