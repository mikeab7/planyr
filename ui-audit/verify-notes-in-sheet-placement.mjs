/* verify-notes-in-sheet-placement — DOUBLE-CLICKING BLANK PAPER *INSIDE* THE SHEET STARTS A BOX
 * THERE (NEW-1, owner report 2026-09-18, fifth round on one symptom).
 *
 * ⛔ HIS WORDS: *"It's like anything to the right of a line picks up that there's a line of text
 * already. So even if — and I'm just going to use measurements so it makes sense — let's say the
 * line is five inches long. Even if I click a spot 10 inches out, as long as it's horizontally
 * aligned, it still goes to the original line. So it doesn't work at all."*
 *
 * ⛔ WHY FOUR PRIOR ROUNDS MISSED IT, AND IT IS THE WHOLE REASON THIS FILE EXISTS. Every one of
 * them verified the GREY MAT create path — outside the sheet — because a project review had
 * recorded as settled fact that *"double-clicking inside the page body selects a word, which is
 * correct text behaviour, so the create gesture only fires in the grey mat outside the sheet."*
 * That premise was never challenged, and it is the bug. He has been clicking INSIDE the sheet the
 * whole time. So every case below is driven INSIDE the white page, and the grey mat appears only
 * as a must-not-regress arm.
 *
 * ⛔ THE MECHANISM, MEASURED not reasoned: `pressIsBesideLine` (NoteEditor.jsx) tests ONLY the
 * vertical axis — it asks whether the press sits within one line-height of the nearest text
 * position and never looks at `clientX` at all. A press ten inches right of a five-inch line is
 * therefore "beside" that line, is forwarded to the caret at its end, and the next character
 * lands in his sentence instead of in a new box. That is his geometry exactly.
 *
 * ⛔ WHAT IS *NOT* ACCEPTANCE HERE, because each has already produced a false pass on this item:
 * the absence of the old padding-paragraph/text-align hack · the alignment value of the new
 * block · "text appeared" · text landing left-aligned at the end of the document (that IS the
 * bug). The only thing that counts is the RENDERED POSITION of the new box against the
 * coordinates that were actually clicked, plus the flow text being left alone.
 *
 * Traps honoured, from docs/NOTES-CARRY-FORWARD.md §1: a REAL mouse, and specifically
 * `page.mouse.dblclick()` — two separate down/up pairs NEVER form a native double-click in this
 * sandbox (trap 32) · reads after the 600ms save debounce · `assertMeasurable` before any
 * measurement (FOREGROUND-OR-VOID) · a flow-text lookup by its own TEXT, never by DOM position
 * (trap 21) · every section closes its own context (trap 29) · computed click points are checked
 * against the viewport before being clicked (trap 18).
 *
 * ⛔ AND IT CARRIES KNOWN-GOOD ARMS (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): double-click-on-a-word
 * and the grey-mat press both have answers known INDEPENDENTLY of the change under test. If
 * either fails to report its known value the run declares itself VOID rather than printing a
 * score — a probe that cannot see the thing it is pointed at cannot vouch for anything else.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node ui-audit/verify-notes-in-sheet-placement.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

/* The box's top-left is placed at the press point (`placeAnchor` keeps the chosen point exactly
 * and spends the WIDTH instead — see its own header), so the tolerance here is for rounding and
 * the anchor's own border, not for a policy. Anything looser would stop being an assertion about
 * WHERE the box went, which is the only thing this file is allowed to accept. */
const POS_TOL = 6;

const failures = [];
const voids = [];
const ok = (label, cond, detail) => {
  console.log(`${cond ? "✓" : "⛔"} ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
  if (!cond) failures.push(label);
};
const known = (label, cond, detail) => {
  console.log(`${cond ? "✓" : "⛔"} [known-good] ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
  if (!cond) voids.push(label);
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

/* ⛔ A WIDE PAGE, DELIBERATELY. On a narrow sheet there is barely any blank paper to the right of
 * a line, which is exactly how four rounds managed to miss this — his own pages are wide. The
 * lines are short and sit in the left third, reproducing the contact-list shape he described. */
const LINES = [
  "MUD 377",
  "Engineer - Pape Dawson",
  "Dustin O'Neal",
  "P: 713-428-2400",
  "Water Authority: NWRWA",
];
const PARAGRAPH = "This paragraph is deliberately long enough that it wraps onto more than one "
  + "rendered line inside the column, so a press can land between two of its own lines rather "
  + "than in blank paper beside a short one.";

const FIXTURE = {
  type: "doc",
  attrs: { pageWidth: 900 },
  content: [
    ...LINES.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
    { type: "paragraph", content: [{ type: "text", text: PARAGRAPH }] },
    { type: "paragraph", content: [] },
  ],
};

async function openPage({ viewport = { width: 1500, height: 950 } } = {}) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await assertMeasurable(page, "verify-notes-in-sheet-placement");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  await page.evaluate(([tk, pk, d]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "In-sheet placement", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, FIXTURE]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 800);
  page.__errs = errs;
  return page;
}

/** Where one of the fixture's own lines actually renders, found by its TEXT (trap 21). */
const lineRect = (page, text) => page.evaluate((t) => {
  const body = document.querySelector('[data-testid="note-body"]');
  const p = [...(body?.querySelectorAll("p") || [])].find((n) => n.textContent.trim() === t);
  if (!p) return null;
  const r = new Range();
  r.selectNodeContents(p);
  const rects = [...r.getClientRects()].filter((k) => k.width > 0 || k.height > 0);
  if (!rects.length) return null;
  const first = rects[0];
  const sheet = document.querySelector('[data-testid="note-sheet"]')?.getBoundingClientRect();
  return {
    left: first.left, right: first.right, top: first.top, bottom: first.bottom,
    midY: first.top + first.height / 2,
    lines: rects.length,
    lastBottom: rects[rects.length - 1].bottom,
    sheetRight: sheet ? sheet.right : null,
    sheetLeft: sheet ? sheet.left : null,
    sheetBottom: sheet ? sheet.bottom : null,
  };
}, text);

/** Every anchor on screen, with its rendered top-left in CLIENT coordinates. */
const anchors = (page) => page.evaluate(() => [...document.querySelectorAll(".planyr-anchor")].map((el) => {
  const r = el.getBoundingClientRect();
  return {
    id: el.getAttribute("data-anchor-id"),
    text: el.textContent.trim(),
    left: Math.round(r.left),
    top: Math.round(r.top),
    storedX: Math.round(parseFloat(el.style.left)),
    storedY: Math.round(parseFloat(el.style.top)),
  };
}));

/** The flow text, as one string, so "did the caret land in his sentence" is answerable exactly. */
const flowText = (page) => page.evaluate(() => {
  const body = document.querySelector('[data-testid="note-body"]');
  return [...(body?.children || [])]
    .filter((n) => !n.classList.contains("planyr-anchor"))
    .map((n) => n.textContent.trim()).filter(Boolean).join(" | ");
});

/** A real double-click. `page.mouse.dblclick` is the ONLY call that raises a native one here. */
async function dbl(page, x, y, label) {
  const vp = page.viewportSize();
  if (y >= vp.height || x >= vp.width || x < 0 || y < 0) {
    throw new Error(`${label}: point (${x}, ${y}) is outside the ${vp.width}×${vp.height} viewport — `
      + "elementsFromPoint goes silent there and the click would hit nothing (trap 18)");
  }
  await page.mouse.move(x, y);
  await page.mouse.dblclick(x, y);
  await pacedWait(page, 120);
}

async function section(name, fn) {
  console.log(`\n── ${name} ──`);
  const page = await openPage();
  try {
    await fn(page);
    if (page.__errs.length) ok(`${name}: no page errors`, false, page.__errs.join(" / "));
  } finally {
    await page.context().close();
  }
}

/* ═══ 1 · THE FIXTURE IS ACTUALLY THE REPORTED SHAPE (vacuity guard) ═══════════════════════════
 * A run on a page with no blank paper to the right of a short line proves nothing at all, and a
 * narrow sheet is precisely how this was missed four times. Refuse to score one. */
await section("1 · the fixture really has blank paper inside the sheet", async (page) => {
  const line = await lineRect(page, "Dustin O'Neal");
  if (!line) throw new Error("fixture line not found — the harness cannot vouch for a scene it cannot see");
  const blank = line.sheetRight - line.right;
  ok("there is real blank paper right of the short line, inside the sheet", blank > 200,
    `${Math.round(blank)}px between the line's end and the sheet's right edge`);
  ok("the short line really is short (left third of the sheet)", line.right - line.sheetLeft < (line.sheetRight - line.sheetLeft) / 2,
    `line ends ${Math.round(line.right - line.sheetLeft)}px into a ${Math.round(line.sheetRight - line.sheetLeft)}px sheet`);
});

/* ═══ 2 · THE REPORTED CASE — blank paper right of a short line, same row ══════════════════════ */
await section("2 · double-click right of a short line, same row, still inside the sheet", async (page) => {
  const before = await flowText(page);
  const line = await lineRect(page, "Dustin O'Neal");
  // Well past the end of the line — his "ten inches out" — but comfortably inside the sheet.
  const x = Math.round(line.right + (line.sheetRight - line.right) * 0.6);
  const y = Math.round(line.midY);
  await dbl(page, x, y, "case 2");
  await page.keyboard.type("ALPHA");
  await pacedWait(page, 900);

  const found = (await anchors(page)).filter((a) => a.text.includes("ALPHA"));
  ok("a box was created", found.length === 1, `${found.length} box(es) holding ALPHA`);
  if (found.length === 1) {
    const dx = Math.abs(found[0].left - x);
    const dy = Math.abs(found[0].top - y);
    ok(`the box renders where it was clicked (±${POS_TOL}px)`, dx <= POS_TOL && dy <= POS_TOL,
      `clicked (${x}, ${y}), box top-left (${found[0].left}, ${found[0].top}) → off by (${dx}, ${dy})`);
  }
  const after = await flowText(page);
  ok("the existing line of text was NOT edited", after === before,
    after === before ? "flow text byte-identical" : `"${before}" → "${after}"`);
});

/* ═══ 3 · BLANK PAPER FAR BELOW THE LAST LINE ════════════════════════════════════════════════ */
await section("3 · double-click far below the last line, still inside the sheet", async (page) => {
  const before = await flowText(page);
  const para = await lineRect(page, PARAGRAPH);
  const x = Math.round(para.left + 160);
  const y = Math.round(para.lastBottom + 120);
  await dbl(page, x, y, "case 3");
  await page.keyboard.type("BRAVO");
  await pacedWait(page, 900);

  const found = (await anchors(page)).filter((a) => a.text.includes("BRAVO"));
  ok("a box was created below the last line", found.length === 1, `${found.length} box(es) holding BRAVO`);
  if (found.length === 1) {
    const dx = Math.abs(found[0].left - x);
    const dy = Math.abs(found[0].top - y);
    ok(`the box renders where it was clicked (±${POS_TOL}px)`, dx <= POS_TOL && dy <= POS_TOL,
      `clicked (${x}, ${y}), box top-left (${found[0].left}, ${found[0].top}) → off by (${dx}, ${dy})`);
  }
  ok("the existing text was NOT edited", (await flowText(page)) === before);
});

/* ═══ 4 · KNOWN-GOOD — a double-click ON a word still selects that word ══════════════════════ */
await section("4 · double-click on a word still selects the word", async (page) => {
  const line = await lineRect(page, "Water Authority: NWRWA");
  const x = Math.round(line.left + 20);           // inside the first word
  const y = Math.round(line.midY);
  await dbl(page, x, y, "case 4");
  await pacedWait(page, 150);
  const sel = await page.evaluate(() => document.getSelection()?.toString() || "");
  known("the word under the pointer is selected", sel.trim() === "Water", `selection = "${sel.trim()}"`);
  known("no box was created by a press on real text", (await anchors(page)).length === 0,
    `${(await anchors(page)).length} anchors`);
});

/* ═══ 5 · KNOWN-GOOD — between two lines of a wrapped paragraph is TEXT, not blank paper ═════ */
await section("5 · double-click between two rendered lines of a paragraph creates nothing", async (page) => {
  const seam = await page.evaluate((t) => {
    const body = document.querySelector('[data-testid="note-body"]');
    const p = [...(body?.querySelectorAll("p") || [])].find((n) => n.textContent.trim() === t);
    const r = new Range();
    r.selectNodeContents(p);
    const rects = [...r.getClientRects()].filter((k) => k.width > 0);
    if (rects.length < 2) return null;
    return { x: Math.round(rects[0].left + 40), y: Math.round(rects[0].bottom), lines: rects.length };
  }, PARAGRAPH);
  if (!seam) { known("the paragraph wrapped onto 2+ lines", false, "it did not wrap — case is vacuous"); return; }
  known("the paragraph wrapped onto 2+ lines", seam.lines >= 2, `${seam.lines} rendered lines`);
  await dbl(page, seam.x, seam.y, "case 5");
  await page.keyboard.type("X");
  await pacedWait(page, 900);
  known("no box was created between two lines of text", (await anchors(page)).length === 0,
    `${(await anchors(page)).length} anchors`);
});

/* ═══ 6 · KNOWN-GOOD — the grey mat outside the sheet still places on a single press ═════════
 * ⛔ THE MAT ON THE **LEFT**, MEASURED, NOT THE RIGHT. The first draft of this section pressed at
 * `sheetRight + 60`, which on a wide page at this viewport is x=1554 in a 1500px window — past
 * the edge of the world, where `elementsFromPoint` returns an EMPTY ARRAY rather than erroring
 * (carry-forward trap 18) and the press lands on nothing at all. It reported as "the grey-mat
 * path is broken", about code nothing had touched. The sheet is pinned near the right edge here,
 * so the real grey mat is the band to its LEFT (measured: mat 268→1500, sheet 594→1494). */
await section("6 · the grey-mat path outside the sheet is unchanged", async (page) => {
  const line = await lineRect(page, "MUD 377");
  const x = Math.round(line.sheetLeft - 40);
  const y = Math.round(line.midY + 40);
  const inMat = await page.evaluate(([px, py]) => document
    .elementsFromPoint(px, py).some((el) => el.dataset?.testid === "note-mat"), [x, y]);
  known("the mat press point really resolves to the grey mat", inMat, `(${x}, ${y})`);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await pacedWait(page, 120);
  await page.keyboard.type("MAT");
  await pacedWait(page, 900);
  const found = (await anchors(page)).filter((a) => a.text.includes("MAT"));
  known("a single press in the grey mat still places a box", found.length === 1,
    `${found.length} box(es) holding MAT`);
  if (found.length === 1) {
    const dx = Math.abs(found[0].left - x);
    const dy = Math.abs(found[0].top - y);
    known(`the mat box renders where it was pressed (±${POS_TOL}px)`, dx <= POS_TOL && dy <= POS_TOL,
      `pressed (${x}, ${y}), box top-left (${found[0].left}, ${found[0].top}) → off by (${dx}, ${dy})`);
  }
});

/* ═══ 7 · PERSISTENCE — every created box survives a reload where it was put ═════════════════ */
await section("7 · a box placed in blank paper survives a reload", async (page) => {
  const line = await lineRect(page, "Engineer - Pape Dawson");
  const x = Math.round(line.right + (line.sheetRight - line.right) * 0.5);
  const y = Math.round(line.midY);
  await dbl(page, x, y, "case 7");
  await page.keyboard.type("CHARLIE");
  await pacedWait(page, 1000);                       // past the 600ms save debounce
  const beforeReload = (await anchors(page)).find((a) => a.text.includes("CHARLIE"));
  ok("the box exists before the reload", !!beforeReload);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
  const afterReload = (await anchors(page)).find((a) => a.text.includes("CHARLIE"));
  ok("the box is still there after a reload", !!afterReload);
  if (beforeReload && afterReload) {
    ok("it kept its stored position across the reload",
      Math.abs(afterReload.storedX - beforeReload.storedX) <= 1
        && Math.abs(afterReload.storedY - beforeReload.storedY) <= 1,
      `stored (${beforeReload.storedX}, ${beforeReload.storedY}) → (${afterReload.storedX}, ${afterReload.storedY})`);
  }
});

/* ═══ 8 · F4 — AN EMPTY PLACED NOTE IS NOT DESTROYED BEHIND HIS BACK ════════════════════════
 * A correct fix to everything above STILL reads as "nothing happened" if a box he creates and
 * looks away from is silently binned. Under the armed-caret model nothing is created until the
 * first character, so the honest question is the one a person would actually ask: after typing,
 * does clicking away keep it? */
await section("8 · a box kept after clicking away (F4)", async (page) => {
  const line = await lineRect(page, "P: 713-428-2400");
  const x = Math.round(line.right + (line.sheetRight - line.right) * 0.5);
  const y = Math.round(line.midY);
  await dbl(page, x, y, "case 8");
  await page.keyboard.type("DELTA");
  await pacedWait(page, 400);
  ok("the box exists straight after typing", (await anchors(page)).some((a) => a.text.includes("DELTA")));
  // Click away onto plain text elsewhere, then let every debounce and sweep run.
  const other = await lineRect(page, "MUD 377");
  await page.mouse.click(Math.round(other.left + 10), Math.round(other.midY));
  await pacedWait(page, 1200);
  ok("it is still there after clicking away", (await anchors(page)).some((a) => a.text.includes("DELTA")));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
  ok("it is still there after a reload", (await anchors(page)).some((a) => a.text.includes("DELTA")));
});

/* ═══ 9 · F4, THE OTHER HALF — PRESSING AND TYPING NOTHING LEAVES THE PAGE ALONE ════════════
 * The brief asks whether an empty placed note is still silently destroyed on click-away. Under
 * the armed-caret model (NEW-8, the owner's own rule: *"just because I click outside of the page,
 * it shouldn't automatically open the page up to it. Only once I actually type something"*) there
 * is nothing to destroy — a press remembers a point and creates NOTHING until the first
 * character. So the honest check is that the press is genuinely free: a caret is offered, and
 * walking away from it leaves the document byte-identical, with no box to lose and no notice. */
await section("9 · a press that types nothing creates nothing, and loses nothing (F4)", async (page) => {
  const before = await page.evaluate((k) => localStorage.getItem(k), PAGE_KEY);
  const line = await lineRect(page, "Dustin O'Neal");
  const x = Math.round(line.right + (line.sheetRight - line.right) * 0.6);
  const y = Math.round(line.midY);
  await dbl(page, x, y, "case 9");
  await pacedWait(page, 200);
  ok("a caret is offered at the point pressed", await page.evaluate(() =>
    !!document.querySelector('[data-pending-place="1"], [data-testid="note-body"][data-pending-place]')));
  // Look away without typing a thing.
  const other = await lineRect(page, "MUD 377");
  await page.mouse.click(Math.round(other.left + 10), Math.round(other.midY));
  await pacedWait(page, 1200);
  ok("nothing was created", (await anchors(page)).length === 0, `${(await anchors(page)).length} anchors`);
  ok("the stored page is byte-identical", (await page.evaluate((k) => localStorage.getItem(k), PAGE_KEY)) === before);
  ok("no 'we removed an empty box' notice appeared", !(await page.evaluate(() =>
    /empty|removed|discard/i.test(document.body.innerText))));
});

await browser.close();

console.log("\n──────────────────────────────────────────────");
if (voids.length) {
  console.log(`⛔ RUN IS VOID — ${voids.length} known-good arm(s) did not report their known value:`);
  voids.forEach((v) => console.log(`   · ${v}`));
  console.log("   A probe that cannot see what it is pointed at cannot vouch for anything else.");
}
if (failures.length) {
  console.log(`⛔ ${failures.length} failure(s):`);
  failures.forEach((f) => console.log(`   · ${f}`));
}
if (!failures.length && !voids.length) console.log("✓ all checks passed");
process.exit(failures.length || voids.length ? 1 : 0);
