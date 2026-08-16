/* modulePrefetch — warm a workspace before the user opens it, so the tab click
 * feels instant without regressing initial boot. (B223)
 *
 * Two costs are warmed:
 *   1. The lazy JS chunk for the workspace (same dynamic-import specifier the
 *      Shell's React.lazy uses, so the browser dedupes to one chunk request).
 *   2. For Schedule specifically, the heavy standalone Gantt document
 *      (public/sequence/index.html, ~692 KB) that its iframe loads — warmed with
 *      <link rel="prefetch"> so the iframe boots from cache on navigation.
 *
 * ⛔ INTENT-DRIVEN ONLY — never warm at boot (NEW-9). B223 originally also warmed
 * scheduler + doc-review + library from a boot `requestIdleCallback`. Measurement on
 * production (2026-07-28, Sylvestri/Concept C) showed that idle callback firing at
 * ~t=304ms — BEFORE first-contentful-paint at ~328ms — so the "runs only after first
 * paint" assumption was simply false: requestIdleCallback fires in any gap in the main
 * thread, including gaps *during* boot while the network is still delivering the
 * critical path. The result was that a Site-only session fetched all 11 chunks, pulling
 * ~805 KB raw (~27% of all JS: pdf.worker 460 · DocReview 187 · Library 91 · uploadQueue
 * 33 · Scheduler 15 · folders 14 · pdf 5) that it never executes — and, worse, `import()`
 * fetches at HIGH priority and then EVALUATES the module, spending main-thread
 * parse/compile time in exactly the window the planner needs to become interactive.
 *
 * So warming is now driven purely by NAVIGATION INTENT, from AppHeader's module tabs:
 * `onMouseEnter` (pointer aiming at the tab) and `onPointerDown` (the touch/tap path,
 * which has no hover). Both land well before the click commits, so switching still feels
 * instant, while a session that never leaves the Site route pays nothing. The accepted
 * tradeoff is a short chunk fetch on the first open for a user who taps a tab with no
 * preceding hover or pointerdown gap.
 *
 * Every call is idempotent and best-effort.
 */

// Same specifiers as the Shell's lazy() imports — Vite resolves both to the one chunk.
const IMPORTERS = {
  "site-planner": () => import("../workspaces/site-planner/SitePlannerApp.jsx"),
  "doc-review":   () => import("../workspaces/doc-review/DocReview.jsx"),
  "library":      () => import("../workspaces/library/Library.jsx"),
  "scheduler":    () => import("../workspaces/scheduler/Scheduler.jsx"),
  "notes":        () => import("../workspaces/notes/Notes.jsx"),
  // ⛔ NO "food" ENTRY (NEW-2) — this map is warmed only from AppHeader's tab hover/pointerdown,
  // and /food has no tab (it's an unlisted route). Nothing would ever call prefetchModule("food").
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

/** Warm one module's chunk (and its iframe doc, for Schedule). Idempotent.
 *
 * Call this ONLY from a navigation-intent gesture (tab hover / pointerdown). There is
 * deliberately no boot-time / idle-time entry point — see the header note (NEW-9). */
export function prefetchModule(id) {
  if (warmed.has(id)) return;
  warmed.add(id);
  try { IMPORTERS[id]?.(); } catch (_) { /* best-effort */ }
  if (id === "scheduler") warmSequenceDoc();
}
