/* warmSearch — take the avoidable cold-start steps OFF the first Food search (B2021648).
 * Owner measured the first food_places_search_by_name after opening #/food at 1.6–2.2 s end to end
 * against ~0.25 s for every later one (the in-database time is tens of ms, B2069808 — so the wait is
 * everything around the query). The three steps a first request pays that a later one doesn't:
 *   1. a new connection to Supabase (DNS + TCP + TLS) — `<link rel=preconnect>` starts it now;
 *   2. the auth session being read / refreshed before the request can carry a token —
 *      `auth.getSession()` resolves it once, up front, so the first RPC finds it ready;
 *   3. the server-side first call of the search function (plan + index pages) — one throwaway
 *      search warms it.
 * Fire-and-forget: it never throws, never touches state, and runs once per page load. Pure JS —
 * the caller hands in `supabase`, `search` and `doc`. */
export function warmSearchPath({ supabase, search, doc, origin } = {}) {
  try {
    if (doc && origin && !doc.querySelector?.(`link[rel="preconnect"][href="${origin}"]`)) {
      const link = doc.createElement("link");
      link.rel = "preconnect"; link.href = origin; link.crossOrigin = "anonymous";
      doc.head.appendChild(link);
    }
  } catch (_) { /* a missing hint costs speed only */ }
  const session = Promise.resolve()
    .then(() => supabase?.auth?.getSession?.())
    .catch(() => {});
  return session.then(() => search?.("tacos", null)).catch(() => {});
}
