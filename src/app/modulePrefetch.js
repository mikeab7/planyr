/* modulePrefetch — warm a workspace before the user opens it, so the tab click
 * feels instant without regressing initial boot. (B223)
 *
 * Two costs are warmed:
 *   1. The lazy JS chunk for the workspace (same dynamic-import specifier the
 *      Shell's React.lazy uses, so the browser dedupes to one chunk request).
 *   2. For Schedule specifically, the heavy standalone Gantt document
 *      (public/sequence/index.html) that its iframe loads — warmed with
 *      <link rel="prefetch"> so the iframe boots from cache on navigation.
 *
 *      ⛔ SIZE, CORRECTED (B1167201, 2026-09-07) — this comment previously said "~692 KB",
 *      which was stale by ~76%: the authored source is 1,247,423 bytes (~1.2 MB) and had grown
 *      to that size with nobody updating the number here. What THIS prefetch actually warms is
 *      the served document at `/sequence/`, which since B1167200 (the build-time Babel-compile
 *      step that removes the in-browser JSX transpile) is the dist-built, comment-stripped
 *      version — measured 1,063,908 bytes (~1.04 MB) in that build. `npm run dev` still serves
 *      the raw ~1.2 MB authored source unchanged (B1167200 deliberately only transforms the
 *      production build output, not dev — see that script's own header), so the two sizes
 *      genuinely differ; ~1.04 MB is the number that matters here since this warming path only
 *      runs against what's actually deployed.
 *
 *      Still the right call at this size: a single `as="document"` prefetch, gated on real
 *      navigation intent (hover/pointerdown below), is exactly the shape the browser's own
 *      prefetch mechanism is for — it runs at low priority and doesn't compete with the active
 *      route's critical path, so growing from 692 KB (never true) to ~1.04 MB doesn't change
 *      the tradeoff. No behavior change here, only the number.
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
  "model":        () => import("../workspaces/model/ModelApp.jsx"),
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

/* NEW-1 (2026-10-22, work-laptop report) — a HOVER is only a hint, so it waits for the page to be quiet. `prefetchModule` is an
 * `import()`, which fetches at high priority and then EVALUATES a whole workspace chunk on the main thread; fired by a pointer
 * merely crossing the header while map tiles / parcel outlines are still arriving, it competes for the same frame and the same GPU
 * upload queue as the picture the user is looking at. So a hover prefetch is held back while Leaflet tiles are still loading
 * (re-asked every 400 ms, give up after ~4 s — the click path still loads on demand), then runs. `onPointerDown` — real intent,
 * and the touch path — stays immediate and uses `prefetchModule` directly. */
export const HOVER_QUIET_RETRY_MS = 400;
export const HOVER_QUIET_MAX_TRIES = 10;
export function pageIsBusyLoading(doc = typeof document !== "undefined" ? document : null) {
  try { return !!(doc && doc.querySelector(".leaflet-tile-container .leaflet-tile:not(.leaflet-tile-loaded)")); } catch (_) { return false; }
}
export function prefetchModuleWhenQuiet(id, { busy = pageIsBusyLoading, setTimer = (f, ms) => setTimeout(f, ms) } = {}) {
  let tries = 0;
  const attempt = () => {
    if (busy() && ++tries < HOVER_QUIET_MAX_TRIES) { setTimer(attempt, HOVER_QUIET_RETRY_MS); return; }
    prefetchModule(id);
  };
  attempt();
}
