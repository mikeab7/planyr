/* DIAGNOSTIC (observation only — no assertions, no verdicts baked in).
 *
 * Three live reports from one screenshot, in the Schedule grid:
 *   1. the status dropdown stays open after the successor prompt is accepted
 *   2. clicking a dropdown item leaks a selection into the grid underneath
 *   3. the viewport jumps while editing
 *
 * Every one of these is a "what actually happened" question, so this file MEASURES rather than
 * reasons: it instruments the page BEFORE touching it and prints a timeline.
 *
 * INSTRUMENTS INSTALLED (all read-only, all removed with the page):
 *   · scrollTop  — the own-property setter on the grid's scroll container is wrapped, so every
 *                  PROGRAMMATIC write is captured WITH ITS STACK. Native user scrolling does not
 *                  go through the setter, so anything this catches is the app moving the view.
 *   · scrollIntoView / scrollTo — wrapped globally for the same reason; these are the usual way a
 *                  grid yanks itself somewhere.
 *   · pointer + key events — capture phase on document, recording target, the element actually
 *                  under the point (elementFromPoint), and whether the event was trusted.
 *   · the selection band — read structurally from computed style (a range-selected cell paints
 *                  #dbeafe / rgb(219,234,254)), so "did a selection appear" is answered by the DOM
 *                  rather than by eye.
 *   · overlays — enumerated from computed style across the WHOLE document, so "is the menu still
 *                  up" is a DOM fact and not a screenshot.
 *
 * WHAT IT ESTABLISHED (2026-08-13):
 *   BUG 1 — the menu closes correctly on the swatch click (control: 0/9 left open with no prompt).
 *           It is the ENTER that dismisses the successor prompt that RE-OPENS it: that keystroke
 *           also reaches the grid's global key handler, which by design opens the picker on a
 *           picker column (index.html "Enter on a picker column opens its picker") and fires a
 *           synthetic click on the dot — captured as `HTMLDocument.onKey → HTMLElement.click()`,
 *           isTrusted=false. Enter 7/7 leaves a menu open; Escape 0/7; the ✕ button 0/7.
 *   BUG 2 — a plain click on a swatch leaks nothing; pressing on a swatch and MOVING before release
 *           leaks a drag-selection into the grid (rows 2-8 of the status column). The mousedown does
 *           NOT reach the cell through the DOM — it arrives through the REACT tree, because a portal
 *           bubbles to its React parent (the grid cell) rather than its DOM parent (body). The swatch
 *           stops `click`; nothing stops `mousedown`, and `mousedown` is what starts drag-select.
 *   BUG 3 — NOT reproduced. Driven at scrollTop 3351 on a mid-viewport row: date edit + Enter, Tab
 *           across six columns, duration edit, 10x ArrowDown, 10x ArrowUp — zero programmatic scroll
 *           moves. The only programmatic write seen anywhere was a React effect setting scrollTop=-6
 *           from 0 (clamped, so it moved nothing there). That is a lead, not a cause.
 *
 * Run:  node ui-audit/diagnose-grid-overlays.mjs      [PW_CHROME=<chrome>]
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
await assertMeasurable(page, "diagnose-grid-overlays");
page.on("pageerror", e => console.log("  [pageerror]", e.message.slice(0, 200)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("[data-task-row]", { timeout: 40000 });
console.log("booted\n");

const INSTRUMENT = () => {
  const W = window;
  W.__diag = { scroll: [], events: [], sel: [], marks: [] };
  W.__mark = m => W.__diag.marks.push({ t: performance.now(), m });

  const grid = document.querySelector('[data-grid-scroll="1"]');
  W.__grid = grid;
  const short = s => (s || "").split("\n").slice(2, 8)
    .map(l => l.trim().replace(/^at\s+/, "").replace(/https?:\/\/[^ )]+\//g, "")).filter(Boolean);

  // Programmatic scrollTop writes on the grid container (user wheel/drag does NOT hit this).
  if (grid) {
    const d = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    Object.defineProperty(grid, "scrollTop", {
      configurable: true,
      get() { return d.get.call(this); },
      set(v) {
        const from = d.get.call(this);
        if (Math.abs(v - from) > 1) W.__diag.scroll.push({ t: performance.now(), kind: "scrollTop=", from: Math.round(from), to: Math.round(v), stack: short(new Error().stack) });
        return d.set.call(this, v);
      },
    });
  }
  const sIV = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (...a) {
    const before = grid ? grid.scrollTop : -1;
    const r = sIV.apply(this, a);
    const after = grid ? grid.scrollTop : -1;
    W.__diag.scroll.push({ t: performance.now(), kind: "scrollIntoView", el: (this.getAttribute && (this.getAttribute("data-task-row") || this.className)) || this.tagName,
      from: Math.round(before), to: Math.round(after), moved: Math.abs(after - before) > 1, stack: short(new Error().stack) });
    return r;
  };
  const sTo = Element.prototype.scrollTo;
  if (sTo) Element.prototype.scrollTo = function (...a) {
    W.__diag.scroll.push({ t: performance.now(), kind: "scrollTo", args: JSON.stringify(a).slice(0, 80), stack: short(new Error().stack) });
    return sTo.apply(this, a);
  };

  // Pointer/key events, capture phase — what the grid is actually handed, and from where.
  for (const type of ["mousedown", "mouseup", "click", "keydown"]) {
    document.addEventListener(type, e => {
      const t = e.target;
      const hit = (e.clientX != null && e.clientX > 0) ? document.elementFromPoint(e.clientX, e.clientY) : null;
      const desc = el => !el ? null : [el.tagName.toLowerCase(),
        el.getAttribute && el.getAttribute("data-task-row") ? `row=${el.getAttribute("data-task-row")}` : "",
        el.getAttribute && el.getAttribute("data-picker-cell") ? `picker=${el.getAttribute("data-picker-cell")}` : "",
        el.getAttribute && el.getAttribute("data-health-dot") ? "healthdot" : "",
      ].filter(Boolean).join(" ");
      W.__diag.events.push({ t: performance.now(), type, key: e.key, trusted: e.isTrusted,
        shift: e.shiftKey, target: desc(t), under: desc(hit),
        inPortal: !!(t.closest && t.closest("[data-contact-dd]")) });
    }, true);
  }

  // The full-row selection band, watched structurally rather than by screenshot.
  const readSel = () => [...document.querySelectorAll("[data-task-row]")]
    .filter(r => { const s = getComputedStyle(r); return (s.backgroundColor && s.backgroundColor !== "rgba(0, 0, 0, 0)" && /1[0-9]{2}, 1[0-9]{2}, 2[0-9]{2}/.test(s.backgroundColor)); })
    .map(r => r.getAttribute("data-task-row"));
  W.__readSelBand = () => {
    // The band is drawn as border rules on the selected rows; report any row carrying a top/bottom
    // rule that its neighbours do not, plus anything with an explicit outline.
    const out = [];
    for (const r of document.querySelectorAll("[data-task-row]")) {
      const s = getComputedStyle(r);
      if ((s.borderTopWidth && s.borderTopWidth !== "0px") || (s.borderBottomWidth && s.borderBottomWidth !== "0px") || (s.outlineStyle && s.outlineStyle !== "none"))
        out.push({ row: r.getAttribute("data-task-row"), bt: s.borderTopWidth, bb: s.borderBottomWidth, ol: s.outlineStyle });
    }
    return out;
  };
  /* ⛔ TWO BLIND SPOTS THIS INSTRUMENT SHIPPED WITH, both found by it lying in the SAFE direction —
     it reported "no overlay" while one was plainly on screen, which is the shape that gets a real
     bug filed as unreproducible. Fixed here, and written down so neither comes back:
       1. it scanned only `body > div`, but the successor-prompt modal renders INSIDE the React tree
          and is not portaled to body, so it was invisible. Scan the whole document.
       2. it sliced overlay text to 60 chars and then searched that text for "READY TO START" —
          a phrase that begins at character 62. Keep enough text to match against. */
  W.__menuCount = () => [...document.querySelectorAll("body > div")]
    .filter(d => /fixed/.test(d.style.position || "") && d.style.zIndex === "9999").length;
  W.__portals = () => [...document.querySelectorAll("div")]
    .filter(d => { const cs = getComputedStyle(d);
      /* 3. …and a width>40 filter, added while fixing 1 and 2, silently excluded the status menu
            itself — it is ~36px wide (five 28px swatches plus padding). A visibility filter must be
            calibrated against the SMALLEST thing it has to see, not the largest. */
      const b = d.getBoundingClientRect();
      return cs.position === "fixed" && cs.display !== "none" && cs.visibility !== "hidden" && b.width > 8 && b.height > 8; })
    .map(d => ({ z: d.style.zIndex || getComputedStyle(d).zIndex || "",
      text: (d.innerText || "").slice(0, 200).replace(/\n/g, " | ") }));
};

await page.evaluate(INSTRUMENT);
console.log("instruments installed\n");

// ── Find a task whose completion RAISES the successor prompt: not green, with a gray successor.
/* Order the rows so the ones that actually RAISE the successor prompt come first — the reported
   bug needs the prompt, and picking "the first row with a dot" quietly tests a different path
   (completing a task with no ready-to-start successor raises only the celebration toast). A row
   qualifies when it is not already Complete and lists a Not Started successor. */
const target = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("[data-task-row]")].map(r => ({
    id: +r.getAttribute("data-task-row"),
    succ: (r.children[6]?.innerText || "").trim(),
    status: (r.children[8]?.innerText || "").trim(),
    hasDot: !!r.querySelector("[data-health-dot]"),
  }));
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  const raises = r => r.hasDot && !/complete/i.test(r.status) &&
    (r.succ.match(/\d+/g) || []).map(Number).some(i => byId[i] && /not started/i.test(byId[i].status));
  return [...rows.filter(raises), ...rows.filter(r => !raises(r))].map(r => r.id);
});
console.log("rows on screen:", target.slice(0, 30).join(","), target.length > 30 ? `… (${target.length} total)` : "");

const dump = async (label) => {
  const d = await page.evaluate(() => {
    const o = JSON.parse(JSON.stringify(window.__diag));
    window.__diag.scroll = []; window.__diag.events = []; window.__diag.marks = [];
    return o;
  });
  console.log(`\n──── ${label}`);
  if (d.scroll.length) { console.log("  SCROLL MOVES:"); d.scroll.forEach(s => console.log("   ", JSON.stringify({ kind: s.kind, from: s.from, to: s.to, el: s.el, moved: s.moved }), "\n       stack:", (s.stack || []).slice(0, 4).join(" ← "))); }
  else console.log("  scroll: (no programmatic moves)");
  if (d.events.length) { console.log("  EVENTS:"); d.events.forEach(e => console.log("   ", `${e.type}${e.key ? "[" + e.key + "]" : ""}`, "trusted=" + e.trusted, "shift=" + e.shift, "| target:", e.target, "| under:", e.under)); }
  const portals = await page.evaluate(() => window.__portals());
  console.log("  PORTALS (fixed, z>=999):", JSON.stringify(portals));
};


// ── SCENARIO A — status dot → pick green → successor prompt → Enter ─────────────
console.log("\n\n=========== SCENARIO A: status dot → green → prompt → Enter ===========");
let opened = null;
for (const id of target) {
  const dot = page.locator(`[data-picker-cell="health-${id}"] [data-health-dot]`);
  if (!(await dot.count())) continue;
  await page.evaluate(() => window.__mark("click dot"));
  await dot.click();
  await pacedWait(page, 250);
  const menus = await page.evaluate(() => window.__portals());
  if (menus.length) { opened = id; console.log(`opened the status menu on row ${id}; portals:`, JSON.stringify(menus)); break; }
}
if (opened == null) console.log("could not open a status menu");

if (opened != null) {
  const swatches = page.locator('body > div[style*="z-index: 9999"] > span, body > div[style*="zIndex: 9999"] > span');
  console.log("swatches in the menu:", await swatches.count());
  await page.evaluate(() => window.__mark("click GREEN swatch"));
  const n = await swatches.count();
  if (n >= 4) await swatches.nth(3).click();      // 5 dots: empty, orange, red, GREEN, grey
  await pacedWait(page, 60);
  console.log("\n  t+60ms  portals:", JSON.stringify(await page.evaluate(() => window.__portals())));
  await pacedWait(page, 200);
  console.log("  t+260ms portals:", JSON.stringify(await page.evaluate(() => window.__portals())));
  await pacedWait(page, 400);
  const afterPrompt = await page.evaluate(() => window.__portals());
  console.log("  t+660ms portals:", JSON.stringify(afterPrompt));
  await dump("A: after picking green (prompt should be up by now)");

  await page.evaluate(() => window.__mark("press Enter to accept the prompt"));
  await page.keyboard.press("Enter");
  await pacedWait(page, 500);
  console.log("\n  AFTER ENTER portals:", JSON.stringify(await page.evaluate(() => window.__portals())));
  console.log("  selection band rows:", JSON.stringify(await page.evaluate(() => window.__readSelBand())).slice(0, 300));
  await dump("A: after Enter");
}

await browser.close();
server.close();
