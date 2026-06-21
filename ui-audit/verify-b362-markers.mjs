/**
 * B362 — verify the redesigned project-status map markers.
 *
 * Seeds one site per status (status at TOP LEVEL, the logged-out path). Confirms:
 *   1. Pursuit/Active/On-hold/Complete render; Dead is HIDDEN by default.
 *   2. Correct fill per status (coral Pursuit, blue Active, amber On-hold, gray Complete).
 *   3. Size tiers track importance: Pursuit > Active > On-hold > Complete.
 *   4. Every marker carries a WHITE halo + its glyph (flag / pulse / pause / check).
 *   5. Z-order by importance: the Pursuit pin sits ABOVE the Complete pin.
 *   6. The hit box is fixed (≥ the old tap target) for every status.
 * Also screenshots the overview + the left rail (to eyeball the chips/list glyphs).
 *
 * Run:  npm run build && npx vite preview --port 4173 &   then   node ui-audit/verify-b362-markers.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/b362/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Pursuit + Complete share a lat so the z-order test isolates the zIndexOffset.
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
const ok = (label, cond, extra = "") => { results.push({ label, cond, extra }); console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`); };

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(3500); // aerial tiles

  // Try to frame all markers (selector tolerant — wrapped so a miss doesn't abort).
  for (const sel of ['[title="Zoom to fit"]', '[title="Fit all"]', '[aria-label="Zoom to fit"]']) {
    try { await page.locator(sel).first().click({ timeout: 1500 }); await page.waitForTimeout(1000); break; } catch { /* keep trying */ }
  }

  await page.screenshot({ path: OUT + "overview.png" });
  console.log("  saved overview.png");

  // Pull each marker's geometry + inner SVG.
  const markers = await page.$$eval(".leaflet-marker-icon", (els) =>
    els.map((el) => ({
      html: el.innerHTML,
      zIndex: parseInt(el.style.zIndex || "0", 10),
      boxW: el.getBoundingClientRect().width,
      boxH: el.getBoundingClientRect().height,
    }))
  );
  console.log(`  found ${markers.length} markers`);

  const FILLS = { pursuit: "#D85A30", active: "#378ADD", onhold: "#BA7517", complete: "#888780", dead: "#E24B4A" };
  const find = (status) => markers.find((m) => m.html.toLowerCase().includes(FILLS[status].toLowerCase()));
  const svgW = (m) => { const x = m && m.html.match(/<svg[^>]*width="([\d.]+)"/); return x ? parseFloat(x[1]) : null; };

  const pursuit = find("pursuit"), active = find("active"), onhold = find("onhold"), complete = find("complete");

  // 1 — Dead hidden by default; the other four present.
  ok("Dead pin hidden by default", !find("dead") && markers.length === 4, `${markers.length} markers`);
  ok("Pursuit / Active / On-hold / Complete all render", !!(pursuit && active && onhold && complete));

  // 2 — correct fills
  ok("Pursuit fill = coral #D85A30", !!pursuit);
  ok("Active fill = blue #378ADD", !!active);
  ok("On-hold fill = amber #BA7517", !!onhold);
  ok("Complete fill = gray #888780", !!complete);

  // 3 — size tiers (Pursuit largest → Complete smallest)
  const wp = svgW(pursuit), wa = svgW(active), wo = svgW(onhold), wc = svgW(complete);
  ok("Size tiers Pursuit > Active > On-hold > Complete", wp > wa && wa > wo && wo > wc, `${wp} > ${wa} > ${wo} > ${wc}`);

  // 4 — white halo + glyphs (structural, robust to coordinate nudges)
  const hasHalo = (m) => m && /fill="#fff" stroke="#fff"/.test(m.html);
  ok("Every pin has a white halo underlay", [pursuit, active, onhold, complete].every(hasHalo));
  ok("Pursuit shows a flag glyph", !!pursuit && pursuit.html.includes('stroke-width="1.5"'));
  ok("Active shows a pulse glyph", !!active && active.html.includes("<polyline") && active.html.includes('stroke-width="1.6"'));
  ok("On-hold shows a pause glyph (two bars)", !!onhold && (onhold.html.match(/<rect/g) || []).length >= 2);
  ok("Complete shows a check glyph", !!complete && complete.html.includes("<polyline") && complete.html.includes('stroke-width="2"'));

  // 4b — glyph CENTERING: measure each glyph's bounding box (getBBox, in viewBox units)
  // and confirm its center sits on the marker head center (~14,16). The flag is the
  // asymmetric one most at risk of looking off-center.
  const centering = await page.evaluate((FILLS) => {
    const out = {};
    for (const svg of document.querySelectorAll(".leaflet-marker-icon svg")) {
      const html = svg.innerHTML.toLowerCase();
      const status = Object.keys(FILLS).find((k) => html.includes(FILLS[k].toLowerCase()));
      if (!status) continue;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, found = false;
      for (const el of svg.querySelectorAll("path,polyline,rect")) {
        let bb; try { bb = el.getBBox(); } catch { continue; }
        if (bb.width >= 15) continue;            // skip the two body paths (~18 wide; glyphs ≤13)
        if (bb.width === 0 && bb.height === 0) continue;
        found = true;
        minX = Math.min(minX, bb.x); maxX = Math.max(maxX, bb.x + bb.width);
        minY = Math.min(minY, bb.y); maxY = Math.max(maxY, bb.y + bb.height);
      }
      if (found) out[status] = { cx: +((minX + maxX) / 2).toFixed(2), cy: +((minY + maxY) / 2).toFixed(2) };
    }
    return out;
  }, FILLS);
  for (const st of ["pursuit", "active", "onhold", "complete"]) {
    const c = centering[st];
    const centered = c && Math.abs(c.cx - 14) <= 1.2 && Math.abs(c.cy - 16) <= 2;
    ok(`${st} glyph centered on the head (~14,16)`, !!centered, c ? `center ${c.cx},${c.cy}` : "no glyph bbox");
  }

  // 5 — z-order by importance (same lat → pure zIndexOffset)
  ok("Pursuit renders above Complete (z-order)", !!(pursuit && complete) && pursuit.zIndex > complete.zIndex, `${pursuit?.zIndex} > ${complete?.zIndex}`);

  // 6 — fixed, generous hit box (old largest was ~32×41)
  const boxesFixed = [pursuit, active, onhold, complete].every((m) => m && m.boxW >= 32 && m.boxH >= 41);
  ok("Hit box fixed & ≥ old tap target for every status", boxesFixed, `${pursuit?.boxW}×${pursuit?.boxH}`);

  // Crop each marker for the eyeball record.
  const icons = await page.locator(".leaflet-marker-icon").all();
  for (let i = 0; i < icons.length; i++) {
    try {
      const b = await icons[i].boundingBox();
      if (b) await page.screenshot({ path: OUT + `marker-${i}.png`, clip: { x: Math.max(0, b.x - 24), y: Math.max(0, b.y - 24), width: b.width + 48, height: b.height + 48 } });
    } catch { /* skip */ }
  }

  // Left rail (chips + list) so the DOM glyphs/colors can be eyeballed.
  try { await page.screenshot({ path: OUT + "left-rail.png", clip: { x: 0, y: 0, width: 360, height: 760 } }); } catch { /* skip */ }

  ok("No page errors", pageErrors.length === 0, pageErrors.join(" | "));

  await ctx.close();
  await browser.close();

  const failed = results.filter((r) => !r.cond);
  console.log(`\n${failed.length ? "✗" : "✓"} ${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
