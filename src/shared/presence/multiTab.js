/* Multi-tab presence (B313) — detect when the SAME Planyr project is open in another tab of
 * the same browser, so the app can warn that editing in two tabs can conflict. Built on
 * BroadcastChannel (a same-origin, same-browser message bus between tabs).
 *
 * Scope + relationship to other safety nets:
 *   - Same-browser only. Cross-DEVICE / cross-browser conflicts are caught server-side by the
 *     optimistic-concurrency guard (B314), not here.
 *   - This is the VISIBLE companion to B127 (which already made two same-browser tabs silently
 *     converge): B313 surfaces the situation so the user isn't surprised.
 *
 * The pure helpers (summarizePresence / pruneStale) are React- and DOM-free so the protocol is
 * unit-tested without a browser; createMultiTabPresence is a thin BroadcastChannel wrapper that
 * degrades to a no-op where BroadcastChannel is unavailable (so nothing breaks).
 */

export const PRESENCE_CHANNEL = "planyr-presence-v1";
export const PRESENCE_TTL = 8000;      // a peer with no heartbeat within this window is treated as gone
export const PRESENCE_HEARTBEAT = 3000; // re-announce + prune on this interval

const randomId = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID()
    : "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ONE presence identity per browsing context (tab / document). The app shell keeps every
// VISITED workspace mounted-but-hidden for instant switching (Shell.jsx keep-alive, 2026-07-05),
// so a SINGLE tab can have several AppHeaders alive at once — each creating its own presence
// instance. BroadcastChannel delivers messages between instances in the SAME document too (not
// only across real tabs), so without a shared identity those same-tab headers would announce the
// same project and mistake EACH OTHER for a second tab — firing a false "open in another tab"
// banner with only one tab open (owner report 2026-07-13, seen on the Library). A module-scoped
// id is per-realm = per-tab: every instance in one tab shares it (line-71 self-echo guard then
// makes them ignore one another), while a genuinely separate tab is a fresh realm with its own
// id, so the real cross-tab warning still fires. Tests pass an explicit opts.tabId to simulate
// distinct tabs inside one realm.
let documentTabId = null;
function getDocumentTabId() {
  if (!documentTabId) documentTabId = randomId();
  return documentTabId;
}

// Pure: summarize the known peers (a Map of tabId → { project, at }) into the banner state,
// from THIS tab's point of view. Stale peers (older than TTL) are ignored.
export function summarizePresence(peers, selfTabId, selfProject, nowMs, ttl = PRESENCE_TTL) {
  let otherCount = 0, sameProjectTabs = 0;
  const entries = peers instanceof Map ? peers.entries() : Object.entries(peers || {});
  for (const [id, info] of entries) {
    if (id === selfTabId || !info) continue;
    if (nowMs - (info.at || 0) > ttl) continue;
    otherCount++;
    if (selfProject != null && info.project != null && String(info.project) === String(selfProject)) sameProjectTabs++;
  }
  return { otherCount, sameProjectTabs, conflictRisk: sameProjectTabs > 0 };
}

// Pure-ish: drop peers with no heartbeat within ttl. Mutates `peers` (a Map); returns whether
// anything was removed (so the caller only re-renders when the picture actually changed).
export function pruneStale(peers, nowMs, ttl = PRESENCE_TTL) {
  let changed = false;
  for (const [id, info] of peers) if (nowMs - ((info && info.at) || 0) > ttl) { peers.delete(id); changed = true; }
  return changed;
}

/* Live presence over BroadcastChannel. Returns a small controller:
 *   start()            begin announcing + listening (idempotent)
 *   setProject(id)     this tab's current project changed → re-announce
 *   onChange(cb)       cb(state) whenever the picture changes; state = summarizePresence(...)
 *   stop()             announce departure + tear down
 * Message protocol: {type:'hello'|'here'|'update'|'bye', tabId, project, at}. A new tab says
 * 'hello'; every existing tab replies 'here' so the newcomer learns who's already open. */
export function createMultiTabPresence(opts = {}) {
  const tabId = opts.tabId || getDocumentTabId(); // per-tab identity: same-tab siblings share it (kept-alive headers), so they never count each other
  const now = opts.now || (() => Date.now());
  const ttl = opts.ttl || PRESENCE_TTL;
  const heartbeatMs = opts.heartbeat || PRESENCE_HEARTBEAT;
  const peers = new Map();
  let project = opts.project != null ? opts.project : null;
  let cb = () => {};
  let timer = null;
  let started = false;

  let bc = null;
  try { if (typeof BroadcastChannel !== "undefined") bc = new BroadcastChannel(opts.channel || PRESENCE_CHANNEL); } catch (_) { bc = null; }

  const emit = () => cb(summarizePresence(peers, tabId, project, now(), ttl));
  const send = (type) => { try { bc && bc.postMessage({ type, tabId, project, at: now() }); } catch (_) {} };

  if (bc) bc.onmessage = (e) => {
    const m = e && e.data;
    if (!m || m.tabId === tabId) return; // ignore our own echoes
    if (m.type === "bye") { if (peers.delete(m.tabId)) emit(); return; }
    peers.set(m.tabId, { project: m.project, at: now() });
    if (m.type === "hello") send("here"); // welcome the newcomer so it sees us immediately
    emit();
  };

  return {
    tabId,
    start() {
      if (started) return;
      started = true;
      send("hello");
      timer = setInterval(() => { send("update"); if (pruneStale(peers, now(), ttl)) emit(); }, heartbeatMs);
      emit();
    },
    setProject(p) { project = p != null ? p : null; send("update"); emit(); },
    onChange(fn) { cb = typeof fn === "function" ? fn : (() => {}); emit(); },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
      send("bye");
      try { bc && bc.close(); } catch (_) {}
      bc = null; started = false;
    },
    _peers: peers, // test seam
  };
}
