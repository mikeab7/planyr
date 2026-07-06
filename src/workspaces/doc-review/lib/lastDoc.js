/* lastDoc — per-PROJECT "last document reviewed" memory (owner request, 2026-07-05:
 * "within that project, whatever I last reviewed should stay open too").
 *
 * The old pointers (`planyr:docreview:lastSingleId` / `lastStitchId` / `lastMode`) are one
 * GLOBAL slot: bouncing between projects always resumed the overall-last doc, and a deep link
 * to any other project dropped to the empty state. This map keys an { id, mode } entry per
 * project (bucket "" = docs not filed to a project), so each project reopens ITS last drawing.
 *
 * The legacy keys keep being written and remain the fallback (`resolveResume`), so existing
 * devices resume seamlessly on day one — migration is a fallback, not a copy pass.
 *
 * Everything here is pure localStorage I/O — no React — so it unit-tests directly.
 */

const KEY = "planyr:docreview:lastDoc:v1";
const LEGACY_MODE = "planyr:docreview:lastMode";
const LEGACY_SINGLE = "planyr:docreview:lastSingleId";
const LEGACY_STITCH = "planyr:docreview:lastStitchId";

const bucket = (projectId) => (typeof projectId === "string" && projectId ? projectId : "");
const normMode = (m) => (m === "stitch" ? "stitch" : "review");

/* The whole map { [projectId|""]: { id, mode } }. Corrupt storage reads as empty AND clears
 * the key so one garbled write can't wedge resume forever (boots clean instead). */
export function readLastDocMap() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) return {};
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("bad shape");
    const out = {};
    for (const [k, e] of Object.entries(v)) {
      if (e && typeof e.id === "string" && e.id) out[k] = { id: e.id, mode: normMode(e.mode) };
    }
    return out;
  } catch (_) {
    try { localStorage.removeItem(KEY); } catch (_) { /* storage unavailable */ }
    return {};
  }
}

export function writeLastDoc(projectId, entry) {
  if (!entry || typeof entry.id !== "string" || !entry.id) return;
  const map = readLastDocMap();
  map[bucket(projectId)] = { id: entry.id, mode: normMode(entry.mode) };
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (_) { /* quota — resume is a convenience */ }
}

export function readLastDoc(projectId) {
  return readLastDocMap()[bucket(projectId)] || null;
}

/* Snapshot of the legacy global pointers (also the boot-capture shape). */
export function readLegacyPointers() {
  try {
    return {
      mode: localStorage.getItem(LEGACY_MODE) || "review",
      singleId: localStorage.getItem(LEGACY_SINGLE) || null,
      stitchId: localStorage.getItem(LEGACY_STITCH) || null,
    };
  } catch (_) { return { mode: "review", singleId: null, stitchId: null }; }
}

/* Ordered, deduped resume candidates for boot. The caller tries each in turn (load →
 * wrong-project guard → open), so a stale first entry degrades to the next, never to a
 * silent empty state when a valid fallback exists.
 *   • URL names a project → that project's map entry first, then the legacy globals
 *     (still guarded downstream: a legacy doc from another project won't resume).
 *   • No URL project → the legacy globals ("whatever was last, anywhere" — today's
 *     semantics), then the unfiled ("") bucket.
 * Legacy ordering preserves the old boot rule: try the stitch pointer only when the last
 * mode was stitch, then the single pointer. */
export function resolveResume({ routeProjectId, map, legacy }) {
  const out = [];
  const push = (c) => {
    if (c && typeof c.id === "string" && c.id && !out.some((x) => x.id === c.id)) {
      out.push({ id: c.id, mode: normMode(c.mode) });
    }
  };
  const pushLegacy = () => {
    if (!legacy) return;
    if (legacy.mode === "stitch" && legacy.stitchId) push({ id: legacy.stitchId, mode: "stitch" });
    if (legacy.singleId) push({ id: legacy.singleId, mode: "review" });
  };
  if (routeProjectId) {
    push(map && map[routeProjectId]);
    pushLegacy();
  } else {
    pushLegacy();
    push(map && map[""]);
  }
  return out;
}
