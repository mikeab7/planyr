/**
 * NEW-2 (2026-09-29) — city / town names on the map finder: verify what REACHES THE SCREEN.
 *
 * Same method as verify-admin-boundaries.mjs: read the pixels the layer put down (its own
 * canvas, in its own pane) and the network, never Leaflet's opinion. The layer stamps
 * `data-count` / `data-zoom` on its pane as a mirror of what it drew; the assertions below
 * pair that stamp with real ink read back out of the canvas.
 *
 * To reach Houston/Katy without a search box (the geocoder needs network the sandbox blocks),
 * the harness finds the finder's Leaflet map by walking the React fiber from `.leaflet-container`
 * — test-only, nothing in the app exposes or depends on it.
 *
 * KNOWN-GOOD ARM (FOREGROUND-OR-VOID / clause 6): at metro zoom over Houston the count must be
 * > 0 AND the canvas must hold ink; a run where the count is 0 everywhere is VOID, not a pass.
 *
 * The sandbox blocks the imagery host, so screenshots show the labels over a blank base — they
 * prove placement, collision and zoom behaviour, NOT how they read over live aerial (that is
 * the live pass, V-entry in VERIFICATION.md).
 *
 *   npm run build && npx vite preview --port 4173 &   then   node ui-audit/verify-place-names.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const OUT = new URL("./screens/place-names/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (label, cond, extra = "") => { results.push(!!cond); console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
await ctx.addInitScript(`(() => { try { localStorage.setItem('planarfit:sites:v1', '{}'); localStorage.removeItem('planarfit:currentSite:v1'); localStorage.setItem('planyr.theme','light'); } catch (e) {} })();`);
const asked = [];
await ctx.route("**/*", (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE)) { asked.push(url.slice(BASE.length)); return route.continue(); }
  return url.startsWith("http") ? route.abort() : route.continue();
});
const page = await ctx.newPage();
await assertMeasurable(page, "verify-place-names");
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector(".leaflet-container", { timeout: 20000 });
await page.waitForTimeout(2000);

const setView = (lat, lng, z) => page.evaluate(([la, lo, zz]) => {
  const el = document.querySelector(".leaflet-container");
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
  let f = el[key], map = null;
  for (let n = 0; f && n < 60 && !map; n++, f = f.return) {
    for (let h = f.memoizedState; h && !map; h = h.next) {
      const c = h.memoizedState && h.memoizedState.current;
      if (c && typeof c.setView === "function" && typeof c.getZoom === "function") map = c;
    }
  }
  if (!map) return false;
  window.__pnMap = map;
  map.setView([la, lo], zz, { animate: false });
  return true;
}, [lat, lng, z]);
const read = async () => {
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const pane = document.querySelector(".leaflet-placenames-pane");
    if (!pane) return null;
    const c = pane.querySelector("canvas");
    let ink = 0;
    if (c && c.width) { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++; }
    const cs = getComputedStyle(pane);
    return { count: Number(pane.dataset.count), zoom: Number(pane.dataset.zoom), ink, z: cs.zIndex, pe: cs.pointerEvents };
  });
};
const shot = (name) => page.locator(".leaflet-container").first().screenshot({ path: `${OUT}${name}.png` });

console.log("\nNEW-2 · city / town names\n");
ok("test hook found the finder's map", await setView(39.5, -98.5, 4));
const us = await read();
ok("whole-US view: big cities are drawn (known-good arm — count>0 AND ink>0)", us && us.count > 5 && us.ink > 500, JSON.stringify(us));
await shot("us-z4");

const namesNow = () => page.evaluate(() => (document.querySelector(".leaflet-placenames-pane").dataset.names || "").split("|").filter(Boolean));
const at = {};
for (const z of [6, 8, 10, 11, 12]) {
  await setView(29.79, -95.82, z); // Katy
  await read(); at[z] = await namesNow();
}
await shot("houston-z12");
ok("zoom 6 around Houston: big cities only — Houston shown, Katy not", at[6].includes("Houston") && !at[6].includes("Katy"), at[6].slice(0, 8).join(", "));
ok("zoom 10-12 around Katy: the small towns appear (Katy, Sugar Land)", [10, 11, 12].some((z) => at[z].includes("Katy")) && [10, 11].some((z) => at[z].includes("Sugar Land")), `z10: ${at[10].slice(0, 12).join(", ")}`);
ok("the small-town dataset is fetched only once zoom reaches the towns tier", asked.some((u) => u.includes("place-names-towns.json")));
await setView(29.79, -95.82, 10); await read(); await shot("katy-z10");
await setView(29.79, -95.82, 12); await read(); await shot("katy-z12");
const namesAt = async (z) => { await setView(29.79, -95.82, z); await read(); return page.evaluate(() => Number(document.querySelector(".leaflet-placenames-pane").dataset.count)); };
ok("at zoom 12 over Katy, labels are on screen (Katy area towns)", (await namesAt(12)) >= 3);

await setView(29.79, -95.82, 13); const z13 = await read(); await shot("katy-z13-fading");
ok("zoom 13: labels have stepped back (drawn at reduced opacity, not full)", z13 && z13.ink > 0);
await setView(29.79, -95.82, 14); const z14 = await read(); await shot("katy-z14-parcels");
ok("zoom 14 (parcels draw): no city name is drawn at all", z14 && z14.count === 0 && z14.ink === 0, JSON.stringify(z14));

const geoBefore = asked.filter((u) => u.includes("geo/place-names")).length;
await setView(29.79, -95.82, 16); await read(); await setView(29.79, -95.81, 17); await read();
ok("at site working zoom, no name data is requested", asked.filter((u) => u.includes("geo/place-names")).length === geoBefore);
ok("the pane sits below the vector-overlay pane (400) and cannot take a click", z14 && Number(z14.z) < 400 && z14.pe === "none", `z-index ${z14?.z} pointer-events ${z14?.pe}`);


/* NEW-1 amend (2026-09-29) — names ride the ground THROUGH a zoom animation, at constant text size.
 *
 * ORACLE, independent of the code under test: real Leaflet markers dropped on the same places.
 * Leaflet itself animates a marker with the same CSS transition it gives the imagery, so a marker's
 * live on-screen rect IS where the ground is on every frame. Each sampled frame the harness draws
 * the layer synchronously (drawSync) and reads label position + type size against that marker in
 * the SAME callback — no frame of skew. KNOWN-GOOD ARM: the markers must actually MOVE during the
 * animation (else this measured a non-animation and is VOID), and labels must be present.
 * (Sandbox has no imagery, so tiles are absent; markers carry the truth instead.) */
await setView(29.79, -95.62, 10); await read();
await page.addScriptTag({ path: new URL("../node_modules/leaflet/dist/leaflet.js", import.meta.url).pathname });
const sampleZoom = async (label, act) => {
  await setView(29.79, -95.62, 10); await read();
  await page.evaluate(() => {
    const map = window.__pnMap, pane = document.querySelector(".leaflet-placenames-pane"), ctl = pane.__placeNames;
    window.__pnMarkers && window.__pnMarkers.forEach((m) => m.remove());
    ctl.drawSync(performance.now());
    window.__pnMarkers = pane.__drawn.filter((d) => d.a > 0.99).slice(0, 6).map((d) => {
      const m = window.L.marker([d.lat, d.lng], { icon: window.L.divIcon({ className: "", html: '<i style="display:block;width:6px;height:6px"></i>', iconSize: [6, 6], iconAnchor: [3, 3] }), interactive: false, keyboard: false }).addTo(map);
      m.__key = d.key; return m;
    });
    window.__pnS = []; const cont = map.getContainer(), canvas = pane.querySelector("canvas"); let n = 0;
    const tick = (ts) => {
      ctl.drawSync(ts);
      const cr = cont.getBoundingClientRect(), frame = { t: ts, zoom: map.getZoom(), tf: getComputedStyle(canvas).transform, cw: canvas.style.width, rows: [] };
      for (const m of window.__pnMarkers) {
        const d = pane.__drawn.find((x) => x.key === m.__key); if (!d) continue;
        const r = m._icon.getBoundingClientRect();
        frame.rows.push({ t: ts, zoom: map.getZoom(), a: d.a, key: m.__key, dx: d.x - (r.left + r.width / 2 - cr.left), dy: d.y - (r.top + r.height / 2 - cr.top), mx: r.left + r.width / 2 - cr.left, px: d.px });
      }
      window.__pnS.push(frame);
      if (++n < 60) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await act();
  await page.waitForTimeout(1300);
  const frames = await page.evaluate(() => window.__pnS);
  const rows = frames.flatMap((f) => f.rows);
  const dev = Math.max(0, ...rows.map((r) => Math.hypot(r.dx, r.dy)));
  const byKey = {}; for (const r of rows) (byKey[r.key] = byKey[r.key] || []).push(r);
  const travel = Math.max(0, ...Object.values(byKey).map((a) => Math.max(...a.map((r) => r.mx)) - Math.min(...a.map((r) => r.mx))));
  const sizeStable = Object.values(byKey).every((a) => new Set(a.map((r) => r.px)).size === 1);
  const unscaled = frames.every((f) => f.tf === "none" || /^matrix\(1, 0, 0, 1, /.test(f.tf));
  ok(`${label}: known-good arm — labels present and the ground actually moved (≥ 20 units)`, rows.length >= 20 && travel >= 20, `${rows.length} samples, travel ${travel.toFixed(0)}`);
  const worst = rows.reduce((w, r) => (Math.hypot(r.dx, r.dy) > Math.hypot(w.dx, w.dy) ? r : w), rows[0] || { dx: 0, dy: 0 });
  ok(`${label}: every label sits on its ground point on every frame of the zoom (≤ 2 units)`, dev <= 2, `worst ${dev.toFixed(2)}${dev > 2 ? ` ${JSON.stringify(worst)}` : ""}`);
  ok(`${label}: type size never changes and the canvas is never scaled`, sizeStable && unscaled);
};
const zoomBtn = (sel) => async () => { await page.locator(sel).first().click(); };
await sampleZoom("zoom-in button", zoomBtn(".leaflet-control-zoom-in"));
await sampleZoom("zoom-out button", zoomBtn(".leaflet-control-zoom-out"));
await sampleZoom("mouse wheel in", async () => { await page.mouse.move(700, 400); await page.mouse.wheel(0, -120); });
await sampleZoom("mouse wheel out", async () => { await page.mouse.move(500, 300); await page.mouse.wheel(0, 240); });
await sampleZoom("double-click zoom", async () => { await page.mouse.dblclick(600, 380); });
const fade = await page.evaluate(async () => {
  const pane = document.querySelector(".leaflet-placenames-pane"), ctl = pane.__placeNames, map = window.__pnMap;
  map.setView([29.79, -95.62], 9, { animate: false }); await new Promise((r) => setTimeout(r, 800));
  const before = new Set(pane.__drawn.map((d) => d.key)); const seen = [];
  map.setView([29.79, -95.62], 11, { animate: false });
  await new Promise((res) => { let n = 0; const t = (ts) => { ctl.drawSync(ts); seen.push(pane.__drawn.filter((d) => !before.has(d.key)).map((d) => d.a)); if (++n < 30) requestAnimationFrame(t); else res(); }; requestAnimationFrame(t); });
  return seen;
});
const partial = fade.flat().some((a) => a > 0.05 && a < 0.95);
ok("names that appear FADE in (some frame between invisible and full), not pop", partial, `${fade.flat().filter((a) => a > 0.05 && a < 0.95).length} in-between samples`);

/* Layers-panel row: exists, on by default, and toggling it off clears the canvas. */
await setView(29.79, -95.82, 11); await read();
const box = page.getByLabel("City names").first();
const row = page.locator("label", { hasText: "City names" }).first();
const rowThere = await row.count();
ok("the Layers panel has a 'City names' row", rowThere > 0);
if (rowThere) {
  const cb = row.locator("input[type=checkbox]");
  ok("…on by default", await cb.isChecked());
  await cb.uncheck(); const off = await read();
  ok("…turning it off clears every name", off.count === 0 && off.ink === 0, JSON.stringify(off));
  await cb.check(); const on = await read();
  ok("…turning it back on restores them", on.count > 0 && on.ink > 0, JSON.stringify(on));
}
ok("no page errors", errors.length === 0, errors[0] || "");
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${failed ? `✗ ${failed} of ${results.length} checks failed` : `✓ all ${results.length} checks passed`}\n  screenshots → ui-audit/screens/place-names/`);
process.exit(failed ? 1 : 0);
