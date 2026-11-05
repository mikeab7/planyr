#!/usr/bin/env node
/* verify-notes-touch-landing-live — V1481472 (B1960480 ×2): a double-tap on blank paper puts the first typed letter
 * exactly where the finger landed — on the DEPLOYED site, SIGNED IN as the test account (shared helper
 * ui-audit/lib/signedInSession.mjs; never a second sign-in), on a throwaway page it creates and deletes.
 *
 * ENGINE, LABELLED (docs/PHONE-TESTING.md): Playwright WebKit with the iPhone 15 / iPhone SE descriptors, touch on, real
 * `touchscreen.tap` pairs. EMULATED, never "on device": a real two-finger PINCH cannot be raised (so zoom/pan are set
 * through the app's own E2E view hook, `window.__noteEditor.setView`, and the arm says so), the iOS soft keyboard's
 * visual-viewport shift is a MODEL (layout viewport unchanged, visualViewport shrinks), and there is no real fingertip.
 * Those stay parked as REAL-IPHONE steps.
 *
 * METRIC (same as verify-notes-touch-landing.mjs): the rendered rect of the FIRST GLYPH of the new box vs the tap point,
 * in CSS px on screen, whatever the zoom. TARGETS are aimed at VISIBLE BLANK PAPER inside note-body (never the whole mat
 * or note-sheet — NOTES-CARRY-FORWARD traps 18/40/41); an arm whose target cannot be placed on visible blank paper on
 * this screen is printed NOT EXERCISED, never scored. KNOWN-GOOD ARM: the run is VOID unless the first arm measures.
 *
 * STEPS (V1481472): 1 middle · 2 left / right edge · 3 zoomed in / out · 4 panned · 5 editor already focused with the
 * keyboard up · 6 a page that is not the first · 7 the strip just under the title.
 *
 * Usage: node ui-audit/verify-notes-touch-landing-live.mjs [https://planyr.io] [--phones="iPhone 15,iPhone SE"]
 *        [--orient=portrait,landscape] [--shots=<dir>]
 */
import { mkdirSync } from "node:fs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { sweepNotesThrowaways } from "./lib/notesSweep.mjs";

const BASE = (process.argv.find((a, i) => i > 1 && a.startsWith("http")) || "https://planyr.io").replace(/\/$/, "");
const PHONES = ((process.argv.find((a) => a.startsWith("--phones=")) || "--phones=iPhone 15,iPhone SE").slice(9)).split(",");
const ORIENT = ((process.argv.find((a) => a.startsWith("--orient=")) || "--orient=portrait,landscape").slice(9)).split(",");
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const TOL = 3; // CSS px, either axis (same bar as the logged-out harness)
const KB = { "iPhone 15": 336, "iPhone SE": 260 };

const results = [];
const row = (id, ok, detail = "") => { results.push({ id, ok: ok === null ? null : !!ok, detail }); console.log(`${ok === null ? "N/E " : ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };
const P = (t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] });
const BLANK = { type: "doc", content: [P("")] };
const BOXED = { type: "doc", content: [{ type: "noteAnchor", attrs: { x: 10, y: 10, w: 110 }, content: [P("keyboard anchor")] }, P("")] };
const LOWBOX = { type: "doc", content: [{ type: "noteAnchor", attrs: { x: 10, y: 170, w: 110 }, content: [P("existing box")] }, P("")] };
const VV_MODEL = [() => {
  const t = new EventTarget();
  const vv = Object.assign(t, { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1, pageTop: 0, pageLeft: 0 });
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  window.__setKeyboard = (px) => { vv.width = innerWidth; vv.height = innerHeight - px; vv.dispatchEvent(new Event("resize")); vv.dispatchEvent(new Event("scroll")); };
}, null];
const E2E_FLAG = [() => { window.__PLANYR_E2E = true; }, null];

async function signIn(device) {
  let last;
  for (let i = 0; i < 14; i++) { // the sign-in route answers an intermittent 502 around deploys; retry only that
    try { return await openSignedIn({ base: BASE, engine: "webkit", device, initScripts: [E2E_FLAG, VV_MODEL] }); }
    catch (e) { last = e; if (!/answered 5\d\d|setSession failed|Load failed|Failed to fetch/.test(String(e))) throw e; console.log("  sign-in transient failure, retrying…"); await new Promise((r) => setTimeout(r, 20000)); }
  }
  throw last;
}

const viewOf = (page) => page.evaluate(() => {
  const t = document.querySelector('[data-testid="note-workspace"]')?.style.transform || "";
  const m = /translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/.exec(t), s = /scale\(([-0-9.]+)\)/.exec(t);
  return { x: m ? parseFloat(m[1]) : 0, y: m ? parseFloat(m[2]) : 0, z: s ? parseFloat(s[1]) : 1 };
});
// visible blank paper: a point inside note-body ∩ viewport (visual viewport when the keyboard model is up) that the paper itself answers
const target = (page, fx, fy, { stripTop = false } = {}) => page.evaluate(([a, b, strip]) => {
  const body = document.querySelector('[data-testid="note-body"]');
  const r = body.getBoundingClientRect(), vv = window.visualViewport, M = 12;
  const L = Math.max(r.left, M), R = Math.min(r.right, innerWidth - M), T = Math.max(r.top, vv.offsetTop + M), B = Math.min(r.bottom, vv.offsetTop + vv.height - M);
  if (R - L < 40 || B - T < 40) return null;
  const x = Math.round(L + (R - L) * a), y = strip ? Math.round(Math.max(r.top, T) + 12) : Math.round(T + (B - T) * b);
  const hit = document.elementFromPoint(x, y);
  if (!hit || !hit.closest('[data-testid="note-body"]') || hit.closest("input, textarea, button, .planyr-anchor")) return null;
  return { x, y };
}, [fx, fy, stripTop]);
const glyphOfW = (page) => page.evaluate(() => {
  for (const p of document.querySelectorAll(".planyr-anchor-content p")) {
    const t = p.firstChild;
    if (t && t.nodeType === 3 && t.textContent.startsWith("W")) {
      const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 1);
      const b = r.getBoundingClientRect();
      if (b.width) return { left: b.left, cy: b.top + b.height / 2 };
    }
  }
  return null;
});
const doubleTap = async (page, p) => { await page.touchscreen.tap(p.x, p.y); await pacedWait(page, 90); await page.touchscreen.tap(p.x, p.y); await pacedWait(page, 220); };
async function reset(page, doc, view) {
  await page.evaluate(() => { document.activeElement?.blur?.(); document.getSelection()?.removeAllRanges(); window.__setKeyboard && window.__setKeyboard(0); });
  await page.evaluate((d) => window.__noteEditor.setDoc(d), doc);
  await page.evaluate((v) => window.__noteEditor.setView(v), view || { x: 0, y: 0, z: 1 });
  await pacedWait(page, 500);
}

let firstArmMeasured = null;
const notExercised = [];
async function arm(page, label, { doc = BLANK, view = null, fx = 0.5, fy = 0.5, strip = false, kb = 0, before = null, expectStable = false }) {
  await reset(page, doc, view);
  if (before) await before(page);
  if (kb) await page.evaluate((px) => window.__setKeyboard(px), kb);
  await pacedWait(page, 250);
  let tp = null;
  for (const [a, b] of [[fx, fy], [0.5, 0.5], [0.3, 0.3], [0.7, 0.45], [0.25, 0.6]]) { tp = await target(page, a, b, { stripTop: strip }); if (tp) break; if (strip) break; }
  if (!tp) { notExercised.push(label); row(`${label}`, null, "NOT EXERCISED — no visible blank paper at that point on this screen"); return; }
  const existing = () => page.evaluate(() => { const b = [...document.querySelectorAll(".planyr-anchor")].find((a) => /existing box|keyboard anchor/.test(a.innerText)); if (!b) return null; const r = b.getBoundingClientRect(); return { left: r.left, top: r.top }; });
  const e0 = await existing(), v0 = await viewOf(page);
  await doubleTap(page, tp);
  await page.keyboard.type("W");
  await pacedWait(page, 350);
  const g = await glyphOfW(page);
  const e1 = await existing(), v1 = await viewOf(page);
  if (!g) { row(`${label}: first glyph measurable (KNOWN-GOOD ARM)`, false, "no glyph rect — arm VOID"); if (firstArmMeasured === null) firstArmMeasured = false; return; }
  if (firstArmMeasured === null) firstArmMeasured = true;
  const dx = +(g.left - tp.x).toFixed(1), dy = +(g.cy - tp.y).toFixed(1);
  const okPos = Math.abs(dx) <= TOL && Math.abs(dy) <= TOL;
  // "the page slides" = something already ON the page moves on screen. (The workspace transform alone is NOT that: it can change
  // internally while every box stays put — measured live 2026-10-08, ±12 px transform, 0.0 px box shift.)
  const slid = expectStable && (!e0 || !e1 || Math.abs(e1.left - e0.left) > 1.5 || Math.abs(e1.top - e0.top) > 1.5 || Math.abs(v1.z - v0.z) > 0.001);
  const boxes = await page.locator(".planyr-anchor").count();
  row(`${label}: first letter lands on the tap${expectStable ? " and the page does not slide" : ""}`, okPos && (!expectStable || !slid), `dx ${dx}, dy ${dy}; boxes ${boxes}${expectStable ? `; existing box ${e0 && e1 ? `shifted (${(e1.left - e0.left).toFixed(1)}, ${(e1.top - e0.top).toFixed(1)}) px` : "NOT FOUND"}${slid ? " — SLID" : " — held"}; workspace transform ${JSON.stringify(v0)}→${JSON.stringify(v1)} (informational)` : ""}`);
}

async function phoneRun(phone, orient) {
  const device = orient === "landscape" ? `${phone} landscape` : phone;
  const s = await signIn(device);
  const { page } = s;
  const L = `${device}`;
  const title = "ZZ throwaway touch-landing " + Date.now().toString(36);
  const title2 = title + " second";
  let ok = true;
  try {
    await assertMeasurable(page, "verify-notes-touch-landing-live");
    const chunks = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((x) => x.getAttribute("src").split("/").pop()).filter((x) => /index/.test(x)).join(","));
    const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null));
    console.log(`\n## ${L} — WebKit, touch — signed in as ${s.proof.email} — build ${build && build.build} · ${chunks}`);
    await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="notes-new-page"]', { timeout: 45000 });
    await page.waitForFunction(() => true);
    const before = await page.locator('[data-testid^="notes-row-"]').count();
    const newPage = async (t) => {
      await page.evaluate(() => { try { window.__setKeyboard && window.__setKeyboard(0); document.activeElement && document.activeElement.blur && document.activeElement.blur(); } catch {} });
      await pacedWait(page, 500);
      const back = page.locator('[data-testid="notes-mobile-back"]').filter({ visible: true }).first();
      if (await back.isVisible().catch(() => false)) await back.tap(); // a phone shows ONE pane: the page, or the list
      const np = page.locator('[data-testid="notes-new-page"]').filter({ visible: true }).first();
      await np.waitFor({ state: "visible", timeout: 15000 });
      await np.tap();
      await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
      await page.locator('[data-testid="note-title"]').fill(t);
      await page.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
      await pacedWait(page, 800);
      await page.waitForFunction(() => !!window.__noteEditor, null, { timeout: 20000 });
    };
    await newPage(title);

    // 1 — middle, normal zoom
    await arm(page, `${L} step 1 — middle, normal zoom`, { fx: 0.5, fy: 0.5 });
    // 2 — left / right edge
    await arm(page, `${L} step 2 — near the left edge`, { fx: 0.12, fy: 0.4 });
    await arm(page, `${L} step 2 — near the right edge`, { fx: 0.8, fy: 0.6 });
    // 3 — zoomed in / out (set through the app's own view hook: a real pinch cannot be produced here)
    await arm(page, `${L} step 3 — zoomed in 200% (view hook, not a pinch)`, { view: { x: 0, y: 0, z: 2 }, fx: 0.5, fy: 0.5 });
    await arm(page, `${L} step 3 — zoomed out 50% (view hook, not a pinch)`, { view: { x: 0, y: 0, z: 0.5 }, fx: 0.5, fy: 0.5 });
    // 4 — panned
    await arm(page, `${L} step 4 — panned (view hook)`, { view: { x: 140, y: 90, z: 1 }, fx: 0.5, fy: 0.5 });
    await arm(page, `${L} step 4 — panned and zoomed 150% (view hook)`, { view: { x: 220, y: 160, z: 1.5 }, fx: 0.4, fy: 0.55 });
    // 5 — editor already focused, keyboard up (keyboard = model)
    await arm(page, `${L} step 5 — editor already focused, keyboard up (modelled keyboard)`, {
      doc: BOXED, fx: 0.78, fy: 0.5, kb: KB[phone], expectStable: true,
      before: async (pg) => { const c = await pg.evaluate(() => { const r = document.querySelector(".planyr-anchor-content p")?.getBoundingClientRect(); return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null; }); if (c) { await pg.touchscreen.tap(c.x, c.y); await pacedWait(pg, 400); } },
    });
    // 7 — the strip just under the title
    await arm(page, `${L} step 7 — the strip just under the page title`, { doc: LOWBOX, strip: true, fx: 0.78, expectStable: true });
    await shot(page, `${L.replace(/ /g, "_")}-after`);
    // 6 — a page that is not the first
    await newPage(title2);
    await arm(page, `${L} step 6 — a page that is not the first`, { fx: 0.5, fy: 0.5 });
  } catch (e) {
    ok = false; row(`${L} RUN`, false, String(e && e.message || e));
  } finally {
    // the phone UI hides the page list behind Back, so the throwaway pages are removed by the desktop sweep after every run (below)
    await s.close();
  }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

try {
  for (const p of PHONES) for (const o of ORIENT) await phoneRun(p, o);
} catch (e) { row("RUN", false, String(e && e.message || e)); }
try {
  const sw = await sweepNotesThrowaways({ base: BASE });
  row("CLEANUP — every throwaway Notes page (and the app's own 'Recovered — W' salvage page) deleted from the list AND the Bin, re-read as gone", sw.pagesLeft === 0 && sw.binLeft === 0, `pagesLeft=${sw.pagesLeft} binLeft=${sw.binLeft}`);
} catch (e) { row("CLEANUP threw", false, String(e && e.message || e)); }
if (notExercised.length) console.log(`\nNOT EXERCISED (${notExercised.length}): ${notExercised.join(" · ")}`);
const bad = results.filter((r) => r.ok === false);
if (firstArmMeasured !== true) { console.log("\n⛔ RUN VOID — the first arm never measured a glyph"); process.exit(1); }
console.log(`\n${results.filter((r) => r.ok).length} passed, ${bad.length} failed, ${notExercised.length} not exercised`);
process.exit(bad.length ? 1 : 0);
