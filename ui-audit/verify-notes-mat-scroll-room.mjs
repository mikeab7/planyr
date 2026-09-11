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
 */
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
}

/* ═══ 3. AT MAXIMUM SCROLL THERE IS REAL GREY TO WORK IN — his own repro, both axes ══════════ */
console.log("\n" + "=".repeat(100));
console.log("3. MAXIMUM SCROLL REACHES WELL PAST THE SHEET — 'ten pixels of grey' is gone");
console.log("=".repeat(100));
for (const [label, doc] of [["short page", SHORT_DOC], ["long page", LONG_DOC]]) {
  const page = await open(doc);
  const g = await geom(page);
  const bottomReach = g.matScrollH - g.matClientH;
  const rightReach = g.matScrollW - g.matClientW;
  ok(`${label}: scrolling to the bottom reaches well past the sheet's own bottom edge`,
    bottomReach >= 300, `mat scrollH ${g.matScrollH} vs clientH ${g.matClientH} (${bottomReach}px of scroll travel)`);
  ok(`${label}: scrolling to the right reaches well past the sheet's own right edge`,
    rightReach >= 250, `mat scrollW ${g.matScrollW} vs clientW ${g.matClientW} (${rightReach}px of scroll travel)`);
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
