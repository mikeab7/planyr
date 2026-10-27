/* verify-notes-box-edge.mjs — B2426788: a Notes box is moved by grabbing its BORDER (PowerPoint / Word / Bluebeam), and the
 * striped grip is gone. Owner decision 2026-10-27 (CLAUDE.md "Owner product constraints" #37).
 *
 *   node ui-audit/verify-notes-box-edge.mjs [http://localhost:4181 | https://planyr.io]
 *
 * A https://planyr.io base signs in as the test account (E2E_LOGIN_KEY, ui-audit/lib/signedInSession.mjs), builds its own
 * throwaway page by real presses, prints /version.json in the SAME call as the verdict, and bins + purges the page. A local
 * base seeds a page into localStorage (and also covers the picture box).
 *
 * WHAT IT ASSERTS (every drag is a REAL mouse; every position is read from the STORED document, polled past the save
 * debounce — NOTES-CARRY-FORWARD traps 3 and 6):
 *   1  the band is a RING: elementFromPoint just OUTSIDE, ON and just INSIDE each of the four edges resolves to the move band
 *      with cursor `move`; further out / further in it does not (the middle of the box is not the band)
 *   2  the striped grip is gone (no .planyr-anchor-grip, no note-anchor-grip)
 *   3  hover: over the band the outline thickens in the accent colour; off it the box is clean again
 *   4  a drag from the band MOVES the box by the pointer's travel, stored; the cursor is `move` for the whole drag (read far
 *      off the box); a plain CLICK on the band selects the box, enters nothing and moves nothing
 *   5  a drag from the MIDDLE of an unselected box still PANS the page: the stored position does not change
 *   6  a resize handle keeps priority at its own spot (resolves to the handle, resizes) while the rest of that edge moves
 *   7  a box that has the CARET is still movable by its edge, and keeps its caret
 *   8  two selected boxes move together when one is grabbed by its edge (one delta)
 *   9  (local only) a PICTURE box gets the same border handle
 *
 * ⛔ KNOWN-GOOD ARMS (expected independently of the code under test — DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): row 5's pan is
 * the pre-existing behaviour and must still pan; a selected box's east handle must resolve to the handle. If an arm
 * reports the wrong thing the run is VOID (exit 2) and scores nothing. FOREGROUND-OR-VOID: assertMeasurable runs first. */
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
  const ok = typeof want === "function" ? want(got) : Array.isArray(want) ? want.includes(got) : got === want;
  results.push({ name, got, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  → ${typeof got === "object" ? JSON.stringify(got) : got}`);
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
let PAGE_ID = "p1";
let createdRowId = null;
const rect = (sel, nth = 0) => page.evaluate(([s, n]) => {
  const el = document.querySelectorAll(s)[n];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, right: r.right, bottom: r.bottom };
}, [sel, nth]);
/** What is under the pointer: the band side, the handle name, or the box/other. */
const probe = (x, y) => page.evaluate(([px, py]) => {
  const el = document.elementFromPoint(px, py);
  if (!el) return { kind: "NOHIT" };
  const edge = el.closest(".planyr-anchor-edge");
  if (edge) return { kind: "edge", side: edge.getAttribute("data-edge"), cursor: getComputedStyle(edge).cursor };
  const h = el.closest(".planyr-anchor-h");
  if (h) return { kind: "handle", name: h.getAttribute("data-handle"), cursor: getComputedStyle(h).cursor };
  return { kind: el.closest(".planyr-anchor") ? "box" : "other", cursor: getComputedStyle(el).cursor };
}, [x, y]);
const cursorAt = (x, y) => page.evaluate(([px, py]) => { const el = document.elementFromPoint(px, py); return el ? getComputedStyle(el).cursor : "NOHIT"; }, [x, y]);
const move = async (x, y, steps = 8) => { await page.mouse.move(x, y, { steps }); await pacedWait(page, 90); };
const scaleNow = () => page.evaluate(() => { const d = document.querySelector('[data-testid="note-body"]'); const r = d.getBoundingClientRect(); return r.width / (d.offsetWidth || 1) || 1; });
const stateOf = (nth) => page.evaluate((n) => {
  const b = document.querySelectorAll('[data-testid="note-anchor"]')[n];
  if (!b) return null;
  const sel = document.getSelection();
  return {
    selected: b.getAttribute("data-selected") === "1",
    editing: b.getAttribute("data-editing") === "1",
    caretInside: !!(sel && sel.anchorNode && b.contains(sel.anchorNode) && document.activeElement && document.activeElement.isContentEditable),
  };
}, nth);
/** The STORED document's boxes (not the screen's): [{ text, x, y, w, h }]. Polled by the caller past the 600 ms save debounce. */
const stored = () => page.evaluate((id) => {
  const key = Object.keys(localStorage).find((k) => k.startsWith("planyr:notes:page:v1:") && k.endsWith(`:${id}`));
  if (!key) return null;
  let doc = JSON.parse(localStorage.getItem(key));
  if (doc && doc.doc) doc = doc.doc;
  const text = (n) => (n.text || "") + (n.content || []).map(text).join("");
  return (doc.content || []).filter((n) => n.type === "noteAnchor").map((n) => ({ text: text(n).trim(), kind: (n.content || [])[0]?.type, x: n.attrs.x, y: n.attrs.y, w: n.attrs.w, h: n.attrs.h }));
}, PAGE_ID);
const boxStored = async (marker) => (await stored())?.find((b) => b.text === marker || (marker === "#img" && b.kind === "noteImage")) || null;
/** Wait until `pred(box)` holds in STORAGE (a read straight after a gesture races the save debounce). */
async function storedUntil(marker, pred, ms = 5000) {
  const end = Date.now() + ms;
  let last = null;
  for (;;) {
    last = await boxStored(marker);
    if (last && pred(last)) return last;
    if (Date.now() > end) return last;
    await pacedWait(page, 120);
  }
}
const boxRect = (nth) => rect('[data-testid="note-anchor"]', nth);
const reset = async () => { await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await pacedWait(page, 150); };
const bodyPoint = async (nth) => { const r = await boxRect(nth); return { x: Math.round(r.x + Math.min(r.w - 14, 60)), y: Math.round(r.y + r.h / 2), r }; };
const clickBody = async (nth) => { const p = await bodyPoint(nth); await page.mouse.click(p.x, p.y); await pacedWait(page, 250); };
const enterBox = async (nth) => { await clickBody(nth); await pacedWait(page, 900); const p = await bodyPoint(nth); await page.mouse.click(p.x, p.y); await pacedWait(page, 300); };
/** A point on the top band of a box, away from the corners and the (picture-box) north handle at the midpoint. */
const topBand = (r, dy = 0.5) => ({ x: Math.round(r.x + r.w * 0.3), y: Math.round(r.y + dy) });
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ── fixture ─────────────────────────────────────────────────────────────────────────────────── */
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
    if (Date.now() > deadline) throw new Error(`dblPlace: no box holding "${text}" after a real double-click`);
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
    PAGE_ID = createdRowId.replace(/^notes-row-/, "");
    for (const [x, y, t] of [[40, 20, "one"], [40, 90, "two"], [300, 20, "three"]]) {
      await dblPlace(x, y, t);
      await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    }
    await pacedWait(page, 900);
    return;
  }
  await page.goto(`${BASE}/#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([treeKey, prefix]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "Edge page", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    const P = (t) => (t ? { type: "paragraph", content: [{ type: "text", text: t }] } : { type: "paragraph" });
    const box = (x, y, t) => ({ type: "noteAnchor", attrs: { x, y, w: 160 }, content: [P(t)] });
    const pic = { type: "noteAnchor", attrs: { x: 420, y: 170, w: 200, h: 120 }, content: [{ type: "noteImage", attrs: { imageId: "edge-fixture-missing", alt: "", mime: "image/png" } }] };
    localStorage.setItem(prefix + "p1", JSON.stringify({ type: "doc", content: [box(40, 20, "one"), box(40, 90, "two"), box(300, 20, "three"), pic, P("")] }));
  }, [TREE_KEY, PAGE_PREFIX]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-anchor"]', { timeout: 30000 });
  await pacedWait(page, 1200);
}
/** Every section starts on a fresh, un-selected, un-panned page (trap 11: a harness that keeps pressing a box ends up inside it). */
async function fresh() {
  if (SIGNED_IN) { await page.reload({ waitUntil: "load" }); await page.waitForSelector('[data-testid="note-anchor"]', { timeout: 30000 }); await pacedWait(page, 1200); }
  else await openFixture();
  await page.waitForSelector('[data-testid="note-mat"]', { timeout: 30000 });
  await page.evaluate(() => { document.activeElement?.blur?.(); });
  await page.mouse.move(2, 2);
  await pacedWait(page, 200);
  const n = await page.evaluate(() => document.querySelectorAll('[data-testid="note-anchor"]').length);
  if (n < 3) void_(`fixture holds ${n} boxes, need 3`);
}

async function removeFixture() {
  if (!SIGNED_IN || !createdRowId) return;
  let step = "start";
  try {
    const binIds = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="notes-bin-tr_"]')].map((e) => e.getAttribute("data-testid")).filter((x) => !/preview|peek|restore|purge|project|viewing/.test(x)));
    await page.evaluate(() => { document.activeElement?.blur?.(); });
    step = "right-click the page row";
    await page.locator(`[data-testid="${createdRowId}"]`).click({ button: "right", timeout: 8000 });
    await pacedWait(page, 300);
    step = "choose Delete";
    await page.getByRole("menuitem", { name: /Delete/ }).first().click({ timeout: 8000 });
    await pacedWait(page, 400);
    await page.getByText("✓").first().click({ timeout: 4000 }).catch(() => {});
    await pacedWait(page, 900);
    step = "open the Bin";
    await page.locator('[data-testid="notes-view-bin"]').click({ timeout: 8000 });
    await pacedWait(page, 1000);
    const texts = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-testid^="notes-bin-tr_"]')].map((e) => [e.getAttribute("data-testid"), e.innerText])));
    const fresh_ = (await binIds()).filter((x) => /\b30 days left/.test(texts[x] || ""));
    if (fresh_.length !== 1) { check("cleanup: the throwaway page is binned AND purged", `${fresh_.length} new Bin entries (expected 1) — purge by hand: ${createdRowId}`, "purged"); return; }
    step = "purge from the Bin";
    await page.locator(`[data-testid="notes-bin-purge-${fresh_[0].replace("notes-bin-", "")}"]`).click({ timeout: 8000 });
    await pacedWait(page, 500);
    await page.getByText("✓").first().click({ timeout: 3000 }).catch(() => {});
    await pacedWait(page, 900);
    const left = await binIds();
    check("cleanup: the throwaway page is binned AND purged", left.includes(fresh_[0]) ? `${fresh_[0]} still in the Bin` : "purged", "purged");
  } catch (e) { check("cleanup: the throwaway page is binned AND purged", `failed — ${createdRowId} left on the account`, "purged"); note("cleanup", `FAILED at "${step}" — ${String(e).slice(0, 140)}`); }
}

try {
  await openFixture();
  await page.waitForSelector('[data-testid="note-mat"]', { timeout: 30000 });
  await assertMeasurable(page, "verify-notes-box-edge");
  if (!build) build = await page.evaluate(() => fetch("/version.json").then((r) => r.json()).catch(() => null));

  /* ── 1 + 2 + 3. THE RING, THE RETIRED GRIP, THE HOVER ───────────────────────────────────── */
  await fresh();
  const gripCount = await page.evaluate(() => document.querySelectorAll(".planyr-anchor-grip, [data-testid='note-anchor-grip']").length);
  check("2. the striped grip is gone (no .planyr-anchor-grip / note-anchor-grip)", gripCount, 0);
  const r0 = await boxRect(0);
  const probes = {
    "outside top (-3)": [topBand(r0, -3), "edge"],
    "ON the top line": [topBand(r0, 0.5), "edge"],
    "inside top (+2)": [topBand(r0, 2), "edge"],
    "well outside top (-12)": [topBand(r0, -12), "other"],
    "well inside top (+8)": [topBand(r0, 8), "box"],
    "outside left (-3)": [{ x: Math.round(r0.x - 3), y: Math.round(r0.cy) }, "edge"],
    "ON the left line": [{ x: Math.round(r0.x + 0.5), y: Math.round(r0.cy) }, "edge"],
    "inside left (+2)": [{ x: Math.round(r0.x + 2), y: Math.round(r0.cy) }, "edge"],
    "outside right (+3)": [{ x: Math.round(r0.right + 3), y: Math.round(r0.cy) }, "edge"],
    "ON the right line": [{ x: Math.round(r0.right - 0.5), y: Math.round(r0.cy) }, "edge"],
    "outside bottom (+3)": [{ x: Math.round(r0.x + r0.w * 0.3), y: Math.round(r0.bottom + 3) }, "edge"],
    "ON the bottom line": [{ x: Math.round(r0.x + r0.w * 0.3), y: Math.round(r0.bottom - 0.5) }, "edge"],
    "the MIDDLE of the box": [{ x: Math.round(r0.cx), y: Math.round(r0.cy) }, "box"],
  };
  for (const [name, [pt, want]] of Object.entries(probes)) {
    const got = await probe(pt.x, pt.y);
    check(`1. ring — ${name} resolves to ${want === "edge" ? "the move band" : want}`, got.kind, want);
    if (want === "edge") check(`1. ring — ${name}: cursor`, got.cursor, "move");
  }
  const hotStyle = () => page.evaluate(() => { const b = document.querySelector('[data-testid="note-anchor"]'); const cs = getComputedStyle(b); return { shadow: cs.boxShadow, border: cs.borderTopColor }; });
  const tp = topBand(r0, 0.5);
  await move(r0.cx, r0.cy);
  const idle = await hotStyle();
  await move(tp.x, tp.y);
  const hot = await hotStyle();
  check("3. hover: off the band the box has no extra outline (box-shadow none)", idle.shadow, "none");
  check("3. hover: over the band the outline thickens (inset shadow) in the accent colour", hot.shadow !== "none" && hot.shadow.includes(hot.border), true);
  await move(r0.cx, r0.cy);
  check("3. hover: back off the band the outline is clean again", (await hotStyle()).shadow, "none");

  /* ── 4. A DRAG FROM THE BAND MOVES THE BOX; A CLICK ON IT SELECTS ─────────────────────────── */
  await fresh();
  const scale = await scaleNow();
  const startOne = await boxStored("one");
  if (!startOne) void_(`box "one" is not in storage (${JSON.stringify(await stored())})`);
  let r = await boxRect(0);
  const b = topBand(r, 0.5);
  const tb = await rect('[data-testid="note-toolbar"]');
  await move(b.x, b.y);
  await page.mouse.down();
  await move(b.x + 70, b.y + 40, 8);
  const farCursor = tb ? await (async () => { await move(tb.cx, tb.cy, 6); return cursorAt(tb.cx, tb.cy); })() : "move";
  await move(b.x + 70, b.y + 40, 6);
  await page.mouse.up();
  const movedOne = await storedUntil("one", (x) => x.x !== startOne.x || x.y !== startOne.y);
  check("4. drag from the top band: stored X moves by the pointer's travel", near(movedOne.x - startOne.x, 70 / scale, 3), true);
  check("4. drag from the top band: stored Y moves by the pointer's travel", near(movedOne.y - startOne.y, 40 / scale, 3), true);
  check("4. the cursor is move for the whole drag (read far off the box, over the toolbar)", farCursor, "move");
  const sOne = await stateOf(0);
  check("4. after a border drag the box is selected and not editing", sOne && sOne.selected && !sOne.editing, true);

  await fresh();
  r = await boxRect(1);
  const c2 = topBand(r, 0.5);
  const startTwo = await boxStored("two");
  await page.mouse.click(c2.x, c2.y);
  await pacedWait(page, 400);
  const sTwo = await stateOf(1);
  check("4. a plain CLICK on the border selects the box", sTwo?.selected, true);
  check("4. …and does not enter it (no caret on the outline)", sTwo?.editing, false);
  await pacedWait(page, 900);
  const afterClick = await boxStored("two");
  check("4. …and moves nothing (stored position unchanged)", afterClick.x === startTwo.x && afterClick.y === startTwo.y, true);

  /* ── 5. A DRAG FROM THE MIDDLE STILL PANS (known-good arm: pre-existing behaviour) ────────── */
  await fresh();
  const startThree = await boxStored("three");
  const bp = await bodyPoint(2);
  const before = await boxRect(2);
  await move(bp.x, bp.y);
  await page.mouse.down();
  await move(bp.x - 70, bp.y + 50, 8);
  await page.mouse.up();
  await pacedWait(page, 900);
  const afterPan = await boxRect(2);
  const panned = Math.abs(afterPan.x - before.x) + Math.abs(afterPan.y - before.y);
  if (panned < 40) void_(`KNOWN-GOOD ARM: a drag from the middle of an unselected box did not pan the page (moved ${panned.toFixed(1)}) — the instrument is not measuring a pan`);
  const stillThree = await boxStored("three");
  check("5. a drag from the MIDDLE of a box pans the page (the box moved on screen, by the pan)", panned >= 40, true);
  check("5. …and does NOT move the box (stored position unchanged)", stillThree.x === startThree.x && stillThree.y === startThree.y, true);

  /* ── 6. RESIZE HANDLES KEEP PRIORITY AT THEIR SPOTS; THE REST OF THE EDGE MOVES ───────────── */
  await fresh();
  r = await boxRect(0);
  const sel = topBand(r, 0.5);
  await page.mouse.click(sel.x, sel.y);          // select BY ITS BORDER (also covers the click-selects path)
  await pacedWait(page, 400);
  const hE = await rect('.planyr-anchor[data-selected="1"] .planyr-anchor-h-e');
  if (!hE) void_("the selected box has no east handle — a border click did not select it");
  const atHandle = await probe(hE.cx, hE.cy);
  if (atHandle.kind !== "handle") void_(`KNOWN-GOOD ARM: a selected box's east handle does not resolve to the handle (${JSON.stringify(atHandle)})`);
  check("6. the east handle's centre resolves to the HANDLE, not the band", atHandle.kind === "handle" && atHandle.name === "e", true);
  check("6. …with its directional resize cursor", atHandle.cursor, "ew-resize");
  const awayFromHandle = await probe(Math.round(r.right - 0.5), Math.round(r.y + 3));
  check("6. the same edge, away from the handle, is the move band", awayFromHandle.kind, "edge");
  const startW = await boxStored("one");
  await move(hE.cx, hE.cy);
  await page.mouse.down();
  await move(hE.cx + 50, hE.cy, 6);
  await page.mouse.up();
  const resized = await storedUntil("one", (x) => x.w !== startW.w);
  check("6. dragging the handle RESIZES (stored width grows by the travel)", near(resized.w - startW.w, 50 / scale, 3), true);
  check("6. …and does not move the box", resized.x === startW.x && resized.y === startW.y, true);

  /* ── 7. A BOX WITH THE CARET IS STILL MOVABLE BY ITS EDGE, AND KEEPS THE CARET ─────────────── */
  await fresh();
  await enterBox(1);
  const e1 = await stateOf(1);
  if (!e1?.editing) void_(`box 1 is not editing after two presses (${JSON.stringify(e1)})`);
  const startEd = await boxStored("two");
  r = await boxRect(1);
  const eb = topBand(r, 0.5);
  await move(eb.x, eb.y);
  await page.mouse.down();
  await move(eb.x + 60, eb.y + 30, 8);
  await page.mouse.up();
  const movedEd = await storedUntil("two", (x) => x.x !== startEd.x || x.y !== startEd.y);
  check("7. a box with the CARET moves when dragged by its edge", near(movedEd.x - startEd.x, 60 / scale, 3) && near(movedEd.y - startEd.y, 30 / scale, 3), true);
  const afterEd = await stateOf(1);
  check("7. …and is still being edited, caret inside", afterEd?.editing && afterEd?.caretInside, true);

  /* ── 8. TWO SELECTED BOXES MOVE TOGETHER BY ONE DELTA ─────────────────────────────────────── */
  await fresh();
  const s1 = await boxStored("one"), s3 = await boxStored("three");
  await clickBody(0);
  const p3 = await bodyPoint(2);
  await page.keyboard.down("Shift");
  await page.mouse.click(p3.x, p3.y);
  await page.keyboard.up("Shift");
  await pacedWait(page, 300);
  const nSel = await page.evaluate(() => document.querySelectorAll('[data-testid="note-anchor"][data-selected="1"]').length);
  if (nSel < 2) void_(`Shift+click did not build a two-box selection (${nSel})`);
  r = await boxRect(0);
  const gb = topBand(r, 0.5);
  await move(gb.x, gb.y);
  await page.mouse.down();
  await move(gb.x + 60, gb.y + 20, 8);
  await page.mouse.up();
  const g1 = await storedUntil("one", (x) => x.x !== s1.x || x.y !== s1.y);
  const g3 = await storedUntil("three", (x) => x.x !== s3.x || x.y !== s3.y);
  check("8. grabbing one of two selected boxes by its edge moves BOTH", near(g1.x - s1.x, 60 / scale, 3) && near(g3.x - s3.x, 60 / scale, 3) && near(g1.y - s1.y, 20 / scale, 3) && near(g3.y - s3.y, 20 / scale, 3), true);

  /* ── 9. A PICTURE BOX HAS THE SAME BORDER HANDLE (local fixture only) ──────────────────────── */
  if (!SIGNED_IN) {
    await fresh();
    const idx = await page.evaluate(() => [...document.querySelectorAll('[data-testid="note-anchor"]')].findIndex((e) => e.getAttribute("data-anchor-kind") === "image"));
    if (idx < 0) void_("the picture box did not render as an image box");
    const sides = await page.evaluate((i) => document.querySelectorAll('[data-testid="note-anchor"]')[i].querySelectorAll(".planyr-anchor-edge").length, idx);
    check("9. a picture box carries the four border strips", sides, 4);
    const pr = await boxRect(idx);
    const pStart = await boxStored("#img");
    const pb = topBand(pr, 0.5);
    check("9. a picture box's top border resolves to the move band", (await probe(pb.x, pb.y)).kind, "edge");
    await move(pb.x, pb.y);
    await page.mouse.down();
    await move(pb.x - 40, pb.y + 30, 8);
    await page.mouse.up();
    const pMoved = await storedUntil("#img", (x) => x.x !== pStart.x || x.y !== pStart.y);
    check("9. dragging a picture box by its border moves it", near(pMoved.x - pStart.x, -40 / scale, 3) && near(pMoved.y - pStart.y, 30 / scale, 3), true);
    check("9. …and its size is untouched", pMoved.w === pStart.w && pMoved.h === pStart.h, true);
  } else note("9. picture box", "NOT EXERCISED HERE (signed-in mode builds text boxes only) — covered by the local run");

  check("no page errors", pageErrors.length ? pageErrors.join(" | ") : "none", "none");
} finally {
  await removeFixture();
  const fails = results.filter((x) => !x.ok);
  console.log(`\n${results.length - fails.length}/${results.length} passed${build ? `  ·  build ${JSON.stringify(build)}` : ""}  ·  ${BASE}`);
  await close();
  if (fails.length) { console.log("FAILED:\n" + fails.map((f) => ` - ${f.name} → ${JSON.stringify(f.got)}`).join("\n")); process.exitCode = 1; }
}
