/* useReviewHistory — undo / redo of the editable doc state (markups + per-sheet calibration), moved verbatim out of
 * DocReview.jsx (audit batch L4). `resetTransient` is what DocReview clears when a snapshot is applied (draft, selection,
 * inline entry, drag preview). */
import { useRef, useState } from "react";

export function useReviewHistory({ markups, calByPage, calInfo, setMarkups, setCalByPage, setCalInfo, resetTransient }) {
  /* ---- undo / redo (B303) ----
   * Snapshots of the editable doc state (markups + per-sheet calibration), by reference,
   * mirroring the Site Planner's pushHistory pattern. pushHistory() is called BEFORE a real
   * mutation (add/delete/move a markup, edit a text note, apply a hand calibration); undo()
   * skips frames identical to the current state via histKey so a stray push can't make Ctrl-Z
   * look like a no-op (B32/B105). The background auto-scale scan (B267) never pushes. */
  const docStateRef = useRef({ markups: [], calByPage: {}, calInfo: {} });
  // Assign during render (NOT a passive effect) so pushHistory/undo/redo always read the TRUE current
  // state. A passive-effect mirror lagged a paint behind, so an undo fired right after an edit compared
  // its baseline against a STALE snapshot: undo()'s no-op dedup saw the top frame as equal to "current"
  // and dropped it, so Ctrl-Z / the ↶ button did nothing (and corrupted the redo baseline). This is the
  // exact B315 class the Site Planner fixed the same way (see SitePlanner.jsx stateRef).
  docStateRef.current = { markups, calByPage, calInfo };
  const pastRef = useRef([]);
  const futureRef = useRef([]);
  const colorSessionRef = useRef(null); // active live color-pick key, so the burst is one undo frame (B567)
  const [, bumpHist] = useState(0);
  const touchHist = () => bumpHist((n) => n + 1);
  const histKey = (s) => JSON.stringify({ m: s.markups, c: s.calByPage, i: s.calInfo });
  const pushHistory = () => {
    pastRef.current.push(docStateRef.current);
    if (pastRef.current.length > 80) pastRef.current.shift();
    futureRef.current = [];
    touchHist();
  };
  const clearHistory = () => { pastRef.current = []; futureRef.current = []; touchHist(); };
  const applySnapshot = (s) => {
    setMarkups(s.markups || []); setCalByPage(s.calByPage || {}); setCalInfo(s.calInfo || {});
    resetTransient();
  };
  const undo = () => {
    let prev = null;
    while (pastRef.current.length) {
      const cand = pastRef.current.pop();
      if (histKey(cand) !== histKey(docStateRef.current)) { prev = cand; break; }
    }
    if (!prev) return;
    futureRef.current.push(docStateRef.current);
    applySnapshot(prev);
    touchHist();
  };
  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(docStateRef.current);
    applySnapshot(next);
    touchHist();
  };
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  return { pushHistory, clearHistory, undo, redo, canUndo, canRedo, colorSessionRef };
}
