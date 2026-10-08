/* /api/taxunits — one CAD account → its complete taxing-unit list + adopted rates (B2158065).
 *
 *   GET /api/taxunits?county=harris&acct=0591420000105
 *     → { county, acct, complete:true, year, source, sourceUrl, units:[{code,name,rate,type}], total }
 *     | { county, acct, complete:false, reason }       (the client then HIDES the table — never a partial list)
 *
 * Harris is sourced from HCAD's published bulk data (lib/hcadUnits.js). Counties not listed in COUNTIES answer
 * `complete:false` with the reason they are not wired — see the B2158065 ledger entry for each county's blocker.
 * Results are cached at the edge (a complete answer for a week; a "not yet" answer for an hour).
 */
import { lookupHarris, hcadZipUrl, findAccountRows, HCAD_PDATA_URL } from "./lib/hcadUnits.js";
import { answerFromIndex, PREFIX_LEN } from "./lib/hcadIndex.js";
import { remoteZipEntries } from "./lib/zipRange.js";
import { normalizeCounty } from "./taxrates.js";

const SOURCE = { source: "Harris Central Appraisal District — taxing units & adopted rates", sourceUrl: HCAD_PDATA_URL };

/** The precomputed index (Supabase cad_taxunit_shards, public read). Null when it is absent or unreachable —
 * the caller then falls back to the slow live scan, so the table degrades to slow, never to wrong. */
async function indexedLookup(county, acct, env) {
  if (!env || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const pre = acct.slice(0, PREFIX_LEN);
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/cad_taxunit_shards?county=eq.${county}&prefix=in.(${pre},_meta,_rates)&select=roll_year,prefix,data`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
  });
  if (!r.ok) return null;
  return answerFromIndex(acct, await r.json(), SOURCE);
}

const COUNTIES = { harris: { acct: /^\d{13}$/, lookup: lookupHarris } };
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", ...extra } });

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const origin = context.request.headers.get("Origin");
    if (origin) { try { if (new URL(origin).host !== url.host) return json({ error: "forbidden" }, 403); } catch (_) { return json({ error: "forbidden" }, 403); } }
    const county = normalizeCounty(url.searchParams.get("county")).replace(/\s+/g, "");
    const acct = String(url.searchParams.get("acct") || "").replace(/\D/g, "");
    if (!county || !acct) return json({ error: "missing county or acct" }, 400);
    const cfg = COUNTIES[county];
    if (!cfg) return json({ county, acct, complete: false, reason: "per-account taxing units are not available for this county yet" });
    if (!cfg.acct.test(acct)) return json({ county, acct, complete: false, reason: "not a valid account number for this county" });

    // Diagnostics (read-only): which stage of the lookup a failing environment dies in — Cloudflare's 1102 is
    // an uncatchable platform kill, so each stage is separately callable. ?stage=dir | rows
    const stage = url.searchParams.get("stage");
    if (stage && county === "harris") {
      const t0 = Date.now();
      const zu = hcadZipUrl(Number(url.searchParams.get("year")) || new Date().getUTCFullYear() - 1);
      const entries = await remoteZipEntries(zu);
      if (stage === "dir") return json({ stage, ms: Date.now() - t0, entries: entries && Object.keys(entries) });
      const rows = await findAccountRows(zu, entries["jur_value.txt"], acct, fetch);
      return json({ stage, ms: Date.now() - t0, rows: rows.length });
    }

    const cache = caches.default;
    const key = new Request(`${url.origin}${url.pathname}?county=${county}&acct=${acct}`, { method: "GET" });
    const hit = await cache.match(key);
    if (hit) return hit;

    const r = (await indexedLookup(county, acct, context.env)) || (await cfg.lookup(acct));
    const body = { county, acct, ...r };
    const res = json(body, 200, { "cache-control": `public, max-age=${r.complete ? 7 * 24 * 3600 : 3600}` });
    context.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (e) {
    return json({ error: `taxunits failed: ${e && e.message ? e.message : e}` }, 502);
  }
}
