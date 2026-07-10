/* Pure "step back the last placed vertex" resolver for the Site Planner's in-progress
 * multi-point drafts — the Bluebeam-style mid-draw undo bound to BOTH Backspace/Delete and
 * Ctrl/⌘-Z (B746). Given a snapshot of the live draft states, it returns which draft to trim
 * and that draft's NEXT value (null = fully cancelled once the last point is gone), or `null`
 * when there is nothing to trim — the caller then falls through to a global undo() (Ctrl-Z) or
 * a whole-element delete (Backspace). Extracted from SitePlanner.jsx's inline removeLastVertex
 * so every draft type's trim + empty-boundary contract is unit-testable without the component
 * (the fall-through contract in particular: no active draft MUST resolve to null, so an empty
 * draft never swallows a real Ctrl-Z). Precedence mirrors the tool exclusivity in the canvas. */
export function resolveDraftStepBack(s = {}) {
  const arr = (a) => (Array.isArray(a) ? a : []);
  const s2 = s || {};

  if (s2.traceMode && arr(s2.tracePts).length) return { target: "tracePts", next: s2.tracePts.slice(0, -1) };
  if (s2.tool === "split" && arr(s2.splitPath).length) return { target: "splitPath", next: s2.splitPath.slice(0, -1) };
  if (s2.tool === "measure" && arr(s2.measDraft).length) return { target: "measDraft", next: s2.measDraft.slice(0, -1) };
  if (s2.mkPoly && arr(s2.mkPoly.pts).length) { const pts = s2.mkPoly.pts.slice(0, -1); return { target: "mkPoly", next: pts.length ? { ...s2.mkPoly, pts } : null }; }
  if (arr(s2.draftPoly).length) { const n = s2.draftPoly.slice(0, -1); return { target: "draftPoly", next: n.length ? n : null }; }
  if (s2.draftElPoly && arr(s2.draftElPoly.pts).length) { const pts = s2.draftElPoly.pts.slice(0, -1); return { target: "draftElPoly", next: pts.length ? { ...s2.draftElPoly, pts } : null }; }
  if (arr(s2.draftRoadPts).length) { const n = s2.draftRoadPts.slice(0, -1); return { target: "draftRoadPts", next: n.length ? n : null }; }
  if (s2.easeDraft && arr(s2.easeDraft.pts).length) { const pts = s2.easeDraft.pts.slice(0, -1); return { target: "easeDraft", next: pts.length ? { pts } : null }; }
  // A parcel-edge easement run accumulates picked edge indices (not free points) — step back the last edge.
  if (s2.easeEdges && arr(s2.easeEdges.idx).length) { const idx = s2.easeEdges.idx.slice(0, -1); return { target: "easeEdges", next: idx.length ? { ...s2.easeEdges, idx } : null }; }
  // The ditch cross-section holds at most one pending point (the near bank) before the far click samples.
  if (s2.xsecMode && arr(s2.xsecPts).length) return { target: "xsecPts", next: s2.xsecPts.slice(0, -1) };

  return null;
}
