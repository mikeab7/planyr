/* Pure helpers for the /api/mapillary proxy (B308) — no Cloudflare-runtime or DOM deps,
 * so they unit-test in node (test/mapillaryProxy.test.js). The route ([[path]].js) wires
 * these to the live request/Response/fetch + the MAPILLARY_TOKEN secret.
 *
 * Security boundary: this proxy holds the owner's Mapillary token server-side and is a
 * PUBLIC endpoint, so it must (a) allow ONLY the exact Graph path + fields the app calls,
 * (b) reject foreign Origins (don't be an open Mapillary gateway), and (c) validate the
 * bbox/limit. The token is added on the server and never returned to or seen by the client.
 */

export const GRAPH = "https://graph.mapillary.com";
// Only what the street-imagery layer actually requests.
export const ALLOWED_PATHS = new Set(["map_features"]);
export const ALLOWED_FIELDS = new Set(["id", "object_value", "geometry"]);
const MAX_LIMIT = 2000;
// Our own site (apex + Cloudflare per-branch previews). Same-origin GETs usually omit
// Origin entirely, which is allowed; a foreign Origin is what we block.
const ALLOWED_HOST_RE = /(^|\.)planyr\.io$|(^|\.)planyr\.pages\.dev$/i;

/* Is this request from our own site? `origin` is the Origin header (may be null for a
 * same-origin / non-CORS GET → allowed); `selfHost` is this function's own host (also
 * allowed). A foreign Origin → false. Pure. */
export function isAllowedOrigin(origin, selfHost) {
  if (!origin) return true;            // same-origin / non-CORS request — no Origin sent
  let host;
  try { host = new URL(origin).host; } catch (_) { return false; }
  return host === selfHost || ALLOWED_HOST_RE.test(host);
}

const BBOX_RE = /^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/; // exactly 4 comma-separated numbers

/* Build the upstream Mapillary Graph URL from an allow-listed path + sanitized query
 * params + the server token — or `null` if the path/fields/bbox aren't allowed (the
 * caller then 400s). The token is the ONLY thing added here; it's never echoed back to
 * the client. Pure. */
export function buildUpstreamUrl(path, params, token) {
  if (!ALLOWED_PATHS.has(path)) return null;
  const get = (k) => (params && typeof params.get === "function" ? params.get(k) : null);
  const fields = String(get("fields") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!fields.length || fields.some((f) => !ALLOWED_FIELDS.has(f))) return null;
  const bbox = String(get("bbox") || "");
  if (!BBOX_RE.test(bbox)) return null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(get("limit") || "500", 10) || 500));
  const u = new URL(`${GRAPH}/${path}`);
  u.searchParams.set("fields", fields.join(","));
  u.searchParams.set("bbox", bbox);
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("access_token", token);
  return u.toString();
}
