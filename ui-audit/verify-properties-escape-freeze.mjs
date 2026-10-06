#!/usr/bin/env node
/* verify-properties-escape-freeze — NEW-1: a LOCATED plan must survive the Properties-tab + Escape loop.
 *
 *   npm run build && npx vite preview --port 4199 --strictPort &
 *   node ui-audit/verify-properties-escape-freeze.mjs [http://localhost:4199] [cycles=30]
 *
 * THE DEFECT (reported on planyr.io build 6000483, reproduced here signed OUT on a seeded plan, so it never
 * needed the cloud): on a plan with an `origin`, looping a REAL click on the left rail's Properties tab and an
 * immediate real Escape froze the whole page after a handful of cycles — the next click never completed and
 * `page.evaluate` never answered. Paused in the debugger mid-freeze, React was committing ~300 times a second
 * forever, every render scheduled by the planner's Layers-coverage effect: it depended on the `view`/`size`
 * OBJECTS (whose identity churns once a panel toggle leaves `setSize`'s updater retained — B1189) and
 * dispatched an unconditional `setCoverage(<fresh object>)` from an already-resolved promise, i.e. a
 * microtask, so the queue never drained and React's error-185 breaker never tripped.
 *
 * Arms:
 *   • LOCATED (the case under test): 30 real click+Escape cycles; every cycle must complete and the page must
 *     answer an evaluate afterwards.
 *   • KNOWN-GOOD (UNLOCATED, same plan without `origin`): the reporter's own control, which passed on the
 *     broken build too. If it does not pass here the instrument is wrong and the run is VOID.
 * Preconditions refuse to score: the canvas, the rail tab and a Leaflet map container must be present on the
 * located arm (no map → the effect's located branch never runs and a pass would mean nothing).
 * Uses the driver's REAL mouse/keyboard (SYNTHETIC-KEYS-DONT-EDIT) and asserts a foreground tab
 * (FOREGROUND-OR-VOID). Exits 0 pass · 1 freeze reproduced · 2 void.
 * PROVEN RED on the unfixed build (freeze at cycle 5–8) before it was accepted.
 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = (process.argv[2] || "http://localhost:4199").replace(/\/$/, "");
const CYCLES = +(process.argv[3] || 30);

/* A plan with an origin and a row of buildings — the scene the report names, nothing of anyone's. */
const bldg = (i, cx, cy) => ({ id: `fz${i}`, type: "building", cx, cy, w: 314.29, h: 200, rot: 0, z: 1000 + i, dockSide: "bottom", dockAxis: "x" });
function plan(id, located) {
  return {
    id, groupId: id, name: "freeze probe", site: "freeze probe", schemaVersion: 15, county: "harris",
    ...(located ? { origin: { lat: 29.81, lon: -95.2735 } } : {}),
    els: [bldg(1, 333.7, 981.6), bldg(2, 1725.7, 981.6), bldg(3, 1725.7, 279.6), { id: "fz9", type: "building", cx: 785.6, cy: 1291.1, w: 870, h: 585, rot: 0, z: 1009, dockSide: "bottom", dockAxis: "x" }],
    parcels: [], markups: [], callouts: [], measures: [], settings: {}, deletedIds: [], updatedAt: 0,
  };
}

async function runArm(browser, located) {
  const id = located ? "zzfreezeloc" : "zzfreezeunloc";
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(`(() => { try { if (!sessionStorage.getItem('fzseeded')) { sessionStorage.setItem('fzseeded','1');
    localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ [id]: plan(id, located) }))});
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(id)}); } } catch (e) {} })();`);
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/#/project/${id}/site`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
    await assertMeasurable(page, "verify-properties-escape-freeze");
    await pacedWait(page, 3000);
    const pre = await page.evaluate(() => ({ rail: !!document.querySelector('[data-rail-tab="properties"]'), map: !!document.querySelector(".leaflet-container") }));
    if (!pre.rail) return { void: "the Properties rail tab is missing" };
    if (located && !pre.map) return { void: "the located plan mounted no Leaflet map — the located branch is not exercised" };
    const fit = page.locator('button[title="Zoom to fit"]').first();
    if (await fit.count()) { await fit.click(); await pacedWait(page, 1500); }
    const tab = page.locator('[data-rail-tab="properties"]').first();
    for (let i = 0; i < CYCLES; i++) {
      const ok = await Promise.race([tab.click({ timeout: 10000 }).then(() => true, () => false), new Promise((r) => setTimeout(() => r(false), 11000))]);
      if (!ok) return { frozenAt: i };
      await page.keyboard.press("Escape");
    }
    const alive = await Promise.race([page.evaluate(() => true), new Promise((r) => setTimeout(() => r(false), 10000))]);
    return alive ? { ok: true } : { frozenAt: CYCLES };
  } finally { await ctx.close().catch(() => {}); }
}

const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
let code = 0;
try {
  const control = await runArm(browser, false);
  console.log("known-good arm (unlocated):", JSON.stringify(control));
  if (!control.ok) { console.error("✗ VOID — the unlocated control did not pass, so this instrument cannot be trusted"); code = 2; }
  else {
    const r = await runArm(browser, true);
    console.log("located arm:", JSON.stringify(r));
    if (r.void) { console.error("✗ VOID — " + r.void); code = 2; }
    else if (r.frozenAt != null) { console.error(`✗ FREEZE — the page stopped answering at cycle ${r.frozenAt}`); code = 1; }
    else console.log(`✓ ${CYCLES} real Properties + Escape cycles on a located plan, page responsive throughout`);
  }
} finally { await browser.close().catch(() => {}); }
process.exit(code);
