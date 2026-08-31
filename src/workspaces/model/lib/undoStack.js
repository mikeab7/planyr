/* Model workspace — general whole-state undo/redo.
 *
 * The Schedule module's generic snapshot stack lives in the scheduler (public/sequence/
 * index.html), not in src/, so it isn't reusable here — the build brief asks that this be
 * stated rather than assumed. This is a small, GENERAL implementation deliberately kept
 * per-action-agnostic: it snapshots the whole sheet on every committed edit and never
 * branches on WHAT changed (a cell edit, a range blank, a rename, a format change, an added
 * column — all push exactly the same way). A sheet is small (a handful of columns, a few
 * hundred rows of short strings), so a whole-object snapshot per commit is cheap; this is the
 * same tradeoff Notes' tree and the Site Planner's element snapshots make, just simpler
 * because there is no cloud-merge journal sitting underneath it yet.
 *
 * Retrofitting undo after the fact costs several times more than building it in from the
 * start (every mutator would need re-auditing for "does this go through the undo path"), so
 * every sheet mutation in ModelApp.jsx is required to go through `commit`, never through a
 * bare setSheet.
 */
import { useCallback, useState } from "react";

const HISTORY_LIMIT = 200;

export function useUndoableState(initial) {
  const [state, setState] = useState(() => ({ present: initial, past: [], future: [] }));

  /** Apply an edit. `updater` is either the next value or a (present) => next function.
   *  A no-op edit (updater returns the SAME reference) mints no undo frame — every mutator
   *  in lib/sheetModel.js already returns its input unchanged when nothing actually moved. */
  const commit = useCallback((updater) => {
    setState((s) => {
      const next = typeof updater === "function" ? updater(s.present) : updater;
      if (next === s.present) return s;
      const past = s.past.length >= HISTORY_LIMIT ? [...s.past.slice(1), s.present] : [...s.past, s.present];
      return { present: next, past, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setState((s) => {
      if (!s.past.length) return s;
      const prev = s.past[s.past.length - 1];
      return { present: prev, past: s.past.slice(0, -1), future: [s.present, ...s.future] };
    });
  }, []);

  const redo = useCallback(() => {
    setState((s) => {
      if (!s.future.length) return s;
      const [next, ...rest] = s.future;
      return { present: next, past: [...s.past, s.present], future: rest };
    });
  }, []);

  /** Replace the present value with NO undo frame at all — for adopting a load/sync result,
   *  never for a user edit. */
  const reset = useCallback((next) => setState({ present: next, past: [], future: [] }), []);

  return { value: state.present, commit, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
