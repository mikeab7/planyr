/* verify-notes-in-sheet-placement — THE NOTES PAGE IS A PLACEMENT SURFACE, NOTHING ELSE (NEW-1,
 * owner direction 2026-09-22, superseding the whole B1393 lineage this file used to guard).
 *
 * ⛔ HIS WORDS: *"It looks like there's basically two elements. One is just a regular paragraph
 * and one is the double-click thing... I don't want anything regular paragraph because I feel
 * like that's what's fucking us up here. I just want the double-click thing. I don't need it to
 * tell me where to put my paragraph."*
 *
 * ⛔ THIS FILE USED TO TEST "IS THIS PRESS BESIDE A LINE OF FLOW TEXT" (five rounds, B1393 ×5).
 * There is no flow text left on the page — the sheet holds nothing but positioned boxes — so
 * that whole class of question is gone, not answered differently. What survives from the old
 * file: the reload-persistence checks, the F4 (armed-caret, nothing-typed-nothing-lost) checks,
 * and the double-click-on-a-word-selects-it known-good arm. Everything about "beside a line" is
 * replaced by "double-click ANYWHERE that is not an existing box creates one there."
 *
 * ⛔ MEASURED AGAINST CURRENT MAIN BEFORE THIS REWRITE, HONESTLY REPORTED: the OLD version of
 * this file (testing the old "beside a line" mechanism) was GREEN against origin/main —
 * `82f846f`, the commit this branch forked from. That is not a refutation of the owner's fresh
 * production report (a double-click doing nothing at three separate points on his real page,
 * build 4681016) — it means the old harness's specific fixture never happened to hit whatever
 * production gap produced his symptom, which is exactly the kind of sandbox/production
 * discrepancy this repo's own FOREGROUND-OR-VOID family already has open, unresolved instances
 * of (see docs/NOTES-CARRY-FORWARD.md, the B831600 toolbar-shift saga). The redesign in this PR
 * does not depend on ever finding that gap: it deletes the ENTIRE "beside a line" mechanism the
 * gap could have lived in, root and branch, per the owner's own instruction.
 *
 * Traps honoured, from docs/NOTES-CARRY-FORWARD.md §1: a REAL mouse, and specifically
 * `page.mouse.dblclick()` — two separate down/up pairs never reliably form a native double-click
 * in this sandbox (trap 32) · reads after the 600ms save debounce · `assertMeasurable` before any
 * measurement (FOREGROUND-OR-VOID) · every section closes its own context (trap 29) · computed
 * click points are checked against the viewport before being clicked (trap 18).
 *
 * ⛔ KNOWN-GOOD ARMS (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): double-click-on-a-word-selects-it has
 * an answer known independently of this change. If it fails to report its known value the run
 * declares itself VOID rather than printing a score.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node ui-audit/verify-notes-in-sheet-placement.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { docToMarkdown } from "../src/workspaces/notes/lib/notesMarkdown.js";

const BASE = process.env.BASE_URL || "http://localhost:4173";
/* ⛔ NO HARDCODED SANDBOX PATH (NEW-1, 2026-09-22) — this harness is now wired into the required
 * `build` CI check (see .github/ci-gates.yml), and CI's Chromium is whatever `npx playwright
 * install --with-deps chromium` resolves, not this repo's local sandbox revision. Default to
 * `undefined` so `chromium.launch()` resolves the SAME browser CI's other Playwright-driven gates
 * (visual-regression.mjs, ui-inventory.mjs) use; `PW_CHROME` still overrides for local runs. See
 * visual-regression.mjs's own header for the mismatch this convention exists to prevent. */
const EXEC = process.env.PW_CHROME || undefined;
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

/* The box's top-left is placed at the press point (`placeAnchor` keeps the chosen point exactly
 * and spends the WIDTH instead — see its own header), so the tolerance here is for rounding and
 * the anchor's own border, not for a policy. */
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

const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] });

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

async function openPage({ viewport = { width: 1500, height: 950 }, doc = EMPTY_DOC } = {}) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await assertMeasurable(page, "verify-notes-in-sheet-placement");
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  await page.evaluate(([tk, pk, d]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "In-sheet placement", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, doc]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 800);
  page.__errs = errs;
  return page;
}

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

const sheetRect = (page) => page.evaluate(() => {
  const r = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
});

/** ⛔ THE PLACEMENT SURFACE IS `note-body`, NOT THE WHOLE `note-sheet` CARD. The sheet also
 *  carries the title band (input + project/edited row) ABOVE the editable body — on a fresh
 *  page that gap measures ~117px. A point "near the sheet's top edge" is, in real geometry,
 *  a point on the TITLE, and `placeBlockAt`'s coordinate math is relative to `note-body`'s own
 *  box, so a click above it stores a NEGATIVE y and the page's own "grow up to hold it" logic
 *  then has to run before anything settles where a naive same-frame read expects. Every point
 *  in this file that means "blank paper" is chosen relative to THIS rect. */
const bodyRect = (page) => page.evaluate(() => {
  const r = document.querySelector('[data-testid="note-body"]').getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
});

/** A real double-click. `page.mouse.dblclick` is the ONLY call that raises a native one here
 *  (carry-forward trap 32); the app's own `isBlankDoublePress` also reconstructs the pair for
 *  when a browser genuinely does not, so either recognition path is exercised. */
async function dbl(page, x, y, label) {
  const vp = page.viewportSize();
  if (y >= vp.height || x >= vp.width || x < 0 || y < 0) {
    throw new Error(`${label}: point (${x}, ${y}) is outside the ${vp.width}×${vp.height} viewport — `
      + "elementsFromPoint goes silent there and the click would hit nothing (trap 18)");
  }
  await page.mouse.move(x, y);
  await page.mouse.dblclick(x, y);
  await pacedWait(page, 150);
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

/* ═══ 1 · THE EMPTY-PAGE PLACEHOLDER ══════════════════════════════════════════════════════════ */
await section("1 · a fresh page shows the placeholder, and it vanishes the moment a box exists", async (page) => {
  const before = await page.evaluate(() => document.querySelector('[data-testid="note-empty-placeholder"]')?.textContent || null);
  ok("the empty state names the gesture", before === "Double-click anywhere to start a note.", `read: ${JSON.stringify(before)}`);
  const body = await bodyRect(page);
  await dbl(page, Math.round(body.left + 100), Math.round(body.top + 40), "case 1");
  await page.keyboard.type("FIRST");
  await pacedWait(page, 900);
  const after = await page.evaluate(() => document.querySelector('[data-testid="note-empty-placeholder"]'));
  ok("the placeholder is gone once a box exists", after === null);
});

/* ═══ 2 · SINGLE CLICK ON BLANK SHEET DESELECTS — IT DOES NOT PLACE ═══════════════════════════ */
await section("2 · a single click on blank sheet creates nothing and only deselects", async (page) => {
  const body = await bodyRect(page);
  const x = Math.round(body.left + 200);
  const y = Math.round(body.top + 200);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await pacedWait(page, 400);
  await page.keyboard.type("SHOULDNOTAPPEAR");
  await pacedWait(page, 400);
  ok("a lone single click places nothing, even after typing", (await anchors(page)).length === 0,
    `${(await anchors(page)).length} anchors`);
  /* And it deselects: select a box, then a single click elsewhere clears the ring. */
  await dbl(page, x, y, "case 2 seed");
  await page.keyboard.type("BOX");
  await pacedWait(page, 900);
  const box = (await anchors(page))[0];
  /* ⛔ NOT THE TOP-LEFT CORNER (carry-forward trap 9) — that is the drag grip's own 12px-wide
   * strip, which stops propagation on its own pointerdown and never reaches this handler at
   * all. Click well into the content, past the grip and the box's own left padding. */
  await page.mouse.click(box.left + 60, box.top + 12);   // stage 1: select
  await pacedWait(page, 150);
  const selectedBefore = await page.evaluate(() => document.querySelector('.planyr-anchor[data-selected="1"]') !== null);
  ok("stage 1 selects the box", selectedBefore);
  const away = { x: Math.round(body.left + 20), y: Math.round(body.top + 20) };
  await page.mouse.move(away.x, away.y);
  await page.mouse.down();
  await page.mouse.up();
  await pacedWait(page, 150);
  const selectedAfter = await page.evaluate(() => document.querySelector('.planyr-anchor[data-selected="1"]') !== null);
  ok("a single click elsewhere deselects it", !selectedAfter);
  ok("and still created no second box", (await anchors(page)).length === 1);
});

/* ═══ 3 · DOUBLE-CLICK AT FIVE SPREAD POINTS, INCLUDING WITHIN 20PX OF EVERY BODY EDGE ═══════ */
await section("3 · double-click anywhere on the sheet creates a box there", async (page) => {
  const body = await bodyRect(page);
  const points = [
    ["near the top-left corner of the writing area", body.left + 15, body.top + 15],
    ["near the top-right corner", body.right - 15, body.top + 15],
    ["near the bottom-left corner", body.left + 15, body.top + 250],
    ["dead centre", Math.round((body.left + body.right) / 2), Math.round(body.top + 150)],
    ["off-centre, an ordinary spot", body.left + 80, body.top + 300],
  ];
  let i = 0;
  for (const [label, x, y] of points) {
    i += 1;
    const tag = `PT${i}`;
    await dbl(page, Math.round(x), Math.round(y), label);
    await page.keyboard.type(tag);
    await pacedWait(page, 900);
    const found = (await anchors(page)).find((a) => a.text.includes(tag));
    ok(`${label}: a box was created`, !!found, `clicked (${Math.round(x)}, ${Math.round(y)})`);
    if (found) {
      const dx = Math.abs(found.left - Math.round(x));
      const dy = Math.abs(found.top - Math.round(y));
      ok(`${label}: the box renders where it was clicked (±${POS_TOL}px)`, dx <= POS_TOL && dy <= POS_TOL,
        `box top-left (${found.left}, ${found.top}) → off by (${dx}, ${dy})`);
    }
  }
  ok("all five boxes exist at once", (await anchors(page)).length === 5, `${(await anchors(page)).length} anchors`);
});

/* ═══ 4 · RIGHT OF AN EXISTING BOX, ON ITS OWN ROW ═════════════════════════════════════════════ */
await section("4 · double-click right of an existing box, same row, creates a SECOND box", async (page) => {
  const body = await bodyRect(page);
  const firstAt = { x: body.left + 30, y: body.top + 120 };
  await dbl(page, firstAt.x, firstAt.y, "seed box");
  await page.keyboard.type("LEFT");
  await pacedWait(page, 900);
  const seed = (await anchors(page))[0];
  const rightAt = { x: seed.left + 260, y: seed.top + 10 };
  await dbl(page, rightAt.x, rightAt.y, "case 4");
  await page.keyboard.type("RIGHT");
  await pacedWait(page, 900);
  const list = await anchors(page);
  ok("two distinct boxes exist", list.length === 2, `${list.length} anchors`);
  ok("the first box's text was not touched", list.some((a) => a.text === "LEFT"));
  const right = list.find((a) => a.text.includes("RIGHT"));
  ok("the new box sits where it was clicked", !!right && Math.abs(right.left - rightAt.x) <= POS_TOL
    && Math.abs(right.top - rightAt.y) <= POS_TOL);
});

/* ═══ 5 · BELOW ALL EXISTING BOXES ═════════════════════════════════════════════════════════════ */
await section("5 · double-click below every existing box creates one there", async (page) => {
  const body = await bodyRect(page);
  await dbl(page, body.left + 40, body.top + 40, "seed");
  await page.keyboard.type("ABOVE");
  await pacedWait(page, 900);
  const below = { x: body.left + 60, y: body.top + 400 };
  await dbl(page, below.x, below.y, "case 5");
  await page.keyboard.type("BELOW");
  await pacedWait(page, 900);
  const found = (await anchors(page)).find((a) => a.text.includes("BELOW"));
  ok("a box appeared below everything already there", !!found
    && Math.abs(found.left - below.x) <= POS_TOL && Math.abs(found.top - below.y) <= POS_TOL);
});

/* ═══ 6 · BETWEEN TWO EXISTING BOXES ═══════════════════════════════════════════════════════════ */
await section("6 · double-click between two existing boxes creates one there, touching neither", async (page) => {
  const body = await bodyRect(page);
  await dbl(page, body.left + 30, body.top + 20, "top box");
  await page.keyboard.type("TOP");
  await pacedWait(page, 900);
  await dbl(page, body.left + 30, body.top + 380, "bottom box");
  await page.keyboard.type("BOTTOM");
  await pacedWait(page, 900);
  const between = { x: body.left + 30, y: body.top + 200 };
  await dbl(page, between.x, between.y, "case 6");
  await page.keyboard.type("MIDDLE");
  await pacedWait(page, 900);
  const list = await anchors(page);
  ok("three distinct boxes, TOP and BOTTOM untouched", list.length === 3
    && list.some((a) => a.text === "TOP") && list.some((a) => a.text === "BOTTOM"));
  const mid = list.find((a) => a.text.includes("MIDDLE"));
  ok("the middle box sits where it was clicked", !!mid
    && Math.abs(mid.left - between.x) <= POS_TOL && Math.abs(mid.top - between.y) <= POS_TOL);
});

/* ═══ 7 · KNOWN-GOOD — double-click ON A WORD inside a box still selects that word ═════════════ */
await section("7 · double-click on a word inside a box selects the word, not a new box", async (page) => {
  const body = await bodyRect(page);
  await dbl(page, body.left + 30, body.top + 30, "seed box");
  await page.keyboard.type("Water Authority NWRWA");
  await pacedWait(page, 900);
  const box = (await anchors(page))[0];
  /* Re-select then re-enter (the two-stage model) so the caret genuinely leaves before this
   * gesture is asked to prove anything about it. NOT the top-left corner (trap 9) — that is
   * the drag grip, not the box's content. */
  await page.mouse.click(box.left + 60, box.top + 12);
  await pacedWait(page, 100);
  await page.mouse.dblclick(box.left + 60, box.top + 12);
  await pacedWait(page, 100);
  // Now genuinely double-click a word inside the entered box.
  const wordPoint = await page.evaluate(() => {
    const el = document.querySelector(".planyr-anchor-content p");
    const r = new Range();
    r.selectNodeContents(el);
    const rect = r.getClientRects()[0];
    return { x: rect.left + 15, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(wordPoint.x, wordPoint.y);
  await page.mouse.dblclick(wordPoint.x, wordPoint.y);
  await pacedWait(page, 150);
  const sel = await page.evaluate(() => document.getSelection()?.toString() || "");
  known("the word under the pointer is selected", sel.trim() === "Water", `selection = "${sel.trim()}"`);
  known("no second box was created by a press on real text", (await anchors(page)).length === 1,
    `${(await anchors(page)).length} anchors`);
});

/* ═══ 8 · DOUBLE-CLICK ON AN EXISTING BOX OPENS IT FOR EDITING, NEVER A SECOND BOX ═════════════ */
await section("8 · double-click on an already-selected box enters it, no duplicate", async (page) => {
  const body = await bodyRect(page);
  await dbl(page, body.left + 40, body.top + 40, "seed");
  await page.keyboard.type("ORIGINAL");
  await pacedWait(page, 900);
  const box = (await anchors(page))[0];
  // Escape backs fully out (editing → selected → deselected), matching real usage.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await pacedWait(page, 100);
  /* ⛔ A REAL, NOT A SIMULTANEOUS, DOUBLE CLICK. The two-stage model (select, then enter) has NO
   * timing dependency at all — any second press on an already-selected box enters it, whatever
   * the gap — but `page.mouse.dblclick()` delivers its two presses close enough together that
   * React's state update from press 1 (`setSelection`) is not guaranteed to have committed
   * before press 2's handler reads `selRef.current`, which a genuine human double-click (tens of
   * ms apart) never races. Two ordinary clicks with a real gap is the more honest drive of the
   * SAME app behaviour, not a different one. */
  await page.mouse.click(box.left + 60, box.top + 12);
  await pacedWait(page, 120);
  await page.mouse.click(box.left + 60, box.top + 12);
  await pacedWait(page, 200);
  ok("still exactly one box after re-opening it", (await anchors(page)).length === 1,
    `${(await anchors(page)).length} anchors`);
  const inEditor = await page.evaluate(() => {
    const anchor = document.querySelector(".planyr-anchor");
    return !!(document.activeElement && anchor?.contains(document.activeElement))
      || document.activeElement?.classList?.contains("ProseMirror");
  });
  ok("the caret is live inside the box (editable, not merely selected)", inEditor);
});

/* ═══ 9 · PERSISTENCE — a box placed anywhere survives a reload where it was put ═══════════════ */
await section("9 · a box placed on the sheet survives a reload", async (page) => {
  const body = await bodyRect(page);
  const at = { x: body.left + 120, y: body.top + 80 };
  await dbl(page, at.x, at.y, "case 9");
  await page.keyboard.type("CHARLIE");
  await pacedWait(page, 1000);                        // past the 600ms save debounce
  const before = (await anchors(page)).find((a) => a.text.includes("CHARLIE"));
  ok("the box exists before the reload", !!before);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
  const after = (await anchors(page)).find((a) => a.text.includes("CHARLIE"));
  ok("the box is still there after a reload", !!after);
  if (before && after) {
    ok("it kept its stored position across the reload",
      Math.abs(after.storedX - before.storedX) <= 1 && Math.abs(after.storedY - before.storedY) <= 1,
      `stored (${before.storedX}, ${before.storedY}) → (${after.storedX}, ${after.storedY})`);
  }
});

/* ═══ 10 · F4 — AN ARMED CARET THAT NEVER GOT A CHARACTER LEAVES NOTHING (unchanged from B1393) */
await section("10 · a double-click that types nothing creates nothing, and loses nothing", async (page) => {
  const body = await bodyRect(page);
  const before = await page.evaluate((k) => localStorage.getItem(k), PAGE_KEY);
  const at = { x: body.left + 150, y: body.top + 150 };
  await dbl(page, at.x, at.y, "case 10");
  await pacedWait(page, 200);
  ok("a caret is offered at the point pressed", await page.evaluate(() =>
    !!document.querySelector('[data-testid="note-body"][data-pending-place]')));
  await page.mouse.click(body.left + 10, body.top + 10);
  await pacedWait(page, 1200);
  ok("nothing was created", (await anchors(page)).length === 0, `${(await anchors(page)).length} anchors`);
  ok("the stored page is byte-identical", (await page.evaluate((k) => localStorage.getItem(k), PAGE_KEY)) === before);
  /* ⛔ F4 (REVIEW-2026-09-08) — an abandoned box is discarded SILENTLY; the masker that used to
   * pop a "we removed an empty box" toast must stay gone. */
  ok("no 'we removed an empty box' notice appeared", !(await page.evaluate(() =>
    /empty|removed|discard/i.test(document.body.innerText))));
});

/* ═══ 11 · KNOWN-GOOD — the grey mat outside the sheet uses the identical mechanism ════════════ */
await section("11 · the grey mat outside the sheet double-clicks the same way", async (page) => {
  const sheet = await sheetRect(page);
  const x = Math.max(10, Math.round(sheet.left - 40));
  const y = Math.round(sheet.top + 40);
  const inMat = await page.evaluate(([px, py]) => document
    .elementsFromPoint(px, py).some((el) => el.dataset?.testid === "note-mat"), [x, y]);
  known("the mat press point really resolves to the grey mat", inMat, `(${x}, ${y})`);
  await dbl(page, x, y, "case 11");
  await page.keyboard.type("MAT");
  await pacedWait(page, 900);
  const found = (await anchors(page)).filter((a) => a.text.includes("MAT"));
  known("a double-click in the grey mat places a box", found.length === 1, `${found.length} box(es)`);
});

/* ═══ 12 · MIGRATION — AN OLD FLOW-BODY PAGE BECOMES ONE BOX, ON READ, LOSSLESSLY ══════════════ */
await section("12 · a page with headings/list/link/picture in flow body migrates into one box", async (page) => {
  const FIXTURE = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Utilities" }] },
      { type: "bulletList", content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "MUD 377" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [
          { type: "text", text: "Engineer contact", marks: [{ type: "link", attrs: { href: "mailto:x@y.com", target: "_blank", rel: "noopener noreferrer" } }] },
        ] }] },
      ] },
      { type: "noteImage", attrs: { imageId: "img_notreal", alt: "site photo", mime: "image/png", w: 400, h: 300 } },
      { type: "paragraph" },
    ],
  };
  const before = docToMarkdown(FIXTURE, { title: "" }).markdown;

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  await assertMeasurable(p, "verify-notes-in-sheet-placement (migration)");
  await p.addInitScript(() => { window.__PLANYR_E2E = true; });
  await p.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(p, 250);
  await p.evaluate(([tk, pk, d]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Old flow page", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, FIXTURE]);
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(p, 900);

  const list = await p.evaluate(() => [...document.querySelectorAll(".planyr-anchor")].map((el) => ({
    left: Math.round(el.getBoundingClientRect().left), top: Math.round(el.getBoundingClientRect().top),
    hasHeading: !!el.querySelector("h1"), hasList: !!el.querySelector("ul"),
    /* The fixture's imageId is deliberately fake (no bytes in IndexedDB), so the node view
     * correctly replaces its own <img> with a named "missing" block (LOUD-FAILURE) — either
     * one proves the picture's own NODE survived migration, which is the only thing this
     * section is testing (bytes loading is a separate, already-covered concern). */
    hasImage: !!el.querySelector('[data-testid="note-image"]'),
  })));
  ok("exactly one migrated box exists", list.length === 1, `${list.length} anchors`);
  if (list.length === 1) {
    /* The box's stored (x, y) is (0, 0) — the document's OWN frame, relative to note-body's
     * top-left, not to the sheet's (which also carries the title band above note-body). */
    const body = await bodyRect(p);
    ok("it sits at the sheet's top-left content corner",
      Math.abs(list[0].left - body.left) < 40 && Math.abs(list[0].top - body.top) < 40,
      `box at (${list[0].left}, ${list[0].top}), writing area at (${Math.round(body.left)}, ${Math.round(body.top)})`);
    ok("the heading survived", list[0].hasHeading);
    ok("the list survived", list[0].hasList);
    ok("the picture survived", list[0].hasImage);
  }

  ok("the stored page was NOT rewritten by opening it — migration is in-memory only",
    (await p.evaluate((k) => localStorage.getItem(k), PAGE_KEY)) === JSON.stringify(FIXTURE));

  const liveJson = await p.evaluate(() => window.__noteEditor?.json?.() ?? null);
  ok("the E2E hook returned the live (migrated) document", !!liveJson);
  if (liveJson) {
    const after = docToMarkdown(liveJson, { title: "" }).markdown;
    ok("the migrated page's Markdown export is byte-identical to its pre-migration export",
      after === before, after === before ? "identical" : `before:\n${before}\n----\nafter:\n${after}`);
  }
  await ctx.close();
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
