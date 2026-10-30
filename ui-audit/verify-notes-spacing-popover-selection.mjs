/* verify-notes-spacing-popover-selection — three owner items on the Notes toolbar and boxes
 * (2026-10-30), judged in a real browser:
 *
 *   NEW-1  line spacing goes tighter than 1.0 (0.8 / 0.9 added) — round-trips through apply,
 *          Apply-to-whole-page, Reset, save and reload; 0.8 does not clip glyphs in a list item, a
 *          table cell or large type, and the selection highlight still tiles the lines.
 *   NEW-2  every control in every toolbar dropdown sits INSIDE its dropdown, and the dropdown sits
 *          inside the window, at several window widths (browser zoom shrinks the CSS viewport,
 *          so a narrow window IS a high zoom).
 *   NEW-3  a clicked (or being-typed-in) Notes box paints no background fill — border and handles
 *          only — in light AND dark, on hover and multi-select, with text selection still visible.
 *
 * ⛔ KNOWN-GOOD ARMS (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): a run that opened ZERO dropdowns, or whose
 * selected box was never actually selected, is VOID and says so rather than printing a score. The
 * containment check also carries a PLANTED-OVERFLOW arm that must be reported as escaping, so the
 * instrument is proven able to see the defect before its silence is believed.
 *
 * ⛔ EVERY PERSISTENCE VERDICT READS THE STORED DOCUMENT, then re-reads it after a reload
 * (carry-forward trap 6); the 600 ms save debounce is polled, never slept past.
 */
import { chromium } from "playwright";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:4173";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] });

let pass = 0; let fail = 0; let voided = 0;
const failures = [];
const ok = (label, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};
const voidRun = (label) => { voided += 1; failures.push(`VOID — ${label}`); console.log(`  ⚠ VOID — ${label}`); };

const T = (t, marks) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });
const P = (...c) => ({ type: "paragraph", content: c });
const LI = (...c) => ({ type: "listItem", content: c });
const size = (px) => [{ type: "textStyle", attrs: { fontSize: `${px}px` } }];
const BIG_WORD = "WWWW WWWW WWWW WWWW WWWW WWWW WWWW WWWW WWWW WWWW WWWW WWWW";

/** One box per case, spread out so none overlaps another. Texts are unique so a lookup is by text. */
const DOC = {
  type: "doc",
  content: [
    { type: "noteAnchor", attrs: { x: 60, y: 40, w: 300 }, content: [P(T("PLAIN one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen")), P(T("PLAIN second paragraph"))] },
    { type: "noteAnchor", attrs: { x: 60, y: 300, w: 300 }, content: [{ type: "bulletList", content: [LI(P(T("LISTITEM alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu"))), LI(P(T("LISTITEM second item")))] }] },
    { type: "noteAnchor", attrs: { x: 60, y: 560, w: 360 }, content: [{
      type: "table", content: [
        { type: "tableRow", content: [{ type: "tableCell", attrs: {}, content: [P(T("CELLONE alpha beta gamma delta epsilon zeta eta"))] }, { type: "tableCell", attrs: {}, content: [P(T("CELLTWO second cell with words"))] }] },
      ],
    }] },
    { type: "noteAnchor", attrs: { x: 460, y: 40, w: 420 }, content: [P(T("LARGE size forty-four text here", size(44)))] },
    { type: "noteAnchor", attrs: { x: 460, y: 300, w: 260 }, content: [P(T("TWOLINE " + BIG_WORD))] },
  ],
};

let page; let ctx;
async function open({ width = 1500, height = 950, theme = null } = {}) {
  if (ctx) await ctx.close();
  ctx = await browser.newContext({ viewport: { width, height } });
  page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await assertMeasurable(page, "verify-notes-spacing-popover-selection");
  await page.goto(`${BASE}/#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([treeKey, key, d, th]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Spacing probe", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(key, JSON.stringify(d));
    if (th) localStorage.setItem("planyr:theme", th);
  }, [TREE_KEY, PAGE_KEY, DOC, theme]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { state: "attached", timeout: 30000 });
  /* PHONE DRILL-IN (B849632): below 760px the page list is shown and the editor is display:none
     until a page is opened — a dropdown sweep there is measuring a hidden toolbar (zero-size boxes). */
  if (width < 760 && !(await page.evaluate(() => { const b = document.querySelector('[data-testid="note-body"]'); return !!b && b.getBoundingClientRect().width > 0; }))) {
    await page.locator('[data-testid="notes-row-p1"]').first().click();
  }
  if (width < 760) await page.waitForFunction(() => { const b = document.querySelector('[data-testid="note-body"]'); return !!b && b.getBoundingClientRect().width > 0; }, null, { timeout: 10000 });
  await pacedWait(page, 1200);
  if (theme) await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
}

const storedDoc = () => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }, PAGE_KEY);
const lineHeights = (doc) => {
  const out = [];
  const walk = (n) => { if (!n || typeof n !== "object") return; if (n.type === "paragraph" || n.type === "heading") out.push(n.attrs?.lineHeight ?? null); (n.content || []).forEach(walk); };
  walk(doc);
  return out;
};
async function pollStored(pred, ms = 4000) {
  const end = Date.now() + ms;
  let d = null;
  while (Date.now() < end) { d = await storedDoc(); if (d && pred(d)) return d; await pacedWait(page, 150); }
  return d;
}

/** A REAL Range over a paragraph's text inside the editor (trap 5), via the page's own selection. */
async function selectText(needle, { whole = false } = {}) {
  const found = await page.evaluate(([n]) => {
    const pm = document.querySelector(".ProseMirror");
    const w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = w.nextNode())) {
      const i = node.nodeValue.indexOf(n);
      if (i < 0) continue;
      pm.focus();
      const r = document.createRange();
      r.setStart(node, i); r.setEnd(node, i + n.length);
      const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
      return true;
    }
    return false;
  }, [needle]);
  await pacedWait(page, 250);
  return found;
}

/* ═════════════════════ NEW-2 · containment of every toolbar dropdown ═════════════════════ */

/** For one open dropdown: which of its descendants poke outside it, and does it fit the window? */
function containmentProbe() {
  return page.evaluate(() => {
    const fixed = [...document.querySelectorAll("body *")].filter((el) => {
      const cs = getComputedStyle(el);
      return cs.position === "fixed" && cs.zIndex === "300" && cs.visibility !== "hidden";
    });
    return fixed.map((pop) => {
      const pr = pop.getBoundingClientRect();
      const escapes = [];
      for (const el of pop.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        // a scroll container clips its own children on purpose; only the container's box counts
        let clipped = false;
        for (let a = el.parentElement; a && a !== pop; a = a.parentElement) {
          const o = getComputedStyle(a);
          if (/(auto|scroll|hidden|clip)/.test(o.overflowX + o.overflowY)) { clipped = true; break; }
        }
        if (clipped) continue;
        if (r.left < pr.left - 0.5 || r.right > pr.right + 0.5 || r.top < pr.top - 0.5 || r.bottom > pr.bottom + 0.5) {
          escapes.push({ tag: el.tagName, tid: el.getAttribute("data-testid") || el.getAttribute("aria-label") || (el.textContent || "").slice(0, 14),
            over: Math.round(Math.max(pr.left - r.left, r.right - pr.right, pr.top - r.top, r.bottom - pr.bottom)) });
        }
      }
      return {
        tid: pop.getAttribute("data-testid") || "(unnamed)",
        box: { l: Math.round(pr.left), r: Math.round(pr.right), t: Math.round(pr.top), b: Math.round(pr.bottom) },
        win: { w: window.innerWidth, h: window.innerHeight },
        offscreen: pr.left < -0.5 || pr.right > window.innerWidth + 0.5 || pr.top < -0.5,
        sideScroll: pop.scrollWidth > pop.clientWidth + 1,
        escapes,
      };
    });
  });
}

const SKIP = /back|undo|redo|bold|italic|underline|strike|bullet|numbered|indent|outdent|link|quote|code|divider|image|attach|print|export|history|outline|find|superscript|subscript/i;
const KEEP = /more|spacing|colou?r|highlight|font|size|style|align|list|insert|table|callout|fill/i;

/** Every enabled toolbar button, keyed by testid/label — including the ones folded into the More sheet. */
/* ⛔ THE FIRST [data-testid="note-toolbar"] IN THE DOM CAN BE A display:none COPY (the narrow layout keeps
 * one mounted), so a bare querySelector drove a hidden bar and every dropdown it opened measured 0×0.
 * Only roots with a real box count. */
const toolbarButtons = () => page.evaluate(() => {
  const roots = [...document.querySelectorAll('[data-testid="note-toolbar"], [data-testid="note-toolbar-more"]')].filter((r) => r.getBoundingClientRect().width > 0);
  const seen = new Set(); const out = [];
  for (const r of roots) for (const b of r.querySelectorAll("button")) {
    if (b.disabled || seen.has(b)) continue; seen.add(b);
    out.push({ tid: b.getAttribute("data-testid") || "", label: b.getAttribute("aria-label") || b.title || "" });
  }
  return out;
});
const clickButton = (t) => page.evaluate(({ tid, label }) => {
  const roots = [...document.querySelectorAll('[data-testid="note-toolbar"], [data-testid="note-toolbar-more"]')].filter((r) => r.getBoundingClientRect().width > 0);
  for (const r of roots) for (const b of r.querySelectorAll("button")) {
    if (b.disabled) continue;
    if ((tid && b.getAttribute("data-testid") === tid) || (!tid && (b.getAttribute("aria-label") || b.title || "") === label)) { b.click(); return true; }
  }
  return false;
}, t);

async function sweepDropdowns(width) {
  await open({ width });
  await selectText("PLAIN one two");
  const narrow = width < 760;
  if (narrow) { await clickButton({ tid: "nt-more", label: "" }); await pacedWait(page, 300); }
  const triggers = (await toolbarButtons()).filter((t) => {
    const k = `${t.tid} ${t.label}`;
    return !(SKIP.test(k) && !KEEP.test(k)) && t.tid !== "nt-more" && t.tid !== "notes-mobile-back";   // the back arrow leaves the page, it opens nothing
  });
  let opened = 0;
  const seen = [];
  for (const t of triggers) {
    await selectText("PLAIN one two");
    /* select FIRST, then open the More sheet — focusing the editor after it opens hides the sheet
       (display:none) while its popover stays mounted, which reads as a zero-size dropdown. */
    const moreVisible = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="note-toolbar-more"]')].some((m) => m.getBoundingClientRect().width > 0));
    if (narrow) {
      for (let k = 0; k < 3 && !(await moreVisible()); k += 1) { await clickButton({ tid: "nt-more", label: "" }); await pacedWait(page, 300); }
      if (process.env.DEBUG_SWEEP) console.log("    DEBUG more visible:", await moreVisible());
    }
    const before = (await containmentProbe()).length;
    const hit = await clickButton(t);
    await pacedWait(page, 280);
    const pops = hit ? await containmentProbe() : [];
    if (process.env.DEBUG_SWEEP) console.log("    DEBUG", t.tid || t.label, JSON.stringify(pops.map((p) => [p.tid, p.box])), await page.evaluate(() => {
      const pop = [...document.querySelectorAll("body *")].find((e) => /panel|menu|popover/.test(e.getAttribute("data-testid") || "") && getComputedStyle(e).zIndex === "300");
      const chain = []; for (let a = pop; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); chain.push(`${a.tagName}[${a.getAttribute("data-testid") || ""}] d=${cs.display} v=${cs.visibility} tf=${cs.transform === "none" ? "-" : "T"} pos=${cs.position}`); }
      return chain.join(" < ");
    }));
    if (pops.length > before) {
      opened += 1;
      for (const p of pops) {
        const key = `${p.tid}@${width}`;
        if (seen.includes(key)) continue;
        seen.push(key);
        ok(`NEW-2 · ${width}px · ${p.tid} (${t.label || t.tid}) — every control inside the dropdown`, p.escapes.length === 0,
          p.escapes.length ? `escaping: ${p.escapes.map((e) => `${e.tag}[${e.tid}] by ${e.over}`).join(", ")}` : "");
        ok(`NEW-2 · ${width}px · ${p.tid} — dropdown fully on screen`, !p.offscreen && p.box.r > p.box.l, `box ${JSON.stringify(p.box)} in ${p.win.w}×${p.win.h}`);
        ok(`NEW-2 · ${width}px · ${p.tid} — no sideways scroll inside it`, !p.sideScroll);
      }
    }
    await page.keyboard.press("Escape");
    await pacedWait(page, 120);
  }
  console.log(`    ${width}px: tried ${triggers.length} buttons, ${opened} opened a dropdown: ${seen.join(", ")}`);
  if (!opened) voidRun(`${width}px: no dropdown opened at all — the sweep could not see anything`);
  return seen;
}

/** PLANTED-OVERFLOW arm: the probe must flag a child that really hangs out of a fixed z300 box. */
async function plantedArm() {
  await open({ width: 1200 });
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.setAttribute("data-testid", "planted");
    d.style.cssText = "position:fixed;z-index:300;left:100px;top:100px;width:100px;height:40px;background:#fff;border:1px solid #000";
    d.innerHTML = '<span style="position:absolute;left:90px;top:5px;width:60px;height:20px;background:red"></span>';
    document.body.appendChild(d);
  });
  const p = (await containmentProbe()).find((x) => x.tid === "planted");
  ok("KNOWN-GOOD ARM · the containment probe flags a planted overflow", !!p && p.escapes.length === 1, p ? `escapes ${p.escapes.length}` : "probe never saw it");
}

/** Per-row count of pixels that differ between two same-size PNGs — colour-agnostic, so it does not care
 *  that this app paints ::selection in the Notes accent rather than the browser's blue. */
async function rowDiff(a, b) {
  return page.evaluate(async ([ax, bx]) => {
    const load = async (b64) => { const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode(); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height); };
    const A = await load(ax); const B = await load(bx);
    const rows = [];
    for (let y = 0; y < A.height; y++) { let n = 0; for (let x = 0; x < A.width; x++) { const i = (y * A.width + x) * 4; if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 40) n += 1; } rows.push(n); }
    return { rows, h: A.height, total: rows.reduce((p, q) => p + q, 0) };
  }, [a.toString("base64"), b.toString("base64")]);
}

/* ═════════════════════ NEW-1 · spacing round trip ═════════════════════ */

/* ⛔ REAL CLICKS ONLY on anything that must PERSIST: the editor saves only after a genuine isTrusted
 * input (hasUserInputRef, B1662464), so an element.click() from page.evaluate changes the screen and
 * is never written — which read as "0.8 is not stored" on the first run of this harness. */
async function openSpacing() {
  if (!(await page.locator('[data-testid="nt-spacing-panel"]').count())) await page.locator('[data-testid="nt-spacing"]').click();
  await page.waitForSelector('[data-testid="nt-spacing-panel"]', { timeout: 5000 });
  await pacedWait(page, 150);
}
const pickLine = async (id) => { await page.locator(`[data-testid="nt-spacing-line-${id}"]`).click(); await pacedWait(page, 200); };
const isHighlighted = (id) => page.evaluate((i) => {
  const b = document.querySelector(`[data-testid="nt-spacing-line-${i}"]`);
  return !!b && getComputedStyle(b).backgroundColor === getComputedStyle(document.documentElement).getPropertyValue("--accent-notes").trim() || (b && b.style.background.includes("--accent-notes"));
}, id);

async function spacingSection() {
  await open({ width: 1500 });
  ok("NEW-1 · the grid offers 0.8, 0.9, 1.0, 1.15, 1.50, 2.0 in that order", await (async () => {
    await selectText("PLAIN one two");
    await openSpacing();
    const labels = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="nt-spacing-line-"]')].filter((b) => b.tagName === "BUTTON").map((b) => b.textContent.trim()));
    console.log("    labels:", labels.join(" / "));
    return JSON.stringify(labels) === JSON.stringify(["0.8", "0.9", "1.0", "1.15", "1.50", "2.0"]);
  })());

  for (const id of ["0.8", "0.9"]) {
    await pickLine(id);
    const want = Number(id);
    const d = await pollStored((doc) => lineHeights(doc).includes(want));
    ok(`NEW-1 · ${id} applied to a selection is STORED`, lineHeights(d).includes(want), `stored line heights ${JSON.stringify(lineHeights(d))}`);
    ok(`NEW-1 · ${id} — only the selected paragraph changed`, lineHeights(d).filter((x) => x === want).length === 1);
    const renderedLH = await page.evaluate(() => {
      const p = [...document.querySelectorAll(".ProseMirror p")].find((e) => e.textContent.startsWith("PLAIN one"));
      const cs = getComputedStyle(p);
      return { lh: parseFloat(cs.lineHeight), fs: parseFloat(cs.fontSize) };
    });
    ok(`NEW-1 · ${id} — the screen honours it (line box = ${id} × font size)`, Math.abs(renderedLH.lh - renderedLH.fs * want) < 0.6, `${renderedLH.lh}px / ${renderedLH.fs}px`);
    await selectText("PLAIN one two");
    await openSpacing();
    ok(`NEW-1 · ${id} — the selected value highlights when the dropdown reopens`, await page.evaluate((i) => {
      const b = document.querySelector(`[data-testid="nt-spacing-line-${i}"]`);
      const others = [...document.querySelectorAll('[data-testid^="nt-spacing-line-"]')].filter((x) => x.tagName === "BUTTON" && x !== b);
      return b.style.background.includes("accent-notes") && others.every((o) => !o.style.background.includes("accent-notes"));
    }, id));
  }

  // reload round trip at 0.8
  await pickLine("0.8");
  await pollStored((doc) => lineHeights(doc).includes(0.8));
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 30000 });
  await pacedWait(page, 1200);
  const afterReload = await storedDoc();
  ok("NEW-1 · 0.8 survives a reload (stored document re-read)", lineHeights(afterReload).includes(0.8), JSON.stringify(lineHeights(afterReload)));
  ok("NEW-1 · 0.8 survives a reload (rendered)", await page.evaluate(() => {
    const p = [...document.querySelectorAll(".ProseMirror p")].find((e) => e.textContent.startsWith("PLAIN one"));
    const cs = getComputedStyle(p);
    return Math.abs(parseFloat(cs.lineHeight) - parseFloat(cs.fontSize) * 0.8) < 0.6;
  }));

  // Apply to whole page at 0.8, then Reset
  await selectText("PLAIN one two");
  await openSpacing();
  await page.locator('[data-testid="nt-spacing-whole-page"]').click();
  const whole = await pollStored((doc) => lineHeights(doc).every((x) => x === 0.8));
  ok("NEW-1 · Apply to whole page at 0.8 reaches every paragraph", lineHeights(whole).length > 3 && lineHeights(whole).every((x) => x === 0.8), JSON.stringify(lineHeights(whole)));
  await selectText("PLAIN one two");
  await openSpacing();
  await page.locator('[data-testid="nt-spacing-reset"]').click();
  const reset = await pollStored((doc) => lineHeights(doc)[0] == null);
  ok("NEW-1 · Reset clears the selected paragraph back to the note's own spacing", lineHeights(reset)[0] == null, JSON.stringify(lineHeights(reset)));

  /* ── 0.8 does not clip glyphs, and the highlight still tiles the lines ── */
  await selectText("PLAIN one two");
  await openSpacing();
  await pickLine("0.8");
  await page.locator('[data-testid="nt-spacing-whole-page"]').click();   // …then 0.8 on every paragraph
  await pollStored((doc) => lineHeights(doc).every((x) => x === 0.8));
  await page.keyboard.press("Escape");
  await pacedWait(page, 400);

  const clip = await page.evaluate(() => {
    const out = [];
    const pm = document.querySelector(".ProseMirror");
    const w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!n.nodeValue.trim()) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      const rects = [...r.getClientRects()];
      if (!rects.length) continue;
      let el = n.parentElement;
      const clippers = [];
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (/(hidden|clip)/.test(cs.overflowX + cs.overflowY) && a !== document.querySelector(".planyr-note")) clippers.push(a);
      }
      for (const c of clippers) {
        const cr = c.getBoundingClientRect();
        for (const rr of rects) {
          if (rr.top < cr.top - 0.5 || rr.bottom > cr.bottom + 0.5) {
            out.push({ text: n.nodeValue.slice(0, 20), by: c.className || c.tagName, top: Math.round(cr.top - rr.top), bottom: Math.round(rr.bottom - cr.bottom) });
          }
        }
      }
    }
    return out;
  });
  ok("NEW-1 · at 0.8 no glyph run sits outside an overflow-clipping ancestor (list item, table cell, large type, box)", clip.length === 0, clip.length ? JSON.stringify(clip.slice(0, 4)) : "");

  const rowsAt08 = await page.evaluate(() => {
    const pick = (s) => [...document.querySelectorAll(".ProseMirror p")].find((e) => e.textContent.startsWith(s));
    const row = (s) => { const p = pick(s); const cs = getComputedStyle(p); return { lh: parseFloat(cs.lineHeight), fs: parseFloat(cs.fontSize), inLi: !!p.closest("li"), inCell: !!p.closest("td,th") }; };
    return { li: row("LISTITEM alpha"), cell: row("CELLONE"), big: row("LARGE") };
  });
  ok("NEW-1 · 0.8 reaches list items", rowsAt08.li.inLi && Math.abs(rowsAt08.li.lh - rowsAt08.li.fs * 0.8) < 0.6, JSON.stringify(rowsAt08.li));
  ok("NEW-1 · 0.8 reaches table cells", rowsAt08.cell.inCell && Math.abs(rowsAt08.cell.lh - rowsAt08.cell.fs * 0.8) < 0.6, JSON.stringify(rowsAt08.cell));
  ok("NEW-1 · 0.8 reaches large type", Math.abs(rowsAt08.big.lh - rowsAt08.big.fs * 0.8) < 0.6, JSON.stringify(rowsAt08.big));

  // highlight tiling: select the two-line W paragraph, paint, look for an un-highlighted gap between its lines
  // ENTER the box with two real presses first — a range inside a box that is not entered paints no highlight
  {
    const b = await boxInfo("TWOLINE");
    await page.mouse.click(b.x + b.w * 0.5, b.y + b.h * 0.5); await pacedWait(page, 300);
    await page.mouse.click(b.x + b.w * 0.5, b.y + b.h * 0.5); await pacedWait(page, 350);
  }
  await page.evaluate(() => {
    const p = [...document.querySelectorAll(".ProseMirror p")].find((e) => e.textContent.startsWith("TWOLINE"));
    const r = document.createRange(); r.selectNodeContents(p);
    document.querySelector(".ProseMirror").focus();
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await pacedWait(page, 300);
  const geo = await page.evaluate(() => {
    const p = [...document.querySelectorAll(".ProseMirror p")].find((e) => e.textContent.startsWith("TWOLINE"));
    const r = document.createRange(); r.selectNodeContents(p.firstChild);
    const rects = [...r.getClientRects()];
    const pr = p.getBoundingClientRect();
    return { x: Math.round(pr.left + 24), top: Math.round(pr.top), bottom: Math.round(pr.bottom), lines: new Set(rects.map((q) => Math.round(q.top))).size };
  });
  const clipBox = { x: geo.x - 20, y: geo.top - 2, width: 80, height: geo.bottom - geo.top + 4 };
  const withSel = await page.screenshot({ clip: clipBox });
  await page.evaluate(() => { const g = document.getSelection(); const c = g.getRangeAt(0).cloneRange(); c.collapse(true); g.removeAllRanges(); g.addRange(c); });
  await pacedWait(page, 250);
  const noSel = await page.screenshot({ clip: clipBox });
  const rowsInfo = await rowDiff(withSel, noSel);
  if (process.env.DEBUG_SWEEP) { const fs = await import("node:fs"); fs.writeFileSync("/tmp/claude-0/hl-with.png", withSel); fs.writeFileSync("/tmp/claude-0/hl-no.png", noSel); console.log("    DEBUG hl", JSON.stringify(geo), JSON.stringify(clipBox), rowsInfo.total); }
  const first = rowsInfo.rows.findIndex((n) => n > 0);
  const last = rowsInfo.rows.length - 1 - [...rowsInfo.rows].reverse().findIndex((n) => n > 0);
  const gaps = first < 0 ? [] : rowsInfo.rows.slice(first, last + 1).map((n, i) => (n === 0 ? first + i : -1)).filter((i) => i >= 0);
  if (first < 0 || geo.lines < 2) voidRun(`selection highlight arm saw no highlight (${first}) or fewer than 2 lines (${geo.lines})`);
  else ok("NEW-1 · at 0.8 the selection highlight tiles both lines with no unhighlighted row between them", gaps.length === 0, `highlight rows ${first}–${last} of ${rowsInfo.h}, ${geo.lines} lines, gaps ${JSON.stringify(gaps)}`);

  // caret height at 0.8
  await page.evaluate(() => {
    const p = [...document.querySelectorAll(".ProseMirror p")].find((e) => e.textContent.startsWith("PLAIN one"));
    document.querySelector(".ProseMirror").focus();
    const r = document.createRange(); r.setStart(p.firstChild, 4); r.collapse(true);
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  const caret = await page.evaluate(() => {
    const r = document.getSelection().getRangeAt(0).cloneRange();
    const q = r.getClientRects()[0] || r.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(document.getSelection().anchorNode.parentElement).fontSize);
    return { h: q.height, fs };
  });
  console.log("    caret height at 0.8:", JSON.stringify(caret));
  ok("NEW-1 · caret height at 0.8 is a sensible fraction of the type (0.7–1.4 × font size)", caret.h >= caret.fs * 0.7 && caret.h <= caret.fs * 1.4, `${caret.h.toFixed(1)}px for ${caret.fs}px type`);
}

/* ═════════════════════ NEW-3 · a clicked box paints no fill ═════════════════════ */

const boxInfo = (text) => page.evaluate((t) => {
  const box = [...document.querySelectorAll(".planyr-anchor")].find((b) => b.textContent.includes(t));
  if (!box) return null;
  const cs = getComputedStyle(box);
  const r = box.getBoundingClientRect();
  return { bg: cs.backgroundColor, bgImage: cs.backgroundImage, bw: parseFloat(cs.borderTopWidth), bc: cs.borderTopColor, selected: box.getAttribute("data-selected") === "1", editing: box.getAttribute("data-editing") === "1",
    cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), w: r.width, h: r.height, x: r.left, y: r.top };
}, text);
const transparent = (c) => c === "rgba(0, 0, 0, 0)" || c === "transparent";

async function selectionSection(theme) {
  await open({ width: 1500, theme });
  const tag = theme ? ` (${theme})` : "";
  const before = await boxInfo("PLAIN one");
  ok(`NEW-3${tag} · unselected box is unchanged — transparent, no fill`, before && transparent(before.bg), before ? before.bg : "box missing");

  // press 1 selects
  const spot = async (t) => { const b = await boxInfo(t); return { x: b.x + b.w * 0.5, y: b.y + b.h * 0.5 }; };
  let s = await spot("PLAIN one");
  await page.mouse.click(s.x, s.y);
  await pacedWait(page, 350);
  const sel = await boxInfo("PLAIN one");
  if (!sel || !sel.selected) voidRun(`${tag} the box was never selected by a real press — selected-state arm is VOID`);
  else {
    ok(`NEW-3${tag} · a SELECTED box paints no background (colour transparent)`, transparent(sel.bg), `background-color ${sel.bg}`);
    ok(`NEW-3${tag} · a SELECTED box paints no background image/gradient`, sel.bgImage === "none", sel.bgImage);
    ok(`NEW-3${tag} · …but still shows its border (accent, solid)`, sel.bw >= 1 && !transparent(sel.bc), `border ${sel.bw}px ${sel.bc}`);
    const handles = await page.evaluate(() => {
      const box = [...document.querySelectorAll(".planyr-anchor")].find((b) => b.textContent.includes("PLAIN one"));
      const hs = [...box.querySelectorAll(".planyr-anchor-h")];
      return { n: hs.length, shown: hs.filter((h) => getComputedStyle(h).opacity === "1").length };
    });
    ok(`NEW-3${tag} · …and its handles are still revealed`, handles.n > 0 && handles.shown === handles.n, JSON.stringify(handles));
  }

  // hover another (unselected) box
  const other = await boxInfo("LISTITEM alpha");
  await page.mouse.move(other.x + other.w / 2, other.y + other.h / 2);
  await pacedWait(page, 250);
  const hov = await boxInfo("LISTITEM alpha");
  ok(`NEW-3${tag} · hovering an unselected box paints no fill`, transparent(hov.bg), hov.bg);

  // multi-select with Shift+click on a second box (trap 8: page.mouse.click drops modifiers → hold the key)
  s = await spot("LISTITEM alpha");
  await page.keyboard.down("Shift");
  await page.mouse.click(s.x, s.y);
  await page.keyboard.up("Shift");
  await pacedWait(page, 350);
  const m1 = await boxInfo("PLAIN one"); const m2 = await boxInfo("LISTITEM alpha");
  if (!(m1.selected && m2.selected)) voidRun(`${tag} multi-select never produced two selected boxes (${m1.selected}, ${m2.selected})`);
  else ok(`NEW-3${tag} · two boxes selected together: neither paints a fill`, transparent(m1.bg) && transparent(m2.bg), `${m1.bg} | ${m2.bg}`);

  // a table box
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await pacedWait(page, 200);
  const tb = await boxInfo("CELLONE");
  // press the box's own border band (a click on the middle of a cell would enter text, not select the box)
  await page.mouse.click(tb.x + tb.w * 0.3, tb.y + 1);
  await pacedWait(page, 350);
  const tsel = await boxInfo("CELLONE");
  if (!tsel.selected) voidRun(`${tag} the table box was never selected`);
  else {
    ok(`NEW-3${tag} · a SELECTED box holding a table paints no fill`, transparent(tsel.bg), tsel.bg);
    const cellPaint = await page.evaluate(() => {
      const box = [...document.querySelectorAll(".planyr-anchor")].find((b) => b.textContent.includes("CELLONE"));
      return [...box.querySelectorAll("td,th")].map((c) => ({ bg: getComputedStyle(c).backgroundColor, sel: c.classList.contains("selectedCell") }));
    });
    ok(`NEW-3${tag} · …and none of its table cells is tinted by merely selecting the box`, cellPaint.every((c) => !c.sel), JSON.stringify(cellPaint));
  }

  // editing (press 2) then text selection inside
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  s = await spot("PLAIN one");
  await page.mouse.click(s.x, s.y); await pacedWait(page, 300);
  await page.mouse.click(s.x, s.y); await pacedWait(page, 350);
  const ed = await boxInfo("PLAIN one");
  if (!ed.editing) voidRun(`${tag} the second press never entered the box`);
  else {
    ok(`NEW-3${tag} · an EDITING box paints no background either`, transparent(ed.bg), ed.bg);
    const ws = await boxInfo("PLAIN one");
    const sb = await boxInfo("PLAIN one");
    ok(`NEW-3${tag} · editing is still told apart from selected — by the heavier border`, ed.bw > 1 && sb.bw > 1, `editing border ${ed.bw}px`);
    // text selection still shows
    await page.evaluate(() => {
      const box = [...document.querySelectorAll(".planyr-anchor")].find((b) => b.textContent.includes("PLAIN one"));
      const p = box.querySelector("p");
      const r = document.createRange(); r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, 24);
      const g = document.getSelection(); g.removeAllRanges(); g.addRange(r);
    });
    await pacedWait(page, 250);
    const rect = { x: Math.max(0, ws.x), y: ws.y, width: Math.min(ws.w, 300), height: Math.min(ws.h, 60) };
    const withSel = await page.screenshot({ clip: rect });
    await page.evaluate(() => { const g = document.getSelection(); const r = g.getRangeAt(0); const c = r.cloneRange(); c.collapse(true); g.removeAllRanges(); g.addRange(c); });
    await pacedWait(page, 250);
    const noSel = await page.screenshot({ clip: rect });
    const blue = (await rowDiff(withSel, noSel)).total;
    ok(`NEW-3${tag} · text selection highlight inside the box still shows`, blue > 200, `${blue} highlight pixels`);
  }
}

/* ═════════════════════ run ═════════════════════ */

const ONLY = process.env.ONLY || "all";   // all | dropdowns | spacing | selection
if (ONLY === "all" || ONLY === "dropdowns") {
  console.log("— known-good arm");
  await plantedArm();
  console.log("— NEW-2 · every toolbar dropdown stays inside itself and on screen");
  for (const w of (process.env.WIDTHS ? process.env.WIDTHS.split(",").map(Number) : [1500, 1100, 800, 560, 390])) { console.log(`  · window ${w}px wide`); await sweepDropdowns(w); }
}
if (ONLY === "all" || ONLY === "spacing") {
  console.log("— NEW-1 · line spacing 0.8 / 0.9");
  await spacingSection();
}
if (ONLY === "all" || ONLY === "selection") {
  console.log("— NEW-3 · selected box has no fill");
  await selectionSection(null);
  await selectionSection("dark");
}

if (ctx) await ctx.close(); await browser.close();
console.log(`\n${pass} passed · ${fail} failed · ${voided} void`);
if (failures.length) { console.log("\nNOT GREEN:"); failures.forEach((f) => console.log("  - " + f)); }
process.exit(fail || voided ? 1 : 0);
