/* verify-notes-mat-scroll-room — B1550977/NEW-2: THE MAT MUST HAVE SOMEWHERE TO SCROLL TO,
 * WHETHER ANYTHING IS PARKED THERE YET OR NOT (owner report 2026-09-11).
 *
 * ⛔ THE MEASURED CAUSE. `anchorExtent`/`anchorExtentX` only grow `note-sheet` to hold a box that
 * ALREADY overhangs it — before anything is placed, that math reports zero need, so the mat's own
 * scrollable content was exactly the sheet's size plus a sliver: his own numbers, scrollHeight 452
 * vs a 330 clientHeight, sheet bottom at y=455 against a mat bottom of y=465 — ten pixels of grey
 * at MAXIMUM scroll. There was nowhere to work.
 *
 * ⛔ WHY THE FIRST DRAFT OF THIS FIX BROKE THE SHEET, AND WHY THIS HARNESS ALSO CHECKS SHEET
 * WIDTH. `note-sheet` sizes itself with `width: "100%"` when ungrown, resolved against
 * `note-mat`'s own content box — and `matPadX` (the centring gutter) is chosen so that
 * `paneWidth - 2×matPadX ≈ naturalSheetWidth`. Adding the extra reach as MORE padding on
 * `note-mat` breaks that equation and silently narrows the sheet by the exact amount added — a
 * real regression this repo's own `verify-notes-free-placement` caught (a naturally-580px sheet
 * rendered at its 260px floor). The shipped fix is a normal-flow SPACER sibling instead, which
 * cannot touch what "100%" means to the sheet. Section 1 below is the sheet-width regression
 * guard for that; sections 2–3 are the owner's own repro.
 *
 * ⛔ NARROWED (B1344625/B1344626, owner report 2026-09-15) — THE UNCONDITIONAL FLAT RESERVE
 * ABOVE BECAME ITS OWN BUG. Always reserving 320/480px past the sheet, on every note, is what
 * produced "every note can be scrolled sideways into empty space" (331px of dead horizontal
 * scroll on a 569px page) and "half a screen of dead grey under every short note" (the flat
 * 480px bottom pad was taller than the owner's own 465px-tall window). Section 3 below now
 * asserts the CORRECTED shape: the BOTTOM reach is still unconditional but PROPORTIONAL to the
 * pane's own height, capped at the old 480 (`matExtraBottomFor`'s own reasoning in
 * NoteEditor.jsx); the RIGHT reach is genuinely a SWITCH now — ~0 at rest, and only present
 * while a real box gesture (a drag or a resize) is in flight, which is the one moment
 * B1550977's own report was actually describing. Section 3b is the new regression guard for
 * that switch. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

const failures = [];
const ok = (label, cond, detail) => {
  console.log(`${cond ? "✓" : "⛔"} ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

const SHORT_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "A short note." }] }],
};

const longParas = Array.from({ length: 24 }, (_, i) => ({
  type: "paragraph", content: [{ type: "text", text: `Line ${i + 1} of a long note that fills the page.` }],
}));
const LONG_DOC = { type: "doc", content: longParas };

/* A box that sits WELL WITHIN the sheet's own natural (ungrown) bounds — unlike RIGHT_BOX_DOC
 * below, this one must NOT itself force the sheet to grow, so "at rest" (section 3b) measures
 * the gesture-only reach in isolation rather than the box's own, unrelated, already-correct
 * growth reach (which section 4 already covers). */
const SMALL_BOX_DOC = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Body." }] },
    { type: "noteAnchor", attrs: { x: 60, y: 100, w: 140, h: null, aid: "small1" },
      content: [{ type: "paragraph", content: [{ type: "text", text: "small box" }] }] },
  ],
};

/** A box positioned so it needs the sheet to grow — the far-right reachability case. */
const RIGHT_BOX_DOC = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Body." }] },
    { type: "noteAnchor", attrs: { x: 700, y: 120, w: 180, h: null, aid: "r1" },
      content: [{ type: "paragraph", content: [{ type: "text", text: "FAR RIGHT BOX" }] }] },
  ],
};

async function open(doc, width = 1280) {
  const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
  page.on("pageerror", (e) => console.log("   PAGEERROR", String(e.message).slice(0, 160)));
  await assertMeasurable(page, "verify-notes-mat-scroll-room");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  await page.evaluate(([tk, pk, d]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Reach", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, doc]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 700);
  return page;
}

const geom = (page) => page.evaluate(() => {
  const sheet = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
  const mat = document.querySelector('[data-testid="note-mat"]');
  const matRect = mat.getBoundingClientRect();
  return {
    sheetW: Math.round(sheet.width), sheetH: Math.round(sheet.height),
    sheetL: Math.round(sheet.left - matRect.left), sheetT: Math.round(sheet.top - matRect.top),
    matScrollW: mat.scrollWidth, matScrollH: mat.scrollHeight,
    matClientW: mat.clientWidth, matClientH: mat.clientHeight,
    scrollLeft: mat.scrollLeft, scrollTop: mat.scrollTop,
  };
});

/* ═══ 1. THE SHEET'S OWN WIDTH MUST NOT NARROW — the regression this fix's first draft caused ═ */
console.log("\n" + "=".repeat(100));
console.log("1. THE SHEET STILL RENDERS AT ITS NATURAL WIDTH — the shipped-and-reverted regression");
console.log("=".repeat(100));
{
  const page = await open(SHORT_DOC);
  const g = await geom(page);
  ok("an ungrown sheet on a wide window renders at its full natural width (580px), not its floor",
    g.sheetW >= 570, `sheet width ${g.sheetW}px`);
  await page.context().close();
}

/* ═══ 2. A SHORT PAGE'S DEFAULT VIEW IS UNCHANGED — no permanent gap, still centred ═══════════ */
console.log("\n" + "=".repeat(100));
console.log("2. A SHORT PAGE STILL LOOKS CENTRED AND SETTLED AT REST — the extra room is invisible");
console.log("   until you actually scroll for it");
console.log("=".repeat(100));
{
  const page = await open(SHORT_DOC);
  const g = await geom(page);
  ok("nothing auto-scrolls on load", g.scrollLeft === 0 && g.scrollTop === 0,
    `scrollLeft ${g.scrollLeft}, scrollTop ${g.scrollTop}`);
  ok("the sheet sits at a real left gutter (still visually centred), not flush against the mat",
    g.sheetL >= 60, `sheet left offset ${g.sheetL}px into the mat`);
  ok("the sheet sits near the mat's own top (a real page, not stranded in a tall empty canvas)",
    g.sheetT >= 0 && g.sheetT < 40, `sheet top offset ${g.sheetT}px into the mat`);
  /* ⛔ B1344626 — this context was left open here, so section 3's own freshly-opened pages ran
     alongside it rather than as the sole foreground tab. That went unnoticed while the bottom
     reach was a flat constant (immune to timing), but B1344626 made it a live ResizeObserver
     measurement — and a background tab's ResizeObserver delivery is exactly the class
     FOREGROUND-OR-VOID warns about: measured live, a still-open sibling context here left
     section 3's `mat.offsetHeight` reading stuck at a pre-settle value (472 instead of 774),
     reproducibly. Closing it is the fix, not loosening the assertion. */
  await page.context().close();
}

/* ═══ 3. THE BOTTOM REACH IS PROPORTIONAL, NOT A FLAT RESERVE (B1344626) ════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("3. BOTTOM SCROLL ROOM IS PROPORTIONAL TO THE PANE, CAPPED AT THE OLD 480 — never a flat reserve");
console.log("=".repeat(100));
for (const [label, doc] of [["short page", SHORT_DOC], ["long page", LONG_DOC]]) {
  const page = await open(doc);
  const g = await geom(page);
  /* ⛔ ASSERT ON THE PADDING ITSELF, NOT ON `scrollHeight − clientHeight`. The reach is real
     scroll travel only once content + padding together exceed the pane — for a genuinely SHORT
     note (one line, a tall window) the natural content is shorter than the pane even before the
     padding is added, so `scrollHeight − clientHeight` reads LESS than the padding itself (it is
     `content + padding − clientHeight`, which is only equal to the padding when content already
     fills the pane) — that was this harness's own first-draft bug, not the app's: it inferred the
     padding indirectly and conflated it with how tall the note's own content happens to be. The
     computed style is the direct, unambiguous read. */
  const paddingBottom = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('[data-testid="note-mat"]')).paddingBottom));
  const expected = Math.min(480, Math.round(g.matClientH * 0.4));
  ok(`${label}: the mat's own bottom padding is proportional to the pane's own height (≈${expected}px), not a flat 480`,
    Math.abs(paddingBottom - expected) <= 5,
    `paddingBottom ${paddingBottom}px vs clientH ${g.matClientH} (expected ≈${expected}px)`);
  await page.context().close();
}

/* ═══ 3b. THE RIGHT REACH IS A SWITCH NOW, NOT A FLAT RESERVE (B1344625) ════════════════════
 * At REST (nothing being dragged) a note that fits the pane has ~0 horizontal scroll — the
 * owner's own bar ("no horizontal scroll at all" for a page that fits). A real box gesture
 * (pressing down on an anchored box, `.planyr-anchor`) reintroduces the full `MAT_EXTRA_RIGHT`
 * reach for the duration of the press, which is the one moment B1550977's original report was
 * actually about. */
console.log("\n" + "=".repeat(100));
console.log("3b. RIGHT SCROLL ROOM IS ~0 AT REST, AND REAPPEARS WHILE A BOX GESTURE IS IN FLIGHT");
console.log("=".repeat(100));
{
  // SMALL_BOX_DOC, not RIGHT_BOX_DOC — a box that sits within the sheet's OWN natural bounds,
  // so "at rest" measures the gesture-only reach alone rather than RIGHT_BOX_DOC's own,
  // already-correct, unrelated growth reach (that box's own committed position already forces
  // the sheet wider than the pane, independent of any gesture — section 4 covers that case).
  const page = await open(SMALL_BOX_DOC);
  const atRest = await page.evaluate(() => {
    const mat = document.querySelector('[data-testid="note-mat"]');
    return { scrollW: mat.scrollWidth, clientW: mat.clientWidth };
  });
  const restReach = atRest.scrollW - atRest.clientW;
  ok("at rest, the right reach is ~0 — no permanent phantom scroll",
    restReach <= 10, `mat scrollW ${atRest.scrollW} vs clientW ${atRest.clientW} (${restReach}px)`);

  // Press down on the box (a real pointerdown, left in place without releasing — this is
  // exactly what `boxGestureActive` keys off) and re-measure while the gesture is still live.
  const box = page.locator('.planyr-anchor[data-anchor-id="small1"]');
  const boxBox = await box.boundingBox();
  await page.mouse.move(boxBox.x + 5, boxBox.y + 5);
  await page.mouse.down();
  await page.waitForTimeout(150);
  const midGesture = await page.evaluate(() => {
    const mat = document.querySelector('[data-testid="note-mat"]');
    return { scrollW: mat.scrollWidth, clientW: mat.clientWidth };
  });
  await page.mouse.up();
  const gestureReach = midGesture.scrollW - midGesture.clientW;
  ok("mid-gesture (pointer still down on the box), the right reach returns to the full MAT_EXTRA_RIGHT",
    gestureReach >= 250, `mat scrollW ${midGesture.scrollW} vs clientW ${midGesture.clientW} (${gestureReach}px)`);

  await page.waitForTimeout(150);
  const afterRelease = await page.evaluate(() => {
    const mat = document.querySelector('[data-testid="note-mat"]');
    return { scrollW: mat.scrollWidth, clientW: mat.clientWidth };
  });
  const releaseReach = afterRelease.scrollW - afterRelease.clientW;
  ok("after releasing, the extra reach retracts again",
    releaseReach <= 10, `mat scrollW ${afterRelease.scrollW} vs clientW ${afterRelease.clientW} (${releaseReach}px)`);
  await page.context().close();
}

/* ═══ 4. HIS OWN MEASURED CASE — a box past the sheet's right edge is FULLY reachable ═════════ */
console.log("\n" + "=".repeat(100));
console.log("4. A BOX PAST THE SHEET'S RIGHT EDGE IS FULLY REACHABLE AT MAX SCROLL — not 'just barely'");
console.log("=".repeat(100));
{
  const page = await open(RIGHT_BOX_DOC);
  const mat = page.locator('[data-testid="note-mat"]');
  await mat.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await pacedWait(page, 200);
  const box = await page.evaluate(() => {
    const el = document.querySelector('.planyr-anchor[data-anchor-id="r1"]');
    const r = el.getBoundingClientRect();
    const mat = document.querySelector('[data-testid="note-mat"]');
    const matRect = mat.getBoundingClientRect();
    return { right: Math.round(r.right), matRight: Math.round(matRect.right), scrollLeft: mat.scrollLeft, scrollWidth: mat.scrollWidth };
  });
  ok("the box's own right edge (including its own comfortable margin) is within the mat's visible viewport at max scroll",
    box.right <= box.matRight, `box right ${box.right} vs mat viewport right ${box.matRight}`);
  await page.context().close();
}

console.log("\n" + "=".repeat(100));
if (failures.length) { console.log(`⛔ ${failures.length} FAILED:\n  ${failures.join("\n  ")}`); process.exitCode = 1; }
else console.log("✓ every case passed");
await browser.close();
