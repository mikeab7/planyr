/* NEW-4 — THE OWNER POPUP MUST TRACK ITS CELL WHILE THE GRID SCROLLS, NOT LAG BEHIND IT.
 *
 * Michael, verbatim: "when I was scrolling, that add-person chip or dropdown that opened, it's
 * bouncy when I'm scrolling. It doesn't seem like it's attached to this part, it's bouncing as I'm
 * scrolling, which is odd because it should just be attached." MEASURED cause: the popup is
 * `position: fixed`, portaled to the iframe's own body, with its coordinates computed once when it
 * opens and refreshed by a `window.addEventListener('scroll', fn, true)` capture listener — which,
 * against the grid's own nested scroll container inside this iframe, was not reliably firing: a
 * real scroll moved the input 120px and the popup did not move at all until the next keystroke
 * (whatever handler repositions it next) caught it up. That freeze-then-snap is the "bouncing."
 *
 * The fix replaces the listener with a requestAnimationFrame loop that re-reads the real DOM
 * position every frame while the picker is open — no event to miss, so it cannot desync from
 * whatever the browser is actually painting, on any scroll source (wheel, scrollbar, keyboard) and
 * on resize. This harness proves the loop, not the reasoning: it scrolls the REAL grid with a REAL
 * wheel event and reads the popup's own position before and after — plus proves the popup closes
 * outright rather than floating over the header once its cell scrolls fully out of view.
 *
 * Run:  node ui-audit/verify-owner-scroll-tracking.mjs        [PW_CHROME=<chrome>]
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
console.log("serving", url, "(vendored libs)");

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`);
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 700 } });   // short viewport — a small grid still needs to scroll
await assertMeasurable(page, "verify-owner-scroll-tracking");
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => pageErrors.push("GOTO: " + e.message));
const booted = await page.waitForSelector("[data-task-row]", { timeout: 30000 }).then(() => true).catch(() => false);
ok("scheduler boots", booted);
if (!booted) await finish();

const OWNER = 9;
const cellOf = (r) => page.locator(`[data-task-row="${r}"] > div`).nth(OWNER);

const leaves = await page.evaluate(() => [...document.querySelectorAll("[data-task-row]")]
  .filter(d => !/[▾▸]/.test(d.children[1]?.innerText || "")).map(d => +d.getAttribute("data-task-row")));
ok("found enough rows to require scrolling", leaves.length >= 15, "leaf rows=" + leaves.length);

const gridBox = await page.evaluate(() => {
  const el = document.querySelector('[data-grid-scroll]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
});
ok("the grid's own scroll container is reachable and taller than its viewport",
  !!gridBox && gridBox.scrollHeight > gridBox.clientHeight + 40, JSON.stringify(gridBox));

if (booted && leaves.length >= 15 && gridBox) {
  // Open the Owner editor on a row a few rows down (well clear of any sticky header row).
  const targetRow = leaves[4];
  await cellOf(targetRow).click();
  await page.waitForTimeout(150);
  await page.keyboard.press("A");   // opens the editor (type-to-edit)
  await page.waitForTimeout(200);

  const popupSel = '[data-owner-popup]';
  const before = await page.evaluate((sel) => {
    const inp = document.querySelector('input');
    const pop = document.querySelector(sel);
    if (!inp || !pop) return null;
    const ir = inp.getBoundingClientRect(), pr = pop.getBoundingClientRect();
    return { inputTop: ir.top, popupTop: pr.top, gapBefore: pr.top - ir.bottom };
  }, popupSel);
  ok("the popup is open and anchored under the input", !!before, JSON.stringify(before));

  // A REAL wheel scroll over the grid — not a driver "scroll into view", an actual user gesture.
  const midX = (gridBox.left + gridBox.right) / 2;
  const midY = (gridBox.top + gridBox.bottom) / 2;
  await page.mouse.move(midX, midY);
  await page.mouse.wheel(0, 150);
  // Two animation frames' worth of settle time — the fix is a rAF loop, so this must be enough.
  await pacedWait(page, 60);

  const after = await page.evaluate((sel) => {
    const inp = document.querySelector('input');
    const pop = document.querySelector(sel);
    if (!inp || !pop) return null;
    const ir = inp.getBoundingClientRect(), pr = pop.getBoundingClientRect();
    return { inputTop: ir.top, popupTop: pr.top, gapAfter: pr.top - ir.bottom };
  }, popupSel);
  ok("the editor is still open after a mid-grid scroll (the cell has not scrolled out of view)", !!after, JSON.stringify(after));

  if (before && after) {
    const inputDelta = before.inputTop - after.inputTop;
    const popupDelta = before.popupTop - after.popupTop;
    ok("the scroll actually moved the input (the test itself is real, not a no-op)",
      Math.abs(inputDelta) > 20, `inputTop moved ${inputDelta.toFixed(1)}px`);
    ok("the popup moved WITH the input — not frozen, not lagging",
      Math.abs(inputDelta - popupDelta) <= 4,
      `input moved ${inputDelta.toFixed(1)}px, popup moved ${popupDelta.toFixed(1)}px (must match within a few px)`);
    ok("the gap between the input and the popup is unchanged — same visual anchor before and after",
      Math.abs(before.gapBefore - after.gapAfter) <= 2,
      `gap before=${before.gapBefore.toFixed(1)}, after=${after.gapAfter.toFixed(1)}`);
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await pacedWait(page, 150);

  // ── Scroll the edited cell fully OUT of the grid's own viewport — the editor must CLOSE,
  //    never float over the header or hang outside the grid. ──────────────────────────────
  const lowRow = leaves[Math.min(leaves.length - 1, 10)];
  await cellOf(lowRow).click();
  await page.waitForTimeout(150);
  await page.keyboard.press("Z");
  await page.waitForTimeout(200);
  const openedBeforeBigScroll = await page.locator('input').count();
  ok("a second editor opens normally before the big scroll", openedBeforeBigScroll > 0);

  await page.mouse.move(midX, midY);
  // Scroll the whole visible viewport's worth — guarantees the edited row leaves the visible area.
  await page.mouse.wheel(0, gridBox.clientHeight + 200);
  await pacedWait(page, 200);

  const stillOpen = await page.locator('input').count();
  const floatingPopup = await page.evaluate((sel) => {
    const pop = document.querySelector(sel);
    if (!pop) return null;
    const gr = document.querySelector('[data-grid-scroll]').getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    return { poppedAboveGrid: pr.top < gr.top, poppedBelowGrid: pr.bottom > gr.bottom };
  }, popupSel);
  ok("the editor CLOSES once its cell scrolls fully out of the grid's viewport (never left floating)",
    stillOpen === 0 && !floatingPopup,
    `input count=${stillOpen}, popup=${JSON.stringify(floatingPopup)}`);

  await page.keyboard.press("Escape").catch(() => {});
  await pacedWait(page, 100);

  // ── Reorder via drag: the FIRST chip becomes the accountable owner — dragging chip 2 onto
  //    chip 1's slot must promote it, proving the grouping/dashboard read the right entry. ──
  await page.evaluate(() => { const el = document.querySelector('[data-grid-scroll]'); if (el) el.scrollTop = 0; });
  await pacedWait(page, 150);
  const rTop = leaves[0];
  await cellOf(rTop).click(); await pacedWait(page, 130);
  await page.keyboard.type("Alpha One"); await page.keyboard.press("Enter"); await pacedWait(page, 200);
  await page.keyboard.type("Beta Two"); await page.keyboard.press("Enter"); await pacedWait(page, 200);
  const order0 = await page.evaluate(() => [...document.querySelectorAll('[data-owner-chip]')].map(c => c.textContent.replace('×', '')));
  ok("two chips are present before reordering", order0.length === 2, JSON.stringify(order0));

  // Each dispatch is its own page.evaluate (with a real wait between) rather than three
  // back-to-back dispatchEvent calls in one script — React 18 batches everything processed
  // within a single synchronous script, so onDrop's handler would still close over the dragIdx
  // from BEFORE onDragStart's setDragIdx ever committed. A real user drag spreads these across
  // separate animation frames as the mouse actually moves, so this mirrors that, not the app.
  await page.evaluate(() => {
    window.__dragDT = new DataTransfer();
    const first = document.querySelectorAll('[data-owner-chip]')[0];
    first.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dragDT }));
  });
  await pacedWait(page, 120);
  await page.evaluate(() => {
    const second = document.querySelectorAll('[data-owner-chip]')[1];
    second.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: window.__dragDT }));
  });
  await pacedWait(page, 120);
  await page.evaluate(() => {
    const second = document.querySelectorAll('[data-owner-chip]')[1];
    second.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: window.__dragDT }));
  });
  await pacedWait(page, 200);
  const order1 = await page.evaluate(() => [...document.querySelectorAll('[data-owner-chip]')].map(c => c.textContent.replace('×', '')));
  ok("dragging chip 1 onto chip 2's slot swaps their order",
    order1[0] === "Beta Two" && order1[1] === "Alpha One", JSON.stringify(order1));

  await page.keyboard.press("Enter"); await pacedWait(page, 250);   // close (input is empty)
  const rTopText = await cellOf(rTop).innerText();
  ok("the reordered FIRST chip is what the closed cell shows as accountable",
    rTopText.startsWith("Beta Two"), JSON.stringify(rTopText.trim()));
}

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
await finish();

async function finish() {
  await browser.close().catch(() => {});
  server.close();
  const passed = results.filter(r => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  process.exit(passed === results.length ? 0 : 1);
}
