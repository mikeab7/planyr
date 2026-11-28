/* "Connect to Claude" — the Allow page's request id, carried through sign-in (2026-11-27).
 * /oauth/authorize stores the request server-side and sends the browser to `#/connect/<uuid>`. Only that id travels:
 * it is a route `safeNextRoute` keeps (a query string would be cut, review A5). In case the person signs in from a
 * DIFFERENT tab (an emailed link), the id is also remembered on this device for 10 minutes, the request's own life.
 * Pure helpers + a guarded storage read/write (storage may be blocked; every call is try/catch). */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CONNECT_SLUG = "connect";
export const PENDING_KEY = "planyr:auth:pendingConnect";
export const PENDING_MS = 10 * 60 * 1000;

/** "#/connect/<uuid>" (or without the #) → the uuid, else null. */
export function connectIdFromHash(hash) {
  const segs = String(hash || "").replace(/^#/, "").split("/").filter(Boolean);
  if (segs.length !== 2 || segs[0] !== CONNECT_SLUG) return null;
  return UUID_RE.test(segs[1]) ? segs[1].toLowerCase() : null;
}
export const isConnectRoute = (hash) => String(hash || "").replace(/^#/, "").split("/").filter(Boolean)[0] === CONNECT_SLUG;

export function rememberPendingConnect(id, storage = safeStorage(), now = Date.now()) {
  if (!storage || !UUID_RE.test(String(id || ""))) return;
  try { storage.setItem(PENDING_KEY, JSON.stringify({ id, at: now })); } catch (_) { /* storage full or blocked: same-tab flow still works */ }
}
export function freshPendingConnect(storage = safeStorage(), now = Date.now()) {
  if (!storage) return null;
  try {
    const v = JSON.parse(storage.getItem(PENDING_KEY) || "null");
    if (!v || !UUID_RE.test(String(v.id || "")) || !(now - Number(v.at) < PENDING_MS) || now < Number(v.at)) return null;
    return String(v.id).toLowerCase();
  } catch (_) { return null; }
}
export function clearPendingConnect(storage = safeStorage()) {
  if (!storage) return;
  try { storage.removeItem(PENDING_KEY); } catch (_) { /* nothing to do */ }
}
function safeStorage() {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch (_) { return null; }
}

/** The connector's own address, shown in Settings for "Add custom connector". */
export const connectorUrl = (origin) => String(origin || "https://planyr.io").replace(/\/+$/, "") + "/api/mcp";
