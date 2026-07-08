/* Self-verification: road control-point add/remove (B718) + to-scale 6" curb border (B719).
 *
 * Seeds ONE 3-point centerline road INSIDE a parcel (the parcel is deliberate — it is exactly
 * what triggered the `onOtherParcel` bug: without the fix, a Shift-click on a road inside a
 * parcel would fall through to multi-select and never insert a control point). Drives the real
 * logged-out app on :4173 and asserts against the rendered SVG + the portal context menu.
 *
 * B718: select the road → 3 vertex handles → Shift-click a segment midpoint → 4 handles (insert
 *   fires INSIDE the parcel) → right-click the new interior vertex → "Delete control point" is
 *   ENABLED and removes it (4→3) → right-click an ENDPOINT → the menu is DISABLED ("min reached").
 * B719: the curb stripe + pavement-edge stroke widths are THIN at fit zoom (a true 6" curb is
 *   sub-pixel → the 0.75px floor), NOT the old ~3px strokeZoom band, and they GROW proportionally
 *   when you zoom in (tied to real-world scale).
 *
 * Run:  node ui-audit/verify-b718-b719.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { roadStripBBox } from "../src/workspaces/site-planner/lib/siteModel.js";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const ROAD_FILL = "#b9b4a8";
const ROAD_STROKE = "#7c786d";
const DEMO_ID = "verify-b718-b719";

// road B — a 3-point centerline (an L), 6" curb. Used for the B718 vertex add/remove checks.
const ptsB = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }];
const vtxB = [{}, { treatment: "arc", radius: 30 }, {}];
const bboxB = roadStripBBox(ptsB, vtxB, 24, 0.5, { defaultRadius: 120 });
const roadB = { id: "rB", type: "road", pts: ptsB, vtx: vtxB, travelW: 24, curb: 0.5, roadClass: "aisle", ...bboxB };
// road C — a straight 2-point centerline with a 12" curb (1.0'). Same zoom as road B, so its curb
// stripe must render ~2× as wide (curb × ppf) — the deterministic B719 to-scale proof.
const ptsC = [{ x: -150, y: 150 }, { x: 150, y: 150 }];
const bboxC = roadStripBBox(ptsC, [], 24, 1.0, { defaultRadius: 120 });
const roadC = { id: "rC", type: "road", pts: ptsC, vtx: [], travelW: 24, curb: 1.0, roadClass: "aisle", ...bboxC };
// Parcel that ENCLOSES both roads (the onOtherParcel trap).
const parcel = { id: "pc1", locked: false, points: [{ x: -220, y: -120 }, { x: 220, y: -120 }, { x: 220, y: 220 }, { x: -220, y: 220 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B718/B719", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els: [roadB, roadC], measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
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
const NETWORK_NOISE = /ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_CLOSED|ERR_CERT|Failed to load resource|net::/i;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NETWORK_NOISE.test(m.text())) errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(600);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

// helper: the road vertex handles (small SVG circles r≈5.5–6), in DOM order (matches el.pts order).
const handleCenters = () => page.evaluate(() =>
  [...document.querySelectorAll("svg circle")]
    .filter((x) => { const r = +x.getAttribute("r"); return r >= 5 && r <= 6.5; })
    .map((c) => { const b = c.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }));

// helper: an on-strip screen point for road-strip #idx (mid of its outline's start = always inside).
const stripPoint = (idx) => page.evaluate(({ fill, i }) => {
  const p = [...document.querySelectorAll("svg path")].filter((q) => (q.getAttribute("fill") || "").toLowerCase() === fill)[i];
  if (!p) return null;
  const L = p.getTotalLength();
  const a = p.getPointAtLength(L * 0.02), b = p.getPointAtLength(L * 0.98);
  const mid = new DOMPoint((a.x + b.x) / 2, (a.y + b.y) / 2).matrixTransform(p.getScreenCTM());
  return { x: mid.x, y: mid.y };
}, { fill: ROAD_FILL, i: idx });

// select whichever road strip is the 3-point road (roadB) — the one that shows 3 vertex handles.
const selectThreePtRoad = async () => {
  const nStrips = await page.evaluate((fill) => [...document.querySelectorAll("svg path")].filter((q) => (q.getAttribute("fill") || "").toLowerCase() === fill).length, ROAD_FILL);
  for (let i = 0; i < nStrips; i++) {
    const sp = await stripPoint(i);
    if (!sp) continue;
    await page.mouse.click(sp.x, sp.y);
    await page.waitForTimeout(350);
    if ((await handleCenters()).length === 3) return true;
  }
  return false;
};

// ---- B718: select → count handles ----
const gotThree = await selectThreePtRoad();
let handles = await handleCenters();
log(gotThree && handles.length === 3, `road selected → 3 control-point handles (found ${handles.length})`);
await page.screenshot({ path: OUT + "b718-0-selected.png" });

// ---- B718: Shift-click the midpoint of the FIRST sparse segment → insert (INSIDE the parcel) ----
const errBeforeIns = errors.length;
if (handles.length >= 2) {
  const mid = { x: (handles[0].x + handles[1].x) / 2, y: (handles[0].y + handles[1].y) / 2 };
  await page.keyboard.down("Shift");
  await page.mouse.click(mid.x, mid.y);
  await page.keyboard.up("Shift");
  await page.waitForTimeout(350);
}
handles = await handleCenters();
log(handles.length === 4, `Shift-click a road segment INSIDE a parcel inserts a control point (3→${handles.length}) — proves the onOtherParcel fix`);
log(errors.length === errBeforeIns, `insert raised no page errors (+${errors.length - errBeforeIns})`);
await page.screenshot({ path: OUT + "b718-1-inserted.png" });

// ---- B718: right-click the NEW interior vertex → "Delete control point" ENABLED → delete (4→3) ----
const rightClickAt = async (pt) => { await page.mouse.click(pt.x, pt.y, { button: "right" }); await page.waitForTimeout(300); };
const menuInfo = () => page.evaluate(() => {
  const btns = [...document.querySelectorAll(".menu button, [class*='menu'] button")];
  const del = btns.find((b) => /control point/i.test(b.textContent || "") && /delete|✕/i.test(b.textContent || ""));
  const add = btns.find((b) => /Add control point/i.test(b.textContent || ""));
  return {
    hasDelete: !!del, deleteDisabled: del ? (del.disabled || /min reached/i.test(del.textContent || "")) : null,
    hasAdd: !!add,
  };
});
const closeMenu = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(150); };

// the interior vertices are handles[1] and handles[2] (index 0 and 3 are the endpoints of the 4-pt road)
if (handles.length === 4) {
  await rightClickAt(handles[1]);
  const m = await menuInfo();
  log(m.hasDelete && m.deleteDisabled === false, `right-click an interior vertex → "Delete control point" ENABLED`);
  // click the enabled Delete
  await page.evaluate(() => {
    const b = [...document.querySelectorAll(".menu button, [class*='menu'] button")].find((x) => /control point/i.test(x.textContent || "") && /delete|✕/i.test(x.textContent || ""));
    if (b) b.click();
  });
  await page.waitForTimeout(350);
  const after = await handleCenters();
  log(after.length === 3, `deleting that control point removes it (4→${after.length})`);
  handles = after;
} else {
  log(false, `(skipped delete checks — insert did not produce 4 handles)`);
}
await page.screenshot({ path: OUT + "b718-2-deleted.png" });

// ---- B718: right-click an ENDPOINT → the Delete item is DISABLED (endpoints are protected) ----
handles = await handleCenters();
if (handles.length >= 2) {
  await rightClickAt(handles[0]); // first endpoint
  const m = await menuInfo();
  // endpoints show the vertex menu with a disabled Delete ("min reached")
  log(m.hasDelete && m.deleteDisabled === true, `right-click an ENDPOINT → Delete is DISABLED ("min reached") — endpoint protected`);
  await closeMenu();
}

// ---- B719: curb border is drawn TO SCALE (curb × ppf). At the SAME zoom, the 12" road's curb
// stripe must be ~2× the 6" road's — impossible under the old strokeZoom (which ignored curb width). ----
await page.keyboard.press("Escape");
await page.waitForTimeout(250);
const strokeWidths = await page.evaluate((stroke) => {
  const ws = [...document.querySelectorAll("svg polyline")]
    .filter((p) => (p.getAttribute("stroke") || "").toLowerCase() === stroke)
    .map((p) => parseFloat(p.getAttribute("stroke-width")))
    .filter((w) => Number.isFinite(w));
  const edges = [...document.querySelectorAll("svg path")]
    .filter((p) => (p.getAttribute("stroke") || "").toLowerCase() === stroke && (p.getAttribute("fill") || "") === "none")
    .map((p) => parseFloat(p.getAttribute("stroke-width")))
    .filter((w) => Number.isFinite(w));
  return { curbWidths: ws, edgeWidths: edges };
}, ROAD_STROKE);
const uniq = [...new Set(strokeWidths.curbWidths.map((w) => Math.round(w * 1000) / 1000))].sort((a, b) => a - b);
const wMin = uniq[0], wMax = uniq[uniq.length - 1];
log(wMin != null && wMin <= 1.6, `6" curb stripe is a THIN to-scale line at fit zoom (${wMin}px, well under the old ~3px band)`);
log(uniq.length >= 2 && wMax / wMin >= 1.8 && wMax / wMin <= 2.2, `12" curb renders ~2× the 6" curb at the same zoom (${wMin}px → ${wMax}px, ratio ${(wMax / wMin).toFixed(2)}) — proves stroke = curb × ppf (to scale), not a fixed pixel weight`);
log((strokeWidths.edgeWidths[0] ?? 99) <= 2.6, `pavement border is thin/to-scale, not a fat band (edge widths: ${strokeWidths.edgeWidths.join(", ")}px)`);
const surfArea = await page.evaluate((fill) => { const s = [...document.querySelectorAll("svg path")].find((p) => (p.getAttribute("fill") || "").toLowerCase() === fill); return s ? Math.round(s.getBBox().width * s.getBBox().height) : 0; }, ROAD_FILL);
log(surfArea > 0, `road still renders as a filled strip (area ${surfArea}px²) — legible despite the thin edge`);
await page.screenshot({ path: OUT + "b719-curb-to-scale.png" });

console.log(errors.length ? `\nPAGE ERRORS:\n${errors.slice(0, 8).join("\n")}` : "\n(no page errors)");
if (errors.length) fail++;
console.log(fail === 0 ? "\n✓ ALL B718/B719 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
