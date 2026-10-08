/* Deterministic probe of EVERY overlay-engine export (crop · placement · similarity fit), used by
 * test/overlayEngineGolden.test.js. The committed fixture was generated from the code as it stood
 * BEFORE the NEW-1 one-engine refactor, so a pass means the merged engine answers identically. */
export function snapshotOverlayEngine(M) {
const out = {};
const rec = (name, fn) => { try { out[name] = fn(); } catch (e) { out[name] = "THROW:" + e.message; } };
out.__exports = Object.keys(M).sort();
// ---- placement (geo) ----
const placements = [
  { centerLat: 29.786, centerLon: -95.83, ftPerPx: 0.5, rotationDeg: 0 },
  { centerLat: 29.786, centerLon: -95.83, ftPerPx: 1.25, rotationDeg: 33.3 },
  { centerLat: 32.78, centerLon: -96.8, ftPerPx: 2, rotationDeg: 271 },
  { centerLat: 39.74, centerLon: -104.99, ftPerPx: 0.75, rotationDeg: 12 },
  { centerLat: 40.7, centerLon: -74, ftPerPx: 1, rotationDeg: 5 },
  { centerLat: NaN, centerLon: 1, ftPerPx: 1 }, { centerLat: 1, centerLon: 1, ftPerPx: 0 }, null,
];
const sizes = [[800, 600], [1275, 1650], [0, 10], [4000, 3000]];
const pts = [[0, 0], [10, 20], [400, 300], [799, 599], [-5, 7.5]];
placements.forEach((p, i) => {
  rec(`validPlacement.${i}`, () => M.validPlacement(p));
  sizes.forEach(([w, h], j) => {
    rec(`corners.${i}.${j}`, () => M.overlayCornersFromPlacement(p, w, h));
    pts.forEach(([x, y], k) => {
      rec(`i2ll.${i}.${j}.${k}`, () => M.imagePointToLatLon(p, w, h, x, y));
      rec(`ll2i.${i}.${j}.${k}`, () => { const ll = M.imagePointToLatLon(p, w, h, x, y); return ll && M.latLonToImagePoint(p, w, h, ll.lat, ll.lon); });
    });
  });
  rec(`scalePlacement.${i}`, () => [0.5, 1, 2.3, 0].map((r) => M.scalePlacement(p || {}, r)));
  rec(`rotatePlacement.${i}`, () => [[0, 10], [350, 25], [10, -40], [0, 720.5]].map(([r, d]) => M.rotatePlacement(p || {}, r, d)));
});
rec("feetBetween", () => [[29.7, -95.8, 29.8, -95.7], [32.7, -96.8, 32.8, -96.7], [39.7, -105, 39.8, -104.9], [0, 0, 0, 0]].map((a) => M.feetBetween(...a)));
rec("suggest", () => [[0, 800], [100, 800], [2000, 800], [1e6, 800], [500, 0], [500, 1275, 0.3]].map((a) => M.suggestFtPerPx(...a)));
out.consts = [M.OVERLAY_SUGGEST_MIN_WIDTH_FT, M.OVERLAY_SUGGEST_MAX_WIDTH_FT];
// ---- align (canvas feet) ----
const ovs = [
  { x: 10, y: -20, imgW: 800, imgH: 600, ftPerPx: 0.5, rotation: 0 },
  { x: -300, y: 40, imgW: 1275, imgH: 1650, ftPerPx: 0.25, ftPerPxY: 0.31, rotation: 37.5 },
  { x: 0, y: 0, imgW: 100, imgH: 100, ftPerPx: 2, rotation: 359 },
  { x: 5, y: 5, imgW: 10, imgH: 20, ftPerPx: 1 },
];
ovs.forEach((o, i) => {
  pts.forEach(([x, y], k) => rec(`i2w.${i}.${k}`, () => M.imagePointToWorld(o, x, y)));
  [1, 0.5, 2.5, 0, -1, NaN, Infinity].forEach((k, j) => rec(`scaleAbout.${i}.${j}`, () => M.scaleOverlayAbout(o, { x: 7, y: -3 }, k)));
  const S2 = M.similarityTransform({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 25 });
  rec(`applySim.${i}`, () => M.applySimilarityToOverlay(o, S2));
  rec(`alignSim.${i}`, () => M.alignOverlaySimilarity(o, { x: 1, y: 2 }, { x: 11, y: 7 }, { x: 100, y: 100 }, { x: 80, y: 130 }));
  rec(`alignSimDegenerate.${i}`, () => M.alignOverlaySimilarity(o, { x: 1, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 0 }, { x: 1, y: 1 }));
});
rec("applySimNull", () => M.applySimilarityToOverlay(ovs[0], null));
const simP = [[{x:0,y:0},{x:10,y:0},{x:5,y:5},{x:5,y:25}], [{x:1,y:1},{x:1+1e-10,y:1},{x:0,y:0},{x:1,y:1}], [{x:-3,y:2},{x:7,y:9},{x:100,y:-50},{x:130,y:-20}]];
simP.forEach((a, i) => rec(`simT.${i}`, () => { const s = M.similarityTransform(...a); return s && { scale: s.scale, rotDeg: s.rotDeg, at: [{x:0,y:0},{x:3,y:4},{x:-9,y:2}].map(s.apply) }; }));
const lsq = [
  [{from:{x:0,y:0},to:{x:5,y:5}},{from:{x:10,y:0},to:{x:5,y:25}}],
  [{from:{x:0,y:0},to:{x:1,y:1}},{from:{x:10,y:0},to:{x:12,y:9.5}},{from:{x:10,y:10},to:{x:0,y:12}},{from:{x:0,y:10},to:{x:-8,y:3}}],
  [{from:{x:0,y:0},to:{x:0,y:0}},{from:{x:0,y:0},to:{x:1,y:1}}],
  [{from:{x:0,y:0},to:{x:0,y:0}}],
];
lsq.forEach((a, i) => rec(`lsq.${i}`, () => { const s = M.solveSimilarityLSQ(a); return s && { scale: s.scale, rotDeg: s.rotDeg, residual: s.residual, at: [{x:0,y:0},{x:3,y:4}].map(s.apply) }; }));
// ---- crop ----
const crops = [null, undefined, { x: 10, y: 20, w: 300, h: 200 }, { kind: "rect", x: 0, y: 0, w: 800, h: 600 }, { x: -5, y: -5, w: 5000, h: 5000 },
  { x: 1, y: 1, w: 3, h: 3 }, { x: NaN, y: 0, w: 1, h: 1 }, { kind: "poly", pts: [[10, 10], [300, 20], [200, 400]] },
  { kind: "poly", pts: [[0, 0], [800, 0], [800, 600], [0, 600]] }, { kind: "poly", pts: [[1, 1], [2, 2]] }, { kind: "poly", pts: [[10, 10], [300, 20], [200, 400], [900, 900]] },
  { kind: "poly", pts: "x" }, { kind: "weird", x: 1, y: 2, w: 100, h: 100 }, 5, "s"];
const ov = (c, extra = {}) => ({ id: "o", src: "d", imgW: 800, imgH: 600, ftPerPx: 0.5, crop: c, ...extra });
crops.forEach((c, i) => {
  [[800, 600], [100, 100], [0, 0]].forEach(([w, h], j) => {
    for (const fn of ["clampCropRect", "isFullCrop", "normalizeCrop", "normalizePolyCrop", "normalizeCropShape", "clipPathValueForCrop", "recropForRaster"])
      rec(`${fn}.${i}.${j}`, () => M[fn](c, w, h));
    rec(`isUsablePoly.${i}.${j}`, () => M.isUsablePoly(c && c.pts, w, h));
    rec(`clampPoly.${i}.${j}`, () => M.clampPolyPoints(c && c.pts, w, h));
    rec(`isFullImagePoly.${i}.${j}`, () => M.isFullImagePoly(c && c.pts, w, h));
  });
  rec(`hasCrop.${i}`, () => M.hasCrop(ov(c)));
  rec(`effRect.${i}`, () => M.effectiveCropRect(ov(c)));
  rec(`clipRectScreen.${i}`, () => M.cropClipRectScreen(ov(c), { x: 100, y: 50 }, 0.5, 2.25));
  rec(`trimFeet.${i}`, () => M.cropTrimFeet(ov(c)));
  rec(`clipShape.${i}`, () => [[0.5, undefined], [0.5, 0.31], [0, 1]].map(([fx, fy]) => M.cropClipShapeScreen(ov(c), { x: 100, y: 50 }, fx, fy, 2.25)));
  rec(`kind.${i}`, () => M.cropKind(c));
  rec(`valid.${i}`, () => M.isValidCropShape(c));
  rec(`savedRect.${i}`, () => M.savedRectOf(c));
  rec(`savedPts.${i}`, () => M.savedPtsOf(c));
  rec(`polyArea.${i}`, () => M.polygonAreaPx(c && c.pts));
  rec(`rectToPoly.${i}`, () => M.rectToPolyPoints(c));
  rec(`polyToRect.${i}`, () => M.polyPointsToRect(c && c.pts));
});
[null, { x: 0, y: 0, w: 4, h: 4 }].forEach((r, i) => rec(`rect2poly.${i}`, () => M.rectToPolyPoints(r)));
rec("trimInv", () => [{ left: 10, top: 5, right: 0, bottom: 0 }, { left: 0, top: 0, right: 0, bottom: 0 }, { left: NaN, top: -1, right: 3, bottom: 1e9 }, null].map((t) => M.cropFromTrimFeet(t, ov(null))));
rec("trimInvBad", () => M.cropFromTrimFeet({ left: 1 }, { imgW: 0 }));
rec("editBlock", () => [null, ov(null), ov(null, { fromMap: true }), ov(null, { locked: true }), { ...ov(null), src: "" }, { ...ov(null), imgW: 0 }].map((o) => M.cropEditBlock(o)));
rec("octant", () => [[{x:0,y:0},{x:10,y:3}],[{x:0,y:0},{x:10,y:9}],[{x:0,y:0},{x:-4,y:10}],[{x:1,y:1},{x:1,y:1}]].map(([a,b]) => M.constrainOctant(a,b)));
rec("nearest", () => [[{x:5,y:5},{x:0,y:0},{x:10,y:0}],[{x:-5,y:2},{x:0,y:0},{x:10,y:0}],[{x:5,y:5},{x:1,y:1},{x:1,y:1}]].map(([p,a,b]) => M.nearestOnSegment(p,a,b)));
out.cropConsts = [M.MIN_CROP_PX, M.MIN_POLY_VERTICES, M.MIN_POLY_BBOX_PX, M.MAX_POLY_VERTICES];

  return JSON.parse(JSON.stringify(out, (k, x) => (typeof x === "function" ? "fn" : x === undefined ? "__undef" : (typeof x === "number" && !Number.isFinite(x) ? String(x) : x))));
}
