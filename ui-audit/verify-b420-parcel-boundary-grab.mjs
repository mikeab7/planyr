/* Verification for B420 — a parcel grabs ONLY by its boundary edge or its setback line, never by
 * its empty interior (free the interior for building work).
 *
 * Owner repro: in Select mode, clicking anywhere inside a lot's interior used to select the parcel
 * and pop its menu, even when you were trying to edit a building sitting in that lot. Expected: the
 * interior is click-through — a press there falls to the background (pan/deselect), exactly as on
 * empty canvas; only the boundary edge or the setback line grabs the lot.
 *
 * Logged-out against the built app (vite preview on :4173). Seeds ONE large LOCKED parcel (the
 * default every county-pulled / drawn lot carries) WITH a 25 ft setback so the setback line renders.
 * Selected parcel = stroke #C2410C; unselected = stroke #5b6650 (light theme). Setback line = #b45309.
 *
 * Run: BASE_URL=http://localhost:4173/ node ui-audit/verify-b420-parcel-boundary-grab.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Big rectangle so the interior, the setback ring, and the boundary are well separated on screen.
const parcel = { id: "pc1", locked: true, points: [{ x: -440, y: -200 }, { x: 440, y: -200 }, { x: 440, y: 320 }, { x: -440, y: 320 }] };
const demoSite = {
  id: "uiaudit-b420", groupId: "uiaudit-b420", site: "Parcel Hit-Area Demo", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [],
  settings: { showSetback: true, setback: 25 }, underlay: null,
  updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${demoSite.id}': ${JSON.stringify(demoSite)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoSite.id)});
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

// The visible parcel polygon (stroke #5b6650 unselected / #C2410C selected — NOT the transparent
// fat hit-stroke, which is rgba(0,0,0,0.001)). Returns its on-screen box + whether it's selected.
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
    selected: (p.getAttribute("stroke") || "").toLowerCase() === "#c2410c",
    strokeWidth: p.getAttribute("stroke-width"),
    cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height, top: r.y, left: r.x,
  };
});
// The visible setback line (dashed, stroke #b45309).
const setbackInfo = () => page.evaluate(() => {
  const svg = document.querySelector('svg[aria-label="Site plan canvas"]');
  if (!svg) return null;
  const p = [...svg.querySelectorAll('polygon[stroke-dasharray="7 6"]')].find((el) => (el.getAttribute("stroke") || "").toLowerCase() === "#b45309");
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height, top: r.y };
});
const menuOpen = () => page.evaluate(() => !![...document.querySelectorAll("button")].find((b) => /Merge parcels/i.test(b.textContent || "")));
const closeMenu = async () => { await page.keyboard.press("Escape"); await page.mouse.click(8, 8); await page.waitForTimeout(150); };
const deselect = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(250); };

const result = { errors: [] };
await deselect(); // clear the lone-parcel auto-select that fires on load

// Geometry helpers (computed from the live on-screen box each time, so zoom-independent).
const interiorPt = (pc) => ({ x: pc.cx, y: pc.top + pc.h * 0.30 }); // inboard of the setback ring, above the centroid acreage chip
const boundaryPt = (pc) => ({ x: pc.cx, y: pc.top + 3 });           // on the top boundary hit-stroke
const setbackPt = (sb) => ({ x: sb.cx, y: sb.top + 2 });            // on the setback line hit-stroke

// ── Test A — clicking the EMPTY INTERIOR does NOT select (the core fix) ─────
{
  let pc = await parcelInfo();
  result.unselectedBefore = pc && !pc.selected;
  const p = interiorPt(pc);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
  const after = await parcelInfo();
  result.interiorDoesNotSelect = { selected: after?.selected, strokeWidth: after?.strokeWidth }; // expect false / "2"
  await page.screenshot({ path: OUT + "b420-interior-click.png", clip: { x: Math.max(0, (pc?.left ?? 400) - 20), y: Math.max(0, (pc?.top ?? 200) - 20), width: Math.min(900, (pc?.w ?? 600) + 40), height: Math.min(700, (pc?.h ?? 500) + 40) } });
}

// ── Test B — clicking the BOUNDARY edge DOES select ────────────────────────
await deselect();
{
  let pc = await parcelInfo();
  const p = boundaryPt(pc);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
  const after = await parcelInfo();
  result.boundarySelects = { selected: after?.selected, strokeWidth: after?.strokeWidth }; // expect true / "3"
  await page.screenshot({ path: OUT + "b420-boundary-click.png", clip: { x: Math.max(0, (pc?.left ?? 400) - 20), y: Math.max(0, (pc?.top ?? 200) - 40), width: Math.min(900, (pc?.w ?? 600) + 40), height: Math.min(700, (pc?.h ?? 500) + 60) } });
}

// ── Test C — clicking the SETBACK line DOES select (owner: "boundary OR setback") ──
await deselect();
{
  const sb = await setbackInfo();
  result.setbackLineRendered = !!sb;
  if (sb) {
    const p = setbackPt(sb);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(300);
    const after = await parcelInfo();
    result.setbackSelects = { selected: after?.selected, strokeWidth: after?.strokeWidth }; // expect true / "3"
  }
}

// ── Test D — right-click parity: interior opens NO menu; boundary opens the parcel menu ──
await deselect(); await closeMenu();
{
  let pc = await parcelInfo();
  const i = interiorPt(pc);
  await page.mouse.click(i.x, i.y, { button: "right" });
  await page.waitForTimeout(250);
  result.interiorNoMenu = !(await menuOpen()); // expect true (no menu from the interior)
  await closeMenu();

  pc = await parcelInfo();
  const b = boundaryPt(pc);
  await page.mouse.click(b.x, b.y, { button: "right" });
  await page.waitForTimeout(250);
  result.boundaryOpensMenu = await menuOpen(); // expect true
  await closeMenu();
}

// ── Test E — pressing-and-DRAGGING in the interior PANS, never grabs the parcel for a move ──
// Distinct from Test A's click: a press in the open interior that then drags must fall through to
// the background pan, not start a parcel move/select — proves the interior is fully click-through.
await fit(); await deselect();
{
  const pc = await parcelInfo();
  const i = interiorPt(pc);
  const cxBefore = pc.cx;
  await page.mouse.move(i.x, i.y);
  await page.mouse.down();
  await page.mouse.move(i.x + 95, i.y, { steps: 12 }); // drag right 95px (>> click slop)
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await parcelInfo();
  result.interiorDragPans = {
    selected: after?.selected,                                  // expect false (never selected)
    panShiftPx: after ? Math.round(after.cx - cxBefore) : null, // expect ~+95 (the map panned with the parcel)
  };
}

// Page JS errors only — GIS-host CORS failures are environmental (sandbox egress policy).
const realErrors = errors.filter((e) => !/CORS|Access to fetch|Failed to load resource|ERR_FAILED|net::/.test(e));

result.checks = {
  "interior click does NOT select (interior is click-through)": result.unselectedBefore === true && result.interiorDoesNotSelect?.selected === false,
  "boundary edge click DOES select": result.boundarySelects?.selected === true,
  "setback line rendered": result.setbackLineRendered === true,
  "setback line click DOES select": result.setbackSelects?.selected === true,
  "right-click interior opens NO parcel menu": result.interiorNoMenu === true,
  "right-click boundary opens the parcel menu": result.boundaryOpensMenu === true,
  "interior DRAG pans, never grabs the parcel": result.interiorDragPans?.selected === false && Math.abs((result.interiorDragPans?.panShiftPx ?? 0) - 95) <= 18,
  "no page JS errors": realErrors.length === 0,
};
result.PASS = Object.values(result.checks).every(Boolean);
result.realErrors = realErrors;
delete result.errors;
console.log(JSON.stringify(result, null, 2));
console.log(result.PASS ? "\n✅ ALL CHECKS PASSED" : "\n❌ SOME CHECKS FAILED");

await ctx.close();
await browser.close();
process.exit(result.PASS ? 0 : 1);
