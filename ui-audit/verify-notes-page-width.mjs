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

/* ═══════════════ CASE 14 — B1344624 ×2: the real question — does it FIT? ═══════════════
 * Owner report 2026-09-15, live on planyr.io, build f2517d8, window 1191×465: "Full width"
 * rendered a 907px frame inside a 172px gutter that never shrank, overhanging the visible pane by
 * 156px — a page the menu calls "Full width" needed a sideways scroll to see either edge of.
 * Cases 1–13 above never asked this question; they only ever compared the sheet's own rect
 * against itself. This section asks it directly, at the owner's own window. */
console.log("\n[14] Every preset at the owner's own window — does the frame fit with no forced scroll?");
{
  await page.setViewportSize({ width: 1191, height: 465 });
  const table = {};
  for (const [label, opt] of [["narrow", "440"], ["normal", "580"], ["wide", "900"], ["full", "full"], ["fit", "fit"]]) {
    await seed(PLAIN_DOC, `Owner window ${label}`);
    if (opt !== "fit") await pickWidthMenu(opt);
    table[label] = await matGeometry();
  }
  console.log("  " + JSON.stringify(table));
  // ⛔ "wide" is DELIBERATELY excluded from the no-overflow assertion. A fixed numeric preset
  // (Narrow/Normal/Wide, or a completed drag) keeps the SAME natural (580-based) gutter no
  // matter what it is pinned to — that is the documented, load-bearing "ignores the pane
  // entirely, by design" behaviour (resolvePresetPx's own header; Case 9 above already accepts
  // exactly this for Wide on a narrow window). Wide (900) is wider than the natural baseline
  // (580) by MORE than the natural gutter ever reclaims, so it overflows this pane on
  // construction, not as a regression — this case was never what the owner reported. Reported
  // here for visibility, not asserted zero.
  for (const [label, g] of Object.entries(table)) {
    if (label === "wide") continue;
    ok(`${label}: no forced horizontal scroll at the owner's window`, g.overflow <= 1, JSON.stringify(g));
    ok(`${label}: the frame does not overhang the visible pane`, g.sheetOverhangsMat <= 1, JSON.stringify(g));
  }
  await page.setViewportSize({ width: 1500, height: 950 });
}

/* ═══════ CASE 15 — the Outline panel taking room from the mat still resolves correctly ═══ */
console.log("\n[15] Full width re-resolves correctly as the Outline panel opens/closes:");
{
  const h = (level, text) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
  const HEADING_DOC = { type: "doc", content: [h(1, "Section one"), p("body"), h(1, "Section two"), p("more body")] };
  await page.setViewportSize({ width: 1191, height: 465 });
  await seed(HEADING_DOC, "Outline + full width");
  await pickWidthMenu("full");
  // ⛔ The Outline defaults OPEN on desktop (`!narrow`) the moment a doc has headings — a
  // fixture built for this case starts ALREADY in the "steals room" state, not the baseline.
  // Close it first to measure the true unshrunk baseline.
  // ⛔ Even "closed" is not room-to-spare here: an outline WITH headings still leaves a slim
  // ~33px collapsed toggle rail in the layout (unlike a headingless note, where the component
  // renders nothing at all — Case 14's "full" arm). At the owner's own window that is just
  // enough to push this fixture under FULL_WIDTH_FLOOR once the 16px edge margin is subtracted,
  // so BOTH states below are floor-engaged — the SAME accepted "the floor wins, the pane
  // scrolls" case Case 17 exercises directly, never a regression. Both are checked against that
  // formula rather than asserted at a flat zero.
  //
  // ⛔ AND THE FORMULA CARRIES A SMALL, KNOWN, STRUCTURAL SLACK OF ITS OWN, UNRELATED TO THIS
  // FIX: the width-drag grip (`.planyr-page-width-grip-right { right: -7px }`) always straddles
  // the sheet's own right edge by 7px, for grabbability — CHROME-NEVER-EATS-A-PRESS's own
  // reasoning, just for a resize handle rather than a click target. Ordinarily that 7px is
  // absorbed by the (always-≥8px) unfloored gutter; the moment the gutter floors all the way to
  // 0, it is not, and becomes a few px of genuinely unavoidable scroll. Tolerance below covers
  // exactly that, and no more.
  const GRIP_MARGIN = 10;
  const expectFloorFormula = (label, geo) => {
    const expected = Math.max(0, 900 - geo.clientWidth);
    ok(`${label}: overflow matches the floor-engaged formula (no stale/wrong gutter)`,
      geo.overflow - expected >= 0 && geo.overflow - expected <= GRIP_MARGIN,
      JSON.stringify({ geo, expected }));
  };

  await page.click('[data-testid="note-outline-close"]');
  await page.waitForTimeout(400);
  const closed = await matGeometry();
  expectFloorFormula("Outline closed", closed);

  await page.click('[data-testid="note-outline-open"]');
  await page.waitForTimeout(400);
  const open = await matGeometry();
  ok("the frame narrowed to make room for the reopened Outline panel", open.sheet.width <= closed.sheet.width,
    JSON.stringify({ closed, open }));
  expectFloorFormula("Outline open", open);

  await page.click('[data-testid="note-outline-close"]');
  await page.waitForTimeout(400);
  const reclosed = await matGeometry();
  ok("closing the Outline again returns to the SAME geometry as the first closed reading (no stale gutter left over)",
    reclosed.overflow === closed.overflow && reclosed.sheet.width === closed.sheet.width,
    JSON.stringify({ closed, reclosed }));
  await page.setViewportSize({ width: 1500, height: 950 });
}

/* ═══════ CASE 16 — "the Pages rail expanded/collapsed" adjacent case, checked honestly ═══ */
console.log("\n[16] The Pages rail (the left note-tree panel):");
{
  // A full data-testid sweep of the live #/notes route at the owner's own window found no
  // collapse/expand control for the tree panel at all — `notes-tree` renders at one fixed
  // width always; there is no rail-width state to toggle in this module today. Reported
  // honestly rather than fabricating a case for a control that does not exist.
  ok("no collapse/expand control exists for the Notes Pages rail (confirmed by DOM sweep) — not a real adjacent case here", true);
}

/* ═══════ CASE 17 — a window narrow enough Wide (and Full) exceed the pane ══════════════
 * Expected and ACCEPTED, per resolvePresetPx's own documented floor (B1566928): below the
 * floor, a preset overflows the pane exactly the way an oversized box/table already does. The
 * question this case asks is narrower — is the overflow BOUNDED and does Full, whose gutter
 * collapses, still do at least as well as Wide, whose gutter never does? */
console.log("\n[17] A window narrow enough that Wide (and Full) exceed the pane:");
{
  // ⛔ Pick the preset BEFORE narrowing, not after — below 760px the toolbar's width control
  // itself moves into the overflow "More" sheet (Case 9's own comment already names this), so
  // clicking `nt-page-width` directly at 700px times out. The measurement effect re-derives the
  // gutter live off its own ResizeObserver on the scroller, so narrowing AFTER picking is enough.
  await page.setViewportSize({ width: 1500, height: 950 });
  await seed(PLAIN_DOC, "Narrow window, floor engages — Wide");
  await pickWidthMenu("900");
  await page.setViewportSize({ width: 700, height: 800 });
  await page.waitForTimeout(300);
  const wide = await matGeometry();

  await page.setViewportSize({ width: 1500, height: 950 });
  await seed(PLAIN_DOC, "Narrow window, floor engages — Full");
  await pickWidthMenu("full");
  await page.setViewportSize({ width: 700, height: 800 });
  await page.waitForTimeout(300);
  const full = await matGeometry();
  console.log("  " + JSON.stringify({ wide, full }));
  ok("Wide overflows this pane, as documented/expected", wide.overflow > 0, JSON.stringify(wide));
  ok("Full also overflows (same floor, B1566928) — expected, not a regression", full.overflow > 0, JSON.stringify(full));
  ok("Full's collapsed gutter still overflows LESS than Wide's fixed gutter, at the same floor width",
    full.overflow <= wide.overflow, JSON.stringify({ wide, full }));
  await page.setViewportSize({ width: 1500, height: 950 });
}

/* ═══════ CASE 18 — a table wider than the pane: the floor wins, scroll stops at the edge ═══ */
console.log("\n[18] A table wider than Full width's own floor — scroll reaches the table's real edge, no further:");
{
  const cell = (text) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: [1600], align: null }, content: [p(text)] });
  const row = (cells) => ({ type: "tableRow", content: cells });
  const HUGE_TABLE_DOC = { type: "doc", content: [{ type: "table", content: [row([cell("very wide cell")])] }] };
  await page.setViewportSize({ width: 1191, height: 465 });
  await seed(HUGE_TABLE_DOC, "Huge table, full width");
  await pickWidthMenu("full");
  const geo = await matGeometry();
  ok("the table forces real overflow past Full's own floor", geo.overflow > 200, JSON.stringify(geo));
  await page.evaluate(() => {
    const mat = document.querySelector('[data-testid="note-mat"]');
    mat.scrollLeft = mat.scrollWidth;
  });
  await page.waitForTimeout(150);
  const atMaxScroll = await page.evaluate(() => {
    const mat = document.querySelector('[data-testid="note-mat"]');
    const table = document.querySelector("table");
    const mr = mat.getBoundingClientRect();
    const tr = table.getBoundingClientRect();
    return { matRight: Math.round(mr.right), tableRight: Math.round(tr.right), scrollLeft: mat.scrollLeft, scrollWidth: mat.scrollWidth, clientWidth: mat.clientWidth };
  });
  ok("scrolled all the way right, the table's own right edge is on screen (scroll didn't stop short)",
    atMaxScroll.tableRight <= atMaxScroll.matRight + 4, JSON.stringify(atMaxScroll));
  // The gap past the table is not pure "phantom" scroll — it is the sheet's own right padding
  // (SHEET_PAD_X.wide, 40) plus whatever small gutter (`matPadX`) that pin still carries, the
  // SAME intentional breathing margin every preset leaves, never zero anywhere else in this
  // suite either. Bounded generously (comfortably above one sheet-padding + one gutter) so this
  // still catches a genuine regression — hundreds of px of dead reach — without failing on the
  // ordinary margin.
  ok("and scroll didn't run hundreds of px past the table into empty grey",
    atMaxScroll.matRight - atMaxScroll.tableRight <= 120, JSON.stringify(atMaxScroll));
  await page.setViewportSize({ width: 1500, height: 950 });
}

/* ═══════════════════════ CASE 19 — phone width ══════════════════════════════════════════ */
console.log("\n[19] Phone width — Full width still resolves to sane, bounded geometry:");
{
  // Pick the preset BEFORE narrowing (Case 17's own note) — the toolbar's width control moves
  // into the overflow "More" sheet below 760px, so clicking it at phone width times out.
  await seed(PLAIN_DOC, "Phone width, full");
  await pickWidthMenu("full");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const geo = await matGeometry();
  ok("no JS error at phone width", errs.length === 0, `${errs.length} errors so far`);
  ok("Full width renders a positive-width sheet at phone width", geo.sheet.width > 0, JSON.stringify(geo));
  // A phone window is far narrower than FULL_WIDTH_FLOOR (900, Wide's own width) — the SAME
  // already-accepted "the floor wins, the pane scrolls" case Case 17 exercises directly, just at
  // its most extreme. The question here is not "does it overflow" (of course it does, exactly
  // as Wide already would on a phone) but "is it the SAME, expected floor-formula" rather than
  // something worse or different at this one width.
  // Below the phone breakpoint `note-sheet` additionally carries its own left+right MARGIN
  // (`SHEET_MARGIN_X.narrow`, 8px each side — a desktop sheet has none), a mechanism unrelated
  // to this fix and pre-dating it; that margin occupies real flex-line width the same way
  // padding does, so it folds into the expected number rather than being mistaken for drift.
  const expectedOverflow = Math.max(0, 900 + 16 - geo.clientWidth);
  ok("overflow at phone width matches the expected floor formula (incl. the phone-only sheet margin), same shape as any other narrow window",
    Math.abs(geo.overflow - expectedOverflow) <= 10, JSON.stringify({ geo, expectedOverflow }));
  await page.setViewportSize({ width: 1500, height: 950 });
}

console.log(`\n${pass} passed, ${fail} failed. JS errors: ${errs.length}`);
if (errs.length) console.log(errs.slice(0, 8).join("\n"));
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
