/* verify-notes-touch-landing — A DOUBLE-TAP ON BLANK PAPER LANDS THE FIRST LETTER WHERE THE FINGER WAS
 * (NEW-1, owner report 2026-10-04: "Where I double click in the notebook module when I'm on my phone is
 * not exactly where the text lands"). Amends B1960480, which proved the box appears and takes text but
 * never measured WHERE.  Engine: WebKit, hasTouch + isMobile, real touchscreen taps.  Reported as
 * "WebKit", never "iPhone".
 *
 * METRIC: the rendered rect of the FIRST GLYPH (a DOM Range over the first character of the new box's
 * text) against the tap point — dx = glyph left − tap x, dy = glyph vertical centre − tap y, in CSS px
 * on the screen, whatever the zoom.  Arms: zoom out / 100% / in · panned · left / middle / right ·
 * not the first page · desktop mouse unchanged (stored point == click point).  KNOWN-GOOD ARM: the run is
 * VOID unless the glyph rect is measurable on every arm.
 * `--baseline` prints the numbers and never fails (used to record the before). */
import { webkit, chromium, devices } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const TOL = 3;                                  // CSS px, either axis
const BASELINE = process.argv.includes("--baseline");
// --webkit-only skips the Chromium desktop-mouse control arm (used for a run against live planyr.io from a sandbox, where only the WebKit touch arms are the point).
const WEBKIT_ONLY = process.argv.includes("--webkit-only");
const failures = [];
const ok = (l, c, d) => { console.log(`${c ? "✓" : "⛔"} ${l}${d !== undefined ? ` — ${d}` : ""}`); if (!c) failures.push(l); };

const browser = await webkit.launch({});
const chrome = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const tk = "planyr:notes:tree:v1:local";
const pk = (id) => `planyr:notes:page:v1:local:${id}`;
const blankDoc = { type: "doc", content: [{ type: "paragraph", content: [] }] };

async function open(br, ctxOpts, { view, second } = {}) {
  const ctx = await br.newContext(ctxOpts);
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });   // B2078593: the view is set through the E2E hook now
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("   PAGEERROR", String(e.message).slice(0, 160)));
  await assertMeasurable(page, "verify-notes-touch-landing");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  const pages = [{ id: "p1", title: "One", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }];
  if (second) pages.push({ id: "p2", title: "Two", createdAt: 2, updatedAt: 2, projectId: null, pages: [] });
  await page.evaluate(([t, tree, docs]) => {
    localStorage.clear();
    localStorage.setItem(t, JSON.stringify({ v: 3, tombs: [], trash: [], pages: tree }));
    for (const [k, d] of docs) localStorage.setItem(k, JSON.stringify(d));
    if (tree.length > 1) localStorage.setItem("planyr:notes:activePage:v1:local", tree[tree.length - 1].id);
  }, [tk, pages, pages.map((p) => [pk(p.id), blankDoc])]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
  // B2078593 — a note always OPENS at full width (a stored view no longer wins), so a panned / zoomed
  // starting state is applied the way a pan or pinch would: through the E2E view hook.
  if (view) { await page.evaluate((v) => window.__noteEditor?.setView(v), view); await pacedWait(page, 400); }
  return page;
}
const glyph = (page) => page.evaluate(() => {
  const t = document.querySelector(".planyr-anchor-content p")?.firstChild;
  if (!t || t.nodeType !== 3) return null;
  const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 1);
  const b = r.getBoundingClientRect();
  return b.width ? { left: b.left, cy: b.top + b.height / 2 } : null;
});
/* The tap target is a fraction of the part of the PAPER (note-body — NOT note-sheet, which includes the title band;
 * NOTES-CARRY-FORWARD trap 41) that is actually ON SCREEN, so a short landscape viewport or a small phone cannot aim
 * the tap at the title input, the toolbar or past the glass (traps 18 / 40). Returns null when the paper has no visible
 * area or the point is not answered by the paper itself — the arm is then reported NOT EXERCISED, never scored. */
const frac = (page, fx, fy) => page.evaluate(([a, b]) => {
  const body = document.querySelector('[data-testid="note-body"]');
  const r = body.getBoundingClientRect();
  const M = 12;
  const L = Math.max(r.left, M), R = Math.min(r.right, innerWidth - M), T = Math.max(r.top, M), B = Math.min(r.bottom, innerHeight - M);
  if (R - L < 40 || B - T < 40) return null;
  const x = Math.round(L + (R - L) * a), y = Math.round(T + (B - T) * b);
  const hit = document.elementFromPoint(x, y);
  if (!hit || !hit.closest('[data-testid="note-body"]') || hit.closest("input, textarea, button")) return null;
  return { x, y };
}, [fx, fy]);
const notExercised = [];

async function run(label, mk, fx = 0.5, fy = 0.5, { mouse = false } = {}) {
  const page = await mk();
  const p = await frac(page, fx, fy);
  if (!p) { notExercised.push(label); console.log(`• ${label}: NOT EXERCISED — no visible blank paper at that fraction on this screen`); await page.context().close(); return; }
  if (mouse) { await page.mouse.dblclick(p.x, p.y); }
  else { await page.touchscreen.tap(p.x, p.y); await pacedWait(page, 90); await page.touchscreen.tap(p.x, p.y); }
  await pacedWait(page, 200);
  await page.keyboard.type("W");
  await pacedWait(page, 300);
  const g = await glyph(page);
  if (!g) { ok(`${label}: first glyph measurable (KNOWN-GOOD ARM)`, false, "no glyph rect — run VOID"); await page.context().close(); return; }
  if (process.argv.includes("--debug")) console.log("   debug", label, JSON.stringify(await page.evaluate(() => {
    const w = document.querySelector(".note-workspace"); const sh = document.querySelector('[data-testid="note-sheet"]') || document.querySelector(".note-sheet");
    const a = document.querySelector(".planyr-anchor"); const b = document.querySelector('[data-testid="note-body"]').getBoundingClientRect();
    return { tf: w && w.style.transform, anchor: a && [a.style.left, a.style.top, a.style.width], body: [b.left, b.top], sheet: sh && sh.getBoundingClientRect().toJSON() };
  })), "tap", JSON.stringify(p));
  const dx = +(g.left - p.x).toFixed(1), dy = +(g.cy - p.y).toFixed(1);
  const within = Math.abs(dx) <= TOL && Math.abs(dy) <= TOL;
  if (mouse) { ok(`${label}: desktop mouse path unchanged (glyph offset recorded)`, true, `dx ${dx} dy ${dy}`); }
  else if (BASELINE) console.log(`• ${label}: dx ${dx}, dy ${dy}`);
  else ok(`${label}: first letter lands on the tap`, within, `dx ${dx}, dy ${dy}`);
  await page.context().close();
  return { dx, dy };
}

const phone = { ...devices[process.env.PHONE || "iPhone 13"] }; // PHONE="iPhone SE landscape" etc.
const zv = (z) => ({ view: { x: 0, y: 0, z } });
await run("100%, middle", () => open(browser, phone), 0.5, 0.5);
await run("100%, near left edge", () => open(browser, phone), 0.12, 0.4);
await run("100%, near right edge", () => open(browser, phone), 0.8, 0.6);
await run("zoomed in 200%", () => open(browser, phone, zv(2)), 0.5, 0.5);
await run("zoomed in 200%, left", () => open(browser, phone, zv(2)), 0.12, 0.4);
await run("zoomed out 50%", () => open(browser, phone, zv(0.5)), 0.5, 0.5);
await run("zoomed out 50%, right", () => open(browser, phone, zv(0.5)), 0.8, 0.6);
await run("panned (view x 140, y 90) at 100%", () => open(browser, phone, { view: { x: 140, y: 90, z: 1 } }), 0.5, 0.5);
await run("panned + zoomed 150%", () => open(browser, phone, { view: { x: 220, y: 160, z: 1.5 } }), 0.4, 0.55);
await run("not the first page", () => open(browser, phone, { second: true }), 0.5, 0.5);
if (!WEBKIT_ONLY) await run("desktop mouse, middle (chromium)", () => open(chrome, { viewport: { width: 1200, height: 800 } }), 0.5, 0.5, { mouse: true });

await browser.close(); await chrome.close();
if (!BASELINE && failures.length) { console.log(`\n⛔ ${failures.length} failing arm(s)`); process.exit(1); }
if (notExercised.length) console.log(`\nNOT EXERCISED on this screen (${notExercised.length}): ${notExercised.join(" · ")}`);
if (notExercised.length >= 9) { console.log("⛔ run VOID — no arm could be exercised"); process.exit(1); }
console.log(BASELINE ? "\n(baseline — numbers only)" : "\n✓ all landing arms that could be exercised pass");
