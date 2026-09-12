/* Live verification for NEW-1 (B<PENDING>) — "drag the top and bottom edges of a notes page the
 * same way the sides already drag": the page menu's Fit to content control, dragging either
 * top/bottom edge with a real mouse, the pin as a FLOOR (an anchored box needing more room than
 * the pin still grows the sheet, ordinary content shorter than the pin does not shrink it),
 * a click in newly-added blank space landing the caret, undo/redo as one step, reload
 * persistence, and PDF-PARITY — run at both a normal window and the owner's own short
 * 1191×465 window. Modelled directly on ui-audit/verify-notes-page-width.mjs. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

let pass = 0; let fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

const p = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const PLAIN_DOC = { type: "doc", content: [p("hello")] };

async function withPage(viewport, fn) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await assertMeasurable(page, "verify-notes-page-height");
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });

  async function seed(doc, title = "Height test") {
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

  async function bodyRect() {
    return page.evaluate(() => {
      const body = document.querySelector('[data-testid="note-body"]');
      const r = body.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
    });
  }

  async function storedPageHeight() {
    return page.evaluate((prefix) => {
      const raw = localStorage.getItem(`${prefix}p1`);
      return raw ? (JSON.parse(raw).attrs?.pageHeight ?? null) : undefined;
    }, PAGE_PREFIX);
  }

  /* ⛔ DRIVER-SCROLL-IS-NOT-APP-SCROLL / NOTES-CARRY-FORWARD trap #18 — a rect computed for a
   * grown page can land OUTSIDE this test's own viewport (the height feature routinely grows the
   * body past a short window's own height), and a raw `page.mouse.move` to an off-viewport
   * coordinate silently does nothing. Scroll the target into view FIRST, then re-measure its
   * rect AFTER scrolling — never trust a rect computed before the scroll that was supposed to
   * happen.
   *
   * ⛔ AND NATIVE `Element.scrollIntoView()` IS ITS OWN TRAP HERE — it walks EVERY scrollable
   * ancestor, and this app shell has an `overflow: hidden` wrapper above `note-mat` that a real
   * user's mouse wheel can never scroll (no scrollbar, not wheel-reachable) but that
   * `scrollIntoView` happily nudges anyway (measured: scrollTop 0 → 119 on a container no real
   * gesture touches), which then falsely reads as the APP moving content. Scroll `note-mat`
   * directly instead — the one container a real user's wheel actually reaches. */
  async function scrollMatToShow(testid) {
    return page.evaluate((id) => {
      const mat = document.querySelector('[data-testid="note-mat"]');
      const el = document.querySelector(`[data-testid="${id}"]`);
      const matRect = mat.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.bottom > matRect.bottom) mat.scrollTop += (r.bottom - matRect.bottom) + 20;
      else if (r.top < matRect.top) mat.scrollTop -= (matRect.top - r.top) + 20;
    }, testid);
  }
  /* ⛔ AND A THIRD, PRE-EXISTING WRINKLE, VERIFIED VIA `git stash` TO PREDATE THIS FEATURE
   * ENTIRELY: at the owner's own short 1191×465 window, `note-mat`'s own bounding box is
   * ALREADY taller than the viewport (measured on unmodified `main`: clientHeight 480 against a
   * 465px-tall window) even with a single "hello" paragraph — a pre-existing app-shell layout
   * characteristic this item did not introduce and is out of scope to fix here. `scrollMatToShow`
   * alone cannot reach a target sitting in that clipped sliver (scrolling `note-mat`'s own
   * content does nothing when the ELEMENT itself, not its content, is what is clipped) — so this
   * falls back to native `scrollIntoView` ONLY when still out of the window's bounds afterward.
   * Callers that need pixel-precise geometry (does the opposite edge hold EXACTLY still) run at
   * the normal window size, where this fallback is never needed. */
  async function ensureInWindow(testid) {
    await scrollMatToShow(testid);
    const stillOut = await page.evaluate((id) => {
      const r = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
      return r.top < 0 || r.bottom > window.innerHeight;
    }, testid);
    if (stillOut) {
      await page.evaluate((id) => {
        document.querySelector(`[data-testid="${id}"]`).scrollIntoView({ block: "nearest" });
      }, testid);
    }
  }
  async function gripCenter(testid) {
    await ensureInWindow(testid);
    return page.evaluate((id) => {
      const g = document.querySelector(`[data-testid="${id}"]`);
      const r = g.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }, testid);
  }

  /* Same trap as `gripCenter`, and reuses its own `ensureInWindow` (never a special-cased
   * `scrollTop = scrollHeight`, which does not itself check the top bound and was caught landing
   * a click point at a NEGATIVE y — off-screen above the window — on exactly the pre-existing
   * wrinkle `ensureInWindow`'s own header describes). `offset` is how far above the (now visible)
   * bottom edge to click, into the newly-grown blank area. */
  async function pointNearBodyBottom(offset) {
    await ensureInWindow("note-body");
    return page.evaluate((off) => {
      const body = document.querySelector('[data-testid="note-body"]');
      const r = body.getBoundingClientRect();
      return { x: Math.round(r.left + Math.min(300, r.width / 2)), y: Math.round(Math.min(r.bottom, window.innerHeight - 4) - off) };
    }, offset);
  }

  await fn({ page, seed, bodyRect, storedPageHeight, gripCenter, pointNearBodyBottom });
  return errs;
}

/* ═══════════════════════ NORMAL WINDOW ═══════════════════════════════════════════════════ */
console.log(`\n[NORMAL WINDOW 1500×950]`);
const errsA = await withPage({ width: 1500, height: 950 }, async ({ page, seed, bodyRect, storedPageHeight, gripCenter, pointNearBodyBottom }) => {
  /* ── CASE 1 — default is Fit to content, and the menu says so ─────────────────────────── */
  console.log("\n[1] Default (unpinned) page:");
  {
    await seed(PLAIN_DOC, "Default height");
    const stored = await storedPageHeight();
    ok("stores no height pin at all", stored === null, `stored=${stored}`);
    await page.click('[data-testid="nt-page-height"]');
    const label = await page.textContent('[data-testid="nt-page-height"]');
    ok("Page height menu trigger reads Fit to content", label.includes("Fit to content"), label);
    await page.keyboard.press("Escape");
  }

  /* ── CASE 2 — drag the BOTTOM edge down: grows, top holds ──────────────────────────────── */
  console.log("\n[2] Drag the bottom edge down — the top edge holds:");
  {
    await seed(PLAIN_DOC, "Drag bottom");
    const before = await bodyRect();
    const grip = await gripCenter("note-page-height-grip-bottom");
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) await page.mouse.move(grip.x, grip.y + 20 * i, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await bodyRect();
    ok("the body grew by roughly the drag distance", after.height >= before.height + 150, JSON.stringify({ before, after }));
    ok("the TOP edge did not move", Math.abs(after.top - before.top) <= 2, JSON.stringify({ before, after }));
    ok("the menu now reads Custom", (await page.textContent('[data-testid="nt-page-height"]')).includes("Custom"));

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
    await page.waitForTimeout(900);
    const persisted = await bodyRect();
    ok("the dragged height survives a reload", persisted.height >= before.height + 150, JSON.stringify(persisted));
    ok("stores a numeric pin", typeof (await storedPageHeight()) === "number");

    // Drag it back shorter.
    const grip2 = await gripCenter("note-page-height-grip-bottom");
    await page.mouse.move(grip2.x, grip2.y);
    await page.mouse.down();
    await page.mouse.move(grip2.x, grip2.y - 150, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const shortenedBack = await bodyRect();
    ok("dragging the bottom edge back shortens the page again", shortenedBack.height < persisted.height, JSON.stringify({ persisted, shortenedBack }));
  }

  /* ── CASE 3 — drag the TOP edge up: grows, bottom holds ────────────────────────────────── */
  console.log("\n[3] Drag the top edge up — the bottom edge holds:");
  {
    await seed(PLAIN_DOC, "Drag top");
    const before = await bodyRect();
    const grip = await gripCenter("note-page-height-grip-top");
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) await page.mouse.move(grip.x, grip.y - 20 * i, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await bodyRect();
    ok("the body grew by roughly the drag distance", after.height >= before.height + 150, JSON.stringify({ before, after }));
    ok("the BOTTOM edge stayed close to where it started (within rounding noise)", Math.abs(after.bottom - before.bottom) <= 15, JSON.stringify({ before, after }));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
    await page.waitForTimeout(900);
    const persisted = await bodyRect();
    ok("the top-dragged height survives a reload", persisted.height >= before.height + 150, JSON.stringify(persisted));
  }

  /* ── CASE 4 — the pin is a FLOOR, not a cap ─────────────────────────────────────────────── */
  console.log("\n[4] A pinned-short page with an anchored box needing more room still grows:");
  {
    const anchor = {
      type: "noteAnchor",
      attrs: { id: "b1", x: 40, y: 40, w: 260, h: null },
      content: [p("row1"), p("row2"), p("row3"), p("row4"), p("row5"), p("row6"), p("row7"), p("row8"), p("row9"), p("row10")],
    };
    const tallDoc = { type: "doc", content: [anchor, p("flow")] };
    await seed(tallDoc, "Short pin, tall box");
    // ⛔ A DRAG CANNOT COMMIT BELOW THE BOX'S OWN NEED — its live floor (`baseGrowHeight`,
    // captured from `heightContentFloorRef` at drag start) already refuses it, mirroring
    // `beginWidthDrag`'s identical protection. So a pin genuinely SHORTER than the box's real
    // need has to arrive some other way — there is no height preset menu (unlike width's
    // Narrow/Normal/Wide), so this reaches the same `setNotePageHeight` command a menu would,
    // through the same `__noteEditor` test hook every other harness in this module uses.
    const beforePin = await bodyRect();
    await page.evaluate(() => window.__noteEditor.runCommand("setNotePageHeight", 200));
    await page.waitForTimeout(900);   // clear the 600ms autosave debounce (NOTES-CARRY-FORWARD trap #3)
    const rect = await bodyRect();
    const stored = await storedPageHeight();
    ok(`a genuinely short pin is stored as asked (stored=${stored})`, stored === 200);
    ok("a tall anchored box still pushes the body past the short pin — the floor never clips content",
      rect.height >= beforePin.height, `beforePin=${beforePin.height} stored=${stored} height=${rect.height}`);
  }

  console.log("\n[4b] A pinned-tall page whose content is short stays tall:");
  {
    await seed(PLAIN_DOC, "Tall pin, plain content");
    const grip = await gripCenter("note-page-height-grip-bottom");
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x, grip.y + 400, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(900);   // clear the 600ms autosave debounce (NOTES-CARRY-FORWARD trap #3)
    const rect = await bodyRect();
    const stored = await storedPageHeight();
    ok(`a tall-pinned page with ordinary short content still renders at (about) the pin, not shrunk to fit the text (stored=${stored}, height=${rect.height})`,
      typeof stored === "number" && rect.height >= stored - 5);
  }

  /* ── CASE 5 — return to Fit to content ──────────────────────────────────────────────────── */
  console.log("\n[5] \"Fit to content\" clears a height pin:");
  {
    await seed(PLAIN_DOC, "Return to fit");
    const natural = await bodyRect();
    const grip = await gripCenter("note-page-height-grip-bottom");
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x, grip.y + 300, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const grown = await bodyRect();
    ok("grew from the drag", grown.height > natural.height, JSON.stringify({ natural, grown }));
    await page.click('[data-testid="nt-page-height"]');
    await page.click('[data-testid="nt-page-height-opt-fit"]');
    await page.waitForTimeout(900);
    const back = await bodyRect();
    ok("Fit to content returns to the natural (unpinned) height", back.height === natural.height, JSON.stringify({ natural, back }));
    ok("Fit to content clears the stored pin", (await storedPageHeight()) === null);
  }

  /* ── CASE 6 — click in the newly-added blank area lands the caret ──────────────────────── */
  console.log("\n[6] Clicking in the grown blank area (below the last line) places the caret:");
  {
    await seed(PLAIN_DOC, "Click grown area");
    const before = await bodyRect();
    const grip = await gripCenter("note-page-height-grip-bottom");
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x, grip.y + 300, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const grown = await bodyRect();
    ok("grew", grown.height > before.height + 200, JSON.stringify({ before, grown }));
    // Click well below the last line of text, inside the newly-added blank body area.
    const pt = await pointNearBodyBottom(40);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(150);
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return { isEditor: !!el?.closest?.(".ProseMirror"), hasSelection: !document.getSelection().isCollapsed || document.getSelection().anchorNode != null };
    });
    ok("the click landed the caret in the document (the editor is focused)", focused.isEditor, JSON.stringify(focused));
  }

  /* ── CASE 7 — undo/redo of a height drag is ONE step ────────────────────────────────────── */
  console.log("\n[7] Undo/redo of a height drag is a single step:");
  {
    await seed(PLAIN_DOC, "Undo height");
    const before = await bodyRect();
    const grip = await gripCenter("note-page-height-grip-bottom");
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x, grip.y + 300, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await bodyRect();
    ok("height changed", after.height > before.height, JSON.stringify({ before, after }));
    await page.click('[data-testid="note-body"] p');
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(250);
    const undone = await bodyRect();
    ok("Ctrl+Z undoes the whole height change in one step", undone.height === before.height, JSON.stringify({ before, undone }));
    await page.keyboard.press("Control+y");
    await page.waitForTimeout(250);
    const redone = await bodyRect();
    ok("Ctrl+Y redoes it", redone.height === after.height, JSON.stringify({ after, redone }));
  }

  /* ── CASE 8 — a click with no movement commits nothing ──────────────────────────────────── */
  console.log("\n[8] A plain click on a grip (no drag) writes nothing:");
  {
    await seed(PLAIN_DOC, "Click no drag");
    const before = await bodyRect();
    const beforeStored = await storedPageHeight();
    const grip = await gripCenter("note-page-height-grip-bottom");
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await bodyRect();
    ok("height unchanged", after.height === before.height, JSON.stringify({ before, after }));
    ok("nothing was stored", (await storedPageHeight()) === beforeStored);
  }

  /* ── CASE 9 — DO NOT REGRESS: width side drags still work alongside the height feature ──── */
  console.log("\n[9] DO NOT REGRESS — the width side grips still drag independently:");
  {
    await seed(PLAIN_DOC, "Width still works");
    const sheetBefore = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="note-sheet"]');
      return Math.round(s.getBoundingClientRect().width);
    });
    const grip = await gripCenter("note-page-width-grip-right");
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x + 150, grip.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const sheetAfter = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="note-sheet"]');
      return Math.round(s.getBoundingClientRect().width);
    });
    ok("the width grip still widens the sheet with the height grips present", sheetAfter > sheetBefore + 100, JSON.stringify({ sheetBefore, sheetAfter }));
  }

  /* ── CASE 10 — PDF-PARITY ────────────────────────────────────────────────────────────────── */
  console.log("\n[10] PDF-PARITY — the real toolbar Print button:");
  {
    await seed(PLAIN_DOC, "Print height");
    const grip = await gripCenter("note-page-height-grip-bottom");
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x, grip.y + 500, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const stored = await storedPageHeight();
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
      ok(`a numeric height pin (stored=${stored}) reserves at least that much of the printed sheet`,
        printed.style.includes("min-height") && /min-height:\s*(\d+)px/.test(printed.style)
          && parseInt(printed.style.match(/min-height:\s*(\d+)px/)[1], 10) >= (stored || 0) - 5,
        printed.style);
    }
  }

  console.log("\n[11] Fit to content prints with no forced min-height:");
  {
    await seed(PLAIN_DOC, "Print unpinned height");
    await page.click('[data-testid="nt-print"]');
    await page.waitForTimeout(600);
    const printed = await page.evaluate(() => {
      const frame = document.querySelector('[data-testid="notes-print-frame"]');
      const pdoc = frame?.contentDocument;
      const sheet = pdoc?.querySelector(".sheet");
      return sheet?.getAttribute("style") || "";
    });
    ok("an unpinned page prints with no forced min-height override", !printed.includes("min-height"), printed);
  }

  await page.close();
});

/* ═══════════════════════ THE OWNER'S OWN SHORT WINDOW, 1191×465 ═══════════════════════════ */
console.log(`\n[OWNER'S WINDOW 1191×465]`);
const errsB = await withPage({ width: 1191, height: 465 }, async ({ page, seed, bodyRect, storedPageHeight, gripCenter, pointNearBodyBottom }) => {
  console.log("\n[12] Drag the bottom edge down at 1191×465:");
  {
    await seed(PLAIN_DOC, "Short window bottom drag");
    // The grip is fetched (and, if needed, scrolled into view) BEFORE "before" is measured, so
    // both readings come from the same scroll frame — see `ensureInWindow`'s own header.
    const grip = await gripCenter("note-page-height-grip-bottom");
    const before = await bodyRect();
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(grip.x, grip.y + 15 * i, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await bodyRect();
    ok("grows at the short window too", after.height > before.height + 80, JSON.stringify({ before, after }));
    ok("top holds", Math.abs(after.top - before.top) <= 2, JSON.stringify({ before, after }));
  }

  console.log("\n[13] Drag the top edge up at 1191×465, then reload:");
  {
    await seed(PLAIN_DOC, "Short window top drag");
    const grip = await gripCenter("note-page-height-grip-top");
    const before = await bodyRect();
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(grip.x, grip.y - 15 * i, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await bodyRect();
    ok("grows", after.height > before.height + 80, JSON.stringify({ before, after }));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
    await page.waitForTimeout(900);
    const persisted = await bodyRect();
    ok("survives a reload at the short window", persisted.height > before.height + 80, JSON.stringify(persisted));
  }

  console.log("\n[14] Clicking in the grown blank area at 1191×465 places the caret:");
  {
    await seed(PLAIN_DOC, "Short window click");
    const grip = await gripCenter("note-page-height-grip-bottom");
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x, grip.y + 300, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const pt = await pointNearBodyBottom(30);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(150);
    const focused = await page.evaluate(() => !!document.activeElement?.closest?.(".ProseMirror"));
    ok("caret lands even at the short window", focused);
  }

  await page.close();
});

const errs = [...errsA, ...errsB];
console.log(`\n${pass} passed, ${fail} failed. JS errors: ${errs.length}`);
if (errs.length) console.log(errs.slice(0, 8).join("\n"));
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
