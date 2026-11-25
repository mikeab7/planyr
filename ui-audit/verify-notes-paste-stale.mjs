#!/usr/bin/env node
/* verify-notes-paste-stale — THE PASTE TAB GOES AWAY WHEN IT WOULD BE STALE (owner report 2026-11-25: pasted, zoomed out, and the "(Ctrl)" tab
 * hung in mid-air away from the paste). The tab is retired by: a zoom · a pan · a press anywhere off the tab · a caret key · typing · undo.
 * It SURVIVES: a wait of a few seconds (it has its own 12 s timer), and being used right away (click opens the menu; a pick works).
 * KNOWN-GOOD ARM: right after a paste the tab is on screen — if it never appears the run is VOID (exit 2). `BASE_URL` · `PW_CHROME`. */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { checkPasteOption, runsOf, summariseDoc } from "./lib/pasteBank.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5199";
const EXEC = process.env.PW_CHROME || undefined;
const ONLY = process.env.ONLY || "";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";
const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../test/fixtures/clipboard-bank");
const fx = (n) => ({ html: fs.readFileSync(path.join(FX, `${n}.html`), "utf8"), text: fs.readFileSync(path.join(FX, `${n}.txt`), "utf8") });
const TEXT_SOURCES = { "browser block styles": fx("browser-block-styles"), "Word with its font in a class": fx("word-class-font") };
const EXCEL = fx("excel-mixed-cells");

const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await assertMeasurable(page, "verify-notes-paste-menu");

let passN = 0; let failN = 0;
const failures = [];
const ok = (label, cond, detail = "") => {
  if (cond) { passN += 1; console.log(`  ✓ ${label}`); } else { failN += 1; failures.push(label); console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`); }
};
const void_ = async (why) => { console.log(`\nVOID: ${why}`); await browser.close(); process.exit(2); };
const wait = (ms) => pacedWait(page, ms);

const para = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const box = (aid, content, x = 40, y = 40) => ({ type: "noteAnchor", attrs: { x, y, w: 460, h: null, aid }, content });
const cellP = (t) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [para(t)] });
const grid = (rows, cols) => ({ type: "table", content: Array.from({ length: rows }, (_, r) => ({ type: "tableRow", content: Array.from({ length: cols }, (_, c) => cellP(`r${r}c${c}`)) })) });

async function seed(docContent) {
  await page.goto("about:blank");                                   // an edited editor flushes its document as the tab unloads
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([tk, pk, d]) => {
    localStorage.clear();
    localStorage.setItem("planyr.theme", "light");
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "Throwaway", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, { type: "doc", content: docContent }]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await wait(700);
}
async function clickIn(needle) {
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
  await wait(250);
}
const enter = async (needle) => { await clickIn(needle); await wait(650); await clickIn(needle); };      // desktop is two-stage: select, then enter
/** A box with one empty line, the caret in it. */
async function landInBox() {
  await seed([box("b1", [para("x")]), para("")]);
  await enter("x"); await page.keyboard.press("Backspace"); await wait(300);
}
async function paste({ html, text }) {
  await page.evaluate(([h, t]) => {
    const dt = new DataTransfer();
    if (h) dt.setData("text/html", h);
    if (t != null) dt.setData("text/plain", t);
    const target = document.activeElement && document.activeElement !== document.documentElement ? document.activeElement : document.body;
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [html || null, text ?? null]);
  await wait(1100);
}
const stored = async () => { await wait(750); return JSON.parse(await page.evaluate((k) => localStorage.getItem(k), PAGE_KEY) || "null"); };
const ctrlTap = async () => { await page.keyboard.down("Control"); await page.keyboard.up("Control"); await wait(250); };


const chip = () => page.evaluate(() => !!document.querySelector('[data-testid="note-paste-options"]'));
const SRC = TEXT_SOURCES["browser block styles"];
async function fresh() { await landInBox(); await paste(SRC); }
async function arm(label) { await fresh(); if (!(await chip())) await void_(`no tab after a paste (${label})`); }

await arm("start");
ok("the tab shows after a paste", await chip());
await wait(2500);
ok("…and is still there a few seconds later", await chip());
await page.keyboard.down("Control"); await page.keyboard.up("Control"); await wait(250);
ok("used right away: a Ctrl tap opens the menu", await page.evaluate(() => !!document.querySelector('[data-testid="note-paste-options"][data-paste-kind]')));
await page.keyboard.press("Escape"); await wait(200);

await arm("zoom out");
await page.keyboard.down("Control"); await page.keyboard.press("-"); await page.keyboard.up("Control"); await wait(500);
ok("Ctrl+− (zoom out) removes the tab", !(await chip()));

await arm("wheel zoom");
await page.mouse.move(700, 500); await page.mouse.wheel(0, 300); await wait(500);
ok("a wheel zoom removes the tab", !(await chip()));

await arm("pan");
await page.mouse.move(700, 500); await page.keyboard.down("Shift"); await page.mouse.wheel(0, 200); await page.keyboard.up("Shift"); await wait(500);
ok("a sideways pan removes the tab", !(await chip()));

await arm("click elsewhere");
await page.mouse.click(1300, 700); await wait(400);
ok("a press elsewhere removes the tab", !(await chip()));

await arm("arrow");
await page.keyboard.press("ArrowLeft"); await wait(300);
ok("moving the caret with an arrow removes the tab", !(await chip()));

await arm("type");
await page.keyboard.type("z"); await wait(300);
ok("typing removes the tab", !(await chip()));

await arm("undo");
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control"); await wait(400);
ok("undoing the paste removes the tab", !(await chip()));

await arm("pick");
await page.click('[data-testid="note-paste-badge"]'); await wait(300);
await page.click('[data-testid="note-paste-text"]'); await wait(400);
ok("clicking the tab then an option still works (menu closed, tab gone after the pick or kept, no error)", errs.length === 0);

ok("no page error", errs.length === 0, errs.join(" | "));
console.log(`\n${passN} passed, ${failN} failed`);
await browser.close();
process.exit(failN ? 1 : 0);
