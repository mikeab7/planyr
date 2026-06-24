/**
 * B423 + B424 — verify the precision-pin map markers + the corrected status palette.
 *
 * Seeds one site per status (status at TOP LEVEL, the logged-out path). Confirms:
 *   B424 (the precision pin):
 *     1. Pursuit/Active/On-hold/Complete render; Dead is HIDDEN by default.
 *     2. Each pin is a BULB + STALK + GROUND RING (the survey-monument read).
 *     3. The ground-ring center sits at the viewBox bottom (cy=34) and the icon anchor
 *        is the hit-box bottom-center (margin = -[17,46]) → the ring center IS the spot.
 *     4. The ground ring shows PROGRESS: sweep length tracks status
 *        (Complete 100% > Active 60% > On-hold 30% > Pursuit 10%).
 *     5. Size tiers track importance: Pursuit > Active > On-hold > Complete > Dead.
 *     6. SOLID bulb fill + a WHITE keyline (white disc behind it) — never hollow.
 *   B423 (the palette):
 *     7. Correct fills (coral Pursuit, blue Active, amber On-hold, gray Complete).
 *     8. RED (#E24B4A) appears on NO marker.
 *     9. Dead (filtered in) is a SOLID gray disc with a ✕ glyph + dimmed (opacity 0.5).
 *
 * Run:  npm run build && npx vite preview --port 4173 &   then   node ui-audit/verify-precision-pin.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/precision-pin/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Pursuit + Complete share a lat so the z-order/size tests isolate the per-status art.
const sites = {
  s_pursuit:  { id: "s_pursuit",  groupId: "s_pursuit",  site: "Cypress Pursuit",    name: "Plan 1", status: "pursuit",  origin: { lat: 29.78,  lon: -95.42 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() },
  s_complete: { id: "s_complete", groupId: "s_complete", site: "Brookshire Complete", name: "Plan 1", status: "complete", origin: { lat: 29.78,  lon: -95.32 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() },
  s_active:   { id: "s_active",   groupId: "s_active",   site: "Katy Active",        name: "Plan 1", status: "active",   origin: { lat: 29.73,  lon: -95.42 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() },
  s_onhold:   { id: "s_onhold",   groupId: "s_onhold",   site: "Bear Creek On Hold", name: "Plan 1", status: "onhold",   origin: { lat: 29.73,  lon: -95.32 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() },
  s_dead:     { id: "s_dead",     groupId: "s_dead",     site: "Old Dead Deal",      name: "Plan 1", status: "dead",     origin: { lat: 29.755, lon: -95.37 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() },
};

const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const results = [];
const ok = (label, cond, extra = "") => { results.push({ cond }); console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`); };

// Pull every marker's inner SVG + geometry + the Leaflet anchor margins.
const grab = (page) => page.$$eval(".leaflet-marker-icon", (els) =>
  els.map((el) => ({
    html: el.innerHTML,
    marginLeft: el.style.marginLeft,
    marginTop: el.style.marginTop,
    svgW: (() => { const m = el.innerHTML.match(/<svg[^>]*width="([\d.]+)"/); return m ? parseFloat(m[1]) : null; })(),
  }))
);
const FILLS = { pursuit: "#D85A30", active: "#378ADD", onhold: "#BA7517", complete: "#888780", dead: "#888780" };
// The BULB is the only colored FILL (ring/stalk use stroke; halo is fill="#fff").
const byBulb = (markers, status) => markers.find((m) => m.html.toLowerCase().includes(`fill="${FILLS[status].toLowerCase()}"`));
const sweepOf = (m) => { const x = m && m.html.match(/stroke-dasharray="([\d.]+) /); return x ? parseFloat(x[1]) : null; };

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(3500); // aerial tiles + marker layer

  for (const sel of ['[title="Zoom to fit"]', '[title="Fit all"]', '[aria-label="Zoom to fit"]']) {
    try { await page.locator(sel).first().click({ timeout: 1500 }); await page.waitForTimeout(1000); break; } catch { /* keep trying */ }
  }
  await page.screenshot({ path: OUT + "overview.png" });

  const markers = await grab(page);
  console.log(`  found ${markers.length} markers (default view)`);
  const pursuit = byBulb(markers, "pursuit"), active = byBulb(markers, "active"), onhold = byBulb(markers, "onhold"), complete = byBulb(markers, "complete");

  // 1 — Dead hidden by default; the other four present.
  ok("Dead pin hidden by default (4 markers)", markers.length === 4, `${markers.length} markers`);
  ok("Pursuit / Active / On-hold / Complete all render", !!(pursuit && active && onhold && complete));

  // 2 — precision-pin structure: bulb (cy 10.5) + stalk (<line>) + ground ring (cy 34).
  const isPin = (m) => m && /<circle cx="13" cy="10.5" r="6.8"/.test(m.html) && /<line /.test(m.html) && /<circle cx="13" cy="34" r="5"/.test(m.html);
  ok("Every pin = bulb + stalk + ground ring", [pursuit, active, onhold, complete].every(isPin));

  // 3 — anchor = the ground-ring center: ring center sits at viewBox bottom (cy=34) and
  // Leaflet anchors the icon at its bottom-center (margins -17 / -46 = -[HIT_W/2, HIT_H]).
  const anchored = (m) => m && m.marginLeft === "-17px" && m.marginTop === "-46px";
  ok("Anchor is the ground-ring center (bottom-center, margin -17/-46)", [pursuit, active, onhold, complete].every(anchored), `${pursuit?.marginLeft}/${pursuit?.marginTop}`);

  // 4 — ground-ring PROGRESS sweep tracks status (Complete 100 > Active 60 > On-hold 30 > Pursuit 10).
  const sp = sweepOf(pursuit), sa = sweepOf(active), so = sweepOf(onhold), sc = sweepOf(complete);
  ok("Ground ring shows progress; sweep Complete > Active > On-hold > Pursuit", sc > sa && sa > so && so > sp && sp > 0, `${sc} > ${sa} > ${so} > ${sp}`);

  // 5 — size tiers (Pursuit largest → Complete smallest of the visible four).
  const wp = pursuit?.svgW, wa = active?.svgW, wo = onhold?.svgW, wc = complete?.svgW;
  ok("Size tiers Pursuit > Active > On-hold > Complete", wp > wa && wa > wo && wo > wc, `${wp} > ${wa} > ${wo} > ${wc}`);

  // 6 — SOLID bulb + WHITE keyline (a white-fill disc behind the bulb); never hollow.
  const solidWithKeyline = (m, st) => m && m.html.includes(`fill="${FILLS[st]}"`) && /<circle[^>]*fill="#fff"/.test(m.html);
  ok("Bulb is solid-filled with a white keyline (not hollow)", solidWithKeyline(pursuit, "pursuit") && solidWithKeyline(active, "active") && solidWithKeyline(onhold, "onhold") && solidWithKeyline(complete, "complete"));

  // 7 — correct fills
  ok("Pursuit = coral #D85A30", !!pursuit);
  ok("Active = blue #378ADD", !!active);
  ok("On-hold = amber #BA7517", !!onhold);
  ok("Complete = gray #888780", !!complete);

  // 8 — RED is gone from every marker
  const anyRed = markers.some((m) => /#E24B4A/i.test(m.html));
  ok("No red (#E24B4A) on any marker", !anyRed);

  // 9 — Dead: filter it in, then confirm a SOLID gray ✕ disc, dimmed (opacity 0.5).
  let dead = null;
  try {
    await page.locator('button[title*="show only this status"]').filter({ hasText: "Dead" }).first().click({ timeout: 3000 });
    await page.waitForTimeout(900);
  } catch { /* chip not found — leaves dead null */ }
  const deadView = await grab(page);
  dead = byBulb(deadView, "dead");
  await page.screenshot({ path: OUT + "dead-filtered.png" });
  ok("Dead pin appears when filtered to it", !!dead, `${deadView.length} markers in dead view`);
  ok("Dead bulb is SOLID gray (not hollow)", !!dead && dead.html.includes('fill="#888780"') && isPin(dead));
  ok("Dead carries the ✕ glyph", !!dead && /M[\d.]+,[\d.]+ L[\d.]+,[\d.]+ M/.test(dead.html));
  ok("Dead is dimmed (opacity 0.5)", !!dead && /opacity:\s*0\.5/.test(dead.html));
  ok("Dead is the smallest tier (Dead < Complete)", !!(dead && wc) && dead.svgW < wc, `${dead?.svgW} < ${wc}`);

  ok("No page errors", pageErrors.length === 0, pageErrors.join(" | "));

  await ctx.close();
  await browser.close();

  const failed = results.filter((r) => !r.cond);
  console.log(`\n${failed.length ? "✗" : "✓"} ${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
