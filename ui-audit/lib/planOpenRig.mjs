/* planOpenRig — a SIGNED-IN plan open in the sandbox, served the owner's REAL rows (B2224000 / NEW-1 plan-load hitch).
 *
 * WHY SIGNED IN. The stall the owner measured (908 / 560 ms on a Bolt-on → Concept A switch, 226 / 253 ms back) happens on an account whose
 * plans live in `public.sites` (a slim header, `elementsInRows: true`) + `public.site_elements` (one row per element). A logged-out harness
 * reads one localStorage blob instead and never runs the cloud pull / row fetch / seed / reconcile path at all — it measures a different
 * program. So this rig answers the app's own PostgREST calls from committed fixtures (ui-audit/fixtures/plan-load/*.json — `{header, rows}`
 * pulled from the production tables, owner records and free text stripped), reusing authRemount's fake-but-resumable session.
 *
 * It touches no real account and no real data: the host is the dummy one baked into the sandbox build, every request is answered here.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTH_FIXTURE, supabaseRouteHandler } from "./authRemount.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PLAN_FIXTURES = {
  "concept-a": { file: "concept-a.json", id: "smqfy2r7pdec", name: "Concept A" },
  "bolt-on": { file: "bolt-on.json", id: "smun6o2o628f", name: "Bolt-on" },
  "richfield": { file: "richfield-concept-a-live.json", id: "smt7q6ar8egz", name: "Concept A" },
};

export function loadPlans(keys) {
  return keys.map((k) => {
    const meta = PLAN_FIXTURES[k];
    const fx = JSON.parse(readFileSync(join(HERE, "..", "fixtures", "plan-load", meta.file), "utf8"));
    return { key: k, ...meta, header: fx.header, rows: fx.rows };
  });
}

/* A 256 px solid-colour PNG answers every aerial/basemap tile request. The sandbox has no route to the imagery host, and a blocked tile is not
 * free — Leaflet raises an error per tile and the tile-cache bookkeeping then runs against hundreds of failed tiles — so left blocked the rig
 * measures a map in a failure mode the owner's browser is not in. (GIS DATA requests, `/query`, are still refused: the owner's switches fired none.) */
const TILE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAACAUlEQVR42u3TMQ0AAAgEsdeHAlTgf2RGA02q4JJLT8FbkQADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAABhABQwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgAA6iAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGACuBWEeD/FVLjY0AAAAAElFTkSuQmCC", "base64");
const isTile = (u) => /\/tile\/\d+\/\d+\/\d+/.test(u) || /\/\d+\/\d+\/\d+(\.png|\.jpg)?(\?|$)/.test(u);
const ELEMENT_COLS = ["id", "kind", "data", "z_index", "rev", "updated_by", "updated_at", "deleted_at", "deleted_by", "op_id", "op_kind", "actor_session_id", "client_ts"];

/** Pad the account with N more plans (clones of the fixtures under new ids/groups) — the owner's account holds 143 plans, and every account-wide read
 *  (the sites list, every plan's parcels) scales with that, so a plan-open measured on a 3-plan account cannot see them. */
export function padLibrary(plans, n) {
  const out = [...plans];
  for (let i = 0; i < n; i++) {
    const src = plans[i % plans.length];
    out.push({ ...src, key: `lib-${i}`, id: `lib${i}x`, header: { ...src.header, id: `lib${i}x`, groupId: `libg${i}x`, site: `Library ${i}`, name: `Plan ${i}`, updatedAt: 1000 + i }, rows: src.rows });
  }
  return out;
}

/** A route handler: the stub's auth/other-table behaviour, plus the plans' headers and element rows. */
export function planRouteHandler({ base, supabaseUrl, plans, onLocal, commits = { n: 0 } }) {
  const stub = supabaseRouteHandler({
    base, supabaseUrl, onLocal,
    liveSites: plans.map((p) => ({ id: p.id, groupId: p.header.groupId || p.id, site: p.header.site, name: p.header.name })),
  });
  const json = (route, body) => route.fulfill({
    status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range" },
    body: JSON.stringify(body),
  });
  const siteRow = (p) => ({ id: p.id, data: p.header, version: 1, team_id: null, user_id: AUTH_FIXTURE.uid, share_locked: false, group_id: p.header.groupId || p.id, site: p.header.site, name: p.header.name, deleted_at: null, updated_at: new Date().toISOString() });
  /* B2225425 (round 3) — `commit_elements` is ANSWERED, and what it commits is kept (per run: one handler per browser context) and served
   * back on the next row read. The stub's blanket `[]` made every commit an unpaired result; a plan whose rows the app normalizes on open
   * (Bolt-on) then never converged in the rig the way it does in production after one open. */
  const committed = new Map();   // siteId → Map("kind:id" → row)
  const rowsOf = (p) => {
    const over = committed.get(p.id);
    if (!over || !over.size) return p.rows;
    const out = []; const seen = new Set();
    for (const r of p.rows) { const k = r.kind + ":" + r.id; seen.add(k); out.push(over.get(k) || r); }
    for (const [k, r] of over) if (!seen.has(k)) out.push(r);
    return out;
  };
  const commit = (route) => {
    let body = {}; try { body = JSON.parse(route.request().postData() || "{}"); } catch (_) { /* empty */ }
    const p = plans.find((q) => q.id === body.p_site);
    if (!committed.has(body.p_site)) committed.set(body.p_site, new Map());
    const over = committed.get(body.p_site);
    if (process.env.RIG_LOG_COMMITS) process.stderr.write(`[rig] commit ${body.p_site} ${(body.p_ops || []).length} ops: ${(body.p_ops || []).map((o) => o.kind + ":" + o.id + ":z" + o.z + "/" + (o.data && o.data.z) + ":" + (o.data && o.data.type) + ":" + (o.data && o.data.pts ? o.data.pts.length : "")).join(" ")}\n`);
    const results = (body.p_ops || []).map((op) => {
      const k = op.kind + ":" + op.id;
      const prev = over.get(k) || (p && p.rows.find((r) => r.kind === op.kind && r.id === op.id)) || null;
      const rev = ((prev && prev.rev) || 1) + 1;
      if (op.op === "delete") over.set(k, { ...(prev || { id: op.id, kind: op.kind, data: {} }), rev, deleted_at: "2026-10-08T12:00:00Z" });
      else over.set(k, { id: op.id, kind: op.kind, data: op.data, z_index: op.z ?? (prev && prev.z_index) ?? 0, rev, deleted_at: null });
      return { id: op.id, status: "ok", rev };
    });
    return json(route, body.p_atomic ? { applied: true, results } : results);
  };
  return (route) => {
    const req = route.request();
    const url = req.url();
    if (!url.startsWith(base) && !url.startsWith(supabaseUrl) && isTile(url)) return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: TILE_PNG });
    if (url.startsWith(supabaseUrl) && req.method() === "POST" && url.includes("/rest/v1/rpc/commit_elements")) { commits.n++; return commit(route); }
    if (!url.startsWith(supabaseUrl) || req.method() !== "GET") return stub(route);
    /* the account-wide reads (B849344: every plan's parcels in one round trip, paged; and the per-plan "last touched" list) */
    if (url.includes("/rest/v1/site_elements") && !/site_id=eq\./.test(url)) {
      const off = Number((url.match(/[?&]offset=(\d+)/) || [])[1] || 0), lim = Number((url.match(/[?&]limit=(\d+)/) || [])[1] || 1000);
      const parcelsOnly = /kind=eq\.parcel/.test(url);
      const all = [];
      for (const p of plans) for (const r of rowsOf(p)) if (!parcelsOnly || r.kind === "parcel") all.push(parcelsOnly ? { site_id: p.id, data: r.data } : { site_id: p.id, updated_at: "2026-10-08T12:00:00Z" });
      return json(route, all.slice(off, off + lim));
    }
    if (url.includes("/rest/v1/site_elements")) {
      const m = url.match(/site_id=eq\.([^&]+)/);
      const p = m && plans.find((q) => q.id === decodeURIComponent(m[1]));
      if (!p) return json(route, []);
      return json(route, rowsOf(p).filter((r) => !r.deleted_at).map((r, i) => ({
        id: r.id, kind: r.kind, data: r.data, z_index: r.z_index ?? i, rev: r.rev ?? 1,
        updated_by: null, updated_at: "2026-10-08T12:00:00Z", deleted_at: null, deleted_by: null, op_id: null, op_kind: null, actor_session_id: null, client_ts: null,
      })));
    }
    /* the route gate asks `sites?select=id,group_id,site,name,deleted_at` by `id=eq.` AND by `group_id=eq.` of the URL's project id — a plan whose
     * group id differs from its own id (Richfield) is found only through the second, so both are answered here, not by the stub (id only). */
    if (url.includes("/rest/v1/sites") && /select=id%2Cgroup_id/.test(url) && /[?&](id|group_id)=eq\./.test(url)) {
      const m = url.match(/[?&](?:id|group_id)=eq\.([^&]+)/); const want = m && decodeURIComponent(m[1]);
      return json(route, plans.filter((p) => p.id === want || (p.header.groupId || p.id) === want).map(siteRow));
    }
    if (url.includes("/rest/v1/sites") && /select=[^&]*data/.test(decodeURIComponent(url)) && !/[?&](id|group_id)=eq\./.test(url)) return json(route, plans.map(siteRow));
    return stub(route);
  };
}
export { ELEMENT_COLS };
