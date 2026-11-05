/* What the URL said about an e-mail link the person just followed (NEW-1, follow-up to B2619760).
 *
 * A reset / confirmation link comes back to the app with its answer in the URL:
 *   success  → #access_token=…&type=recovery        (the set-new-password form)
 *   failure  → #error=access_denied&error_code=otp_expired&error_description=…   (expired or already used)
 * supabase-js consumes the SUCCESS form itself and, on recovery, fires PASSWORD_RECOVERY from a
 * timer — which can fire before the Shell has subscribed, so the form was missed. Nothing read the
 * FAILURE form at all: the route fell back to Site, the hash was erased, and the person landed signed
 * out with no message. This module reads both ONCE, at module load — before the router or any effect
 * touches the URL — and exposes the answer:
 *   authReturn().recovery   a valid-looking reset link was just followed
 *   authReturn().failure    { code, expired } a link that did not work (null otherwise)
 * It also cleans a FAILURE out of the address bar (nothing else will; supabase-js leaves it). A
 * recovery hash is left alone — supabase-js needs it and clears it itself.
 *
 * Imported first by main.jsx so it runs before everything; dependency-free by design. */

const EXPIRED_CODES = new Set(["otp_expired", "flow_state_expired"]);

/** Pure: parse a location's `search` + `hash` into the link outcome. */
export function parseAuthReturn(search = "", hash = "") {
  const params = new URLSearchParams();
  for (const part of [String(search || "").replace(/^\?/, ""), String(hash || "").replace(/^#\/?/, "")]) {
    if (!part || !part.includes("=")) continue;
    try { new URLSearchParams(part).forEach((v, k) => { if (!params.has(k)) params.set(k, v); }); } catch (_) { /* junk — ignore */ }
  }
  const code = params.get("error_code") || "";
  const hasError = !!(params.get("error") || code || params.get("error_description"));
  if (hasError) {
    const desc = params.get("error_description") || "";
    const expired = EXPIRED_CODES.has(code) || /expired|invalid or has expired|already been used/i.test(desc);
    return { recovery: false, failure: { code: code || params.get("error") || "unknown", expired } };
  }
  const recovery = params.get("type") === "recovery" && !!(params.get("access_token") || params.get("token_hash") || params.get("code"));
  return { recovery, failure: null };
}

/** Pure: the same URL with the error parameters removed (everything else kept). */
export function stripAuthErrorParams(search = "", hash = "") {
  const keys = new Set(["error", "error_code", "error_description"]);
  // Pair-by-pair, not URLSearchParams: it would re-write a bare "?app" as "?app=" (the front door's own
  // bypass regex still matches, but the bar should keep exactly what was typed).
  const clean = (raw, lead) => {
    const text = String(raw || "");
    const body = text.replace(/^[?#]\/?/, "");
    if (!body.includes("=")) return text;
    const kept = body.split("&").filter((pair) => !keys.has(decodeURIComponent(pair.split("=")[0] || "")));
    if (kept.length === body.split("&").length) return text;
    return kept.length ? lead + kept.join("&") : "";
  };
  return { search: clean(search, "?"), hash: clean(hash, "#") };
}

const captured = (() => {
  try {
    if (typeof window === "undefined" || !window.location) return { recovery: false, failure: null };
    const r = parseAuthReturn(window.location.search, window.location.hash);
    if (r.failure && window.history && window.history.replaceState) {
      const next = stripAuthErrorParams(window.location.search, window.location.hash);
      window.history.replaceState(window.history.state, "", window.location.pathname + next.search + next.hash);
    }
    return r;
  } catch (_) { return { recovery: false, failure: null }; }
})();

/** What the URL said when the page loaded. Stable for the life of the page. */
export const authReturn = () => captured;

/** Plain words for a failed link. */
export function authReturnNotice(failure) {
  if (!failure) return "";
  return failure.expired ? "That link has expired. Send yourself a new one." : "That link didn't work. Send yourself a new one.";
}
