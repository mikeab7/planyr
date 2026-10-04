/* verify-notes-touch-box-tap — NEW-3 (iPhone review 2026-09-29): on TOUCH a tap on a box's text puts
 * the caret there and the keyboard stays up — including the box you were just typing in, and when
 * moving from box A to box B. Engine: WebKit, hasTouch + isMobile (reported as "WebKit", never
 * "iPhone"). Judged on real activeElement + focusout events + the editor's own selection, never on
 * a rect. Known-good arm: a MOUSE click on an unselected box still takes desktop's stage 1 (box
 * selected, editor blurred) — so the probe can see a blur at all. */
import { webkit, devices } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";
const failures = [];
const ok = (l, c, d) => { console.log(`${c ? "✓" : "⛔"} ${l}${d !== undefined ? ` — ${d}` : ""}`); if (!c) failures.push(l); };
const browser = await webkit.launch({});

const box = (aid, x, y, text) => ({ type: "noteAnchor", attrs: { x, y, w: 160, h: null, aid },
  content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] });
const doc = (...boxes) => ({ type: "doc", content: [...boxes, { type: "paragraph", content: [] }] });

async function open(d, touch = true) {
  const ctx = await browser.newContext(touch ? { ...devices["iPhone 13"] } : { viewport: { width: 1000, height: 800 } });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("   PAGEERROR", String(e.message).slice(0, 160)));
  await assertMeasurable(page, "verify-notes-touch-box-tap");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  await page.evaluate(([tk, pk, dd]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "T", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(pk, JSON.stringify(dd));
    window.__blurs = 0;
    window.addEventListener("focusout", () => { window.__blurs += 1; }, true);
  }, [TREE_KEY, PAGE_KEY, d]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await page.evaluate(() => { window.__blurs = 0; window.addEventListener("focusout", () => { window.__blurs += 1; }, true); });
  await pacedWait(page, 800);
  return page;
}
const state = (page) => page.evaluate(() => {
  const a = document.activeElement; const ed = document.querySelector(".ProseMirror");
  return { inEditor: !!(a && ed && (a === ed || ed.contains(a))), blurs: window.__blurs, sel: window.__noteEditor?.selection(),
    editing: [...document.querySelectorAll(".planyr-anchor")].map((n) => n.getAttribute("data-anchor-id") + ":" + (n.getAttribute("data-editing") ? "E" : "") + (n.getAttribute("data-selected") ? "S" : "")).join(",") };
});
// screen x/y of the gap AFTER `n` characters of the first text node inside the box `aid`
const gap = (page, aid, n) => page.evaluate(([a, k]) => {
  const el = [...document.querySelectorAll(".planyr-anchor")].find((e) => e.getAttribute("data-anchor-id") === a);
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const t = w.nextNode();
  const r = document.createRange(); r.setStart(t, Math.max(0, k - 1)); r.setEnd(t, k);
  const b = r.getBoundingClientRect(); return { x: b.right - 1, y: b.top + b.height / 2 };
}, [aid, n]);

// 1. a tap inside the box you are typing in keeps the keyboard (focus) and moves the caret there
{
  const page = await open(doc());
  const m = await page.evaluate(() => { const r = document.querySelector('[data-testid="note-mat"]').getBoundingClientRect(); return { x: r.left + r.width * 0.45, y: r.top + r.height * 0.5 }; });
  await page.touchscreen.tap(m.x, m.y); await pacedWait(page, 90); await page.touchscreen.tap(m.x + 8, m.y + 6); await pacedWait(page, 250);
  await page.keyboard.type("hello world again"); await pacedWait(page, 200);
  const aid = await page.evaluate(() => document.querySelector(".planyr-anchor")?.getAttribute("data-anchor-id"));
  ok("box created and typed into", !!aid);
  const before = await state(page);
  const g = await gap(page, aid, 2);                         // near the start: far from the caret at the END
  await page.touchscreen.tap(g.x, g.y); await pacedWait(page, 250);
  const s = await state(page);
  ok("tap inside the box you typed in: focus stays in the editor", s.inEditor, JSON.stringify(s));
  ok("…and no focusout event fired", s.blurs === before.blurs, `${before.blurs} → ${s.blurs}`);
  ok("…the box is selected AND being edited (not a stage-1 tap)", /E/.test(s.editing) && /S/.test(s.editing), s.editing);
  await page.keyboard.type("X"); await pacedWait(page, 200);
  const txt = await page.evaluate(() => document.querySelector(".planyr-anchor")?.textContent);
  const at = txt.indexOf("X");
  // WebKit's own touch caret placement lands within a couple of characters of the finger (measured:
  // ~+2 on this build with or without this change), so the claim is "moved to the tap", not "to the glyph".
  ok("the caret moved to the tap point (X typed near the 2nd character, not at the end)", at >= 0 && at <= 6, `${JSON.stringify(txt)} X@${at}`);
  await page.context().close();
}

// 2. box A → box B: the keyboard never drops
{
  const page = await open(doc(box("ba", 20, 40, "alpha text"), box("bb", 20, 220, "bravo text")));
  const ga = await gap(page, "ba", 3); await page.touchscreen.tap(ga.x, ga.y); await pacedWait(page, 250);
  const s1 = await state(page);
  ok("first tap into box A: focus in editor, no blur", s1.inEditor && s1.blurs === 0, JSON.stringify(s1));
  const gb = await gap(page, "bb", 3); await page.touchscreen.tap(gb.x, gb.y); await pacedWait(page, 250);
  const s2 = await state(page);
  ok("tap from A to B: focus stays, no blur", s2.inEditor && s2.blurs === 0, JSON.stringify(s2));
  ok("B is the box being edited, A is not", /bb:ES/.test(s2.editing) && !/ba:[ES]/.test(s2.editing), s2.editing);
  await page.keyboard.type("Q"); await pacedWait(page, 200);
  const txts = await page.evaluate(() => [...document.querySelectorAll(".planyr-anchor")].map((n) => n.textContent));
  ok("a typed letter lands in B at the tap point", /bravQo text|bravoQ text|braQvo text/.test(txts[1]) && txts[0] === "alpha text", JSON.stringify(txts));
  await page.context().close();
}

// 3. Backspace on an EMPTY box removes it on touch (box made by a real double-tap, typed in, emptied)
{
  const page = await open(doc());
  const m = await page.evaluate(() => { const r = document.querySelector('[data-testid="note-mat"]').getBoundingClientRect(); return { x: r.left + r.width * 0.45, y: r.top + r.height * 0.5 }; });
  await page.touchscreen.tap(m.x, m.y); await pacedWait(page, 90); await page.touchscreen.tap(m.x + 8, m.y + 6); await pacedWait(page, 250);
  await page.keyboard.type("a"); await pacedWait(page, 200);
  await page.keyboard.press("Backspace"); await pacedWait(page, 250);
  const n0 = await page.evaluate(() => document.querySelectorAll(".planyr-anchor").length);
  const empty = await page.evaluate(() => document.querySelector(".planyr-anchor")?.getAttribute("data-empty"));
  await page.keyboard.press("Backspace"); await pacedWait(page, 400);
  const n1 = await page.evaluate(() => document.querySelectorAll(".planyr-anchor").length);
  ok("first Backspace only empties the box (it survives)", n0 === 1 && empty === "1", `n=${n0} empty=${empty}`);
  ok("Backspace on the now-EMPTY box removes it on touch", n1 === 0, `${n0} → ${n1}`);
  await page.context().close();
}

// 4. KNOWN-GOOD ARM: desktop mouse, unselected box → stage 1 (box selected, editor blurred, no caret entry)
{
  const page = await open(doc(box("ba", 20, 40, "alpha text"), box("bb", 20, 220, "bravo text")), false);
  const g = await gap(page, "ba", 3);
  await page.mouse.click(g.x, g.y); await pacedWait(page, 250);
  const s = await state(page);
  ok("KNOWN-GOOD: mouse click on an unselected box selects it (stage 1) and blurs the editor", !s.inEditor && /ba:S/.test(s.editing) && !/E/.test(s.editing), JSON.stringify(s));
  await page.mouse.click(g.x, g.y); await pacedWait(page, 250);
  const s2 = await state(page);
  ok("KNOWN-GOOD: the second mouse click enters it (stage 2)", s2.inEditor && /ba:ES/.test(s2.editing), JSON.stringify(s2));
  await page.context().close();
}

await browser.close();
console.log(failures.length ? `\n⛔ ${failures.length} failed` : "\n✓ all WebKit touch box-tap arms pass");
process.exit(failures.length ? 1 : 0);
