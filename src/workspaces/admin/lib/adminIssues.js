/* Issues grouping (NEW-2): one bug is one row, and the expected after-deploy chunk miss is ONE collapsed
 * line instead of a hundred. Pure over the rows shapeErrorGroups returns.
 *   - isDeployReload: "Failed to fetch dynamically imported module: https://planyr.io/assets/<Chunk>-<hash>.js"
 *     and its siblings — every source (vite:preloadError, unhandledrejection, react) counts.
 *   - normalizeMessage: strips what makes the same bug look different (asset hashes, ids, line:col).
 *   - foldIssues: deploy reloads fold out (with their per-file breakdown); the rest group by
 *     kind + normalised message with the sources listed inside the row.
 * The default view is short: top 10, then pages of 25. */

const DEPLOY_RE = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css|loading (css )?chunk [\w-]+ failed|failed to load module script/i;
export const isDeployReload = (g) => DEPLOY_RE.test(g.rawMessage ?? g.message ?? "") || g.source === "vite:preloadError";

/** A user's recent-error rows (admin_recent_errors_for_user) minus the expected after-deploy chunk misses — the SAME rule
 * Issues uses (isDeployReload). Returns the real errors (first `limit`) and how many deploy reloads were left out (B2159506). */
export function splitDeployReloads(rows, limit = 8) {
  const list = Array.isArray(rows) ? rows : [];
  const isDeploy = (r) => isDeployReload({ rawMessage: r.message, source: r.source });
  return { errors: list.filter((r) => !isDeploy(r)).slice(0, limit), deployReloads: list.filter(isDeploy).length };
}

/** The chunk's file name with the content hash removed ("Chunk" for …/assets/Chunk-ab12CD34.js). */
export function chunkFile(message) {
  const m = /([A-Za-z0-9_.@~-]+?)-[A-Za-z0-9_-]{6,12}\.(js|css|mjs)\b/.exec(String(message || ""));
  if (m) return `${m[1]}.${m[2]}`;
  const tail = /([A-Za-z0-9_.@~-]+\.(?:js|css|mjs))\b/.exec(String(message || ""));
  return tail ? tail[1] : "(unknown file)";
}

export function normalizeMessage(message) {
  return String(message || "")
    .replace(/https?:\/\/[^\s)'"]+/g, (u) => u.replace(/-[A-Za-z0-9_-]{6,12}\.(js|css|mjs)/g, "-*.$1").replace(/[?#].*$/, ""))
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<id>")
    .replace(/:\d+:\d+\b/g, "")
    .replace(/\b(line|col|column)\s+\d+/gi, "$1 N")
    .replace(/\b\d{4,}\b/g, "N")
    .replace(/\s+/g, " ")
    .trim();
}

const maxIso = (a, b) => (!a ? b : !b ? a : new Date(a) >= new Date(b) ? a : b);
const minIso = (a, b) => (!a ? b : !b ? a : new Date(a) <= new Date(b) ? a : b);

/** @param groups output of shapeErrorGroups. @returns {{ deploy, groups }} */
export function foldIssues(groups, now = Date.now(), newWindowMs = 86_400_000) {
  const deployFiles = new Map();
  let deployOcc = 0;
  const by = new Map();
  for (const g of groups || []) {
    if (isDeployReload(g)) {
      deployOcc += g.occurrences;
      const file = chunkFile(g.rawMessage || g.message);
      const f = deployFiles.get(file) || { file, occurrences: 0, sources: new Set(), lastSeen: null };
      f.occurrences += g.occurrences; f.sources.add(g.source || "unknown"); f.lastSeen = maxIso(f.lastSeen, g.lastSeen);
      deployFiles.set(file, f);
      continue;
    }
    const norm = normalizeMessage(g.rawMessage || g.message);
    const key = `${g.kind}|${norm}`;
    let e = by.get(key);
    if (!e) {
      e = { key, kind: g.kind, message: g.message, rawKeys: [], sources: new Map(), occurrences: 0, accounts: 0, builds: 0, firstSeen: null, lastSeen: null, lastBuild: null, modules: new Set(), _top: -1 };
      by.set(key, e);
    }
    if (g.occurrences > e._top) { e._top = g.occurrences; e.message = g.message; }
    e.rawKeys.push({ kind: g.kind, source: g.source, message: g.rawMessage });
    e.sources.set(g.source || "unknown", (e.sources.get(g.source || "unknown") || 0) + g.occurrences);
    e.occurrences += g.occurrences;
    e.accounts = Math.max(e.accounts, g.accounts);
    e.builds = Math.max(e.builds, g.builds);
    e.firstSeen = minIso(e.firstSeen, g.firstSeen);
    if (!e.lastSeen || new Date(g.lastSeen || 0) > new Date(e.lastSeen)) e.lastBuild = g.lastBuild;
    e.lastSeen = maxIso(e.lastSeen, g.lastSeen);
    if (g.module) e.modules.add(g.module);
  }
  const out = [...by.values()].map(({ _top, sources, modules, ...e }) => ({
    ...e,
    sources: [...sources].map(([source, occurrences]) => ({ source, occurrences })).sort((a, b) => b.occurrences - a.occurrences),
    modules: [...modules],
    isNew: !!e.firstSeen && now - new Date(e.firstSeen).getTime() < newWindowMs,
  }));
  return {
    deploy: {
      occurrences: deployOcc,
      fileCount: deployFiles.size,
      files: [...deployFiles.values()].map((f) => ({ ...f, sources: [...f.sources] })).sort((a, b) => b.occurrences - a.occurrences),
    },
    groups: sortIssues(out, "count", "desc"),
  };
}

export const ISSUE_SORTS = ["count", "lastSeen", "accounts", "message"];
/** Default: count then last seen, both descending. */
export function sortIssues(groups, key = "count", dir = "desc") {
  const sign = dir === "asc" ? 1 : -1;
  const t = (g) => new Date(g.lastSeen || 0).getTime();
  const cmp = {
    count: (a, b) => a.occurrences - b.occurrences || t(a) - t(b),
    lastSeen: (a, b) => t(a) - t(b) || a.occurrences - b.occurrences,
    accounts: (a, b) => a.accounts - b.accounts || a.occurrences - b.occurrences,
    message: (a, b) => a.message.localeCompare(b.message),
  }[key] || (() => 0);
  return [...groups].sort((a, b) => sign * cmp(a, b));
}
export function searchIssues(groups, q) {
  const s = String(q || "").trim().toLowerCase();
  return s ? groups.filter((g) => g.message.toLowerCase().includes(s) || g.sources.some((x) => x.source.toLowerCase().includes(s))) : groups;
}
export const FIRST_PAGE = 10;
export const PAGE_STEP = 25;
/** How many rows show after `clicks` presses of "Show more". */
export const visibleCount = (clicks) => FIRST_PAGE + PAGE_STEP * Math.max(0, clicks | 0);
