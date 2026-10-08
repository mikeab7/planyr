/* /api/taxunits-index — builds the precomputed HCAD account → taxing-unit index (B2158065). Owner-run, not public.
 *
 *   POST ?county=harris&year=2025&action=rates     → writes '_rates' (code → name, prior, current rate)
 *   POST ?county=harris&year=2025&action=resume    → one RESUMABLE step through jur_value.txt (call until done:true;
 *                                                    `reset=1` starts over). Each step inflates a few MB of the
 *                                                    compressed stream in JS from a saved block boundary, writes the
 *                                                    shards that are complete, saves a checkpoint ('_ckpt'), and on
 *                                                    the last step writes '_meta' (marks the year complete).
 * Header `x-index-key` must equal env.E2E_LOGIN_KEY (the one server-side secret already provisioned for owner-run
 * tooling). Writes with the service role; `dry=1` computes and writes nothing. Why resumable: see
 * lib/inflateResume.js. Run once per year after HCAD publishes it (the B2158065 ledger entry says how).
 */
import { remoteZipEntries, readZipEntryText, zipEntryDataStart, readRange } from "./lib/zipRange.js";
import { hcadZipUrl, parseRateTable } from "./lib/hcadUnits.js";
import { resumeStep, ratesToJson } from "./lib/hcadIndex.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };
const unb64 = (s) => { const t = atob(s), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
const hdrs = (env, extra = {}) => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, ...extra });

async function upsert(env, rows) {
  for (let i = 0; i < rows.length; i += 400) {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/cad_taxunit_shards?on_conflict=county,roll_year,prefix`, {
      method: "POST", headers: hdrs(env, { "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify(rows.slice(i, i + 400)),
    });
    if (!r.ok) throw new Error(`supabase upsert failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
}
async function getRow(env, county, year, prefix) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/cad_taxunit_shards?county=eq.${county}&roll_year=eq.${year}&prefix=eq.${encodeURIComponent(prefix)}&select=data`, { headers: hdrs(env) });
  if (!r.ok) throw new Error(`supabase read failed: HTTP ${r.status}`);
  const rows = await r.json();
  return rows[0] || null;
}
async function delRow(env, county, year, prefix) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/cad_taxunit_shards?county=eq.${county}&roll_year=eq.${year}&prefix=eq.${encodeURIComponent(prefix)}`, { method: "DELETE", headers: hdrs(env) });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.E2E_LOGIN_KEY || request.headers.get("x-index-key") !== env.E2E_LOGIN_KEY) return json({ error: "forbidden" }, 403);
    const q = new URL(request.url).searchParams;
    const county = q.get("county"), year = Number(q.get("year"));
    if (county !== "harris" || !year) return json({ error: "county=harris and year required" }, 400);
    const dry = q.get("dry") === "1";
    if (!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)) return json({ error: "supabase env missing" }, 500);
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
    if (action === "resume") {
      const entry = entries["jur_value.txt"];
      const dataStart = await zipEntryDataStart(url, entry);
      let state = null;
      if (q.get("reset") !== "1") {
        const row = await getRow(env, county, year, "_ckpt");
        if (row) { const j = JSON.parse(row.data); state = { bit: j.bit, win: unb64(j.win), ix: j.ix, accounts: j.accounts }; }
      }
      const r = await resumeStep({
        readRange: (a, b) => readRange(url, a, b), dataStart, csize: entry.csize, state,
        // A Worker's clock is FROZEN during pure computation (Date.now() only advances across I/O), so a time budget
        // never fires — each step is bounded by OUTPUT BYTES instead (`out` MB, default 24; `mb` = compressed MB fetched).
        maxOut: (Number(q.get("out")) || 24) * 1048576, fetchBytes: (Number(q.get("mb")) || 3) * 1048576,
      });
      if (!dry) {
        await upsert(env, r.flushed.map(([prefix, data]) => ({ county, roll_year: year, prefix, data })));
        if (r.done) {
          await upsert(env, [{ county, roll_year: year, prefix: "_meta", data: JSON.stringify({ year, accounts: r.state.accounts, built_at: new Date().toISOString() }) }]);
          await delRow(env, county, year, "_ckpt");
        } else {
          await upsert(env, [{ county, roll_year: year, prefix: "_ckpt", data: JSON.stringify({ bit: r.state.bit, win: b64(r.state.win), ix: r.state.ix, accounts: r.state.accounts }) }]);
        }
      }
      return json({ action, done: r.done, bitPct: Math.round((r.state.bit / 8 / entry.csize) * 1000) / 10, accounts: r.state.accounts, shardsWritten: r.flushed.length, outMB: Math.round(r.stats.outBytes / 1e5) / 10, ms: Date.now() - t0, dry });
    }
    return json({ error: "action=rates|resume" }, 400);
  } catch (e) {
    return json({ error: `taxunits-index failed: ${e && e.message ? e.message : e}` }, 502);
  }
}
