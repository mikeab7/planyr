/* "Place on map" auto-placement cascade (B182 / NEW-3). Pure + browser-free so the
 * decision logic is unit-tested. On placing a filed drawing, walk methods best→fallback
 * and stop at the first that runs with confidence; route every result through NEW-4's
 * verification before it's trusted. Never silently fall through a failed high rung —
 * each skipped rung is reported with WHY.
 *
 * Rungs, best→fallback:
 *   1. embedded — drawing already in a known CRS → reproject to EPSG:2278, land exactly,
 *      no scaling. (Heavier; GeoPDF/CRS reproject is the BACKEND tranche — stubbed here
 *      behind a `reproject` seam.)
 *   2. boundary — solve scale+rotation+translation in one fit by matching the drawing's
 *      boundary to the held parcel/survey geometry. Preferred over any stated scale (a
 *      printed scale is a claim about plot size and breaks under "fit to page"/copier
 *      resize; geometry is ground truth). Runs HERE when corresponded boundary points
 *      exist (reuses the B73 least-squares similarity fit); otherwise stubbed pending the
 *      backend boundary-extraction pass.
 *   3. graphic  — scale bar or labeled dimension; divide drawn length by the annotated
 *      real value (resize-invariant). Prefer the longest baseline. Use a north arrow for
 *      rotation, then position to the parcel. LIVE (reuses overlayAlign/overlayScale).
 *   4. manual   — last resort: trace a labeled dimension or two points by hand (the
 *      existing B73 Trace / Align-to-map tools). LIVE (interactive; the cascade returns
 *      it as the method to invoke when nothing auto-runs).
 */
import { placementReadiness } from "../../../shared/files/fileFacts.js";
import { imagePointToWorld, scaleOverlayAbout, solveSimilarityLSQ, applySimilarityToOverlay } from "./overlayAlign.js";
import { scaleFromDimension, verifyDimension, crossCheck } from "./placementVerify.js";

export const RUNGS = [
  { id: "embedded", n: 1, label: "Embedded coordinates", auto: true },
  { id: "boundary", n: 2, label: "Fit to known boundary", auto: true },
  { id: "graphic",  n: 3, label: "Measure a graphic",     auto: true },
  { id: "manual",   n: 4, label: "Manual calibration",    auto: false },
];

const centerWorld = (o) => imagePointToWorld(o, o.imgW / 2, o.imgH / 2);

/* Pick the best rung the facts support (first ready rung, best→fallback). */
export function chooseMethod(facts) {
  const r = placementReadiness(facts);
  for (const rung of RUNGS) if (r[rung.id] && r[rung.id].ready) return { id: rung.id, n: rung.n, label: rung.label, why: r[rung.id].why };
  return { id: "manual", n: 4, label: "Manual calibration", why: r.manual.why };
}

/* Rung 1 — embedded coordinates. Browser-side this is a stub: reprojecting a GeoPDF's
 * embedded CRS to EPSG:2278 is the backend tranche. Wired behind a `reproject` seam so
 * the backend can drop in without touching the cascade. */
export function placeFromEmbeddedCoords({ facts, overlay, reproject } = {}) {
  if (!(facts && facts.embeddedCoords && facts.embeddedCoords.present))
    return { ran: false, available: false, why: "No embedded coordinates on the sheet." };
  if (typeof reproject !== "function")
    return { ran: false, available: false, why: "Reprojecting the embedded CRS to EPSG:2278 runs in the backend tranche (not yet wired)." };
  const patch = reproject({ facts, overlay });
  if (!patch) return { ran: false, available: true, why: "Reprojection produced no transform." };
  return { ran: true, available: true, patch, confidence: "high" };
}

/* Rung 2 — fit the drawing's boundary to the held parcel/survey geometry. Runs when
 * corresponded points exist: pairs of [{ img:{ix,iy} (drawing px), world:{x,y} (parcel
 * ft) }]. Reuses the B73 least-squares similarity fit and reports its RMS residual so a
 * poor fit is visible. Without corresponded points (the common case until the backend
 * extracts the drawing boundary) it stubs out with the reason. */
export function fitToBoundary({ overlay, pairs } = {}) {
  if (!Array.isArray(pairs) || pairs.length < 2)
    return { ran: false, available: false, why: "Matching the drawing's boundary to the parcel needs the boundary extracted from the sheet (backend tranche)." };
  const lsq = pairs.map((p) => ({ from: imagePointToWorld(overlay, p.img.ix, p.img.iy), to: p.world }));
  const T = solveSimilarityLSQ(lsq);
  if (!T) return { ran: false, available: true, why: "Boundary points are degenerate (coincident)." };
  const patch = applySimilarityToOverlay(overlay, T);
  return { ran: true, available: true, patch, residualFt: T.residual, confidence: T.residual <= 2 ? "high" : T.residual <= 10 ? "medium" : "low" };
}

/* Rung 3 — scale from a measured graphic (scale bar or labeled dimension). Divides the
 * drawn length by the annotated real value → a resize-invariant feet-per-unit, applied
 * about an anchor (keeps a chosen point fixed). north (deg, optional) rotates the sheet
 * to ground north. graphic = { px (drawn length), realFt (annotated value), axis? }. */
export function placeByGraphic({ overlay, graphic, anchorWorld, northDeg } = {}) {
  if (!graphic || !(graphic.px > 0) || !(graphic.realFt > 0))
    return { ran: false, available: false, why: "No measurable scale bar or labeled dimension." };
  const target = scaleFromDimension(graphic.px, graphic.realFt); // ft per drawing unit
  const k = target / overlay.ftPerPx;
  const anchor = anchorWorld || centerWorld(overlay);
  const scaled = scaleOverlayAbout(overlay, anchor, k);
  if (!scaled) return { ran: false, available: true, why: "Scale factor is invalid." };
  const patch = { ...scaled };
  if (typeof northDeg === "number" && isFinite(northDeg)) patch.rotation = ((((overlay.rotation || 0) - northDeg) % 360) + 360) % 360;
  return { ran: true, available: true, patch, ftPerUnit: target, baselineFt: graphic.realFt, baselinePx: graphic.px, confidence: graphic.realFt >= 100 ? "high" : "medium" };
}

/* Run the cascade. Returns the chosen method, the transform patch (or null when the best
 * available rung is interactive/manual), a verification result (NEW-4) computed on the
 * placed result, an optional cross-check of two independent reads, and the list of
 * skipped higher rungs with WHY each was skipped.
 *
 * inputs:
 *   facts, overlay                          — NEW-2 facts + current overlay transform
 *   anchorWorld?                            — world point to keep fixed during a scale
 *   graphic?       { px, realFt, axis? }    — primary scale graphic (rung 3)
 *   boundaryPairs? [{ img, world }]         — corresponded boundary points (rung 2)
 *   reproject?     fn                       — embedded-CRS reprojector (rung 1, backend)
 *   verifyGraphic? { px, statedFt, label? } — independent labeled dimension to verify
 *   crossGraphic?  { px, realFt, axis? }    — independent read for the cross-check
 */
export function runCascade({ facts, overlay, anchorWorld, graphic, boundaryPairs, reproject, verifyGraphic, crossGraphic } = {}) {
  const skipped = [];
  let chosen = null, result = null;

  for (const rung of RUNGS) {
    if (rung.id === "manual") break; // manual is the interactive fallback, never auto-run
    let r;
    if (rung.id === "embedded") r = placeFromEmbeddedCoords({ facts, overlay, reproject });
    else if (rung.id === "boundary") r = fitToBoundary({ overlay, pairs: boundaryPairs });
    else r = placeByGraphic({ overlay, graphic, anchorWorld, northDeg: facts && facts.northArrow && facts.northArrow.present ? facts.northArrow.deg : undefined });
    if (r.ran) { chosen = rung; result = r; break; }
    skipped.push({ rung: rung.id, n: rung.n, label: rung.label, available: !!r.available, why: r.why });
  }

  if (!chosen) {
    // Nothing auto-ran → manual calibration (rung 4), the always-available last resort.
    return { method: "manual", n: 4, label: "Manual calibration", patch: null, status: "manual",
      note: "Trace a labeled dimension or pick two points by hand (rung 4).", verification: null, crossCheck: null, skipped };
  }

  const placed = { ...overlay, ...result.patch };

  // Auto-verification (NEW-4): measure an independent labeled dimension on the PLACED
  // result and compare to its printed value — a number, not an eyeball.
  let verification = null;
  if (verifyGraphic && verifyGraphic.px > 0) {
    verification = verifyDimension({ measuredFt: verifyGraphic.px * placed.ftPerPx, statedFt: verifyGraphic.statedFt, stated: verifyGraphic.stated, label: verifyGraphic.label });
  }
  // Cross-check (NEW-4): two independent scale reads against each other → agree / nonuniform.
  let cross = null;
  if (graphic && crossGraphic && graphic.px > 0 && crossGraphic.px > 0) {
    cross = crossCheck(
      { scale: scaleFromDimension(graphic.px, graphic.realFt), axis: graphic.axis, source: "primary" },
      { scale: scaleFromDimension(crossGraphic.px, crossGraphic.realFt), axis: crossGraphic.axis, source: "cross" },
    );
  }

  // Overall status folds verification + cross-check in. A failed verification or a
  // non-uniform cross-check downgrades an otherwise-confident placement (high-severity:
  // a confidently-wrong placement looks done but measures wrong).
  let status = "placed";
  if (verification && verification.status === "fail") status = "verify-failed";
  else if (cross && cross.status === "nonuniform") status = "nonuniform";
  else if (verification && verification.status === "warn") status = "placed-warn";

  return { method: chosen.id, n: chosen.n, label: chosen.label, patch: result.patch,
    confidence: result.confidence || null, residualFt: result.residualFt ?? null,
    verification, crossCheck: cross, status, skipped };
}
