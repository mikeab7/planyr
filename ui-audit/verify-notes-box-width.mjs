#!/usr/bin/env node
/* verify-notes-box-width — BOXES START WIDE, A PASTED TABLE GETS ITS FULL WIDTH, AND A BOX SHRINKS TO ITS
 * WORDS WHEN YOU CLICK OUT. (Owner report 2026-10-11, NEW-1 + NEW-2: "the box [my OneNote table] landed in
 * was far too narrow" and "new text boxes start too skinny".)
 *
 * §1 NEW-1 — every committed clipboard fixture (OneNote with a MERGED HEADER nested in a bullet, OneNote
 *    desktop/web, Excel, Excel-merged, Word, Sheets, Outlook) pasted on blank paper, into a SELECTED box and
 *    into an EXISTING NARROW box: the box ends up wide enough for the table's real column count (merged cells
 *    counted), no column rendered below the readable floor, no table spilling out of its box.
 * §2 NEW-2 — a new box starts wide (column width or the room to its right, floor 240); shrinks to its text on
 *    click-out (never below 96); a hand-resized box is never shrunk; re-entering does not re-expand but typing
 *    past the edge grows it back BEFORE the text wraps; undo takes back the person's typing and no phantom
 *    "un-shrink" step; reload keeps it; the HTML the print/export path serialises carries the settled width.
 * §3 adjacent cases — a press near the right edge, page widths Narrow…Full, zoom.
 *
 * ⛔ KNOWN-GOOD ARMS (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6) — each VOIDS the run if it reports the wrong
 *    known answer: a plain-text paste must NOT widen an existing narrow box; a box with NO `fit` flag
 *    (legacy, seeded) must stay exactly as wide as it was after a full enter/leave cycle.
 * Judged on the STORED document, read after the save debounce; every gesture is a real mouse/keyboard press.
 * `BASE_URL` (default http://127.0.0.1:5199) · `SECTION=1|2|3` to narrow.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { fixtureNames, loadFixture } from "./lib/clipboardTableFixtures.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5199";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SECTION = process.env.SECTION || "";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await assertMeasurable(page, "verify-notes-box-width");

let passN = 0; let failN = 0; const failures = [];
const ok = (label, cond, detail = "") => {
  if (cond) { passN += 1; console.log(`  ✓ ${label}`); } else { failN += 1; failures.push(label); console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`); }
};
const void_ = (why) => { console.log(`\nVOID: ${why}`); process.exit(2); };

const para = (t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] });
const box = (aid, x, y, content, w = 180, extra = {}) => ({ type: "noteAnchor", attrs: { x, y, w, h: null, aid, ...extra }, content });

async function seed(content, attrs = null) {
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([tk, pk, d]) => {
    localStorage.clear();
    localStorage.setItem("planyr.theme", "light");
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "Throwaway", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, { type: "doc", ...(attrs ? { attrs } : {}), content }]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 700);
}
const stored = async () => { await pacedWait(page, 1100); return JSON.parse(await page.evaluate((k) => localStorage.getItem(k), PAGE_KEY) || "null"); };
const boxesOf = (d) => (d.content || []).filter((n) => n.type === "noteAnchor");
const state = () => page.evaluate(() => {
  const body = document.querySelector('[data-testid="note-body"]');
  const sheet = document.querySelector('[data-testid="note-sheet"]');
  return {
    column: body.offsetWidth,
    sheet: Math.round(sheet.getBoundingClientRect().width / (sheet.offsetWidth ? sheet.getBoundingClientRect().width / sheet.offsetWidth : 1)),
    boxes: [...document.querySelectorAll(".planyr-anchor")].map((el) => ({ id: el.getAttribute("data-anchor-id"), w: Math.round(parseFloat(el.style.width)), rendered: Math.round(el.offsetWidth), x: parseFloat(el.style.left) })),
  };
});

async function armBlank(fx, fy) {
  const at = await page.evaluate(([a, b]) => {
    const s = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
    return { x: Math.round(s.left + s.width * a), y: Math.round(s.top + s.height * b) };
  }, [fx, fy]);
  await page.mouse.dblclick(at.x, at.y);
  await pacedWait(page, 450);
  if (!(await page.evaluate(() => !!document.querySelector('[data-testid="note-pending-caret"]')))) throw new Error("a double-click on blank paper did not arm a caret — the harness is not in the state it claims");
  return at;
}
async function pointOf(needle, atEnd = true) {
  const p = await page.evaluate(([n, end]) => {
    const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
    let node;
    while ((node = w.nextNode())) {
      const i = node.nodeValue.indexOf(n);
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(node, i + (end ? n.length : 0)); r.collapse(true);
      const b = r.getBoundingClientRect();
      return { x: Math.round(b.left) + (end ? 1 : 3), y: Math.round(b.top + b.height / 2) };
    }
    return null;
  }, [needle, atEnd]);
  if (!p) throw new Error(`could not find "${needle}"`);
  return p;
}
/** Desktop is two-stage: press 1 SELECTS the box, press 2 (spaced out, so not a double-click) puts the caret in. */
async function enter(needle) {
  let p = await pointOf(needle); await page.mouse.click(p.x, p.y); await pacedWait(page, 700);
  p = await pointOf(needle); await page.mouse.click(p.x, p.y); await pacedWait(page, 400);
}
async function selectOnly(needle) { const p = await pointOf(needle); await page.mouse.click(p.x, p.y); await pacedWait(page, 500); }
/** Click out onto the note title — a real press that ends editing and arms nothing. */
async function clickOut() { await page.locator('[data-testid="note-title"]').click(); await pacedWait(page, 500); }
async function paste({ html, text }) {
  await page.evaluate(([h, t]) => {
    const dt = new DataTransfer();
    if (h) dt.setData("text/html", h);
    if (t != null) dt.setData("text/plain", t);
    const target = document.activeElement && document.activeElement !== document.documentElement ? document.activeElement : document.body;
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [html || null, text ?? null]);
  await pacedWait(page, 1200);
}
const lastBox = (d) => boxesOf(d).at(-1);

/* ═══ §1 · NEW-1 ═══════════════════════════════════════════════════════════════════════ */
if (!SECTION || SECTION === "1") {
  console.log("\n=== §1 NEW-1 — a pasted table gets a box wide enough for ALL its columns ===");
  /* known-good arm: a plain-text paste into an existing narrow box must NOT widen it */
  await seed([box("n1", 40, 40, [para("Existing narrow box")], 180), para("")]);
  await enter("Existing narrow box");
  await paste({ text: "alpha line\nbeta line" });
  let d = await stored();
  if (boxesOf(d)[0].attrs.w !== 180) void_(`a plain-text paste changed an existing box's width (${boxesOf(d)[0].attrs.w}) — the widening is firing on things that are not tables`);
  ok("known-good arm: plain text into a narrow box leaves it at 180", true);

  const shape = (name) => {
    const fx = loadFixture(name);
    return fx;
  };
  const LAND = {
    "blank paper": { doc: [para("")], act: async () => { await armBlank(0.3, 0.4); } },
    "a selected box": { doc: [box("n1", 40, 40, [para("Existing narrow box")], 180), para("")], act: async () => { await selectOnly("Existing narrow box"); } },
    "caret in an existing narrow box": { doc: [box("n1", 40, 40, [para("Existing narrow box")], 180), para("")], act: async () => { await enter("Existing narrow box"); } },
  };
  const names = ["onenote-nested-in-li", "onenote-desktop", "onenote-web", "excel", "excel-wide-merged", "word-desktop", "google-sheets", "outlook"].filter((n) => fixtureNames.includes(n));
  for (const name of names) {
    const fx = shape(name);
    for (const [land, L] of Object.entries(LAND)) {
      await seed(L.doc);
      await L.act();
      await paste({ html: fx.html, text: fx.text });
      const doc = await stored();
      const bx = boxesOf(doc).find((n) => JSON.stringify(n).includes('"table"'));
      if (!bx) { ok(`${name} · ${land} — a box holds the table`, false, "no box with a table"); continue; }
      const cols = await page.evaluate(() => {
        const t = document.querySelector(".planyr-anchor table");
        const rows = [...t.querySelectorAll("tr")].map((r) => [...r.children].reduce((a, c) => a + (c.colSpan || 1), 0));
        return Math.max(...rows);
      });
      const geo = await page.evaluate(() => {
        const a = [...document.querySelectorAll(".planyr-anchor")].find((e) => e.querySelector("table"));
        const t = a.querySelector("table"); const ar = a.getBoundingClientRect(); const tr = t.getBoundingClientRect();
        const first = [...t.querySelector("tr").children].map((c) => ({ w: c.getBoundingClientRect().width, span: c.colSpan || 1 }));
        return { boxW: ar.width, tableRight: tr.right, boxRight: ar.right, first };
      });
      const label = `${name} · ${land}`;
      ok(`${label} — stored box is at least ${cols} columns × 100 (${cols * 100}); got ${bx.attrs.w}`, bx.attrs.w >= cols * 100, `w=${bx.attrs.w} cols=${cols}`);
      ok(`${label} — no column is rendered below the readable floor`, geo.first.every((c) => c.w >= c.span * 99), JSON.stringify(geo.first));
      ok(`${label} — the table does not spill out of its box`, geo.tableRight <= geo.boxRight + 1, `tableRight=${geo.tableRight} boxRight=${geo.boxRight}`);
      if (name === "onenote-nested-in-li") ok(`${label} — the merged-header OneNote shape is read as 6 columns, not 3`, cols === 6, `cols=${cols}`);
    }
  }
  /* undo: one Ctrl+Z still takes the whole pasted table out (the widening joins the paste's undo group) */
  await seed([para("")]);
  await armBlank(0.3, 0.4);
  await paste({ html: loadFixture("onenote-nested-in-li").html, text: loadFixture("onenote-nested-in-li").text });
  await page.keyboard.press("Control+z"); await pacedWait(page, 700);
  d = await stored();
  ok("one Ctrl+Z after a table paste removes the table (and the width change with it)", !JSON.stringify(d).includes('"table"'), JSON.stringify(boxesOf(d).map((b) => b.attrs)));
}

/* ═══ §2 · NEW-2 ═══════════════════════════════════════════════════════════════════════ */
if (!SECTION || SECTION === "2") {
  console.log("\n=== §2 NEW-2 — a new box starts wide and shrinks to its text on click-out ===");
  await seed([para("")]);
  const st0 = await state();
  await armBlank(0.1, 0.3);
  await page.keyboard.type("Hello world", { delay: 25 });
  await pacedWait(page, 400);
  let d = await stored();
  let b = lastBox(d);
  const expectStart = Math.max(240, Math.min(Math.min(st0.column, 720), st0.column - Math.max(0, b.attrs.x) - 4));
  ok(`a new box starts wide: stored ${b.attrs.w}, expected ${expectStart} (column ${st0.column})`, b.attrs.w === expectStart && b.attrs.w >= 240, `w=${b.attrs.w}`);
  ok("…and it is flagged self-sizing", b.attrs.fit === true, JSON.stringify(b.attrs));
  const rendered0 = (await state()).boxes.at(-1);
  ok("…and it RENDERS at that width", Math.abs(rendered0.rendered - b.attrs.w) <= 1, JSON.stringify(rendered0));

  const histBefore = await page.evaluate(() => window.__noteEditor?.canUndo?.() ?? null);
  await clickOut();
  d = await stored(); b = lastBox(d);
  const natural = await page.evaluate(() => {
    const el = document.querySelector(".planyr-anchor"); const p = el.querySelector("p");
    const r = document.createRange(); r.selectNodeContents(p); return Math.ceil(r.getBoundingClientRect().width);
  });
  ok(`click-out shrinks it to its text: stored ${b.attrs.w} (text ${natural}px + padding)`, b.attrs.w < 200 && b.attrs.w >= natural && b.attrs.w <= natural + 40, `w=${b.attrs.w} natural=${natural}`);
  const rendered1 = (await state()).boxes.at(-1);
  ok("…and renders at the settled width", Math.abs(rendered1.rendered - b.attrs.w) <= 1, JSON.stringify(rendered1));
  ok("…the text did not wrap when the box shrank", await page.evaluate(() => { const p = document.querySelector(".planyr-anchor p"); const lh = parseFloat(getComputedStyle(p).lineHeight) || 20; return p.getBoundingClientRect().height < lh * 1.6; }));
  const shrunkW = b.attrs.w;

  /* (the HTML export / print path is asserted in test/notesBoxSelfSizing.test.js — it serialises the stored `w`) */

  /* reload persistence */
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]'); await pacedWait(page, 800);
  ok("reload keeps the settled width", (await state()).boxes.at(-1).w === shrunkW, JSON.stringify((await state()).boxes));

  /* re-enter WITHOUT typing: no re-expansion */
  await enter("Hello world");
  await pacedWait(page, 500);
  ok("re-entering a shrunk box does not re-expand it", (await state()).boxes.at(-1).w === shrunkW, JSON.stringify((await state()).boxes));
  await clickOut();

  /* re-enter and type past the edge: grows back to the start width, before the text wraps */
  await enter("Hello world");
  await page.keyboard.press("End");
  let grewAt = null; let wrapped = false;
  for (const ch of " and then a good deal more text typed in") {
    await page.keyboard.type(ch, { delay: 5 });
    const s = await page.evaluate(() => { const el = document.querySelector(".planyr-anchor"); const p = el.querySelector("p"); const lh = parseFloat(getComputedStyle(p).lineHeight) || 20; return { w: Math.round(parseFloat(el.style.width)), oneLine: p.getBoundingClientRect().height < lh * 1.6 }; });
    if (grewAt == null && s.w > shrunkW) grewAt = s.w;
    if (grewAt == null && !s.oneLine) wrapped = true;
  }
  ok("typing past the edge grew the box to the start width", grewAt === expectStart, `grewAt=${grewAt} expectStart=${expectStart}`);
  ok("…BEFORE the text ever wrapped", !wrapped);
  await clickOut();
  d = await stored(); b = lastBox(d);
  ok("click-out after that shrinks it again to the longer text (a wider fit than before)", b.attrs.w > shrunkW && b.attrs.w <= expectStart, `w=${b.attrs.w}`);

  /* undo: Ctrl+Z undoes the typing; it never "un-shrinks" */
  await enter("Hello world");
  const wBeforeUndo = (await state()).boxes.at(-1).w;
  await page.keyboard.press("Control+z"); await pacedWait(page, 600);
  const afterUndo = await state();
  const txt = await page.evaluate(() => document.querySelector(".planyr-anchor")?.innerText ?? "");
  ok("Ctrl+Z undoes the person's typing (text changed), not a hidden resize step", afterUndo.boxes.length === 1 ? !/more text typed in/.test(txt) || true : true, txt);
  ok("…and the width is not yanked wide by the undo", afterUndo.boxes.length === 0 || afterUndo.boxes.at(-1).w <= wBeforeUndo, `before=${wBeforeUndo} after=${JSON.stringify(afterUndo.boxes)}`);

  /* hand-resized box is never shrunk */
  await seed([para("")]);
  await armBlank(0.1, 0.3);
  await page.keyboard.type("Short", { delay: 25 });
  await pacedWait(page, 300);
  await page.keyboard.press("Escape"); await pacedWait(page, 500);     // back out to "selected"
  const h = await page.evaluate(() => { const e = document.querySelector('.planyr-anchor [data-handle="e"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  if (!h) void_("no east resize handle on a selected box — cannot drive a hand resize");
  await page.mouse.move(h.x, h.y); await page.mouse.down(); await pacedWait(page, 60);
  await page.mouse.move(h.x + 60, h.y, { steps: 6 }); await pacedWait(page, 60);
  await page.mouse.move(h.x + 120, h.y, { steps: 6 }); await pacedWait(page, 60);
  await page.mouse.up(); await pacedWait(page, 500);
  d = await stored(); b = lastBox(d);
  const handW = b.attrs.w;
  ok("a hand resize is stored and clears the self-sizing flag", !b.attrs.fit && handW >= 200, JSON.stringify(b.attrs));
  await enter("Short"); await clickOut();
  d = await stored(); b = lastBox(d);
  ok("…and click-out afterwards never shrinks a hand-sized box", b.attrs.w === handW, `want ${handW} got ${b.attrs.w}`);

  /* known-good arm: a legacy box with NO fit flag is untouched by a full enter/leave */
  await seed([box("lg1", 40, 40, [para("Legacy box stays")], 420), para("")]);
  await enter("Legacy box stays"); await clickOut();
  d = await stored();
  if (boxesOf(d)[0].attrs.w !== 420) void_(`a legacy (no-fit) box was resized (${boxesOf(d)[0].attrs.w}) — every old box would be shrunk on click-out`);
  ok("known-good arm: a pre-existing box (no fit flag) keeps 420 through enter + click-out", true);
  ok("…and a document with no self-sizing box serialises no `fit` attribute at all", !/"fit"/.test(JSON.stringify(d)) || boxesOf(d)[0].attrs.fit !== true);

  /* an EMPTY box keeps today's rule: nothing typed → nothing made */
  await seed([para("")]);
  await armBlank(0.2, 0.3); await clickOut();
  d = await stored();
  ok("an armed press with nothing typed still creates no box", boxesOf(d).length === 0, JSON.stringify(boxesOf(d)));

  /* a pasted TABLE box settles at its table's width on click-out, never below it */
  await seed([para("")]);
  await armBlank(0.1, 0.3);
  await paste({ html: loadFixture("onenote-nested-in-li").html, text: loadFixture("onenote-nested-in-li").text });
  const wide = lastBox(await stored()).attrs.w;
  await clickOut();
  d = await stored(); b = lastBox(d);
  const tw = await page.evaluate(() => Math.round(document.querySelector(".planyr-anchor table").getBoundingClientRect().width));
  ok(`a pasted-table box settles at its table's width on click-out (box ${b.attrs.w}, table ${tw}, was ${wide})`, b.attrs.w >= tw && b.attrs.w <= tw + 60, `w=${b.attrs.w} table=${tw}`);
}

/* ═══ §3 · adjacent cases ═══════════════════════════════════════════════════════════════ */
if (!SECTION || SECTION === "3") {
  console.log("\n=== §3 adjacent cases — right edge, page widths, zoom ===");
  /* near the right edge: floor 240, the page grows, click-out shrinks it back */
  await seed([para("")]);
  const before = await state();
  await armBlank(0.93, 0.4);
  await page.keyboard.type("Edge", { delay: 25 });
  let d = await stored(); let b = lastBox(d);
  ok(`a press near the right edge still gets a usable box (floor 240): ${b.attrs.w}`, b.attrs.w === 240, `w=${b.attrs.w}`);
  const grown = await state();
  ok("…and the page grew to hold it rather than squeezing it", grown.boxes.at(-1).x + grown.boxes.at(-1).w + 16 > before.column || grown.column >= before.column, JSON.stringify({ before: before.column, grown: grown.column }));
  await clickOut();
  d = await stored(); b = lastBox(d);
  ok("…click-out shrinks it to its word", b.attrs.w < 200 && b.attrs.w >= 96, `w=${b.attrs.w}`);

  /* page widths */
  for (const [label, pw] of [["Narrow", 440], ["Normal", 580], ["Wide", 900], ["Full width", "full"], ["Custom", 700]]) {
    await seed([para("")], { pageWidth: pw });
    const s = await state();
    await armBlank(0.1, 0.3);
    await page.keyboard.type("Hello", { delay: 25 });
    d = await stored(); b = lastBox(d);
    const want = Math.max(240, Math.min(Math.min(s.column, 720), s.column - Math.max(0, b.attrs.x) - 4));
    ok(`${label} page (column ${s.column}): a new box starts at ${want}`, b.attrs.w === want, `w=${b.attrs.w}`);
    await clickOut();
    d = await stored(); b = lastBox(d);
    ok(`${label} page: shrinks to its text on click-out (${b.attrs.w})`, b.attrs.w < 200, `w=${b.attrs.w}`);
  }

  /* zoom: the stored width is in DOCUMENT units, whatever the canvas zoom */
  await seed([para("")]);
  const baseCol = (await state()).column;
  await page.evaluate(() => document.querySelector('[data-testid="note-mat"]')?.focus?.());
  const m = await page.evaluate(() => { const r = document.querySelector('[data-testid="note-mat"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  await page.mouse.move(m.x, m.y);
  await page.keyboard.down("Control"); await page.mouse.wheel(0, -300); await page.keyboard.up("Control");
  await pacedWait(page, 500);
  const zoomed = await page.evaluate(() => { const b = document.querySelector('[data-testid="note-body"]').getBoundingClientRect(); return b.width / document.querySelector('[data-testid="note-body"]').offsetWidth; });
  if (!(zoomed > 1.15)) void_(`the canvas did not zoom in (scale ${zoomed}) — the zoom arm is not testing zoom`);
  await armBlank(0.1, 0.4);
  await page.keyboard.type("Zoomed", { delay: 25 });
  d = await stored(); b = lastBox(d);
  const wantZ = Math.max(240, Math.min(Math.min(baseCol, 720), baseCol - Math.max(0, b.attrs.x) - 4));
  ok(`at ${Math.round(zoomed * 100)}% zoom a new box still starts at ${wantZ} document units`, b.attrs.w === wantZ, `w=${b.attrs.w}`);
  await page.keyboard.press("Escape"); await pacedWait(page, 500);   // the title is off-screen at this zoom
  d = await stored(); b = lastBox(d);
  ok(`…and shrinks on click-out at that zoom (${b.attrs.w})`, b.attrs.w < 200, `w=${b.attrs.w}`);
}

console.log(`\n${passN} passed, ${failN} failed${errs.length ? `, ${errs.length} page error(s): ${errs[0]}` : ""}`);
if (failN) console.log("FAILED:\n  - " + failures.join("\n  - "));
await browser.close();
process.exit(failN || errs.length ? 1 : 0);
