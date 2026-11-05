/* verify-cursors-notes.mjs — B2426784 (NEW-3) cursor convention, NOTES slice (docs/DESIGN.md "Cursor convention").
 * Reads getComputedStyle(elementFromPoint(x, y)).cursor — the cursor the browser would paint — at named points for each
 * state: idle · hover object · editing · armed tool · mid-drag · Space held · disabled · chrome. A drag is read WITH the
 * button still down and the pointer well off the thing being dragged (that is the whole defect: the cursor reverting
 * the moment the pointer leaves the grip). Where a drag holds pointer capture the capture target's own cursor is read
 * too, because Chromium paints that one.
 *
 *   node ui-audit/verify-cursors-notes.mjs [http://localhost:4181 | https://planyr.io]
 *
 * A https://planyr.io base signs in as the test account first (E2E_LOGIN_KEY, ui-audit/lib/signedInSession.mjs), builds
 * its own throwaway page by real presses, prints /version.json in the SAME call as the verdict, and deletes the page.
 * A local base seeds a page into localStorage (and also covers the table-border and mini-toolbar rows).
 *
 * ⛔ KNOWN-GOOD ARMS (expected independently of the code under test — DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): an injected
 * <a href> reads pointer and <body> reads auto/default; a plain tree row reads pointer. If any is wrong the run is VOID
 * and exits 2 without scoring. VACUITY: a state whose probe point cannot be hit-tested to the thing it names VOIDs the
 * run rather than scoring a neighbour. FOREGROUND-OR-VOID: assertMeasurable runs before anything is read.
 * NOT DRIVEN HERE (source-guarded by test/cursorConventionNotes.test.js): the paste-options chip (needs a real
 * formatted clipboard), the conflict redline's <summary> (needs a two-device conflict), the editor-loading fallback
 * (gone in a frame), and a drag-and-drop dropEffect (Chromium exposes no cursor for a native drag). */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { clientOf, blocksOn } from "./lib/pressFeature.mjs";

const BASE = (process.argv[2] || process.env.BASE_URL || "http://localhost:4181").replace(/\/$/, "");
const EXEC = process.env.PW_CHROME || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].find(existsSync);
const SIGNED_IN = /^https:\/\/planyr\.io/.test(BASE) && !!process.env.E2E_LOGIN_KEY;
const VIEWPORT = { width: 1400, height: 900 };
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

let page, close = async () => {}, build = null;
const results = [];
const check = (name, got, want) => {
  const ok = Array.isArray(want) ? want.includes(got) : got === want;
  results.push({ name, got, want, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  → ${got} (want ${Array.isArray(want) ? want.join(" | ") : want})`);
};
const note = (name, value) => console.log(`NOTE  ${name}  → ${value}`);
const void_ = (why) => { console.error(`VOID: ${why}`); process.exit(2); };

if (SIGNED_IN) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  const s = await openSignedIn({ base: BASE, viewport: VIEWPORT });
  page = s.page; close = s.close; build = s.build;
} else {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
  close = () => browser.close();
}
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));

/* ── readers ─────────────────────────────────────────────────────────────────────────────────── */
const cursorAt = (x, y) => page.evaluate(([px, py]) => {
  const el = document.elementFromPoint(px, py);
  return el ? getComputedStyle(el).cursor : "NOHIT";
}, [x, y]);
const describeAt = (x, y) => page.evaluate(([px, py]) => {
  const el = document.elementFromPoint(px, py);
  if (!el) return "NOHIT";
  return `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""}`;
}, [x, y]);
const rect = (sel, nth = 0) => page.evaluate(([s, n]) => {
  const el = document.querySelectorAll(s)[n];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, right: r.right, bottom: r.bottom };
}, [sel, nth]);
const cursorOfSel = (sel, nth = 0) => page.evaluate(([s, n]) => { const el = document.querySelectorAll(s)[n]; return el ? getComputedStyle(el).cursor : "MISSING"; }, [sel, nth]);
/** Move the pointer to (x, y) THEN read it — for a point the dragged thing has not followed to. */
const cursorAtAfterMove = async (x, y) => { await page.mouse.move(x, y, { steps: 10 }); await pacedWait(page, 90); return cursorAt(x, y); };
/** Space-held presses must not go into a text field. */
const clickBoxSafe = async () => {};
const move = async (x, y, steps = 8) => { await page.mouse.move(x, y, { steps }); await pacedWait(page, 90); };

/** The nth box's text point (inside its content, away from the grip at its top-left corner). */
const boxPoint = async (nth) => {
  const r = await rect('[data-testid="note-anchor"]', nth);
  if (!r) void_(`box ${nth} not on the page`);
  return { x: Math.round(r.x + Math.min(r.w - 12, 60)), y: Math.round(r.y + r.h / 2), r };
};
const stateOf = (nth) => page.evaluate((n) => {
  const b = document.querySelectorAll('[data-testid="note-anchor"]')[n];
  return b ? { selected: b.getAttribute("data-selected") === "1", editing: b.getAttribute("data-editing") === "1" } : null;
}, nth);
/** A point that really is the grey mat (not the sheet, not a box, not chrome). VOID if there is none. */
const greyPoint = async () => {
  const p = await page.evaluate(() => {
    const mat = document.querySelector('[data-testid="note-mat"]');
    const r = mat.getBoundingClientRect();
    for (let fy = 0.5; fy <= 0.95; fy += 0.1) for (let fx = 0.97; fx >= 0.03; fx -= 0.06) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      const el = document.elementFromPoint(x, y);
      if (el && mat.contains(el) && !el.closest('[data-testid="note-sheet"]') && !el.closest('[data-testid="note-zoom-pill"]') && !el.closest("button")) return { x: Math.round(x), y: Math.round(y) };
    }
    return null;
  });
  if (!p) void_("no grey-mat point found — the sheet covers the whole mat at this window");
  return p;
};
/** A point on the sheet that is blank paper (no box, no control). */
const paperPoint = async () => {
  const p = await page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="note-sheet"]');
    const r = sheet.getBoundingClientRect();
    for (let fy = 0.92; fy >= 0.3; fy -= 0.06) for (let fx = 0.9; fx >= 0.1; fx -= 0.1) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      const el = document.elementFromPoint(x, y);
      if (el && sheet.contains(el) && !el.closest(".planyr-anchor") && !el.closest("input,button") && !el.closest("[class*=grip]")) return { x: Math.round(x), y: Math.round(y) };
    }
    return null;
  });
  if (!p) void_("no blank-paper point found on the sheet");
  return p;
};
const reset = async () => { await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await pacedWait(page, 150); };
const clickBox = async (nth) => { const p = await boxPoint(nth); await page.mouse.click(p.x, p.y); await pacedWait(page, 250); };
const enterBox = async (nth) => { await clickBox(nth); await pacedWait(page, 900); const p = await boxPoint(nth); await page.mouse.click(p.x, p.y); await pacedWait(page, 300); };

/* ── fixture ─────────────────────────────────────────────────────────────────────────────────── */
const cleanup = [];
let createdRowId = null;
/* A real DOUBLE-click, then the committing keystrokes — on the live signed-in build a single press on an EMPTY page does not arm the caret (the
 * placeholder says "Double-click anywhere to start a note"), so pressAt's single press cannot make the first box there. Found by driving it. */
async function dblPlace(docX, docY, text) {
  const c = await clientOf(page, docX, docY);
  if (!c) throw new Error("dblPlace: there is no note body on this page");
  await page.mouse.dblclick(c.x, c.y);
  await pacedWait(page, 300);
  await page.keyboard.type(text);
  const deadline = Date.now() + 4000;
  for (;;) {
    const hit = (await blocksOn(page)).find((b) => b.text.includes(text));
    if (hit) return hit;
    if (Date.now() > deadline) throw new Error(`dblPlace: no box holding "${text}" after a real double-click at (${docX}, ${docY})`);
    await pacedWait(page, 80);
  }
}
async function openFixture() {
  if (SIGNED_IN) {
    await page.goto(`${BASE}/#/notes`, { waitUntil: "load" });
    await pacedWait(page, 2500);
    await page.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 });
    const rowIds = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="notes-row-pg_"]')].map((e) => e.getAttribute("data-testid")));
    const rowsBefore = new Set(await rowIds());
    await page.click('[data-testid="notes-new-page"]');
    await page.waitForSelector('[data-testid="note-body"]', { timeout: 30000 });
    await pacedWait(page, 800);
    const fresh = (await rowIds()).filter((x) => !rowsBefore.has(x));
    if (fresh.length !== 1) throw new Error(`openFixture: expected exactly one new page row, saw ${fresh.length} — refusing to continue (cleanup needs a certain id)`);
    createdRowId = fresh[0];
    await dblPlace(40, 20, "one");
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await dblPlace(40, 90, "two");
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await dblPlace(300, 20, "three");
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await pacedWait(page, 500);
    return;
  }
  await page.goto(`${BASE}/#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([treeKey, prefix]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "Cursor page", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    const P = (t) => (t ? { type: "paragraph", content: [{ type: "text", text: t }] } : { type: "paragraph" });
    const box = (x, y, t) => ({ type: "noteAnchor", attrs: { x, y, w: 160 }, content: [P(t)] });
    const cell = (t) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [P(t)] });
    const row = (a, b) => ({ type: "tableRow", content: [cell(a), cell(b)] });
    const tableBox = { type: "noteAnchor", attrs: { x: 40, y: 170, w: 320 }, content: [{ type: "table", content: [row("alpha", "beta"), row("gamma", "delta")] }] };
    localStorage.setItem(prefix + "p1", JSON.stringify({ type: "doc", content: [box(40, 20, "one"), box(40, 90, "two"), box(300, 20, "three"), tableBox, P("")] }));
  }, [TREE_KEY, PAGE_PREFIX]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-anchor"]', { timeout: 30000 });
  await pacedWait(page, 1200);
}

/** A fresh, un-panned, un-selected page with the canvas zoomed out one step so BOTH page edges and a grey margin are on screen.
 *  Every section starts here: a harness that keeps pressing the same box ends up inside it (NOTES-CARRY-FORWARD trap 11) and a
 *  pan or width drag moves every point a later section computed (trap 18). */
let grey, paper;
async function fresh() {
  if (SIGNED_IN) { await page.reload({ waitUntil: "load" }); await page.waitForSelector('[data-testid="note-anchor"]', { timeout: 30000 }); await pacedWait(page, 1200); }
  else await openFixture();
  await page.waitForSelector('[data-testid="note-mat"]', { timeout: 30000 });
  await page.evaluate(() => { document.activeElement?.blur?.(); });
  await page.keyboard.press("Control+Minus");
  await pacedWait(page, 500);
  await page.mouse.move(2, 2);
  grey = await greyPoint();
  paper = await paperPoint();
}

async function removeFixture() {
  if (!SIGNED_IN) return;
  var step = "start";
  // Throwaway page on a SHARED test account: bin exactly the row this run created (by id), then purge exactly the one new Bin entry. Anything
  // uncertain is reported as a FAILED cleanup, never "closest match" — the account holds other sessions' pages.
  try {
    if (!createdRowId) { note("cleanup", "no page was created — nothing to remove"); return; }
    const binIds = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="notes-bin-tr_"]')].map((e) => e.getAttribute("data-testid")).filter((x) => !/preview|peek|restore|purge|project|viewing/.test(x)));
    const showBin = async () => { step = "open the Bin"; await page.locator('[data-testid="notes-view-bin"]').click({ timeout: 8000 }); await pacedWait(page, 1000); };
    await page.evaluate(() => { document.activeElement?.blur?.(); });
    step = "right-click the page row";
    await page.locator(`[data-testid="${createdRowId}"]`).click({ button: "right", timeout: 8000 });
    await pacedWait(page, 300);
    step = "choose Delete";
    await page.getByRole("menuitem", { name: /Delete/ }).first().click({ timeout: 8000 });
    await pacedWait(page, 400);
    step = "confirm the delete";
    await page.getByText("✓").first().click({ timeout: 4000 }).catch(() => {});
    await pacedWait(page, 900);
    await showBin();
    // The Bin lists what other sessions left on this shared account too; a page binned just now is the only entry with the full 30 days left.
    const texts = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-testid^="notes-bin-tr_"]')].map((e) => [e.getAttribute("data-testid"), e.innerText])));
    const fresh = (await binIds()).filter((x) => /\b30 days left/.test(texts[x] || ""));
    if (fresh.length !== 1) { check("cleanup: the throwaway page is binned AND purged", `${fresh.length} new Bin entries (expected 1) — purge by hand: ${createdRowId}`, "purged"); return; }
    step = "purge from the Bin";
    await page.locator(`[data-testid="notes-bin-purge-${fresh[0].replace("notes-bin-", "")}"]`).click({ timeout: 8000 });
    await pacedWait(page, 500);
    await page.getByText("✓").first().click({ timeout: 3000 }).catch(() => {});
    await pacedWait(page, 900);
    const left = await binIds();
    check("cleanup: the throwaway page is binned AND purged", left.includes(fresh[0]) ? `${fresh[0]} still in the Bin` : "purged", "purged");
  } catch (e) { check("cleanup: the throwaway page is binned AND purged", `failed — ${createdRowId} left on the account`, "purged"); note("cleanup", `FAILED to remove the throwaway page ${createdRowId} at step "${typeof step === "undefined" ? "?" : step}" — ${String(e).slice(0, 140)}`); }
}

try {
  await openFixture();
  await page.waitForSelector('[data-testid="note-mat"]', { timeout: 30000 });
  await assertMeasurable(page, "verify-cursors-notes");
  if (!build) build = await page.evaluate(() => fetch("/version.json").then((r) => r.json()).catch(() => null));

  /* ── known-good arms ─────────────────────────────────────────────────────────────────────── */
  await page.evaluate(() => {
    const a = document.createElement("a"); a.href = "#cur-probe"; a.id = "cur-probe"; a.textContent = "probe";
    a.style.cssText = "position:fixed;left:6px;bottom:6px;z-index:2147483647;background:#fff;padding:4px";
    document.body.appendChild(a);
  });
  const goodLink = await cursorOfSel("#cur-probe");
  const goodBody = await page.evaluate(() => getComputedStyle(document.body).cursor);
  if (goodLink !== "pointer" || (goodBody !== "auto" && goodBody !== "default")) void_(`known-good arms disagree (link=${goodLink}, body=${goodBody})`);
  check("known-good: a link", goodLink, "pointer");
  const treeRow = await cursorOfSel('[data-testid^="notes-row"], [role="treeitem"], [data-page-id]');
  if (treeRow !== "MISSING") check("known-good: a page row in the rail", treeRow, "pointer");
  await page.evaluate(() => document.getElementById("cur-probe")?.remove());

  /* ── 1. IDLE + HOVER ─────────────────────────────────────────────────────────────────────── */
  await fresh();
  const boxCount = await page.evaluate(() => document.querySelectorAll('[data-testid="note-anchor"]').length);
  if (boxCount < 3) void_(`fixture holds ${boxCount} boxes, need 3`);
  note("grey point", `${grey.x},${grey.y} → ${await describeAt(grey.x, grey.y)}`);
  note("paper point", `${paper.x},${paper.y} → ${await describeAt(paper.x, paper.y)}`);
  await move(paper.x, paper.y);
  check("idle: blank paper on the sheet", await cursorAt(paper.x, paper.y), ["auto", "default"]);
  await move(grey.x, grey.y);
  check("idle: the grey margin (a drag pans)", await cursorAt(grey.x, grey.y), "grab");
  const b0 = await boxPoint(0);
  await move(b0.x, b0.y);
  check("hover an UNSELECTED box body (a drag from it pans)", await cursorAt(b0.x, b0.y), "grab");
  await clickBox(0);
  const s0 = await stateOf(0);
  if (!s0?.selected || s0.editing) void_(`press 1 did not leave box 0 selected-and-not-editing (${JSON.stringify(s0)})`);
  await move(b0.x, b0.y);
  check("hover a SELECTED single box body (the next press enters it and puts the caret there)", await cursorAt(b0.x, b0.y), "text");
  const bandR = await rect('[data-testid="note-anchor"]', 0);
  const bandPt = { x: Math.round(bandR.x + bandR.w * 0.3), y: Math.round(bandR.y + 0.5) };
  await move(bandPt.x, bandPt.y);
  check("hover a box's BORDER band (B2426788 — the striped grip is retired)", await cursorAt(bandPt.x, bandPt.y), "move");

  /* ── 2. MID-DRAG: BODY of a box in a multi-selection (the one body that really drags). The dragged boxes follow the
   *      pointer, so the element under it is a dragged box; the pin is also read at a point they have NOT followed to. ── */
  await fresh();
  await clickBox(0);
  const bd1 = await boxPoint(1);
  await page.keyboard.down("Shift");
  await page.mouse.click(bd1.x, bd1.y);
  await page.keyboard.up("Shift");
  await pacedWait(page, 300);
  const nSel = await page.evaluate(() => document.querySelectorAll('[data-testid="note-anchor"][data-selected="1"]').length);
  if (nSel < 2) void_(`Shift+click did not build a two-box selection (${nSel} selected)`);
  const bd = await boxPoint(0);
  const tb = await rect('[data-testid="note-toolbar"]');
  await move(bd.x, bd.y);
  check("hover a box in a multi-selection (its body drags the group)", await cursorAt(bd.x, bd.y), "move");
  const before = await rect('[data-testid="note-anchor"]', 0);
  await page.mouse.down();
  await move(bd.x + 30, bd.y + 12, 6);
  const after = await rect('[data-testid="note-anchor"]', 0);
  if (Math.abs(after.x - before.x) + Math.abs(after.y - before.y) < 10) void_("the group drag never moved the box — the probe is not measuring a drag");
  check("mid-drag of a group BODY: under the pointer", await cursorAt(bd.x + 30, bd.y + 12), "move");
  if (tb) check("mid-drag of a group BODY: pointer far off, over the toolbar", await cursorAtAfterMove(tb.cx, tb.cy), "move");
  await page.mouse.up();
  await pacedWait(page, 250);
  if (tb) check("after the group drag: pin released (over the toolbar → its own cursor)", await cursorAt(tb.cx, tb.cy), ["auto", "default", "pointer"]);

  /* ── 3. MID-DRAG: BORDER band (not editing) ───────────────────────────────────────────────── */
  await fresh();
  const bg = await boxPoint(0);
  await move(bg.x, bg.y);
  const g1r = await rect('[data-testid="note-anchor"]', 0);
  const g1 = { cx: Math.round(g1r.x + g1r.w * 0.3), cy: Math.round(g1r.y + 0.5) };
  await move(g1.cx, g1.cy);
  await page.mouse.down();
  await move(g1.cx + 30, g1.cy + 14, 6);
  check("mid-drag of a box BORDER: under the pointer", await cursorAt(g1.cx + 30, g1.cy + 14), "move");
  if (tb) check("mid-drag of a box BORDER: pointer far off, over the toolbar", await cursorAtAfterMove(tb.cx, tb.cy), "move");
  await page.mouse.up();
  await pacedWait(page, 250);

  /* ── 4. EDITING + the BORDER drag of an EDITING box (audit: UNVERIFIED — does an I-beam leak through capture?) ── */
  await fresh();
  await enterBox(1);
  const s1 = await stateOf(1);
  if (!s1?.editing) void_(`box 1 is not in editing state after two presses (${JSON.stringify(s1)})`);
  const e1 = await boxPoint(1);
  await move(e1.x, e1.y);
  check("editing: over the typed text", await cursorAt(e1.x, e1.y), "text");
  const g2r = await rect('[data-testid="note-anchor"]', 1);
  const g2 = { cx: Math.round(g2r.x + g2r.w * 0.3), cy: Math.round(g2r.y + 0.5) };
  await move(g2.cx, g2.cy);
  check("editing box: over its own BORDER band (rest) — move, not the I-beam", await cursorAt(g2.cx, g2.cy), "move");
  await page.mouse.down();
  await move(g2.cx + 30, g2.cy + 30, 6);
  const captureTarget = await cursorOfSel('[data-testid="note-anchor"]', 1);
  note("editing-box border drag: the captured box's own computed cursor (Chromium paints this one while captured)", captureTarget);
  check("mid-drag of an EDITING box's BORDER: under the pointer", await cursorAt(g2.cx + 30, g2.cy + 30), "move");
  await page.mouse.up();
  await pacedWait(page, 250);

  /* ── 5. PAGE EDGE GRIPS ──────────────────────────────────────────────────────────────────── */
  await fresh();
  const wg = await rect('[data-testid="note-page-width-grip-right"]');
  if (wg && wg.cx < VIEWPORT.width - 2) {
    await move(wg.cx, wg.cy);
    check("hover the page's right-edge grip", await cursorAt(wg.cx, wg.cy), "col-resize");
    await page.mouse.down();
    await move(wg.cx - 40, wg.cy, 6);
    await move(grey.x, grey.y, 10);
    check("mid-drag of the page WIDTH grip: pointer off the grip (over grey / sheet)", await cursorAt(grey.x, grey.y), "col-resize");
    if (tb) check("mid-drag of the page WIDTH grip: pointer far off, over the toolbar", await cursorAtAfterMove(tb.cx, tb.cy), "col-resize");
    await page.mouse.up();
    await pacedWait(page, 300);
  } else void_(`the page's right-edge grip is not on screen (${JSON.stringify(wg)})`);
  await fresh();
  const hg = await rect('[data-testid="note-page-height-grip-bottom"]');
  if (hg && hg.cy > 0 && hg.cy < VIEWPORT.height - 4) {
    await move(hg.cx, hg.cy);
    check("hover the page's bottom-edge grip", await cursorAt(hg.cx, hg.cy), "row-resize");
    await page.mouse.down();
    await move(hg.cx, hg.cy - 20, 4);
    await move(grey.x, grey.y, 10);
    check("mid-drag of the page HEIGHT grip: pointer off the grip", await cursorAt(grey.x, grey.y), "row-resize");
    if (tb) check("mid-drag of the page HEIGHT grip: pointer far off, over the toolbar", await cursorAtAfterMove(tb.cx, tb.cy), "row-resize");
    await page.mouse.up();
    await pacedWait(page, 300);
  } else note("page height grip", "bottom grip is below the window at this size — skipped (never scored on a point it cannot hit)");

  /* ── 6. PAN LIVE: grabbing everywhere ────────────────────────────────────────────────────── */
  await fresh();
  await enterBox(1);
  const ed = await boxPoint(1);
  await move(grey.x, grey.y);
  await page.mouse.down();
  await move(grey.x - 6, grey.y - 6, 4);            // past the slop: the pan has latched
  await move(ed.x, ed.y, 10);
  check("pan live: over the text of an EDITING box", await cursorAt(ed.x, ed.y), "grabbing");
  check("pan live: over blank paper", await cursorAt(paper.x, paper.y), "grabbing");
  if (tb) check("pan live: pointer far off, over the toolbar", await cursorAtAfterMove(tb.cx, tb.cy), "grabbing");
  await page.mouse.up();
  await pacedWait(page, 250);
  await fresh();
  await clickBox(0);
  const sel0 = await boxPoint(0);
  await move(grey.x, grey.y);
  await page.mouse.down();
  await move(grey.x - 6, grey.y - 6, 4);
  const handle = await rect("[data-handle]", 0);
  if (handle) { await move(handle.cx, handle.cy, 10); check("pan live: over a selected box's resize handle", await cursorAt(handle.cx, handle.cy), "grabbing"); }
  await move(sel0.x, sel0.y, 6);
  check("pan live: over a selected box's body", await cursorAt(sel0.x, sel0.y), "grabbing");
  await page.mouse.up();
  await pacedWait(page, 250);
  check("after the pan: released", await cursorAt(grey.x, grey.y), "grab");

  /* ── 7. SPACE HELD: the hand before any drag ─────────────────────────────────────────────── */
  await fresh();
  await move(paper.x, paper.y);
  await page.keyboard.down("Space");
  await pacedWait(page, 120);
  const armed = await page.evaluate(() => document.querySelector('[data-testid="note-mat"]').getAttribute("data-space-pan"));
  if (armed !== "1") void_("Space did not arm data-space-pan — focus was probably in a field");
  check("Space held: over blank paper", await cursorAt(paper.x, paper.y), "grab");
  await clickBoxSafe();
  const bs = await boxPoint(2);
  await move(bs.x, bs.y);
  check("Space held: over a box", await cursorAt(bs.x, bs.y), "grab");
  await page.keyboard.up("Space");
  await pacedWait(page, 120);
  await move(paper.x, paper.y);
  check("Space released: blank paper is back to the arrow", await cursorAt(paper.x, paper.y), ["auto", "default"]);

  /* ── 8. ARMED CLICK-TO-CONNECT: crosshair over EVERYTHING ────────────────────────────────── */
  await fresh();
  let arrowBtn = await page.$('[data-testid="nt-arrow"]');
  if (!arrowBtn) { const more = await page.$('[data-testid="note-toolbar-more"] button, [data-testid="note-toolbar-more"]'); if (more) { await more.click(); await pacedWait(page, 250); arrowBtn = await page.$('[data-testid="nt-arrow"]'); } }
  if (!arrowBtn) void_("the Arrow control is not reachable");
  await arrowBtn.click();
  await pacedWait(page, 250);
  const armedArrow = await page.evaluate(() => document.querySelector('[data-testid="note-mat"]').getAttribute("data-arrow-mode"));
  if (armedArrow !== "1") void_("click-to-connect did not arm");
  const ba = await boxPoint(0);
  await move(grey.x, grey.y);
  check("arrow mode armed: grey margin", await cursorAt(grey.x, grey.y), "crosshair");
  await move(ba.x, ba.y);
  check("arrow mode armed: over an existing box", await cursorAt(ba.x, ba.y), "crosshair");
  await move(paper.x, paper.y);
  check("arrow mode armed: over blank paper", await cursorAt(paper.x, paper.y), "crosshair");
  await page.keyboard.press("Escape");
  await pacedWait(page, 250);
  check("arrow mode cancelled: paper is back to the arrow", await cursorAt(paper.x, paper.y), ["auto", "default"]);

  /* ── 9. FIND & REPLACE ───────────────────────────────────────────────────────────────────── */
  await fresh();
  await page.keyboard.press("Control+h");
  await page.waitForSelector('[data-testid="note-find-replace-bar"]', { timeout: 8000 });
  await pacedWait(page, 200);
  for (const id of ["note-find-replace-prev", "note-find-replace-next", "note-replace-one", "note-replace-all"]) {
    const r = await rect(`[data-testid="${id}"]`);
    const dis = await page.evaluate((i) => document.querySelector(`[data-testid="${i}"]`).disabled, id);
    if (!dis) void_(`${id} is not disabled with an empty term`);
    await move(r.cx, r.cy, 3);
    check(`find & replace (no term): disabled ${id}`, await cursorAt(r.cx, r.cy), "default");
  }
  await page.fill('[data-testid="note-find-input"]', "two");
  await pacedWait(page, 400);
  for (const id of ["note-find-replace-next", "note-replace-all"]) {
    const r = await rect(`[data-testid="${id}"]`);
    const dis = await page.evaluate((i) => document.querySelector(`[data-testid="${i}"]`).disabled, id);
    if (dis) void_(`${id} is still disabled with a matching term`);
    await move(r.cx, r.cy, 3);
    check(`find & replace (match): enabled ${id}`, await cursorAt(r.cx, r.cy), "pointer");
  }

  /* ── 10. RIGHT-CLICK MENU CHROME ─────────────────────────────────────────────────────────── */
  await fresh();
  await enterBox(0);
  const rb = await boxPoint(0);
  await page.mouse.click(rb.x, rb.y, { button: "right" });
  await pacedWait(page, 500);
  if (!(await page.$('[data-testid="note-doc-menu"]'))) void_("the right-click menu did not open");
  const list = await rect('[data-testid="note-doc-menu-list"]');
  const lp = { x: Math.round(list.cx), y: Math.round(list.y + 3) };   // the list's own top padding, clear of the rounded corner
  note("right-click menu probe", await describeAt(lp.x, lp.y));
  await move(lp.x, lp.y, 3);
  check("right-click menu: its own padding", await cursorAt(lp.x, lp.y), "default");
  const sel = await rect('[data-testid="note-menu-size"]');
  if (sel) { await move(sel.cx, sel.cy, 3); check("mini-toolbar: the text-size select", await cursorAt(sel.cx, sel.cy), "pointer"); }
  const bold = await rect('[data-testid="note-menu-bold"]');
  if (bold) { await move(bold.cx, bold.cy, 3); check("mini-toolbar: a button", await cursorAt(bold.cx, bold.cy), "pointer"); }

  /* ── 11. SLASH MENU CHROME ───────────────────────────────────────────────────────────────── */
  await fresh();
  await enterBox(2);
  await page.keyboard.press("End");
  await page.keyboard.type(" /");
  await pacedWait(page, 500);
  if (!(await page.$('[data-testid="note-slash-menu"]'))) void_("the slash menu did not open");
  const m = await rect('[data-testid="note-slash-menu"]');
  const mp = { x: Math.round(m.cx), y: Math.round(m.y + 2.5) };      // the menu's own top padding, clear of the rounded corner
  const d = await describeAt(mp.x, mp.y);
  if (!/slash/.test(d) && !/^div$/.test(d.split("[")[0]) ) void_(`slash menu probe hit ${d}, not the menu`);
  await move(mp.x, mp.y, 3);
  check(`slash menu: its own padding (${d})`, await cursorAt(mp.x, mp.y), "default");
  const item = await rect('[data-testid^="note-slash-"]:not([data-testid="note-slash-menu"])', 0);
  if (item) { await move(item.cx, item.cy, 3); check("slash menu: a row", await cursorAt(item.cx, item.cy), "pointer"); }

  /* ── 12. TABLE COLUMN BORDER (local fixture only) ────────────────────────────────────────── */
  if (!SIGNED_IN) {
    await fresh();
    const cell = await rect(".planyr-anchor td", 0);
    if (!cell) void_("no table cell on the fixture page");
    const inside = { x: Math.round(cell.cx), y: Math.round(cell.cy) };
    await move(inside.x, inside.y);
    note("table: centre of a cell (control)", await cursorAt(inside.x, inside.y));
    let got = null;
    for (const dx of [0, -1, 1, -2, 2, -3, 3]) {          // the border is a few pixels wide; walk across it
      await move(Math.round(cell.right) + dx, inside.y, 2);
      const has = await page.evaluate(() => document.querySelector(".ProseMirror")?.classList.contains("resize-cursor"));
      if (has) { got = await cursorAt(Math.round(cell.right) + dx, inside.y); break; }
    }
    if (got == null) void_("hovering the column border never raised ProseMirror's resize-cursor class — the probe cannot see the zone");
    check("table: over a column border", got, "col-resize");
  }

  if (pageErrors.length) note("page errors", pageErrors.join(" | "));
} catch (e) {
  console.error("ERROR", e.stack || e.message);
  results.push({ name: "harness error", ok: false });
} finally {
  await removeFixture().catch(() => {});
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\nbuild: ${JSON.stringify(build)}\n${failed ? `FAIL ${failed}` : "PASS"} (${results.length} checks)`);
await close();
process.exit(failed ? 1 : 0);
