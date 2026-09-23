/* verify-notes-in-sheet-placement — THE NOTES PAGE IS A PLACEMENT SURFACE, NOTHING ELSE (NEW-1,
 * owner direction 2026-09-22, superseding the whole B1393 lineage this file used to guard) —
 * PLUS ARROWS BETWEEN BOXES, THE SKETCH CANVAS'S REPLACEMENT (NEW-2, same day). Both ship in
 * one CI gate deliberately ("add these to the SAME CI-wired check so neither regresses
 * silently") — a change to placement and a change to arrows can each break the other's
 * assumptions about the same boxes.
 *
 * ⛔ HIS WORDS ON NEW-1: *"It looks like there's basically two elements. One is just a regular
 * paragraph and one is the double-click thing... I don't want anything regular paragraph
 * because I feel like that's what's fucking us up here. I just want the double-click thing. I
 * don't need it to tell me where to put my paragraph."*
 *
 * ⛔ HIS WORDS ON NEW-2, THE SAME DAY: *"I don't care for the sketch boxes at all... Because
 * really all I was looking for was to get arrows connecting boxes. That sketch box thing just
 * seems poorly thought out. It seems like it'd be better if I just had a free canvas to play
 * with."* Sections 13+ below cover what that retirement adds: two boxes connected by
 * click-to-connect AND separately by drag-from-the-dot, an arrow's endpoints tracking a moved
 * or resized box, TOMBSTONE-DELETES (deleting a box takes its arrows, undo brings both back),
 * reload persistence, and a fixture page whose STORED `noteSketch` node (the retired shape)
 * opens converted into real boxes + an arrow, with the Markdown export naming both.
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

/* ---- NEW-2 helpers: selecting a box, its chrome, and reading the arrow SVG ------------- */

/** Stage-1 select (ring, no caret) — NOT the top-left corner (carry-forward trap 9, the drag
 *  grip's own 12px-wide strip stops propagation on its own pointerdown). The connect dot and
 *  the resize handles are only hit-testable once a box carries `data-selected="1"`. */
async function selectBox(page, box) {
  await page.mouse.click(box.left + 60, box.top + 12);
  await pacedWait(page, 150);
}

/** A box's own chrome element, by testid/class, scoped to ITS `data-anchor-id` — never the
 *  first match on the page, or a two-box section would silently grab the wrong box's handle. */
const chromeRect = (page, anchorId, selector) => page.evaluate(([id, sel]) => {
  const el = document.querySelector(`.planyr-anchor[data-anchor-id="${id}"] ${sel}`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}, [anchorId, selector]);

/** Every arrow currently painted, as REAL SCREEN coordinates — read off the actual `<line>`
 *  via its own `getScreenCTM()`, not hand-computed from stored attrs, so a workspace pan/zoom
 *  (the transform the whole page rides on) or a layout shift is automatically accounted for. */
const arrowLines = (page) => page.evaluate(() => [...document.querySelectorAll('svg[data-testid="note-arrows"] line')].map((line) => {
  const svg = line.ownerSVGElement;
  const ctm = line.getScreenCTM();
  const toScreen = (x, y) => {
    const pt = svg.createSVGPoint();
    pt.x = x; pt.y = y;
    const p = pt.matrixTransform(ctm);
    return { x: p.x, y: p.y };
  };
  return {
    p1: toScreen(parseFloat(line.getAttribute("x1")), parseFloat(line.getAttribute("y1"))),
    p2: toScreen(parseFloat(line.getAttribute("x2")), parseFloat(line.getAttribute("y2"))),
  };
}));

/** True when `pt` sits within `tol` px of ANY point on box `b`'s own border rectangle — an
 *  arrow endpoint lands on the edge nearest the other box's centre, not at a fixed corner. */
function nearBoxEdge(pt, b, tol) {
  const onX = pt.x >= b.left - tol && pt.x <= b.right + tol;
  const onY = pt.y >= b.top - tol && pt.y <= b.bottom + tol;
  const nearLeft = Math.abs(pt.x - b.left) <= tol && onY;
  const nearRight = Math.abs(pt.x - b.right) <= tol && onY;
  const nearTop = Math.abs(pt.y - b.top) <= tol && onX;
  const nearBottom = Math.abs(pt.y - b.bottom) <= tol && onX;
  return nearLeft || nearRight || nearTop || nearBottom;
}

const EDGE_TOL = 8;

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

/* ═══ 13 · CLICK-TO-CONNECT — THE + ARROW TOOLBAR MODE DRAWS AN ARROW BETWEEN TWO BOXES ═══════ */
await section("13 · click-to-connect: + Arrow, click box A, click box B, one arrow appears", async (page) => {
  const body = await bodyRect(page);
  await dbl(page, body.left + 30, body.top + 30, "box A"); await page.keyboard.type("Acquisition");
  await pacedWait(page, 900);
  await dbl(page, body.left + 320, body.top + 30, "box B"); await page.keyboard.type("Title review");
  await pacedWait(page, 900);
  const [a, b] = await anchors(page);
  ok("two boxes exist before connecting", (await anchors(page)).length === 2);

  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");   // fully deselect first
  await pacedWait(page, 100);
  await page.click('[data-testid="nt-arrow"]');
  await pacedWait(page, 150);
  ok("arrow mode is armed on the mat", await page.evaluate(() => document.querySelector('[data-testid="note-mat"]')?.getAttribute("data-arrow-mode") === "1"));
  ok("the hint names the first step", (await page.evaluate(() => document.querySelector('[data-testid="note-arrow-status"]')?.textContent || "")).includes("starts from"));

  await page.mouse.click(a.left + 60, a.top + 12);
  await pacedWait(page, 120);
  ok("box A is marked as the arrow's source", await page.evaluate((id) => document.querySelector(`.planyr-anchor[data-anchor-id="${id}"]`)?.getAttribute("data-arrow-source") === "1", a.id));
  ok("the hint now names the second step", (await page.evaluate(() => document.querySelector('[data-testid="note-arrow-status"]')?.textContent || "")).includes("points to"));

  await page.mouse.click(b.left + 60, b.top + 12);
  await pacedWait(page, 200);
  ok("arrow mode exits once the arrow is drawn", await page.evaluate(() => document.querySelector('[data-testid="note-mat"]')?.getAttribute("data-arrow-mode")) == null);
  const lines = await arrowLines(page);
  ok("exactly one arrow was drawn", lines.length === 1, `${lines.length} line(s)`);
  ok("no box was created or removed by the connecting gesture", (await anchors(page)).length === 2);
  if (lines.length === 1) {
    const aRect = await chromeRect(page, a.id, "");
    const bRect = await chromeRect(page, b.id, "");
    const oneEndOnA = nearBoxEdge(lines[0].p1, aRect, EDGE_TOL) || nearBoxEdge(lines[0].p2, aRect, EDGE_TOL);
    const oneEndOnB = nearBoxEdge(lines[0].p1, bRect, EDGE_TOL) || nearBoxEdge(lines[0].p2, bRect, EDGE_TOL);
    ok("the arrow's two ends sit on the two boxes' own edges", oneEndOnA && oneEndOnB,
      `A=${JSON.stringify(aRect)} B=${JSON.stringify(bRect)} line=${JSON.stringify(lines[0])}`);
  }

  await page.click('[data-testid="nt-arrow"]');
  await pacedWait(page, 100);
  await page.mouse.click(a.left + 60, a.top + 12);
  await pacedWait(page, 100);
  const outsidePoint = { x: body.left + 20, y: body.top + 400 };
  await page.mouse.click(outsidePoint.x, outsidePoint.y);
  await pacedWait(page, 150);
  ok("a press on bare canvas cancels the connecting gesture rather than drawing a second arrow",
    (await arrowLines(page)).length === 1 && (await anchors(page)).length === 2);
});

/* ═══ 14 · DRAG-FROM-THE-DOT — THE OTHER WAY TO DRAW AN ARROW ═════════════════════════════════ */
await section("14 · drag from a selected box's connect dot onto another box draws an arrow", async (page) => {
  const body = await bodyRect(page);
  await dbl(page, body.left + 30, body.top + 30, "box A"); await page.keyboard.type("Environmental");
  await pacedWait(page, 900);
  await dbl(page, body.left + 320, body.top + 200, "box B"); await page.keyboard.type("Phase I");
  await pacedWait(page, 900);
  const [a, b] = await anchors(page);
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await pacedWait(page, 100);

  await selectBox(page, a);
  const dot = await chromeRect(page, a.id, '[data-testid="note-anchor-connect"]');
  ok("the connect dot exists on the selected box", !!dot);
  if (dot) {
    const target = await chromeRect(page, b.id, "");
    await page.mouse.move(dot.cx, dot.cy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) {
      await page.mouse.move(dot.cx + ((target.cx - dot.cx) * i) / 8, dot.cy + ((target.cy - dot.cy) * i) / 8);
    }
    await pacedWait(page, 80);
    ok("the drop target is highlighted mid-drag", await page.evaluate((id) => document.querySelector(`.planyr-anchor[data-anchor-id="${id}"]`)?.getAttribute("data-arrow-target") === "1", b.id));
    await page.mouse.up();
    await pacedWait(page, 250);
  }
  const lines = await arrowLines(page);
  ok("exactly one arrow was drawn by the drag", lines.length === 1, `${lines.length} line(s)`);
  ok("no box was created by the drag gesture", (await anchors(page)).length === 2);
});

/* ═══ 15 · MOVING A CONNECTED BOX — THE ARROW'S ENDPOINT FOLLOWS IT ════════════════════════════ */
await section("15 · dragging a connected box by its grip moves the arrow's endpoint with it", async (page) => {
  const body = await bodyRect(page);
  await dbl(page, body.left + 30, body.top + 30, "box A"); await page.keyboard.type("Acquisition");
  await pacedWait(page, 900);
  await dbl(page, body.left + 320, body.top + 30, "box B"); await page.keyboard.type("Title");
  await pacedWait(page, 900);
  const [a, b] = await anchors(page);
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await pacedWait(page, 100);
  await page.click('[data-testid="nt-arrow"]');
  await page.mouse.click(a.left + 60, a.top + 12);
  await pacedWait(page, 100);
  await page.mouse.click(b.left + 60, b.top + 12);
  await pacedWait(page, 250);
  ok("seed: one arrow exists before the move", (await arrowLines(page)).length === 1);

  await selectBox(page, b);
  const grip = await chromeRect(page, b.id, ".planyr-anchor-grip");
  ok("the grip exists on the selected box", !!grip);
  if (grip) {
    const DX = 0; const DY = 220;
    await page.mouse.move(grip.cx, grip.cy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) await page.mouse.move(grip.cx + (DX * i) / 10, grip.cy + (DY * i) / 10);
    await page.mouse.up();
    await pacedWait(page, 900);           // past the save debounce
  }
  const movedB = (await anchors(page)).find((x) => x.id === b.id);
  ok("box B actually moved", movedB && Math.abs(movedB.top - b.top - 220) < 20, `top ${b.top} → ${movedB?.top}`);
  const lines = await arrowLines(page);
  ok("still exactly one arrow after the move", lines.length === 1, `${lines.length} line(s)`);
  if (lines.length === 1 && movedB) {
    const bRect = await chromeRect(page, b.id, "");
    const endOnMovedB = nearBoxEdge(lines[0].p1, bRect, EDGE_TOL) || nearBoxEdge(lines[0].p2, bRect, EDGE_TOL);
    ok("the arrow's endpoint tracked the box to its NEW position, not its old one", endOnMovedB,
      `box now at ${JSON.stringify(bRect)}, line ${JSON.stringify(lines[0])}`);
  }
});

/* ═══ 16 · RESIZING A CONNECTED BOX — THE ARROW'S ENDPOINT FOLLOWS THE NEW EDGE ════════════════ */
await section("16 · resizing a connected box moves the arrow's endpoint to the new edge", async (page) => {
  const body = await bodyRect(page);
  await dbl(page, body.left + 30, body.top + 30, "box A"); await page.keyboard.type("Acquisition");
  await pacedWait(page, 900);
  await dbl(page, body.left + 320, body.top + 30, "box B"); await page.keyboard.type("Title");
  await pacedWait(page, 900);
  const [a, b] = await anchors(page);
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await pacedWait(page, 100);
  await page.click('[data-testid="nt-arrow"]');
  await page.mouse.click(a.left + 60, a.top + 12);
  await pacedWait(page, 100);
  await page.mouse.click(b.left + 60, b.top + 12);
  await pacedWait(page, 250);

  await selectBox(page, b);
  const handle = await chromeRect(page, b.id, ".planyr-anchor-h-e");    // east: a text box's own resizable edge
  ok("the east resize handle exists on the selected box", !!handle);
  if (handle) {
    await page.mouse.move(handle.cx, handle.cy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(handle.cx + (140 * i) / 8, handle.cy);
    await page.mouse.up();
    await pacedWait(page, 900);
  }
  const lines = await arrowLines(page);
  ok("still exactly one arrow after the resize", lines.length === 1, `${lines.length} line(s)`);
  if (lines.length === 1) {
    const bRect = await chromeRect(page, b.id, "");
    const endOnResizedB = nearBoxEdge(lines[0].p1, bRect, EDGE_TOL) || nearBoxEdge(lines[0].p2, bRect, EDGE_TOL);
    ok("the arrow's endpoint tracked the box's NEW (wider) edge", endOnResizedB,
      `box now at ${JSON.stringify(bRect)}, line ${JSON.stringify(lines[0])}`);
  }
});

/* ═══ 17 · TOMBSTONE-DELETES — DELETING A BOX TAKES ITS ARROW, UNDO BRINGS BOTH BACK ══════════ */
await section("17 · deleting a connected box removes its arrow too; undo restores both in one step", async (page) => {
  const body = await bodyRect(page);
  await dbl(page, body.left + 30, body.top + 30, "box A"); await page.keyboard.type("Acquisition");
  await pacedWait(page, 900);
  await dbl(page, body.left + 320, body.top + 30, "box B"); await page.keyboard.type("Title");
  await pacedWait(page, 900);
  const [a, b] = await anchors(page);
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await pacedWait(page, 100);
  await page.click('[data-testid="nt-arrow"]');
  await page.mouse.click(a.left + 60, a.top + 12);
  await pacedWait(page, 100);
  await page.mouse.click(b.left + 60, b.top + 12);
  await pacedWait(page, 250);
  ok("seed: two boxes and one arrow before the delete", (await anchors(page)).length === 2 && (await arrowLines(page)).length === 1);

  // Select box B (stage 1) and delete it with a REAL key — SYNTHETIC-KEYS-DONT-EDIT.
  await selectBox(page, b);
  await page.keyboard.press("Delete");
  await pacedWait(page, 400);
  ok("the box is gone", (await anchors(page)).length === 1, `${(await anchors(page)).length} anchor(s)`);
  ok("its arrow is gone WITH it — no dangling reference", (await arrowLines(page)).length === 0,
    `${(await arrowLines(page)).length} line(s) remain`);
  const jsonAfterDelete = await page.evaluate(() => window.__noteEditor?.json?.() ?? null);
  ok("the stored document's arrows list is empty, not merely the drawing", (jsonAfterDelete?.attrs?.arrows || []).length === 0);

  await page.keyboard.press("Control+z");
  await pacedWait(page, 400);
  ok("undo brings the box back", (await anchors(page)).length === 2, `${(await anchors(page)).length} anchor(s)`);
  ok("...and the arrow with it, IN THE SAME UNDO STEP", (await arrowLines(page)).length === 1,
    `${(await arrowLines(page)).length} line(s)`);
});

/* ═══ 18 · RELOAD — BOXES AND THEIR ARROW SURVIVE AT THE SAME POSITIONS ═══════════════════════ */
await section("18 · a reload brings back both boxes and the arrow between them, unmoved", async (page) => {
  const body = await bodyRect(page);
  await dbl(page, body.left + 40, body.top + 40, "box A"); await page.keyboard.type("Acquisition");
  await pacedWait(page, 900);
  await dbl(page, body.left + 330, body.top + 40, "box B"); await page.keyboard.type("Title");
  await pacedWait(page, 900);
  const [a, b] = await anchors(page);
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await pacedWait(page, 100);
  await page.click('[data-testid="nt-arrow"]');
  await page.mouse.click(a.left + 60, a.top + 12);
  await pacedWait(page, 100);
  await page.mouse.click(b.left + 60, b.top + 12);
  await pacedWait(page, 1000);              // past the save debounce, before reloading

  const beforeAnchors = await anchors(page);
  const beforeLines = await arrowLines(page);
  ok("seed: two boxes, one arrow, before the reload", beforeAnchors.length === 2 && beforeLines.length === 1);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);

  const afterAnchors = await anchors(page);
  ok("both boxes survive the reload, at their stored positions", afterAnchors.length === 2
    && afterAnchors.every((x) => beforeAnchors.some((y) => y.id === x.id && Math.abs(x.storedX - y.storedX) <= 1 && Math.abs(x.storedY - y.storedY) <= 1)),
    `${afterAnchors.length} anchor(s)`);
  const afterLines = await arrowLines(page);
  ok("the arrow survives the reload too", afterLines.length === 1, `${afterLines.length} line(s)`);
});

/* ═══ 19 · MIGRATION — A STORED SKETCH BECOMES REAL BOXES + AN ARROW, ON READ ══════════════════ */
await section("19 · a page whose stored sketch holds two connected boxes opens with real boxes + one arrow", async (page) => {
  const FIXTURE = {
    type: "doc",
    content: [
      {
        type: "noteSketch",
        attrs: {
          boxes: [
            { id: "sk1", label: "Acquisition", body: "", x: 20, y: 20 },
            { id: "sk2", label: "Title review", body: "Order the commitment.", x: 260, y: 20 },
          ],
          links: [{ from: "sk1", to: "sk2" }],
        },
      },
      { type: "paragraph" },
    ],
  };

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const p = await ctx.newPage();
  await assertMeasurable(p, "verify-notes-in-sheet-placement (sketch migration)");
  await p.addInitScript(() => { window.__PLANYR_E2E = true; });
  await p.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(p, 250);
  await p.evaluate(([tk, pk, d]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Old sketch page", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, FIXTURE]);
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(p, 900);

  const list = await p.evaluate(() => [...document.querySelectorAll(".planyr-anchor")].map((el) => ({
    id: el.getAttribute("data-anchor-id"), text: el.textContent.trim(),
  })));
  ok("the sketch's two boxes became two real noteAnchor boxes", list.length === 2, `${list.length} anchors`);
  ok("their words survived (label AND body)", list.some((x) => x.text.includes("Acquisition"))
    && list.some((x) => x.text.includes("Title review") && x.text.includes("Order the commitment.")));

  const lines = await arrowLines(p);
  ok("the sketch's link became exactly one document arrow", lines.length === 1, `${lines.length} line(s)`);

  ok("the stored page was NOT rewritten by opening it — migration is in-memory only",
    (await p.evaluate((k) => localStorage.getItem(k), PAGE_KEY)) === JSON.stringify(FIXTURE));

  const liveJson = await p.evaluate(() => window.__noteEditor?.json?.() ?? null);
  ok("the E2E hook returned the live (migrated) document", !!liveJson);
  if (liveJson) {
    ok("doc.attrs.arrows carries the converted link", (liveJson.attrs?.arrows || []).length === 1);
    const { markdown } = docToMarkdown(liveJson, { title: "" });
    ok("the Markdown export lists both box texts", markdown.includes("Acquisition") && markdown.includes("Title review"));
    ok("...and the connection between them", markdown.includes("Connected boxes:") && /Acquisition.*→.*Title review/.test(markdown));
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
