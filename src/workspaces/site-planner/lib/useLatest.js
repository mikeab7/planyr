/* AUDIT BATCH G2 — "the latest value, readable from a callback that closed over an older render". Two named flavours, because the
 * TIMING is the whole difference and the planner depends on each:
 *   · `useLatestRender(value)` — the ref is written DURING render, so any handler / effect that runs after this render sees it
 *     (what `stateRef` needs: undo / save read the committed-or-about-to-commit state).
 *   · `useLatestEffect(value)` — the ref is written AFTER the commit (an effect with no deps), so it only ever holds a value React
 *     has actually committed (what `liveRef` needs: leave-the-plan persistence).
 * Neither is a state: writing the ref never re-renders. */
import { useRef, useEffect } from "react";

export function useLatestRender(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export function useLatestEffect(value) {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; });
  return ref;
}
