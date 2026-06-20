/* Self-verification for B228 + B229 — building-anchored dock-zone stack (truck court →
 * trailer parking → buffer) with a LIFO "+/−" and inline depths, driven from the Dock
 * features panel. Seeds a cross-dock building, boots the planner logged-out, selects the
 * building, then:
 *   1. clicks the stack "+" three times → court, then trailer parking, then buffer appear
 *      on BOTH long (dock) sides, stacked OUTWARD (court nearest the wall, buffer farthest);
 *   2. edits the buffer depth inline → the buffer band grows;
 *   3. clicks the LIFO "−" three times → buffer, then trailer, then court peel back off.
 * Element types are read off the canvas by their plan-style fills:
 *   building #f3ece1 · court(paving) #d6d1c7 · trailer #e3d4b2 · buffer(landscape) #bcd3a6 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const DEMO_ID = "verify-dock";
const els = [
  // 600' × 300' cross-dock building at the origin → long sides are top & bottom (both dock).
  { id: "b1", type: "building", cx: 0, cy: 0, w: 600, h: 300, rot: 0, dock: "cross" },
];
const parcel = { id: "pc1", locked: false, points: [{ x: -800, y: -560 }, { x: 800, y: -560 }, { x: 800, y: 560 }, { x: -800, y: 560 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify Dock Zones", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
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
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(500);

// --- canvas readers (by plan-style fill, restricted to the drawing area x>260, size>15px) ---
const FILL = { "#d6d1c7": "court", "#e3d4b2": "trailer", "#bcd3a6": "buffer" };
const zones = () => page.evaluate(() => {
  const FILL = { "#f3ece1": "building", "#d6d1c7": "court", "#e3d4b2": "trailer", "#bcd3a6": "buffer" };
  const out = [];
  for (const r of document.querySelectorAll("svg rect")) {
    const fill = (r.getAttribute("fill") || "").toLowerCase();
    if (!FILL[fill]) continue;
    const b = r.getBoundingClientRect();
    if (b.width < 15 || b.height < 4 || b.x < 260) continue;
    out.push({ kind: FILL[fill], cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height });
  }
  return out;
});
const counts = async () => {
  const z = await zones();
  return z.reduce((m, e) => ((m[e.kind] = (m[e.kind] || 0) + 1), m), { building: 0, court: 0, trailer: 0, buffer: 0 });
};

// --- click a visible <button> whose trimmed text matches `re` (returns the text) ---
const clickBtn = async (re, { optional = false } = {}) => {
  const btns = page.locator("button:visible");
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const t = ((await btns.nth(i).textContent()) || "").trim();
    if (re.test(t)) { await btns.nth(i).click(); await page.waitForTimeout(280); return t; }
  }
  if (optional) return null;
  throw new Error("button not found: " + re);
};

// select the building by clicking inside its rect (offset off-centre so we don't land
// on the centred dock-door marks / label at the exact middle)
const bsel = await page.evaluate(() => {
  const r = [...document.querySelectorAll("svg rect")].find((x) => (x.getAttribute("fill") || "").toLowerCase() === "#f3ece1");
  if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x + b.width * 0.35, y: b.y + b.height * 0.4 };
});
if (!bsel) { console.log("✗ building rect not found"); process.exit(1); }
await page.mouse.click(bsel.x, bsel.y);
await page.waitForTimeout(400);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const c0 = await counts();
log(c0.building >= 1 && c0.court === 0 && c0.trailer === 0 && c0.buffer === 0, `initial: ${JSON.stringify(c0)}`);

// 1) walk the stack OUT: court → trailer → buffer (cross-dock → 2 of each)
const a1 = await clickBtn(/^＋ Add /); console.log("  click:", a1);
const c1 = await counts();
log(c1.court === 2 && c1.trailer === 0 && c1.buffer === 0, `after +1 (truck court): ${JSON.stringify(c1)}`);

const a2 = await clickBtn(/^＋ Add /); console.log("  click:", a2);
const c2 = await counts();
log(c2.court === 2 && c2.trailer === 2 && c2.buffer === 0, `after +2 (trailer parking): ${JSON.stringify(c2)}`);

const a3 = await clickBtn(/^＋ Add /); console.log("  click:", a3);
const c3 = await counts();
log(c3.court === 2 && c3.trailer === 2 && c3.buffer === 2, `after +3 (buffer): ${JSON.stringify(c3)}`);
await page.screenshot({ path: OUT + "dock-zones-full.png" });

// outward order on the TOP dock side (screen-up = smaller y): court nearest the wall
// (largest y), buffer farthest (smallest y), trailer between.
const z3 = await zones();
const bldg = z3.find((e) => e.kind === "building");
const top = z3.filter((e) => e.kind !== "building" && e.cy < bldg.cy && Math.abs(e.cx - bldg.cx) < bldg.w).sort((p, q) => q.cy - p.cy);
const order = top.map((e) => e.kind);
log(order.length === 3 && order[0] === "court" && order[1] === "trailer" && order[2] === "buffer",
  `top-side outward order (wall→out): ${JSON.stringify(order)}`);
const bufferTopH = (top[2] || {}).h || 0;

// "+" should now be disabled (all three zones present)
const fullDisabled = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /All zones/.test(x.textContent || ""));
  return !!b && b.disabled;
});
log(fullDisabled, `"+" reads "All zones" and is disabled at full stack: ${fullDisabled}`);

// 2) inline depth edit — the buffer row shows 15; bump it to 40 → the band grows.
// (NumInput commits on blur reading React state, so drive it with real keystrokes.)
const inpBox = await page.evaluate(() => {
  const ins = [...document.querySelectorAll("input")].filter((i) => i.value === "15");
  if (!ins.length) return null;
  const i = ins[ins.length - 1], b = i.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
let edited = false;
if (inpBox) {
  await page.mouse.click(inpBox.x, inpBox.y);
  await page.keyboard.press("Control+A");
  await page.keyboard.type("40");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  edited = true;
}
const z4 = await zones();
const bldg4 = z4.find((e) => e.kind === "building");
const top4 = z4.filter((e) => e.kind === "buffer" && e.cy < bldg4.cy).sort((p, q) => p.cy - q.cy);
const bufferNewH = (top4[0] || {}).h || 0;
log(edited && bufferNewH > bufferTopH + 4, `buffer depth edit 15→40 grew the band: ${bufferTopH.toFixed(0)}px → ${bufferNewH.toFixed(0)}px`);
await page.screenshot({ path: OUT + "dock-zones-deepbuffer.png" });

// 2b) building RESIZE re-lays the stack (exercises refitChildren): widen 600→760 via the
// Width field; zones must stay present, full-width, and flush-outward.
const wBox = await page.evaluate(() => {
  const i = [...document.querySelectorAll("input")].find((x) => x.value === "600");
  if (!i) return null; const b = i.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
if (wBox) {
  await page.mouse.click(wBox.x, wBox.y);
  await page.keyboard.press("Control+A"); await page.keyboard.type("760"); await page.keyboard.press("Enter");
  await page.waitForTimeout(450);
}
const cR = await counts();
const zR = await zones();
const bR = zR.find((e) => e.kind === "building");
const topR = zR.filter((e) => e.kind !== "building" && e.cy < bR.cy && Math.abs(e.cx - bR.cx) < bR.w).sort((p, q) => q.cy - p.cy);
const orderR = topR.map((e) => e.kind);
const courtWide = (topR[0] || {}).w || 0;
log(cR.court === 2 && cR.trailer === 2 && cR.buffer === 2 && JSON.stringify(orderR) === JSON.stringify(["court", "trailer", "buffer"]) && courtWide > bR.w * 0.9,
  `after building resize 600→760: zones intact + flush + full-width ${JSON.stringify(cR)} order=${JSON.stringify(orderR)}`);

// 3) LIFO "−": buffer → trailer → court
const r1 = await clickBtn(/^－ Remove /); console.log("  click:", r1);
const d1 = await counts();
log(d1.buffer === 0 && d1.trailer === 2 && d1.court === 2, `after −1 (buffer off): ${JSON.stringify(d1)}`);

const r2 = await clickBtn(/^－ Remove /); console.log("  click:", r2);
const d2 = await counts();
log(d2.buffer === 0 && d2.trailer === 0 && d2.court === 2, `after −2 (trailer off): ${JSON.stringify(d2)}`);

const r3 = await clickBtn(/^－ Remove /); console.log("  click:", r3);
const d3 = await counts();
log(d3.buffer === 0 && d3.trailer === 0 && d3.court === 0, `after −3 (court off): ${JSON.stringify(d3)}`);

// car parking (ends) — its own control, outside the stack
const carAdd = await clickBtn(/^＋ Car parking/, { optional: true });
await page.waitForTimeout(300);
const parkCount = await page.evaluate(() => [...document.querySelectorAll("svg rect")].filter((r) => (r.getAttribute("fill") || "").toLowerCase() === "#cdd7dd" && r.getBoundingClientRect().width > 10).length);
log(!!carAdd && parkCount >= 1, `car parking (ends) adds a parking field (${parkCount})`);

console.log(errors.length ? `\nPAGE ERRORS:\n${errors.slice(0, 8).join("\n")}` : "\n(no page errors)");
console.log(fail === 0 ? "\n✓ ALL DOCK-ZONE CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
