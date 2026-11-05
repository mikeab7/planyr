/* overlayCalibration — the click-by-click state of the Map/Comps scale calibration (NEW-7). A dependency-free
 * LEAF on purpose: MapFinder (on the Site route's boot path) imports it, while the math that consumes the clicks
 * (`overlayScaleGeo.js`) is only needed by the lazy Adjust panel — one import edge from here to there and the
 * panel's math rides the route's critical path. */
/* ---- The click-by-click calibration state (Trace a length / Match 2 points) ------------------------------
 * `calibration` = { kind: "trace" | "match", id: overlayId, pts: [{lat, lng}, …] }. The map reports each click;
 * these pure helpers decide what a click, an undo and the prompt mean, so MapFinder (which owns the clicks) and
 * SitePlansSection (which owns the Apply) cannot disagree. Trace keeps at most two points (a third click starts
 * over); Match is a flat sequence drawing-point, map-spot, drawing-point, map-spot … */
export const CALIB_MAX_PAIRS = 12;
export const matchPairsOf = (pts) => {
  const out = [];
  for (let i = 0; i < pts.length; i += 2) out.push({ from: pts[i], to: pts[i + 1] || null });
  return out;
};
export function calibrationAfterClick(c, pt) {
  if (!c || !pt) return c;
  if (c.kind === "trace") return { ...c, pts: c.pts.length >= 2 ? [pt] : [...c.pts, pt] };
  if (c.pts.length >= 2 * CALIB_MAX_PAIRS) return c;
  return { ...c, pts: [...c.pts, pt] };
}
export const calibrationUndo = (c) => (c && c.pts.length ? { ...c, pts: c.pts.slice(0, -1) } : c);
export function calibrationReady(c) {
  if (!c) return false;
  if (c.kind === "trace") return c.pts.length === 2;
  return matchPairsOf(c.pts).filter((p) => p.from && p.to).length >= 2;
}
export function calibrationPrompt(c) {
  if (!c) return "";
  const n = c.pts.length;
  if (c.kind === "trace") {
    if (n === 0) return "Click one end of a length you know on the drawing";
    if (n === 1) return "Now click the other end of that length";
    return "Type the real length in the Adjust panel, then Apply";
  }
  const done = Math.floor(n / 2);
  if (n % 2 === 0) return done < 2 ? `Pair ${done + 1}: click a point on the drawing` : `${done} pairs ready — Apply, or click another point on the drawing`;
  return `Pair ${done + 1}: now click where that point belongs on the map`;
}
