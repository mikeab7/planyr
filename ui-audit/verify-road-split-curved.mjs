/* NEW-1 / NEW-2 live verification — the curved half of the road family, driven through the REAL
 * render path on the OWNER'S REAL PLANS.
 *
 * Part A (NEW-2, the split) seeds Goose Creek "Plan 1 (copy)" (production site sms69x8rb2qk) and
 * parks the viewport on each junction the owner's screenshot covers, shooting each one TWICE — at
 * working zoom, and again with the pavement fill knocked down to a third. The second pass is the
 * point: a residual stacked edge (two translucent fills doubling where strips overlap) is invisible
 * at full opacity, which is exactly how earlier fixes in this family "passed" while still broken.
 *
 * Part B (NEW-1, the hit test) seeds Tsakiris / Concept A and drives a real right-click on the
 * OUTSIDE of the truck loop's 120 ft return at vertex 18 — a point 36 ft from the nearest chord
 * between control points, on a 40 ft road. The old chord-projection hit test could not reach it at
 * any zoom, so "Add control point" never appeared there and the element menu opened instead.
 *
 * Run:  node ui-audit/verify-road-split-curved.mjs        (needs `npm run preview` on :4173)
 *       LABEL=after node ui-audit/verify-road-split-curved.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync, readFileSync } from "node:fs";
import { roadCenterline } from "../src/workspaces/site-planner/lib/roadGeometry.js";

// Distance from a point to the straight CHORD between two control points — the hit test as it was.
const segDist = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, L2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const LABEL = process.env.LABEL || "after";
const OUT = new URL("./screens/road-split-curved/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const siteRec = (id, site, name, county, els) => ({
  id, groupId: id, site, name, origin: null, county, parcels: [], els,
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: 0,
});

const GOOSE = siteRec("goose-creek-plan1-copy", "Goose Creek", "Plan 1 (copy)", "harris", load("goose-creek-plan1-copy.json").els);
const TSAK = siteRec("tsakiris-concept-a", "Tsakiris", "Concept A", "waller", load("tsakiris-concept-a.json").els);

// The three topologies the brief names, in world feet.
const SPLITS = [
  { key: "A1-curved-oblique-split", x: -172.3, y: 791.5, ppf: 2.2, note: "the branch teed onto an ARC vertex where the 36' aisle turns ~88deg" },
  { key: "A2-square-tee", x: -1070.9, y: 820.8, ppf: 1.6, note: "the same 36' aisle onto the 100' aisle at a collinear vertex — the control case" },
  { key: "A3-branch-with-drive-junction", x: -200, y: 830, ppf: 1.1, note: "the branch AND the drive junctions into the truck courts, together" },
  { key: "A4-second-tee-on-the-100", x: -1272.7, y: 0.4, ppf: 1.6, note: "the 40' aisle onto the 100' aisle" },
  { key: "A5-overview", x: -700, y: 500, ppf: 0.3, note: "the whole road network, for a look at every junction at once" },
];

// ⚠ BASE_URL only reaches a LOCAL preview from this sandbox. A Cloudflare preview / production URL
// answers 200 to curl but resets every Chromium navigation (ERR_CONNECTION_RESET), with the egress
// proxy logging no rejection for the host — and neither Playwright's `proxy:` option nor
// `--proxy-server` + `--proxy-bypass-list=<-loopback>` changes that (both tried 2026-07-30). So run
// this against `npm run preview` on :4173; the DEPLOYED read is a V533 step, not something to
// re-attempt here.
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});
const NOISE = /ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_CLOSED|ERR_CERT|Failed to load resource|net::/i;

async function openPlan(rec) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
  await ctx.addInitScript(`(() => { try {
    window.__PLANYR_E2E = true;
    localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ [rec.id]: rec }))});
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(rec.id)});
  } catch (e) {} })();`);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
  await page.waitForFunction(() => !!window.__plannerView && !!window.__plannerRoadNet, null, { timeout: 20000 });
  return { ctx, page, errors };
}

/* ---------------------------------------------------------------- Part A — the split renders clean */
const A = await openPlan(GOOSE);
const net = await A.page.evaluate(() => {
  const n = window.__plannerRoadNet();
  return {
    regions: n.regions.map((r) => ({ ids: r.ids, pts: r.outer.length, holes: r.holes.length })),
    tees: n.tees, drives: n.drives,
    surfaces: document.querySelectorAll('[data-testid="road-network-surface"]').length,
    edges: document.querySelectorAll('[data-testid="road-network-edge"]').length,
  };
});
console.log(`\n=== A. GOOSE CREEK "PLAN 1 (COPY)" — dissolved network (${LABEL}) ===`);
console.log(JSON.stringify(net, null, 2));

const fadeFill = (on) => A.page.evaluate((v) => {
  for (const n of document.querySelectorAll('[data-testid="road-network-surface"]')) {
    if (v == null) n.style.removeProperty("fill-opacity");
    else n.style.setProperty("fill-opacity", String(v), "important");
  }
}, on ? 0.33 : null);

for (const j of SPLITS) {
  await A.page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [j.x, j.y, j.ppf]);
  await A.page.waitForTimeout(450);
  await fadeFill(false);
  await A.page.locator('[data-testid="planner-canvas"]').screenshot({ path: `${OUT}${LABEL}-${j.key}.png` });
  await fadeFill(true);
  await A.page.waitForTimeout(120);
  await A.page.locator('[data-testid="planner-canvas"]').screenshot({ path: `${OUT}${LABEL}-${j.key}-faded.png` });
  console.log(`shot  ${j.key.padEnd(30)} ${j.note}`);
}
await fadeFill(false);
if (A.errors.length) console.log("\nPAGE ERRORS (A):\n" + A.errors.slice(0, 10).join("\n"));
await A.ctx.close();

/* ------------------------------------------------- Part B — the hit test reaches a curved pavement */
// The truck loop's 120 ft return: vertex 18 of e38duuwgj, a ~91° bend on a 40 ft road. The apex of
// that fillet — a point squarely ON the drawn pavement — stands ~36 ft from the nearest chord between
// control points, so the old chord-projection hit test (tolerance ≈ the 20.5 ft strip half-width)
// could not reach it at any zoom: no edge hit, no "Add control point".
const LOOP = "e38duuwgj", VTX = 18;
const loop = TSAK.els.find((e) => e.id === LOOP);
const dense = roadCenterline(loop.pts, loop.vtx, { defaultRadius: 120 });
const APEX = dense.reduce((best, q) => {
  const d = Math.hypot(q.x - loop.pts[VTX].x, q.y - loop.pts[VTX].y);
  return !best || d < best.d ? { ...q, d } : best;
}, null);
const chordGap = Math.min(
  segDist(APEX, loop.pts[VTX - 1], loop.pts[VTX]),
  segDist(APEX, loop.pts[VTX], loop.pts[VTX + 1]),
);
const HALF = (+loop.travelW || 0) / 2 + 0.5;

const B = await openPlan(TSAK);
await B.page.evaluate(([x, y]) => window.__plannerView.centerOn(x, y, 2.2), [APEX.x, APEX.y]);
await B.page.waitForTimeout(500);
const box = await B.page.locator('[data-testid="planner-canvas"]').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;   // the apex is now under the canvas centre

await B.page.mouse.click(cx, cy);                                // select the loop
await B.page.waitForTimeout(300);
await B.page.mouse.move(cx + 1, cy);                             // hover → the insertion hint dot
await B.page.waitForTimeout(250);
const hint = await B.page.evaluate(() => {
  const c = [...document.querySelectorAll('[data-testid="planner-canvas"] circle')]
    .find((n) => n.getAttribute("stroke") === "#fff" && +n.getAttribute("r") <= 5);
  return c ? { cx: +c.getAttribute("cx"), cy: +c.getAttribute("cy") } : null;
});
await B.page.locator('[data-testid="planner-canvas"]').screenshot({ path: `${OUT}${LABEL}-B1-hover-hint.png` });
await B.page.mouse.click(cx, cy, { button: "right" });
await B.page.waitForTimeout(350);
const menu = await B.page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean));
const hasAdd = menu.some((t) => /Add control point/i.test(t));
await B.page.screenshot({ path: `${OUT}${LABEL}-B2-right-click-menu.png` });
console.log(`\n=== B. TSAKIRIS / CONCEPT A — right-click on the 120 ft return (${LABEL}) ===`);
console.log(`apex of the fillet        ${APEX.x.toFixed(1)}, ${APEX.y.toFixed(1)}`);
console.log(`its distance to the nearest CHORD  ${chordGap.toFixed(1)} ft   (old tolerance ≈ ${HALF} ft → unreachable)`);
console.log(`insertion hint shown      ${hint ? "YES" : "NO"}`);
console.log(`menu offers "Add control point": ${hasAdd ? "YES" : "NO"}`);
if (!hasAdd) console.log(`menu items seen: ${JSON.stringify(menu.slice(0, 12))}`);
if (B.errors.length) console.log("\nPAGE ERRORS (B):\n" + B.errors.slice(0, 10).join("\n"));
await B.ctx.close();

console.log(`\nscreens → ${OUT}`);
await browser.close();
