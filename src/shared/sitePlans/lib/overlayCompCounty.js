/* B1953796 (R9) — best-effort county for each comp pinned to a moved site-plan overlay.
 * Same derivation MapFinder's `resolveCompCounty` uses (jurisdiction boundary lookup, resolved
 * WITH its state so an out-of-state name can't map to a Texas key), on the same 3s race. The heavy
 * county modules are imported lazily — only a placement commit that actually carries comps pays. */
export async function resolveCountyForPoint(lat, lon, { timeoutMs = 3000 } = {}) {
  try {
    const [{ countyAtPoint }, { countyKeyForName }] = await Promise.all([
      import("../../../workspaces/site-planner/lib/jurisdiction.js"),
      import("../../../workspaces/site-planner/lib/counties.js"),
    ]);
    const ans = await Promise.race([countyAtPoint(lon, lat), new Promise((res) => setTimeout(() => res(null), timeoutMs))]);
    return ans && ans.name ? (countyKeyForName(ans.name, ans.state) || null) : null;
  } catch (_) { return null; }
}

/** Adds `county` to every position whose county resolved; the rest are left WITHOUT the key so the
 *  server keeps the stored value (a failed lookup never erases a real county). */
export async function withResolvedCounties(positions, resolve = resolveCountyForPoint) {
  return Promise.all((positions || []).map(async (p) => {
    const county = await resolve(p.lat, p.lon);
    return county ? { ...p, county } : p;
  }));
}
