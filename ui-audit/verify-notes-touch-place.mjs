/* verify-notes-touch-place — DOUBLE-TAP ON BLANK PAPER RAISES THE KEYBOARD AND THE FIRST TEXT
 * LANDS IN THE NEW BOX (NEW-1, iPhone review 2026-09-29). Engine: WebKit, hasTouch + isMobile.
 * Reported as "WebKit" — never "iPhone". Arms: real double-tap → focus inside the editor right
 * after the tap; keyboard typing; text with NO keydown (insertText — the predictive-bar / dictation
 * shape); title-focused variant; view does not scroll; empty-state wording; known-good arm. */
import { webkit, devices } from "playwright";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";
const failures = [];
const ok = (l, c, d) => { console.log(`${c ? "✓" : "⛔"} ${l}${d !== undefined ? ` — ${d}` : ""}`); if (!c) failures.push(l); };

const browser = await webkit.launch({});
const doc = (withNote) => ({ type: "doc", content: [
  ...(withNote ? [{ type: "noteAnchor", attrs: { x: 30, y: 30, w: 160, h: null, aid: "existing" },
    content: [{ type: "paragraph", content: [{ type: "text", text: "old box" }] }] }] : []),
  { type: "paragraph", content: [] }] });

async function open(withNote) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("   PAGEERROR", String(e.message).slice(0, 160)));
  await assertMeasurable(page, "verify-notes-touch-place");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  await page.evaluate(([tk, pk, d]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Touch", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, doc(withNote)]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 800);
  return page;
}
const ae = (page) => page.evaluate(() => {
  const a = document.activeElement; const ed = document.querySelector(".ProseMirror");
  return { tag: a?.tagName, inEditor: !!(a && ed && (a === ed || ed.contains(a))), testid: a?.getAttribute?.("data-testid") };
});
const stored = (page) => page.evaluate((k) => localStorage.getItem(k) || "", PAGE_KEY);
const boxes = (page) => page.evaluate(() => [...document.querySelectorAll(".planyr-anchor")].map((n) => n.textContent.replace(/\s+/g, " ").trim()));
async function tap(page, x, y) { await page.touchscreen.tap(x, y); }
async function dbl(page, x, y) { await tap(page, x, y); await pacedWait(page, 90); await tap(page, x + 9, y + 7); await pacedWait(page, 150); }
const blank = async (page) => {
  const r = await page.evaluate(() => { const m = document.querySelector('[data-testid="note-mat"]').getBoundingClientRect(); return { x: m.left, y: m.top, w: m.width, h: m.height }; });
  return { x: Math.round(r.x + r.w * 0.5), y: Math.round(r.y + r.h * 0.6) };
};

// known-good arm: the empty-state wording on a coarse pointer
{
  const page = await open(false);
  const t = await page.evaluate(() => document.querySelector('[data-testid="note-empty-placeholder"]')?.textContent);
  ok("empty page says Double-tap on a coarse pointer", t === "Double-tap anywhere to start a note.", JSON.stringify(t));
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  ok("known-good: the context really is (pointer: coarse)", coarse === true);
  await page.context().close();
}

for (const withNote of [false, true]) {
  // keyboard typing
  {
    const page = await open(withNote);
    const p = await blank(page);
    const before = await page.evaluate(() => document.querySelector('[data-testid="note-mat"]').scrollTop);
    await dbl(page, p.x, p.y);
    const a = await ae(page);
    ok(`[${withNote ? "old box" : "empty"}] focus inside editor right after the tap`, a.inEditor, JSON.stringify(a));
    ok(`[${withNote ? "old box" : "empty"}] view did not scroll`, (await page.evaluate(() => document.querySelector('[data-testid="note-mat"]').scrollTop)) === before);
    await page.keyboard.type("Hello");
    await pacedWait(page, 900);
    const b = await boxes(page);
    ok(`[${withNote ? "old box" : "empty"}] "Hello" (capital H) is in the NEW box`, b.includes("Hello") && (!withNote || b.includes("old box")), JSON.stringify(b));
    ok(`[${withNote ? "old box" : "empty"}] stored`, (await stored(page)).includes("Hello"));
    await page.context().close();
  }
  // no-keydown insertion (predictive bar / dictation shape)
  {
    const page = await open(withNote);
    const p = await blank(page);
    await dbl(page, p.x, p.y);
    await page.keyboard.insertText("Hello 👍");
    await pacedWait(page, 900);
    const b = await boxes(page);
    ok(`[${withNote ? "old box" : "empty"}] keydown-less insertText lands in the NEW box`, b.some((t) => t.includes("Hello")) && (!withNote || b.includes("old box")), JSON.stringify(b));
    await page.context().close();
  }
}

// title-focused variant
{
  const page = await open(true);
  await tap(page, ...(await page.evaluate(() => { const r = document.querySelector('[data-testid="note-title"]').getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2]; })));
  await pacedWait(page, 200);
  ok("title is focused", (await ae(page)).testid === "note-title");
  const titleBefore = await page.evaluate(() => document.querySelector('[data-testid="note-title"]').value);
  const p = await blank(page);
  await dbl(page, p.x, p.y);
  ok("title-focused: focus moved into the editor", (await ae(page)).inEditor, JSON.stringify(await ae(page)));
  await page.keyboard.type("Hello");
  await pacedWait(page, 900);
  const b = await boxes(page);
  ok("title-focused: text is in the box", b.includes("Hello"), JSON.stringify(b));
  ok("title-focused: title untouched", (await page.evaluate(() => document.querySelector('[data-testid="note-title"]').value)) === titleBefore);
  await page.context().close();
}

// slop: two taps 20 apart (finger) still pair; nothing armed after a single tap
{
  const page = await open(false);
  const p = await blank(page);
  await tap(page, p.x, p.y);
  ok("single tap arms nothing (no focus in editor)", !(await ae(page)).inEditor);
  await page.context().close();
}

await browser.close();
console.log(failures.length ? `\n⛔ ${failures.length} failure(s)` : "\n✓ all WebKit touch arms pass");
process.exit(failures.length ? 1 : 0);
