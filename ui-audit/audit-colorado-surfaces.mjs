/* COLORADO AUDIT — WHAT THE SCREEN ACTUALLY SAYS ON A COLORADO SITE.
 *
 * The companion to audit-colorado-missing-data.mjs, and the half that matters. That one prints what
 * the pure modules COMPUTE; this one drives the real app in a real browser on the owner's own ground
 * (Johnstown, on the Weld/Larimer county line) and reads back the rendered text of every
 * Colorado-touching surface. A unit test asserting a value was computed proves nothing about what
 * the user is told — that is this repo's #848 and #884 lesson, and it is why this harness exists.
 *
 * It is an INSTRUMENT, not a gate: it prints, it does not judge. Findings are read off the dump.
 *
 * A Colorado plan is SEEDED into the logged-out localStorage store (the verify-b1105-mhfd-panel
 * precedent): geocoding needs external hosts this environment blocks, and the whole point of the
 * Colorado tier is that it holds with every GIS endpoint down.
 *
 * Run: npm run build && node ui-audit/audit-colorado-surfaces.mjs [--full]
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const local = !process.env.BASE_URL;
const SITES_KEY = "planarfit:sites:v1";
const CUR_KEY = "planarfit:currentSite:v1";
const FULL = process.argv.includes("--full");

let server = null;
async function serve() {
  if (!local) return;
  server = spawn("npx", ["vite", "preview", "--port", "4173", "--host"], { stdio: "ignore", detached: true });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("preview server never came up");
}

/* A 1,320 ft square (40 ac) parcel and one drawn detention pond, in the planner's FEET frame.
 * `points: [{x,y}]` per `validParcel` in siteModel.js — a `ring` of pairs is silently dropped. */
const sq = (cx, cy, half) => [
  { x: cx - half, y: cy - half }, { x: cx + half, y: cy - half },
  { x: cx + half, y: cy + half }, { x: cx - half, y: cy + half },
];

const PLANS = [
  // The owner's ground. Weld side of the Johnstown town line.
  { key: "weld", gid: "grp-co-weld", sid: "site-co-weld", name: "Johnstown Weld", origin: { lat: 40.337, lon: -104.912 }, county: "co_weld", pond: true },
  { key: "larimer", gid: "grp-co-lar", sid: "site-co-lar", name: "Johnstown Larimer", origin: { lat: 40.352, lon: -105.012 }, county: "co_larimer", pond: true },
  { key: "denver", gid: "grp-co-den", sid: "site-co-den", name: "Denver MHFD", origin: { lat: 39.74, lon: -104.99 }, county: "co_denver", pond: true },
  { key: "weld_nopond", gid: "grp-co-weld2", sid: "site-co-weld2", name: "Johnstown no pond", origin: { lat: 40.337, lon: -104.912 }, county: "co_weld", pond: false },
  { key: "texas", gid: "grp-tx", sid: "site-tx", name: "Harris TX control", origin: { lat: 29.78, lon: -95.8 }, county: "harris", pond: true },
];

const run = async () => {
  await serve();
  /* ⛔ --ignore-certificate-errors is mandatory here: the sandbox routes HTTPS through a TLS
   * inspection proxy Node trusts and Chromium does not, so without it every tile
   * fails ERR_CERT_AUTHORITY_INVALID and the basemap renders gray (docs/REFERENCE.md). */
  const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  /* ⛔ FOREGROUND-OR-VOID — a background tab cannot be measured, neither its clock nor its pixels. */
  await assertMeasurable(page, "audit-colorado-surfaces");
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);

  await page.evaluate(({ sk, plans }) => {
    const store = {};
    for (const p of plans) {
      const els = p.pond
        ? [{
            id: "pond1", kind: "pond", type: "pond", name: "Detention pond",
            points: [{ x: -600, y: -600 }, { x: -200, y: -600 }, { x: -200, y: -200 }, { x: -600, y: -200 }],
            depthFt: 8, det: { role: "detention" },
          }]
        : [];
      store[p.sid] = {
        schemaVersion: 2, id: p.sid, groupId: p.gid, site: p.name, name: "Concept A",
        origin: p.origin, county: p.county,
        parcels: [{ id: "p1", active: true, points: p.sqPts }],
        els, markups: [], measures: [], callouts: [], settings: {},
      };
    }
    localStorage.setItem(sk, JSON.stringify(store));
  }, { sk: SITES_KEY, plans: PLANS.map((p) => ({ ...p, sqPts: sq(0, 0, 660) })) });

  /* Read the PLANNER surface only. Both hosts stay mounted (the inactive one is inert + aria-hidden
   * and holds no drainage context), so asserting against document.body reads a panel that
   * legitimately says nothing. */
  const plannerText = () => page.evaluate(() => {
    const host = document.querySelector('[data-surface="planner"]');
    return (host || document.body).innerText || "";
  });

  for (const plan of PLANS) {
    await page.evaluate(({ ck, sid }) => localStorage.setItem(ck, sid), { ck: CUR_KEY, sid: plan.sid });
    await page.goto(`${BASE}#/project/${plan.gid}/site`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(7000);
    console.log(`\n${"=".repeat(78)}\n=== ${plan.key.toUpperCase()} — ${plan.name} @ ${plan.origin.lat},${plan.origin.lon} (${plan.county})\n${"=".repeat(78)}`);
    /* Each right-rail panel is its own surface. Open them one at a time, expand every collapsed
     * group inside (twice — a group can reveal further groups), and dump. */
    for (const tab of ["Yield", "Analysis", "Land", "Standards"]) {
      const opened = await page.evaluate((name) => {
        const host = document.querySelector('[data-surface="planner"]') || document.body;
        const btn = [...host.querySelectorAll("button, [role=tab], div")]
          .filter((e) => e.textContent.trim() === name && e.getBoundingClientRect().width > 0)
          .pop();
        if (!btn) return false;
        btn.click();
        return true;
      }, tab);
      if (!opened) { console.log(`\n--- [${tab}] tab not found`); continue; }
      await page.waitForTimeout(2500);
      for (let pass = 0; pass < 3; pass++) {
        await page.evaluate(() => {
          const host = document.querySelector('[data-surface="planner"]') || document.body;
          for (const el of host.querySelectorAll('[aria-expanded="false"]')) {
            try { el.click(); } catch { /* ignore */ }
          }
        });
        await page.waitForTimeout(900);
      }
      const txt = await plannerText();
      console.log(`\n--- [${tab}] panel ---------------------------------------------------------`);
      console.log(FULL ? txt : txt.slice(0, 12000));
    }
  }

  if (errs.length) console.log("\n⚠ page errors:\n" + errs.slice(0, 10).join("\n"));
  await browser.close();
  if (server) { try { process.kill(-server.pid); } catch { /* already gone */ } }
};

run().catch((e) => { console.error(e); if (server) { try { process.kill(-server.pid); } catch { /* gone */ } } process.exit(1); });
