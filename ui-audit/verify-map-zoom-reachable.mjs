#!/usr/bin/env node
/* B2020064 — the Map view's + / − (and locate) buttons must answer a press, never a Sites row.
 *
 * Real HIT TEST (`elementFromPoint` at each button's centre), with a LONG site list so the rail
 * grows to its height cap — the reported state (a short list never reaches the bottom corner, which
 * is how verify-map-chrome stayed green). Arms: desktop + phone × rail open + collapsed.
 * Known-good arm: the rail must actually be tall (open arms) or the run is VOID.
 *   node ui-audit/verify-map-zoom-reachable.mjs [--url http://localhost:4319/]
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const URL = arg("--url", "http://localhost:4319/");
const sq = (ft) => [{ x: 0, y: 0 }, { x: ft, y: 0 }, { x: ft, y: ft }, { x: 0, y: ft }];
const NOW = 1754000000000;
const SEED = Object.fromEntries(Array.from({ length: 40 }, (_, i) => {
  const id = `mz${i + 1}`;
  return [id, { id, groupId: id, site: `Harris ${i + 1}`, name: `Harris ${i + 1}`,
    origin: { lat: 29.8 + ((i % 5) - 2) * 0.09, lon: -95.4 + ((i % 4) - 1.5) * 0.12 }, county: "harris",
    parcels: [{ id: `${id}p`, points: sq(600) }], els: [], measures: [], callouts: [], markups: [],
    settings: {}, underlay: null, status: ["active", "pursuit", "onhold"][i % 3], updatedAt: NOW - i * 1000 }];
}));

let fails = 0, vacuous = false, cappedArms = 0;
const check = (n, ok, d = "") => { if (!ok) fails++; console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`); };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
try {
  for (const [vp, w, h] of [["desktop", 1600, 900], ["desktop-short", 1600, 600], ["phone", 390, 844]]) {
    for (const open of [true, false]) {
      const label = `${vp} ${w}×${h} · Sites ${open ? "OPEN" : "COLLAPSED"}`;
      console.log(`\n${label}`);
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
      await ctx.addInitScript(`(()=>{try{localStorage.clear();
        localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify(SEED))});
        localStorage.setItem('planarfit:sitesPanelClosed:v1', '${open ? 0 : 1}');
        localStorage.setItem('planarfit:layersPanelClosed:v1', '1');}catch(e){}})();`);
      const page = await ctx.newPage();
      await page.goto(URL.replace(/\/?$/, "/") + "#/site", { waitUntil: "domcontentloaded" });
      await assertMeasurable(page, "verify-map-zoom-reachable");
      await page.waitForSelector(".leaflet-control-zoom-in", { timeout: 20000 });
      await page.waitForSelector('[data-testid="map-sites-panel"]', { timeout: 20000 });
      await pacedWait(page, 1200);
      // A phone starts with the rail CLOSED regardless of the stored key — open it by its own control.
      if (open && w < 500) { await page.locator('button[title="Expand the sites panel"]').click(); await pacedWait(page, 500); }
      const r = await page.evaluate(() => {
        const hit = (sel) => {
          const el = document.querySelector(sel); if (!el) return { found: false };
          const b = el.getBoundingClientRect(); const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
          const top = document.elementFromPoint(cx, cy);
          return { found: true, ok: !!(top && (el === top || el.contains(top) || top.contains(el))), by: top ? top.tagName + "." + String(top.className).slice(0, 30) : null };
        };
        const p = document.querySelector('[data-testid="map-sites-panel"]').getBoundingClientRect();
        return { panelH: Math.round(p.height), panelBottom: Math.round(p.bottom),
          zoomTop: Math.round(document.querySelector(".leaflet-control-zoom-in").getBoundingClientRect().top),
          zin: hit(".leaflet-control-zoom-in"), zout: hit(".leaflet-control-zoom-out"), loc: hit('[data-testid="locate-me-btn"]') };
      });
      if (open) { const tall = r.panelH >= 300; if (h <= 600 || w < 500) { cappedArms++; if (!tall) vacuous = true; } check("known-good · open rail is tall (long list reached its cap)", tall || (h > 600 && w >= 500), `h=${r.panelH}`); }
      for (const [k, v] of [["zoom +", r.zin], ["zoom −", r.zout], ["locate", r.loc]])
        check(`${k} answers its own press`, v.found && v.ok, v.ok ? "" : `covered by ${v.by}`);
      check("rail ends above the zoom stack", r.panelBottom <= r.zoomTop, `panel bottom ${r.panelBottom} vs zoom top ${r.zoomTop}`);
      await ctx.close();
    }
  }
} finally { await browser.close(); }
if (vacuous) { console.log("\nVOID — rail never grew tall; the reported state was not reproduced"); process.exit(2); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS"); process.exit(fails ? 1 : 0);
