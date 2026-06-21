/* Verification for B310 (parcel click-vs-drag) + B311 ("Select parcels" toggle).
 *
 * B310: on the planner canvas, a press on a (locked) parcel that DRAGS pans the map and does
 *       NOT select; a press that's a real CLICK (tiny travel, brief) DOES select. Panning
 *       across parcels no longer mis-fires as a selection.
 * B311: a Row-2 toolbar toggle ("Select parcels"); default ON. When OFF, a click never selects
 *       a parcel (pure browse). The setting persists per project across a reload.
 *
 * Logged-out against the built app (vite preview on :4173). Seeds a single LOCKED parcel — the
 * default every county-pulled / drawn lot carries. Selected parcel = stroke #c2410c (width 3);
 * unselected = stroke #5b6650 (width 2).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const parcel = { id: "pc1", locked: true, points: [{ x: -440, y: -200 }, { x: 440, y: -200 }, { x: 440, y: 320 }, { x: -440, y: 320 }] };
const demoSite = {
  id: "uiaudit-b310", groupId: "uiaudit-b310", site: "Parcel Gesture Demo", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), data: { status: "active" },
};
// Conditional seed: only write if absent, so a page RELOAD keeps the autosaved (toggled) state
// instead of clobbering it — that's what lets the B311 persistence check work.
const seed = `(() => { try {
  if (!localStorage.getItem('planarfit:currentSite:v1')) {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${demoSite.id}': ${JSON.stringify(demoSite)} }));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoSite.id)});
  }
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

const fit = async () => { try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch {} await page.waitForTimeout(700); };
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1700);
await fit();

// The parcel polygon, its on-screen box, and whether it's selected (stroke #c2410c / width 3).
const parcelInfo = () => page.evaluate(() => {
  const svg = document.querySelector('svg[aria-label="Site plan canvas"]');
  if (!svg) return null;
  const p = [...svg.querySelectorAll("polygon")].find((el) => {
    const s = (el.getAttribute("stroke") || "").toLowerCase();
    return s === "#5b6650" || s === "#c2410c";
  });
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return {
    stroke: (p.getAttribute("stroke") || "").toLowerCase(),
    strokeWidth: p.getAttribute("stroke-width"),
    selected: (p.getAttribute("stroke") || "").toLowerCase() === "#c2410c",
    cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height, top: r.y,
  };
});
// Target MY planner toggle specifically: it carries aria-pressed (true/false) and is visible.
// (MapFinder's dashboard "＋ Select parcels" mode button matches the text too but has no
// aria-pressed and is in the hidden/unmounted dashboard view.)
const findToggle = (x) => {
  const p = x.getAttribute("aria-pressed");
  return (p === "true" || p === "false") && /Select parcels/.test(x.textContent || "") && x.offsetParent !== null;
};
const toggleState = () => page.evaluate((src) => {
  const fn = new Function("x", "return (" + src + ")(x)");
  const b = [...document.querySelectorAll("button")].find((x) => fn(x));
  return b ? { present: true, text: b.textContent.trim(), pressed: b.getAttribute("aria-pressed") } : { present: false };
}, findToggle.toString());
const clickToggle = () => page.evaluate((src) => {
  const fn = new Function("x", "return (" + src + ")(x)");
  const b = [...document.querySelectorAll("button")].find((x) => fn(x));
  b && b.click();
}, findToggle.toString());
// A point inside the parcel but ABOVE its centre, dodging the draggable acreage chip at the centroid.
const clickPt = (pc) => ({ x: pc.cx, y: pc.top + pc.h * 0.25 });
const deselect = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(250); };

const result = { errors: [] };

// ── Test A — a CLICK (zero travel) selects ────────────────────────────────
result.toggleDefault = await toggleState();        // should be present + pressed=true
await deselect();                                  // the lone-parcel auto-select (SitePlanner L~1520) fires on load — clear it first
let pc = await parcelInfo();
result.unselectedBeforeClick = pc && !pc.selected; // stroke #5b6650 / width 2
{
  const p = clickPt(pc);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
  const after = await parcelInfo();
  result.clickSelects = { selected: after?.selected, strokeWidth: after?.strokeWidth };
}
await page.screenshot({ path: OUT + "b310-click-selected.png", clip: { x: Math.max(0, (pc?.cx ?? 700) - 260), y: Math.max(0, (pc?.top ?? 250) - 40), width: 540, height: 460 } });

// ── Test B — a DRAG pans and does NOT select ──────────────────────────────
await deselect();
pc = await parcelInfo();
result.deselected = pc && !pc.selected;
{
  const p = clickPt(pc);
  const cxBefore = pc.cx;
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 95, p.y, { steps: 12 });   // drag right 95px (>> 5px slop)
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await parcelInfo();
  result.dragPansNoSelect = {
    selectedAfterDrag: after?.selected,                  // expect false
    strokeWidth: after?.strokeWidth,                     // expect "2"
    panShiftPx: after ? Math.round(after.cx - cxBefore) : null, // expect ~+95 (it panned)
  };
}
await page.screenshot({ path: OUT + "b310-drag-panned.png", clip: { x: 0, y: 60, width: 1440, height: 700 } });

// ── Test C — B311 toggle OFF → a click never selects ──────────────────────
await fit(); await deselect();
await clickToggle();                                      // turn Select parcels OFF
await page.waitForTimeout(200);
result.toggleOff = await toggleState();                   // text "...: off", pressed=false
pc = await parcelInfo();
{
  const p = clickPt(pc);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
  const after = await parcelInfo();
  result.offClickDoesNotSelect = { selected: after?.selected, strokeWidth: after?.strokeWidth }; // expect false / "2"
}

// ── Test D — toggle ON again → a click selects again ──────────────────────
await clickToggle();
await page.waitForTimeout(200);
result.toggleOnAgain = await toggleState();
pc = await parcelInfo();
{
  const p = clickPt(pc);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
  const after = await parcelInfo();
  result.onClickSelectsAgain = { selected: after?.selected, strokeWidth: after?.strokeWidth };
}

// ── Test E — the OFF setting persists per project across a reload ──────────
await deselect();
await clickToggle();                                      // OFF again
await page.waitForTimeout(900);                           // let the 400ms-debounced autosave write settings
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1700);
result.persistedAfterReload = await toggleState();        // expect text "...: off", pressed=false

// Page JS errors only — the GIS-host CORS failures are environmental (sandbox egress policy).
const realErrors = errors.filter((e) => !/CORS|Access to fetch|Failed to load resource|ERR_FAILED/.test(e));

result.checks = {
  "B310 click selects (deselected → click)": result.unselectedBeforeClick === true && result.clickSelects?.selected === true,
  "B310 drag pans, does NOT select": result.dragPansNoSelect?.selectedAfterDrag === false && Math.abs((result.dragPansNoSelect?.panShiftPx ?? 0) - 95) <= 18,
  "B311 toggle default ON": result.toggleDefault?.present === true && result.toggleDefault?.pressed === "true",
  "B311 OFF → click never selects": result.toggleOff?.pressed === "false" && result.offClickDoesNotSelect?.selected === false,
  "B311 ON again → click selects": result.toggleOnAgain?.pressed === "true" && result.onClickSelectsAgain?.selected === true,
  "B311 OFF persists across reload": result.persistedAfterReload?.pressed === "false",
  "no page JS errors": realErrors.length === 0,
};
result.PASS = Object.values(result.checks).every(Boolean);
result.realErrors = realErrors;
delete result.errors;
console.log(JSON.stringify(result, null, 2));
console.log(result.PASS ? "\n✅ ALL CHECKS PASSED" : "\n❌ SOME CHECKS FAILED");

await ctx.close();
await browser.close();
