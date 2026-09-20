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

/* ═══════ CASE 20 — B<PENDING>: body text is ROCK-STEADY for the WHOLE drag, both directions ═══
 * Owner report 2026-09-18 (re-dispatch — the first session given this item died at startup and
 * wrote nothing). Dragging the LEFT width grip outward then back inward made ALL page text judder
 * continuously for the entire gesture, in both directions. Cases 6/7 above only ever compare the
 * drag's START and END rects — exactly what this item's own acceptance bar says proves nothing,
 * because the reported defect lives entirely IN BETWEEN those two points and both endpoints were
 * already correct before this fix. This samples a real body-text element's rendered position on
 * EVERY step of a slow, real-mouse drag (a real `page.mouse.move`, never a synthetic dispatched
 * event — the "double-click needs a native event, not two dispatched ones" trap this module's own
 * `verify-notes-in-sheet-placement.mjs` already names for a different gesture applies here too:
 * a driver click is the only thing this app's `window`-bound pointer listeners ever see as real)
 * and asserts it never leaves its starting position by more than a small, real-antialiasing
 * tolerance — at three different starting widths (unpinned, an already-pinned preset, and a page
 * already sitting at a custom DRAGGED width, per the acceptance bar's own "not just the edge he
 * named" list), on both grips, plus the untouched menu-preset path as the adjacent case.
 *
 * ⛔ MECHANISM (confirmed by instrumenting the real running code with console-logged state, not
 * assumed): the reported judder was the width drag's own `apply()` writing `scroller.scrollLeft`
 * directly (an ABSOLUTE jump to the compensation needed since drag START) on every pointermove,
 * WHILE ALSO setting `sheetGrowLeft` — which independently retriggers the layout effect that holds
 * the body still by scrolling for the INCREMENTAL delta since ITS OWN last reading. Both were
 * individually correct; running both doubled the compensation every single frame, over-scrolling by
 * that frame's own delta, which the very next pointermove's absolute write then corrected — only
 * for the render right after that to reintroduce a fresh one. That correct/wrong/correct cycle,
 * once per pointermove for the whole gesture, is the shake. See NoteEditor.jsx's `apply()` (inside
 * `beginWidthDrag`) for the fix.
 *
 * ⛔ TWO THINGS MASK THIS BUG, AND BOTH HAD TO BE DESIGNED AROUND OR THIS CASE WOULD HAVE SHIPPED A
 * FALSE PASS ON THE UNFIXED CODE (caught by instrumenting the pre-fix build directly, not by
 * inspection — the very trap FOREGROUND-OR-VOID's sibling rules warn about, an instrument that
 * cannot see the thing it claims to check):
 * 1. **A UNIFORM STEP SIZE CANCELS THE ERROR.** The double-counted term is a SECOND DIFFERENCE of
 *    the padding sequence (this-step's pad delta minus last-step's), so a drag that moves the exact
 *    same distance every single step (the first version of this case did — a constant `stepDx`
 *    repeated) has that difference at zero on every step, and reports a perfect, false, rock-steady
 *    reading despite the bug being fully present underneath. Only a VARYING step size — a real
 *    hand's natural acceleration/deceleration, never perfectly even micro-steps — exposes it.
 *    `sampleDrag` below drives a fixed, deliberately uneven step sequence for exactly this reason.
 * 2. **ON A BRAND-NEW PAGE, THE FIRST EVER LEFT-DRAG HAS NO SCROLL TO CORRUPT YET.** The direct
 *    `scroller.scrollLeft = …` write happens BEFORE React has committed the wider sheet, so at that
 *    instant the scroller's own `scrollWidth` has not grown to accommodate it — the browser silently
 *    CLAMPS the assignment back to the (still-zero) max scrollable extent, so the write is a total
 *    no-op the very first time reach room does not already exist. The layout effect's own later
 *    write is what actually succeeds, alone, correctly — so an "unpinned, freshly seeded page, never
 *    touched before" starting width can pass HONESTLY while the very same bug still fires the moment
 *    any real scroll reach already exists (a prior preset pick, an earlier completed drag — i.e.
 *    ordinary continued use of the feature). This is exactly why this case's OWN acceptance bar
 *    insists on more than one starting width, including one already at a custom dragged width — the
 *    unpinned arm alone would have shipped a green suite over a live bug. */
console.log("\n[20] Frame-by-frame: body text is rock-steady across the whole drag, both edges, from multiple starting widths:");
{
  // ⛔ A WIDE VIEWPORT, DELIBERATELY — NEW-7's window-edge auto-scroll (`beginEdgeAutoScroll`,
  // triggered within 32px of the WINDOW's own edge) is a real, correct, unrelated feature, not
  // the bug this case tests for. At this file's default 1500px viewport a Wide (900) pinned
  // sheet's own right edge already renders past x=1490 — inside that 32px margin before the drag
  // even starts — so a right-edge widen from that starting width legitimately auto-scrolls the
  // whole pane, which correctly moves the body along with the camera pan and would read as a
  // false failure here (measured: it did, on the first run of this case — max drift 374px,
  // monotonic, not the reported oscillation, and traced to exactly this). A generously wide
  // window keeps every drag in this case far from that margin regardless of starting width, so
  // the only thing that can move the body here is the mechanism actually under test.
  await page.setViewportSize({ width: 2200, height: 950 });
  const LONG_DOC = { type: "doc", content: [p("The quick brown fox jumps over the lazy dog, over and over, to give this line real width to watch move.")] };

  async function bodyTextRect() {
    return page.evaluate(() => {
      const el = document.querySelector('[data-testid="note-body"] p');
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top };
    });
  }

  // ⛔ DELIBERATELY UNEVEN — a real hand never moves in perfectly uniform micro-steps, and a
  // uniform step size mathematically CANCELS this bug's own error term (see this case's header
  // comment, point 1): the double-counted amount is a SECOND DIFFERENCE of the padding sequence
  // (this step's pad delta minus the previous step's), which is identically zero when every step
  // moves the same distance. Sums to 119px in either direction.
  const UNEVEN_STEPS = [3, 8, 4, 10, 2, 9, 5, 7, 3, 11, 6, 4, 8, 2, 10, 5, 3, 9, 6, 4];

  /* Drives a real, slow, trusted-input mouse drag ONE SMALL, UNEVEN STEP AT A TIME (never
   * Playwright's own `steps:` interpolation, which only returns after the whole move completes and
   * gives no chance to sample in between), pacing each step with the MessageChannel-based
   * `pacedWait` (FOREGROUND-OR-VOID — never a raw `setTimeout`/`waitForTimeout` inside a section a
   * verdict depends on) so React's commit + the compensating layout effect land before each
   * reading. `direction` is +1 (pointer moves right) or -1 (pointer moves left). */
  async function sampleDrag(gripSelector, direction) {
    const grip = await page.evaluate((sel) => {
      const g = document.querySelector(sel);
      const r = g.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }, gripSelector);
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await pacedWait(page, 60);
    const samples = [await bodyTextRect()];
    let x = grip.x;
    for (const stepMag of UNEVEN_STEPS) {
      x += direction * stepMag;
      await page.mouse.move(x, grip.y);
      await pacedWait(page, 32);   // let the commit + compensating scroll land before reading
      samples.push(await bodyTextRect());
    }
    await page.mouse.up();
    await pacedWait(page, 250);
    return samples;
  }

  function maxDrift(samples) {
    const x0 = samples[0].left;
    const y0 = samples[0].top;
    let maxDx = 0;
    let maxDy = 0;
    for (const s of samples) {
      maxDx = Math.max(maxDx, Math.abs(s.left - x0));
      maxDy = Math.max(maxDy, Math.abs(s.top - y0));
    }
    return { maxDx: Math.round(maxDx * 100) / 100, maxDy: Math.round(maxDy * 100) / 100 };
  }

  // Real antialiasing/rounding noise across a live gesture, never a budget wide enough to hide
  // the reported defect — the pre-fix double-compensation moved the body by a step's worth of
  // pixels (single digits at minimum) on nearly every sampled step; this prints the real numbers.
  const DRIFT_TOLERANCE = 1.5;
  const assertSteady = (label, samples) => {
    const drift = maxDrift(samples);
    ok(`${label} — body text rock-steady (max drift ${JSON.stringify(drift)})`,
      drift.maxDx <= DRIFT_TOLERANCE && drift.maxDy <= DRIFT_TOLERANCE,
      JSON.stringify(samples.map((s) => Math.round(s.left * 10) / 10)));
  };

  async function dragToCustomWidth() {
    // Reach a CUSTOM (non-preset) width the same way a real user would — one real right-edge
    // drag first — so a later left-grip drag starts from "a page already at a custom width",
    // the acceptance bar's own explicit third starting case.
    const grip = await page.evaluate(() => {
      const g = document.querySelector('[data-testid="note-page-width-grip-right"]');
      const r = g.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x + 137, grip.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }

  // ⛔ "unpinned (Fit to content)" is a WEAK arm on its own, reported honestly rather than relied
  // on: a completely fresh page has no horizontal scroll reach yet, so the direct scrollLeft write
  // this bug depends on is silently clamped to zero and this arm alone can pass even on the
  // UNFIXED code (see this case's header comment, point 2 — confirmed by instrumenting the real
  // pre-fix build). The other two arms are the ones actually proving the fix: both start from a
  // page that already has real scroll reach (a completed preset pick / a completed drag), which is
  // also the ordinary, repeated-use shape a real session looks like.
  const startingWidths = [
    { label: "unpinned (Fit to content)", setup: null },
    { label: "already pinned Wide (900)", setup: () => pickWidthMenu("900") },
    { label: "already at a custom dragged width", setup: dragToCustomWidth },
  ];

  for (const { label, setup } of startingWidths) {
    await seed(LONG_DOC, `Frame sample — ${label}`);
    if (setup) await setup();
    console.log(`  -- starting width: ${label} --`);

    // The exact reported gesture: LEFT grip, widen then narrow. Widening the LEFT grip means the
    // pointer moves LEFT (direction -1); narrowing moves it back right (+1).
    assertSteady(`${label}: LEFT grip widen`, await sampleDrag('[data-testid="note-page-width-grip-left"]', -1));
    assertSteady(`${label}: LEFT grip narrow`, await sampleDrag('[data-testid="note-page-width-grip-left"]', 1));

    // The adjacent case named explicitly in the acceptance bar: the RIGHT grip too.
    assertSteady(`${label}: RIGHT grip widen`, await sampleDrag('[data-testid="note-page-width-grip-right"]', 1));
    assertSteady(`${label}: RIGHT grip narrow`, await sampleDrag('[data-testid="note-page-width-grip-right"]', -1));
  }

  // And the OTHER adjacent case: the page-width MENU presets. These never went through the
  // width-drag's `apply()` at all (confirmed by reading the code — the measurement effect that
  // backs a menu pick sets `sheetGrowLeft` with no manual `scrollLeft` write anywhere near it), so
  // there is no mid-gesture to sample — a discrete click either lands the body in the same place
  // or it does not. Checked here as the honest "was this ever broken, and does the fix leave it
  // alone" adjacent-case answer, not as a new regression risk from the drag fix itself.
  //
  // ⛔ "full" IS DELIBERATELY EXCLUDED FROM THE STEADY-BODY ASSERTION — reading the measurement
  // effect (NoteEditor.jsx, the `isFullWidthPin` branch a few screens up) shows the GUTTER
  // (`matPadX`) itself is computed differently only for "full" (`fullGutter`, pane-relative)
  // versus every numeric preset (`naturalGutter`, pin-independent, deliberately "must never move
  // because of a pin"). Moving INTO or OUT OF "full" therefore legitimately re-bases the gutter —
  // the layout effect's own documented rule, "a change in the gutter is a re-base, not a shift to
  // hide" — and the body moving with it there is correct, existing, unrelated behaviour, not a
  // defect this item is about. Narrow/Normal/Wide share the SAME gutter formula, so those three
  // stay asserted steady, and full/fit are reported for visibility only.
  console.log("  -- adjacent case: the page-width menu presets (a single commit, not a drag) --");
  await seed(LONG_DOC, "Menu presets — body text steady");
  const STEADY_GUTTER_OPTS = ["440", "580", "900"];
  const REBASE_OPTS = ["full", "fit"];
  for (const opt of [...STEADY_GUTTER_OPTS, ...REBASE_OPTS]) {
    const before = await bodyTextRect();
    await pickWidthMenu(opt);
    const after = await bodyTextRect();
    if (STEADY_GUTTER_OPTS.includes(opt)) {
      ok(`menu preset "${opt}": body text does not jump on commit (same gutter formula)`,
        Math.abs(after.left - before.left) <= DRIFT_TOLERANCE && Math.abs(after.top - before.top) <= DRIFT_TOLERANCE,
        JSON.stringify({ opt, before, after }));
    } else {
      console.log(`    (reported, not asserted — "${opt}" legitimately re-bases the gutter): ${JSON.stringify({ opt, before, after })}`);
    }
  }
  await page.setViewportSize({ width: 1500, height: 950 });
}


/* ═══════ CASE 21 — B<PENDING>: the words do not move AT ALL over a LONG, MANY-SMALL-STEP drag,
 * and they are still where they started once the pointer is released ═════════════════════════
 * Owner report 2026-09-18, round TWO on the same grip. Round one (case 20 above) removed a real
 * double-compensation and he confirmed the gross shaking is gone — but he still reported the page
 * content creeping RIGHT, in small discrete steps, while widening from the LEFT grip, verbatim:
 * *"it doesn't shake nearly as much anymore, but it does move ever so slightly to the right … in
 * little intervals … when I expand the page to the left, it slides to the right."*
 *
 * ⛔ WHY CASE 20 WAS HONESTLY GREEN OVER IT, which is the whole reason this case exists and is the
 * first thing to understand before changing either one. Case 20's instrument is not the problem —
 * it samples every step of a real mouse drag with a deliberately uneven cadence and it is right to.
 * Its hole is its FIXTURE: all three of its starting widths — unpinned (the natural 580 card),
 * Wide (900), and a custom width reached by dragging 137px wider (717) — sit at or ABOVE the
 * natural card width by construction. That is exactly the band in which this defect cannot occur,
 * so every arm reported a truthful 0.00 while the defect was live one pixel below their floor.
 * Not step count, not step size, not rounding, not device pixel ratio: all four were measured
 * directly against the deployed build and all four came back clean (60 one-pixel steps, 120 steps,
 * deviceScaleFactor 1 / 1.5 / 2.15 — every combination 0.00). The variable was WHICH PAGE.
 *
 * ⛔ THE MECHANISM, measured rather than reasoned. The left grip opens its blank margin INSIDE the
 * sheet, so the body genuinely moves right inside the scroller's content, and the only thing
 * holding the words still on screen is a compensating scroll. A scroll is a BOUNDED resource: when
 * the mat's content is narrower than the pane there is no overflow at all, the write is clamped to
 * zero, and the words slide right by exactly what could not be spent. Nothing notices, because the
 * compensation compares CONTENT-space positions and never the achieved screen position — so the
 * loss is permanent, and it is discrete, one bite per pointermove, which is what "in little
 * intervals" describes. Instrumented on the pre-fix build, the mat's own `scrollLeft` setter
 * recorded `{ before: 0, want: 140, got: 0, max: 0 }`: the browser silently refused the whole
 * compensation. Drift measured on the pre-fix build, at this case's own 138px drag:
 *     stored width 440 → +140px · 505 → +75px · 560 → +20px · 717 → 0 · 900 → 0 · unpinned → 0
 * i.e. exactly `paneWidth − 2 × gutter − pageWidth`, the mat's own slack, and zero the moment the
 * page is wide enough to have any horizontal overflow to scroll into. See `matSidePads`
 * (workspaces/notes/lib/notesPageWidth.js) for the fix — the pad is spent out of the mat's own
 * gutter first, so the body's content-space position never moves and there is nothing for a
 * clamped scroll to lose.
 *
 * ⛔ WHAT THIS CASE ASSERTS THAT CASE 20 DOES NOT, per this item's own acceptance bar:
 *   · a LONG drag in DOZENS of small hand-sized steps, not twenty large ones;
 *   · the NET displacement first sample → last, as well as the max deviation, both printed for
 *     every arm — a monotonic creep and an oscillation are different defects and a single
 *     max-deviation number cannot tell you which one you are looking at;
 *   · all FOUR directions (he reported one), so a fix cannot close his case and leave the others;
 *   · starting widths BELOW the natural card as well as at and above it — including a page at a
 *     genuinely CUSTOM stored width, which is what his repro page is;
 *   · the drag committed the width the grip was actually dragged to (B1740688 — the pad must not
 *     be counted twice on release), and the body did not move on release either (B1775312).
 *
 * ⛔ AND IT CARRIES A KNOWN-GOOD ARM, because a probe that reports "0.00, nothing moved" is
 * indistinguishable from a probe that cannot see the body at all — DRIVER-SCROLL-IS-NOT-APP-SCROLL
 * §6, and the exact asymmetry this repo keeps paying for: every discipline here proves a guard can
 * go RED on broken code and nothing forces one to go GREEN on working code. `proveSamplerSees`
 * scrolls the mat by a known amount and REQUIRES the sampler to report the body moving by exactly
 * that much; `liveness` requires each drag to have actually changed the sheet's width by about the
 * distance dragged. A run that fails either declares itself VOID rather than printing a score. */
console.log("\n[21] Long many-small-step drags — NET displacement as well as max deviation, all four directions:");
{
  // Same deliberately wide window as case 20, for the same reason: NEW-7's window-edge auto-scroll
  // is a real, correct, unrelated feature that moves the body along with the camera, and a narrow
  // window puts the RIGHT grip inside its margin before the drag even starts (measured at 1191:
  // a right-grip drag from a 700px page reported −291px of "drift" that was purely that pan).
  await page.setViewportSize({ width: 2200, height: 950 });
  const LINE = "The quick brown fox jumps over the lazy dog, over and over, to give this line real width to watch move.";

  /* 60 steps, 1–4px each, 138px total — a real hand's cadence. Uneven for case 20's own reason
   * (a uniform step size cancels the previous round's error term exactly), and SMALL because this
   * item's brief named event count as the untested variable. It is not what exposed this defect —
   * that was the fixture — but a long fine-grained drag is strictly the stronger instrument and it
   * is what a slow real drag actually looks like. */
  const LONG_STEPS = Array.from({ length: 60 }, (_, i) => [2, 3, 1, 4, 2, 3, 2, 1, 3, 2][i % 10]);
  const LONG_TRAVEL = LONG_STEPS.reduce((a, b) => a + b, 0);

  /* Re-queried every sample, never held as a handle: ProseMirror replaces the paragraph node on
   * its own schedule and a detached node's rect reads as all zeros, which looks exactly like a
   * body that slid to the far left (seen, on an earlier draft of this probe). `attached` is
   * asserted so that can never be read as a measurement. */
  async function bodyRect() {
    return page.evaluate(() => {
      const el = document.querySelector('[data-testid="note-body"] p');
      if (!el || !el.isConnected) return { attached: false, left: NaN, top: NaN };
      const r = el.getBoundingClientRect();
      const sheet = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
      const mat = document.querySelector('[data-testid="note-mat"]');
      return {
        attached: r.width > 0,
        left: r.left, top: r.top,
        sheetLeft: sheet.left, sheetRight: sheet.right, sheetWidth: sheet.width,
        scrollLeft: mat.scrollLeft, maxScroll: mat.scrollWidth - mat.clientWidth,
      };
    });
  }

  /* KNOWN-GOOD ARM. Its answer is known independently of anything under test: scroll a scroller by
   * N and whatever is inside it moves N the other way. If this does not report that, the sampler
   * is blind and every 0.00 below is worthless. */
  async function proveSamplerSees() {
    const before = await bodyRect();
    const moved = await page.evaluate(() => {
      const mat = document.querySelector('[data-testid="note-mat"]');
      const room = mat.scrollWidth - mat.clientWidth;
      if (room < 40) return 0;                      // nothing to scroll: this arm cannot run here
      mat.scrollLeft = 40;
      return mat.scrollLeft;
    });
    if (!moved) return { ran: false };
    await pacedWait(page, 80);
    const after = await bodyRect();
    await page.evaluate(() => { document.querySelector('[data-testid="note-mat"]').scrollLeft = 0; });
    await pacedWait(page, 80);
    return { ran: true, expected: -moved, observed: Math.round(after.left - before.left) };
  }

  /* One small, uneven, real-mouse step at a time — never Playwright's own `steps:` interpolation,
   * which returns only after the whole move and gives nothing to sample in between. Paced with the
   * MessageChannel `pacedWait` (FOREGROUND-OR-VOID), never a raw timeout inside a timed section. */
  async function longDrag(gripSelector, direction) {
    const grip = await page.evaluate((sel) => {
      const g = document.querySelector(sel);
      if (!g) return null;
      const r = g.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }, gripSelector);
    if (!grip) return null;
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await pacedWait(page, 60);
    const samples = [await bodyRect()];
    let x = grip.x;
    for (const step of LONG_STEPS) {
      x += direction * step;
      await page.mouse.move(x, grip.y);
      await pacedWait(page, 12);
      samples.push(await bodyRect());
    }
    const lastHeld = samples[samples.length - 1];
    await page.mouse.up();
    await pacedWait(page, 900);            // past the 600ms autosave debounce, so the commit is readable
    const released = await bodyRect();
    const x0 = samples[0].left;
    let maxDev = 0;
    for (const s of samples) if (Math.abs(s.left - x0) > Math.abs(maxDev)) maxDev = s.left - x0;
    return {
      samples, released,
      net: +(lastHeld.left - x0).toFixed(2),
      max: +maxDev.toFixed(2),
      onRelease: +(released.left - x0).toFixed(2),
      startSheet: +samples[0].sheetWidth.toFixed(1),
      endSheet: +lastHeld.sheetWidth.toFixed(1),
      releasedSheet: +released.sheetWidth.toFixed(1),
      startSheetLeft: +samples[0].sheetLeft.toFixed(1),
      endSheetLeft: +lastHeld.sheetLeft.toFixed(1),
      everyAttached: samples.every((s) => s.attached) && released.attached,
    };
  }

  // 1px of real antialiasing/layout noise across a live gesture — never a budget wide enough to
  // hide the reported defect, whose smallest measured instance on the pre-fix build was 20px.
  const NET_TOLERANCE = 1.0;
  const LEFT = '[data-testid="note-page-width-grip-left"]';
  const RIGHT = '[data-testid="note-page-width-grip-right"]';

  /* Starting widths chosen so the fixture spans BOTH sides of the boundary case 20's three arms
   * all sat on. 505 and 560 are genuinely custom stored numbers — no preset resolves to either —
   * which is the shape of his own repro page. */
  const STARTS = [
    { label: "Narrow preset (440) — below the natural card", width: 440 },
    { label: "custom 505 — below the natural card", width: 505 },
    { label: "custom 560 — just below the natural card", width: 560 },
    { label: "unpinned (Fit to content) — at the natural card", width: null },
    { label: "custom 717 — above the natural card", width: 717 },
    { label: "Wide preset (900) — well above", width: 900 },
  ];
  const ARMS = [
    { name: "LEFT widen", sel: LEFT, dir: -1, widens: true },
    { name: "LEFT narrow", sel: LEFT, dir: 1, widens: false },
    { name: "RIGHT widen", sel: RIGHT, dir: 1, widens: true },
    { name: "RIGHT narrow", sel: RIGHT, dir: -1, widens: false },
  ];

  /* The natural card width at THIS window, measured off a real unpinned page rather than
   * re-derived from the app's own constants — DRIVER-SCROLL-IS-NOT-APP-SCROLL §6: an instrument
   * that reproduces the code's own arithmetic can only ever confirm the code agrees with itself.
   * It is the content floor every drag is clamped against, and the boundary the whole fixture is
   * chosen to straddle. */
  await seed({ type: "doc", content: [p(LINE)] }, "Natural card width");
  const naturalCard = Math.round((await bodyRect()).sheetWidth);
  console.log(`  (natural card at this window, measured: ${naturalCard}px — the content floor every drag clamps against)`);

  for (const start of STARTS) {
    console.log(`  -- starting width: ${start.label} --`);
    for (const arm of ARMS) {
      const doc = { type: "doc", content: [p(LINE)] };
      if (start.width != null) doc.attrs = { pageWidth: start.width };
      await seed(doc, `Long drag — ${start.label}`);

      const sees = await proveSamplerSees();
      if (sees.ran && Math.abs(sees.observed - sees.expected) > 1) {
        ok(`${start.label} / ${arm.name} — KNOWN-GOOD ARM: a known 40px scroll moves the body 40px`,
          false, `VOID: expected ${sees.expected}, observed ${sees.observed} — the sampler is not seeing the body, every drift reading in this arm is worthless`);
        continue;
      }

      const r = await longDrag(arm.sel, arm.dir);
      if (!r) { ok(`${start.label} / ${arm.name} — grip exists`, false, "grip not rendered"); continue; }

      const detail = `net ${r.net} · max ${r.max} · on release ${r.onRelease} · sheet ${r.startSheet}→${r.endSheet}→${r.releasedSheet} · sheet left ${r.startSheetLeft}→${r.endSheetLeft}`;

      /* VACUITY GUARD — and it is a PREDICTION, not a "did anything happen at all" shrug. The
       * page must land at `max(content floor, width at mousedown ± the distance actually
       * travelled)`, where the floor is the natural card (`widthContentFloorRef`, documented, and
       * measured independently above rather than re-derived from the app's own formula). That
       * refuses three different worthless readings at once: a drag the grip never received (no
       * change), a drag the harness under- or over-drove (wrong magnitude), and the one case a
       * bare "it changed" test would wave through — a NARROWING drag on a page already sitting on
       * its floor, which correctly cannot narrow and must be asserted as holding rather than
       * skipped. `everyAttached` refuses a reading taken off a detached paragraph node, whose rect
       * is all zeros and reads exactly like a body that slid to the far left. */
      const expectedEnd = Math.max(naturalCard, r.startSheet + (arm.widens ? LONG_TRAVEL : -LONG_TRAVEL));
      ok(`${start.label} / ${arm.name} — the page ended exactly where the drag put it (not a vacuous reading)`,
        r.everyAttached && Math.abs(r.endSheet - expectedEnd) <= 2,
        `${detail} · expected end ${expectedEnd} (floor ${naturalCard})`);

      /* THE ASSERTION THIS CASE EXISTS FOR — the NET creep, first sample to last, which a max
       * deviation alone cannot separate from an oscillation. */
      ok(`${start.label} / ${arm.name} — words do not creep: NET displacement ≤ ${NET_TOLERANCE}px`,
        Math.abs(r.net) <= NET_TOLERANCE, detail);

      /* B1775312 — no judder: no sample anywhere in the gesture left the start position either. */
      ok(`${start.label} / ${arm.name} — no judder: max deviation across all ${r.samples.length} samples ≤ ${NET_TOLERANCE}px`,
        Math.abs(r.max) <= NET_TOLERANCE, detail);

      /* B1740688 — releasing must not re-derive the width with the pad counted a second time, and
       * must not move the words either. */
      ok(`${start.label} / ${arm.name} — release does not jump the words (B1775312/B1740688)`,
        Math.abs(r.onRelease) <= NET_TOLERANCE, detail);
      ok(`${start.label} / ${arm.name} — release does not re-derive the sheet's width (B1740688)`,
        Math.abs(r.releasedSheet - r.endSheet) <= 1, detail);

      /* And the width really is the one the grip was dragged to. The floor at the natural card is
       * a documented, deliberate minimum (`widthContentFloorRef`), so the expectation is the
       * larger of "where the pointer went" and that floor. */
      const stored = await storedPageWidth();
      ok(`${start.label} / ${arm.name} — committed width matches where the grip was dragged to`,
        typeof stored === "number" && Math.abs(stored - r.releasedSheet) <= 1,
        `stored=${stored} rendered=${r.releasedSheet} travel=${arm.dir > 0 ? "+" : "-"}${LONG_TRAVEL}`);

      /* The positive half of "only the border moves" — on a LEFT widen the sheet's own left
       * boundary must visibly travel outward while the words hold. Reported for the other arms. */
      if (arm.sel === LEFT && arm.widens) {
        ok(`${start.label} / ${arm.name} — the page's LEFT boundary does move outward (the border is the only thing that moves)`,
          r.startSheetLeft - r.endSheetLeft >= LONG_TRAVEL - 2, detail);
      }
    }
  }

  /* ⛔ AND THE ONE ARM THAT CANNOT RUN IN THE WIDE WINDOW: dragging the left grip PAST the mat's
   * own gutter. At 2200px the gutter is hundreds of pixels wide, so an ordinary drag never spends
   * it; at his real window it is small enough that a firm drag does, and that is the point past
   * which the gutter can no longer absorb the margin and the compensating scroll has to take over.
   * Measured on the pre-fix build this arm drifted the full slack; it is the arm that proves the
   * fix closed the class rather than moving its boundary. LEFT grip only — the right grip at this
   * window starts inside NEW-7's own window-edge auto-scroll margin (see this case's header). */
  console.log("  -- past the mat's own gutter, at his real window width (LEFT grip only) --");
  await page.setViewportSize({ width: 1191, height: 700 });
  for (const width of [440, 505, null]) {
    const doc = { type: "doc", content: [p(LINE)] };
    if (width != null) doc.attrs = { pageWidth: width };
    await seed(doc, `Past the gutter — ${width ?? "unpinned"}`);
    const grip = await page.evaluate(() => {
      const g = document.querySelector('[data-testid="note-page-width-grip-left"]');
      const r = g.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await pacedWait(page, 60);
    const first = await bodyRect();
    let x = grip.x; let maxDev = 0;
    for (let i = 0; i < 125; i++) {          // 250px, still in 2px steps
      x -= 2;
      await page.mouse.move(x, grip.y);
      await pacedWait(page, 10);
      const s = await bodyRect();
      if (Math.abs(s.left - first.left) > Math.abs(maxDev)) maxDev = s.left - first.left;
    }
    const last = await bodyRect();
    await page.mouse.up();
    await pacedWait(page, 900);
    const after = await bodyRect();
    const gutterSpent = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector('[data-testid="note-mat"]')).paddingLeft));
    const detail = `net ${(last.left - first.left).toFixed(2)} · max ${maxDev.toFixed(2)} · on release ${(after.left - first.left).toFixed(2)} · sheet ${first.sheetWidth.toFixed(0)}→${after.sheetWidth.toFixed(0)} · mat padding-left now ${gutterSpent} · scroll ${after.scrollLeft}/${after.maxScroll}`;
    /* VACUITY GUARD, on the PROPERTY rather than on the mechanism: this arm is only meaningful if
     * the drag went far enough that the mat genuinely had to scroll — which is the bounded
     * resource the whole defect lives in. Asserting the mat's own `padding-left` instead would
     * pin the fix's implementation into the test, so that number is REPORTED (it reads 0 once the
     * gutter has been spent, 171 on a build that never spends it) and never asserted. */
    ok(`past the gutter (${width ?? "unpinned"}) — the drag really needed the compensating scroll (not a vacuous reading)`,
      after.scrollLeft > 0 && after.sheetWidth - first.sheetWidth >= 200, detail);
    ok(`past the gutter (${width ?? "unpinned"}) — words do not creep: NET ≤ ${NET_TOLERANCE}px`,
      Math.abs(last.left - first.left) <= NET_TOLERANCE, detail);
    ok(`past the gutter (${width ?? "unpinned"}) — no judder: max deviation ≤ ${NET_TOLERANCE}px`,
      Math.abs(maxDev) <= NET_TOLERANCE, detail);
    ok(`past the gutter (${width ?? "unpinned"}) — release does not jump the words`,
      Math.abs(after.left - first.left) <= NET_TOLERANCE, detail);
  }
  await page.setViewportSize({ width: 1500, height: 950 });
}

console.log(`\n${pass} passed, ${fail} failed. JS errors: ${errs.length}`);
if (errs.length) console.log(errs.slice(0, 8).join("\n"));
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
