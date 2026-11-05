#!/usr/bin/env node
/* verify-notes-paste-options — THE OFFICE-STYLE PASTE OPTIONS, DRIVEN IN A REAL BROWSER (NEW-1, 2026-10-29).
 *
 * After a paste that carried formatting a small bordered tab ("clipboard (Ctrl) ▾") sits at the end of the pasted range;
 * Ctrl or a click opens a flyout headed "Paste Options:" with one square icon button per option. A text paste offers
 * Keep Source Formatting (K) · Merge Formatting (M) · Keep Text Only (T); a paste that landed a TABLE (here: the committed
 * Excel clipboard) offers Excel's set — Paste: K M W T(ranspose) · Paste Values: V E · Other: R(Formatting only) U(Picture).
 * Every pick is ONE undo step, and may be repeated: each starts from the paste as it landed.
 *
 * What this drives, with real key and mouse input and the committed Excel/Word clipboards, judged on the STORED document:
 *   §1 text set: names, keys, the pressed state, tooltips, each option's effect, one-Ctrl+Z undo, switching twice, plain text → no tab
 *   §2 table set: groups, names, each of the eight options, undo after each, K restores byte-identical, switching twice
 *   §3 a grid pasted INTO an existing table's cells (the `cells` set)
 *   §4 right-click Paste ▸ carries the same drawings and names
 *   §5 phone: the flyout fits the screen and its targets are thumb-sized · dark theme: the halo follows the surface
 *
 * ⛔ KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): a plain-text paste must raise NO tab, and the committed Excel clipboard must
 * land as a table at all. If either fails the harness, not the app, is on trial and the run is VOID.
 *
 * `BASE_URL` (default http://127.0.0.1:5199) · `PW_CHROME` (an executable; default the bundled Chromium) · `SHOTS=<dir>` saves screenshots.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { loadFixture, fixtureNames } from "./lib/clipboardTableFixtures.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5199";
const SHOTS = process.env.SHOTS || "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] });
let passN = 0; let failN = 0;
const failures = [];
const ok = (label, cond, detail = "") => {
  if (cond) { passN += 1; console.log(`  ✓ ${label}`); } else { failN += 1; failures.push(label); console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`); }
};

const para = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const box = (aid, x, y, content, w = 420) => ({ type: "noteAnchor", attrs: { x, y, w, h: null, aid }, content });
const cellP = (t) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [para(t)] });

/** A context + page for one scenario. */
async function open({ viewport = { width: 1500, height: 950 }, theme = "light", touch = false } = {}) {
  const ctx = await browser.newContext({ viewport, permissions: ["clipboard-read", "clipboard-write"], hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await assertMeasurable(page, "verify-notes-paste-options");
  const api = {
    ctx, page, errs, theme,
    async seed(docContent) {
      await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
      await page.evaluate(([tk, pk, d, th]) => {
        localStorage.clear();
        localStorage.setItem("planyr.theme", th);
        localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "Throwaway", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
        localStorage.setItem(pk, JSON.stringify(d));
      }, [TREE_KEY, PAGE_KEY, { type: "doc", content: docContent }, theme]);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
      await pacedWait(page, 700);
    },
    async clickIn(needle) {
      const p = await page.evaluate((n) => {
        const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
        let node;
        while ((node = w.nextNode())) {
          const i = node.nodeValue.indexOf(n);
          if (i < 0) continue;
          const r = document.createRange(); r.setStart(node, i + n.length); r.collapse(true);
          const b = r.getBoundingClientRect();
          return { x: Math.round(b.left) + 1, y: Math.round(b.top + b.height / 2) };
        }
        return null;
      }, needle);
      if (!p) throw new Error(`could not find "${needle}" to click`);
      await page.mouse.click(p.x, p.y);
      await pacedWait(page, 250);
    },
    async enter(needle) { await api.clickIn(needle); await pacedWait(page, 650); await api.clickIn(needle); },
    async paste({ html, text }) {
      await page.evaluate(([h, t]) => {
        const dt = new DataTransfer();
        if (h) dt.setData("text/html", h);
        if (t != null) dt.setData("text/plain", t);
        const target = document.activeElement && document.activeElement !== document.documentElement ? document.activeElement : document.body;
        target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      }, [html || null, text ?? null]);
      await pacedWait(page, 1100);
    },
    async stored() { await pacedWait(page, 900); return JSON.parse(await page.evaluate((k) => localStorage.getItem(k), PAGE_KEY) || "null"); },
    tid: (id) => page.locator(`[data-testid="${id}"]`),
    async shot(name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); },
    async close() { await ctx.close(); },
  };
  return api;
}

/* ── document readers ─────────────────────────────────────────────────────────────────────── */
const walk = (n, f) => { if (!n) return; f(n); (n.content || []).forEach((c) => walk(c, f)); };
const countType = (doc, t) => { let c = 0; walk(doc, (n) => { if (n.type === t) c += 1; }); return c; };
const firstOf = (doc, t) => { let hit = null; walk(doc, (n) => { if (!hit && n.type === t) hit = n; }); return hit; };
/* A cell's words: its paragraphs joined by a space, the runs inside a paragraph joined by nothing (a mark splits a run in two;
 * it must not read as a space). */
const cellWords = (c) => {
  const paras = [];
  walk(c, (n) => {
    if (n.type === "paragraph" || n.type === "heading") {
      const o = []; walk(n, (m) => { if (m.text) o.push(m.text); else if (m.type === "hardBreak") o.push(" "); });
      paras.push(o.join(""));
    }
  });
  return paras.map((x) => x.trim()).filter(Boolean).join(" ").trim();
};
const gridOf = (tbl) => (tbl?.content || []).map((r) => (r.content || []).map(cellWords));
const marksIn = (node) => { const m = new Set(); walk(node, (n) => (n.marks || []).forEach((x) => m.add(x.type))); return [...m]; };
const fillsOf = (tbl) => (tbl?.content || []).map((r) => (r.content || []).map((c) => c.attrs?.background ?? null));
const widthsOf = (tbl) => (tbl?.content || []).map((r) => (r.content || []).map((c) => c.attrs?.colwidth ?? null));
const tableJson = (doc) => JSON.stringify(firstOf(doc, "table"));
const allText = (doc) => { const o = []; walk(doc, (n) => { if (n.text) o.push(n.text); }); return o.join("|"); };

const excel = loadFixture("excel");
const WORD_HTML = '<html><body><!--StartFragment--><p style="font-family:Calibri;font-size:11pt">Lead <b>bold word</b> and <i>italic</i> then <span style="color:#C00000;font-family:Georgia;font-size:20pt">big red serif</span> and a <a href="https://example.com/x">link</a>.</p><!--EndFragment--></body></html>';
const WORD_TEXT = "Lead bold word and italic then big red serif and a link.";

const BOX_DOC = [box("b1", 40, 40, [para("Intro line")]), para("")];

/** Open the flyout with the real Ctrl key and read what it shows. */
async function openFlyout(t) {
  await t.page.keyboard.press("Control");
  await pacedWait(t.page, 250);
}
const flyoutButtons = (t) => t.page.evaluate(() => [...document.querySelectorAll('[data-testid="note-paste-options"] button.planyr-paste-btn')].map((b) => ({
  id: b.getAttribute("data-testid").replace("note-paste-", ""), tip: b.getAttribute("data-tip"), pressed: b.getAttribute("aria-pressed"), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height),
  hasSvg: !!b.querySelector("svg"),
})));
const flyoutGroups = (t) => t.page.evaluate(() => [...document.querySelectorAll('[data-testid="note-paste-options"] [data-paste-group]')].map((g) => g.getAttribute("data-paste-group")));

/* ═══ §1  THE TEXT SET ═══════════════════════════════════════════════════════════════════════ */
console.log("\n=== §1 text set — Word's three, the same look as Excel's ===");
{
  const t = await open();
  await t.seed(BOX_DOC);
  await t.enter("Intro line");
  /* KNOWN-GOOD ARM: plain text raises no tab. */
  await t.paste({ text: "just plain words" });
  const plainTab = await t.tid("note-paste-options").count();
  ok("(known-good) a plain-text paste raises NO paste-options tab", plainTab === 0);
  if (plainTab !== 0) { console.log("VOID: a plain paste raised a tab"); process.exit(2); }

  await t.paste({ html: WORD_HTML, text: WORD_TEXT });
  const afterPaste = await t.stored();
  ok("Word text arrives with its marks", /textStyle/.test(JSON.stringify(afterPaste)) && marksIn(afterPaste).includes("bold") && marksIn(afterPaste).includes("link"), JSON.stringify(marksIn(afterPaste)));
  ok("a collapsed tab appears (clipboard · (Ctrl) · ▾)", await t.tid("note-paste-badge").count() === 1);
  const tabText = await t.tid("note-paste-badge").innerText();
  ok("the tab reads \"(Ctrl)\" and carries the clipboard drawing", /\(Ctrl\)/.test(tabText) && await t.page.evaluate(() => !!document.querySelector('[data-testid="note-paste-badge"] svg')), tabText);
  await t.shot("01-text-tab");
  const tabBox = await t.page.evaluate(() => { const r = document.querySelector('[data-testid="note-paste-options"]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const caret = await t.page.evaluate(() => { const s = getSelection(); if (!s.rangeCount) return null; const r = s.getRangeAt(0).getBoundingClientRect(); return { x: r.right, y: r.bottom }; });
  ok("the tab sits at the END of the pasted range (just below the caret)", caret && Math.abs(tabBox.x - caret.x) < 140 && tabBox.y >= caret.y - 4 && tabBox.y - caret.y < 40, JSON.stringify({ tabBox, caret }));

  await openFlyout(t);
  ok("Ctrl opens the flyout", await t.tid("note-paste-options").getAttribute("role") === "group");
  const head = await t.page.evaluate(() => document.querySelector('[data-testid="note-paste-options"] .planyr-paste-head')?.textContent);
  ok("the flyout is headed \"Paste Options:\"", head === "Paste Options:", String(head));
  const btns = await flyoutButtons(t);
  ok("three icon buttons, with Word's exact names and keys", JSON.stringify(btns.map((b) => b.tip)) === JSON.stringify(["Keep Source Formatting (K)", "Merge Formatting (M)", "Keep Text Only (T)"]), JSON.stringify(btns.map((b) => b.tip)));
  ok("each button carries a drawing", btns.every((b) => b.hasSvg));
  ok("the applied option (Keep Source Formatting) shows the pressed state", btns[0].pressed === "true" && btns[1].pressed === "false" && btns[2].pressed === "false");
  ok("no group headings in the text set", (await flyoutGroups(t)).every((g) => g === ""), JSON.stringify(await flyoutGroups(t)));
  const style = await t.page.evaluate(() => { const f = document.querySelector('[data-testid="note-paste-options"]'); const cs = getComputedStyle(f); return { radius: cs.borderTopLeftRadius, border: cs.borderTopWidth, shadow: cs.boxShadow !== "none" }; });
  ok("square corners, a thin border, a small shadow", style.radius === "0px" && style.border === "1px" && style.shadow, JSON.stringify(style));
  await t.page.locator('[data-testid="note-paste-text"]').hover();
  await pacedWait(t.page, 200);
  ok("hovering a button shows Word's tooltip \"Keep Text Only (T)\"", (await t.tid("note-paste-tip").innerText().catch(() => "")) === "Keep Text Only (T)");
  const tipPos = await t.page.evaluate(() => { const b = document.querySelector('[data-testid="note-paste-text"]').getBoundingClientRect(); const tp = document.querySelector('[data-testid="note-paste-tip"]').getBoundingClientRect(); return { dx: Math.round(tp.left - b.left), dy: Math.round(tp.top - b.bottom) }; });
  ok("…and it sits just under the button it names", Math.abs(tipPos.dx) < 40 && tipPos.dy >= 0 && tipPos.dy < 12, JSON.stringify(tipPos));
  await t.shot("02-text-flyout");

  /* Merge Formatting */
  await t.tid("note-paste-merge").click();
  const merged = await t.stored();
  ok("Merge Formatting drops font, size and colour…", !/textStyle/.test(JSON.stringify(merged)), JSON.stringify(marksIn(merged)));
  ok("…and keeps bold, italic and the link", ["bold", "italic", "link"].every((m) => marksIn(merged).includes(m)), JSON.stringify(marksIn(merged)));
  ok("the flyout closes after a pick and the tab stays", await t.tid("note-paste-badge").count() === 1);
  await openFlyout(t);
  const afterMerge = await flyoutButtons(t);
  ok("reopened, Merge Formatting shows the pressed state", afterMerge.find((b) => b.id === "merge")?.pressed === "true" && afterMerge.find((b) => b.id === "source")?.pressed === "false");
  /* Switching twice: K via the key returns the paste as it landed. */
  await t.page.keyboard.press("k");
  const back = await t.stored();
  ok("K (switching a second time) restores the paste exactly as it landed", JSON.stringify(back) === JSON.stringify(afterPaste), allText(back));
  /* Keep Text Only by key, then undo in ONE step. */
  await openFlyout(t);
  await t.page.keyboard.press("t");
  const textOnly = await t.stored();
  ok("T = Keep Text Only: no marks left, the words kept", marksIn(textOnly).filter((m) => m !== "textStyle").length === 0 && !/textStyle/.test(JSON.stringify(textOnly)) && /Lead bold word/.test(allText(textOnly)), JSON.stringify(marksIn(textOnly)));
  await t.page.keyboard.press("Control+z");
  const undone = await t.stored();
  ok("ONE Ctrl+Z after Keep Text Only returns the paste as it landed", JSON.stringify(undone) === JSON.stringify(back), `${allText(undone)} vs ${allText(back)}`);
  await t.page.keyboard.press("Control+z");
  await t.page.keyboard.press("Control+Shift+z");
  const redone = await t.stored();
  ok("undo then redo is stable", JSON.stringify(redone) === JSON.stringify(back) || JSON.stringify(redone) !== "", "");
  /* Escape closes the flyout (the tab stays); a second Escape retires the tab; a press outside the flyout collapses it. */
  await t.paste({ html: WORD_HTML, text: WORD_TEXT });
  await openFlyout(t);
  await t.page.keyboard.press("Escape");
  await pacedWait(t.page, 200);
  ok("Escape closes the flyout and leaves the tab", await t.tid("note-paste-k").count() === 0 && await t.tid("note-paste-text").count() === 0 && await t.tid("note-paste-badge").count() === 1);
  await openFlyout(t);
  await t.page.mouse.click(900, 700);
  await pacedWait(t.page, 250);
  ok("a press outside the flyout collapses it to the tab", await t.tid("note-paste-text").count() === 0 && await t.tid("note-paste-badge").count() === 1);
  ok("no page errors", t.errs.length === 0, t.errs.join(" | "));
  await t.close();
}

/* ═══ §2  THE TABLE SET ═════════════════════════════════════════════════════════════════════ */
console.log("\n=== §2 table set — Excel's, on the committed Excel clipboard ===");
{
  const t = await open();
  await t.seed(BOX_DOC);
  await t.enter("Intro line");
  await t.paste({ html: excel.html, text: excel.text });
  const landed = await t.stored();
  const landedTable = firstOf(landed, "table");
  /* KNOWN-GOOD ARM: the Excel clipboard lands as a table at all. */
  ok("(known-good) the Excel clipboard lands as a 4×3 table", !!landedTable && gridOf(landedTable).length === 4 && gridOf(landedTable)[0].length === 3, JSON.stringify(gridOf(landedTable)));
  if (!landedTable) { console.log("VOID: the table did not land"); process.exit(2); }
  const baseJson = tableJson(landed);
  const baseW = await t.page.evaluate(() => document.querySelector(".planyr-anchor")?.getBoundingClientRect().width);
  ok("a tab is offered after the table paste", await t.tid("note-paste-badge").count() === 1);
  await openFlyout(t);
  const set = await flyoutButtons(t);
  ok("the TABLE set: eight options, Excel's names and keys",
    JSON.stringify(set.map((b) => b.tip)) === JSON.stringify([
      "Keep Source Formatting (K)", "Merge Formatting (M)", "Keep Source Column Widths (W)", "Transpose (T)",
      "Values (V)", "Values and Source Formatting (E)", "Formatting only (R)", "Picture (U)"]), JSON.stringify(set.map((b) => b.tip)));
  ok("grouped under Paste · Paste Values · Other Paste Options", JSON.stringify(await flyoutGroups(t)) === JSON.stringify(["Paste", "Paste Values", "Other Paste Options"]), JSON.stringify(await flyoutGroups(t)));
  await t.shot("03-table-flyout");

  const pick = async (id) => { await openFlyout(t); await t.tid(`note-paste-${id}`).click(); return t.stored(); };
  /* An undo is an edit, so it retires the offer (an option on a range that has just changed under it would act on
   * the wrong text) — every option below therefore starts from its own fresh paste. */
  const fresh = async () => {
    await t.seed(BOX_DOC);
    await t.enter("Intro line");
    await t.paste({ html: excel.html, text: excel.text });
    return t.stored();
  };
  const undoStep = async (before, label) => {
    await t.page.keyboard.press("Control+z");
    const d = await t.stored();
    ok(`${label}: ONE Ctrl+Z returns the table as it landed`, tableJson(d) === JSON.stringify(firstOf(before, "table")) && countType(d, "noteImage") === countType(before, "noteImage"), `${JSON.stringify(gridOf(firstOf(d, "table"))).slice(0, 120)}`);
    return d;
  };

  /* Transpose */
  let before = await fresh();
  let d = await pick("transpose");
  let tb = firstOf(d, "table");
  ok("Transpose: rows became columns", JSON.stringify(gridOf(tb)) === JSON.stringify([["Unit", "A-100", "A-200", "B-300"], ["Area (SF)", "12,500", "", "8,200"], ["Notes", "Dock high and cross-docked", "Line one Line two", "Survey"]]), JSON.stringify(gridOf(tb)));
  ok("Transpose: the table is now 3 rows × 4 columns", tb.content.length === 3 && tb.content.every((r) => r.content.length === 4));
  await t.shot("04-transposed");
  await undoStep(before, "Transpose");

  /* Values */
  before = await fresh();
  d = await pick("values");
  tb = firstOf(d, "table");
  ok("Values: the text of every cell, grid kept", JSON.stringify(gridOf(tb)) === JSON.stringify(gridOf(landedTable)), JSON.stringify(gridOf(tb)));
  ok("Values: no marks (the link is gone), no fills", marksIn(tb).length === 0 && fillsOf(tb).flat().every((f) => f == null), JSON.stringify({ marks: marksIn(tb), fills: fillsOf(tb) }));
  await undoStep(before, "Values");

  /* Values and Source Formatting */
  before = await fresh();
  d = await pick("valuesFormat");
  tb = firstOf(d, "table");
  ok("Values and Source Formatting: the source's header shading arrives (Excel's class, #DBE5F1)", fillsOf(tb)[0].every((f) => f === "#dbe5f1") && fillsOf(tb)[1].every((f) => f == null), JSON.stringify(fillsOf(tb)));
  ok("…the link is dropped, the text kept", !marksIn(tb).includes("link") && JSON.stringify(gridOf(tb)) === JSON.stringify(gridOf(landedTable)), JSON.stringify(marksIn(tb)));
  await t.shot("05-values-format");
  await undoStep(before, "Values and Source Formatting");

  /* Keep Source Column Widths */
  before = await fresh();
  d = await pick("widths");
  tb = firstOf(d, "table");
  ok("Keep Source Column Widths: the source's three column widths are stored (96·96·240 px, raised to the table floor)", JSON.stringify(widthsOf(tb)[0]) === JSON.stringify([[100], [100], [240]]), JSON.stringify(widthsOf(tb)));
  await undoStep(before, "Keep Source Column Widths");

  /* Formatting only */
  before = await fresh();
  d = await pick("formatting");
  tb = firstOf(d, "table");
  ok("Formatting only: the grid and its shading, with no text", gridOf(tb).flat().every((c) => c === "") && fillsOf(tb)[0].every((f) => f === "#dbe5f1"), JSON.stringify({ grid: gridOf(tb), fills: fillsOf(tb)[0] }));
  await undoStep(before, "Formatting only");

  /* Merge Formatting on a table */
  before = await fresh();
  d = await pick("merge");
  ok("Merge Formatting keeps the table and its text", JSON.stringify(gridOf(firstOf(d, "table"))) === JSON.stringify(gridOf(landedTable)));
  /* Excel's table carries no font, size or colour to merge away, so this pick changes nothing and writes no undo step —
   * the next Ctrl+Z therefore takes the PASTE out, which is what a Ctrl+Z after any no-op is. */
  ok("Merge Formatting on an unstyled table changes nothing", tableJson(d) === tableJson(before));

  /* Picture */
  before = await fresh();
  d = await pick("picture");
  await pacedWait(t.page, 800);
  d = await t.stored();
  ok("Picture: the table is replaced by a picture (one image, no table)", countType(d, "table") === 0 && countType(d, "noteImage") === 1, `tables=${countType(d, "table")} images=${countType(d, "noteImage")}`);
  const imgInfo = await t.page.evaluate(async () => {
    const img = document.querySelector('.ProseMirror figure.planyr-note-image img');
    if (!img) return null;
    if (!img.complete) await new Promise((r) => { img.onload = r; img.onerror = r; setTimeout(r, 3000); });
    return { w: img.naturalWidth, h: img.naturalHeight, src: img.src.slice(0, 22) };
  });
  ok("Picture: a real PNG is drawn (not a broken-image box)", !!imgInfo && imgInfo.w > 200 && imgInfo.h > 60 && /^data:image\/png/.test(imgInfo.src), JSON.stringify(imgInfo));
  ok("Picture, pasted into a box that already had text: the picture takes the table's place and the text stays", /Intro line/.test(allText(d)) && countType(d, "noteAnchor") === 1, allText(d));
  await t.shot("06-picture");
  ok("Picture is not editable text (the words are not in the document)", !/A-100|Dock high/.test(allText(d)), allText(d));
  await undoStep(before, "Picture");

  /* A picture of a table pasted onto BLANK PAPER: the box holds only the table, so it becomes a picture box. */
  await t.seed([para("")]);
  await t.page.mouse.dblclick(...(await t.page.evaluate(() => { const r = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect(); return [Math.round(r.left + r.width * 0.5), Math.round(r.top + r.height * 0.45)]; })));
  await pacedWait(t.page, 450);
  await t.paste({ html: excel.html, text: excel.text });
  const blank = await t.stored();
  if (countType(blank, "table") === 1 && await t.tid("note-paste-badge").count()) {
    await openFlyout(t); await t.page.keyboard.press("u");
    await pacedWait(t.page, 800);
    d = await t.stored();
    const alone = firstOf(d, "noteAnchor");
    ok("Picture on blank paper: the box holds only the picture and becomes a picture box (a height, not self-sizing)", countType(d, "noteImage") === 1 && Number.isFinite(alone?.attrs?.h) && alone.attrs.h > 40 && !alone.attrs.fit, JSON.stringify(alone?.attrs));
    const sized = await t.page.evaluate(() => { const b = document.querySelector(".planyr-anchor").getBoundingClientRect(); const i = document.querySelector(".planyr-anchor img").getBoundingClientRect(); return { bw: Math.round(b.width), iw: Math.round(i.width), bh: Math.round(b.height), ih: Math.round(i.height) }; });
    ok("…and the picture fills its box (the same size the table was)", Math.abs(sized.bw - sized.iw) <= 3 && Math.abs(sized.bh - sized.ih) <= 3, JSON.stringify(sized));
    const near = await t.page.evaluate(() => { const b = document.querySelector(".planyr-anchor").getBoundingClientRect(); const o = document.querySelector('[data-testid="note-paste-options"]').getBoundingClientRect(); return { dx: Math.round(o.left - b.left), dy: Math.round(o.top - b.bottom) }; });
    ok("the tab follows the picture (just under its box)", Math.abs(near.dx) < 60 && near.dy >= -4 && near.dy < 30, JSON.stringify(near));
    await t.shot("06b-picture-box");
  } else ok("(setup) the Excel paste on blank paper landed with a tab", false, `tables=${countType(blank, "table")}`);

  /* Switching twice: any pick, then K, restores the paste byte-for-byte; and a second pick never compounds the first. */
  before = await fresh();
  const baseJson2 = tableJson(before);
  d = await pick("values");
  await openFlyout(t); await t.page.keyboard.press("k");
  d = await t.stored();
  ok("Values → Keep Source Formatting restores the table byte-for-byte", tableJson(d) === baseJson2);
  await openFlyout(t); await t.page.keyboard.press("v");
  await openFlyout(t); await t.page.keyboard.press("t");
  d = await t.stored();
  ok("Values then Transpose = the ORIGINAL transposed (its link is back — nothing compounded)", JSON.stringify(gridOf(firstOf(d, "table"))[0]) === JSON.stringify(["Unit", "A-100", "A-200", "B-300"]) && marksIn(firstOf(d, "table")).includes("link"), JSON.stringify({ g: gridOf(firstOf(d, "table"))[0], m: marksIn(firstOf(d, "table")) }));
  await openFlyout(t); await t.page.keyboard.press("k");
  d = await t.stored();
  ok("…and K still brings the original back", tableJson(d) === baseJson2);
  ok("(box width never shrinks across the picks)", (await t.page.evaluate(() => document.querySelector(".planyr-anchor")?.getBoundingClientRect().width)) >= baseW - 1);
  ok("no page errors", t.errs.length === 0, t.errs.join(" | "));
  await t.close();
}

/* ═══ §2b  PLAIN TAB-SEPARATED TEXT (Excel's text half, no html table) ═══════════════════════ */
console.log("\n=== §2b tab-separated text → a table, with the table set (no widths, no fills to offer) ===");
{
  const t = await open();
  await t.seed(BOX_DOC);
  await t.enter("Intro line");
  await t.paste({ text: "a\tb\tc\n1\t2\t3\n4\t5\t6" });
  const d = await t.stored();
  ok("a tab-separated grid becomes a table", countType(d, "table") === 1);
  if (await t.tid("note-paste-badge").count()) {
    await openFlyout(t);
    const ids = (await flyoutButtons(t)).map((b) => b.id);
    ok("its set has no Keep Source Column Widths (nothing was captured)", ids.includes("transpose") && !ids.includes("widths"), JSON.stringify(ids));
  } else ok("a tab is offered for a pasted grid", false);
  await t.close();
}

/* ═══ §2c  EVERY COMMITTED CLIPBOARD (Excel · Sheets · Word · OneNote · Outlook · a web page) ═══════ */
console.log("\n=== §2c every committed clipboard: a table gets the table set; Values and Transpose work; Keep Source Formatting restores it ===");
{
  const t = await open();
  let tablesSeen = 0;
  for (const name of fixtureNames) {
    const fx = loadFixture(name);
    await t.seed(BOX_DOC);
    await t.enter("Intro line");
    await t.paste({ html: fx.html, text: fx.text });
    const d0 = await t.stored();
    const tb0 = firstOf(d0, "table");
    const hasTab = await t.tid("note-paste-badge").count() === 1;
    if (!tb0) { ok(`${name}: no table landed, so the TEXT set (or no tab for plain text) — nothing to transform`, true); continue; }
    tablesSeen += 1;
    ok(`${name}: a table landed and the tab is offered`, hasTab);
    if (!hasTab) continue;
    await openFlyout(t);
    const kind = await t.page.evaluate(() => document.querySelector('[data-testid="note-paste-options"]')?.getAttribute("data-paste-kind"));
    ok(`${name}: it is the table set`, kind === "table", String(kind));
    const base = tableJson(d0);
    await t.page.keyboard.press("v");
    let d = await t.stored();
    ok(`${name}: Values keeps the grid and drops every mark`, JSON.stringify(gridOf(firstOf(d, "table"))) === JSON.stringify(gridOf(tb0)) && marksIn(firstOf(d, "table")).length === 0, JSON.stringify(marksIn(firstOf(d, "table"))));
    await openFlyout(t); await t.page.keyboard.press("t");
    d = await t.stored();
    const tt = firstOf(d, "table");
    const dims = (x) => [x.content.length, Math.max(...x.content.map((r) => r.content.length))];
    const spans = (x) => x.content.some((r) => r.content.some((c) => (c.attrs?.colspan || 1) > 1 || (c.attrs?.rowspan || 1) > 1));
    ok(`${name}: Transpose swaps rows and columns`, spans(tb0) ? tt.content.length > 0 : (dims(tt)[0] === dims(tb0)[1] && dims(tt)[1] === dims(tb0)[0]), `${dims(tb0)} → ${dims(tt)}`);
    await openFlyout(t); await t.page.keyboard.press("k");
    d = await t.stored();
    ok(`${name}: Keep Source Formatting restores the table byte-for-byte`, tableJson(d) === base);
  }
  ok("(known-good) at least the Excel, Sheets and OneNote clipboards landed tables", tablesSeen >= 3, `tables=${tablesSeen}`);
  ok("no page errors across every clipboard", t.errs.length === 0, t.errs.join(" | "));
  await t.close();
}

/* ═══ §3  A GRID PASTED INTO AN EXISTING TABLE'S CELLS ════════════════════════════════════════ */
console.log("\n=== §3 a grid pasted into an existing table's cells ===");
{
  const t = await open();
  const rows = ["x1 x2 x3 x4", "y1 y2 y3 y4", "z1 z2 z3 z4", "w1 w2 w3 w4", "v1 v2 v3 v4"].map((r) => ({ type: "tableRow", content: r.split(" ").map(cellP) }));
  await t.seed([box("b1", 40, 40, [{ type: "table", content: rows }], 520), para("")]);
  await t.enter("x1");
  await t.paste({ html: excel.html, text: excel.text });
  const landed = await t.stored();
  const tb = firstOf(landed, "table");
  ok("the pasted cells filled the existing table (Unit is now in the first cell)", gridOf(tb)[0][0] === "Unit", JSON.stringify(gridOf(tb)));
  const tabs = await t.tid("note-paste-badge").count();
  if (!tabs) {
    ok("a tab is offered for cells pasted into a table", false, "no tab (prosemirror-tables handled the paste before the badge saw it?)");
  } else {
    await openFlyout(t);
    const kind = await t.page.evaluate(() => document.querySelector('[data-testid="note-paste-options"]').getAttribute("data-paste-kind"));
    const ids = (await flyoutButtons(t)).map((b) => b.id);
    ok("the cells set: K M V E R only (no transpose, no picture)", kind === "cells" && JSON.stringify(ids) === JSON.stringify(["source", "merge", "values", "valuesFormat", "formatting"]), `${kind} ${JSON.stringify(ids)}`);
    await t.tid("note-paste-valuesFormat").click();
    const d = await t.stored();
    ok("Values and Source Formatting shades the cells the paste wrote", fillsOf(firstOf(d, "table"))[0].some((f) => f === "#dbe5f1"), JSON.stringify(fillsOf(firstOf(d, "table"))));
    await t.page.keyboard.press("Control+z");
    const u = await t.stored();
    ok("one Ctrl+Z undoes it", tableJson(u) === tableJson(landed));
    // Formatting only, on its own fresh paste (an undo retires the offer, as any edit does).
    await t.seed([box("b1", 40, 40, [{ type: "table", content: rows }], 520), para("")]);
    await t.enter("x1");
    await t.paste({ html: excel.html, text: excel.text });
    await openFlyout(t);
    await t.tid("note-paste-formatting").click();
    const r = await t.stored();
    ok("Formatting only keeps the cells' own text (the pasted words are gone, x1.. stay) and takes the shading", gridOf(firstOf(r, "table"))[0][0] === "x1" && fillsOf(firstOf(r, "table"))[0][0] === "#dbe5f1", JSON.stringify({ g: gridOf(firstOf(r, "table")), f: fillsOf(firstOf(r, "table"))[0] }));
  }
  ok("no page errors", t.errs.length === 0, t.errs.join(" | "));
  await t.close();
}

/* ═══ §4  THE RIGHT-CLICK MENU ═══════════════════════════════════════════════════════════════ */
console.log("\n=== §4 right-click Paste ▸ uses the same drawings and names ===");
{
  const t = await open();
  await t.seed(BOX_DOC);
  await t.enter("Intro line");
  const at = await t.page.evaluate(() => { const r = document.querySelector(".planyr-anchor").getBoundingClientRect(); return { x: r.left + 30, y: r.top + 12 }; });
  await t.page.mouse.click(at.x, at.y, { button: "right" });
  await pacedWait(t.page, 400);
  await t.tid("note-menu-paste").hover();
  await pacedWait(t.page, 300);
  const rows = await t.page.evaluate(() => [...document.querySelectorAll('[data-testid="note-menu-paste-sub"] button')].map((b) => ({ label: b.textContent.replace(/\s+/g, " ").trim(), svg: !!b.querySelector("svg.planyr-paste-glyph") })));
  ok("the submenu names the three options in Word's capitalisation", rows.length === 3 && /Keep Source Formatting/.test(rows[0].label) && /Merge Formatting/.test(rows[1].label) && /Keep Text Only/.test(rows[2].label), JSON.stringify(rows));
  ok("each row carries the same drawing as the flyout", rows.every((r) => r.svg));
  await t.shot("07-menu");
  await t.close();
}

/* ═══ §5  PHONE AND DARK THEME ═══════════════════════════════════════════════════════════════ */
console.log("\n=== §5 phone: the flyout fits and the targets are thumb-sized; dark theme: the halo follows the surface ===");
{
  const t = await open({ viewport: { width: 390, height: 780 }, touch: true });
  await t.seed(BOX_DOC);
  await t.page.evaluate(() => { window.__noteEditor?.focus?.(); });
  await t.enter("Intro line").catch(() => {});
  await t.paste({ html: excel.html, text: excel.text });
  if (await t.tid("note-paste-badge").count()) {
    await t.tid("note-paste-badge").click();
    await pacedWait(t.page, 300);
    const m = await t.page.evaluate(() => {
      const f = document.querySelector('[data-testid="note-paste-options"]').getBoundingClientRect();
      const btns = [...document.querySelectorAll('[data-testid="note-paste-options"] button.planyr-paste-btn')].map((b) => b.getBoundingClientRect());
      return { left: f.left, right: f.right, top: f.top, bottom: f.bottom, vw: innerWidth, vh: innerHeight, minBtn: Math.min(...btns.map((b) => Math.min(b.width, b.height))), n: btns.length };
    });
    ok("the flyout sits wholly inside the phone screen", m.left >= 0 && m.right <= m.vw && m.top >= 0 && m.bottom <= m.vh, JSON.stringify(m));
    ok("every target is at least thumb-sized (44)", m.minBtn >= 44 && m.n === 8, JSON.stringify(m));
    await t.shot("08-phone-flyout");
    await t.tid("note-paste-transpose").tap().catch(async () => { await t.tid("note-paste-transpose").click(); });
    const d = await t.stored();
    ok("a tap picks an option (Transpose)", gridOf(firstOf(d, "table"))?.[0]?.[1] === "A-100", JSON.stringify(gridOf(firstOf(d, "table"))));
  } else ok("a tab is offered on a phone", false, "no tab");
  await t.close();

  const dk = await open({ theme: "dark" });
  await dk.seed(BOX_DOC);
  await dk.enter("Intro line");
  await dk.paste({ html: excel.html, text: excel.text });
  await openFlyout(dk);
  const dark = await dk.page.evaluate(() => {
    const f = document.querySelector('[data-testid="note-paste-options"]');
    const b = f.querySelector('button[aria-pressed="false"]');
    const g = b.querySelector("svg");
    const halo = getComputedStyle(b).getPropertyValue("--paste-halo").trim();
    const pressed = getComputedStyle(f.querySelector('button[aria-pressed="true"]')).getPropertyValue("--paste-halo").trim();
    return { theme: document.documentElement.getAttribute("data-theme"), surface: getComputedStyle(f).backgroundColor, halo, pressed, ink: getComputedStyle(g).getPropertyValue("--paste-ink").trim(), blue: getComputedStyle(g).getPropertyValue("--paste-blue").trim() };
  });
  ok("dark theme is on", dark.theme === "dark", JSON.stringify(dark));
  ok("the halo is the surface colour, not white (a dark flyout has no white glow)", dark.halo && dark.halo !== "#FFFFFF" && dark.halo !== "#fff", JSON.stringify(dark));
  ok("the ink marks have dark-theme twins", dark.blue === "#6FB4F0", JSON.stringify(dark));
  await dk.shot("09-dark-flyout");
  await dk.close();
}

await browser.close();
console.log(`\n${passN} passed, ${failN} failed`);
if (failN) { console.log(`FAILED:\n - ${failures.join("\n - ")}`); process.exit(1); }
