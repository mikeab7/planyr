#!/usr/bin/env node
/* verify-notes-paste-preview — LIVE PREVIEW OF A PASTE OPTION (NEW-2, owner ask 2026-11-12: "In Word, if you hover over Keep Source Formatting or
 * Merge Formatting or Keep Text Only, it shows you how they all look as you hover. I'd like that feature too.").
 *
 * Drives, in a real browser, with a REAL ClipboardEvent paste of the committed Outlook / Excel fixtures:
 *   · hovering an option shows the paste in that form IN PLACE (judged on the LIVE document, `window.__noteEditor.doc()`);
 *   · moving the mouse off the menu — or the keyboard highlight back to the applied option — takes it back, EXACTLY (deep-equal document, same caret);
 *   · the arrow keys preview too;
 *   · a preview adds NO undo step (`undoDepth` unchanged) and NO save (the stored page is byte-identical after longer than the save debounce);
 *   · a pick (click, Enter, the letter) commits what was shown, and Ctrl+Z then returns to the paste as it landed — not to a preview;
 *   · Escape / an outside press while previewing restores; the scroll position never moves; Excel's table set previews too (Transpose);
 *   · the "(Ctrl)" tab and the tooltip label are unchanged.
 * ⛔ THE INSTRUMENT IS ON TRIAL FIRST: a hover on Merge MUST visibly change the live document (else the harness cannot see a preview and the run is VOID),
 * and the judge must reject an unchanged document as "previewed".
 * `BASE_URL` (default http://127.0.0.1:5199) · `PW_CHROME`. */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { runsOf } from "./lib/pasteBank.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5199";
const EXEC = process.env.PW_CHROME || undefined;
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";
const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../test/fixtures/clipboard-bank");
const fx = (n) => ({ html: fs.readFileSync(path.join(FX, `${n}.html`), "utf8"), text: fs.readFileSync(path.join(FX, `${n}.txt`), "utf8") });
const OUTLOOK = fx("owa-recopy-restart-blanks");
const EXCEL = fx("excel-mixed-cells");

const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await assertMeasurable(page, "verify-notes-paste-preview");
let passN = 0; let failN = 0;
const ok = (label, cond, detail = "") => { if (cond) { passN += 1; console.log(`  ✓ ${label}`); } else { failN += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`); } };
const void_ = async (why) => { console.log("page errors:", JSON.stringify(errs)); console.log(`\nVOID: ${why}`); await browser.close(); process.exit(2); };
const wait = (ms) => pacedWait(page, ms);
const para = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const box = (aid, content) => ({ type: "noteAnchor", attrs: { x: 40, y: 40, w: 460, h: null, aid }, content });

async function seedAndLand() {
  await page.goto("about:blank");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([tk, pk, d]) => {
    localStorage.clear();
    localStorage.setItem("planyr.theme", "light");
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "Throwaway", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, { type: "doc", content: [box("b1", [para("x")]), para("")] }]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await wait(700);
  // enter the box (two-stage), empty its only line
  for (let i = 0; i < 2; i += 1) {
    const p = await page.evaluate(() => { const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT); const n = w.nextNode(); const r = document.createRange(); r.setStart(n, 1); r.collapse(true); const b = r.getBoundingClientRect(); return { x: Math.round(b.left) + 1, y: Math.round(b.top + b.height / 2) }; });
    await page.mouse.click(p.x, p.y); await wait(i ? 250 : 650);
  }
  await page.keyboard.press("Backspace"); await wait(300);
}
async function paste({ html, text }) {
  await page.evaluate(([h, t]) => {
    const dt = new DataTransfer(); if (h) dt.setData("text/html", h); if (t != null) dt.setData("text/plain", t);
    const target = document.activeElement && document.activeElement !== document.documentElement ? document.activeElement : document.body;
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [html || null, text ?? null]);
  await wait(1100);
}
const live = () => page.evaluate(() => window.__noteEditor.doc());
const depth = () => page.evaluate(() => window.__noteEditor.undoDepth());
const sel = () => page.evaluate(() => window.__noteEditor.selection());
const stored = () => page.evaluate((k) => localStorage.getItem(k), PAGE_KEY);
const scrollOf = () => page.evaluate(() => { const m = document.querySelector("[data-testid='note-mat']"); return m ? [m.scrollTop, m.scrollLeft] : null; });
const ctrlTap = async () => { await page.keyboard.down("Control"); await page.keyboard.up("Control"); await wait(250); };
const menuOpen = () => page.evaluate(() => !!document.querySelector('[data-testid="note-paste-options"][data-paste-kind]'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hover = async (mode) => { await page.hover(`[data-testid="note-paste-${mode}"]`); await wait(180); };
const offMenu = async () => { await page.mouse.move(1000, 700); await wait(180); };
const colours = (doc) => runsOf(doc).filter((r) => r.marks.color).length;
const lists = (doc) => JSON.stringify(doc).includes('"orderedList"');
const marksLeft = (doc) => runsOf(doc).filter((r) => Object.keys(r.marks).length).length;

console.log("\n=== KNOWN-GOOD ARM — a hover on Merge must visibly change the live document ===");
await seedAndLand();
await paste(OUTLOOK);
const landed = await live();
if (!(await page.evaluate(() => !!document.querySelector('[data-testid="note-paste-badge"]')))) await void_("the paste raised no paste-options tab.");
if (colours(landed) < 3) await void_("the Outlook paste carries no red text — the harness cannot judge a preview.");
await ctrlTap();
if (!(await menuOpen())) await void_("Ctrl tap did not open the menu.");
await hover("merge");
const previewed = await live();
if (same(previewed, landed)) await void_("hovering Merge changed nothing in the live document — the harness cannot see a preview (or the preview is not there).");
ok("the judge rejects an unchanged document as a preview", same(landed, landed) && !same(landed, previewed));
await offMenu();

console.log("\n=== A · hover shows each option in place and leaving takes it back exactly ===");
{
  const before = await live(); const d0 = await depth(); const sel0 = await sel(); const sc0 = await scrollOf();
  await hover("merge");
  const m = await live();
  ok("Merge Formatting: the red and the font are gone, the numbered list is still a list", colours(m) === 0 && lists(m) && marksLeft(m) === 0, `colours ${colours(m)} list ${lists(m)} marks ${marksLeft(m)}`);
  ok("…and the words are the same words", runsOf(m).map((r) => r.text).join("") === runsOf(before).map((r) => r.text).join(""));
  await hover("text");
  const t = await live();
  ok("Keep Text Only: plain lines — no list, no mark", !lists(t) && marksLeft(t) === 0, `list ${lists(t)} marks ${marksLeft(t)}`);
  ok("…and every line's words are still there", runsOf(t).map((r) => r.text).join("").replace(/\s+/g, "") === runsOf(before).map((r) => r.text).join("").replace(/\s+/g, ""));
  await hover("source");
  ok("hovering the applied option shows the paste as it landed", same(await live(), before));
  await hover("merge"); await offMenu();
  const after = await live();
  ok("moving off the menu restores the document EXACTLY (deep-equal)", same(after, before));
  ok("…and the caret is where it was", same(await sel(), sel0));
  ok("…and nothing scrolled", same(await scrollOf(), sc0));
  ok("a preview added NO undo step", (await depth()) === d0, `${d0} → ${await depth()}`);
}

console.log("\n=== B · a preview is not a save ===");
{
  await wait(1200);                                    // let the paste's own save land first
  const s0 = await stored();
  await hover("merge"); await wait(2500);             // longer than the save debounce, while the preview is on screen
  ok("the preview is on screen for the whole wait", colours(await live()) === 0);
  ok("the stored page did NOT change while previewing (still red)", (await stored()) === s0);
  await offMenu(); await wait(1500);
  ok("…nor after taking it back", (await stored()) === s0);
}

console.log("\n=== C · the keyboard highlight previews too ===");
{
  const before = await live();
  await page.focus(`[data-testid="note-paste-source"]`).catch(() => {});
  await page.keyboard.press("ArrowRight"); await wait(200);
  const m = await live();
  ok("ArrowRight to Merge Formatting previews it", colours(m) === 0 && lists(m), `colours ${colours(m)}`);
  await page.keyboard.press("ArrowRight"); await wait(200);
  ok("ArrowRight to Keep Text Only previews it", !lists(await live()));
  await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft"); await wait(200);
  ok("arrowing back to the applied option restores the paste", same(await live(), before));
  await page.keyboard.press("ArrowRight"); await wait(200);
  await page.keyboard.press("Escape"); await wait(250);
  ok("Escape while previewing restores it and closes the menu", same(await live(), before) && !(await page.evaluate(() => !!document.querySelector('[data-testid="note-paste-source"]'))));
}

console.log("\n=== D · a pick commits what was shown, and Ctrl+Z goes back to the paste, not to a preview ===");
for (const [how, act] of [
  ["a click", async () => { await hover("merge"); await page.click('[data-testid="note-paste-merge"]'); }],
  ["Enter", async () => { await page.focus('[data-testid="note-paste-source"]'); await page.keyboard.press("ArrowRight"); await wait(150); await page.keyboard.press("Enter"); }],
  ["the letter M", async () => { await hover("merge"); await page.keyboard.press("m"); }],
]) {
  await seedAndLand(); await paste(OUTLOOK);
  const base = await live(); const d0 = await depth();
  await ctrlTap();
  await act(); await wait(700);
  const picked = await live();
  ok(`${how}: Merge Formatting is applied (no red, still a list)`, colours(picked) === 0 && lists(picked) && !same(picked, base));
  ok(`${how}: it is ONE undo step`, (await depth()) === d0 + 1, `${d0} → ${await depth()}`);
  await page.keyboard.press("Control+z"); await wait(500);
  ok(`${how}: Ctrl+Z returns to the paste as it landed (red is back)`, same(await live(), base), `colours ${colours(await live())}`);
}

console.log("\n=== E · an outside press while previewing restores it ===");
{
  await seedAndLand(); await paste(OUTLOOK);
  const base = await live();
  await ctrlTap(); await hover("text");
  ok("previewing Keep Text Only", !lists(await live()));
  await page.mouse.click(1100, 760); await wait(400);
  ok("a press outside the menu restores the paste and closes the menu", same(await live(), base) && !(await menuOpen()));
}

console.log("\n=== F · Excel's table set previews too (Transpose) ===");
{
  await seedAndLand(); await paste(EXCEL);
  const base = await live(); const d0 = await depth();
  await ctrlTap();
  const has = await page.evaluate(() => !!document.querySelector('[data-testid="note-paste-transpose"]'));
  ok("the table paste offers Excel's set", has);
  if (has) {
    await hover("transpose");
    ok("hovering Transpose changes the live table", !same(await live(), base));
    await offMenu();
    ok("leaving restores the table exactly, with no undo step", same(await live(), base) && (await depth()) === d0);
    await hover("values"); ok("hovering Values shows the values-only table", !same(await live(), base)); await offMenu();
    ok("…and restores", same(await live(), base));
  }
}
console.log("\n=== G · on ARMED BLANK PAPER (a self-fitting box): the preview must not resize the box and leave it resized (found live, 2026-11-13) ===");
{
  await page.goto("about:blank");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([tk, pk, d]) => {
    localStorage.clear(); localStorage.setItem("planyr.theme", "light");
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "Throwaway", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, { type: "doc", content: [para("")] }]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 }); await wait(700);
  const at = await page.evaluate(() => { const r = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.08), y: Math.round(r.top + r.height * 0.12) }; });
  await page.mouse.dblclick(at.x, at.y); await wait(450);
  await paste(OUTLOOK);
  await ctrlTap();
  const base = await live(); const d0 = await depth();
  for (const mode of ["merge", "text", "merge"]) { await hover(mode); await wait(250); }
  await offMenu(); await wait(500);
  ok("after hovering Merge / Text / Merge and moving off, the document (box width included) is exactly as pasted", same(await live(), base), "the box width or an attribute differs — a preview left a resize behind");
  ok("…with no undo step", (await depth()) === d0);
  await hover("text"); await page.keyboard.press("Escape"); await wait(500);
  ok("Escape after a Keep Text Only hover restores the document exactly too", same(await live(), base));
}
ok("no page error", errs.length === 0, errs.slice(0, 3).join(" | "));
console.log(`\n${passN} passed, ${failN} failed`);
await browser.close();
process.exit(failN ? 1 : 0);
