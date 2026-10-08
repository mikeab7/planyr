/* /api/taxunits-index — builds the precomputed HCAD account → taxing-unit index (B2158065). Owner-run, not public.
 *
 *   POST /api/taxunits-index?county=harris&year=2025&action=rates            → writes '_rates' (code → name, prior, current)
 *   POST /api/taxunits-index?county=harris&year=2025&from=<acct>&max=300000  → indexes one slice, returns { next }
 *   POST /api/taxunits-index?county=harris&year=2025&action=finish&accounts=N → writes '_meta' (marks the year complete)
 * Header `x-index-key` must equal env.E2E_LOGIN_KEY (the one server-side secret already provisioned for owner-run
 * tooling). Writes with the service role; `dry=1` computes and writes nothing. Slices re-inflate the roll from the
 * start (deflate cannot be entered mid-stream) but only look at 13 bytes per chunk until `from`, so each call is
 * cheap in JavaScript. Run a year once after HCAD publishes it (docs: the B2158065 ledger entry).
 */
import { remoteZipEntries, readZipEntryText } from "./lib/zipRange.js";
import { hcadZipUrl, parseRateTable } from "./lib/hcadUnits.js";
import { indexSlice, ratesToJson } from "./lib/hcadIndex.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });

async function upsert(env, rows) {
  for (let i = 0; i < rows.length; i += 400) {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/cad_taxunit_shards?on_conflict=county,roll_year,prefix`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(i, i + 400)),
    });
    if (!r.ok) throw new Error(`supabase upsert failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.E2E_LOGIN_KEY || request.headers.get("x-index-key") !== env.E2E_LOGIN_KEY) return json({ error: "forbidden" }, 403);
    const q = new URL(request.url).searchParams;
    const county = q.get("county"), year = Number(q.get("year"));
    if (county !== "harris" || !year) return json({ error: "county=harris and year required" }, 400);
    const dry = q.get("dry") === "1";
    if (!dry && !(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)) return json({ error: "supabase env missing" }, 500);
    const url = hcadZipUrl(year);
    const entries = await remoteZipEntries(url);
    if (!entries) return json({ error: `no HCAD roll published for ${year}` }, 404);
    const t0 = Date.now();
    const action = q.get("action");
    if (action === "rates") {
      const rates = parseRateTable(await readZipEntryText(url, entries["jur_tax_dist_exempt_value_rate.txt"]));
      if (!dry) await upsert(env, [{ county, roll_year: year, prefix: "_rates", data: JSON.stringify(ratesToJson(rates)) }]);
      return json({ action, units: rates.size, ms: Date.now() - t0 });
    }
    if (action === "finish") {
      const meta = { year, accounts: Number(q.get("accounts")) || null, built_at: new Date().toISOString() };
      if (!dry) await upsert(env, [{ county, roll_year: year, prefix: "_meta", data: JSON.stringify(meta) }]);
      return json({ action, meta });
    }
    const from = q.get("from") || "";
    const r = await indexSlice(url, entries["jur_value.txt"], from, Number(q.get("max")) || 300000);
    if (!dry) await upsert(env, [...r.shards].map(([prefix, data]) => ({ county, roll_year: year, prefix, data })));
    return json({ from, next: r.next, accounts: r.accounts, lines: r.lines, shards: r.shards.size, ms: Date.now() - t0, dry });
  } catch (e) {
    return json({ error: `taxunits-index failed: ${e && e.message ? e.message : e}` }, 502);
  }
}
