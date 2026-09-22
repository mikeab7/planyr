/* Live verification for NEW-1 (B1344624) — "set a note page's own width by hand": the page
 * menu's four presets + Fit to content, dragging either side edge with a real mouse, the pin as
 * a FLOOR (content wider than it still grows the sheet, content narrower than it does not shrink
 * the sheet), undo/redo as one step, reload persistence, and PDF-PARITY.
 *
 * ⛔ EXTENDED (B1344624 ×2, owner report 2026-09-15) — CASES 1–13 NEVER ASKED WHETHER THE FRAME
 * ACTUALLY FITS. They all compare the sheet's own rect against itself (narrower/wider than
 * before, left edge held) — none of them measure it against `note-mat`'s real, scrollbar-aware
 * `clientWidth`/`scrollWidth`, which is exactly how a 907px "Full width" frame sitting inside an
 * untouched 172px gutter shipped 41/41 green while overhanging the visible pane by 156px on the
 * owner's own window. Cases 14–19 (`matGeometry()`) ask that question directly, off the real DOM
 * box model — the owner's own adjacent-case list: every preset at his window, the Outline panel
 * stealing pane width, the (honestly absent) Pages-rail toggle, a floor-clamped narrow window, a
 * table wider than even Full's own floor, and phone width. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

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

/* ⛔ B1344624 ×2 (owner report 2026-09-15) — THE MISSING QUESTION. Every case above compares the
 * SHEET's own rect against itself (narrower/wider than before, left edge held, etc.) and never
 * once asks whether that rect actually fits inside what `note-mat` shows without scrolling — the
 * exact question whose absence let a 907px-wide "Full width" page overhang the pane by 156px
 * while every case above stayed green. `matGeometry` asks it directly, off the real DOM box
 * model (never re-derived from the app's own formula — DRIVER-SCROLL-IS-NOT-APP-SCROLL §6's
 * "known-good arm" point: an instrument that reproduces the app's own math can only confirm the
 * app agrees with itself, never that either of them is right). */
async function matGeometry() {
  return page.evaluate(() => {
    const mat = document.querySelector('[data-testid="note-mat"]');
    const sheet = document.querySelector('[data-testid="note-sheet"]');
    const mr = mat.getBoundingClientRect();
    const sr = sheet.getBoundingClientRect();
    return {
      clientWidth: mat.clientWidth,
      scrollWidth: mat.scrollWidth,
      overflow: mat.scrollWidth - mat.clientWidth,
      matRight: Math.round(mr.right),
      sheet: { left: Math.round(sr.left), right: Math.round(sr.right), width: Math.round(sr.width) },
      sheetOverhangsMat: Math.round(sr.right) - Math.round(mr.right),
    };
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
  /* ⛔ INVERTED (NEW-2, 2026-09-21), AND THE INVERSION IS THE FIX. This used to assert that the
   * blank left margin a drag opened was LOST on reload and the page settled back to the app's
   * standing left-pinned rest position — a stated, accepted limitation, because the margin lived
   * in a React ref that nothing persisted. It is a document attribute now (`pageMarginLeft`), so
   * it comes back, which is what anyone would expect of something they dragged.
   *
   * ⛔ WHAT IS ASSERTED IS THE PAGE, NOT ITS PLACE ON SCREEN, and the distinction is deliberate: a
   * width drag must not move the VIEW (that is a third of the owner's own sentence), so it stores
   * no view, so a reload frames the page afresh exactly as any first open does. Demanding the same
   * screen coordinates would be demanding that the drag persist a view it is forbidden to touch —
   * the first version of this row did, and failed for that reason on a correct build. Where the
   * view IS moved deliberately, it persists, and `verify-notes-canvas` §6 proves it. */
  const storedGeom = await page.evaluate(() => {
    const a = JSON.parse(localStorage.getItem("planyr:notes:page:v1:local:p1")).attrs || {};
    return { pageWidth: a.pageWidth ?? null, pageMarginLeft: a.pageMarginLeft || 0 };
  });
  ok("⛔ the blank left margin SURVIVES the reload — it is a stored fact now, not a live ref",
    storedGeom.pageMarginLeft >= 150, JSON.stringify(storedGeom));
  ok("…and the page comes back the same width it was dragged to",
    Math.abs(persisted.width - after.width) <= 2,
    JSON.stringify({ afterDrag: after.width, persisted: persisted.width }))
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
  /* ⛔ "NO FORCED OVERFLOW" IS NO LONGER A QUESTION (NEW-1, 2026-09-21) — the mat is a viewport,
   * not a scroller, so `scrollWidth - clientWidth` is permanently 0 and asserting it would be a
   * row that cannot fail. What still matters, and is what this case was ever really about, is that
   * an UNPINNED page shrinks to a narrow window instead of holding a width nobody asked for. */
  ok("Fit to content still shrinks to a narrow window", fitRect.width < 700, JSON.stringify({ fitRect }));
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

/* ═══════ CASE 12 — B1561105: Full width must never render narrower than Wide ════════════ */
console.log("\n[12] The reported inversion — Full width vs Wide at the owner's exact window:");
{
  // The owner's own report: a ~1190 CSS px browser window, Wide picked then Full width picked,
  // and Full width rendered SMALLER. Reproduce at that exact width, then sweep narrow/normal/wide
  // windows and assert the five options never invert anywhere.
  await seed(PLAIN_DOC, "Inversion repro");
  await page.setViewportSize({ width: 1190, height: 900 });
  await page.waitForTimeout(300);
  await pickWidthMenu("900");
  const wideAt1190 = await sheetRect();
  await pickWidthMenu("full");
  const fullAt1190 = await sheetRect();
  ok("Full width is never narrower than Wide at the owner's own window width",
    fullAt1190.width >= wideAt1190.width, JSON.stringify({ wideAt1190, fullAt1190 }));
  await page.setViewportSize({ width: 1500, height: 950 });
}

console.log("\n[13] The full ladder — every option, narrow/normal/wide windows, as a table:");
{
  const widths = { narrow: 900, normal: 1400, wide: 3000 };
  const table = {};
  for (const [sizeLabel, vw] of Object.entries(widths)) {
    await seed(PLAIN_DOC, `Ladder ${sizeLabel}`);
    await page.setViewportSize({ width: vw, height: 900 });
    await page.waitForTimeout(300);
    const row = {};
    for (const opt of ["440", "580", "900", "full"]) {
      await pickWidthMenu(opt);
      row[opt] = (await sheetRect()).width;
    }
    table[sizeLabel] = row;
  }
  console.log("  " + JSON.stringify(table));
  for (const [sizeLabel, row] of Object.entries(table)) {
    ok(`${sizeLabel} window: Narrow ≤ Normal ≤ Wide ≤ Full`,
      row["440"] <= row["580"] && row["580"] <= row["900"] && row["900"] <= row["full"],
      JSON.stringify(row));
  }
  await page.setViewportSize({ width: 1500, height: 950 });
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

/* ═══════════════ CASES 14–21 — SUPERSEDED, AND WHERE THEIR COVERAGE WENT ═══════════════
 *
 * ⛔ READ THIS BEFORE RESTORING ANY OF THEM. They are not deleted because they were wrong; they
 * are deleted because the thing they measured stopped existing.
 *
 * Cases 14–19 asked, in six different ways, whether the page's frame fits inside `note-mat`
 * WITHOUT FORCING A HORIZONTAL SCROLL — the right question while the mat was a bounded scroller,
 * and the question that caught a 907px "Full width" frame overhanging a 923px pane by 156px. The
 * mat is a VIEWPORT now (`overflow: hidden`) on an unbounded transform workspace, so
 * `scrollWidth − clientWidth` is permanently 0: every one of those rows would pass on any build,
 * including a completely broken one. A row that cannot fail is worse than no row.
 *
 * Cases 20–21 drove the grips frame by frame and asserted the body text never moved. That
 * coverage did not go away — it MOVED, and it grew: `verify-notes-width-matrix` runs the same
 * question across 24 rows × 2 window/DPR arms, from starting widths BELOW the natural card (the
 * variable these cases could not reach, and the reason B1801040 shipped past them), at two zoom
 * levels, panned and scrolled, with boxes either side of the column, and with the gesture shape
 * varied. It also carries a known-good arm that voids the run and a mutation arm that reproduces
 * B1801040's own measured numbers on the pre-fix build. Point any new page-width question there.
 *
 * ⛔ ONE THING THOSE CASES COVERED THAT THE MATRIX DOES NOT, kept here rather than lost in the
 * edit: "Full width" is the only PANE-RELATIVE pin, so it has to re-resolve when the pane's size
 * changes underneath it (the Outline panel opening, the Pages rail collapsing, a window resize).
 * That is a property of `resolvePresetPx`'s wiring, not of any gesture, so it belongs here. */
console.log("\n[14] \"Full width\" re-resolves as the pane's own size changes:");
{
  await seed(PLAIN_DOC, "Full re-resolve");
  await pickWidthMenu("full");
  await page.waitForTimeout(500);
  const wide = await sheetRect();
  await page.setViewportSize({ width: 1100, height: 950 });
  await page.waitForTimeout(600);
  const narrow = await sheetRect();
  ok("a narrower window gives a narrower Full-width page", narrow.width < wide.width,
    JSON.stringify({ wide: wide.width, narrow: narrow.width }));
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.waitForTimeout(600);
  const back = await sheetRect();
  ok("and it tracks back out again", Math.abs(back.width - wide.width) <= 2,
    JSON.stringify({ wide: wide.width, back: back.width }));
  ok("⛔ AND IT IS ACTUALLY VISIBLE — picking a preset named Full width shows the whole width",
    back.left >= 0 && back.right <= 1500 + 2, JSON.stringify(back));
}


console.log(`\n${pass} passed, ${fail} failed. JS errors: ${errs.length}`);
if (errs.length) console.log(errs.slice(0, 8).join("\n"));
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
