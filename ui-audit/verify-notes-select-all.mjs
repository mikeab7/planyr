#!/usr/bin/env node
/* verify-notes-select-all — NEW-1 (2026-11-15): CTRL+A BELONGS TO THE THING YOU ARE IN (PowerPoint).
 *
 * Owner: with the caret inside a box, Ctrl+A selects that box's text ONLY (Ctrl+C then copies TEXT: no box payload, no marching ants; typing replaces only that
 * box's text and one Ctrl+Z restores it). With no caret in any box — a box selected by its outline, or blank paper — Ctrl+A selects every BOX as boxes and Ctrl+C
 * copies them as boxes with the moving outline. In a table cell it steps outward (cell text → whole table → the box's text) and never escapes into another box.
 *
 * ⛔ WHAT MAKES IT AN INSTRUMENT: REAL mouse + REAL keys only; every box verdict is read from the STORED document (`__noteEditor.json()`); the system clipboard is
 * read back; arms carry independent expectations (the words come from the seed, not from the app) and the box-selected arm is judged against the in-box arm: the SAME
 * key must give a different, box-level result. Red-proof: run against a build without the feature (git stash src/). The in-box arms fail there (the whole page's
 * text is selected and copied).
 *
 * Local run: BASE_URL (default http://127.0.0.1:5199) · PW_CHROME · ONLY=id,id. Exit 0 = pass, 1 = a check failed, 2 = VOID. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5199";
const TREE_KEY = "planyr:notes:tree:v1:local"; const PAGE_KEY = (id) => `planyr:notes:page:v1:local:${id}`;
let pass = 0; let fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };
const voided = (why) => { console.log(`\nVOID: ${why}`); process.exitCode = 2; throw new Error("void"); };
const only = (process.env.ONLY || "").split(",").filter(Boolean);

const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await assertMeasurable(page, "verify-notes-select-all");
const settle = (ms) => page.waitForTimeout(ms);

const para = (t, marks) => ({ type: "paragraph", content: t ? [{ type: "text", text: t, ...(marks ? { marks } : {}) }] : [] });
const box = (aid, x, y, content, w = 400, extra = {}) => ({ type: "noteAnchor", attrs: { x, y, w, h: null, aid, fit: false, ...extra }, content });
const A_TEXT = "Alpha line one of the first box"; const B_TEXT = "Bravo text in the second box";
const DOC1 = () => ({ type: "doc", content: [box("a", 40, 100, [para("Heading-ish bold alpha", [{ type: "bold" }]), para(A_TEXT)], 400), box("b", 40, 300, [para(B_TEXT)], 360), para("")] });
const DOC2 = () => ({ type: "doc", content: [box("c", 60, 120, [para("Gamma on page two")], 300), para("")] });

async function seed(d1 = DOC1(), d2 = DOC2()) {
  /* Leave the previous app instance first: a hash-only navigation keeps it alive, and its pagehide flush would write its old document over the seed. */
  await page.goto("about:blank");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([tk, k1, k2, a, b]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [
      { id: "p1", title: "Throwaway one", createdAt: 1, updatedAt: 1, projectId: null, pages: [] },
      { id: "p2", title: "Throwaway two", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(k1, JSON.stringify(a)); localStorage.setItem(k2, JSON.stringify(b));
  }, [TREE_KEY, PAGE_KEY("p1"), PAGE_KEY("p2"), d1, d2]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await settle(1200);
}
const doc = () => page.evaluate(() => window.__noteEditor.json());
const boxesOf = (d) => (d.content || []).filter((n) => n.type === "noteAnchor");
const textOf = (n) => JSON.stringify(n.content);
const key = async (k) => { await page.keyboard.press(k); await settle(150); };
const pointIn = (needle) => page.evaluate((n) => {
  const t = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT); let node;
  while ((node = t.nextNode())) { const i = node.nodeValue.indexOf(n); if (i >= 0) { const r = document.createRange(); r.setStart(node, i); r.collapse(true); const b = r.getBoundingClientRect(); return { x: Math.round(b.left) + 2, y: Math.round(b.top + b.height / 2) }; } }
  return null; }, needle);
const click = async (n) => { const p = await pointIn(n); if (!p) throw new Error(`no "${n}" on the page`); await page.mouse.click(p.x, p.y); await settle(250); };
const enter = async (n) => { await click(n); await settle(700); await click(n); await settle(250); };
const rectOf = (aid) => page.evaluate((id) => { const e = document.querySelector(`.planyr-anchor[data-anchor-id="${id}"]`); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; }, aid);
/** Click a box's OUTLINE (its top border band, at 30 % — the north strip's own centre is a resize handle) so the box itself is selected. */
async function selectByOutline(aid) {
  const r = await rectOf(aid); if (!r) throw new Error(`no box ${aid}`);
  const at = { x: r.l + r.w * 0.3, y: r.t - 1 };
  await page.mouse.move(at.x, at.y, { steps: 3 }); await settle(120);
  const onBand = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest?.(".planyr-anchor-edge"), [at.x, at.y]);
  if (!onBand) voided(`the outline of box ${aid} is not under the pointer`);
  await page.mouse.click(at.x, at.y); await settle(300);
  const sel = await page.evaluate((id) => document.querySelector(`.planyr-anchor[data-anchor-id="${id}"]`)?.getAttribute("data-selected"), aid);
  if (sel !== "1") voided(`clicking the outline of ${aid} did not select the box`);
}
const ants = () => page.evaluate(() => [...document.querySelectorAll('.planyr-anchor[data-copied="1"]')].map((e) => e.getAttribute("data-anchor-id")));
const clip = () => page.evaluate(async () => { const out = {}; try { for (const it of await navigator.clipboard.read()) for (const t of it.types) out[t] = await (await it.getType(t)).text(); } catch (e) { out.err = String(e); } return out; });
const setClip = (k) => page.evaluate(async (c) => { await navigator.clipboard.write([new ClipboardItem(Object.fromEntries(Object.entries(c).filter(([t]) => t.startsWith("text/")).map(([t, v]) => [t, new Blob([v], { type: t })])))]); }, k);
const antsPlaying = () => page.evaluate(() => { const e = document.querySelector('.planyr-anchor[data-copied="1"]'); if (!e) return null; const cs = getComputedStyle(e, "::after"); return { name: cs.animationName, content: cs.content, bg: cs.backgroundImage.slice(0, 40) }; });
const noMarker = (c) => !/data-planyr-boxes|planyr-anchor|data-anchor-|noteAnchor/.test(c["text/html"] || "");
const chipVisible = () => page.locator('[data-testid="note-paste-options"]').first().isVisible().catch(() => false);


/* ───────────── fixtures ───────────── */
const cell = (t) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [para(t)] });
const row = (...ts) => ({ type: "tableRow", content: ts.map(cell) });
const C_INTRO = "Charlie intro words";
const DOC3 = () => ({ type: "doc", content: [
  box("a", 40, 100, [para("Heading-ish bold alpha", [{ type: "bold" }]), para(A_TEXT)], 400),
  box("b", 40, 300, [para(B_TEXT)], 360),
  box("c", 500, 100, [para(C_INTRO), { type: "table", content: [row("c11", "c12"), row("c21", "c22")] }], 340),
  para("")] });
const selectedIds = () => page.evaluate(() => [...document.querySelectorAll('.planyr-anchor[data-selected="1"]')].map((e) => e.getAttribute("data-anchor-id")).sort());
const selString = () => page.evaluate(() => String(window.getSelection() || ""));
const cellsLit = () => page.evaluate(() => document.querySelectorAll(".ProseMirror .selectedCell").length);
const wordsOf = (b) => JSON.stringify(b.content).match(/"text":"([^"]*)"/g)?.join("|") || "";
const payloadBoxes = (html) => { const m = /data-planyr-boxes="([^"]*)"/.exec(html || ""); if (!m) return null; try { return JSON.parse(decodeURIComponent(m[1])).boxes; } catch (_) { return null; } };
const allIds = ["a", "b", "c"];

const S = [];
const sc = (id, label, fn) => S.push({ id, label, fn });

/* ───────────── CARET IN A BOX ───────────── */
sc("in-box", "caret in box A: Ctrl+A selects only A's text; Ctrl+C copies TEXT (no box, no outline); typing replaces only A; ONE Ctrl+Z restores it", async () => {
  const before = boxesOf(await doc());
  await enter(A_TEXT); await key("Control+a");
  const s = await selString();
  ok("the selection holds A's words (both lines)", s.includes("Heading-ish bold alpha") && s.includes(A_TEXT), JSON.stringify(s));
  ok("…and nothing of B or C", !s.includes(B_TEXT) && !s.includes(C_INTRO) && !s.includes("c22"), JSON.stringify(s));
  ok("no box got selected as a box", (await selectedIds()).filter((i) => i !== "a").length === 0, JSON.stringify(await selectedIds()));
  await key("Control+c"); await settle(300);
  const c = await clip();
  ok("clipboard text is A's words only", /Alpha line one/.test(c["text/plain"] || "") && !(c["text/plain"] || "").includes(B_TEXT) && !(c["text/plain"] || "").includes(C_INTRO), JSON.stringify(c["text/plain"]));
  ok("the clipboard carries no box (no marker, frame or position)", noMarker(c), (c["text/html"] || "").slice(0, 200));
  ok("no marching ants", (await ants()).length === 0, JSON.stringify(await ants()));
  await page.keyboard.type("ZZ"); await settle(500);
  const d = boxesOf(await doc());
  const a = d.find((b) => b.attrs.aid === "a");
  ok("typing replaced A's text (and only the text)", wordsOf(a) === '"text":"ZZ"', wordsOf(a));
  ok("B and C are exactly as they were", ["b", "c"].every((i) => textOf(d.find((b) => b.attrs.aid === i)) === textOf(before.find((b) => b.attrs.aid === i))));
  ok("the box itself survived, in place", a.attrs.x === 40 && a.attrs.y === 100 && d.length === 3);
  await key("Control+z"); await settle(500);
  const u = boxesOf(await doc());
  ok("ONE Ctrl+Z restores A's words exactly", textOf(u.find((b) => b.attrs.aid === "a")) === textOf(before.find((b) => b.attrs.aid === "a")), wordsOf(u.find((b) => b.attrs.aid === "a")));
});
sc("in-box-b", "the same in a DIFFERENT box (B): scoped to B, never A", async () => {
  await enter(B_TEXT); await key("Control+a");
  const s = await selString();
  ok("the selection is exactly B's words", s.trim() === B_TEXT, JSON.stringify(s));
  await key("Control+a"); ok("a second Ctrl+A changes nothing (already all of this box)", (await selString()).trim() === B_TEXT);
  ok("still no box selected as a box", (await selectedIds()).filter((i) => i !== "b").length === 0);
});
sc("in-box-undo-chip", "Ctrl+A then Ctrl+C then paste elsewhere: text lands as text (no new box inside another)", async () => {
  await enter(A_TEXT); await key("Control+a"); await key("Control+c"); await settle(250);
  await key("Escape"); await key("Escape");
  const n = boxesOf(await doc()).length;
  await enter(B_TEXT); await key("End"); await key("Control+v"); await settle(900);
  const d = boxesOf(await doc());
  ok("no new box (text paste)", d.length === n, `${n} → ${d.length}`);
  ok("B holds A's words now, nothing nested", JSON.stringify(d.find((b) => b.attrs.aid === "b").content).includes("Alpha line one") && d.every((b) => !JSON.stringify(b.content).includes("noteAnchor")));
});

/* ───────────── NO CARET IN A BOX ───────────── */
sc("box-selected", "a box selected by its outline: Ctrl+A selects ALL boxes as boxes; Ctrl+C copies them as boxes with the moving outline", async () => {
  const before = await doc();
  await selectByOutline("b");
  ok("(arm) only B is selected before the key", JSON.stringify(await selectedIds()) === '["b"]', JSON.stringify(await selectedIds()));
  await key("Control+a");
  ok("every box is selected", JSON.stringify(await selectedIds()) === JSON.stringify(allIds), JSON.stringify(await selectedIds()));
  ok("the document did not change", JSON.stringify(await doc()) === JSON.stringify(before));
  await key("Control+c"); await settle(350);
  const c = await clip();
  const boxes = payloadBoxes(c["text/html"]);
  ok("the clipboard carries all three BOXES", !!boxes && boxes.length === 3 && allIds.every((i) => boxes.some((b) => b.attrs.aid === i)), String(boxes && boxes.length));
  ok("all three wear the moving outline", JSON.stringify((await ants()).sort()) === JSON.stringify(allIds), JSON.stringify(await ants()));
  const p = await antsPlaying(); ok("…and it really animates", !!p && p.name === "planyr-ants", JSON.stringify(p));
  const nBefore = boxesOf(await doc()).length;
  await page.mouse.dblclick(1000, 700); await settle(400);
  if (!(await page.locator('[data-testid="note-pending-caret"]').count())) voided("the double-click on blank paper armed no caret");
  await key("Control+v"); await settle(1100);
  ok("Ctrl+V made three NEW boxes", boxesOf(await doc()).length === nBefore + 3, `${nBefore} → ${boxesOf(await doc()).length}`);
  await key("Control+z"); await settle(500);
  ok("ONE Ctrl+Z removes all three", boxesOf(await doc()).length === nBefore, String(boxesOf(await doc()).length));
});
sc("box-selected-delete", "after Ctrl+A on a selected box, Delete removes every box in one step (and one Ctrl+Z brings them back)", async () => {
  await selectByOutline("a"); await key("Control+a"); await key("Delete"); await settle(400);
  ok("all boxes gone", boxesOf(await doc()).length === 0, String(boxesOf(await doc()).length));
  await key("Control+z"); await settle(500);
  ok("one Ctrl+Z restores all three", boxesOf(await doc()).length === 3, String(boxesOf(await doc()).length));
});
sc("blank-paper", "blank paper (caret armed there): Ctrl+A selects every box as boxes and makes no new box", async () => {
  const before = await doc();
  await page.mouse.dblclick(1000, 700); await settle(400);
  if (!(await page.locator('[data-testid="note-pending-caret"]').count())) voided("the double-click on blank paper armed no caret");
  await key("Control+a");
  ok("every box is selected", JSON.stringify(await selectedIds()) === JSON.stringify(allIds), JSON.stringify(await selectedIds()));
  ok("the armed caret is gone", (await page.locator('[data-testid="note-pending-caret"]').count()) === 0);
  ok("nothing was created", JSON.stringify(await doc()) === JSON.stringify(before));
  await key("Control+c"); await settle(300);
  ok("Ctrl+C copies the boxes", (payloadBoxes((await clip())["text/html"]) || []).length === 3);
});
sc("blank-click", "a plain click on blank paper, then Ctrl+A: every box selected", async () => {
  await page.mouse.click(1000, 700); await settle(400);
  await key("Control+a");
  ok("every box is selected", JSON.stringify(await selectedIds()) === JSON.stringify(allIds), JSON.stringify(await selectedIds()));
});

/* ───────────── TABLE CELL ───────────── */
sc("table", "caret in a table cell: cell text → whole table → the box's text → stays; never another box", async () => {
  await enter("c11");
  await key("Control+a");
  ok("1st press: the cell's own text", (await selString()).trim() === "c11" && (await cellsLit()) === 0, `${JSON.stringify(await selString())} lit=${await cellsLit()}`);
  await key("Control+a");
  ok("2nd press: the whole table (4 cells lit)", (await cellsLit()) === 4, `lit=${await cellsLit()}`);
  await key("Control+c"); await settle(250);
  let c = await clip();
  ok("…and a copy of it is the table's text, no other box", /c11/.test(c["text/plain"] || "") && /c22/.test(c["text/plain"] || "") && !(c["text/plain"] || "").includes(C_INTRO) && !(c["text/plain"] || "").includes(A_TEXT), JSON.stringify(c["text/plain"]));
  await key("Control+a");
  await key("Control+c"); await settle(250);
  c = await clip();
  const pt = c["text/plain"] || "";
  ok("3rd press: the whole box (intro line AND the table)", pt.includes(C_INTRO) && pt.includes("c22"), JSON.stringify(pt));
  ok("…and nothing of A or B", !pt.includes(A_TEXT) && !pt.includes(B_TEXT) && !pt.includes("alpha"), JSON.stringify(pt));
  ok("…as text: no box payload, no outline", noMarker(c) && (await ants()).length === 0);
  await key("Control+a"); await key("Control+c"); await settle(250);
  const pt2 = (await clip())["text/plain"] || "";
  ok("4th press: still just this box", pt2.includes(C_INTRO) && !pt2.includes(A_TEXT) && !pt2.includes(B_TEXT), JSON.stringify(pt2));
  ok("no other box was selected as a box", (await selectedIds()).filter((i) => i !== "c").length === 0, JSON.stringify(await selectedIds()));
});

/* ───────────── LEAVES THE REST ALONE ───────────── */
sc("title-field", "Ctrl+A in the page title field is the field's own (select its text), never boxes", async () => {
  const t = page.locator('[data-testid="note-title"]').first();
  await t.click(); await settle(200);
  await key("Control+a");
  const r = await page.evaluate(() => { const i = document.querySelector('[data-testid="note-title"]'); return { s: i.selectionStart, e: i.selectionEnd, n: i.value.length }; });
  ok("the title's text is selected", r.s === 0 && r.e === r.n && r.n > 0, JSON.stringify(r));
  ok("no box got selected", (await selectedIds()).length === 0, JSON.stringify(await selectedIds()));
});
sc("no-boxes", "a page with no box: Ctrl+A leaves it to the browser (no error, nothing selected as a box)", async () => {
  await seed({ type: "doc", content: [para("")] }, DOC2());
  await page.mouse.click(1000, 700); await settle(300);
  await key("Control+a");
  ok("no box selected, no box made", (await selectedIds()).length === 0 && boxesOf(await doc()).length === 0);
});

/* ── run ── */
try {
  for (const s of S) {
    if (only.length && !only.includes(s.id)) continue;
    console.log(`\n— ${s.label}`);
    try { await seed(DOC3()); await s.fn(); } catch (e) { if (/void/i.test(e.message)) throw e; fail++; console.log(`  ✗ scenario ran: ${String(e.message || e).slice(0, 260)}`); }
  }
  ok("page errors during the run", errs.length === 0, errs.slice(0, 3).join(" | "));
} catch (e) { if (e.message !== "void") { fail++; console.log("  ✗ run aborted:", String(e).slice(0, 300)); } }
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode || (fail ? 1 : 0));
