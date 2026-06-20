/* modulePrefetch — warm a workspace before the user opens it, so the tab click
 * feels instant without regressing initial boot. (B221)
 *
 * Two costs are warmed:
 *   1. The lazy JS chunk for the workspace (same dynamic-import specifier the
 *      Shell's React.lazy uses, so the browser dedupes to one chunk request).
 *   2. For Schedule specifically, the heavy standalone Gantt document
 *      (public/sequence/index.html, ~692 KB) that its iframe loads — warmed with
 *      <link rel="prefetch"> so the iframe boots from cache on navigation.
 *
 * Lazy-loading still gates the FIRST paint (nothing here runs at boot); these run
 * only on idle / hover-intent. Every call is idempotent and best-effort.
 */

// Same specifiers as the Shell's lazy() imports — Vite resolves both to the one chunk.
const IMPORTERS = {
  "site-planner": () => import("../workspaces/site-planner/SitePlannerApp.jsx"),
  "doc-review":   () => import("../workspaces/doc-review/DocReview.jsx"),
  "scheduler":    () => import("../workspaces/scheduler/Scheduler.jsx"),
};

// The Schedule iframe loads this exact path (absolute from the site root); mirror
// it so the prefetch and the iframe hit the same cache entry.
const SEQUENCE_DOC = "/sequence/";

const warmed = new Set();

function warmSequenceDoc() {
  if (typeof document === "undefined") return;
  if (document.querySelector('link[rel="prefetch"][data-pl-seq]')) return;
  try {
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "document";
    link.href = SEQUENCE_DOC;
    link.setAttribute("data-pl-seq", "1");
    document.head.appendChild(link);
  } catch (_) { /* best-effort */ }
}

/** Warm one module's chunk (and its iframe doc, for Schedule). Idempotent. */
export function prefetchModule(id) {
  if (warmed.has(id)) return;
  warmed.add(id);
  try { IMPORTERS[id]?.(); } catch (_) { /* best-effort */ }
  if (id === "scheduler") warmSequenceDoc();
}

/** Warm the given modules once the main thread is idle (after first paint). */
export function prefetchOnIdle(ids) {
  if (typeof window === "undefined") return;
  const run = () => ids.forEach(prefetchModule);
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 2500 });
  } else {
    setTimeout(run, 1200);
  }
}
