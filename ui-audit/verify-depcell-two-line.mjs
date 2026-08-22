/* B655552 — the Schedule grid's predecessor/successor cell (`DepCell`, public/sequence/index.html)
 * had two distinct, owner-reported defects:
 *   (A) the second line renders but gets sliced off mid-glyph at the row's bottom edge — half a
 *       line bleeding into the row below, which reads as corruption.
 *   (B) a single link ellipsizes on line 1 while line 2 sits empty, instead of wrapping the name
 *       into the otherwise-unused second line.
 * Both trace to the same geometry: two 10px/1.2-line-height lines (12px each) need 24px, and
 * ROW_H is a user-configurable slider from 20 to 34 (default 24) — `DEPCELL_TWO_LINE_MIN_H` (24)
 * is the measured threshold below which DepCell shows one clean line instead of a doomed second one.
 *
 * This harness drives the REAL Format-panel row-height slider (not a data-injection shortcut —
 * ROW_H is a plain module variable updated inside a useEffect, so seeding settings.rowHeight in
 * the boot payload only takes effect on a LATER render; the slider's onChange goes through the
 * same live-update path a real user's drag uses) and asserts, in a real headless Chromium:
 *   1. NEVER any clipping (scrollHeight > clientHeight) on the cell wrap or its content, at any
 *      row-height setting from 20 to 34.
 *   2. At/above the 24px threshold, a single long link WRAPS onto 2 lines (uses more than one
 *      line's worth of height) instead of staying single-line-ellipsized.
 *   3. Below the threshold, exactly one line renders — never a partial second line.
 *   4. Whenever items are hidden (2-link cell below threshold, or a 3rd link at any height), a
 *      "+N" indicator is visible — nothing is ever silently dropped.
 *
 * Each assertion is mutation-proven against the REAL source (string-patching the served HTML,
 * never a hand-written paraphrase): reverting the vertical padding back to "2px 8px" reproduces
 * defect A's clip, and forcing DEPCELL_TWO_LINE_MIN_H to Infinity reproduces defect B's stuck
 * single line — confirming this check would have failed on the pre-fix code.
 *
 * Run: node ui-audit/verify-depcell-two-line.mjs      [PW_CHROME=<chrome>]
 * Exit 0 = every assertion holds on the real source AND both mutations are caught. Exit 1 = a real
 * regression, or a mutation that slipped through undetected (a check nobody has seen fail).
 *
 * NOT wired into CI (same standing gap as every other `ui-audit/verify-*.mjs` harness — B613760 —
 * this file exists and is runnable, but nothing invokes it automatically). `test/depcellTwoLine.test.js`
 * is the CI-enforced half (source-level: the threshold constant, zero vertical padding, and the
 * line-clamp wrap branch are all still present in the shipped file).
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
  const insertAt = tasks.findIndex(t => t.id === 2) + 1;
  tasks.splice(insertAt, 0, longA, longB, longC, twoLink, oneLink, threeA, threeLink);
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
  { nameMatch: "AAA Two-Link Test Task", colKey: "predecessors", label: "twoLink" },
  { nameMatch: "AAA One-Link Test Task", colKey: "predecessors", label: "oneLink" },
  { nameMatch: "AAA Three-Link Test Task", colKey: "predecessors", label: "threeLink" },
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
      return {
        wrapClips: wrap.scrollHeight > wrap.clientHeight,
        innerClips: inner ? inner.scrollHeight > inner.clientHeight : false,
        minSlotHeight: slots.length ? Math.min(...slots.map(s => s.clientHeight)) : null,
        maxSlotHeight: Math.max(0, ...slots.map(s => s.clientHeight)),
        slotCount: slots.length,
        text: slots.map(s => s.textContent).join(" | "),
        hasPlusIndicator: /\+\d/.test(inner ? inner.textContent : ""),
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

// The real regression class (defect A) is a line's own box squeezed below its natural ~12px
// height — never a scrollHeight/clientHeight mismatch, which is the NORMAL reading for both
// intentional truncation mechanisms in this cell (line-clamp, per-item ellipsis). See the note
// in measureAt above.
const isClipped = m => m.wrapClips || m.innerClips || (m.minSlotHeight != null && m.minSlotHeight < 11);

function evaluateUnmutated(results) {
  const failures = [];
  for (const [rh, byLabel] of Object.entries(results)) {
    const rowH = Number(rh);
    for (const [label, m] of Object.entries(byLabel)) {
      if (m.error) { failures.push(`${label}@${rh}: ${m.error}`); continue; }
      if (isClipped(m)) failures.push(`${label}@${rh}: CLIPPED (wrap=${m.wrapClips} inner=${m.innerClips} minSlotHeight=${m.minSlotHeight}) — "${m.text}"`);
      // twoLink/threeLink hide items below the threshold (and threeLink always hides its 3rd) — the
      // "+N" indicator must be present whenever that happens.
      const itemCount = label === "twoLink" ? 2 : label === "threeLink" ? 3 : 1;
      const visibleCount = rowH >= 24 ? 2 : 1;
      const expectExtra = itemCount > visibleCount;
      if (expectExtra && !m.hasPlusIndicator) failures.push(`${label}@${rh}: hidden items but NO "+N" indicator — silent drop — "${m.text}"`);
      // oneLink should WRAP to more than one line's height once there's room.
      if (label === "oneLink" && rowH >= 24 && m.maxSlotHeight <= 13) failures.push(`${label}@${rh}: single long link did NOT wrap to a second line (height ${m.maxSlotHeight}px) — "${m.text}"`);
      // Below the threshold, every cell shows exactly one slot (never a partial second line).
      if (rowH < 24 && m.slotCount > 1) failures.push(`${label}@${rh}: showed ${m.slotCount} slots below the two-line threshold — should be exactly 1`);
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
const padCaught = Object.values(padMutated["24"] || {}).some(isClipped)
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
const thresholdCaught = oneLinkAt34 && !oneLinkAt34.error && oneLinkAt34.maxSlotHeight <= 13;
if (thresholdCaught) {
  line("PASS — forcing the threshold unreachable reproduces the stuck-single-line defect and this check catches it (discriminating for defect B).");
} else {
  exitCode = 1;
  line(`FAIL — the threshold mutation did not reproduce the expected stuck single line (oneLink@34 = ${JSON.stringify(oneLinkAt34)}). This check would not have caught defect B.`);
}

line("");
line(exitCode === 0 ? "✅ ALL PASSES OK" : "❌ SEE FAILURES ABOVE");
process.exit(exitCode);
