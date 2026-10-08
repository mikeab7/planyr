/* NEW-1 (2026-10-06) — every docked left-rail panel sits on the WHITE overlay surface (light) / matching surface (dark).
 * Drives the real planner: for each rail tab, reads the computed background of the panel host AND of the panel body,
 * and compares it to the resolved --surface-overlay token (known independently of the code under test).
 * Known-bad arm: the column backdrop token (--planner-panel) must differ from it, else the run is VOID.
 * Run: vite preview on :4173, then `node ui-audit/verify-left-panel-surface.mjs [--shots <dir>]`; BASE_URL_ORIGIN for a deploy.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import fs from "node:fs";
const ORIGIN = process.env.BASE_URL_ORIGIN || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || undefined;
const SHOTS = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "✅" : "❌"} ${n}${d ? "  — " + d : ""}`); if (!ok) failed++; };
const SITE = { id: "surf-1", lat: 29.80, lon: -95.0 };
const rec = { id: SITE.id, groupId: SITE.id, site: "Surface check", name: "Plan 1", origin: { lat: SITE.lat, lon: SITE.lon }, county: "harris",
  parcels: [{ id: "pc1", active: true, locked: false, points: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }] }],
  els: [{ id: "b1", type: "building", x: -150, y: -100, w: 300, h: 200, rot: 0, z: 1 }], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), data: { status: "active" }, status: "active" };
const TABS = ["parcel", "analysis", "drainage", "yield", "properties", "references", "standards"];
const browser = await chromium.launch({ executablePath: EXEC });
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(`(() => { try { window.__PLANYR_E2E = true; localStorage.setItem('planyr.theme', '${theme}');
    if (!localStorage.getItem('planarfit:sites:v1')) { localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ [SITE.id]: rec }))}); localStorage.setItem('planarfit:currentSite:v1', '${SITE.id}'); } } catch (e) {} })();`);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-left-panel-surface");
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"features":[]}' }));
  await page.goto(`${ORIGIN}/#/project/${SITE.id}/site`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const tok = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement);
    const probe = (v) => { const d = document.createElement("div"); d.style.background = `var(${v})`; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; };
    return { overlay: probe("--surface-overlay"), backdrop: probe("--planner-panel") }; });
  check(`[${theme}] known-bad arm: backdrop token differs from overlay token`, tok.overlay !== tok.backdrop, `${tok.overlay} vs ${tok.backdrop}`);
  const read = async (id) => {
    const btn = page.locator(`[data-rail-tab="${id}"]`).first();
    if (!(await btn.count())) return null;
    await btn.click(); await page.waitForTimeout(600);
    return page.evaluate(() => { const h = document.querySelector('[data-testid="left-menu-panel"]'); const b = h && h.querySelector("[data-panel-body]");
      return { host: h && getComputedStyle(h).backgroundColor, body: b && getComputedStyle(b).backgroundColor, bodyTransparent: b && getComputedStyle(b).backgroundColor === "rgba(0, 0, 0, 0)" }; });
  };
  for (const id of TABS) {
    const r = await read(id);
    if (!r) { check(`[${theme}] ${id} tab exists`, false); continue; }
    check(`[${theme}] ${id}: panel surface is the overlay token`, r.host === tok.overlay && (r.body === null || r.body === tok.overlay || r.bodyTransparent), JSON.stringify(r));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${theme}-${id}.png` });
  }
  // Properties: double-click the building on the canvas opens the inspector (rail tab may not exist for it)
  await page.keyboard.press("Escape");
  const box = await page.locator('[data-feature="el:b1"]').first().boundingBox().catch(() => null);
  if (box) { await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(900); }
  const pr = await page.evaluate(() => { const h = document.querySelector('[data-testid="left-menu-panel"]'); return h && getComputedStyle(h).backgroundColor; });
  check(`[${theme}] properties (building selected): panel surface is the overlay token`, pr === tok.overlay, String(pr));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${theme}-properties.png` });
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : "\nall passed"); process.exit(failed ? 1 : 0);
