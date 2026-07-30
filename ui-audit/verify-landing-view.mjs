/* NEW-1 — the Map view's LANDING position is derived from the user's own sites, proven live.
 *
 * The defect: `MapFinder` created its Leaflet map on `COUNTIES_MAP.harris`, so every account on
 * earth opened over Houston, Texas. This harness drives three seeded accounts through a real
 * browser and reads where the map actually ENDS UP — not what a helper returned:
 *
 *   A  no sites at all      → the continental US (the honest empty state)
 *   B  exactly one site     → that site's AREA at metro scale, never its parcel
 *   C  the OWNER'S real distribution — 26 sites around Houston (Harris, Fort Bend, Waller,
 *      Chambers) and exactly ONE in Weld County, Colorado → HOUSTON, with the Colorado pin
 *      OFF-SCREEN and the zoom at or below the metro clamp
 *   D  and once the user pans, the derived view does not yank them back — it is where the map
 *      OPENS, not a leash
 *
 * HOW IT READS THE VIEW WITHOUT THE NETWORK. The map's own position is taken from the app's
 * live cursor readout (the bottom-center lat/long chip): parking the pointer at the container's
 * center gives the center coordinate, and a second sample a fixed distance to the right gives
 * degrees-per-pixel, hence the zoom. Nothing here depends on a tile loading, so it runs with the
 * imagery hosts egress-blocked. Off-screen-ness is asserted against the real site PINS in the
 * DOM, not recomputed from the numbers.
 *
 * Logged out, no external GIS, sites seeded from localStorage — Claude-verifiable here.
 *
 * Run:  npm run build && npx vite preview --port 4183   (separate shell)
 *       BASE_URL=http://localhost:4183/ node ui-audit/verify-landing-view.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4183/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const now = Date.now();

const LANDING_MAX_ZOOM = 11;          // the metro-scale clamp under test
const VIEWPORT = { width: 1440, height: 900 };

const sq = (ft) => [{ x: 0, y: 0 }, { x: ft, y: 0 }, { x: ft, y: ft }, { x: 0, y: ft }];
let n = 0;
const site = (lat, lon, name, at) => {
  const id = `lv${++n}`;
  return [id, {
    id, groupId: id, site: name, name, origin: { lat, lon }, county: "harris",
    parcels: [{ id: `${id}p`, points: sq(600) }], els: [], measures: [], callouts: [], markups: [],
    settings: {}, underlay: null, status: "active", updatedAt: at,
  }];
};
/* Deterministic spread inside a county — real distances, not one repeated point. */
const spread = (count, lat0, lon0, dLat, dLon, label, at0) =>
  Array.from({ length: count }, (_, i) =>
    site(lat0 + ((i % 5) - 2) * dLat, lon0 + ((i % 4) - 1.5) * dLon, `${label} ${i + 1}`, at0 + i * 1000));

const HOUSTON_26 = [
  ...spread(14, 29.80, -95.40, 0.09, 0.12, "Harris", now - 900_000),
  ...spread(6, 29.55, -95.75, 0.06, 0.09, "Fort Bend", now - 800_000),
  ...spread(3, 30.00, -95.86, 0.05, 0.06, "Waller", now - 700_000),
  ...spread(3, 29.72, -94.70, 0.05, 0.07, "Chambers", now - 600_000),
];
const WELD = site(40.42, -104.71, "Weld County", now);   // the single, most-recent outlier

const ACCOUNTS = {
  A_none: {},
  B_one: Object.fromEntries([site(39.74, -104.99, "Denver", now)]),
  C_owner: Object.fromEntries([...HOUSTON_26, WELD]),
};

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const results = [];
const ok = (t, pass, d = "") => { results.push({ t, pass }); console.log(`  ${pass ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

/* Park the pointer at a container-relative point and read the app's own coordinate chip. */
async function sampleAt(page, dx, dy) {
  const box = await page.evaluate(() => {
    const el = document.querySelector(".leaflet-container");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  if (!box) return null;
  await page.mouse.move(box.x + box.w / 2 + dx, box.y + box.h / 2 + dy);
  await page.waitForTimeout(220);
  const txt = await page.evaluate(() => {
    const chip = [...document.querySelectorAll("div")].find((d) => /^-?\d+\.\d{6}°,/.test((d.textContent || "").trim()));
    return chip ? chip.textContent.trim() : "";
  });
  const m = txt.match(/(-?\d+\.\d+)°,\s*(-?\d+\.\d+)°/);
  return m ? { lat: +m[1], lng: +m[2], box } : null;
}

/* center + zoom, both derived from what the app itself reports under the cursor. */
async function readView(page) {
  const c = await sampleAt(page, 0, 0);
  const r = await sampleAt(page, 300, 0);
  if (!c || !r) return null;
  const degPerPx = Math.abs(r.lng - c.lng) / 300;
  const zoom = Math.log2(360 / (degPerPx * 256));
  return { center: [c.lat, c.lng], zoom, box: c.box };
}

/* Every saved-site pin, and whether it is inside the map viewport. */
const pinStats = (page) => page.evaluate(() => {
  const el = document.querySelector(".leaflet-container");
  const r = el.getBoundingClientRect();
  const pins = [...document.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon")].map((m) => {
    const b = m.getBoundingClientRect();
    return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
  });
  const inside = pins.filter((p) => p.cx >= r.left && p.cx <= r.right && p.cy >= r.top && p.cy <= r.bottom);
  return { total: pins.length, inside: inside.length, outside: pins.length - inside.length };
});

async function open(account) {
  const seed = `(()=>{try{localStorage.clear();localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify(ACCOUNTS[account])}));}catch(e){}})();`;
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector(".leaflet-container", { timeout: 20000 });
  await page.waitForTimeout(2200);      // let the site list load and the landing effect settle
  return { ctx, page, errs };
}

// ── A — NO SITES YET: the whole continental US ────────────────────────────────────────────────
{
  const { ctx, page, errs } = await open("A_none");
  const v = await readView(page);
  await page.screenshot({ path: OUT + "landing-a-no-sites.png" });
  console.log(`  · A (no sites): center ${v ? v.center.map((x) => x.toFixed(3)).join(", ") : "?"} · zoom ${v ? v.zoom.toFixed(2) : "?"}`);
  ok("A · the map reports a readable view", !!v);
  ok("A · opens on the country, not on a metro", !!v && v.zoom <= 5.4, v && `zoom ${v.zoom.toFixed(2)}`);
  ok("A · centered on the continental US, NOT on Houston", !!v && v.center[0] > 30 && v.center[0] < 45 && v.center[1] > -110 && v.center[1] < -85,
     v && v.center.map((x) => x.toFixed(2)).join(", "));
  ok("A · no page errors", errs.length === 0, errs[0] || "");
  await ctx.close();
}

// ── B — EXACTLY ONE SITE: its area at metro scale ─────────────────────────────────────────────
{
  const { ctx, page, errs } = await open("B_one");
  const v = await readView(page);
  const pins = await pinStats(page);
  await page.screenshot({ path: OUT + "landing-b-one-site.png" });
  console.log(`  · B (one site, Denver): center ${v.center.map((x) => x.toFixed(3)).join(", ")} · zoom ${v.zoom.toFixed(2)} · pins ${JSON.stringify(pins)}`);
  ok("B · centered on the site", Math.abs(v.center[0] - 39.74) < 0.05 && Math.abs(v.center[1] + 104.99) < 0.05,
     v.center.map((x) => x.toFixed(3)).join(", "));
  ok("B · NOT zoomed to the parcel — held at the metro clamp", Math.abs(v.zoom - LANDING_MAX_ZOOM) < 0.15, `zoom ${v.zoom.toFixed(2)}`);
  ok("B · the site's pin is on screen", pins.inside === 1, JSON.stringify(pins));
  ok("B · no page errors", errs.length === 0, errs[0] || "");
  await ctx.close();
}

// ── C — THE OWNER'S REAL DISTRIBUTION: Houston, Colorado off-screen ───────────────────────────
{
  const { ctx, page, errs } = await open("C_owner");
  const v = await readView(page);
  const pins = await pinStats(page);
  await page.screenshot({ path: OUT + "landing-c-owner-26-plus-1.png" });
  console.log(`  · C (26 Houston + 1 Weld CO): center ${v.center.map((x) => x.toFixed(3)).join(", ")} · zoom ${v.zoom.toFixed(2)} · pins ${JSON.stringify(pins)}`);
  ok("C · opens on HOUSTON", v.center[0] > 29.3 && v.center[0] < 30.2 && v.center[1] > -96.1 && v.center[1] < -94.5,
     v.center.map((x) => x.toFixed(3)).join(", "));
  ok("C · zoom is AT OR BELOW the metro clamp", v.zoom <= LANDING_MAX_ZOOM + 0.15, `zoom ${v.zoom.toFixed(2)}`);
  ok("C · all 27 sites are on the map", pins.total === 27, JSON.stringify(pins));
  ok("C · the 26 Houston-area pins are on screen", pins.inside === 26, JSON.stringify(pins));
  ok("C · the single Colorado pin is OFF-SCREEN — it did not drag the camera", pins.outside === 1, JSON.stringify(pins));
  ok("C · no page errors", errs.length === 0, errs[0] || "");

  // ── D — not a leash: pan away, and stay there ───────────────────────────────────────────────
  const box = v.box;
  await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w / 2 - 380, box.y + box.h / 2 - 260, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const moved = await readView(page);
  await page.waitForTimeout(2500);          // long enough for any late site-list refresh to re-land
  const after = await readView(page);
  await page.screenshot({ path: OUT + "landing-d-after-pan.png" });
  console.log(`  · D: panned to ${moved.center.map((x) => x.toFixed(3)).join(", ")} → still ${after.center.map((x) => x.toFixed(3)).join(", ")}`);
  ok("D · the pan actually moved the map", Math.abs(moved.center[0] - v.center[0]) > 0.05 || Math.abs(moved.center[1] - v.center[1]) > 0.05,
     `${v.center.map((x) => x.toFixed(3))} → ${moved.center.map((x) => x.toFixed(3))}`);
  ok("D · the derived view does NOT yank the user back", Math.abs(after.center[0] - moved.center[0]) < 0.01 && Math.abs(after.center[1] - moved.center[1]) < 0.01,
     `${moved.center.map((x) => x.toFixed(3))} → ${after.center.map((x) => x.toFixed(3))}`);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? "❌" : "✅"} ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { failed.forEach((f) => console.log(`   ✗ ${f.t}`)); process.exit(1); }
