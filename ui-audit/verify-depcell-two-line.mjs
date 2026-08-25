/* B655552 — the Schedule grid's predecessor/successor cell (`DepCell`, public/sequence/index.html)
 * had two distinct, owner-reported defects:
 *   (A) the second line renders but gets sliced off mid-glyph at the row's bottom edge — half a
 *       line bleeding into the row below, which reads as corruption.
 *   (B) a single link ellipsizes on line 1 while line 2 sits empty, instead of wrapping the name
 *       into the otherwise-unused second line.
 * B655552 fixed both, but gated two-line rendering on a 24px threshold (10px font / 12px natural
 * line-height) — below it, DepCell fell back to one line + a "+N" badge. That fallback was never
 * something the owner asked for. His OWN saved row-height setting (confirmed via a read-only
 * Supabase query against his real `planar_data` row, key 'hs-v1') is 20 — the slider's floor — so
 * EVERY predecessor/successor cell on his real schedule hit that fallback, which he rejected by
 * name: "all you gave me was a '+1'".
 *
 * B655552 (round 2) (2026-08-25) — shown the honest tradeoff (a taller row, changing the whole grid, vs.
 * smaller text in just this cell) the owner chose to shrink the text. Re-measured against the REAL
 * Inter font (self-hosted @font-face, not a fallback sans-serif — the original "10px/1.2" claim was
 * re-verified live rather than trusted): for this font the natural non-clipping line-height is
 * exactly font-size+2px at every size tried (10→12, 9→11, 8→10, 7→9 — anything tighter clips, both
 * measured). DEPCELL_FONT_SIZE 8 / DEPCELL_LINE_H 10 is the largest size in that series whose
 * two-line total (20px) still fits the 20px floor with zero clipping — same box-equals-ink
 * relationship the original 10/12 pair already shipped safely at. This makes canTwoLine TRUE across
 * the entire 20-34 slider range, so the one-line "+N" fallback is no longer reachable from the
 * grid/split view at all (only from MasterView's own separate, unrelated DepCell call site).
 * B655552 (round 2) also adds the owner's new, explicit ask: hovering a cell must show the FULL name of
 * every predecessor/successor, not just what fits on screen.
 *
 * This harness drives the REAL Format-panel row-height slider (not a data-injection shortcut —
 * ROW_H is a plain module variable updated inside a useEffect, so seeding settings.rowHeight in
 * the boot payload only takes effect on a LATER render; the slider's onChange goes through the
 * same live-update path a real user's drag uses) and asserts, in a real headless Chromium:
 *   1. NEVER any clipping (scrollHeight > clientHeight, or a slot's own rendered height dropping
 *      below its natural ~10px) on the cell wrap or its content, at any row-height setting the
 *      slider can produce (20 to 34) — including 20 itself, which is the whole point of this fix.
 *   2. At/above the threshold (now 20, i.e. ALWAYS within the slider's range), a single long link
 *      WRAPS onto 2 lines instead of staying single-line-ellipsized.
 *   3. Below the threshold — unreachable via the slider now, kept as a structural check in case the
 *      constant ever regresses upward — exactly one line renders, never a partial second line.
 *   4. Whenever items are hidden (a 3rd link, at any height), a "+N" indicator is visible — nothing
 *      is ever silently dropped.
 *   5. Hovering ANY cell with 1+ items reveals the FULL, untruncated name of EVERY item (not just
 *      the visible ones) via the native `title` tooltip — proven by reading the DOM `title`
 *      attribute directly, not by simulating a real hover (jsdom-free: this is a real browser, but
 *      the browser's own tooltip bubble is an OS-level paint, not part of the DOM the harness can
 *      screenshot reliably — reading the attribute the browser would render from is the correct,
 *      stable proxy for "what the tooltip says").
 *
 * ALL FIVE assertion classes are mutation-proven against the REAL source (string-patching the
 * served HTML, never a hand-written paraphrase) — Pass 2/3 were built with the original fix;
 * Pass 4/5 were added during the B655552 close-out audit, when it was pointed out that assertion 4
 * (the "+N" indicator) and half of assertion 3 (the below-threshold slot count) had only ever been
 * run against the real source — nothing had proven they could catch a regression; Pass 6/7 were
 * added with B655552 (round 2)'s hover feature:
 *   Pass 2 — revert the vertical padding to "2px 8px"            → catches defect A's clip
 *   Pass 3 — force DEPCELL_TWO_LINE_MIN_H to Infinity             → catches defect B's stuck line
 *   Pass 4 — hardcode the "+N" badge to slot index 1 (never 0)    → catches a silent drop below threshold
 *   Pass 5 — hardcode visibleCount to always 2                    → catches a 2-slot cell re-clipping below threshold
 *   Pass 6 — depCellFullTitle drops every item but the first      → catches a tooltip that silently omits hidden/extra names
 *   Pass 7 — DEPCELL_FONT_SIZE reverted to 10 (undoing the shrink)→ catches the exact regression this item exists to fix (real clipping back at RH=20)
 *
 * Run: node ui-audit/verify-depcell-two-line.mjs      [PW_CHROME=<chrome>]
 * Exit 0 = every assertion holds on the real source AND all seven mutations are caught. Exit 1 = a
 * real regression, or a mutation that slipped through undetected (a check nobody has seen fail).
 *
 * NOT wired into CI (same standing gap as every other `ui-audit/verify-*.mjs` harness — B613760 —
 * this file exists and is runnable, but nothing invokes it automatically). `test/depcellTwoLine.test.js`
 * is the CI-enforced half (source-level: the threshold constant, zero vertical padding, the
 * line-clamp wrap branch, the font-size constant, and the full-title hover helper are all pinned there).
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

// Test tasks: a 2-link case, a 1-link case with a name too long for one line, and a 3-link case —
// inserted right after task id 2 (root level) so they land at low, predictable row indices instead
// of needing to scroll a virtualized ~180-row list to reach them.
function buildTestData(baseJson) {
  const data = JSON.parse(baseJson);
  const proj = data.projects[String(data.aPid)];
  const tasks = proj.tasks;
  const longA = { id: 9001, name: "Hillwood Review of the PID Petition and Supporting Documentation", start: "2026-12-27", end: "2026-12-27", duration: 1, predecessors: [], health: "gray", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true };
  const longB = { id: 9002, name: "PID Petition Submittal to the County Commissioners Court", start: "2026-12-27", end: "2026-12-27", duration: 1, predecessors: [], health: "gray", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true };
  const longC = { id: 9003, name: "Municap to Send the Preliminary Bond Sizing Worksheet", start: "2026-12-27", end: "2026-12-27", duration: 1, predecessors: [], health: "gray", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true };
  const twoLink = { id: 9010, name: "AAA Two-Link Test Task", start: "2027-03-01", end: "2027-03-01", duration: 1, predecessors: [{id:9001,type:"FS",lag:0},{id:9002,type:"FS",lag:0}], health:"gray", percentComplete:0, parentId:null, responsibleParty:"", notes:[], isExpanded:true };
  const oneLink = { id: 9011, name: "AAA One-Link Test Task", start: "2027-03-01", end: "2027-03-01", duration: 1, predecessors: [{id:9003,type:"FS",lag:0}], health:"gray", percentComplete:0, parentId:null, responsibleParty:"", notes:[], isExpanded:true };
  const threeA = { id: 9030, name: "Third Link Alpha", start: "2026-12-27", end: "2026-12-27", duration: 1, predecessors: [], health: "gray", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true };
  const threeLink = { id: 9012, name: "AAA Three-Link Test Task", start: "2027-03-01", end: "2027-03-01", duration: 1, predecessors: [{id:9001,type:"FS",lag:0},{id:9002,type:"FS",lag:0},{id:9030,type:"FS",lag:0}], health:"gray", percentComplete:0, parentId:null, responsibleParty:"", notes:[], isExpanded:true };
  // B655552 (round 2) additions: a lag-labeled predecessor (the "83FS+5d"-style label, an adjacent case named
  // in the owner's brief), an explicit empty-cell task (zero predecessors — must stay blank, no
  // clipping, no stray title), and a successors-column case (predecessors/successors share DepCell,
  // but nothing had exercised the successors column specifically until now).
  const lagLink = { id: 9013, name: "AAA Lag Link Test Task", start: "2027-03-01", end: "2027-03-01", duration: 1, predecessors: [{id:9001,type:"FS",lag:5}], health:"gray", percentComplete:0, parentId:null, responsibleParty:"", notes:[], isExpanded:true };
  const emptyLink = { id: 9014, name: "AAA Empty Link Test Task", start: "2027-03-01", end: "2027-03-01", duration: 1, predecessors: [], health:"gray", percentComplete:0, parentId:null, responsibleParty:"", notes:[], isExpanded:true };
  const succBase = { id: 9020, name: "AAA Succ Base Test Task", start: "2026-12-27", end: "2026-12-27", duration: 1, predecessors: [], health: "gray", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true };
  const succA = { id: 9021, name: "Successor Child Alpha With A Fairly Long Name For Wrap Testing", start: "2027-03-02", end: "2027-03-02", duration: 1, predecessors: [{id:9020,type:"FS",lag:0}], health:"gray", percentComplete:0, parentId:null, responsibleParty:"", notes:[], isExpanded:true };
  const succB = { id: 9022, name: "Successor Child Beta", start: "2027-03-02", end: "2027-03-02", duration: 1, predecessors: [{id:9020,type:"FS",lag:0}], health:"gray", percentComplete:0, parentId:null, responsibleParty:"", notes:[], isExpanded:true };
  const insertAt = tasks.findIndex(t => t.id === 2) + 1;
  tasks.splice(insertAt, 0, longA, longB, longC, twoLink, oneLink, threeA, threeLink, lagLink, emptyLink, succBase, succA, succB);
  return JSON.stringify(data);
}

async function buildServedHtml(mutateSource) {
  let rawHtml = await readFile(join(ROOT, "sequence/index.html"), "utf8");
  if (mutateSource) rawHtml = mutateSource(rawHtml);
  const marker = '<script id="planar-data">window.__PLANAR_DATA__=';
  const startIdx = rawHtml.indexOf(marker);
  if (startIdx === -1) throw new Error("seed data marker not found");
  const jsonStart = startIdx + marker.length;
  const scriptEndIdx = rawHtml.indexOf("</script>", jsonStart);
  const jsonStr = rawHtml.slice(jsonStart, scriptEndIdx).replace(/;\s*$/, "");
  const newJson = buildTestData(jsonStr);
  rawHtml = rawHtml.slice(0, jsonStart) + newJson + ";" + rawHtml.slice(scriptEndIdx);
  return rewriteCdn(rawHtml);
}

async function withServer(rawHtml, fn) {
  const server = createServer(async (req, res) => {
    try {
      if (await serveVendored(req, res)) return;
      const p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/sequence/" || p === "/sequence/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(rawHtml);
      }
      const fp = normalize(join(ROOT, p));
      if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      const body = await readFile(fp);
      res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise(r => server.listen(0, r));
  try {
    return await fn(`http://localhost:${server.address().port}/sequence/`);
  } finally {
    server.close();
  }
}

async function setRowHeight(page, val) {
  const fmtBtn = await page.$('button[title*="Format"]');
  if (!fmtBtn) throw new Error("Format button not found");
  await fmtBtn.click();
  await page.waitForTimeout(150);
  await page.evaluate((v) => {
    const input = document.querySelector('input[type="range"][min="20"][max="34"]');
    if (!input) throw new Error("row-height slider not found");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, String(v));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, val);
  await page.waitForTimeout(250);
  const closeBtn = await page.$('button[title="Close"]');
  if (closeBtn) await closeBtn.click();
  await page.waitForTimeout(150);
}

const TARGETS = [
  { nameMatch: "AAA Two-Link Test Task", colKey: "predecessors", label: "twoLink",
    expectNames: ["Hillwood Review of the PID Petition and Supporting Documentation", "PID Petition Submittal to the County Commissioners Court"] },
  { nameMatch: "AAA One-Link Test Task", colKey: "predecessors", label: "oneLink",
    expectNames: ["Municap to Send the Preliminary Bond Sizing Worksheet"] },
  { nameMatch: "AAA Three-Link Test Task", colKey: "predecessors", label: "threeLink",
    expectNames: ["Hillwood Review of the PID Petition and Supporting Documentation", "PID Petition Submittal to the County Commissioners Court", "Third Link Alpha"] },
  { nameMatch: "AAA Lag Link Test Task", colKey: "predecessors", label: "lagLink",
    expectNames: ["Hillwood Review of the PID Petition and Supporting Documentation"], expectLabelPattern: /FS\+5d/ },
  { nameMatch: "AAA Empty Link Test Task", colKey: "predecessors", label: "emptyLink", expectNames: [] },
  { nameMatch: "AAA Succ Base Test Task", colKey: "successors", label: "twoSucc",
    expectNames: ["Successor Child Alpha With A Fairly Long Name For Wrap Testing", "Successor Child Beta"] },
];

async function measureAt(page, rowHeight) {
  await setRowHeight(page, rowHeight);
  const out = {};
  for (const t of TARGETS) {
    await page.evaluate((nameMatch) => {
      const grid = document.querySelector('[data-grid-scroll="1"]');
      if (!grid) return;
      const matchesName = r => { const nc = r.querySelector('[data-col-key="name"]'); return nc && nc.textContent.includes(nameMatch); };
      const step = grid.clientHeight * 0.8;
      for (let pos = 0; pos <= grid.scrollHeight; pos += step) {
        grid.scrollTop = pos;
        if (Array.from(document.querySelectorAll('.drow[data-task-row]')).find(matchesName)) return;
      }
    }, t.nameMatch);
    await page.waitForTimeout(80);
    const rowId = await page.evaluate((nameMatch) => {
      const matchesName = r => { const nc = r.querySelector('[data-col-key="name"]'); return nc && nc.textContent.includes(nameMatch); };
      const hit = Array.from(document.querySelectorAll('.drow[data-task-row]')).find(matchesName);
      return hit ? hit.getAttribute('data-task-row') : null;
    }, t.nameMatch);
    if (!rowId) { out[t.label] = { error: "row not found" }; continue; }
    out[t.label] = await page.evaluate(({ rowId, colKey }) => {
      const row = document.querySelector(`[data-task-row="${rowId}"]`);
      const wrap = row && row.querySelector(`[data-col-key="${colKey}"]`);
      if (!wrap) return { error: "cell not found" };
      const inner = wrap.firstElementChild;
      const slots = inner ? Array.from(inner.children) : [];
      // NOTE on what counts as "clipped" here: `-webkit-line-clamp` (the single-link wrap branch)
      // and the per-item ellipsis (`text-overflow:ellipsis`, the 2-slot branch) are BOTH intentional
      // truncation — a slot's own scrollHeight/scrollWidth exceeding its clientHeight/clientWidth is
      // the NORMAL, correct reading for either ("there was more text than fit, so it was truncated
      // with an ellipsis"), not a bug. The actual regression class (defect A) is a full single line's
      // rendered BOX being squeezed to LESS than its own natural line height (the old flexbox
      // `minHeight:10` shrinking a 12px line down to 10px, clipping the bottom off every glyph) — so
      // the real invariant is "no slot's clientHeight ever drops below one natural line" (12px, 1px
      // rounding tolerance), never a scrollHeight/clientHeight comparison.
      // B655552 (round 2) — an EXPLICIT line-height (as opposed to the old defect's flexbox minHeight
      // compression) does not show up as scrollHeight>clientHeight at all: the box's height is
      // simply DECLARED to be DEPCELL_LINE_H, and a font whose own ink needs more room than that
      // renders clipped/overlapping glyphs inside an otherwise "unclipped-by-DOM-measurement" box.
      // Range.getBoundingClientRect() reads the actual glyph ink extent, independent of the box's
      // declared CSS height, which is the only way to catch a font-size regression that reintroduces
      // this (a check that only compares clientHeight/scrollHeight would report a false PASS here —
      // proven by running it against a deliberately-reverted font size during this fix's own
      // development, which is exactly why this ink measurement was added rather than assumed safe).
      // Scoped to the MULTI-slot branch (slots.length > 1) only: there, each slot div is exactly one
      // line by construction, so its own ink must fit its own box. The single-item wrap branch's one
      // "slot" is a `-webkit-line-clamp:2` box that legitimately spans up to 2 lines of ink inside a
      // box CSS already sizes for exactly that (line-clamp computes its own height correctly per
      // spec) — comparing its whole-block ink to a per-line box would be a category error, not a bug.
      const inkHeights = slots.length > 1 ? slots.map(s => {
        const r = document.createRange();
        r.selectNodeContents(s);
        return r.getBoundingClientRect().height;
      }) : [];
      return {
        wrapClips: wrap.scrollHeight > wrap.clientHeight,
        innerClips: inner ? inner.scrollHeight > inner.clientHeight : false,
        minSlotHeight: slots.length ? Math.min(...slots.map(s => s.clientHeight)) : null,
        maxSlotHeight: Math.max(0, ...slots.map(s => s.clientHeight)),
        maxInkHeight: Math.max(0, ...inkHeights),
        inkExceedsBox: slots.some((s, i) => inkHeights[i] > s.clientHeight + 0.5),
        slotCount: slots.length,
        text: slots.map(s => s.textContent).join(" | "),
        hasPlusIndicator: /\+\d/.test(inner ? inner.textContent : ""),
        // B655552 (round 2) — the hover requirement: the native `title` attribute is what the browser's own
        // tooltip renders on hover, so reading it directly is the stable proxy for "what would the
        // owner see if he hovered this cell" (a real OS tooltip bubble can't be reliably screenshotted
        // headless, and doesn't need to be — the attribute IS the tooltip's content). `title` lives on
        // DepCell's OWN root element (`inner`), never on the grid's outer `data-col-key` wrapper.
        title: inner ? (inner.getAttribute("title") || "") : "",
      };
    }, { rowId, colKey: t.colKey });
  }
  return out;
}

async function runPass(label, mutateSource) {
  const rawHtml = await buildServedHtml(mutateSource);
  return withServer(rawHtml, async (url) => {
    const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
      await assertMeasurable(page, "verify-depcell-two-line");
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector(".drow", { timeout: 40000 });
      await page.waitForTimeout(1500);
      const results = {};
      for (const rh of [20, 24, 25, 34]) results[rh] = await measureAt(page, rh);
      return results;
    } finally {
      await browser.close();
    }
  });
}

// B655552 (round 2) — re-measured threshold: DEPCELL_LINE_H is now 10 (was 12), so DEPCELL_TWO_LINE_MIN_H is
// 20 (was 24) — exactly the row-height slider's floor. Every RH this harness tests (20/24/25/34) is
// now >= the threshold, so canTwoLine is true throughout; the `< 20` branches below are kept as
// structural checks (they'd fire if the threshold ever regressed upward) even though the real
// slider can't produce a value that reaches them.
const TWO_LINE_MIN = 20;

// The real regression class (defect A) is a line's own box squeezed below its natural height — never
// a scrollHeight/clientHeight mismatch, which is the NORMAL reading for both intentional truncation
// mechanisms in this cell (line-clamp, per-item ellipsis). See the note in measureAt above. Natural
// line height is now 10px (was 12px pre-B655552 (round 2)); the 1px rounding tolerance carries over unchanged.
const isClipped = m => m.wrapClips || m.innerClips || (m.minSlotHeight != null && m.minSlotHeight < 9) || m.inkExceedsBox;

const ITEM_COUNT = { twoLink: 2, oneLink: 1, threeLink: 3, lagLink: 1, emptyLink: 0, twoSucc: 2 };
const SINGLE_ITEM_LONG_NAME = new Set(["oneLink", "lagLink"]); // 1 item, name long enough that wrapping is observable

function evaluateUnmutated(results) {
  const failures = [];
  for (const [rh, byLabel] of Object.entries(results)) {
    const rowH = Number(rh);
    for (const [label, m] of Object.entries(byLabel)) {
      if (m.error) { failures.push(`${label}@${rh}: ${m.error}`); continue; }
      if (isClipped(m)) failures.push(`${label}@${rh}: CLIPPED (wrap=${m.wrapClips} inner=${m.innerClips} minSlotHeight=${m.minSlotHeight}) — "${m.text}"`);
      // twoLink/threeLink/twoSucc hide items below the threshold (threeLink always hides its 3rd) —
      // the "+N" indicator must be present whenever that happens.
      const itemCount = ITEM_COUNT[label] ?? 1;
      const visibleCount = rowH >= TWO_LINE_MIN ? 2 : 1;
      const expectExtra = itemCount > visibleCount;
      if (expectExtra && !m.hasPlusIndicator) failures.push(`${label}@${rh}: hidden items but NO "+N" indicator — silent drop — "${m.text}"`);
      // A single long-named link should WRAP to more than one line's height once there's room.
      if (SINGLE_ITEM_LONG_NAME.has(label) && rowH >= TWO_LINE_MIN && m.maxSlotHeight <= 11) failures.push(`${label}@${rh}: single long link did NOT wrap to a second line (height ${m.maxSlotHeight}px) — "${m.text}"`);
      // Below the threshold, every non-empty cell shows exactly one slot (never a partial second line).
      if (rowH < TWO_LINE_MIN && itemCount > 0 && m.slotCount > 1) failures.push(`${label}@${rh}: showed ${m.slotCount} slots below the two-line threshold — should be exactly 1`);
      // The empty cell must stay genuinely empty: no slots, no stray tooltip, never clipped.
      if (label === "emptyLink") {
        if (m.slotCount !== 0) failures.push(`emptyLink@${rh}: expected 0 slots for a task with no predecessors, got ${m.slotCount}`);
        if (m.title !== "") failures.push(`emptyLink@${rh}: expected no tooltip on an empty cell, got "${m.title}"`);
      }
      // B655552 (round 2) — hovering must reveal the FULL name of every item, visible or hidden behind "+N".
      const target = TARGETS.find(t => t.label === label);
      if (target && target.expectNames.length) {
        for (const name of target.expectNames) {
          if (!m.title.includes(name)) failures.push(`${label}@${rh}: tooltip is missing the full name "${name}" — got title="${m.title}"`);
        }
      }
      if (target && target.expectLabelPattern && !target.expectLabelPattern.test(m.title)) {
        failures.push(`${label}@${rh}: tooltip did not contain the expected lag label (pattern ${target.expectLabelPattern}) — got title="${m.title}"`);
      }
    }
  }
  return failures;
}

const line = s => console.log(s);
let exitCode = 0;

await ensureVendored();

line("── Pass 1: real (unmutated) source ──");
const realResults = await runPass("real", null);
const realFailures = evaluateUnmutated(realResults);
if (realFailures.length) {
  exitCode = 1;
  line(`FAIL — ${realFailures.length} problem(s) on the real source:`);
  realFailures.forEach(f => line(`  ✗ ${f}`));
} else {
  line("PASS — no clipping, no silent drops, single-link wraps at/above threshold, clean single line below it, across RH 20/24/25/34.");
}

line("");
line("── Pass 2: mutation — revert vertical padding to \"2px 8px\" (reproduces defect A's clip) ──");
const padMutated = await runPass("pad-mutation", html =>
  html.replace(
    'style={{...s, flexDirection:"column", alignItems:"flex-start", justifyContent:"flex-start", gap:0, padding:"0 8px"}}',
    'style={{...s, flexDirection:"column", alignItems:"flex-start", justifyContent:"flex-start", gap:0, padding:"2px 8px"}}'
  ));
// B655552 (round 2) note: with the smaller DEPCELL_LINE_H (10, was 12), 2×10px content plus 4px of reverted
// padding needs exactly 24px — which still FITS inside RH 24/25 (no slack left, but no clip either).
// RH=20 (the owner's own row height, and the whole reason this item exists) is the one that
// actually has no room to spare, so it's the row height that must be checked here now.
const padCaught = Object.values(padMutated["20"] || {}).some(isClipped)
  || Object.values(padMutated["24"] || {}).some(isClipped)
  || Object.values(padMutated["25"] || {}).some(isClipped);
if (padCaught) {
  line("PASS — the mutation reproduces clipping and this check catches it (the check is discriminating for defect A).");
} else {
  exitCode = 1;
  line("FAIL — reverting the padding did NOT produce a caught clip. This check would not have caught defect A — it is not discriminating.");
}

line("");
line("── Pass 3: mutation — force DEPCELL_TWO_LINE_MIN_H to Infinity (reproduces defect B's stuck single line) ──");
const thresholdMutated = await runPass("threshold-mutation", html =>
  html.replace(
    "const DEPCELL_TWO_LINE_MIN_H = DEPCELL_LINE_H * 2;",
    "const DEPCELL_TWO_LINE_MIN_H = Infinity;"
  ));
const oneLinkAt34 = thresholdMutated["34"]?.oneLink;
const thresholdCaught = oneLinkAt34 && !oneLinkAt34.error && oneLinkAt34.maxSlotHeight <= 11;
if (thresholdCaught) {
  line("PASS — forcing the threshold unreachable reproduces the stuck-single-line defect and this check catches it (discriminating for defect B).");
} else {
  exitCode = 1;
  line(`FAIL — the threshold mutation did not reproduce the expected stuck single line (oneLink@34 = ${JSON.stringify(oneLinkAt34)}). This check would not have caught defect B.`);
}

/* Passes 4 and 5 below were added during the B655552 close-out audit to mutation-prove the "+N"
 * badge and the below-threshold slot count. B655552 (round 2) note, stated plainly per the brief's own
 * "say out loud anything that does NOT turn a check red" instruction: with the new threshold (20,
 * the slider's own floor), canTwoLine is TRUE at every row height the real slider can produce — the
 * below-threshold branch these two passes exercise is no longer reachable via the slider alone.
 * Both mutations are therefore combined with Pass 3's threshold-to-Infinity patch, which is the only
 * way left to force the below-threshold state at all; this is a genuine strengthening (that state is
 * structurally gone from real reachable behaviour), not a weakened test — but it does mean these two
 * passes no longer stand alone the way Pass 2/3 do. Separately, Pass 5's ORIGINAL framing ("defect A
 * returns via a different path", detected by CLIPPING) no longer applies at all: 2 slots at the new
 * DEPCELL_LINE_H (10px, 20px total) fit inside every row height the slider can select (20-34px), so
 * forcing 2 slots can never clip anymore regardless of threshold — a real, structural improvement.
 * The discriminator for Pass 5 is now the slot COUNT itself (1 intended vs. 2 shown), not clipping. */
line("");
line('── Pass 4: mutation — the "+N" badge only ever renders on slot index 1 (never index 0), combined with an Infinity threshold to force the below-threshold state at all ──');
const badgeMutated = await runPass("badge-mutation", html =>
  html.replace(
    "i === visibleCount - 1 && extra > 0",
    "i === 1 && extra > 0"
  ).replace(
    "const DEPCELL_TWO_LINE_MIN_H = DEPCELL_LINE_H * 2;",
    "const DEPCELL_TWO_LINE_MIN_H = Infinity;"
  ));
// With the threshold forced unreachable, visibleCount is 1 everywhere, so slot index 1 never
// exists — the badge should vanish exactly where it is needed most (an item is hidden but nothing
// on screen says so).
const badgeCaught = ["twoLink", "threeLink"].some(label => {
  const m = badgeMutated["20"]?.[label];
  return m && !m.error && !m.hasPlusIndicator;
});
if (badgeCaught) {
  line("PASS — hardcoding the badge to slot index 1 reproduces a silent drop below the threshold and this check catches it.");
} else {
  exitCode = 1;
  line("FAIL — the badge-position mutation did not reproduce a caught silent drop. This check would not have caught it.");
}

line("");
line("── Pass 5: mutation — visibleCount hardcoded to 2 (ignores canTwoLine entirely), combined with an Infinity threshold so the intended value (1) and the mutated value (2) actually diverge ──");
const visibleCountMutated = await runPass("visiblecount-mutation", html =>
  html.replace(
    "const visibleCount = canTwoLine ? 2 : 1;",
    "const visibleCount = 2;"
  ).replace(
    "const DEPCELL_TWO_LINE_MIN_H = DEPCELL_LINE_H * 2;",
    "const DEPCELL_TWO_LINE_MIN_H = Infinity;"
  ));
const showedTwoSlotsBelowThreshold = ["twoLink", "oneLink", "threeLink"].some(label => {
  const m = visibleCountMutated["20"]?.[label];
  return m && !m.error && m.slotCount > 1;
});
if (showedTwoSlotsBelowThreshold) {
  line("PASS — forcing visibleCount to always 2 shows 2 slots when the (Infinity-forced) threshold says 1, and this check catches the divergence.");
} else {
  exitCode = 1;
  line("FAIL — the visibleCount mutation did not reproduce a caught below-threshold 2-slot cell. This check would not have caught it.");
}

line("");
line("── Pass 6: mutation — depCellFullTitle drops every item but the first (hidden/extra names silently missing from the tooltip) ──");
const titleMutated = await runPass("title-mutation", html =>
  html.replace(
    "const list = items.map(item => `${renderLabel(item)} · ${renderName(item)}`).join(\"\\n\");",
    "const list = items.slice(0, 1).map(item => `${renderLabel(item)} · ${renderName(item)}`).join(\"\\n\");"
  ));
const threeLinkTitle20 = titleMutated["20"]?.threeLink;
const titleCaught = threeLinkTitle20 && !threeLinkTitle20.error
  && !threeLinkTitle20.title.includes("PID Petition Submittal to the County Commissioners Court")
  && !threeLinkTitle20.title.includes("Third Link Alpha");
if (titleCaught) {
  line("PASS — truncating the tooltip helper to the first item drops the 2nd/3rd names from a 3-link cell's tooltip, and the title assertion catches it.");
} else {
  exitCode = 1;
  line(`FAIL — the title-truncation mutation did not reproduce a caught missing name (threeLink@20 title = ${JSON.stringify(threeLinkTitle20?.title)}). This check would not have caught it.`);
}

line("");
line("── Pass 7: mutation — DEPCELL_FONT_SIZE reverted to 10 (undoes the shrink; reproduces the exact regression this item exists to fix) ──");
const fontMutated = await runPass("font-mutation", html =>
  html.replace("const DEPCELL_FONT_SIZE = 8;", "const DEPCELL_FONT_SIZE = 10;"));
const fontCaught = Object.entries(fontMutated["20"] || {}).some(([label, m]) => !m.error && isClipped(m));
if (fontCaught) {
  line("PASS — reverting the font-size shrink reproduces real clipping at RH=20 (the owner's own saved setting) and this check catches it.");
} else {
  exitCode = 1;
  line("FAIL — the font-size mutation did not reproduce a caught clip at RH=20. This check would not have caught a regression back to the reported bug.");
}

line("");
line(exitCode === 0 ? "✅ ALL PASSES OK" : "❌ SEE FAILURES ABOVE");
process.exit(exitCode);
