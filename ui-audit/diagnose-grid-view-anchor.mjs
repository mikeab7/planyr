/* ⛔⛔ REFUTED 2026-08-13 (B463922) — THE +477px JUMP THIS FILE REPORTED WAS THIS FILE'S OWN SCROLL.
 *
 * Read this before quoting anything below it. The reproduction was real and repeatable and it
 * measured the DRIVER, not the product. This harness clicked `[title="Collapse"]` on the FIRST
 * rendered row of a VIRTUALISED grid — and a virtualiser renders a buffer of rows ABOVE the
 * viewport, so that toggle sat 75px off screen. Playwright scrolls a target into view before
 * clicking it, through CDP, where no patched `scrollTop` setter can see it. So "programmatic
 * writes: 0" was not corroboration; it was the tell.
 *
 * The three measurements that settle it, same build, same seed data:
 *   this file's click, toggle 75px ABOVE the view  → row moves +477px   scrollTop −501
 *   JS .click() on the SAME toggle (no driver scroll) → row moves −24px  scrollTop 0   ← correct
 *   a click on a toggle INSIDE the view            → row moves  −48px   scrollTop 0    ← correct
 * and a toggle BELOW the viewport moved it the other way (+459). The magnitude and the sign both
 * follow where the target sat, which is the driver's signature, not the app's.
 *
 * SCROLL ANCHORING IS CLEARED TOO, three ways: `overflow-anchor:none` on the container and every
 * descendant changed nothing; launching with ScrollAnchoring disabled changed nothing; and the
 * positive control — inserting 500px of content above the viewport — moved scrollTop by EXACTLY 0,
 * because these rows are absolutely positioned and an out-of-flow box is never an anchor candidate.
 * The container was never anchoring anything, so it could not have lost an anchor.
 *
 * WHAT REPLACED IT: `ui-audit/verify-grid-row-hold.mjs` — same verdict quantity (rendered position),
 * but every click goes through `lib/visibleClick.mjs`, which refuses an off-screen target, and every
 * step carries a model witness AND a selection witness. It found the real defect in this area: the
 * collapse triangle stole the selection from the cell being edited.
 *
 * This file is kept for the record. Its steps below still click buffered rows; treat any number it
 * prints on the collapse path as a measurement of Playwright.
 */
/* B463922 — DOES THE VIEW JUMP WHILE EDITING? MEASURED AS RENDERED POSITION, NOT scrollTop.
 *
 * ⛔ WHY THIS FILE EXISTS AT ALL, and it is the whole lesson: the first attempt measured `scrollTop`
 * and saw it move ~500 px twice. That was NOT the bug. There were zero programmatic writes and, on
 * the date edit, `maxScroll` was unchanged — the signature of Chrome's SCROLL ANCHORING, which moves
 * the number precisely so the PICTURE stays still. A moving scrollTop is not a jumping view, and a
 * fix shipped on that evidence would have been a guess.
 *
 * The quantity the owner's eye actually tracks is WHERE THE ROW HE IS EDITING SITS ON SCREEN. So
 * that is what this measures: the selected row's `getBoundingClientRect().top` expressed relative to
 * the scroll container, before and after each action, keyed on the row's IDENTITY (data-task-row)
 * rather than its index — because a re-sort changes the index, and an instrument keyed on index
 * would silently follow a different row and report calm.
 *
 * Reported per action:
 *   ΔanchorTop  — how far the row moved ON SCREEN. This is the verdict number.
 *   Δtop        — how far scrollTop moved. Kept only to show the two disagreeing.
 *   visible     — whether the row is still inside the scroll viewport afterwards.
 *   writes      — programmatic scrollTop / scrollIntoView calls, with stacks.
 *
 * A row that keeps its screen position while scrollTop moves = anchoring doing its job, no bug on
 * that path. A row that moves hundreds of pixels, or leaves the viewport = the owner's bug.
 *
 * WHAT IT ESTABLISHED (2026-08-13), measured on rendered position:
 *   REPRODUCED — collapsing a group ABOVE the edited row moves that row +477 px DOWN THE SCREEN and
 *     OUT OF THE VIEWPORT (447 → 924 in a ~900 px tall grid), with `writes = 0`. That is the owner's
 *     symptom, on the quantity his eye tracks.
 *   THE NAMED SUSPECT IS CLEARED — the keep-the-selected-row-visible effect made ZERO scroll writes
 *     on the path that jumps. It is not scrolling to a stale index; it is not scrolling at all. The
 *     row is not dragged away by the app, it is ABANDONED: the content above changes height, the
 *     browser re-anchors on some other element, and nothing brings the selected row back.
 *   CLEAN, AND GENUINELY SO (the witness confirms each of these changed the model): a start-date
 *     edit, the same edit driven far the other way, and a duration edit all held the row at +0 px.
 *   NOT PROVEN EITHER WAY — insert / undo-insert / indent / outdent / mark-complete / Enter / Tab
 *     each reported "steady" while the witness says NOTHING CHANGED, so those seven prove nothing
 *     and are printed as such rather than counted as passes.
 *
 * ⛔ THE WITNESS IS NOT OPTIONAL. Before it existed, every one of those seven read as a clean pass —
 * fourteen greens, seven of them earned by doing nothing. That is the same vacuous-green shape as
 * the close:[0,0] route in verify-grid-overlay-input and the paste test that bypassed its own
 * selection. A step that changed nothing must never be allowed to look like evidence.
 *
 * Run:  node ui-audit/diagnose-grid-view-anchor.mjs      [PW_CHROME=<chrome>]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

await ensureVendored();
const server = createServer(async (req, res) => {
  try {
    if (await serveVendored(req, res)) return;
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (p.endsWith("sequence/index.html")) body = Buffer.from(rewriteCdn(body.toString("utf8")));
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — rAF is suspended, so a view change updates state while the
   drawing never repaints and every geometry read describes a view the app already left. That trap is
   exactly this file's subject matter, so the precondition is not optional here. */
await assertMeasurable(page, "diagnose-grid-view-anchor");
page.on("pageerror", e => console.log("  [pageerror]", e.message.slice(0, 160)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("[data-task-row]", { timeout: 40000 });

const INSTALL = () => {
  const g = document.querySelector('[data-grid-scroll="1"]');
  window.__g = g; window.__w = [];
  const short = s => (s || "").split("\n").slice(2, 7).map(l => l.trim().replace(/^at\s+/, "").replace(/https?:\/\/[^ )]+\//g, "")).filter(Boolean);
  const d = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
  Object.defineProperty(g, "scrollTop", { configurable: true,
    get() { return d.get.call(this); },
    set(v) { const f = d.get.call(this); if (Math.abs(v - f) > 1) window.__w.push({ kind: "scrollTop=", from: Math.round(f), to: Math.round(v), stack: short(new Error().stack) }); return d.set.call(this, v); } });
  const sIV = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (...a) {
    const b = g.scrollTop; const r = sIV.apply(this, a); const af = g.scrollTop;
    if (Math.abs(af - b) > 1) window.__w.push({ kind: "scrollIntoView", from: Math.round(b), to: Math.round(af), stack: short(new Error().stack) });
    return r;
  };
  /* THE VERDICT NUMBER. Keyed on the row's IDENTITY, never its index — a re-sort changes the index,
     and an index-keyed probe would measure whatever row now sits there and report a calm result. */
  window.__rowIndex = id => {
    // Model index, read off the row's absolute `top` style (the grid positions rows at idx*ROW_H).
    const row = document.querySelector(`[data-task-row="${id}"]`);
    if (row) return Math.round(parseFloat(row.style.top || "0") / 25);
    return null;
  };
  window.__witness = id => {
    const row = document.querySelector(`[data-task-row="${id}"]`);
    return { rows: document.querySelectorAll("[data-task-row]").length,
             text: row ? [...row.children].slice(0, 6).map(c => (c.innerText || "").trim()).join("|") : null,
             modelTop: row ? Math.round(parseFloat(row.style.top || "0")) : null };
  };
  window.__anchor = id => {
    const row = document.querySelector(`[data-task-row="${id}"]`);
    if (!row) return { present: false };
    const gr = window.__g.getBoundingClientRect(), rr = row.getBoundingClientRect();
    return { present: true, anchorTop: Math.round(rr.top - gr.top),
             visible: rr.bottom > gr.top && rr.top < gr.bottom,
             top: Math.round(window.__g.scrollTop),
             idx: [...document.querySelectorAll("[data-task-row]")].findIndex(r => r === row) };
  };
};
await page.evaluate(INSTALL);

const anchor = id => page.evaluate(i => window.__anchor(i), id);
const writes = () => page.evaluate(() => { const x = window.__w.slice(); window.__w.length = 0; return x; });

// Park mid-list and pick a mid-viewport LEAF row to be "the row he is editing".
await page.evaluate(() => { window.__g.scrollTop = Math.floor(window.__g.scrollHeight / 2); });
await pacedWait(page, 400);
const ROW = await page.evaluate(() => {
  const g = window.__g, gr = g.getBoundingClientRect();
  const rows = [...document.querySelectorAll("[data-task-row]")].filter(r => {
    const b = r.getBoundingClientRect();
    return b.top > gr.top + 160 && b.bottom < gr.bottom - 160 && r.querySelector("[data-health-dot]");
  });
  return rows.length ? +rows[Math.floor(rows.length / 2)].getAttribute("data-task-row") : null;
});
await page.locator(`[data-task-row="${ROW}"] > div`).nth(1).click();
await pacedWait(page, 350);
const start = await anchor(ROW);
console.log(`\nediting row ${ROW} — on screen at ${start.anchorTop}px from the top of the grid, scrollTop ${start.top}, index ${start.idx}\n`);
console.log("  ΔanchorTop = how far the ROW MOVED ON SCREEN (the verdict).  Δtop = how far scrollTop moved.\n");

const rows = [];
async function step(label, fn) {
  await page.evaluate(() => { window.__w.length = 0; });
  let b = await anchor(ROW);
  const wB = await page.evaluate(i => window.__witness(i), ROW);
  if (!b.present) {  // re-anchor before measuring, or the delta is meaningless
    await page.evaluate(async (id) => { const g = window.__g, H = g.scrollHeight, st = Math.max(200, g.clientHeight - 100);
      for (let y = 0; y <= H; y += st) { g.scrollTop = y; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (document.querySelector(`[data-task-row="${id}"]`)) return; } }, ROW);
    await pacedWait(page, 350);
    b = await anchor(ROW);
    if (!b.present) { console.log(`  (skip) ${label}: row not findable`); return; }
    await page.locator(`[data-task-row="${ROW}"] > div`).nth(1).click().catch(() => {});
    await pacedWait(page, 250);
    b = await anchor(ROW);
  }
  try { await fn(); } catch (e) { console.log(`    (${label} threw: ${e.message.slice(0, 60)})`); }
  await pacedWait(page, 500);
  let a = await anchor(ROW);
  const w = await writes();
  /* ⛔ THE GRID IS VIRTUALISED: a row scrolled far enough away is REMOVED from the DOM. So "not
     present" does not mean deleted — it means the user can no longer see it, which for this
     question is the loudest possible result. Record that, then scroll it back so the remaining
     steps still measure something. Without this the first jump silently poisons every later row. */
  if (!a.present) {
    console.log(`  *** LOST FROM VIEW *** ${label}: the row is no longer rendered (scrolled out of the virtual window)`);
    rows.push({ label, lost: true, dA: null, dT: a.top - b.top, writes: w.length });
    // Find it by SCANNING the scroll range — a virtualised row is not in the DOM, so its index
    // cannot be read off it. Step through the container until it renders.
    const found = await page.evaluate(async (id) => {
      const g = window.__g, H = g.scrollHeight, step = Math.max(200, g.clientHeight - 100);
      for (let y = 0; y <= H; y += step) {
        g.scrollTop = y;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (document.querySelector(`[data-task-row="${id}"]`)) return Math.round(g.scrollTop);
      }
      return null;
    }, ROW);
    await pacedWait(page, 400);
    a = await anchor(ROW);
    if (!a.present) { console.log(`             (scanned the whole scroll range — the row is genuinely gone from the list)`); return; }
    await page.locator(`[data-task-row="${ROW}"] > div`).nth(1).click().catch(() => {});
    await pacedWait(page, 250);
    console.log(`             (found again by scanning at scrollTop ${found}; re-anchored at ${a.anchorTop}px, re-selected to continue)`);
    return;
  }
  const dA = a.anchorTop - b.anchorTop, dT = a.top - b.top;
  const verdict = !a.visible ? "*** OFF-SCREEN ***" : Math.abs(dA) > 100 ? "*** JUMPED ***" : Math.abs(dA) > 24 ? "  drifted " : "  steady  ";
  console.log(`  ${verdict} ${label}`);
  console.log(`             ΔanchorTop ${dA >= 0 ? "+" : ""}${dA}px   (${b.anchorTop} → ${a.anchorTop})   Δtop ${dT >= 0 ? "+" : ""}${dT}   idx ${b.idx} → ${a.idx}   visible=${a.visible}   writes=${w.length}`);
  w.slice(0, 2).forEach(x => console.log(`               ${x.kind} ${x.from}→${x.to}  ${x.stack.slice(0, 3).join(" ← ")}`));
  const wA = await page.evaluate(i => window.__witness(i), ROW);
  const changed = wA.rows !== wB.rows || wA.text !== wB.text || wA.modelTop !== wB.modelTop;
  if (!changed) console.log(`             ⚠ NOTHING CHANGED — this step did nothing, so its "steady" proves nothing`);
  rows.push({ label, dA, dT, visible: a.visible, writes: w.length, idxFrom: b.idx, idxTo: a.idx, changed });
}

const cell = n => page.locator(`[data-task-row="${ROW}"] > div`).nth(n);

await step("collapse a group ABOVE the selected row", async () => {
  const t = page.locator('[data-task-row] span[title="Collapse"]').first();
  if (await t.count()) await t.click();
});
await step("re-expand that group", async () => {
  const t = page.locator('[data-task-row] span[title="Expand"]').first();
  if (await t.count()) await t.click();
});
await step("edit the row's START date (re-sorts it)", async () => {
  await cell(2).click(); await pacedWait(page, 150);
  await page.keyboard.press("Control+a").catch(() => {});
  await page.keyboard.type("1/2/26", { delay: 20 }); await page.keyboard.press("Enter");
});
await step("edit the START date far the OTHER way (re-sorts it back past many rows)", async () => {
  await cell(2).click(); await pacedWait(page, 150);
  await page.keyboard.press("Control+a").catch(() => {});
  await page.keyboard.type("12/20/28", { delay: 20 }); await page.keyboard.press("Enter");
});
await step("undo", async () => { await page.keyboard.press("Control+z"); });
await step("redo", async () => { await page.keyboard.press("Control+y"); });
await step("insert a row above the selection", async () => { await page.keyboard.press("Insert"); });
await step("undo the insert", async () => { await page.keyboard.press("Control+z"); });
await step("indent the row", async () => { await page.keyboard.press("Alt+ArrowRight"); });
await step("outdent it back", async () => { await page.keyboard.press("Alt+ArrowLeft"); });
await step("duration edit", async () => {
  await cell(4).click(); await pacedWait(page, 150);
  await page.keyboard.type("14", { delay: 25 }); await page.keyboard.press("Enter");
});
await step("mark it Complete (may raise the successor prompt)", async () => {
  const d = page.locator(`[data-picker-cell="health-${ROW}"] [data-health-dot]`);
  if (await d.count()) { await d.click(); await pacedWait(page, 220);
    const sw = page.locator('body > div[style*="z-index: 9999"] > span');
    if (await sw.count() > 3) await sw.nth(3).click(); }
});
await step("press Enter (dismiss any prompt)", async () => { await page.keyboard.press("Enter"); });
await step("Tab across six columns", async () => { for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); await pacedWait(page, 80); } });

console.log("\n──── SUMMARY (by rendered position) ────");
const moved = rows.filter(r => !r.gone && (Math.abs(r.dA) > 24 || !r.visible));
const numberMovedPictureDidNot = rows.filter(r => !r.gone && Math.abs(r.dT) > 40 && Math.abs(r.dA) <= 24);
const vacuous = rows.filter(r => r.changed === false);
console.log(`  paths driven: ${rows.length}   (of which did NOTHING, so prove nothing: ${vacuous.length}${vacuous.length ? " → " + JSON.stringify(vacuous.map(r => r.label)) : ""})`);
console.log(`  the ROW MOVED ON SCREEN (>24px) or left the viewport: ${moved.length}` + (moved.length ? " → " + JSON.stringify(moved.map(r => `${r.label} (${r.dA}px${r.visible ? "" : ", OFF-SCREEN"})`)) : ""));
console.log(`  scrollTop moved but the picture did NOT (anchoring working): ${numberMovedPictureDidNot.length}` + (numberMovedPictureDidNot.length ? " → " + JSON.stringify(numberMovedPictureDidNot.map(r => `${r.label} (Δtop ${r.dT}, ΔanchorTop ${r.dA})`)) : ""));

await browser.close(); server.close();
