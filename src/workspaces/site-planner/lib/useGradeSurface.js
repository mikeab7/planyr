/* useGradeSurface — WHERE the planner's proposed surface (`gradeSurface`, the B826 engine) is built.
 *
 * ⛔ PROBLEM REPORT 6cea9895 (2026-10-19): with the owner-only grading layer on, the surface was built SYNCHRONOUSLY IN
 * RENDER (`useMemo(() => buildProposedSurface(gsInputs), [gsSig])`) every time its signature moved — the DEM arriving,
 * the suggested FFE resolving, a setback edit, and every pointer step of a building drag (~100 ms per build in Node on
 * his 636,916 SF cross-dock; per frame while dragging). Any setState flushed in a network continuation carried a full
 * build with it. So, with grading ON:
 *   • the build never runs in a render: an effect drives `buildProposedSurfaceSteps` through `runChunked` (≤ ~10 ms
 *     slices, one lattice column per step), superseded by a token the moment the inputs move;
 *   • the PREVIOUS surface stays published while a build is in flight (no flicker to nothing);
 *   • while a drag/resize/rotate is in flight (`isDragging()`), nothing is built — it waits for the release, polling
 *     the ref, so the Cut & Fill picture, the labels and the cards keep the last surface for the whole gesture.
 * With grading OFF (every other account) this is EXACTLY the old memo — constraint #25: byte-for-byte unchanged.
 *
 * Guards: repo-root test/ **gradeSurfaceOffRender** (renders the hook with a spy on the engine; a render with grading on
 * may never call it) + ui-audit **verify-grading-harness** (longest frame while opening and dragging, at DSF 2.68). */
import { useEffect, useMemo, useRef, useState } from "react";
import { buildProposedSurface, buildProposedSurfaceSteps } from "./proposedSurface.js";
import { runChunked } from "./runChunked.js";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";

export const DRAG_POLL_MS = 120;

/* The off-render build, as a plain async function (unit-testable without React). Resolves the surface, or
 * `{ stale: true }` when superseded. Waits while `isDragging()` is true. */
export async function buildSurfaceOffRender(inputs, { isStale, isDragging = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  while (isDragging && isDragging()) {
    await sleep(DRAG_POLL_MS);
    if (isStale && isStale()) return { stale: true };
  }
  if (isStale && isStale()) return { stale: true };
  return runChunked(buildProposedSurfaceSteps(inputs), { isStale });
}

/**
 * @param {object} inputs   the engine's inputs (rebuilt every render — read through a ref, never a dep)
 * @param {string} sig      their VALUE signature (the only thing that moves the result)
 * @param {boolean} enabled whether there is anything to build (an FFE somewhere and graded elements)
 * @param {boolean} offRender  true = grading layer on: build off the render path
 * @param {() => boolean} isDragging  a gesture is in flight (read at call time)
 */
/* NEW-1 (B2585313 ×2): what the off-render build says about itself, for `window.__plannerGradeReadout()` and the chip's no-surface
 * telemetry. `statsRef.current` = { buildSeq, lastBuildOutcome: "pending"|"ok"|"stale"|"threw", lastBuildMs, startedAt, sigChanges }
 * (`sigChanges` = timestamps of the last signature moves, newest last, at most 50). Read-only; written only by this hook. */
export function newGradeBuildStats() { return { buildSeq: 0, lastBuildOutcome: null, lastBuildMs: null, startedAt: null, sigChanges: [] }; }
export function useGradeSurface({ inputs, sig, enabled, offRender, isDragging, statsRef = null }) {
  const inRef = useRef(inputs); inRef.current = inputs;
  const dragRef = useRef(isDragging); dragRef.current = isDragging;
  // grading OFF: the old render-path memo, unchanged.
  const sync = useMemo(() => {
    if (offRender || !enabled) return null;
    return buildProposedSurface(inRef.current);
  }, [sig, offRender, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  // grading ON: built in an effect, previous surface kept until the new one lands.
  const [built, setBuilt] = useState(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!offRender) return undefined;
    const my = ++seq.current;
    if (!enabled) { if (statsRef && statsRef.current) statsRef.current.lastBuildOutcome = "disabled"; setBuilt(null); return undefined; }
    const stale = () => my !== seq.current;
    const st = statsRef && statsRef.current;
    const t0 = Date.now();
    if (st) { st.buildSeq++; st.lastBuildOutcome = "pending"; st.startedAt = t0; st.sigChanges.push(t0); if (st.sigChanges.length > 50) st.sigChanges.shift(); }
    buildSurfaceOffRender(inRef.current, { isStale: stale, isDragging: () => !!(dragRef.current && dragRef.current()) })
      .then((s) => {
        const ok = !stale() && !(s && s.stale);
        if (st && st.startedAt === t0) { st.lastBuildOutcome = ok ? "ok" : "stale"; st.lastBuildMs = Date.now() - t0; }
        if (ok) setBuilt(s || null);
      })
      // ROUND 10 (LOUD-FAILURE): a build that THROWS used to blank the surface (`setBuilt(null)`) while the grading picture kept
      // painting its last model — the chip then read "Prop —" under a full picture. Keep the last good surface and say so.
      .catch((e) => { if (st && st.startedAt === t0) { st.lastBuildOutcome = "threw"; st.lastBuildMs = Date.now() - t0; } if (!stale()) reportClientEvent("grading-surface-build-failed", String((e && e.message) || e), { keptPrevious: true }); });
    return () => { seq.current++; };
  }, [sig, offRender, enabled]); // eslint-disable-line react-hooks/exhaustive-deps -- statsRef is a ref (stable)
  return offRender ? built : sync;
}
