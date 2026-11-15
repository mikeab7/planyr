/* /api/taxunits — one CAD account → its complete taxing-unit list + adopted rates (B2158065).
 *
 *   GET /api/taxunits?county=harris&acct=0591420000105
 *     → { county, acct, complete:true, year, source, sourceUrl, units:[{code,name,rate,type}], total }
 *     | { county, acct, complete:false, reason }       (the client then HIDES the table — never a partial list)
 *
 * Harris is sourced from HCAD's published bulk data (lib/hcadUnits.js). Counties not listed in COUNTIES answer
 * `complete:false` with the reason they are not wired — see the B2158065 ledger entry for each county's blocker.
 * Harris answers from the index also carry `rollYear` + `staleState` ("current" | "not-adopted" | "refresh-pending", NEW-3).
 * Results are cached at the edge (a complete answer for a week; a "not yet" answer for an hour).
 */
import { lookupHarris, hcadZipUrl, findAccountRows, HCAD_PDATA_URL } from "./lib/hcadUnits.js";
import { answerFromIndex, PREFIX_LEN } from "./lib/hcadIndex.js";
import { remoteZipEntries } from "./lib/zipRange.js";
import { normalizeCounty } from "./taxrates.js";
import { lookupFortBend } from "./lib/fortBendUnits.js";
import { decideStaleness, staleCaption } from "./lib/rollStale.js";
import { parseRateTable } from "./lib/hcadUnits.js";
import { readZipEntryText } from "./lib/zipRange.js";

const SOURCE = { source: "Harris Central Appraisal District — taxing units & adopted rates", sourceUrl: HCAD_PDATA_URL };

/** The precomputed index (Supabase cad_taxunit_shards, public read). One of:
 *   { kind: "ok", result }   — answered from the index
 *   { kind: "noindex" }      — Supabase answered but no complete index exists (never built) → the slow scan may help
 *   { kind: "error" }        — Supabase unreachable/erroring after a retry → say "try again", NEVER scan: the live
 *                              scan cannot survive deep accounts and a Worker kill (1102) returns an HTML error page. */
async function indexedLookup(county, acct, env, fetchImpl = fetch) {
  if (!env || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return { kind: "noindex" };
  const pre = acct.slice(0, PREFIX_LEN);
  const url = `${env.SUPABASE_URL}/rest/v1/cad_taxunit_shards?county=eq.${county}&prefix=in.(${pre},_meta,_rates)&select=roll_year,prefix,data`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetchImpl(url, { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` } });
      if (r.ok) {
        const result = answerFromIndex(acct, await r.json(), SOURCE);
        return result ? { kind: "ok", result } : { kind: "noindex" };
      }
    } catch (_) { /* retry */ }
    if (attempt < 2) await new Promise((res) => setTimeout(res, 150 * (attempt + 1)));
  }
  return { kind: "error" };
}

/** Fort Bend (NEW-1): FBCAD account "R33231" (membership = the CAD's TAXUNITS field), rates from the county's own
 * rate portal — see lib/fortBendUnits.js. Every upstream read is edge-cached; no Supabase index is involved. */
const edgeGet = (cache) => async (u, { ttl = 3600 } = {}) => {
  const key = new Request(u, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;
  const r = await fetch(u, { headers: { "user-agent": "planyr-taxunits" } });
  if (r.ok) { const c = new Response(await r.clone().arrayBuffer(), { status: 200, headers: { "content-type": r.headers.get("content-type") || "text/plain", "cache-control": `public, max-age=${ttl}` } }); await cache.put(key, c); }
  return r;
};
const COUNTIES = {
  harris: { acct: /^\d{13}$/, lookup: lookupHarris, norm: (a) => String(a).replace(/\D/g, ""), indexed: true },
  fortbend: { acct: /^R\d{1,9}$/, lookup: (acct) => lookupFortBend(acct, edgeGet(caches.default)), norm: (a) => { const m = /R\s*0*(\d+)/i.exec(String(a)); return m ? `R${m[1]}` : ""; }, indexed: false },
};
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", ...extra } });

/** NEW-3: is the indexed Harris answer behind a newer roll? Reads only the small rate file of each newer year (HCAD
 * publishes the zip tail + that entry), cached per roll year for six hours. Never throws — a failed check says nothing. */
async function harrisStaleness(rollYear, cache, origin, fetchImpl = fetch) {
  const nowYear = new Date().getUTCFullYear();
  if (!(rollYear < nowYear)) return decideStaleness({ rollYear, nowYear });
  const key = new Request(`${origin}/api/taxunits?stale=harris&y=${rollYear}&now=${nowYear}`, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const newer = [];
  for (let y = rollYear + 1; y <= nowYear; y++) {
    const u = hcadZipUrl(y);
    const entries = await remoteZipEntries(u, fetchImpl);
    const e = entries && entries["jur_tax_dist_exempt_value_rate.txt"];
    newer.push({ year: y, rates: e ? parseRateTable(await readZipEntryText(u, e, fetchImpl)) : null });
  }
  const v = decideStaleness({ rollYear, nowYear, newer });
  await cache.put(key, json(v, 200, { "cache-control": "public, max-age=21600" }));
  return v;
}

export { indexedLookup, harrisStaleness };

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const origin = context.request.headers.get("Origin");
    if (origin) { try { if (new URL(origin).host !== url.host) return json({ error: "forbidden" }, 403); } catch (_) { return json({ error: "forbidden" }, 403); } }
    const county = normalizeCounty(url.searchParams.get("county")).replace(/\s+/g, "");
    const rawAcct = String(url.searchParams.get("acct") || "");
    const cfg = COUNTIES[county];
    const acct = cfg ? cfg.norm(rawAcct) : rawAcct.replace(/\D/g, "");
    if (!county || !acct) return json({ error: "missing county or acct" }, 400);
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

    const idx = cfg.indexed ? await indexedLookup(county, acct, context.env) : { kind: "noindex" };
    if (idx.kind === "error") return json({ county, acct, complete: false, transient: true, reason: "the tax-rate index could not be reached just now" }, 200, { "cache-control": "no-store" });
    const r = idx.kind === "ok" ? idx.result : await cfg.lookup(acct);
    const body = { county, acct, ...r };
    if (county === "harris" && r.indexed && r.complete && r.year) {
      body.rollYear = r.year;
      try { const v = await harrisStaleness(r.year, cache, url.origin); body.stale = v.stale; body.staleState = v.state; if (v.newerYear) body.newerYear = v.newerYear; const cap = staleCaption(v); if (cap) body.caption = cap; } catch (_) { /* a failed staleness check adds nothing */ }
    }
    if (r.transient) return json(body, 200, { "cache-control": "no-store" });
    const res = json(body, 200, { "cache-control": `public, max-age=${r.complete ? (county === "fortbend" || (body.staleState && body.staleState !== "current") ? 6 * 3600 : 7 * 24 * 3600) : 3600}` });
    context.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (e) {
    return json({ error: `taxunits failed: ${e && e.message ? e.message : e}` }, 502);
  }
}
