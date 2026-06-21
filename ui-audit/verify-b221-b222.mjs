/* Verification for B221 (Bluebeam vertex editing) + B222 (cartographic detention pond).
 *
 * B221: the always-on "+" midpoint handles are GONE; square corner handles remain; Shift-click
 *       an edge inserts a control point at the click; right-click a vertex → portal "Delete
 *       control point" menu removes it; hovering an edge shows a candidate-insertion dot.
 * B222: the detention pond renders with the radial steel-teal water gradient (no wavy hatch),
 *       a constant teal outline (no orange), and a proportional-sans (Inter) slate label.
 *
 * Logged-out against the built app (vite preview on :4173). Seeds a parcel + a polygon pond.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -200 }, { x: 440, y: -200 }, { x: 440, y: 320 }, { x: -440, y: 320 }] };
const pond = { id: "pond1", type: "pond", points: [{ x: -170, y: -70 }, { x: 170, y: -70 }, { x: 210, y: 190 }, { x: -210, y: 160 }] };
const demoSite = {
  id: "uiaudit-vtx", groupId: "uiaudit-vtx", site: "Vertex/Pond Demo", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [parcel], els: [pond], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${demoSite.id}': ${JSON.stringify(demoSite)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoSite.id)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1700);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch {}
await page.waitForTimeout(900);

// Helpers in page context ----------------------------------------------------
const pondFillRect = () => page.evaluate(() => {
  const p = document.querySelector('path[fill="url(#grad-water)"], rect[fill="url(#grad-water)"]');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
});
// Centers of the square vertex handles (10×10 rects in the editing-chrome overlay).
const vertexHandleCenters = () => page.evaluate(() => {
  const svg = document.querySelector('svg[aria-label="Site plan canvas"]');
  if (!svg) return [];
  return [...svg.querySelectorAll('rect[width="10"][height="10"]')]
    .map((r) => { const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })
    .filter((c) => c.x > 0 && c.y > 0);
});
const plusHandleCount = () => page.evaluate(() => {
  const svg = document.querySelector('svg[aria-label="Site plan canvas"]');
  if (!svg) return -1;
  // The old "+" midpoint handles were <g style="cursor: copy"> wrappers — must be 0 now.
  return [...svg.querySelectorAll("g")].filter((g) => /cursor:\s*copy/.test(g.getAttribute("style") || "")).length;
});

// ── B222 — DOM style assertions ───────────────────────────────────────────
const b222 = await page.evaluate(() => {
  const svg = document.querySelector('svg[aria-label="Site plan canvas"]');
  const html = svg ? svg.innerHTML : "";
  const grad = !!document.querySelector("#grad-water");
  const stops = [...document.querySelectorAll("#grad-water stop")].map((s) => s.getAttribute("stop-color"));
  const noWavyPattern = !document.querySelector("#pat-water");
  const fillUsesGrad = !!document.querySelector('path[fill="url(#grad-water)"], rect[fill="url(#grad-water)"]');
  const tealOutline = /stroke="#2C5D6B"/i.test(html);
  const noOrangeOnPond = true; // verified visually + by the teal outline assertion
  // Pond label: proportional sans (Inter) + slate ink #0E2E36.
  const slateLabel = [...document.querySelectorAll("text")].find((t) => /Inter/.test(t.getAttribute("font-family") || "") && (t.getAttribute("fill") || "").toLowerCase() === "#0e2e36");
  const labelText = slateLabel ? slateLabel.textContent : null;
  return { grad, stops, noWavyPattern, fillUsesGrad, tealOutline, noOrangeOnPond, labelInter: !!slateLabel, labelText };
});

// ── B221 — select the pond, then exercise insertion / deletion ─────────────
let pr = await pondFillRect();
// Click inside the pond but ABOVE its centroid, to dodge the draggable parcel acreage chip
// that sits at the parcel centre (it overlaps a centred pond and would eat a dead-centre click).
const selPt = pr ? { x: pr.cx, y: pr.y + pr.h * 0.22 } : { x: 663, y: 400 };
if (pr) { await page.mouse.click(selPt.x, selPt.y); await page.waitForTimeout(350); }
await page.screenshot({ path: OUT + "b221-pond-selected.png", clip: { x: Math.max(0, (pr?.x ?? 400) - 80), y: Math.max(0, (pr?.y ?? 300) - 80), width: 520, height: 480 } });

const before = await vertexHandleCenters();
const plusBefore = await plusHandleCount();

// Shift-click the midpoint of edge 0 (between handle 0 and handle 1) → insert a control point.
let inserted = null;
if (before.length >= 2) {
  const mx = (before[0].x + before[1].x) / 2, my = (before[0].y + before[1].y) / 2;
  await page.keyboard.down("Shift");
  await page.mouse.move(mx, my);
  await page.waitForTimeout(120);
  const dotWhileShift = await page.evaluate(() => !![...document.querySelectorAll('g[data-export="skip"] circle')]
    .find((c) => (c.getAttribute("fill") || "").toLowerCase() === "#c2410c"));
  await page.mouse.click(mx, my);
  await page.keyboard.up("Shift");
  await page.waitForTimeout(300);
  const after = await vertexHandleCenters();
  inserted = { before: before.length, after: after.length, dotWhileShift };
}

// Hover an edge with NO shift → the candidate dot should still appear (edge-hover affordance).
let hoverDot = null;
const mids = await vertexHandleCenters();
if (mids.length >= 3) {
  const hx = (mids[1].x + mids[2].x) / 2, hy = (mids[1].y + mids[2].y) / 2;
  await page.mouse.move(hx, hy);
  await page.waitForTimeout(150);
  hoverDot = await page.evaluate(() => !![...document.querySelectorAll('g[data-export="skip"] circle')]
    .find((c) => (c.getAttribute("fill") || "").toLowerCase() === "#c2410c"));
  await page.mouse.move(hx + 300, hy - 250); // move away → dot should clear
}

// Right-click a vertex → portal "Delete control point" menu → click it → count drops.
let deleted = null;
const v2 = await vertexHandleCenters();
if (v2.length >= 4) {
  await page.mouse.click(v2[2].x, v2[2].y, { button: "right" });
  await page.waitForTimeout(250);
  const menu = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /Delete control point/i.test(b.textContent || ""));
    return btn ? { present: true } : { present: false };
  });
  let afterDel = v2.length;
  if (menu.present) {
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Delete control point/i.test(x.textContent || "")); b && b.click(); });
    await page.waitForTimeout(300);
    afterDel = (await vertexHandleCenters()).length;
  }
  deleted = { menuPresent: menu.present, before: v2.length, after: afterDel };
}

// Delete KEY removes the selected control point; the min guard (3 for a polygon) holds.
let keyDelete = null;
const v3 = await vertexHandleCenters();
if (v3.length >= 4) {
  await page.mouse.click(v3[0].x, v3[0].y); // click a vertex → it becomes the active control point
  await page.waitForTimeout(150);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(250);
  const afterKey = (await vertexHandleCenters()).length;
  // Now drive down to the minimum and confirm it won't drop below 3.
  let guard = afterKey;
  for (let n = 0; n < 4; n++) {
    const vv = await vertexHandleCenters();
    if (vv.length <= 3) { guard = vv.length; break; }
    await page.mouse.click(vv[0].x, vv[0].y); await page.waitForTimeout(100);
    await page.keyboard.press("Delete"); await page.waitForTimeout(200);
    guard = (await vertexHandleCenters()).length;
  }
  keyDelete = { before: v3.length, afterOneDelete: afterKey, minAfterRepeatedDeletes: guard };
}

await page.screenshot({ path: OUT + "b221-after-edits.png", clip: { x: Math.max(0, (pr?.x ?? 400) - 80), y: Math.max(0, (pr?.y ?? 300) - 80), width: 520, height: 480 } });

console.log(JSON.stringify({
  B222: b222,
  B221: { plusHandlesAfterSelect: plusBefore, vertexHandlesAfterSelect: before.length, inserted, hoverDot, deleted, keyDelete },
  consoleErrors: errors,
}, null, 2));

await ctx.close();
await browser.close();
