/**
 * B433 + B434 — verify the precision-pin map markers + the corrected status palette.
 *
 * Seeds one site per status (status at TOP LEVEL, the logged-out path). Confirms:
 *   B434 (the precision pin):
 *     1. All FIVE statuses render by default — Dead included (NEW-1, 2026-08-27: a Dead
 *        pin used to be hidden unless the user filtered to it, which is exactly what made
 *        a site marked dead read as "disappeared entirely"; it still recedes via size/
 *        opacity/z-order, it just never vanishes).
 *     2. Each pin is a BULB + STALK + GROUND RING (the survey-monument read).
 *     3. The ground-ring center sits at the viewBox bottom (cy=34) and the icon anchor
 *        is the hit-box bottom-center (margin = -[17,46]) → the ring center IS the spot.
 *     4. The ground ring shows PROGRESS: sweep length tracks status
 *        (Complete 100% > Active 60% > On-hold 30% > Pursuit 10%; Dead's is 0%).
 *     5. Size tiers track importance: Pursuit > Active > On-hold > Complete > Dead.
 *     6. SOLID bulb fill + a WHITE keyline (white disc behind it) — never hollow.
 *   B433 (the palette):
 *     7. Correct fills (coral Pursuit, blue Active, amber On-hold, gray Complete).
 *     8. RED (#E24B4A) appears on NO marker.
 *     9. Dead is a SOLID gray disc with a ✕ glyph + dimmed (opacity 0.5), visible with no
 *        filter applied; the status chip filter can still isolate it on its own.
 *
 * Run:  npm run build && npx vite preview --port 4173 &   then   node ui-audit/verify-precision-pin.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

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
// Complete and Dead deliberately SHARE a fill (B433 — distinguished by glyph + strike, not
// hue), so with both rendering by default (NEW-1) fill color alone can no longer tell them
// apart — disambiguate by each glyph's own markup (Complete = check <polyline>, Dead = ✕ <path>).
const GLYPH_RE = { complete: /<polyline points=/, dead: /<path d="M[\d.-]+,[\d.-]+ L[\d.-]+,[\d.-]+ M/ };
// The BULB is the only colored FILL (ring/stalk use stroke; halo is fill="#fff").
const byBulb = (markers, status) => markers.find((m) => {
  if (!m.html.toLowerCase().includes(`fill="${FILLS[status].toLowerCase()}"`)) return false;
  const g = GLYPH_RE[status];
  return g ? g.test(m.html) : true;
});
const sweepOf = (m) => { const x = m && m.html.match(/stroke-dasharray="([\d.]+) /); return x ? parseFloat(x[1]) : null; };

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
     setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
     suspends requestAnimationFrame, so after a view change the app's state attributes update while the
     drawing never repaints — every box, position, hit test and screenshot then agrees with every other
     and describes a view the app already left. One precondition covers both, rAF liveness probe
     included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
  await assertMeasurable(page, "verify-precision-pin");
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
  const pursuit = byBulb(markers, "pursuit"), active = byBulb(markers, "active"), onhold = byBulb(markers, "onhold"), complete = byBulb(markers, "complete"), dead = byBulb(markers, "dead");

  // 1 — all five statuses present by default, Dead included (NEW-1).
  ok("All five statuses render by default (5 markers)", markers.length === 5, `${markers.length} markers`);
  ok("Pursuit / Active / On-hold / Complete / Dead all render", !!(pursuit && active && onhold && complete && dead));

  // 2 — precision-pin structure: bulb (cy 10.5) + stalk (<line>) + ground ring (cy 34).
  const isPin = (m) => m && /<circle cx="13" cy="10.5" r="6.8"/.test(m.html) && /<line /.test(m.html) && /<circle cx="13" cy="34" r="5"/.test(m.html);
  ok("Every pin = bulb + stalk + ground ring", [pursuit, active, onhold, complete, dead].every(isPin));

  // 3 — anchor = the ground-ring center: ring center sits at viewBox bottom (cy=34) and
  // Leaflet anchors the icon at its bottom-center (margins -17 / -46 = -[HIT_W/2, HIT_H]).
  const anchored = (m) => m && m.marginLeft === "-17px" && m.marginTop === "-46px";
  ok("Anchor is the ground-ring center (bottom-center, margin -17/-46)", [pursuit, active, onhold, complete, dead].every(anchored), `${pursuit?.marginLeft}/${pursuit?.marginTop}`);

  // 4 — ground-ring PROGRESS sweep tracks status (Complete 100 > Active 60 > On-hold 30 > Pursuit 10);
  // Dead is 0% and renders NO sweep arc at all (just the faint full track), so sweepOf(dead) is null.
  const sp = sweepOf(pursuit), sa = sweepOf(active), so = sweepOf(onhold), sc = sweepOf(complete), sd = sweepOf(dead);
  ok("Ground ring shows progress; sweep Complete > Active > On-hold > Pursuit, Dead has none", sc > sa && sa > so && so > sp && sp > 0 && sd == null, `${sc} > ${sa} > ${so} > ${sp}, dead=${sd}`);

  // 5 — size tiers (Pursuit largest → Dead smallest, all five visible).
  const wp = pursuit?.svgW, wa = active?.svgW, wo = onhold?.svgW, wc = complete?.svgW, wd = dead?.svgW;
  ok("Size tiers Pursuit > Active > On-hold > Complete > Dead", wp > wa && wa > wo && wo > wc && wc > wd, `${wp} > ${wa} > ${wo} > ${wc} > ${wd}`);

  // 6 — SOLID bulb + WHITE keyline (a white-fill disc behind the bulb); never hollow.
  const solidWithKeyline = (m, st) => m && m.html.includes(`fill="${FILLS[st]}"`) && /<circle[^>]*fill="#fff"/.test(m.html);
  ok("Bulb is solid-filled with a white keyline (not hollow)", solidWithKeyline(pursuit, "pursuit") && solidWithKeyline(active, "active") && solidWithKeyline(onhold, "onhold") && solidWithKeyline(complete, "complete") && solidWithKeyline(dead, "dead"));

  // 7 — correct fills
  ok("Pursuit = coral #D85A30", !!pursuit);
  ok("Active = blue #378ADD", !!active);
  ok("On-hold = amber #BA7517", !!onhold);
  ok("Complete = gray #888780", !!complete);

  // 8 — RED is gone from every marker
  const anyRed = markers.some((m) => /#E24B4A/i.test(m.html));
  ok("No red (#E24B4A) on any marker", !anyRed);

  // 9 — Dead, in the DEFAULT view (no filter applied): a SOLID gray ✕ disc, dimmed (opacity 0.5).
  await page.screenshot({ path: OUT + "default-view.png" });
  ok("Dead pin appears with no filter applied (NEW-1)", !!dead, `${markers.length} markers in default view`);
  ok("Dead bulb is SOLID gray (not hollow)", !!dead && dead.html.includes('fill="#888780"') && isPin(dead));
  ok("Dead carries the ✕ glyph", !!dead && /M[\d.]+,[\d.]+ L[\d.]+,[\d.]+ M/.test(dead.html));
  ok("Dead is dimmed (opacity 0.5)", !!dead && /opacity:\s*0\.5/.test(dead.html));
  ok("Dead is the smallest tier (Dead < Complete)", !!(dead && wc) && dead.svgW < wc, `${dead?.svgW} < ${wc}`);

  // 10 — the status chip filter still isolates Dead on its own (the filter mechanism itself
  // is untouched by NEW-1 — only the "hidden unless filtered to" default went away).
  let deadFiltered = null;
  try {
    await page.locator('button[title*="show only this status"]').filter({ hasText: "Dead" }).first().click({ timeout: 3000 });
    await page.waitForTimeout(900);
  } catch { /* chip not found — leaves deadFiltered null */ }
  const deadOnlyView = await grab(page);
  deadFiltered = byBulb(deadOnlyView, "dead");
  await page.screenshot({ path: OUT + "dead-filtered.png" });
  ok("Filtering to Dead shows exactly the Dead pin", deadOnlyView.length === 1 && !!deadFiltered, `${deadOnlyView.length} markers in dead-only view`);

  ok("No page errors", pageErrors.length === 0, pageErrors.join(" | "));

  await ctx.close();
  await browser.close();

  const failed = results.filter((r) => !r.cond);
  console.log(`\n${failed.length ? "✗" : "✓"} ${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
