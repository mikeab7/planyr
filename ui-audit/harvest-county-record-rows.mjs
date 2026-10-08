/* Harvest ONE real attribute row from every wired county parcel service, for test/countyRecord.test.js.
 *
 *   node ui-audit/harvest-county-record-rows.mjs            # writes test/fixtures/countyRecordRows.json
 *
 * The county record on the parcel page maps owner / account / address / deed acres from whatever columns
 * a county publishes; the only honest test of "every wired CAD" is a real row from each. A host that is
 * unreachable from this environment is listed under `unreachable` (never silently dropped) and the test
 * names it, so the gap is visible instead of a green that covers fewer counties than it claims.
 * Read-only: one `resultRecordCount=1` query per county, no geometry.
 */
import fs from "node:fs";
import { COUNTIES } from "../src/workspaces/site-planner/lib/counties.js";

const OUT = new URL("../test/fixtures/countyRecordRows.json", import.meta.url);
const rows = {}, unreachable = {};
const entries = Object.entries(COUNTIES).filter(([, c]) => c && c.layerUrl);

async function one([key, c]) {
  const base = String(c.layerUrl).replace(/\/+$/, "");
  const url = `${base}/query?where=${encodeURIComponent(c.scopeWhere || "1=1")}&outFields=*&returnGeometry=false&resultRecordCount=1&f=json`;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(url, { signal: ctl.signal }); clearTimeout(t);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || "service error");
    const f = (j.features || [])[0];
    if (!f || !f.attributes) throw new Error("no rows");
    rows[key] = { label: c.label, state: c.state, layerUrl: base, attrs: f.attributes };
  } catch (e) { unreachable[key] = String(e.message || e).slice(0, 120); }
}
const queue = entries.slice();
await Promise.all(Array.from({ length: 8 }, async () => { while (queue.length) await one(queue.shift()); }));
fs.writeFileSync(OUT, JSON.stringify({ harvestedAt: new Date().toISOString().slice(0, 10), rows, unreachable }, null, 1));
console.log(`${Object.keys(rows).length} counties harvested, ${Object.keys(unreachable).length} unreachable`);
