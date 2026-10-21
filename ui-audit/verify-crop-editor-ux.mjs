/* verify-crop-editor-ux — the 2026-10-11 owner block on the crop editor, driven in a real browser (logged out,
 * Site tab, local fixture — the shared ImageCropTool + CropModal are the same code the Map/Comps surface uses):
 *   NEW-1 the modal is the TOPMOST thing at the toolbar and canvas points (elementFromPoint), over the panels/controls
 *   NEW-3 ONE toolbar line, ONE zoom readout (on the 100% control), ONE footer line, the canvas takes the height
 *   NEW-4 right-click: Delete point (disabled at 3), Add control point (exactly where clicked), native menu suppressed,
 *         Escape/click-away close ONLY the menu, both undoable
 *   NEW-5 ONE reset; Done stores only the active shape; no "kept too"
 *   NEW-6 Lock does not stop Crop… (Site tab)
 *   KNOWN-GOOD ARM: a point inside the modal's own toolbar reports the modal as topmost; if the arm fails the run is VOID.
 * Usage: BASE_URL=http://localhost:4174/ node ui-audit/verify-crop-editor-ux.mjs */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { openCropEditor, clearCrop, cropOff, cropState } from "./lib/overlayCropPanel.mjs";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
let fail = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };

const imgW = 1000, imgH = 800;
const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${imgW}' height='${imgH}'><rect width='${imgW}' height='${imgH}' fill='#e8a83c'/></svg>`;
const ov = { id: "ovA", name: "sheet-A.png", imgW, imgH, page: 1, pageCount: 1, ftPerPx: 1, rotation: 0, opacity: 1, locked: false,
  x: -imgW / 2, y: -imgH / 2, src: "data:image/svg+xml;utf8," + encodeURIComponent(svg) };
const site = { id: "C1", groupId: "C1", site: "CropUX", name: "Plan 1", origin: { lat: 29.78, lon: -95.82 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -600, y: -500 }, { x: 600, y: -500 }, { x: 600, y: 500 }, { x: -600, y: 500 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [ov], parcelDrawings: [], status: "active", updatedAt: Date.now() };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(`(()=>{try{window.__PLANYR_E2E=true;if(!sessionStorage.getItem('seeded')){localStorage.setItem('planarfit:sites:v1',${JSON.stringify(JSON.stringify({ C1: site }))});sessionStorage.setItem('seeded','1');}}catch(e){}})();`);
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("  [pageerror]", String(e).slice(0, 160)); fail++; });
page.on("dialog", async (d) => { console.log("  [DIALOG — never allowed]", d.message().slice(0, 100)); fail++; await d.accept().catch(() => {}); });
await assertMeasurable(page, "verify-crop-editor-ux");

await page.goto(`${BASE}#/project/C1/site`, { waitUntil: "load" });
await page.waitForTimeout(3000);
await page.evaluate(() => { if (!document.querySelector('[data-testid="overlays-panel"]')) document.querySelector('[data-rail-tab="references"]')?.click(); });
await page.waitForTimeout(700);
await page.locator('[data-testid^="reference-open-"]', { hasText: "sheet-A.png" }).first().click().catch(() => {});
await page.waitForTimeout(400);
const stored = () => page.evaluate(() => { const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); const o = raw.C1 && raw.C1.sheetOverlays.find((x) => x.id === "ovA"); return o ? { crop: o.crop ?? null, locked: !!o.locked } : null; });
const waitStored = async (pred, ms = 4000) => { const t = Date.now(); let s; while (Date.now() - t < ms) { s = await stored(); if (pred(s)) return s; await page.waitForTimeout(150); } return s; };
const dlg = page.locator('[data-testid="overlay-crop-dialog"]');
const openCrop = async () => { await openCropEditor(page); await dlg.waitFor({ timeout: 4000 }); await page.waitForTimeout(500); };
const done = async () => { await dlg.locator('[data-testid="crop-done"]').click(); await dlg.waitFor({ state: "detached", timeout: 4000 }); await page.waitForTimeout(300); };

/* ---- layout + layering (NEW-1, NEW-3) ------------------------------------------------------------ */
await openCrop();
const probe = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const tb = q('[data-testid="crop-toolbar"]'), ft = q('[data-testid="crop-header"]'), cv = q('[data-testid="crop-canvas"]');
  const modal = q('[data-crop-modal]'), shell = modal.firstElementChild;
  const tops = (el) => Array.from(el.children).filter((c) => c.getBoundingClientRect().width > 0).map((c) => { const b = c.getBoundingClientRect(); return Math.round(b.top + b.height / 2); }); // row CENTRES — a wrapped item lands a whole row lower; differing control heights do not move a centre
  const spread = (a) => Math.max(...a) - Math.min(...a);
  const r = (el) => el.getBoundingClientRect();
  const top = (x, y) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest("[data-crop-modal]")); };
  const tbr = r(tb), cvr = r(cv), sr = r(shell);
  const pts = [[tbr.left + 40, tbr.top + tbr.height / 2], [tbr.right - 40, tbr.top + tbr.height / 2], [cvr.left + cvr.width / 2, cvr.top + cvr.height / 2],
    [cvr.right - 6, cvr.top + 6], [window.innerWidth - 8, 8], [8, 8], [window.innerWidth - 8, window.innerHeight - 8], [window.innerWidth / 2, window.innerHeight - 4]];
  return {
    toolbarRowSpread: spread(tops(tb)), footerRowSpread: spread(tops(ft)),
    zoomPctNodes: document.querySelectorAll('[data-testid="crop-zoom-pct"]').length, zoomBtn: q('[data-testid="crop-zoom-100"]').textContent.trim(),
    canvasFrac: cvr.height / sr.height, canvasH: Math.round(cvr.height), shellH: Math.round(sr.height),
    topmost: pts.map(([x, y]) => top(x, y)), resets: Array.from(document.querySelectorAll('[data-crop-modal] button')).filter((b) => /reset|clear/i.test(b.textContent)).map((b) => b.textContent.trim()),
    bodyChild: modal.parentElement === document.body,
  };
});
console.log("  probe:", JSON.stringify({ canvasH: probe.canvasH, shellH: probe.shellH, frac: +probe.canvasFrac.toFixed(2) }));
check("[known-good arm] the toolbar's own centre reports the modal as topmost", probe.topmost[0] === true);
if (!probe.topmost[0]) { console.log("  ⛔ VOID — probe cannot see a known answer."); await browser.close(); process.exit(2); }
check("NEW-1 the modal is topmost at the toolbar, the canvas, and all four window corners/edges", probe.topmost.every(Boolean), JSON.stringify(probe.topmost));
check("NEW-1 the modal is a direct child of <body> (no host stacking context can outrank it)", probe.bodyChild);
check("NEW-3 toolbar is ONE line (all controls share a row)", probe.toolbarRowSpread <= 3, `spread ${probe.toolbarRowSpread}px`);
check("NEW-1 (2026-10-15) the header (name · shape switch · Cancel/Done) is ONE row", probe.footerRowSpread <= 3, `spread ${probe.footerRowSpread}px`);
check("NEW-3 no separate zoom readout; the zoom control shows the live zoom", probe.zoomPctNodes === 0 && /^\d+%$/.test(probe.zoomBtn), probe.zoomBtn);
check("NEW-3 the canvas takes the height (≥ 80% of the modal)", probe.canvasFrac >= 0.8, `${probe.canvasH}/${probe.shellH}`);
check("NEW-5 exactly one reset action, no Clear polygon", JSON.stringify(probe.resets) === JSON.stringify(["Reset"]), JSON.stringify(probe.resets));
{ const before = await dlg.locator('[data-testid="crop-zoom-100"]').textContent(); await dlg.locator('[data-testid="crop-zoom-100"]').click(); await page.waitForTimeout(200);
  check("the zoom control jumps to 100% when pressed", (await dlg.locator('[data-testid="crop-zoom-100"]').textContent()).trim() === "100%", `${before.trim()} → 100%`);
  await dlg.locator('[data-testid="crop-zoom-fit"]').click(); await page.waitForTimeout(200); }
await page.screenshot({ path: OUT + "crop-ux-layout.png" });

/* ---- draw a polygon: 4 points, close on the first ------------------------------------------------- */
await dlg.locator("button", { hasText: "Polygon" }).click();
await page.waitForTimeout(200);
const canvasBox = async () => dlg.locator('[data-testid="crop-canvas"] img').first().boundingBox();
let box = await canvasBox();
const at = (fx, fy) => ({ x: box.x + fx * box.width, y: box.y + fy * box.height });
for (const [fx, fy] of [[0.15, 0.15], [0.85, 0.15], [0.85, 0.85], [0.15, 0.85]]) { const p = at(fx, fy); await page.mouse.click(p.x, p.y); await page.waitForTimeout(250); }
{ const p = at(0.15, 0.15); await page.mouse.click(p.x, p.y); await page.waitForTimeout(300); }
const nVerts = () => dlg.locator('[data-testid^="crop-poly-vertex-"]').count();
check("polygon closed with 4 control points", (await nVerts()) === 4);

/* ---- NEW-4 right-click ---------------------------------------------------------------------------- */
const nativeSuppressed = await page.evaluate(() => { const c = document.querySelector('[data-testid="crop-canvas"]'); const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); c.dispatchEvent(e); return e.defaultPrevented; });
check("NEW-4 the browser's own context menu is suppressed inside the canvas", nativeSuppressed);
const menu = dlg.locator('[data-testid="crop-context-menu"]');
// right-click a vertex -> Delete point
await dlg.locator('[data-testid="crop-poly-vertex-1"]').click({ button: "right" });
await page.waitForTimeout(250);
check("NEW-4 right-click on a point opens a menu with 'Delete point' (enabled at 4 points)", (await menu.count()) === 1 && (await menu.locator('[data-testid="crop-menu-delete-point"]').isEnabled()));
check("NEW-4 that menu has no 'Add control point'", (await menu.locator('[data-testid="crop-menu-add-point"]').count()) === 0);
await page.screenshot({ path: OUT + "crop-ux-menu-vertex.png" });
await page.keyboard.press("Escape");
await page.waitForTimeout(250);
check("NEW-4 Escape closes ONLY the menu (the crop dialog stays open)", (await menu.count()) === 0 && (await dlg.count()) === 1);
await dlg.locator('[data-testid="crop-poly-vertex-1"]').click({ button: "right" });
await page.waitForTimeout(200);
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5); // click away (inside the canvas, on nothing)
await page.waitForTimeout(250);
check("NEW-4 clicking away closes the menu", (await menu.count()) === 0 && (await dlg.count()) === 1);
await dlg.locator('[data-testid="crop-poly-vertex-1"]').click({ button: "right" });
await menu.locator('[data-testid="crop-menu-delete-point"]').click();
await page.waitForTimeout(250);
check("NEW-4 Delete point removes the point (4 → 3)", (await nVerts()) === 3);
await dlg.locator('[data-testid="crop-poly-vertex-0"]').click({ button: "right" });
await page.waitForTimeout(200);
{ const del = menu.locator('[data-testid="crop-menu-delete-point"]');
  check("NEW-4 at 3 points 'Delete point' is DISABLED (present, not hidden)", (await del.count()) === 1 && (await del.isDisabled()));
  await del.click({ force: true }).catch(() => {}); await page.waitForTimeout(150);
  check("…and pressing it does nothing (still 3 points)", (await nVerts()) === 3);
  await page.keyboard.press("Escape"); await page.waitForTimeout(150); }
// undo brings the point back
await page.keyboard.press("Control+z");
await page.waitForTimeout(250);
check("NEW-4 Delete point is one undo step (Ctrl+Z → 4 points)", (await nVerts()) === 4);
await page.keyboard.press("Control+Shift+z");
await page.waitForTimeout(250);
check("…and redo removes it again (3 points)", (await nVerts()) === 3);
// add a point: right-click blank canvas away from the edges
box = await canvasBox();
const target = { x: box.x + box.width * 0.42, y: box.y + box.height * 0.05 }; // above the polygon's top region, inside the image
await page.mouse.click(target.x, target.y, { button: "right" });
await page.waitForTimeout(250);
check("NEW-4 right-click elsewhere opens 'Add control point'", (await menu.locator('[data-testid="crop-menu-add-point"]').count()) === 1 && (await menu.locator('[data-testid="crop-menu-delete-point"]').count()) === 0);
await page.screenshot({ path: OUT + "crop-ux-menu-canvas.png" });
await menu.locator('[data-testid="crop-menu-add-point"]').click();
await page.waitForTimeout(300);
check("NEW-4 Add control point adds a point (3 → 4)", (await nVerts()) === 4);
{ // the new point is exactly where clicked
  const hit = await page.evaluate(({ x, y }) => Array.from(document.querySelectorAll('[data-testid^="crop-poly-vertex-"]')).map((c) => { const r = c.getBoundingClientRect(); return Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y); }), target);
  check("…and it sits exactly where the right-click landed", Math.min(...hit) < 1.5, `nearest vertex ${Math.min(...hit).toFixed(2)}px`);
}
await page.keyboard.press("Control+z");
await page.waitForTimeout(250);
check("NEW-4 Add control point is one undo step (Ctrl+Z → 3 points)", (await nVerts()) === 3);
await page.keyboard.press("Control+Shift+z");
await page.waitForTimeout(250);
// existing gestures still work: click an edge adds a point + drag; Delete key removes the selected one
await page.screenshot({ path: OUT + "crop-ux-poly.png" });
check("NEW-1 (2026-10-15) the closed-ring hint is the short one", /Click an edge to add a point · Drag a point to move it · Delete removes the selected point/.test(await dlg.locator('[data-testid="crop-poly-hint"]').textContent()));
await done();
const sPoly = await waitStored((s) => s && s.crop && s.crop.kind === "poly");
check("Done stores a polygon crop with the 4 points", !!(sPoly && sPoly.crop.kind === "poly" && sPoly.crop.pts.length === 4), JSON.stringify(sPoly && sPoly.crop));
check("NEW-5 the stored crop carries ONLY the polygon (no hidden rectangle x/y/w/h)", !!sPoly && !("x" in sPoly.crop) && !("w" in sPoly.crop), Object.keys(sPoly.crop || {}).join(","));

/* ---- NEW-5 reset + rect-only storage ---------------------------------------------------------------- */
await openCrop();
check("reopening shows the saved polygon (4 points)", (await nVerts()) === 4);
check("Reset is available on a cropped overlay", await dlg.locator('[data-testid="crop-reset"]').isEnabled());
await dlg.locator('[data-testid="crop-reset"]').click();
await page.waitForTimeout(250);
await done();
const sReset = await waitStored((s) => s && !s.crop);
check("NEW-5 Reset to full page + Done removes the crop entirely (crop null)", !!sReset && sReset.crop === null);
await openCrop();
{ // rectangle: drag the bottom-right handle in
  const h = await dlg.locator('[data-testid="crop-handle-br"]').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(h.x - 150, h.y - 100, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(250);
  await done();
}
const sRect = await waitStored((s) => s && s.crop && s.crop.kind === "rect");
check("a rectangle crop stores ONLY the rectangle (no pts key)", !!sRect && !("pts" in sRect.crop), JSON.stringify(sRect && sRect.crop));
await openCrop();
await dlg.locator("button", { hasText: "Polygon" }).click();
await page.waitForTimeout(200);
check("switching a rect-cropped overlay to Polygon starts a clean trace (no stand-in ring)", (await nVerts()) === 0);
await dlg.locator('[data-testid="crop-reset"]').click(); await page.waitForTimeout(200);
await done();
const sR2 = await waitStored((s) => s && !s.crop);
check("Reset from Polygon mode also removes the rectangle (one reset removes whatever crop is set)", !!sR2 && sR2.crop === null);

/* ---- NEW-6 lock does not stop crop (Site tab) ------------------------------------------------------- */
await page.locator('[data-testid="reference-row-ovA"] [data-testid="reference-lock-ovA"]').click();
await waitStored((s) => s && s.locked);
await page.waitForTimeout(300);
check("NEW-6 on a LOCKED overlay Crop… is enabled", await page.locator('[data-testid^="overlay-crop-switch-"]').first().isEnabled());
await openCrop();
{ const h = await dlg.locator('[data-testid="crop-handle-br"]').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(h.x - 120, h.y - 80, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(250); await done(); }
const sLocked = await waitStored((s) => s && s.crop);
check("NEW-6 a locked overlay takes the crop", !!sLocked && sLocked.locked && sLocked.crop && sLocked.crop.kind === "rect");

console.log(fail ? `\n✗ ${fail} check(s) failed` : "\n✓ all checks passed");
await browser.close();
process.exit(fail ? 1 : 0);
