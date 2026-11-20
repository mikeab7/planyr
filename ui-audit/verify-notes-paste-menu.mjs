#!/usr/bin/env node
/* verify-notes-paste-menu — THE PASTE-OPTIONS MENU'S KEYBOARD AND MOUSE, AND WHAT EACH OPTION KEEPS (NEW-1 + NEW-2, owner report 2026-11-10).
 *
 * THE REPORT, verbatim gist: "whenever I paste something and then push Control, because the paste options pops up, and then I use the
 * mouse or the directional keys, it doesn't work correctly. It doesn't go to the paste options; it stays on the page for the notebook
 * module. And keep source formatting doesn't work: I'm pasting something that is already red, and it takes away the font."
 *
 * §A  A LONE CTRL TAP OPENS THE MENU AND HANDS IT THE KEYBOARD (Word's behaviour)
 *     · Ctrl pressed and released opens it; DOM focus lands in the menu (on the option applied now), not the editor
 *     · Ctrl+V, Ctrl+C, Ctrl+A, Ctrl+click, Ctrl+wheel and Ctrl+Shift+anything are CHORDS and never open it
 *     · arrows / Home / End / Tab move the highlight (and wrap) and the caret does not move
 *     · each of Keep Source · Merge · Keep Text Only is picked THREE ways — arrows + Enter, its letter (K/M/T), the mouse (hover then click) —
 *       and after any pick the menu is closed, focus is back in the editor and typing works
 *     · Escape closes it, returns focus to the caret, leaves the paste and the box's editing state alone
 *     · a press, a drag, a wheel and a double-click ON the menu reach nothing under it (no pan, no zoom, no caret move, no box move)
 *     · a second paste replaces the first chip; typing dismisses it; the same on a table paste and a paste into a table's cells
 * §B  WHAT EACH OPTION KEEPS, from three representative clipboards (a browser's block-styled paragraphs, Word desktop with its font in a
 *     class, an Excel range): Keep Source = the paste untouched, Merge = font/size/colour/highlight gone and bold/italic/underline/strike/link
 *     kept, Keep Text Only = the words only; the table set's Values / Values and Source Formatting likewise.
 *
 * ⛔ KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): clicking the chip opens the menu (that has always worked) — if the harness cannot see
 * a menu, or the judge cannot reject a wrong document, the run is VOID (exit 2), never scored.
 *
 * `BASE_URL` (default http://127.0.0.1:5199) · `PW_CHROME` · `ONLY=A|B` to narrow.
 */
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

/** What the menu and focus look like right now. */
const look = () => page.evaluate(() => {
  const a = document.activeElement;
  const menu = document.querySelector('[data-testid="note-paste-options"][data-paste-kind]');
  const pressed = menu?.querySelector('[aria-pressed="true"]');
  const act = menu?.querySelector('[data-active="1"]');
  return {
    open: !!menu,
    chip: !!document.querySelector('[data-testid="note-paste-options"]'),
    focusId: a?.closest?.("[data-testid='note-paste-options']") ? (a.getAttribute("data-testid") || "").replace("note-paste-", "") : null,
    focusInEditor: !!a?.closest?.(".ProseMirror"),
    applied: pressed ? pressed.getAttribute("data-testid").replace("note-paste-", "") : null,
    current: act ? act.getAttribute("data-testid").replace("note-paste-", "") : null,
    sel: window.__noteEditor?.selection?.() || null,
    view: document.querySelector('[data-testid="note-workspace"]')?.style.transform || "",
    editing: !!document.querySelector('.planyr-anchor[data-editing="1"]'),
  };
});
/** Which option is applied now — read from the open menu (its pressed state), then close it again. */
const appliedNow = async () => { await ctrlTap(); const a = (await look()).applied; await page.keyboard.press("Escape"); await wait(150); return a; };
const sameSel = (a, b) => a && b && a.from === b.from && a.to === b.to;

/* ── known-good arms ───────────────────────────────────────────────────────────────────────────────────────────────── */
console.log("\n=== KNOWN-GOOD ARMS — the harness can see a paste and a menu, and its judge can fail ===");
{
  await landInBox();
  await paste(TEXT_SOURCES["browser block styles"]);
  const s0 = await look();
  if (!s0.chip) await void_("a formatted paste raised no paste-options tab — the harness cannot see a paste.");
  await page.click('[data-testid="note-paste-badge"]');
  await wait(300);
  if (!(await look()).open) await void_("clicking the tab did not open the menu — the harness cannot see the menu.");
  ok("the paste raises a tab and a click opens the menu", true);
  const base = await stored();
  const wrong = JSON.parse(JSON.stringify(base));
  const bad = [checkPasteOption("source", base, { type: "doc", content: [{ type: "paragraph" }] }), checkPasteOption("merge", base, base), checkPasteOption("text", base, base)];
  if (bad.some((p) => p.length === 0)) await void_("the option judge accepted a document that did nothing / kept everything — it cannot fail.");
  void wrong;
  ok("the option judge rejects an unchanged paste as Merge / Keep Text Only, and a different one as Keep Source", true);
}

const A = !ONLY || ONLY === "A";
const B = !ONLY || ONLY === "B";

if (A) {
  /* ── A1 · the Ctrl tap ─────────────────────────────────────────────────────────────────────────────────────────────── */
  console.log("\n=== A1 · a lone Ctrl tap opens the menu and moves focus into it ===");
  await landInBox();
  await paste(TEXT_SOURCES["browser block styles"]);
  const before = await look();
  ok("after the paste the tab is up, the menu is closed and the caret is in the editor", before.chip && !before.open && before.focusInEditor, JSON.stringify(before));
  await ctrlTap();
  let s = await look();
  ok("Ctrl pressed and released opens the menu", s.open, JSON.stringify(s));
  ok("…and DOM focus is IN the menu, on the option applied now (Keep Source), not in the editor", s.focusId === "source" && !s.focusInEditor, JSON.stringify(s));
  ok("…the paste is untouched (opening a menu is not an edit)", sameSel(s.sel, before.sel));

  console.log("\n=== A2 · arrows, Home, End and Tab move the highlight; the caret and the page do not move ===");
  const walk = async (key, want, label) => {
    await page.keyboard.press(key); await wait(120);
    const t = await look();
    ok(`${label}: focus on ${want}`, t.focusId === want && t.current === want && sameSel(t.sel, before.sel) && t.view === s.view, JSON.stringify(t));
  };
  await walk("ArrowRight", "merge", "ArrowRight");
  await walk("ArrowDown", "text", "ArrowDown");
  await walk("ArrowDown", "source", "ArrowDown wraps to the first");
  await walk("ArrowLeft", "text", "ArrowLeft wraps to the last");
  await walk("ArrowUp", "merge", "ArrowUp");
  await walk("Home", "source", "Home");
  await walk("End", "text", "End");
  await walk("Tab", "source", "Tab cycles");
  await walk("Shift+Tab", "text", "Shift+Tab cycles back");
  ok("the menu is still open after all of that", (await look()).open);

  console.log("\n=== A3 · Escape closes the menu, gives the caret back, and changes nothing ===");
  const docBeforeEsc = JSON.stringify(await stored());
  const editingBefore = (await look()).editing;
  await page.keyboard.press("Escape"); await wait(250);
  s = await look();
  ok("Escape closes the menu but the tab stays", !s.open && s.chip, JSON.stringify(s));
  ok("…focus is back in the editor at the same caret", s.focusInEditor && sameSel(s.sel, before.sel), JSON.stringify(s));
  ok("…the paste is exactly as it was", JSON.stringify(await stored()) === docBeforeEsc);
  ok("…and the box is still being edited (Escape was the menu's, not the box's)", s.editing === editingBefore, JSON.stringify({ editingBefore, now: s.editing }));
  await page.keyboard.type("Q"); await wait(300);
  ok("typing goes into the document and dismisses the tab", !(await look()).chip && /Q/.test(JSON.stringify(await stored())));

  console.log("\n=== A4 · only a LONE Ctrl tap opens it — chords, clicks and Ctrl+wheel never do ===");
  const chord = async (label, act) => {
    await landInBox(); await paste(TEXT_SOURCES["browser block styles"]);
    await act();
    const t = await look();
    ok(`${label} does not open the menu`, !t.open, JSON.stringify(t));
  };
  await chord("Ctrl+C", async () => { await page.keyboard.press("Control+c"); await wait(200); });
  await chord("Ctrl+A", async () => { await page.keyboard.press("Control+a"); await wait(200); });
  await chord("Ctrl+Shift+X", async () => { await page.keyboard.press("Control+Shift+x"); await wait(200); });
  await chord("Ctrl held while another key is pressed, then released", async () => {
    await page.keyboard.down("Control"); await page.keyboard.press("ArrowLeft"); await page.keyboard.up("Control"); await wait(200);
  });
  await chord("Ctrl+click", async () => {
    const at = await page.evaluate(() => { const r = document.querySelector(".ProseMirror").getBoundingClientRect(); return { x: r.left + 12, y: r.top + 10 }; });
    await page.keyboard.down("Control"); await page.mouse.click(at.x, at.y); await page.keyboard.up("Control"); await wait(200);
  });
  await chord("Ctrl+wheel (zoom)", async () => {
    const at = await page.evaluate(() => { const r = document.querySelector('[data-testid="note-mat"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height - 80 }; });
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down("Control"); await page.mouse.wheel(0, -200); await page.keyboard.up("Control"); await wait(200);
  });
  {
    /* the REAL clipboard route: Ctrl+V itself must not open the menu either (its own Ctrl is released after the offer exists) */
    await landInBox();
    const src = TEXT_SOURCES["browser block styles"];
    await page.evaluate(([h, t]) => navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([h], { type: "text/html" }), "text/plain": new Blob([t], { type: "text/plain" }) })]), [src.html, src.text]);
    await page.keyboard.press("Control+v"); await wait(1200);
    const t = await look();
    if (!t.chip) ok("Ctrl+V from the real clipboard raised the tab", false, "no tab — the real-clipboard arm is VOID for this run: " + JSON.stringify(t));
    else ok("Ctrl+V pastes and raises the tab, but does not open the menu", !t.open, JSON.stringify(t));
  }

  console.log("\n=== A5 · each option, three ways: arrows + Enter · its letter · the mouse ===");
  const MODES = [["source", "K", "Keep Source Formatting"], ["merge", "M", "Merge Formatting"], ["text", "T", "Keep Text Only"]];
  const OFFER = TEXT_SOURCES["Word with its font in a class"];
  for (const [mode, letter, name] of MODES) {
    for (const route of ["arrows + Enter", "letter", "mouse"]) {
      await landInBox(); await paste(OFFER);
      const base = await stored();
      /* Keep Source is the state a paste lands in, so to PICK it we first go somewhere else (Keep Text Only, by its letter) */
      const first = mode === "source" ? "text" : null;
      if (first) { await ctrlTap(); await page.keyboard.press("t"); await wait(500); }
      await ctrlTap();
      let t = await look();
      if (!t.open) { ok(`${name} by ${route}`, false, "the menu did not open: " + JSON.stringify(t)); continue; }
      if (route === "arrows + Enter") {
        for (let i = 0; i < 4 && (await look()).current !== mode; i += 1) { await page.keyboard.press("ArrowRight"); await wait(100); }
        await page.keyboard.press("Enter");
      } else if (route === "letter") {
        await page.keyboard.press(letter.toLowerCase());
      } else {
        const b = page.locator(`[data-testid="note-paste-${mode}"]`);
        await b.hover(); await wait(150);
        const h = await look();
        ok(`${name} by mouse: hovering it highlights it and moves focus there`, h.current === mode && h.focusId === mode, JSON.stringify(h));
        await b.click();
      }
      await wait(700);
      t = await look();
      ok(`${name} by ${route}: the menu closed and the caret is back in the editor`, !t.open && t.focusInEditor, JSON.stringify(t));
      const after = await stored();
      const problems = checkPasteOption(mode, base, after);
      const applied = await appliedNow();
      ok(`${name} by ${route}: applied`, applied === mode && problems.length === 0, `${JSON.stringify({ applied })} ${problems.join(" | ")}`);
      await page.keyboard.type("!"); await wait(250);
      ok(`${name} by ${route}: typing goes into the document`, /!/.test(JSON.stringify(await stored())));
    }
  }

  console.log("\n=== A6 · nothing under the menu hears a press on it ===");
  await landInBox(); await paste(TEXT_SOURCES["browser block styles"]);
  await page.click('[data-testid="note-paste-badge"]'); await wait(300);
  const snap = await look();
  const docSnap = JSON.stringify(await stored());
  const head = await page.locator(".planyr-paste-head").boundingBox();
  const cx = head.x + head.width / 2; const cy = head.y + head.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 140, cy + 90, { steps: 8 }); await page.mouse.up(); await wait(200);
  await page.mouse.dblclick(cx, cy); await wait(200);
  await page.mouse.wheel(0, -400); await wait(250);
  await page.mouse.wheel(300, 0); await wait(250);
  await page.mouse.click(cx, cy, { button: "right" }); await wait(250);
  const t6 = await look();
  ok("a drag on the menu does not pan the page", t6.view === snap.view, `${snap.view} → ${t6.view}`);
  ok("the wheel over the menu does not zoom or pan the page", t6.view === snap.view);
  ok("a press / double-click on the menu does not move the caret", sameSel(t6.sel, snap.sel), JSON.stringify([snap.sel, t6.sel]));
  ok("…does not open the page's own right-click menu", (await page.locator('[data-testid="note-doc-menu"]').count()) === 0);
  ok("…does not touch the document", JSON.stringify(await stored()) === docSnap);
  ok("…and the menu is still open", t6.open);
  await page.mouse.click(40, 920); await wait(300);                       // a press OUTSIDE closes it
  ok("a press outside the menu closes it", !(await look()).open);

  console.log("\n=== A7 · a second paste replaces the first tab; opening by click works the same as by Ctrl ===");
  await landInBox(); await paste(TEXT_SOURCES["browser block styles"]);
  await ctrlTap(); await page.keyboard.press("m"); await wait(600);
  ok("first paste: Merge applied", (await appliedNow()) === "merge");
  await paste(TEXT_SOURCES["Word with its font in a class"]);
  s = await look();
  ok("the second paste replaced the tab: closed, and Keep Source is the applied one again", s.chip && !s.open && (await appliedNow()) === "source", JSON.stringify(s));
  await page.click('[data-testid="note-paste-badge"]'); await wait(300);
  s = await look();
  ok("opening by click: the menu is open, focus is in it on Keep Source", s.open && s.focusId === "source" && s.applied === "source", JSON.stringify(s));
  await page.keyboard.press("ArrowRight"); await wait(100);
  ok("…and the arrows work after a click-open", (await look()).focusId === "merge");
  await page.keyboard.press("Escape"); await wait(200);
  ok("…Escape gives the caret back", (await look()).focusInEditor);

  console.log("\n=== A8 · the same on a TABLE paste and on a paste into a table's cells ===");
  await landInBox(); await paste(EXCEL);
  await ctrlTap();
  s = await look();
  ok("a table paste: Ctrl tap opens the table set with focus on Keep Source", s.open && s.focusId === "source", JSON.stringify(s));
  const order = [];
  for (let i = 0; i < 8; i += 1) { order.push((await look()).focusId); await page.keyboard.press("ArrowRight"); await wait(90); }
  ok("…the arrows walk the whole table set and wrap", order.length === 8 && new Set(order).size >= 6 && order[0] === (await look()).focusId, order.join(" > "));
  await page.keyboard.press("v"); await wait(800);
  const tv = await look();
  ok("…V (Values) applies, the menu closes, focus returns to the editor", !tv.open && tv.focusInEditor && (await appliedNow()) === "values", JSON.stringify(tv));
  {
    await seed([box("b1", [grid(4, 4)]), para("")]);
    await enter("r1c1");
    await paste({ html: "<table><tr><td><b>aa</b></td><td style='color:#c00000'>bb</td></tr><tr><td>cc</td><td>dd</td></tr></table>", text: "aa\tbb\ncc\tdd" });
    await ctrlTap();
    s = await look();
    ok("a grid pasted INTO a table's cells: Ctrl tap opens the menu with focus in it", s.open && !!s.focusId, JSON.stringify(s));
    await page.keyboard.press("ArrowRight"); await wait(100);
    ok("…the arrows move the highlight there too", (await look()).focusId === "merge");
    await page.keyboard.press("Escape"); await wait(200);
    ok("…Escape closes it, focus back in the table", (await look()).focusInEditor && !(await look()).open);
  }
}

if (B) {
  console.log("\n=== B · what each option keeps, from three clipboards ===");
  for (const [label, src] of Object.entries(TEXT_SOURCES)) {
    await landInBox(); await paste(src);
    const base = await stored();
    ok(`${label}: the paste carries its font, size and colour at all`, runsOf(base).some((r) => r.marks.fontFamily && r.marks.fontSize), JSON.stringify(runsOf(base).slice(0, 2)));
    const route = [["merge", "m"], ["text", "t"], ["source", "k"]];
    for (const [mode, key] of route) {
      await ctrlTap(); await page.keyboard.press(key); await wait(700);
      const problems = checkPasteOption(mode, base, await stored());
      ok(`${label}: ${mode === "source" ? "Keep Source Formatting (back again) is byte-identical to the paste" : mode === "merge" ? "Merge Formatting drops font/size/colour/highlight and keeps bold/italic/underline/strike/link" : "Keep Text Only keeps the words and no mark"}`, problems.length === 0, problems.slice(0, 4).join("\n      "));
    }
  }
  await landInBox(); await paste(EXCEL);
  const xbase = await stored();
  for (const [mode, key] of [["merge", "m"], ["values", "v"], ["valuesFormat", "e"], ["source", "k"]]) {
    await ctrlTap(); await page.keyboard.press(key); await wait(900);
    const after = await stored();
    const problems = mode === "source" ? checkPasteOption("source", xbase, after) : checkPasteOption(mode, xbase, after);
    const tables = summariseDoc(after).tables.length;
    ok(`Excel range: ${mode} ${mode === "merge" ? "keeps the table and its bold, drops colour" : mode === "values" ? "leaves words only" : mode === "valuesFormat" ? "keeps bold and colour" : "restores the paste exactly"}`, problems.length === 0 && tables === 1, problems.slice(0, 3).join("\n      ") + ` tables=${tables}`);
  }
}

ok("no page error", errs.length === 0, errs.slice(0, 3).join(" | "));
console.log(`\n${passN} passed, ${failN} failed`);
if (failN) console.log("FAILED:\n - " + failures.join("\n - "));
await browser.close();
process.exit(failN ? 1 : 0);
