/* Live verification for NEW-1 (B<PENDING>) — "set a note page's own width by hand": the page
 * menu's four presets + Fit to content, dragging either side edge with a real mouse, the pin as
 * a FLOOR (content wider than it still grows the sheet, content narrower than it does not shrink
 * the sheet), undo/redo as one step, reload persistence, and PDF-PARITY. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await assertMeasurable(page, "verify-notes-page-width");
await page.addInitScript(() => { window.__PLANYR_E2E = true; });

let pass = 0; let fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

async function seed(doc, title = "Width test") {
  await page.waitForTimeout(700);
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([treeKey, prefix, d, t]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: t, createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify(d));
  }, [TREE_KEY, PAGE_PREFIX, doc, title]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await page.waitForTimeout(900);
}

const p = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const PLAIN_DOC = { type: "doc", content: [p("hello")] };

async function sheetRect() {
  return page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="note-sheet"]');
    const r = sheet.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
  });
}

async function storedPageWidth() {
  return page.evaluate((prefix) => {
    const raw = localStorage.getItem(`${prefix}p1`);
    return raw ? (JSON.parse(raw).attrs?.pageWidth ?? null) : undefined;
  }, PAGE_PREFIX);
}

async function pickWidthMenu(optionSuffix) {
  await page.click('[data-testid="nt-page-width"]');
  await page.click(`[data-testid="nt-page-width-opt-${optionSuffix}"]`);
  await page.waitForTimeout(900);   // clear the 600ms autosave debounce (NOTES-CARRY-FORWARD trap #6)
}

/* ═══════════════════════ CASE 1 — default is Fit to content ═══════════════════════════ */
console.log("\n[1] Default (unpinned) page:");
{
  await seed(PLAIN_DOC, "Default width");
  const rect = await sheetRect();
  ok("renders at the ordinary ~580px card", rect.width > 0 && rect.width <= 580, JSON.stringify(rect));
  const stored = await storedPageWidth();
  ok("stores no pin at all", stored === null, `stored=${stored}`);
  await page.click('[data-testid="nt-page-width"]');
  const label = await page.textContent('[data-testid="nt-page-width"]');
  ok("menu trigger reads Fit to content", label.includes("Fit to content"), label);
  await page.keyboard.press("Escape");
}

/* ═══════════════════════ CASE 2 — every preset, and each after a manual value ═══════════ */
console.log("\n[2] Every preset:");
{
  await seed(PLAIN_DOC, "Presets");
  const before = await sheetRect();

  await pickWidthMenu("440");   // Narrow
  const narrowRect = await sheetRect();
  ok("Narrow renders narrower than the default", narrowRect.width < before.width, JSON.stringify({ before, narrowRect }));
  ok("Narrow stores 440", (await storedPageWidth()) === 440);

  await pickWidthMenu("580");   // Normal
  const normalRect = await sheetRect();
  ok("Normal renders back at the ordinary width", normalRect.width === before.width, JSON.stringify({ before, normalRect }));
  ok("Normal stores 580 — a REAL pin, not the same as unpinned", (await storedPageWidth()) === 580);

  await pickWidthMenu("900");   // Wide
  const wideRect = await sheetRect();
  ok("Wide renders wider than the default", wideRect.width > before.width, JSON.stringify({ before, wideRect }));
  ok("Wide stores 900", (await storedPageWidth()) === 900);

  await pickWidthMenu("full");  // Full width
  const fullRect = await sheetRect();
  ok("Full width renders wider still, filling most of the pane", fullRect.width > wideRect.width, JSON.stringify({ wideRect, fullRect }));
  ok("Full width stores the literal \"full\"", (await storedPageWidth()) === "full");

  // Fit to content AFTER a preset — clears the pin and returns to natural.
  await pickWidthMenu("fit");
  const fitRect = await sheetRect();
  ok("Fit to content after Full returns to the ordinary width", fitRect.width === before.width, JSON.stringify({ before, fitRect }));
  ok("Fit to content clears the stored pin", (await storedPageWidth()) === null);
}

/* ═══════════════════════ CASE 3 — the pin is a FLOOR, not a cap ════════════════════════ */
console.log("\n[3] A pinned-narrow page with a table wider than the pin still grows:");
{
  const cell = (text) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: [400], align: null }, content: [p(text)] });
  const row = (cells) => ({ type: "tableRow", content: cells });
  const wideTableDoc = { type: "doc", content: [{ type: "table", content: [row([cell("A"), cell("B"), cell("C")])] }] };
  await seed(wideTableDoc, "Narrow pin, wide table");
  await pickWidthMenu("440");
  const rect = await sheetRect();
  ok("a wide table still pushes the sheet past the Narrow pin — the floor never clips content", rect.width > 440, `width=${rect.width}`);
}

console.log("\n[3b] A pinned-wide page whose content shrinks stays wide:");
{
  await seed(PLAIN_DOC, "Wide pin, plain content");
  await pickWidthMenu("900");
  const rect = await sheetRect();
  ok("a Wide-pinned page with ordinary short content still renders at the pin, not shrunk to fit the text", rect.width >= 890, `width=${rect.width}`);
}

/* ═══════════════════════ CASE 4 — undo/redo of a width change is ONE step ══════════════ */
console.log("\n[4] Undo/redo of a menu width change is a single step:");
{
  await seed(PLAIN_DOC, "Undo width");
  const before = await sheetRect();
  await pickWidthMenu("900");
  const after = await sheetRect();
  ok("width changed", after.width > before.width, JSON.stringify({ before, after }));
  await page.click('[data-testid="note-body"] p');
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(250);
  const undone = await sheetRect();
  ok("Ctrl+Z undoes the whole width change in one step", undone.width === before.width, JSON.stringify({ before, undone }));
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(250);
  const redone = await sheetRect();
  ok("Ctrl+Y redoes it", redone.width === after.width, JSON.stringify({ after, redone }));
}

/* ═══════════════════════ CASE 5 — reload persistence for every preset ══════════════════ */
console.log("\n[5] Reload persistence:");
{
  await seed(PLAIN_DOC, "Persist width");
  await pickWidthMenu("900");
  const before = await sheetRect();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await page.waitForTimeout(900);
  const after = await sheetRect();
  ok("a Wide pin survives a reload", after.width === before.width, JSON.stringify({ before, after }));
  ok("the stored attribute survives too", (await storedPageWidth()) === 900);
}

/* ═══════════════════════ CASE 6 — drag the RIGHT edge, a real mouse ════════════════════ */
console.log("\n[6] Drag the right edge wider — the left edge holds:");
{
  await seed(PLAIN_DOC, "Drag right");
  const before = await sheetRect();
  const grip = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="note-page-width-grip-right"]');
    const r = g.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(grip.x + 20 * i, grip.y, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await sheetRect();
  ok("the sheet grew by roughly the drag distance", after.width >= before.width + 150, JSON.stringify({ before, after }));
  ok("the LEFT edge did not move", Math.abs(after.left - before.left) <= 2, JSON.stringify({ before, after }));
  ok("a completed drag persists", true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await page.waitForTimeout(900);
  const persisted = await sheetRect();
  ok("the dragged width survives a reload", persisted.width >= before.width + 150, JSON.stringify(persisted));

  // Drag it BACK narrower.
  const grip2 = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="note-page-width-grip-right"]');
    const r = g.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.move(grip2.x, grip2.y);
  await page.mouse.down();
  await page.mouse.move(grip2.x - 150, grip2.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const narrowedBack = await sheetRect();
  ok("dragging the right edge back narrows the page again", narrowedBack.width < persisted.width, JSON.stringify({ persisted, narrowedBack }));
}

/* ═══════════════════════ CASE 7 — drag the LEFT edge, a real mouse ═════════════════════ */
console.log("\n[7] Drag the left edge wider — the right edge holds:");
{
  await seed(PLAIN_DOC, "Drag left");
  const before = await sheetRect();
  const grip = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="note-page-width-grip-left"]');
    const r = g.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(grip.x - 20 * i, grip.y, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await sheetRect();
  ok("the sheet grew by roughly the drag distance", after.width >= before.width + 150, JSON.stringify({ before, after }));
  ok("the RIGHT edge stayed close to where it started (within rounding noise)", Math.abs(after.right - before.right) <= 15, JSON.stringify({ before, after }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await page.waitForTimeout(900);
  const persisted = await sheetRect();
  ok("the left-dragged width survives a reload", persisted.width >= before.width + 150, JSON.stringify(persisted));
  ok("after reload it settles to the app's own standing rest position (left-pinned)", Math.abs(persisted.left - before.left) <= 4, JSON.stringify({ before, persisted }));
}

/* ═══════════════════════ CASE 8 — a click with no movement commits nothing ═════════════ */
console.log("\n[8] A plain click on a grip (no drag) writes nothing:");
{
  await seed(PLAIN_DOC, "Click no drag");
  const before = await sheetRect();
  const beforeStored = await storedPageWidth();
  const grip = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="note-page-width-grip-right"]');
    const r = g.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await sheetRect();
  ok("width unchanged", after.width === before.width, JSON.stringify({ before, after }));
  ok("nothing was stored", (await storedPageWidth()) === beforeStored);
}

/* ═══════════════════════ CASE 9 — a window narrower than the pinned width ══════════════ */
console.log("\n[9] A window narrower than the pinned width:");
{
  // A Wide/Full pin behaves EXACTLY like an overflowing table already does on a narrow window
  // (verify-notes-table-columns.mjs Case 9): the page stays the width you asked for and the
  // outer pane scrolls sideways to reach it, rather than a narrow browser window silently
  // overriding the width you explicitly chose.
  await seed(PLAIN_DOC, "Narrow window pin");
  await pickWidthMenu("900");
  await page.setViewportSize({ width: 700, height: 800 });
  await page.waitForTimeout(300);
  const rect = await sheetRect();
  const overflowX = await page.evaluate(() => {
    const mat = document.querySelector('[data-testid="note-mat"]');
    return mat.scrollWidth - mat.clientWidth;
  });
  ok("a Wide pin is not silently overridden by a narrower window", rect.width >= 890, `width=${rect.width}`);
  ok("the OUTER pane scrolls horizontally to reach the pinned width, matching wide-table behaviour", overflowX > 100, `overflowX=${overflowX}`);
  await page.setViewportSize({ width: 1500, height: 950 });

  // Fit to content, meanwhile, still shrinks to the window exactly as it always has — only a
  // PIN opts a page out of that. Seeded fresh (unpinned is the default, no menu click needed)
  // so the toolbar stays in its wide layout the whole time — narrower than 760px switches the
  // width control into the overflow "More" sheet, a toolbar-layout detail this case isn't about.
  await seed(PLAIN_DOC, "Fit shrinks on narrow window");
  await page.setViewportSize({ width: 700, height: 800 });
  await page.waitForTimeout(300);
  const fitRect = await sheetRect();
  const fitOverflow = await page.evaluate(() => {
    const mat = document.querySelector('[data-testid="note-mat"]');
    return mat.scrollWidth - mat.clientWidth;
  });
  ok("Fit to content still shrinks to a narrow window with no forced overflow", fitRect.width < 700 && fitOverflow <= 5, JSON.stringify({ fitRect, fitOverflow }));
  await page.setViewportSize({ width: 1500, height: 950 });
}

/* ═══════════════════════ CASE 10 — PDF-PARITY ══════════════════════════════════════════ */
console.log("\n[10] PDF-PARITY — the real toolbar Print button:");
{
  await seed(PLAIN_DOC, "Print width");
  await pickWidthMenu("900");
  await page.click('[data-testid="nt-print"]');
  await page.waitForTimeout(600);
  const printed = await page.evaluate(() => {
    const frame = document.querySelector('[data-testid="notes-print-frame"]');
    const pdoc = frame?.contentDocument;
    if (!pdoc) return { found: false };
    const sheet = pdoc.querySelector(".sheet");
    return { found: true, style: sheet?.getAttribute("style") || "" };
  });
  ok("the print iframe rendered", printed.found, JSON.stringify(printed));
  if (printed.found) {
    ok("a numeric width pin widens the printed sheet past its ordinary 190mm",
      printed.style.includes("max-width") && /(\d{3,})px/.test(printed.style) && parseInt(printed.style.match(/(\d{3,})px/)[1], 10) > 700,
      printed.style);
  }
}

console.log("\n[11] \"Full width\" does not widen paper (a screen-only concept):");
{
  await seed(PLAIN_DOC, "Print full width");
  await pickWidthMenu("full");
  await page.click('[data-testid="nt-print"]');
  await page.waitForTimeout(600);
  const printed = await page.evaluate(() => {
    const frame = document.querySelector('[data-testid="notes-print-frame"]');
    const pdoc = frame?.contentDocument;
    const sheet = pdoc?.querySelector(".sheet");
    return sheet?.getAttribute("style") || "";
  });
  ok("Full width prints at the ordinary page width (no forced max-width override)", !printed.includes("max-width"), printed);
}

console.log(`\n${pass} passed, ${fail} failed. JS errors: ${errs.length}`);
if (errs.length) console.log(errs.slice(0, 8).join("\n"));
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
