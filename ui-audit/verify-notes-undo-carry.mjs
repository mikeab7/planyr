#!/usr/bin/env node
/* verify-notes-undo-carry — EACH NOTES PAGE KEEPS ITS OWN UNDO HISTORY WHEN YOU SWITCH PAGES (NEW-1, owner 2026-11-13:
 * "even if I go to an old page or a page I wasn't on in a minute").
 *
 * Drives, in a real browser, with the real keyboard and mouse, on a seeded two-page notebook (a throwaway: local storage, never a real plan):
 *   a  type on A → open B → back to A → Ctrl+Z undoes the typing (and again for an earlier step; redo brings it back)
 *   b  drag a box on A → open B → back → Ctrl+Z puts the box back where it was
 *   c  B's own typing and A's own typing: Ctrl+Z on B never touches A, and each page undoes only its own steps, in order
 *   d  A is changed behind the editor while away (another tab / a version restore / the sync) → the saved history is DISCARDED
 *      (nothing to undo, and the changed text is what shows) — never replayed onto a different document
 *   e  a box DELETE and a PASTE (the existing Notes undo steps) still undo after a round trip
 *   f  typing after coming back is its own step; the old ones are still under it
 *   g  a reload empties the history (stated limit: in memory only), and the page the reload shows is untouched
 * ⛔ THE INSTRUMENT IS ON TRIAL FIRST (DRIVER / KNOWN-GOOD ARM): on ONE page, with no switch, typing then Ctrl+Z MUST undo it and a box drag
 * MUST register as an undo step — else the harness cannot see undo and the run is VOID. A box border must resolve to the move band or VOID.
 * Red on unmodified main (a, b, c, e, f fail: after the switch there is nothing to undo); mutation: neutralise the restore → red again.
 * `BASE_URL` (default http://127.0.0.1:5199) · `PW_CHROME`. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5199";
const EXEC = process.env.PW_CHROME || undefined;
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE = (id) => `planyr:notes:page:v1:local:${id}`;

const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await assertMeasurable(page, "verify-notes-undo-carry");
let passN = 0; let failN = 0;
const ok = (label, cond, detail = "") => { if (cond) { passN += 1; console.log(`  ✓ ${label}`); } else { failN += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`); } };
const void_ = async (why) => { console.log("page errors:", JSON.stringify(errs)); console.log(`\nVOID: ${why}`); await browser.close(); process.exit(2); };
const wait = (ms) => pacedWait(page, ms);

const para = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const box = (aid, x, y, lines) => ({ type: "noteAnchor", attrs: { x, y, w: 460, h: null, aid }, content: lines.map(para) });
const docA = () => ({ type: "doc", content: [box("a1", 40, 40, ["Alpha line one"]), para("")] });
const docB = () => ({ type: "doc", content: [box("b1", 40, 40, ["Bravo line one"]), para("")] });

const live = () => page.evaluate(() => window.__noteEditor && window.__noteEditor.doc());
const depth = () => page.evaluate(() => (window.__noteEditor ? window.__noteEditor.undoDepth() : null));
const stored = (id) => page.evaluate((k) => { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }, PAGE(id));
const boxesOf = (d) => ((d && d.content) || []).filter((n) => n.type === "noteAnchor");
const textOf = (d) => JSON.stringify(d || {}).match(/"text":"([^"]*)"/g)?.map((m) => m.slice(8, -1)).join("|") || "";
const firstBoxText = (d) => { const b = boxesOf(d)[0]; return b ? (b.content || []).map((p) => (p.content || []).map((t) => t.text || "").join("")).join("\n") : null; };
const firstBoxAt = (d) => { const b = boxesOf(d)[0]; return b ? { x: b.attrs.x, y: b.attrs.y } : null; };
const near = (a, b, tol = 1.5) => a && b && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

async function seed() {
  await page.goto("about:blank");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([tk, pa, pb, da, db]) => {
    localStorage.clear();
    localStorage.setItem("planyr.theme", "light");
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [
      { id: "p1", title: "Page A", createdAt: 1, updatedAt: 1, projectId: null, pages: [] },
      { id: "p2", title: "Page B", createdAt: 1, updatedAt: 1, projectId: null, pages: [] },
    ] }));
    localStorage.setItem(pa, JSON.stringify(da));
    localStorage.setItem(pb, JSON.stringify(db));
  }, [TREE_KEY, PAGE("p1"), PAGE("p2"), docA(), docB()]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await openPage("p1", "Alpha");
}
async function openPage(id, marker) {
  await page.waitForSelector(`[data-testid="notes-row-${id}"]`, { timeout: 20000 });
  await page.click(`[data-testid="notes-row-${id}"]`);
  if (marker == null) { await wait(1400); return; }          // a page whose content was deleted: nothing to wait for but the swap
  for (let i = 0; i < 60; i += 1) {
    const d = await live();
    if (d && textOf(d).includes(marker)) break;
    await wait(150);
  }
  await wait(500);
  const d = await live();
  if (!d || !textOf(d).includes(marker)) await void_(`page ${id} never showed "${marker}" (live: ${JSON.stringify(d).slice(0, 160)})`);
}
/** Two real presses on the box's first word: select, then enter. */
async function enterBox() {
  for (let i = 0; i < 2; i += 1) {
    const p = await page.evaluate(() => {
      const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
      const n = w.nextNode(); const r = document.createRange(); r.setStart(n, 1); r.collapse(true);
      const b = r.getBoundingClientRect(); return { x: Math.round(b.left) + 1, y: Math.round(b.top + b.height / 2) };
    });
    await page.mouse.click(p.x, p.y); await wait(i ? 250 : 600);
  }
}
/** Type `text` at the end of the first line of the first box, as the person would. */
async function typeAtEnd(text) {
  await enterBox();                                   // the caret is now inside the box's paragraph
  await page.keyboard.press("End"); await wait(80);
  const at = await page.evaluate(() => window.__noteEditor.selection());
  if (!at || at.from < 2) await void_(`the caret is not inside the box (${JSON.stringify(at)})`);
  await page.keyboard.type(text, { delay: 18 });
  await wait(700);                                    // longer than the save debounce AND the undo grouping window
}
const focusBody = async () => { await page.focus('[data-testid="note-body"]'); await wait(100); };
const undoKey = async () => { await focusBody(); await page.keyboard.press("Control+z"); await wait(350); };
const redoKey = async () => { await focusBody(); await page.keyboard.press("Control+y"); await wait(350); };
const topBandPoint = () => page.evaluate(() => {
  const b = document.querySelector('[data-testid="note-anchor"]'); const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 0.5) };
});
const isMoveBand = (x, y) => page.evaluate(([px, py]) => { const el = document.elementFromPoint(px, py); return !!(el && el.closest(".planyr-anchor-edge")); }, [x, y]);
async function dragBox(dx, dy) {
  const p = await topBandPoint();
  if (!(await isMoveBand(p.x, p.y))) await void_("the box's top border does not resolve to the move band — the harness cannot drag a box");
  await page.mouse.move(p.x, p.y); await wait(80);
  await page.mouse.down();
  await page.mouse.move(p.x + dx / 2, p.y + dy / 2, { steps: 6 }); await wait(60);
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 6 }); await wait(60);
  await page.mouse.up(); await wait(900);
}
async function roundTrip(awayTo = "p2", awayMarker = "Bravo", back = "p1", backMarker = "Alpha") {
  await openPage(awayTo, awayMarker);
  await openPage(back, backMarker);
}
const scaleOfView = () => page.evaluate(() => { const d = document.querySelector('[data-testid="note-body"]'); const r = d.getBoundingClientRect(); return r.width / (d.offsetWidth || 1) || 1; });

/* ───────────────────────────────── KNOWN-GOOD ARMS ───────────────────────────────── */
console.log("\n=== KNOWN-GOOD ARM — on ONE page with no switch, typing and a box drag are undoable with the real keys ===");
await seed();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
const pristine = await live();
await typeAtEnd(" TYPED");
const afterType = await live();
if (!firstBoxText(afterType)?.includes("TYPED")) await void_(`typing did not reach the box (${firstBoxText(afterType)})`);
if ((await depth()) < 1) await void_("typing produced no undo step — the harness cannot see undo");
await undoKey();
if (firstBoxText(await live()) !== firstBoxText(pristine)) await void_(`Ctrl+Z on the same page did not undo the typing (${firstBoxText(await live())}) — the harness cannot judge undo`);
ok("the instrument sees Ctrl+Z undo typing on one page (no switch)", true);
const dBefore = await depth();
const scale = await scaleOfView();
await dragBox(70, 50);
const moved = firstBoxAt(await live());
const startAt = firstBoxAt(pristine);
if (near(moved, startAt, 2)) await void_("a real drag from the border did not move the box");
if ((await depth()) <= dBefore) await void_("the box drag registered no undo step — the harness cannot judge a box-move undo");
ok(`the instrument sees a box drag as an undo step (moved ${Math.round(moved.x - startAt.x)},${Math.round(moved.y - startAt.y)}; scale ${scale.toFixed(2)})`, true);
await undoKey();
ok("…and Ctrl+Z puts the box back on one page", near(firstBoxAt(await live()), startAt, 2), JSON.stringify(firstBoxAt(await live())));

/* ───────────────────────────────── a · typing ───────────────────────────────── */
console.log("\n=== a · type on A → open B → back to A → Ctrl+Z undoes the typing ===");
await seed();
const a0 = await live();
await typeAtEnd(" ONE");
await typeAtEnd(" TWO");
const aTyped = await live();
ok("A holds both typed bits before leaving", /ONE/.test(firstBoxText(aTyped)) && /TWO/.test(firstBoxText(aTyped)), firstBoxText(aTyped));
const depthBefore = await depth();
await roundTrip();
const aBack = await live();
ok("back on A the document is exactly what was left (saved + reopened)", JSON.stringify(aBack) === JSON.stringify(aTyped), `${firstBoxText(aBack)}`);
ok("back on A the undo history is carried (undo depth is what it was)", (await depth()) === depthBefore, `${depthBefore} → ${await depth()}`);
await undoKey();
ok("Ctrl+Z undoes the LAST typing (TWO)", !/TWO/.test(firstBoxText(await live())) && /ONE/.test(firstBoxText(await live())), firstBoxText(await live()));
await undoKey();
ok("Ctrl+Z again undoes ONE — back to the original text", firstBoxText(await live()) === firstBoxText(a0), firstBoxText(await live()));
await redoKey();
ok("redo brings ONE back (the redo stack was carried too)", /ONE/.test(firstBoxText(await live())) && !/TWO/.test(firstBoxText(await live())), firstBoxText(await live()));
await undoKey();

/* ───────────────────────────────── b · box move ───────────────────────────────── */
console.log("\n=== b · drag a box on A → open B → back → Ctrl+Z puts the box back ===");
await seed();
const b0 = firstBoxAt(await live());
await dragBox(80, 60);
const bMoved = firstBoxAt(await live());
ok("the box moved", !near(bMoved, b0, 2), JSON.stringify([b0, bMoved]));
await roundTrip();
ok("back on A the box is where it was left", near(firstBoxAt(await live()), bMoved, 1.5), JSON.stringify(firstBoxAt(await live())));
await undoKey();
ok("Ctrl+Z puts the box back where it started", near(firstBoxAt(await live()), b0, 2), JSON.stringify(firstBoxAt(await live())));

/* ───────────────────────────────── c · per page ───────────────────────────────── */
console.log("\n=== c · each page undoes only its OWN steps ===");
await seed();
await typeAtEnd(" AAA");
await openPage("p2", "Bravo");
await typeAtEnd(" BBB");
const bTyped = await live();
await openPage("p1", "Alpha");
ok("A: its history is its own (one step, from the AAA typing)", (await depth()) === 1, `depth ${await depth()}`);
await openPage("p2", "Bravo");
ok("B: its history is its own (one step, from the BBB typing)", (await depth()) === 1, `depth ${await depth()}`);
await undoKey();
ok("Ctrl+Z on B removes BBB", !/BBB/.test(firstBoxText(await live())) && /Bravo/.test(firstBoxText(await live())), firstBoxText(await live()));
await openPage("p1", "Alpha");
ok("…and A is untouched by it (still has AAA)", /AAA/.test(firstBoxText(await live())), firstBoxText(await live()));
await undoKey();
ok("Ctrl+Z on A removes AAA", !/AAA/.test(firstBoxText(await live())), firstBoxText(await live()));
await openPage("p2", "Bravo");
ok("…and B (already undone) has nothing left to undo, and A's undo did not leak into it", (await depth()) === 0 && !/AAA/.test(firstBoxText(await live())), `depth ${await depth()}`);
void bTyped;

/* ───────────────────────────────── d · stale guard ───────────────────────────────── */
console.log("\n=== d · A changed while away (another tab / computer / version restore / conflict choice) → saved history discarded ===");
await seed();
await typeAtEnd(" MINE");
await openPage("p2", "Bravo");
await wait(900);
const fromElsewhere = await stored("p1");
boxesOf(fromElsewhere)[0].content[0].content[0].text += " ELSEWHERE";
await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [PAGE("p1"), fromElsewhere]);
await openPage("p1", "ELSEWHERE");
ok("A opens with the text that was changed elsewhere", /ELSEWHERE/.test(firstBoxText(await live())), firstBoxText(await live()));
ok("…and its saved undo history was DISCARDED (nothing to undo)", (await depth()) === 0, `depth ${await depth()}`);
await undoKey();
ok("Ctrl+Z does nothing (never replays the old history onto the different text)", /ELSEWHERE/.test(firstBoxText(await live())) && /MINE/.test(firstBoxText(await live())), firstBoxText(await live()));

/* ───────────────────────────────── e · delete + paste ───────────────────────────────── */
console.log("\n=== e · a box DELETE and a PASTE still undo after a round trip ===");
await seed();
const e0 = await live();
{ // delete: select the box by its border, press Delete
  const p = await topBandPoint();
  await page.mouse.click(p.x, p.y); await wait(500);
  await page.keyboard.press("Delete"); await wait(900);
  ok("the box was deleted", boxesOf(await live()).length === 0, JSON.stringify(await live()).slice(0, 200));
  await roundTrip("p2", "Bravo", "p1", null);
  ok("back on A the box is still gone and the delete is an undo step", boxesOf(await live()).length === 0 && (await depth()) >= 1, `depth ${await depth()}`);
  await undoKey();
  ok("Ctrl+Z brings the box back, text and all", boxesOf(await live()).length === 1 && firstBoxText(await live()) === firstBoxText(e0), firstBoxText(await live()));
}
{ // paste into the box (a fresh page: the previous step left the box in a different select/enter state)
  await seed();
  await enterBox();
  await page.keyboard.press("End"); await wait(100);
  const selNow = await page.evaluate(() => window.__noteEditor.selection());
  if (!selNow || selNow.from < 2) await void_(`the caret is not inside the box (${JSON.stringify(selNow)}) — a paste would land outside it`);
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.setData("text/plain", " PASTED");
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await wait(1200);
  ok("the paste landed in the box", /PASTED/.test(firstBoxText(await live())), firstBoxText(await live()));
  const dPaste = await depth();
  await roundTrip();
  ok("back on A the paste is still there with its undo step", /PASTED/.test(firstBoxText(await live())) && (await depth()) === dPaste, `depth ${dPaste} → ${await depth()}`);
  await undoKey();
  ok("Ctrl+Z takes the paste out in one step", !/PASTED/.test(firstBoxText(await live())) && /Alpha/.test(firstBoxText(await live())), firstBoxText(await live()));
}

/* ───────────────────────────────── f · new typing after returning ───────────────────────────────── */
console.log("\n=== f · typing after coming back is its own step, the old steps are still under it ===");
await seed();
await typeAtEnd(" OLD");
await roundTrip();
await typeAtEnd(" NEW");
ok("two steps now (the old one and the new one)", (await depth()) === 2, `depth ${await depth()}`);
await undoKey();
ok("Ctrl+Z removes only NEW", /OLD/.test(firstBoxText(await live())) && !/NEW/.test(firstBoxText(await live())), firstBoxText(await live()));
await undoKey();
ok("Ctrl+Z again removes OLD (it survived the switch under the new edit)", !/OLD/.test(firstBoxText(await live())), firstBoxText(await live()));

/* ───────────────────────────────── g · reload ───────────────────────────────── */
console.log("\n=== g · a reload empties the history (in memory only — stated limit) and leaves the page alone ===");
await seed();
await typeAtEnd(" BEFORE-RELOAD");
await roundTrip();
const savedBefore = await stored("p1");
await page.reload({ waitUntil: "domcontentloaded" });
await openPage("p1", "BEFORE-RELOAD");
ok("after a reload there is nothing to undo", (await depth()) === 0, `depth ${await depth()}`);
await undoKey();
ok("…and Ctrl+Z leaves the saved text alone", JSON.stringify(await stored("p1")) === JSON.stringify(savedBefore) && /BEFORE-RELOAD/.test(firstBoxText(await live())));

console.log(`\npage errors: ${JSON.stringify(errs)}`);
ok("no page errors", errs.length === 0, JSON.stringify(errs));
console.log(`\n${passN} passed, ${failN} failed`);
await browser.close();
process.exit(failN ? 1 : 0);
