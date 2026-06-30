/* Self-verification for two bump-out fixes (owner-reported, 2026-06-30):
 *   A) Resizing a corner bump-out keeps it GLUED to its building corner. Expanding its projection
 *      (the away-from-the-dock direction) must NOT change its span along the wall, so the dock doors
 *      (which start at the bump's along-edge) stay put — no gap opens between the bump and the doors.
 *   B) A bump-out inherits its building's FILL COLOUR and OPACITY — recolouring/fading the building
 *      carries its bump-outs with it.
 * Ground truth = the persisted element list (feet, exact) + the rendered SVG attributes. Logged-out.
 * Run:  node ui-audit/verify-bumpout-anchor-style.mjs   (preview server on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { dogEarGeom } from "/home/user/planyr/src/workspaces/site-planner/lib/dogEar.js";
import { mkdirSync } from "node:fs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";

const DEMO_ID = "verify-bump-anchor";
const ROT = 20;
const rot2 = (x, y, deg) => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return { x: x * c - y * s, y: x * s + y * c }; };
const along = 55, proj = 60, bw = 600, bh = 300;
const off = rot2(1 * (bw / 2 - along / 2), -1 * (bh / 2 + proj / 2), ROT);
const bump = { id: "de1", type: "building", cx: off.x, cy: off.y, w: along, h: proj, rot: ROT,
  attachedTo: "b1", noFit: true, noLabel: true, dock: "none", dogEar: { side: "top", sign: 1 } };
const els = [{ id: "b1", type: "building", cx: 0, cy: 0, w: bw, h: bh, rot: ROT, dock: "cross" }, bump];
const parcel = { id: "pc1", locked: false, points: [{ x: -950, y: -850 }, { x: 950, y: -850 }, { x: 950, y: 850 }, { x: -950, y: 850 }] };
const demoSite = { id: DEMO_ID, groupId: DEMO_ID, site: "Verify bump anchor", name: "Plan 1", origin: null, county: null,
  parcels: [parcel], els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) {}
await page.waitForTimeout(700);

let fail = 0;
const log = (ok, m) => { console.log((ok ? "✓ " : "✗ ") + m); if (!ok) fail++; };
const near = (a, b, eps = 1.5) => Math.abs(a - b) <= eps;
const readEls = async () => page.evaluate((id) => { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); return (m[id] && m[id].els) || []; }, DEMO_ID);
const bumpRect = async () => page.evaluate(() => {
  const rects = [...document.querySelectorAll("svg rect")].map((r) => ({ r, b: r.getBoundingClientRect() }))
    .filter((o) => { const f = (o.r.getAttribute("fill") || "").toLowerCase(); return (f === "#f3ece1" || f === "#3366cc") && o.b.width * o.b.height > 50; })
    .sort((a, z) => a.b.width * a.b.height - z.b.width * z.b.height);
  if (!rects.length) return null; const o = rects[0]; const b = o.b;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, fill: o.r.getAttribute("fill"), fillOpacity: o.r.getAttribute("fill-opacity") };
});

// ---------- PART A: anchor / no-gap ----------
let e0 = await readEls();
const b0 = e0.find((x) => x.dogEar);
const br = await bumpRect();
await page.mouse.click(br.x, br.y); // select the bump
await page.waitForTimeout(450);

// Outer (projection) edge grip = the accent-filled grip most in the building's outward-normal
// screen direction (no canvas rotation / no y-flip, so it is (sin rot, -cos rot) for a top bump).
const ox = Math.sin((ROT * Math.PI) / 180), oy = -Math.cos((ROT * Math.PI) / 180);
const drag = await page.evaluate(({ cx, cy, ox, oy }) => {
  const grips = [...document.querySelectorAll("svg rect")].filter((r) => { const f = (r.getAttribute("fill") || "").toLowerCase(); const w = +r.getAttribute("width"); return f === "#c2410c" && w >= 7 && w <= 13; })
    .map((r) => { const b = r.getBoundingClientRect(); const gx = b.x + b.width / 2, gy = b.y + b.height / 2; return { gx, gy, dot: (gx - cx) * ox + (gy - cy) * oy }; })
    .sort((a, z) => z.dot - a.dot);
  return grips[0] || null;
}, { cx: br.x, cy: br.y, ox, oy });
if (drag) {
  await page.mouse.move(drag.gx, drag.gy); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(drag.gx + ox * 13 * i, drag.gy + oy * 13 * i, { steps: 1 });
  await page.mouse.up(); await page.waitForTimeout(500);
}
let e1 = await readEls();
const b1 = e1.find((x) => x.dogEar), host1 = e1.find((x) => x.id === "b1");
// For a top bump dogEarGeom maps w=along, h=proj; the seed's dogEar tag has no along/proj until a
// resize, so the baseline span is the bump's w/h.
log(near(b1.w, b0.w, 1), `A1: projection drag leaves the wall span UNCHANGED (along ${b0.w}→${b1.w}) — dock doors don't shift`);
log(b1.h > b0.h + 20, `A2: projection grew (proj ${b0.h}→${b1.h})`);
const g = dogEarGeom(host1, b1.dogEar);
log(near(b1.cx, g.cx) && near(b1.cy, g.cy) && near(b1.w, g.w) && near(b1.h, g.h),
  `A3: bump stays ANCHORED to its corner (matches dogEarGeom — no float/gap): cx ${b1.cx.toFixed(0)}/${g.cx.toFixed(0)} cy ${b1.cy.toFixed(0)}/${g.cy.toFixed(0)} w ${b1.w}/${g.w} h ${b1.h}/${g.h}`);
await page.screenshot({ path: OUT + "bump-anchor.png" });

// ---------- PART B: colour / opacity inheritance ----------
// Select the building (click a spot well inside it, away from the bump corner).
const bsel = await page.evaluate(() => {
  const r = [...document.querySelectorAll("svg rect")].map((x) => ({ x, b: x.getBoundingClientRect() }))
    .filter((o) => (o.x.getAttribute("fill") || "").toLowerCase() === "#f3ece1").sort((a, z) => z.b.width * z.b.height - a.b.width * a.b.height)[0];
  if (!r) return null; const b = r.b; return { x: b.x + b.width * 0.45, y: b.y + b.height * 0.6 };
});
await page.mouse.click(bsel.x, bsel.y);
await page.waitForTimeout(450);
// Set the building Fill color → #3366cc and Fill opacity → 0.4 via the Properties inputs.
const setColor = await page.evaluate(() => {
  const inp = [...document.querySelectorAll('input[type="color"]')].find((i) => i.offsetParent !== null);
  if (!inp) return false; const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(inp, "#3366cc"); inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true })); return true;
});
await page.waitForTimeout(250);
const setOp = await page.evaluate(() => {
  const r = [...document.querySelectorAll('input[type="range"]')].find((i) => i.offsetParent !== null && i.max === "1");
  if (!r) return false; const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(r, "0.4"); r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); return true;
});
await page.waitForTimeout(450);
log(setColor && setOp, `B0: building Fill color + Fill opacity controls present and set`);
const bumpAfter = await bumpRect(); // smallest building-fill rect = the bump
const bld = await page.evaluate(() => {
  const r = [...document.querySelectorAll("svg rect")].map((x) => ({ x, b: x.getBoundingClientRect() }))
    .filter((o) => (o.x.getAttribute("fill") || "").toLowerCase() === "#3366cc").sort((a, z) => z.b.width * z.b.height - a.b.width * a.b.height)[0];
  return r ? { fill: r.x.getAttribute("fill"), fillOpacity: r.x.getAttribute("fill-opacity") } : null;
});
log((bumpAfter.fill || "").toLowerCase() === "#3366cc", `B1: bump-out FILL follows the building (${bumpAfter.fill})`);
log(near(parseFloat(bumpAfter.fillOpacity), 0.4, 0.02), `B2: bump-out OPACITY follows the building (${bumpAfter.fillOpacity})`);
log(bld && (bld.fill || "").toLowerCase() === "#3366cc" && near(parseFloat(bld.fillOpacity), 0.4, 0.02), `B3: building itself shows the new color/opacity (${bld && bld.fill} @ ${bld && bld.fillOpacity})`);
await page.screenshot({ path: OUT + "bump-style.png" });

console.log(errors.length ? `\nPAGE ERRORS:\n${errors.slice(0, 5).join("\n")}` : "\n(no page errors)");
console.log(fail === 0 ? "\n✓ ALL BUMP-OUT CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
