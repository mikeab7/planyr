#!/usr/bin/env node
/* verify-pin-overlap.mjs — pins on ONE spot stay reachable AND stay on their point at every zoom.
 *
 * History: NEW-1 (B2013744) — a map note's pin hid a comp's pin on the same parcel (owner-measured
 * 2026-10-02); the fix nudged coincident pins apart by a FIXED number of screen pixels. B2671329
 * (owner, 2026-11-24: "the pin moves independently of the map on zoom in or out") — that nudge is a
 * screen distance, so the nudged pin's spot on the GROUND changed with every zoom and it slid against
 * the aerial. The shipped layout (lib/pinCluster.js `pinStacks`): every pin on its own point, a count
 * badge on the stack's lead that fans the stack out, a fan that closes the moment the map zooms.
 *
 * HOW: ui-audit/fixtures/pin-overlap.html builds a real Leaflet map from the app's OWN marker modules
 * + the same pinCluster helpers MapFinder uses (the real map needs a signed-in session to have comps).
 * Each drawn pin's centre is read from the DOM (its first svg), turned back into a ground position
 * with Leaflet, and compared with the pin's coordinate, at zooms 12 to 19.
 * KNOWN-BAD / RED ARM: `?mode=legacy` (the retired nudge) MUST drift by more than DRIFT_M between
 * two zooms; if it does not, the probe is blind and the run is VOID.
 * Needs a dev server: `npx vite --port 4183` (BASE_URL overrides). */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4183/").replace(/\/$/, "");
const EXEC = process.env.PW_CHROME || undefined;
const ZOOMS = [12, 14, 16, 17, 18, 19];
const ON_POINT_PX = 1; // a drawn centre within 1 px of its own coordinate is "on its point"
const DRIFT_M = 5;
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage();
await assertMeasurable(page, "verify-pin-overlap");
let fail = 0;
const ok = (t, pass, d = "") => { if (!pass) fail++; console.log(`  ${pass ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); };

async function open(mode) {
  await page.goto(`${BASE}/ui-audit/fixtures/pin-overlap.html?mode=${mode}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
  await pacedWait(page, 300);
}
/** Every drawn comp/note pin: its id, px distance from its own coordinate, the ground point under it. */
const readPins = () => page.evaluate(() => {
  const map = window.__map;
  const byId = Object.fromEntries(window.__points.map((p) => [p.id, p]));
  const box = map.getContainer().getBoundingClientRect();
  return [...document.querySelectorAll("[data-pin-id]")].map((el) => {
    const r = el.querySelector("svg").getBoundingClientRect();
    const c = { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
    const p = byId[el.getAttribute("data-pin-id")];
    const want = map.latLngToContainerPoint([p.lat, p.lon]);
    const g = map.containerPointToLatLng([c.x, c.y]);
    return { id: p.id, px: Math.hypot(c.x - want.x, c.y - want.y), lat: g.lat, lon: g.lng, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
});
const setZoom = async (z) => {
  await page.evaluate((zz) => new Promise((res) => { const m = window.__map; if (m.getZoom() === zz) return res(); m.once("zoomend", res); m.setZoom(zz, { animate: false }); }), z);
  await pacedWait(page, 150);
};
const metres = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180));

// ── RED ARM ──
await open("legacy");
const ground = {};
for (const z of ZOOMS) { await setZoom(z); for (const p of await readPins()) (ground[p.id] ||= []).push(p); }
let worst = 0, worstId = "";
for (const [id, list] of Object.entries(ground)) for (const a of list) for (const b of list) { const d = metres(a, b); if (d > worst) { worst = d; worstId = id; } }
console.log("RED ARM (the retired fixed screen-pixel nudge)");
ok(`known-bad arm reproduces the owner's defect: a nudged pin's spot on the ground moves with zoom (> ${DRIFT_M} m)`, worst > DRIFT_M, `${worstId} drifts ${worst.toFixed(0)} m`);
if (!(worst > DRIFT_M)) { console.log("❌ VOID: the probe cannot see the defect it exists to catch"); await browser.close(); process.exit(1); }

// ── FIXED ARM ──
await open("stacks");
console.log("FIXED ARM (stacks)");
for (const z of ZOOMS) {
  await setZoom(z);
  const pins = await readPins();
  const off = pins.filter((p) => p.px > ON_POINT_PX);
  ok(`zoom ${z}: every drawn pin (${pins.length}, all five comp types) sits on its own point`, off.length === 0, off.map((p) => `${p.id} ${p.px.toFixed(1)}px`).join(", "));
}
await setZoom(17);
const badge = page.locator("[data-pin-stack]");
ok("the stack shows ONE count badge, counting all seven records on the spot", (await badge.count()) === 1 && (await badge.innerText()).trim() === "7", await badge.allInnerTexts().then((t) => t.join("|")));
const lead = (await readPins()).find((p) => !p.id.startsWith("comp:lone"));
const hit = (x, y) => page.evaluate(([xx, yy]) => { const el = document.elementFromPoint(xx, yy); const m = el && el.closest(".leaflet-marker-icon"); return m ? (m.getAttribute("data-pin-id") || (m.classList.contains("map-site-feature") ? "site:s" : "?")) : null; }, [x, y]);
ok("collapsed: the lead comp answers at its own centre", (await hit(lead.cx, lead.cy)) === lead.id, lead.id);
ok("collapsed: the site pin still answers on its ring beside the comp", (await hit(lead.cx + 9, lead.cy)) === "site:s");
// a real mouse press on the badge
const bb = await badge.boundingBox();
await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
await pacedWait(page, 200);
const fanned = (await readPins()).filter((p) => !p.id.startsWith("comp:lone"));
ok("pressing the badge fans out all six comps and notes", fanned.length === 6, fanned.map((p) => p.id).join(", "));
let reach = 0;
for (const p of fanned) if ((await hit(p.cx, p.cy)) === p.id) reach++;
ok("fanned: every member answers at its own centre", reach === fanned.length, `${reach}/${fanned.length}`);
const site = await page.evaluate(() => { const r = document.querySelector(".map-site-feature svg").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
ok("fanned: the site pin answers at its own centre (the true spot is left to it)", (await hit(site[0], site[1])) === "site:s");
ok("fanned: each member is tethered back to the true point", (await page.locator("[data-pin-tether]").count()) === 6);
// the map starts to zoom → the fan closes, and everything drawn is back on its point
await page.evaluate(() => window.__map.zoomIn(1, { animate: false }));
await pacedWait(page, 250);
const after = await readPins();
ok("zooming closes the fan: one lead again, every pin on its own point", after.filter((p) => !p.id.startsWith("comp:lone")).length === 1 && after.every((p) => p.px <= ON_POINT_PX), after.map((p) => `${p.id} ${p.px.toFixed(1)}`).join(", "));
await browser.close();
console.log(fail ? `\n❌ ${fail} check(s) failed` : "\n✅ all checks passed");
process.exit(fail ? 1 : 0);
