/* Regression guard for the two adversarial-review fixes on top of B617/B619:
 *   Fix 1 — a POLYGON-drawn AREA element (building/paving/landscape) is a filled-area edge → its
 *           outline keeps a FIXED pixel weight, NOT strokeZoom-scaled (only roads/lines scale).
 *   Fix 2 — a LOCKED road has no grips, so selecting it must still show a cue (a blue halo along
 *           its geometry) — it must not look identical to an unselected road.
 * Logged-out, preview :4173. Run: node ui-audit/verify-b617-b619-fixes.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { roadStripBBox } from "../src/workspaces/site-planner/lib/siteModel.js";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const DEMO_ID = "verify-b617-b619-fixes";
const BLD_STROKE = "#33302b"; // TYPE.building.stroke
const SEL_BLUE = "#2563eb";
const strokeZoom = (base, zk) => Math.max(0.6, Math.min(base * zk, base * 3.5));

// a POLYGON-drawn building (renders through renderElPx's el.points branch)
const polyBuilding = { id: "pbld", type: "building", points: [{ x: -120, y: -120 }, { x: 60, y: -120 }, { x: 60, y: 0 }, { x: -120, y: 0 }], rot: 0 };
// a LOCKED centerline road (grips are suppressed when locked)
const rpts = [{ x: -120, y: 90 }, { x: 120, y: 90 }];
const rvtx = [{}, {}];
const bbox = roadStripBBox(rpts, rvtx, 24, 0.5, { defaultRadius: 120 });
const lockedRoad = { id: "lrd", type: "road", pts: rpts, vtx: rvtx, travelW: 24, curb: 0.5, roadClass: "local", locked: true, ...bbox };
const parcel = { id: "pc1", locked: false, points: [{ x: -220, y: -180 }, { x: 220, y: -180 }, { x: 220, y: 180 }, { x: -220, y: 180 }] };

const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify fixes", name: "Plan 1", origin: null, county: null,
  parcels: [parcel], els: [polyBuilding, lockedRoad], measures: [], callouts: [], markups: [],
  settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
const NOISE = /ERR_TUNNEL|ERR_CONNECTION|ERR_CERT|Failed to load resource|net::/i;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { /* noop */ }
await page.waitForTimeout(500);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

// ---- Fix 1: polygon building outline is FIXED weight (≈2), not strokeZoom(2, zk) ----
const bld = await page.evaluate((c) => {
  const p = [...document.querySelectorAll("svg path")].find((el) => (el.getAttribute("stroke") || "").toLowerCase() === c && (el.getAttribute("fill") || "") === "none");
  if (!p) return null;
  // derive ppf from the path bbox width (the building spans 180 ft on x)
  const bb = p.getBBox ? p.getBBox() : null;
  return { sw: +p.getAttribute("stroke-width"), w: bb ? bb.width : null };
}, BLD_STROKE);
if (!bld) { log(false, "Fix1: polygon building outline path not found"); }
else {
  const ppf = bld.w ? bld.w / 180 : null, zk = ppf ? ppf / 0.35 : null;
  const scaled = zk ? strokeZoom(2, zk) : null;
  log(Math.abs(bld.sw - 2) < 0.3, `Fix1: polygon building outline is FIXED ~2px (got ${bld.sw}) — filled-area edge not scaled`);
  log(zk == null || Math.abs(bld.sw - scaled) > 0.5, `Fix1: outline is NOT the zoom-scaled weight (${scaled ? scaled.toFixed(2) : "?"}px) — proves the strokeZoom over-scale was reverted`);
}

// ---- Fix 2: select the LOCKED road → a blue halo cue appears (data-export skip) ----
const roadClick = await page.evaluate(() => {
  // the road surface path uses the road fill #b9b4a8
  const p = [...document.querySelectorAll("svg path")].find((el) => (el.getAttribute("fill") || "").toLowerCase() === "#b9b4a8");
  if (!p || !p.getBoundingClientRect) return null;
  const b = p.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
if (!roadClick) { log(false, "Fix2: locked road surface not found"); }
else {
  const before = await page.evaluate((blue) => document.querySelectorAll('svg polyline[stroke="' + blue + '"], svg polygon[stroke="' + blue + '"]').length, SEL_BLUE);
  await page.mouse.click(roadClick.x, roadClick.y);
  await page.waitForTimeout(400);
  const cue = await page.evaluate((blue) => {
    const els = [...document.querySelectorAll('svg polyline[stroke="' + blue + '"], svg polygon[stroke="' + blue + '"]')];
    const skip = els.filter((e) => e.getAttribute("data-export") === "skip" || e.closest('[data-export="skip"]'));
    return { total: els.length, skip: skip.length };
  }, SEL_BLUE);
  log(cue.total > before, `Fix2: selecting the LOCKED road adds a blue cue (${before} → ${cue.total} blue halo/outline els)`);
  log(cue.total === 0 || cue.skip === cue.total, `Fix2: the locked-road cue is data-export="skip" (${cue.skip}/${cue.total})`);
}

log(errors.length === 0, `no page errors (${errors.length})` + (errors.length ? " → " + errors.slice(0, 2).join(" | ") : ""));
console.log(fail ? `\n✗ ${fail} check(s) failed` : "\n✓ all fix checks passed");
await browser.close();
process.exit(fail ? 1 : 0);
