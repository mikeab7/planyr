/* plannerChunk — the ONE door to the plan editor's code (B329408, owner decision 2026-11-09: slim the Site route, never raise its limit).
 *
 * WHAT MOVED. `SitePlanner.jsx` (the plan editor: canvas, every panel, the whole yield / drainage / grading stack and everything only it
 * reaches, ~1.7 MB minified) used to be a STATIC import of `SitePlannerApp.jsx`, so the Site route paid for the editor before the
 * landing map could draw — even for a visit that never opens a plan. It is now its own chunk, fetched through this module.
 *
 * WHEN IT IS FETCHED — so the editor still opens instantly, which is the whole point of the arrangement:
 *   1. A page that OPENS ON A PLAN (a pasted link, a reload — the usual way in): `scripts/vite-plugin-planner-preload.mjs` adds a
 *      <link rel="modulepreload"> for this chunk from an inline script in index.html, at t=0, before any JavaScript runs. Same bytes at
 *      the same moment as before this split; it is only no longer ahead of the map in the queue.
 *   2. A visit that lands on the MAP: `prefetchPlanner()` runs once the browser is idle after SitePlannerApp mounts, so the first
 *      "open a plan" click finds the chunk already in the module cache. A click before that simply waits for the remainder (Suspense).
 *   3. Anything that renders the editor or asks for `warmPlanForMount` goes through `loadPlanner()` — one shared promise, so the three
 *      paths above never download it twice.
 * LOUD-FAILURE: a failed fetch (offline, stale deploy) clears the cached promise so the next ask retries instead of replaying the
 * rejection forever, and the lazy boundary's error reaches the app's ErrorBoundary / chunk-reload guard as any lazy chunk's does. */

let pending = null;

/** The editor module ({ default: SitePlanner, warmPlanForMount, … }). One shared promise; a rejection is forgotten so a retry can succeed. */
export function loadPlanner() {
  if (!pending) {
    pending = import("../SitePlanner.jsx");
    pending.catch(() => { pending = null; });
  }
  return pending;
}

/** Fetch the editor in the background once the browser is idle. Never throws, never blocks, safe to call more than once. */
export function prefetchPlanner({ timeoutMs = 1500 } = {}) {
  const go = () => { loadPlanner().catch(() => {}); };
  try {
    if (typeof requestIdleCallback === "function") requestIdleCallback(go, { timeout: timeoutMs });
    else setTimeout(go, 250);
  } catch (_) { go(); }
}
