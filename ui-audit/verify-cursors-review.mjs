/* verify-cursors-review.mjs — NEW-4 (B2426785) cursor convention, REVIEW slice (docs/DESIGN.md "Cursor convention").
 * Reads the cursor the browser would paint — getComputedStyle(elementFromPoint(x, y)).cursor, and for MID-GESTURE states the
 * viewport div's own cursor (the pointer is captured by it, so it is the element that decides) — at named states in the real
 * Review workspace, logged out on a locally opened PDF (or signed in as the test account on a https planyr.io base).
 *   node ui-audit/verify-cursors-review.mjs [http://localhost:4182/ | https://planyr.io]
 * Prints /version.json in the SAME call as the verdicts (MERGED ≠ LIVE: the build read is part of the observation).
 * KNOWN-GOOD ARMS (expected independently of the code under test): an enabled toolbar button and a probe <a href> read
 * `pointer`, the empty-state-free DOM body reads default/auto — if either is wrong the run is VOID, not scored
 * (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6). Transient states that cannot be caught are reported NOT-OBSERVED, never as a pass. */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.argv[2] || process.env.BASE_URL || "http://localhost:4182/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].find(existsSync);
const SAMPLE = readFileSync(new URL("../e2e/fixtures/sample.pdf", import.meta.url));
async function threePagePdf() { // ink on every page so Compare has something to register (a blank page is an honest "nothing to compare" error)
  const d = await PDFDocument.create();
  for (let i = 0; i < 3; i++) { const pg = d.addPage([612, 792]); pg.drawRectangle({ x: 60, y: 120, width: 480, height: 520, borderWidth: 3 }); for (let k = 0; k < 6; k++) pg.drawLine({ start: { x: 80, y: 160 + k * 80 }, end: { x: 520, y: 200 + k * 70 }, thickness: 2 }); pg.drawCircle({ x: 300, y: 380, size: 70, borderWidth: 3 }); }
  return Buffer.from(await d.save());
}
const MULTI = await threePagePdf();

let browser, page, close = async () => {}, build = null;
if (/^https:\/\/planyr\.io/.test(BASE) && process.env.E2E_LOGIN_KEY) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  const s = await openSignedIn({ base: BASE.replace(/\/$/, "") });
  page = s.page; close = s.close; build = s.build;
  await page.setViewportSize({ width: 1440, height: 1300 });
} else {
  browser = await chromium.launch({ executablePath: EXEC });
  page = await (await browser.newContext({ viewport: { width: 1440, height: 1300 } })).newPage();
  close = () => browser.close();
}
const results = [];
const check = (name, got, want) => { const ok = got === want; results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  → ${got} (want ${want})`); };
const note = (name, msg) => console.log(`NOT-OBSERVED  ${name} — ${msg}`);
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));

/* ---- readers ---- */
const cursorAt = (x, y) => page.evaluate(([x, y]) => { const h = document.elementFromPoint(x, y); return h ? getComputedStyle(h).cursor : "NOHIT"; }, [x, y]);
// The viewport div: the ancestor of the sheet that owns pointer capture (touch-action none). Its cursor is the truth mid-gesture.
const vpCursor = () => page.evaluate(() => {
  let el = document.querySelector('[data-testid="review-sheet"]');
  while (el && !(el.style && el.style.touchAction === "none")) el = el.parentElement;
  return el ? getComputedStyle(el).cursor : "NOVIEWPORT";
});
const cursorOf = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return "MISSING"; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) || el; return getComputedStyle(h).cursor; }, sel);

// Like cursorOf, but PROVES the point resolves to the target (or something inside it): if something else paints over it, the read is reported
// as COVERED, never taken. (B2426787 — this used to HIDE the app header to reach Compare's controls; they now sit below it, so nothing is hidden.)
const cursorOfClear = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return "MISSING"; el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !h ? "NOHIT" : el.contains(h) ? getComputedStyle(h).cursor : "COVERED";
}, sel);
const A = { x: 760, y: 380 }, B = { x: 910, y: 490 };     // rect 1: NW → SE
const C = { x: 1100, y: 380 }, D = { x: 1000, y: 470 };   // rect 2 drawn NE → SW (index order ≠ position order)
const L1 = { x: 700, y: 620 }, L2 = { x: 900, y: 660 };   // a line
const EMPTY = { x: 560, y: 760 };
const click2 = async (p, q) => { await page.mouse.click(p.x, p.y); await page.waitForTimeout(100); await page.mouse.click(q.x, q.y); await page.waitForTimeout(350); };

try {
  if (page.url() === "about:blank") await page.goto(BASE + "#/markup", { waitUntil: "load" });
  else await page.evaluate(() => { location.hash = "#/markup"; });
  await page.waitForSelector('[data-testid="doc-review-root"]', { timeout: 30000 });
  await page.waitForTimeout(900);
  await assertMeasurable(page, "verify-cursors-review");
  if (!build) { try { build = await page.evaluate(() => fetch("/version.json").then((r) => r.json()).catch(() => null)); } catch { /* none locally */ } }

  await page.locator('input[type="file"][accept^="application/pdf"]:not([multiple])').first().setInputFiles({ name: "multi.pdf", mimeType: "application/pdf", buffer: MULTI });
  await page.waitForSelector('[data-testid="tool-rect"]', { timeout: 30000 });
  await page.waitForSelector('[data-testid="review-sheet"]', { timeout: 30000 });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { const a = document.createElement("a"); a.id = "cur-probe-link"; a.href = "#x"; a.textContent = "lnk"; a.style.cssText = "position:fixed;left:2px;bottom:2px;z-index:99999"; document.body.appendChild(a); });

  // ---- known-good arms ----
  const goodLink = await cursorOf("#cur-probe-link"), goodBtn = await cursorOf('[data-testid="tool-select"]');
  if (goodLink !== "pointer" || goodBtn !== "pointer") { console.error(`VOID: known-good arms disagree (link=${goodLink}, tool button=${goodBtn})`); process.exit(2); }
  check("known-good: link", goodLink, "pointer");
  check("known-good: enabled tool button", goodBtn, "pointer");

  // ---- disabled ----
  check("Undo disabled (nothing to undo) shows the arrow", await cursorOf('button[title^="Undo"]'), "default");
  check("sheet-step ‹ disabled on sheet 1 shows the arrow", await cursorOf('button[title="Previous sheet (←)"]'), "default");
  check("sheet-step › enabled shows the pointer", await cursorOf('button[title="Next sheet (→)"]'), "pointer");
  await page.evaluate(() => { const b = document.createElement("button"); b.id = "cur-probe-dis"; b.disabled = true; b.style.cssText = "cursor:pointer;position:fixed;left:40px;bottom:2px;z-index:99999;width:50px;height:22px"; document.body.appendChild(b); });
  check("a DISABLED button with an inline pointer still shows the arrow", await cursorOf("#cur-probe-dis"), "default");

  // ---- select tool, empty sheet ----
  await page.locator('[data-testid="tool-select"]').click();
  await page.mouse.move(EMPTY.x, EMPTY.y); await page.waitForTimeout(120);
  check("Select · empty sheet", await cursorAt(EMPTY.x, EMPTY.y), "grab");

  // ---- draw rect 1 (NW→SE), rect 2 (NE→SW), a line ----
  await page.locator('[data-testid="tool-rect"]').click();
  check("Rect armed · over empty sheet", (await page.mouse.move(EMPTY.x, EMPTY.y), await page.waitForTimeout(80), await cursorAt(EMPTY.x, EMPTY.y)), "crosshair");
  await click2(A, B);
  await page.locator('[data-testid="tool-rect"]').click();
  await click2(C, D);
  await page.locator('[data-testid="tool-line"]').click();
  await click2(L1, L2);

  // ---- armed tool over an EXISTING markup ----
  await page.locator('[data-testid="tool-rect"]').click();
  const edgeMidA = { x: Math.round((A.x + B.x) / 2), y: A.y };
  await page.mouse.move(edgeMidA.x, edgeMidA.y); await page.waitForTimeout(100);
  check("Rect armed · over an existing markup", await cursorAt(edgeMidA.x, edgeMidA.y), "crosshair");

  // ---- select tool over markup / grips ----
  await page.locator('[data-testid="tool-select"]').click();
  await page.mouse.click(edgeMidA.x, edgeMidA.y); await page.waitForTimeout(250); // select rect 1
  await page.mouse.move(EMPTY.x, EMPTY.y); await page.waitForTimeout(100);
  await page.mouse.move(edgeMidA.x, edgeMidA.y); await page.waitForTimeout(150);
  check("Select · hover a markup body", await cursorAt(edgeMidA.x, edgeMidA.y), "move");
  await page.mouse.move(A.x, A.y); await page.waitForTimeout(150);
  check("Select · grip NW of a NW→SE box", await cursorAt(A.x, A.y), "nwse-resize");
  await page.mouse.move(B.x, B.y); await page.waitForTimeout(150);
  check("Select · grip SE of a NW→SE box", await cursorAt(B.x, B.y), "nwse-resize");

  // rect 2: drawn NE→SW (pts[0] = NE). Select it, then both grips are on the / diagonal.
  await page.mouse.click(Math.round((C.x + D.x) / 2), Math.min(C.y, D.y)); await page.waitForTimeout(250);
  await page.mouse.move(C.x, C.y); await page.waitForTimeout(150);
  check("Select · grip NE of a NE→SW box (index 0)", await cursorAt(C.x, C.y), "nesw-resize");
  await page.mouse.move(D.x, D.y); await page.waitForTimeout(150);
  check("Select · grip SW of a NE→SW box (index 1)", await cursorAt(D.x, D.y), "nesw-resize");

  // line vertex = move
  await page.mouse.click(Math.round((L1.x + L2.x) / 2), Math.round((L1.y + L2.y) / 2)); await page.waitForTimeout(250);
  await page.mouse.move(L1.x, L1.y); await page.waitForTimeout(150);
  check("Select · line vertex", await cursorAt(L1.x, L1.y), "move");

  // ---- mid-gesture: vertex drag holds its cursor, read on the CAPTURING viewport at a point over empty sheet ----
  await page.mouse.move(L1.x, L1.y); await page.mouse.down();
  await page.mouse.move(L1.x - 60, L1.y + 20, { steps: 6 });
  check("Mid-drag · line vertex (viewport cursor)", await vpCursor(), "move");
  await page.mouse.up(); await page.waitForTimeout(150);
  // rect corner drag = the corner's directional cursor for the whole drag
  await page.mouse.click(Math.round((A.x + B.x) / 2), A.y); await page.waitForTimeout(250);
  await page.mouse.move(B.x, B.y); await page.mouse.down();
  await page.mouse.move(B.x + 50, B.y + 40, { steps: 6 });
  check("Mid-drag · box corner (viewport cursor)", await vpCursor(), "nwse-resize");
  await page.mouse.up(); await page.waitForTimeout(150);
  check("After the corner drag ends the cursor is derived again", (await page.mouse.move(EMPTY.x, EMPTY.y), await page.waitForTimeout(100), await vpCursor()), "grab");

  // body drag: move cursor for the whole gesture, back to derived after
  await page.mouse.move(edgeMidA.x, edgeMidA.y); await page.mouse.down();
  await page.mouse.move(edgeMidA.x + 40, edgeMidA.y + 30, { steps: 4 });
  await page.mouse.move(EMPTY.x + 200, EMPTY.y - 40, { steps: 8 });
  check("Mid-drag · markup body (viewport cursor)", await vpCursor(), "move");
  await page.mouse.up(); await page.waitForTimeout(150);
  await page.mouse.move(EMPTY.x, EMPTY.y); await page.waitForTimeout(100);
  check("After the body drag ends", await vpCursor(), "grab");

  // ---- panning ----
  await page.mouse.move(EMPTY.x, EMPTY.y); await page.mouse.down();
  await page.mouse.move(EMPTY.x + 30, EMPTY.y - 10, { steps: 4 });
  check("Select · empty-sheet drag pans (grabbing)", await vpCursor(), "grabbing");
  await page.mouse.up(); await page.waitForTimeout(100);
  check("Select · after the pan", await vpCursor(), "grab");
  await page.locator('[data-testid="tool-pan"]').click();
  await page.mouse.move(EMPTY.x, EMPTY.y); await page.waitForTimeout(80);
  check("Pan tool · idle", await cursorAt(EMPTY.x, EMPTY.y), "grab");
  await page.mouse.down(); await page.mouse.move(EMPTY.x + 40, EMPTY.y, { steps: 4 });
  check("Pan tool · dragging", await vpCursor(), "grabbing");
  await page.mouse.up();

  // ---- Calibrate: the length box is open → canvas presses are ignored → the arrow ----
  await page.locator('[data-testid="tool-select"]').click();
  await page.locator('[data-testid="tool-calibrate"]').click();
  await page.mouse.move(EMPTY.x, EMPTY.y); await page.waitForTimeout(80);
  check("Calibrate armed · before the length box", await cursorAt(EMPTY.x, EMPTY.y), "crosshair");
  await click2({ x: 520, y: 780 }, { x: 700, y: 780 });
  const calOpen = await page.getByPlaceholder(/120/).count();
  if (!calOpen) console.log("FAIL  Calibrate length box did not open (instrument cannot reach the state)"), results.push({ name: "calibrate box opens", ok: false });
  else {
    await page.mouse.move(EMPTY.x + 250, EMPTY.y - 100); await page.waitForTimeout(100);
    check("Calibrate · length box open (canvas ignores presses)", await cursorAt(EMPTY.x + 250, EMPTY.y - 100), "default");
    await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  }
  await page.locator('[data-testid="tool-select"]').click();

  // ---- Add Leader armed (a callout, right-click → Add Leader) ----
  await page.locator('[data-testid="tool-callout"]').click();
  await page.mouse.click(1150, 600); await page.waitForTimeout(150); await page.mouse.click(1250, 560); await page.waitForTimeout(300);
  await page.keyboard.type("note"); await page.keyboard.press("Enter"); await page.waitForTimeout(350);
  await page.mouse.click(1250 + 4, 560 + 4, { button: "right" }); await page.waitForTimeout(250);
  const addLeader = page.getByRole("menuitem", { name: /Add Leader/ });
  if (!(await addLeader.count())) { console.log("FAIL  Add Leader menu item not reachable (instrument cannot reach the state)"); results.push({ name: "add leader reachable", ok: false }); }
  else {
    await addLeader.first().click(); await page.waitForTimeout(200);
    await page.mouse.move(EMPTY.x, EMPTY.y); await page.waitForTimeout(100);
    check("Add Leader armed · over empty sheet", await cursorAt(EMPTY.x, EMPTY.y), "crosshair");
    await page.mouse.move(edgeMidA.x + 40, edgeMidA.y + 30); await page.waitForTimeout(100);
    check("Add Leader armed · over an existing markup", await vpCursor(), "crosshair");
    await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  }

  // ---- native controls in the Properties panel: pointer ----
  const nat = await page.evaluate(() => {
    const q = (s) => { const e = document.querySelector(`[data-testid="property-panel"] ${s}`); if (!e) return "MISSING"; const r = e.getBoundingClientRect(); e.scrollIntoView({ block: "center" }); const r2 = e.getBoundingClientRect(); return getComputedStyle(document.elementFromPoint(r2.left + r2.width / 2, r2.top + r2.height / 2) || e).cursor; };
    return { sel: q("select:enabled"), range: q('input[type="range"]:enabled'), chk: q('input[type="checkbox"]:enabled') };
  });
  check("Properties native select", nat.sel, "pointer");
  check("Properties range slider", nat.range, "pointer");
  check("Properties checkbox", nat.chk, "pointer");

  // ---- rail divider: col-resize held for the whole drag, past the clamp ----
  const rr = await page.locator('[data-testid="sheet-rail-resizer"]').boundingBox();
  if (!rr) { console.log("FAIL  rail divider missing"); results.push({ name: "rail divider present", ok: false }); }
  else {
    const rx = rr.x + rr.width / 2, ry = rr.y + 60;
    check("Rail divider · idle", await cursorAt(rx, ry), "col-resize");
    await page.mouse.move(rx, ry); await page.mouse.down();
    await page.mouse.move(rx + 700, ry + 30, { steps: 10 }); // far past the 460 clamp, off the grip
    check("Rail divider · mid-drag, pointer far off the grip (any element)", await cursorAt(rx + 700, ry + 30), "col-resize");
    await page.mouse.up(); await page.waitForTimeout(100);
    check("Rail divider · after release the pin is gone", await cursorAt(rx + 700, ry + 30) !== "col-resize" ? "released" : "STUCK", "released");
    // Escape releases a held pin too
    await page.mouse.move(rx, ry); await page.mouse.down(); await page.mouse.move(rx + 40, ry, { steps: 3 });
    await page.keyboard.press("Escape"); await page.waitForTimeout(80);
    check("Rail divider · Escape releases the pin", (await page.evaluate(() => !!document.querySelector("style[data-pinned-cursor]"))) ? "STUCK" : "released", "released");
    await page.mouse.up();
  }

  // ---- drop effect: a tab being reordered must not look droppable on the sheet; a file must ----
  // Real drag events only (a synthetic DataTransfer will not take a dropEffect — the first draft of this probe proved that and was blind).
  await page.evaluate(() => {
    window.__dropFx = null;
    window.addEventListener("dragover", (e) => { if (e.target.closest?.('[data-testid="review-sheet"], [data-testid="review-blank"]') || document.querySelector('[data-testid="review-sheet"]')?.parentElement?.contains(e.target)) window.__dropFx = e.dataTransfer.dropEffect; });
  });
  const sheetBox = await page.locator('[data-testid="review-sheet"]').boundingBox();
  const dropX = Math.round(sheetBox.x + sheetBox.width / 2), dropY = 400;
  await page.locator('[data-testid="review-tab"]').first().hover();
  await page.mouse.down();
  await page.mouse.move(dropX - 30, dropY, { steps: 8 });
  await page.mouse.move(dropX, dropY, { steps: 6 });
  await page.waitForTimeout(150);
  const tabFx = await page.evaluate(() => window.__dropFx);
  await page.mouse.up(); await page.waitForTimeout(250);
  check("Tab drag over the sheet → dropEffect", tabFx, "none");
  await page.evaluate(() => { window.__dropFx = null; });
  const cdpD = await page.context().newCDPSession(page);
  const filePath = new URL("../e2e/fixtures/sample.pdf", import.meta.url).pathname;
  try {
    await cdpD.send("Input.dispatchDragEvent", { type: "dragEnter", x: dropX, y: dropY, data: { items: [], files: [filePath], dragOperationsMask: 1 | 2 | 16 } });
    await cdpD.send("Input.dispatchDragEvent", { type: "dragOver", x: dropX, y: dropY, data: { items: [], files: [filePath], dragOperationsMask: 1 | 2 | 16 } });
    const fileFx = await page.evaluate(() => window.__dropFx);
    await cdpD.send("Input.dispatchDragEvent", { type: "dragCancel", x: dropX, y: dropY, data: { items: [], files: [filePath], dragOperationsMask: 1 } }).catch(() => {});
    check("File drag over the sheet (known-good arm) → dropEffect", fileFx, "copy");
  } catch (e) { console.log("FAIL  file-drag arm could not be driven:", e.message); results.push({ name: "file drag arm", ok: false }); }

  // ---- Opening… chip (transient): best-effort catch ----
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });
  await page.locator('button[title="Next sheet (→)"]').click();
  let chip = null;
  for (let i = 0; i < 40 && !chip; i++) { chip = await page.evaluate(() => { const c = document.querySelector('[data-testid="sheet-switching"]'); return c ? getComputedStyle(c).cursor : null; }); if (!chip) await page.waitForTimeout(40); }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  if (chip) check("Opening… chip", chip, "progress"); else note("Opening… chip", "the sheet rendered before the chip could be sampled; covered by the source test only");

  // ---- Compare (two revisions) ----
  await page.locator('[data-testid="compare-input"]').setInputFiles([{ name: "a.pdf", mimeType: "application/pdf", buffer: MULTI }, { name: "b.pdf", mimeType: "application/pdf", buffer: MULTI }]);
  await page.waitForSelector('[data-cmp="compare-view"]', { timeout: 20000 });
  const busyCur = await page.evaluate(() => { const b = document.querySelector('[data-cmp="busy"]'); return b ? getComputedStyle(b).cursor : null; });
  if (busyCur) check("Compare · Comparing revisions… overlay", busyCur, "progress"); else note("Compare busy overlay", "compare finished before it could be sampled");
  await page.waitForFunction(() => document.querySelector('[data-cmp="compare-view"]')?.getAttribute("data-status") !== "loading", null, { timeout: 30000 });
  await page.waitForTimeout(400);
  const cv = await page.locator('[data-cmp="compare-view"] canvas').boundingBox();
  check("Compare · page-step ‹ disabled on page 1", await cursorOfClear('[data-cmp="page-a-prev"]'), "default");
  check("Compare · page-step › enabled", await cursorOfClear('[data-cmp="page-a-next"]'), "pointer");
  if (cv) {
    const cx = cv.x + Math.min(cv.width, 600) / 2, cy = cv.y + Math.min(cv.height, 400) / 2;
    await page.mouse.move(cx, cy); await page.waitForTimeout(80);
    check("Compare · canvas idle", await cursorAt(cx, cy), "grab");
    await page.mouse.down(); await page.mouse.move(cx + 30, cy + 10, { steps: 4 });
    check("Compare · canvas mid-pan (state, immediately)", await cursorAt(cx + 30, cy + 10), "grabbing");
    await page.mouse.up(); await page.waitForTimeout(100);
    check("Compare · canvas after release (not stuck)", await cursorAt(cx + 30, cy + 10), "grab");
  } else { console.log("FAIL  compare canvas missing"); results.push({ name: "compare canvas", ok: false }); }
  await page.locator('[data-cmp="close"]').click();   // a REAL click — Playwright refuses it if anything covers the button
  await page.waitForTimeout(250);

  // ---- Stitcher ----
  await page.getByRole("button", { name: /Stitch/ }).first().click();
  await page.waitForSelector('[data-testid="exit-stitch"]', { timeout: 15000 });
  const sv = await page.evaluate(() => { const s = [...document.querySelectorAll("svg")].find((x) => x.style.touchAction === "none"); if (!s) return null; const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  if (!sv) { console.log("FAIL  stitcher canvas missing"); results.push({ name: "stitcher canvas", ok: false }); }
  else {
    await page.mouse.move(sv.x, sv.y); await page.waitForTimeout(80);
    check("Stitcher · Pan tool idle", await cursorAt(sv.x, sv.y), "grab");
    await page.mouse.down(); await page.mouse.move(sv.x + 40, sv.y + 10, { steps: 4 });
    check("Stitcher · Pan tool mid-drag", await cursorAt(sv.x + 40, sv.y + 10), "grabbing");
    await page.mouse.up(); await page.waitForTimeout(100);
    check("Stitcher · after release", await cursorAt(sv.x + 40, sv.y + 10), "grab");
  }
} catch (e) { console.error("ERROR", e.message); results.push({ name: "harness error", ok: false }); }
if (errors.length) console.log("page errors:", errors.slice(0, 3));
const failed = results.filter((r) => !r.ok).length;
console.log(`\nbuild: ${JSON.stringify(build)}\n${failed ? `FAIL ${failed}` : "PASS"} (${results.length} checks)`);
await close();
process.exit(failed ? 1 : 0);
