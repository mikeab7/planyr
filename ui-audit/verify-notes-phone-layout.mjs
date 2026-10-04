/* verify-notes-phone-layout — NEW-6 (iPhone review 2026-09-29): the keyboard hides what you are typing and the
 * chrome eats the screen. Five linked phone-layout problems:
 *   (a) caret under the keyboard   (b) one 1290 px sideways toolbar row   (c) header + toolbar = 136 px
 *   (d) finger-sized targets, pill/help out of the writing area   (e) tooltips stuck after a tap.
 *
 * ENGINE: WebKit, hasTouch + isMobile at 390x844 (reported as "WebKit", never "iPhone"). WebKit headless has NO
 * soft keyboard, so (a) installs a controllable FAKE `window.visualViewport` (an EventTarget with a settable
 * height) BEFORE the app loads and shrinks it to 400 px — the same shape iOS reports with the keyboard up
 * (layout viewport unchanged, visual viewport short). That proves the app's arithmetic and wiring; it does NOT
 * prove a real keyboard — V1484661. Known-good arms: desktop (Chromium, hover mouse) keeps the long toolbar row
 * byte-for-byte, shows tooltips on hover, keeps 26 px zoom buttons, and its caret behaves as before. */
import { chromium, webkit, devices } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const COMPARE_BASE = process.env.COMPARE_BASE || "";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const failures = [];
const ok = (l, c, d) => { console.log(`${c ? "✓" : "⛔"} ${l}${d !== undefined ? ` — ${d}` : ""}`); if (!c) failures.push(l); };
const box = (aid, x, y, text) => ({ type: "noteAnchor", attrs: { x, y, w: 160, h: null, aid },
  content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const P = (t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] });
const DOC = { type: "doc", content: [box("ba", 20, 40, "alpha text"), P("flow line")] };
const LONG = { type: "doc", content: Array.from({ length: 70 }, (_, i) => P(`line number ${i}`)) };

async function open(browser, { touch, doc = DOC, fakeVV = false, base = BASE, viewport } = {}) {
  const ctx = await browser.newContext(touch ? { ...devices["iPhone 13"], ...(viewport ? { viewport } : {}) } : { viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((fake) => {
    window.__PLANYR_E2E = true;
    if (fake) {
      const t = new EventTarget();
      const vv = { width: window.innerWidth, height: window.innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1,
        addEventListener: (...a) => t.addEventListener(...a), removeEventListener: (...a) => t.removeEventListener(...a) };
      window.__fakeVV = { set(h) { vv.height = h; t.dispatchEvent(new Event("resize")); }, vv };
      Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    }
  }, fakeVV);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("   PAGEERROR", String(e.message).slice(0, 160)));
  await assertMeasurable(page, "verify-notes-phone-layout");
  await page.goto(`${base}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  await page.evaluate(([d]) => {
    localStorage.clear();
    localStorage.setItem("planyr:notes:tree:v1:local", JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "T", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem("planyr:notes:page:v1:local:p1", JSON.stringify(d));
    localStorage.setItem("planyr:notes:activePage:v1:local", "p1");
  }, [doc]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 30000 });
  await pacedWait(page, 1000);
  return { ctx, page };
}
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
const caretRect = (page) => page.evaluate(() => { const s = getSelection(); if (!s.rangeCount) return null; const r = s.getRangeAt(0).cloneRange(); r.collapse(true); let b = r.getBoundingClientRect(); if (!b || (b.width === 0 && b.height === 0)) { const n = s.anchorNode?.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode; b = n?.getBoundingClientRect(); } return b ? { top: b.top, bottom: b.bottom } : null; });

const wk = await webkit.launch({});

// ── (b) the essentials fit on one row, no swiping
{
  const { ctx, page } = await open(wk, { touch: true });
  const ids = ["nt-undo", "nt-redo", "nt-bold", "nt-italic", "nt-underline", "nt-bullet", "nt-ordered", "nt-color", "nt-more"];
  const rs = await Promise.all(ids.map((i) => rect(page, `[data-testid="${i}"]`)));
  const vw = 390;
  ok("(b) every essential control is on screen at once — undo, redo, B, I, U, bullet, numbered, colour, More", rs.every((r) => r && r.l >= 0 && r.r <= vw), rs.map((r, i) => `${ids[i].slice(3)}@${r ? Math.round(r.l) : "—"}`).join(" "));
  const sc = await page.evaluate(() => { const e = document.querySelector('[data-testid="note-toolbar"]'); return { sw: e.scrollWidth, cw: e.clientWidth }; });
  ok("(b) the bar does not scroll sideways at all (nothing hidden behind a swipe)", sc.sw <= sc.cw + 1, JSON.stringify(sc));
  ok("(b) the essentials are at least a thumb tall", rs.every((r) => r && r.h >= 44), `min height ${Math.min(...rs.map((r) => (r ? r.h : 0)))}`);
  ok("(b) the long controls are NOT on the bar (font picker, size, align, link)", (await page.locator('[data-testid="note-toolbar-essentials"] [data-testid="nt-font"]').count()) === 0);
  await page.locator('[data-testid="nt-more"]').tap({ timeout: 2000 }).catch(() => {}); await pacedWait(page, 400);
  const more = await rect(page, '[data-testid="note-toolbar-more"]');
  ok("(b) More opens a panel under the bar, wholly on screen", !!more && more.l >= 0 && more.r <= vw && more.b <= 844, JSON.stringify(more && { t: Math.round(more.t), b: Math.round(more.b) }));
  const present = await Promise.all(["nt-block", "nt-font", "nt-size", "nt-strike", "nt-highlight", "nt-task", "nt-outdent", "nt-indent", "nt-insert-plus", "nt-arrow", "nt-page-find", "nt-page-setup", "nt-page-history", "nt-page-export"].map((i) => page.locator(`[data-testid="${i}"]`).count()));
  ok("(b) …and carries everything else, incl. the page actions", present.every((n) => n >= 1), present.join(","));
  await page.locator('[data-testid="nt-page-find"]').tap({ timeout: 2000 }).catch(() => {}); await pacedWait(page, 500);
  ok("(c) Find and replace is reachable from More (page action works)", (await page.locator('[data-testid="note-find-replace-bar"]').count()) === 1);
  ok("(b) picking a page action closes the panel", (await page.locator('[data-testid="note-toolbar-more"]').count()) === 0);
  await ctx.close();
}

// ── (c)+(d) collapse while typing; pill + help out of the way; no jump
{
  const { ctx, page } = await open(wk, { touch: true });
  const row2 = async () => page.evaluate(() => { const e = document.querySelector("[data-header-row2]"); return e ? getComputedStyle(e).display : "absent"; });
  const pill = () => page.evaluate(() => { const e = document.querySelector('[data-testid="note-zoom-pill"]'); return e ? getComputedStyle(e).display : "absent"; });
  const fab = () => page.evaluate(() => { const e = document.querySelector('[data-testid="help-report-fab"]'); return e ? getComputedStyle(e).display : "absent"; });
  ok("(c) idle: the module-tab row, the zoom pill and the help button are all showing", (await row2()) !== "none" && (await pill()) !== "none" && (await fab()) !== "none", `${await row2()}/${await pill()}/${await fab()}`);
  const topBefore = (await rect(page, '[data-testid="note-mat"]')).t;
  const boxBefore = (await rect(page, ".planyr-anchor")).t;
  const sheetBefore = (await rect(page, '[data-testid="note-sheet"]')).t;
  await page.evaluate(() => window.__noteEditor.caretAt(window.__noteEditor.startOf([1]) ?? 1)); await pacedWait(page, 500);
  const typing = await page.evaluate(() => document.documentElement.dataset.notesTyping);
  ok("(c) focusing the editor on a phone marks the page as typing", typing === "1");
  ok("(c) …the module-tab row collapses", (await row2()) === "none");
  ok("(d) …and the zoom pill and the help button leave the writing area", (await pill()) === "none" && (await fab()) === "none");
  const topAfter = (await rect(page, '[data-testid="note-mat"]')).t;
  const sheetAfter = (await rect(page, '[data-testid="note-sheet"]')).t;
  ok("(c) the canvas gained the room (its top edge moved up)", topAfter < topBefore - 20, `${Math.round(topBefore)} → ${Math.round(topAfter)}`);
  ok("(c) VIEWPORT-STABLE: the page did not jump under the finger when the row collapsed", Math.abs(sheetAfter - sheetBefore) <= 1.5, `sheet top ${sheetBefore.toFixed(1)} → ${sheetAfter.toFixed(1)}`);
  await page.evaluate(() => document.activeElement?.blur()); await pacedWait(page, 500);
  const back = await page.evaluate(() => document.documentElement.dataset.notesTyping || "");
  ok("(c) blur brings the row back", back === "" && (await row2()) !== "none");
  await ctx.close();
}

// ── (a) the caret stays above the keyboard (fake visual viewport, 400 px tall)
{
  const { ctx, page } = await open(wk, { touch: true, doc: LONG, fakeVV: true });
  await page.evaluate(() => window.__fakeVV.set(400)); await pacedWait(page, 200);
  await page.evaluate(() => { const h = window.__noteEditor; h.caretAt(h.startOf([40]) ?? 1); }); await pacedWait(page, 700);
  const KB = 400; const PAD = 24;
  let c = await caretRect(page);
  ok("(a) a caret placed far down is panned above the keyboard line without a keystroke", !!c && c.bottom <= KB + 1 && c.top >= 0, JSON.stringify(c && { top: Math.round(c.top), bottom: Math.round(c.bottom) }));
  let worst = 0; let lowest = 0;
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.type(`typed line ${i}`); await page.keyboard.press("Enter"); await pacedWait(page, 120);
    c = await caretRect(page);
    if (c) { lowest = Math.max(lowest, c.bottom); worst = Math.max(worst, c.bottom - KB); }
  }
  ok("(a) typing 10 lines: the caret never goes below the keyboard line", worst <= 1, `lowest caret bottom ${Math.round(lowest)} vs keyboard at ${KB}`);
  await page.evaluate(() => window.__fakeVV.set(844)); await pacedWait(page, 300);
  await ctx.close();
}

// ── (d) finger-sized targets; (e) no stuck tooltip
{
  const { ctx, page } = await open(wk, { touch: true });
  const z = await Promise.all(["note-zoom-out", "note-zoom-in"].map((i) => rect(page, `[data-testid="${i}"]`)));
  ok("(d) zoom − / + are at least 44 px on a coarse pointer", z.every((r) => r && r.w >= 44 && r.h >= 44), z.map((r) => r && `${Math.round(r.w)}x${Math.round(r.h)}`).join(" "));
  await page.locator(".planyr-anchor").first().tap(); await pacedWait(page, 400);
  const g = await page.evaluate(() => { const gr = document.querySelector(".planyr-anchor-grip"); if (!gr) return null; const r = gr.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; const probe = (x, y) => !!document.elementFromPoint(x, y)?.closest?.(".planyr-anchor-grip"); return { w: r.width, h: r.height, inside: probe(cx, cy), farUp: probe(cx, cy - 18), farSide: probe(cx - 18, cy), outside: probe(cx, cy - 40) }; });
  ok("(d) the box grip's visible size is unchanged (small) …", !!g && g.w <= 14 && g.h <= 22, JSON.stringify(g && { w: g.w, h: g.h }));
  ok("(d) …but a finger 18 px off (above / left, away from the text) still hits it (44 px invisible hit area), 40 px off does not", !!g && g.inside && g.farUp && g.farSide && !g.outside, JSON.stringify(g));
  await page.locator('[data-testid="nt-bold"]').tap(); await pacedWait(page, 500);
  ok("(e) tapping a toolbar button leaves NO tooltip stuck on screen", (await page.locator('[role="tooltip"]').count()) === 0);
  await ctx.close();
}
await wk.close();

// ── known-good: desktop unchanged
const ch = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
{
  const { ctx, page } = await open(ch, { touch: false });
  const mine = await page.evaluate(() => document.querySelector('[data-testid="note-toolbar"]').outerHTML.replace(/\s+/g, " "));
  const long = await page.evaluate(() => { const e = document.querySelector('[data-testid="note-toolbar"]'); return { narrow: e.getAttribute("data-narrow"), more: !!document.querySelector('[data-testid="nt-more"]'), font: !!document.querySelector('[data-testid="nt-font"]') }; });
  ok("KNOWN-GOOD: desktop keeps the full toolbar (font picker on the bar, no More button)", long.narrow === "0" && long.font && !long.more, JSON.stringify(long));
  await page.locator('[data-testid="nt-bold"]').hover(); await pacedWait(page, 300);
  ok("KNOWN-GOOD: desktop still shows a tooltip on hover", (await page.locator('[role="tooltip"]').count()) >= 1);
  const z = await rect(page, '[data-testid="note-zoom-out"]');
  ok("KNOWN-GOOD: desktop zoom buttons stay 26 px", z && Math.round(z.w) === 26, `${z && Math.round(z.w)}`);
  await page.evaluate(() => window.__noteEditor.caretAt(1)); await pacedWait(page, 300);
  ok("KNOWN-GOOD: desktop focus does not collapse the module-tab row", (await page.evaluate(() => document.documentElement.dataset.notesTyping || "")) === "");
  if (COMPARE_BASE) {
    const other = await open(ch, { touch: false, base: COMPARE_BASE });
    const theirs = await other.page.evaluate(() => document.querySelector('[data-testid="note-toolbar"]').outerHTML.replace(/\s+/g, " "));
    ok("KNOWN-GOOD: the desktop toolbar's DOM is byte-identical to untouched main", mine === theirs, mine === theirs ? `${mine.length} chars` : `${mine.length} vs ${theirs.length}`);
    await other.ctx.close();
  }
  await ctx.close();
}
await ch.close();
console.log(failures.length ? `\n⛔ ${failures.length} failed` : "\n✓ all phone-layout arms pass");
process.exit(failures.length ? 1 : 0);
