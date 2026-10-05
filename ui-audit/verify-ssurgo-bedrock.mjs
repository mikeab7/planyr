/* B2081251 — LIVE arm for the SSURGO shallow-rock layer. The build sandbox cannot reach sdmdataaccess.sc.egov.usda.gov
 * (CONNECT 403), so test/ssurgoBedrock.test.js proves the parse/join against the documented formats and THIS proves
 * the real services answer them: it runs the SAME pure fetch (lib/ssurgoBedrock.js) with its transport bridged
 * through a real browser tab on planyr.io, so CORS is exercised exactly as the app hits it.
 *
 *   node ui-audit/verify-ssurgo-bedrock.mjs [https://planyr.io]
 *
 * Known-good arm: a Piedmont point (Cecil/Pacolet country, Gwinnett Co. GA) MUST return ≥1 painted shallow-rock unit;
 * a deep-soil coastal-plain point may return few or none. A run whose known-good arm is empty is VOID, not a pass.
 * Exit 2 = host unreachable (nothing checked). Exit 1 = reachable but wrong. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { fetchBedrockView } from "../src/workspaces/site-planner/lib/ssurgoBedrock.js";

const BASE = process.argv[2] || process.env.BASE_URL || "https://planyr.io";
const EXEC = process.env.PW_CHROME || undefined;
const box = (lat, lng, h = 0.01) => ({ s: lat - h, n: lat + h, w: lng - h, e: lng + h });
const ARMS = [
  { label: "Piedmont (Gwinnett Co.) — KNOWN GOOD", bb: box(33.95, -84.0), mustPaint: true },
  { label: "Piedmont (Cherokee Co.)", bb: box(34.25, -84.45), mustPaint: false },
  { label: "Coastal plain (Savannah)", bb: box(32.05, -81.1), mustPaint: false },
  { label: "Texas control (Katy)", bb: box(29.79, -95.82), mustPaint: false },
];

const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] });
const page = await (await browser.newContext()).newPage();
await assertMeasurable(page, "verify-ssurgo-bedrock");
try { await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 }); }
catch (e) { console.error(`UNREACHABLE: ${BASE} — ${e.message}`); await browser.close(); process.exit(2); }

const fetchImpl = async (url, init) => {
  const r = await page.evaluate(async ({ url, init }) => {
    try {
      const res = await fetch(url, init);
      return { ok: res.ok, status: res.status, body: await res.text() };
    } catch (e) { return { error: String(e && e.message || e) }; }
  }, { url, init });
  if (r.error) throw new Error(`browser fetch failed (CORS or network): ${r.error}`);
  return { ok: r.ok, status: r.status, text: async () => r.body, json: async () => JSON.parse(r.body) };
};

let failed = false, unreachable = false;
for (const arm of ARMS) {
  try {
    const r = await fetchBedrockView(arm.bb, { fetchImpl });
    const byClass = {};
    for (const p of r.polys) byClass[p.cls.id] = (byClass[p.cls.id] || 0) + 1;
    console.log(`${arm.label}: ${r.total} map units in view, ${r.polys.length} shallow-rock painted ${JSON.stringify(byClass)}${r.capped ? " (CAPPED)" : ""}`);
    if (arm.mustPaint && !r.polys.length) { console.log("  ✗ known-good arm painted nothing — run is VOID"); failed = true; }
  } catch (e) {
    console.log(`${arm.label}: ✗ ${e.message}`);
    if (/browser fetch failed/.test(e.message)) unreachable = true; else failed = true;
  }
}
await browser.close();
if (failed) process.exit(1);
if (unreachable) { console.error("UNREACHABLE: SDA host not reachable from this browser — nothing was checked."); process.exit(2); }
console.log("PASS");
