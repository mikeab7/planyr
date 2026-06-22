/* B366/B367/B368 — Site Analysis resilience + honest-state self-verification (headless).
 *
 * Seeds a Mont Belvieu (Chambers Co.) site, opens the Analysis tab, and confirms the new
 * honest states in a real browser:
 *   PASS 1 (normal): FEMA/NWI resolve; the RRC wells/pipelines (gis.rrc.texas.gov is NOT
 *     on the sandbox egress allow-list, so the browser can't reach them here) render as
 *     "Unavailable" with a "Retry" control — NEVER a false "None found" and NEVER the old
 *     misleading "network or CORS" text.
 *   PASS 2 (forced 503): intercept every ArcGIS /query with HTTP 503 and reload. The
 *     sources that were cached in pass 1 show the last-good value + an honest "couldn't
 *     refresh" stale note (stale-while-revalidate, B367); uncached sources show an honest
 *     "HTTP 503 — temporarily unavailable" (B366) — again, never "CORS", never "None found".
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node gis-verify/site-analysis-resilience-verify.mjs
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const OUT = (n) => new URL(`./resilience-${n}.png`, import.meta.url).pathname;

const site = {
  id: "ra-demo", groupId: "ra-demo", site: "Grand Port (Mont Belvieu)", name: "Plan 1",
  origin: { lat: 29.846, lon: -94.886 }, county: "chambers",
  parcels: [{ id: "pc1", locked: false, active: true,
    points: [{ x: -440, y: -240 }, { x: 440, y: -240 }, { x: 440, y: 240 }, { x: -440, y: 240 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {},
  underlay: null, updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [site.id]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

const panelText = (page) => page.evaluate(() => {
  const col = Array.from(document.querySelectorAll("div")).find((d) => /Screening/.test(d.textContent || "") && /active parcel/.test(d.textContent || ""));
  return (col ? col.textContent : document.body.textContent).replace(/\s+/g, " ");
});

const fail = [];
const check = (cond, msg) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) fail.push(msg); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

// ---- PASS 1: normal load ----
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1600);
await page.locator('button[title="Analysis"]').click({ timeout: 8000 });
await page.waitForTimeout(11000); // let the screen run + retries settle
const t1 = await panelText(page);
await page.screenshot({ path: OUT("1-normal") });
console.log("\n--- PASS 1 (normal) panel ---\n" + t1.slice(0, 1100) + "\n");

check(/Unavailable/.test(t1), "PASS1: at least one source reads 'Unavailable' (RRC unreachable in sandbox — honest, not a false clear)");
check(/Retry/.test(t1), "PASS1: a 'Retry' control is offered on the unavailable source(s)");
check(!/network or CORS/i.test(t1), "PASS1: NO misleading 'network or CORS' text anywhere");
check(/Floodplain|Flood/.test(t1), "PASS1: Floodplain row rendered (FEMA reachable)");
// Wells must NOT be a false 'None found' while its source is unreachable.
const wellsClear = /Oil & gas wells[^]*?None found/.test(t1) && !/Oil & gas wells[^]*?(Unavailable|present)/i.test(t1);
check(!wellsClear, "PASS1: Oil & gas wells is NOT reported 'None found' while its source is unreachable");

// Age the cached entries past their TTL so PASS 2 actually REVALIDATES them (otherwise a
// 7-day-TTL cache would just serve fresh-from-cache seconds later and never hit the 503).
// This mimics opening the site days later — the real stale-while-revalidate scenario.
await page.evaluate(() => {
  const NS = "planyr:giscache:v1:";
  const old = Date.now() - 30 * 24 * 3600 * 1000;
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(NS)) keys.push(k); }
  for (const k of keys) { try { const e = JSON.parse(localStorage.getItem(k)); if (e && typeof e.ts === "number") { e.ts = old; localStorage.setItem(k, JSON.stringify(e)); } } catch (_) {} }
});

// ---- PASS 2: force 503 on every ArcGIS /query, reload ----
await page.route("**/*", (route) => {
  const u = route.request().url();
  if (u.includes("/query")) return route.fulfill({ status: 503, contentType: "text/plain", body: "Service Unavailable" });
  return route.continue();
});
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1600);
await page.locator('button[title="Analysis"]').click({ timeout: 8000 });
await page.waitForTimeout(14000); // 503 + 2 retries w/ backoff per call, pooled
const t2 = await panelText(page);
await page.screenshot({ path: OUT("2-forced-503") });
console.log("\n--- PASS 2 (forced 503) panel ---\n" + t2.slice(0, 1300) + "\n");

check(/503|temporarily unavailable/i.test(t2), "PASS2: the honest 'HTTP 503 — temporarily unavailable' reason is surfaced");
check(!/network or CORS/i.test(t2), "PASS2: still NO 'network or CORS' mislabel under a real 503");
check(/Retry/.test(t2), "PASS2: a 'Retry' control is present");
const staleShown = /couldn't refresh/i.test(t2);
check(staleShown, "PASS2: a previously-cached source shows last-good + \"couldn't refresh\" (stale-while-revalidate)");

check(pageErrors.length === 0, `no uncaught page errors (saw ${pageErrors.length})`);
if (pageErrors.length) console.log(pageErrors.slice(0, 4).join("\n"));

await browser.close();
console.log(`\n${fail.length ? "✗ FAIL: " + fail.length + " check(s) failed" : "✓ ALL CHECKS PASSED"}`);
process.exit(fail.length ? 1 : 0);
