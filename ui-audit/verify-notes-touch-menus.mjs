/* verify-notes-touch-menus — NEW-5 (iPhone review 2026-09-29): the page menu and the box menu are
 * reachable on TOUCH. iOS Safari never fires `contextmenu` on a long-press, and tree rows are draggable
 * (a long-press started a drag), so rename / subpage / move / copy / delete a page and delete a box had
 * no touch route at all. B2078592: a box is deleted from the press-and-hold menu ("Delete this box"),
 * never from a floating button — none may render.
 *
 * WHICH ENGINE PROVES WHAT (PHONE-TESTING.md — WebKit has no real touch-hold primitive in Playwright):
 *   • CHROMIUM touch emulation + CDP `Input.dispatchTouchEvent` = a REAL held touch (touchStart, 650 ms,
 *     touchEnd) through the real pipeline — proves the long-press timer, the swallow, and no drag.
 *   • WEBKIT hasTouch+isMobile = real `touchscreen.tap` for the "⋯" button and the box bar, and
 *     dispatched PointerEvents for the hold — proves the same code on WebKit's engine, not a fingertip.
 * Judged on the STORED tree / document, not on what is painted. Known-good arms: the desktop MOUSE
 * context shows no "⋯" and keeps draggable rows + right-click, so the probes can see their absence. */
import { chromium, webkit, devices } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const failures = [];
const ok = (l, c, d) => { console.log(`${c ? "✓" : "⛔"} ${l}${d !== undefined ? ` — ${d}` : ""}`); if (!c) failures.push(l); };
const box = (aid, x, y, text) => ({ type: "noteAnchor", attrs: { x, y, w: 160, h: null, aid },
  content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const DOC = { type: "doc", content: [box("ba", 20, 40, "alpha text"), { type: "paragraph", content: [] }] };
const TREE = { v: 3, tombs: [], trash: [], pages: [
  { id: "p1", title: "First note", createdAt: 1, updatedAt: 1, projectId: null, pages: [] },
  { id: "p2", title: "Second note", createdAt: 2, updatedAt: 2, projectId: null, pages: [] }] };

async function open(browser, engine, touch) {
  const ctx = await browser.newContext(touch ? { ...devices["iPhone 13"] } : { viewport: { width: 1100, height: 800 } });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("   PAGEERROR", String(e.message).slice(0, 160)));
  await assertMeasurable(page, "verify-notes-touch-menus");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  await page.evaluate(([tk, tree, d]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify(tree));
    localStorage.setItem("planyr:notes:page:v1:local:p1", JSON.stringify(d));
    localStorage.setItem("planyr:notes:page:v1:local:p2", JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }));
    localStorage.setItem("planyr:notes:activePage:v1:local", "p1");
  }, [TREE_KEY, TREE, DOC]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await pacedWait(page, 900);
  const cdp = engine === "chromium" && touch ? await ctx.newCDPSession(page) : null;
  return { ctx, page, cdp, engine };
}
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), TREE_KEY);
const showList = async (page) => {
  // On a phone the list is the landing view when no page is open, else behind "‹ Notes".
  const back = page.locator('[data-testid="notes-mobile-back"]').first();
  if (await back.count() && await back.isVisible().catch(() => false)) { await back.click(); await pacedWait(page, 400); }
};
async function hold(env, x, y, ms = 650) {
  const { page, cdp } = env;
  if (cdp) {
    const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
    await send("touchStart", [{ x, y, id: 1 }]); await pacedWait(page, ms); await send("touchEnd", []);
  } else {
    await page.evaluate(([px, py]) => {
      const t = document.elementFromPoint(px, py); window.__held = t;
      t.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 7, pointerType: "touch", isPrimary: true, clientX: px, clientY: py, bubbles: true, cancelable: true, composed: true }));
    }, [x, y]);
    await pacedWait(page, ms);
    await page.evaluate(([px, py]) => {
      const t = window.__held;
      t.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, pointerType: "touch", isPrimary: true, clientX: px, clientY: py, bubbles: true, cancelable: true, composed: true }));
      t.dispatchEvent(new MouseEvent("mousedown", { clientX: px, clientY: py, bubbles: true, cancelable: true }));
      t.dispatchEvent(new MouseEvent("click", { clientX: px, clientY: py, bubbles: true, cancelable: true }));
    }, [x, y]);
  }
  await pacedWait(page, 250);
}
const center = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width * 0.4, y: r.top + r.height / 2, w: r.width, h: r.height }; }, sel);

for (const engine of ["webkit", "chromium"]) {
  const browser = engine === "webkit" ? await webkit.launch({}) : await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const tag = engine === "webkit" ? "WebKit" : "Chromium";

  // ── the "⋯" route (tap) — Rename end to end, judged on the stored tree
  {
    const env = await open(browser, engine, true);
    await showList(env.page);
    const more = await env.page.locator('[data-testid="notes-row-more-p2"]').first().boundingBox({ timeout: 3000 }).catch(() => null);
    ok(`[${tag}] a "⋯" button is on every tree row on touch, a 44 px target`, !!more && more.width >= 44 && more.height >= 44, JSON.stringify(more && { w: more.width, h: more.height }));
    const dr = await env.page.evaluate(() => document.querySelector('[data-testid="notes-row-p2"]').getAttribute("draggable"));
    ok(`[${tag}] on touch the row is not draggable (a long-press is the menu's)`, dr !== "true", `draggable=${dr}`);
    if (!more) { ok(`[${tag}] the "⋯" route exists at all (rename/delete arms skipped — nothing to tap)`, false); await env.ctx.close(); } else {
    await env.page.touchscreen.tap(more.x + more.width / 2, more.y + more.height / 2); await pacedWait(env.page, 350);
    ok(`[${tag}] tapping "⋯" opens the SAME row menu`, await env.page.locator('[data-testid="notes-row-menu"]').count() === 1);
    const items = await env.page.locator('[data-testid^="notes-menu-"]').evaluateAll((n) => n.map((e) => e.textContent));
    ok(`[${tag}] …with Rename, Move…, Make a copy, Export, Print, Save as template and Delete`, ["Rename", "Move…", "Make a copy", "Export to Markdown", "Print / save as PDF", "Save as template…", "Delete"].every((l) => items.some((t) => t.startsWith(l))), items.join(" | "));
    await env.page.locator('[data-testid="notes-menu-rn-p2"]').tap(); await pacedWait(env.page, 350);
    const field = env.page.locator('[data-testid="notes-rename-p2"]');
    await field.fill("Renamed by touch"); await field.press("Enter"); await pacedWait(env.page, 500);
    const t1 = await stored(env.page);
    ok(`[${tag}] Rename from the "⋯" menu works end to end (stored tree)`, t1.pages.find((p) => p.id === "p2")?.title === "Renamed by touch", JSON.stringify(t1.pages.map((p) => p.title)));
    // Delete
    const more2 = await env.page.locator('[data-testid="notes-row-more-p2"]').first().boundingBox();
    await env.page.touchscreen.tap(more2.x + more2.width / 2, more2.y + more2.height / 2); await pacedWait(env.page, 350);
    await env.page.locator('[data-testid="notes-menu-rm-p2"]').tap(); await pacedWait(env.page, 350);
    await env.page.locator('[data-testid="notes-del-p2-yes"]').tap(); await pacedWait(env.page, 600);
    const t2 = await stored(env.page);
    ok(`[${tag}] Delete from the "⋯" menu works end to end (gone from the stored tree, p1 untouched)`, !t2.pages.some((p) => p.id === "p2") && t2.pages.some((p) => p.id === "p1"), JSON.stringify(t2.pages.map((p) => p.id)));
    await env.ctx.close();
    }
  }

  // ── long-press on a row opens the menu, and neither selects nor drags
  {
    const env = await open(browser, engine, true);
    await showList(env.page);
    let dragged = false;
    await env.page.evaluate(() => { window.__drag = 0; document.addEventListener("dragstart", () => { window.__drag += 1; }, true); });
    const c = await center(env.page, '[data-testid="notes-row-p2"]');
    const before = await env.page.evaluate(() => document.querySelector('[data-testid="notes-row-p2"]').getAttribute("aria-selected"));
    await hold(env, c.x, c.y);
    ok(`[${tag}] a long-press on a row opens the row menu`, await env.page.locator('[data-testid="notes-row-menu"]').count() === 1);
    const after = await env.page.evaluate(() => ({ sel: document.querySelector('[data-testid="notes-row-p2"]').getAttribute("aria-selected"), drag: window.__drag, still: !!document.querySelector('[data-testid="notes-list-root"], [data-testid="notes-row-p2"]') }));
    ok(`[${tag}] …it did not select the row, and no drag started`, after.sel === before && after.drag === 0, JSON.stringify(after));
    await env.ctx.close();
  }

  // ── a short press (a tap) is still just a tap: no menu
  {
    const env = await open(browser, engine, true);
    await showList(env.page);
    const c = await center(env.page, '[data-testid="notes-row-p2"]');
    await hold(env, c.x, c.y, 120);
    ok(`[${tag}] a quick press does NOT open the menu`, await env.page.locator('[data-testid="notes-row-menu"]').count() === 0);
    await env.ctx.close();
  }

  // ── a box can be deleted on touch: long-press the box → the same doc menu → "Delete this box"
  {
    const env = await open(browser, engine, true);
    await env.page.waitForSelector(".planyr-anchor", { timeout: 15000 });
    const c = await center(env.page, ".planyr-anchor");
    await hold(env, c.x, c.y);
    ok(`[${tag}] a long-press on a box opens the document menu`, await env.page.locator('[data-testid="note-doc-menu"]').count() === 1);
    const del = env.page.locator('[data-testid="note-menu-delete-box"]');
    ok(`[${tag}] …and it carries "Delete this box"`, await del.count() === 1);
    await del.tap({ timeout: 3000 }).catch(() => {}); await pacedWait(env.page, 1500);
    const n = await env.page.evaluate(() => JSON.parse(localStorage.getItem("planyr:notes:page:v1:local:p1") || "null"));
    ok(`[${tag}] Delete this box removes it (stored document)`, !JSON.stringify(n).includes("noteAnchor"), JSON.stringify(n).slice(0, 120));
    await env.ctx.close();
  }

  // ── NO FLOATING "DELETE BOX" (owner 2026-10-04, B2078592): nothing destructive sits on screen. Checked
  //    selected, editing, and with text typed — and by TEXT as well as by the old test ids, so a renamed
  //    reincarnation cannot slip past.
  {
    const env = await open(browser, engine, true);
    await env.page.waitForSelector(".planyr-anchor", { timeout: 15000 });
    const c = await center(env.page, ".planyr-anchor");
    const gone = async (when) => {
      const n = await env.page.evaluate(() => ({
        ids: document.querySelectorAll('[data-testid="note-touch-box-bar"], [data-testid="note-touch-box-delete"]').length,
        text: [...document.querySelectorAll("button, [role=button], [role=menuitem]")].filter((e) => /^\s*delete\s+(box|\d+\s+boxes)\s*$/i.test(e.textContent || "")).length,
      }));
      ok(`[${tag}] no floating "Delete box" ${when}`, n.ids === 0 && n.text === 0, JSON.stringify(n));
    };
    await gone("before anything is touched");
    await env.page.touchscreen.tap(c.x, c.y); await pacedWait(env.page, 400);
    const sel = await env.page.evaluate(() => ({ selected: !!document.querySelector('.planyr-anchor[data-selected="1"]'), editing: !!document.querySelector('.planyr-anchor[data-editing="1"]') }));
    ok(`[${tag}] KNOWN-GOOD: the tap really selected/entered the box (so the absence below means something)`, sel.selected, JSON.stringify(sel));
    await gone("with the box selected");
    await env.page.keyboard.type("hi"); await pacedWait(env.page, 300);
    await gone("while typing in the box");
    await env.ctx.close();
  }

  // ── press-and-hold INSIDE the box you are typing in: the same document menu, no drag, keyboard kept
  {
    const env = await open(browser, engine, true);
    await env.page.waitForSelector(".planyr-anchor", { timeout: 15000 });
    await env.page.evaluate(() => { window.__drag = 0; document.addEventListener("dragstart", () => { window.__drag += 1; }, true); });
    const c = await center(env.page, ".planyr-anchor");
    await env.page.touchscreen.tap(c.x, c.y); await pacedWait(env.page, 400);
    await env.page.keyboard.type("Z"); await pacedWait(env.page, 400);
    const read = () => env.page.evaluate(() => {
      const a = document.querySelector(".planyr-anchor");
      const d = JSON.parse(localStorage.getItem("planyr:notes:page:v1:local:p1") || "null");
      const n = d?.content?.find((x) => x.type === "noteAnchor");
      return { focusInEditor: !!document.activeElement?.closest?.(".ProseMirror"), editing: a?.getAttribute("data-editing") === "1", sel: a?.getAttribute("data-selected") === "1", x: n?.attrs?.x, y: n?.attrs?.y, drag: window.__drag };
    });
    const before = await read();
    ok(`[${tag}] KNOWN-GOOD: typing in the box put focus in the editor`, before.focusInEditor && before.editing, JSON.stringify(before));
    const c2 = await center(env.page, ".planyr-anchor .planyr-anchor-content");
    await hold(env, c2.x, c2.y);
    ok(`[${tag}] press-and-hold inside the box you are typing in opens the document menu`, await env.page.locator('[data-testid="note-doc-menu"]').count() === 1);
    const del = env.page.locator('[data-testid="note-menu-delete-box"]');
    ok(`[${tag}] …and it carries "Delete this box" (the existing row — no second menu)`, await del.count() === 1);
    const mid = await read();
    ok(`[${tag}] …no drag started and the box did not move`, mid.drag === 0 && mid.x === before.x && mid.y === before.y, JSON.stringify({ before, mid }));
    ok(`[${tag}] …the keyboard state is KEPT (focus stays in the editor, box still being edited)`, mid.focusInEditor && mid.editing, JSON.stringify(mid));
    await del.tap({ timeout: 3000 }).catch(() => {}); await pacedWait(env.page, 1500);
    const n = await env.page.evaluate(() => JSON.parse(localStorage.getItem("planyr:notes:page:v1:local:p1") || "null"));
    ok(`[${tag}] choosing Delete this box removes it (stored document)`, !JSON.stringify(n).includes("noteAnchor"), JSON.stringify(n).slice(0, 100));
    await env.ctx.close();
  }

  // ── a LONG hold (finger down well past the menu opening): the lift's synthesised mousedown/click land ON the
  //    menu and must neither run the row under the finger nor drop the keyboard
  {
    const env = await open(browser, engine, true);
    await env.page.waitForSelector(".planyr-anchor", { timeout: 15000 });
    const c = await center(env.page, ".planyr-anchor .planyr-anchor-content");
    await env.page.touchscreen.tap(c.x, c.y); await pacedWait(env.page, 400);
    await env.page.keyboard.type("Q"); await pacedWait(env.page, 300);
    const docBefore = await env.page.evaluate(() => localStorage.getItem("planyr:notes:page:v1:local:p1"));
    await hold(env, c.x, c.y, 1400);
    const st = await env.page.evaluate(() => ({ menu: !!document.querySelector('[data-testid="note-doc-menu"]'), focusInEditor: !!document.activeElement?.closest?.(".ProseMirror"), doc: localStorage.getItem("planyr:notes:page:v1:local:p1") }));
    ok(`[${tag}] a 1.4 s hold: the menu is open after the lift (no row was triggered by the lift)`, st.menu);
    ok(`[${tag}] …the box is intact and the keyboard state is kept`, st.focusInEditor && /noteAnchor/.test(st.doc || ""), JSON.stringify({ focusInEditor: st.focusInEditor, hadAnchor: /noteAnchor/.test(st.doc || "") }));
    await env.ctx.close();
  }

  // ── KNOWN-GOOD: desktop mouse — no "⋯", draggable rows, right-click still opens the menu
  if (engine === "chromium") {
    const env = await open(browser, engine, false);
    ok(`KNOWN-GOOD: desktop shows no "⋯" button`, await env.page.locator('[data-testid^="notes-row-more-"]').count() === 0);
    const dr = await env.page.evaluate(() => document.querySelector('[data-testid="notes-row-p2"]').getAttribute("draggable"));
    ok(`KNOWN-GOOD: desktop rows are still draggable (drag-to-nest unchanged)`, dr === "true", `draggable=${dr}`);
    await env.page.locator('[data-testid="notes-row-p2"]').click({ button: "right" }); await pacedWait(env.page, 300);
    ok(`KNOWN-GOOD: desktop right-click on a row still opens the menu`, await env.page.locator('[data-testid="notes-row-menu"]').count() === 1);
    await env.page.keyboard.press("Escape");
    const c = await center(env.page, ".planyr-anchor");
    await env.page.mouse.click(c.x, c.y, { button: "right" }); await pacedWait(env.page, 300);
    ok(`KNOWN-GOOD: desktop right-click on a box still opens the document menu`, await env.page.locator('[data-testid="note-doc-menu"]').count() === 1);
    ok(`KNOWN-GOOD: desktop shows no floating "Delete box" either`, await env.page.locator('[data-testid="note-touch-box-bar"]').count() === 0);
    await env.ctx.close();
  }
  await browser.close();
}
console.log(failures.length ? `\n⛔ ${failures.length} failed` : "\n✓ all touch-menu arms pass");
process.exit(failures.length ? 1 : 0);
