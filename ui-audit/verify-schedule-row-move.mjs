/* SCHEDULE GRID — DRAG-TO-MOVE ROW BAND SIZING + DEPTH RESOLUTION (#1107 live regression).
 *
 * Owner report, 4 days after NEW-ROWMOVE shipped, verbatim: "moving tasks up and down on the
 * schedule is kinda finicky. Like, I tried to move a task above another task, and it somehow put
 * it as a subtask for the task that it was hovering above when I was trying to place it."
 *
 * MEASURED root cause: the original drag had THREE outcomes — drop in the top 30% of a row
 * ("before" it), the bottom 30% ("after" it), or the middle 40% ("into" it, as a new child). At
 * his actual row-height setting (20px, the slider's floor) the two "place beside" bands were 6px
 * tall against an 8px "make it a subtask" band in between — the riskier, more surprising outcome
 * was also the BIGGER, easier-to-hit target. See BAND TABLE + PIXEL SWEEP below for the measured
 * numbers, old vs new, at every row-height the slider allows.
 *
 * THE FIX, decided in three passes as the owner refined the brief mid-session (all confirmed live
 * in this file, in order):
 *   1. Kill the middle band. A drag now has exactly TWO outcomes, above or below — it can never
 *      reparent by vertical position alone. Making a task a subtask is what indent
 *      (Shift+Alt+Right / the right-click menu) is for; drag no longer overlaps that job.
 *   2. Depth rule: "match the row above the insertion point, but never shallower than the row
 *      below." Not a preference — the row below is a hard floor, because the ONLY way it can be
 *      deeper than the row above is when it's the row above's own first child, and landing any
 *      shallower would silently ADOPT that child (and everything under it) into the dropped row's
 *      new subtree. This unifies "before"/"after" so the SAME gap resolves identically regardless
 *      of which half of which neighboring row the cursor released in — the old code disagreed
 *      with itself here, which is the actual mechanism behind the reparent-by-accident report.
 *   3. Visual: the insertion line is now DEPTH-AWARE — it starts at the x-offset the dropped row's
 *      own name text would start at, so a sibling-level drop and a nested drop are visibly
 *      different lines, not the same line at two different vertical positions. Plus a leading dot
 *      (legibility at 20px rows), a dashed "in-flight" outline on the dragged row(s), matching the
 *      pre-existing dim/grabbing-cursor/grip-opacity affordances documented and re-measured below.
 *
 * ALSO in this same PR (folded in per owner instruction, kept in separate report sections so each
 * is independently readable): the drag-grip-to-ID-number spacing fix (owner: "not a ton more
 * space... just enough that it makes sense" — was 4px padding under an 8px grip, i.e. UNDER it,
 * now 12px, clear of the grip with a small gap, without touching the grip's own hit area).
 *
 * NON-NEGOTIABLES this file proves, each with its own MUTATION so the check is shown to be
 * discriminating rather than defensive (a check that never goes red is not a check):
 *   A. same-level reorder (before/after a sibling) — band-count-independent, still exact
 *   B. a moved PARENT takes its whole subtree — child count/order preserved, verified by name
 *   C. below a COLLAPSED group lands BESIDE it, never inside, and never force-expands it — the
 *      owner's own worked example, and the direct replacement for what drag-into used to do
 *   D. a multi-row (contiguous range) selection moves in FULL, not just the grabbed row
 *   E. a predecessor link survives a cross-parent move and stays LIVE (date unchanged, still driven)
 *   F. the WHOLE drag gesture is ONE undo step — one Ctrl+Z fully reverts it, including any depth
 *      change, not a partial revert
 *   G. copy/paste round-trip: a parent+children pasted elsewhere leaves the original untouched
 *   H. the "Move to…" menu item still opens the picker AND is the surviving path that CAN nest
 *      into a collapsed group (auto-expanding it) — drag deliberately no longer can
 *   I. a drag across a ~540-row list causes ZERO row DOM churn (no re-render) until the drop
 *   J. depth-clamp / adoption-danger: dropping between an EXPANDED PARENT and its first child
 *      lands as the parent's own first child (matches the row BELOW) — and does NOT adopt the
 *      existing children into the dropped row
 *   K. depth-match: dropping between a parent's LAST CHILD and the next unrelated row lands as
 *      that same parent's own last child (matches the row ABOVE) — the exact case he was asked
 *   L. above the very first row lands top-level; below the last row of the whole schedule lands
 *      at that row's own depth (accepted consequence, not a bug — outdent exists for it)
 *   M. the ID-column grip-to-number spacing fix, without regressing row-range select
 *
 * Run: node ui-audit/verify-schedule-row-move.mjs   [PW_CHROME=<chrome>]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { execFileSync } from "node:child_process";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const REPO_ROOT = new URL("../", import.meta.url).pathname;
const HTML_PATH = new URL("../public/sequence/index.html", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const SHOT_DIR = new URL("../ui-audit/_shots/", import.meta.url).pathname;

// The commit immediately BEFORE this fix (three-band drag, old scan-loop depth resolution) — a
// fixed, permanent point in history (already on origin/main), not a moving "HEAD", so the OLD-vs-
// NEW comparison below stays meaningful forever, even after this file's own fix is merged past it.
const PRE_FIX_SHA = "0903bc83d4997d1d71e96a3e0edd13ad1d7fac1";

const newBody = await readFile(HTML_PATH, "utf8");
let oldBody = null;
try {
  oldBody = execFileSync("git", ["show", `${PRE_FIX_SHA}:public/sequence/index.html`], { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 * 40 }).toString("utf8");
} catch (e) {
  console.log(`⚠ could not read pre-fix source at ${PRE_FIX_SHA} (${e.message.split("\n")[0]}) — run "git fetch origin main" first. OLD-vs-NEW comparisons will be skipped.`);
}
await ensureVendored();
await mkdir(SHOT_DIR, { recursive: true }).catch(() => {});

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

async function makeServer(bodyOverride) {
  const server = createServer(async (req, res) => {
    try {
      if (await serveVendored(req, res)) return;
      let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      if (p.endsWith("sequence/index.html")) {
        const src = bodyOverride ?? newBody;
        res.writeHead(200, { "Content-Type": "text/html" }); res.end(Buffer.from(rewriteCdn(src))); return;
      }
      const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      const body = await readFile(fp);
      res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise(r => server.listen(0, r));
  return { server, url: `http://localhost:${server.address().port}/sequence/` };
}

function task(over) {
  return { start: "2026-01-05", end: "2026-01-05", duration: 1, predecessors: [], health: "gray",
    percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true,
    durUnit: "d", durValue: 1, ...over };
}

// ── FIXTURE — a throwaway plan shaped like the owner's real scenario, and shared by the
// functional (A/B/D/E/F/G/H/I) and depth-resolution (C/J/K/L) checks below ────────────────────
// Phase 1 (1, expanded) -> Mobilize (2), Sitework (3)
// Phase 2 (4, COLLAPSED — the "drop into/beside a collapsed group" case) -> Foundation (5, hidden)
// Scattered top-level entitlement work he wants gathered into Phase 2:
//   PUD Development Agreement (6, a PARENT) -> Draft PUD (7), Submit PUD (8)
//   PID Formation (9) — the generic "mover" used by the depth-resolution checks
//   Annexation Petition (10) — FS predecessor = 6 (PUD Development Agreement)
//   Entitlement Review A (11), Entitlement Review B (12) — a CONTIGUOUS pair for the multi-row test
// Punch List (13) — unrelated control row, must never move
const FIXTURE = {
  aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  projects: { 1: { id: 1, name: "Row Move Fixture", tasks: [
    task({ id: 1, name: "Phase 1" }),
    task({ id: 2, name: "Mobilize", parentId: 1 }),
    task({ id: 3, name: "Sitework", parentId: 1 }),
    task({ id: 4, name: "Phase 2", isExpanded: false }),
    task({ id: 5, name: "Foundation", parentId: 4 }),
    task({ id: 6, name: "PUD Development Agreement", duration: 5, end: "2026-01-09" }),
    task({ id: 7, name: "Draft PUD", parentId: 6 }),
    task({ id: 8, name: "Submit PUD", parentId: 6 }),
    task({ id: 9, name: "PID Formation" }),
    task({ id: 10, name: "Annexation Petition", predecessors: [{ id: 6, type: "FS", lag: 0 }] }),
    task({ id: 11, name: "Entitlement Review A" }),
    task({ id: 12, name: "Entitlement Review B" }),
    task({ id: 13, name: "Punch List" }),
  ]}},
};

// A flat, unambiguous fixture for band-geometry measurement — every task is a top-level sibling,
// so ANY reparent ("into") outcome can only come from the band geometry itself, never from the
// depth-resolution rule (which needs a parent/child pair to have anything to clamp against).
const bandFixture = (rowHeight) => ({
  aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  settings: { rowHeight },
  projects: { 1: { id: 1, name: "Band Sweep Fixture", tasks: [
    task({ id: 1, name: "T1" }), task({ id: 2, name: "T2" }), task({ id: 3, name: "T3" }),
    task({ id: 4, name: "T4" }), task({ id: 5, name: "T5" }),
  ]}},
});

// The schedule's very last visible row is deliberately NESTED, to measure the accepted
// "lands deep" consequence of dropping below the end of the whole list.
const LASTROW_FIXTURE = {
  aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  projects: { 1: { id: 1, name: "Last Row Fixture", tasks: [
    task({ id: 1, name: "Root A" }), task({ id: 2, name: "Child A1", parentId: 1 }), task({ id: 3, name: "Mover" }),
  ]}},
};

// A REAL 3-digit id (his real row numbers — "Platting (112)", "121, 131, 132, 138") for the
// grip-spacing truncation check, at both row-height extremes. Can't just hand-set `id:121` in the
// fixture JSON — the app auto-renumbers every project's task ids to sequential 1..N on EVERY load
// (`normalizeIds`, index.html ~5716, "Auto-renumber every project's tasks on load"), so id=121
// only exists once a project genuinely HAS 121 tasks. 121 flat top-level tasks, ids 1..121 already
// in final visual order, so renumbering is a no-op and task 121 stays id 121 after import.
const gripFixture = (rowHeight) => ({
  aPid: 1, nPid: 200, nTid: 1000, view: "grid", section: "projects",
  settings: { rowHeight },
  projects: { 1: { id: 1, name: "Grip Spacing Fixture", tasks: Array.from({ length: 121 }, (_, i) => task({ id: i + 1, name: `Task ${i + 1}` })) }},
});

async function bootAndImport(page, url, fixture) {
  page.removeAllListeners("dialog");
  page.on("dialog", d => d.accept());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-schedule-row-move");
  await page.locator('[data-testid="open-history-desktop"]').click();
  await pacedWait(page, 250);
  await page.setInputFiles('input[type="file"][accept=".json"]', {
    name: "fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await pacedWait(page, 700);
  await page.locator('[data-testid="history-panel"] button:has-text("Close")').click();
  await pacedWait(page, 400);
  // Hardening: the fixture's own first task must actually be on screen before returning — a
  // fresh page + fresh server under this many sequential boots occasionally lands the caller's
  // first row lookup in the middle of the post-import re-render, throwing null derefs downstream.
  const firstTaskName = fixture?.projects?.[fixture.aPid]?.tasks?.[0]?.name;
  if (firstTaskName) {
    await page.waitForFunction((name) => [...document.querySelectorAll('[data-task-row]')].some(r => (r.innerText || "").includes(name)), firstTaskName, { timeout: 15000 }).catch(() => {});
  }
}

async function rowsByName(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-task-row]')].map(r => {
    const id = Number(r.getAttribute('data-task-row'));
    const nameCell = r.querySelector('[data-col-key="name"]');
    const startCell = r.querySelector('[data-col-key="start"]');
    const raw = (nameCell?.innerText || "");
    const expanded = raw.startsWith("▾") ? true : raw.startsWith("▸") ? false : null;
    return { id, name: raw.replace(/^▾\s*|^▸\s*/, "").trim(), start: (startCell?.innerText || "").trim(), expanded };
  }));
}
const byName = async (page, name) => (await rowsByName(page)).find(r => r.name === name) || null;

// Rows with their indentation LEVEL read directly off the name cell's own paddingLeft (the SAME
// technique the pre-existing indent/outdent harness uses) — one batched evaluate rather than N
// round trips, and robust to a sequence of checks reshaping row COUNT/INDEX on the same fixture.
async function rowsWithLevel(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-task-row]')].map(r => {
    const id = Number(r.getAttribute('data-task-row'));
    const nameCell = r.querySelector('[data-col-key="name"]');
    const raw = nameCell?.innerText || "";
    const span = nameCell?.querySelector("span");
    const pl = span ? parseFloat(getComputedStyle(span).paddingLeft) : null;
    const level = pl != null ? Math.round((pl - 4) / 14) : null;
    return { id, name: raw.replace(/^▾\s*|^▸\s*/, "").trim(), level, expanded: raw.startsWith("▾") ? true : raw.startsWith("▸") ? false : null };
  }));
}
async function levelOf(page, name) { const rows = await rowsWithLevel(page); return rows.find(r => r.name === name)?.level ?? null; }

// Direct-child count of `parentName`, read purely from the VISUAL level nesting (so it agrees
// with what's actually on screen, not with a raw parentId the UI might be hiding). This is the
// instrument the depth-clamp checks use to catch "silent adoption" — an existing child DEMOTED
// under the newly-dropped row would show up here as a child of the WRONG parent, not just a
// changed count.
async function directChildCount(page, parentName) {
  const rows = await rowsWithLevel(page);
  const idx = rows.findIndex(r => r.name === parentName);
  if (idx < 0) return null;
  const L = rows[idx].level;
  let count = 0;
  for (let i = idx + 1; i < rows.length; i++) { if (rows[i].level <= L) break; if (rows[i].level === L + 1) count++; }
  return count;
}

// Real mouse drag — grip mousedown, move toward the target row, land in the requested band, drop.
// band: "before" (top half of target row) | "after" (bottom half). NEW-ROWMOVE-2BAND — there is
// no "into" band any more; a drag can never reparent by vertical position alone.
async function dragRowTo(page, fromName, toName, band) {
  const from = await byName(page, fromName);
  const to = await byName(page, toName);
  if (!from || !to) throw new Error(`dragRowTo: could not resolve "${fromName}" -> "${toName}" (rows: ${JSON.stringify(await rowsByName(page))})`);
  const grip = await page.locator(`[data-row-drag-handle="${from.id}"]`).boundingBox();
  const target = await page.locator(`[data-task-row="${to.id}"]`).boundingBox();
  if (!grip || !target) throw new Error(`dragRowTo: grip or target row not rendered (from=${from.id} to=${to.id})`);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await pacedWait(page, 60);
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await pacedWait(page, 120);
  const frac = band === "before" ? 0.1 : 0.9;
  await page.mouse.move(target.x + target.width / 2, target.y + target.height * frac, { steps: 3 });
  await pacedWait(page, 150);
  await page.mouse.up();
  await pacedWait(page, 350);
}

// Lower-level variant for the pixel sweep — an EXACT pixel Y offset within the target row (not a
// named band), so the geometry measurement below is driven by real mouse input at real pixel
// coordinates, not by re-deriving the app's own formula.
async function dragRowToPixelY(page, fromName, toName, yOffsetPx) {
  const from = await byName(page, fromName);
  const to = await byName(page, toName);
  const grip = await page.locator(`[data-row-drag-handle="${from.id}"]`).boundingBox();
  const target = await page.locator(`[data-task-row="${to.id}"]`).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await pacedWait(page, 30);
  const clampedY = Math.min(target.height - 0.5, Math.max(0.5, yOffsetPx));
  await page.mouse.move(target.x + target.width / 2, target.y + clampedY, { steps: 3 });
  await pacedWait(page, 40);
  await page.mouse.up();
  await pacedWait(page, 140);
}

async function selectRowRange(page, topName, bottomName) {
  const rows = await rowsByName(page);
  const topRow = rows.find(r => r.name === topName), botRow = rows.find(r => r.name === bottomName);
  const topBox = await page.locator(`[data-task-row="${topRow.id}"] [data-col-key="id"]`).boundingBox();
  const botBox = await page.locator(`[data-task-row="${botRow.id}"] [data-col-key="id"]`).boundingBox();
  await page.mouse.move(topBox.x + topBox.width / 2, topBox.y + topBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(botBox.x + botBox.width / 2, botBox.y + botBox.height / 2, { steps: 5 });
  await page.mouse.up();
  await pacedWait(page, 150);
}

const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const { server, url } = await makeServer();
let page;

// ════════════════════════════════════════════════════════════════════════════════════════════
// STEP 1 — BAND TABLE. Pure arithmetic (both formulas are `frac` thresholds against ROW_H, no
// browser needed to state them), but printed here — not just asserted — because this table IS
// the answer to "how easy is it to mess up", read at a glance, at his exact slider range.
// ════════════════════════════════════════════════════════════════════════════════════════════
console.log("\n═══ STEP 1 — BAND TABLE (old three-band vs new two-band, by row height) ═══");
console.log("OLD (as shipped, #1107): before 0–30%, into 30–70%, after 70–100% of ROW_H");
console.log("NEW (this fix):          before 0–50%, after 50–100% of ROW_H — no into band");
console.log("ROW_H | OLD before | OLD into | OLD after | NEW before | NEW after");
for (const rh of [20, 24, 27, 30, 34]) {
  const oldBefore = +(rh * 0.3).toFixed(1), oldInto = +(rh * 0.4).toFixed(1), oldAfter = +(rh * 0.3).toFixed(1);
  const newBefore = +(rh * 0.5).toFixed(1), newAfter = +(rh * 0.5).toFixed(1);
  const marker = rh === 20 ? "  ← his setting" : rh === 34 ? "  ← slider max" : "";
  console.log(`${String(rh).padStart(5)} | ${String(oldBefore + "px (30%)").padStart(10)} | ${String(oldInto + "px (40%)").padStart(8)} | ${String(oldAfter + "px (30%)").padStart(9)} | ${String(newBefore + "px (50%)").padStart(10)} | ${String(newAfter + "px (50%)").padStart(9)}${marker}`);
}
console.log("At his 20px rows: the OLD \"place beside\" targets were 6.0px each — SMALLER than the");
console.log("8.0px \"make it a subtask\" band between them. The riskier outcome was the bigger target.");
console.log("NEW: no dead middle band at any row height — every release is a legitimate placement.\n");

// ════════════════════════════════════════════════════════════════════════════════════════════
// STEP 2 — PIXEL SWEEP. Drive a real drag, release at every 1px offset across the target row, at
// his row height (20) and the slider max (34), against BOTH the pre-fix source and this fix, on
// a flat fixture where an "into" outcome can only come from band geometry (see bandFixture above).
// ════════════════════════════════════════════════════════════════════════════════════════════
async function classifyBandOutcome(page, moverName, targetName) {
  const rows = await rowsWithLevel(page);
  const moverIdx = rows.findIndex(r => r.name === moverName);
  const targetIdx = rows.findIndex(r => r.name === targetName);
  const mover = rows[moverIdx], target = rows[targetIdx];
  if (mover.level > target.level) return "into";
  if (moverIdx === targetIdx - 1) return "before";
  if (moverIdx === targetIdx + 1) return "after";
  return "unchanged";
}

// Mover is "T1", target is "T3" — deliberately NOT adjacent (T2 sits between them in the
// fixture), so a "before T3" release is a genuine reorder, not the immediately-adjacent-neighbor
// edge case (that case is measured on its own by check Q2 — mixing it into this sweep would
// undercount "before" for a reason that has nothing to do with band geometry).
async function sweepRowHeight(body, label, rowHeight) {
  const { server: ss, url: surl } = await makeServer(body);
  const spage = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  await bootAndImport(spage, surl, bandFixture(rowHeight));
  const target = await spage.locator('[data-task-row]').first().boundingBox(); // any row — uniform height
  const rh = Math.round((await spage.locator(`[data-task-row]`).nth(1).boundingBox()).y - target.y);
  const counts = { before: 0, after: 0, into: 0, unchanged: 0 };
  const rows = [];
  for (let y = 0; y < rh; y++) {
    await dragRowToPixelY(spage, "T1", "T3", y);
    const outcome = await classifyBandOutcome(spage, "T1", "T3");
    counts[outcome] = (counts[outcome] || 0) + 1;
    rows.push({ y, outcome });
    await spage.keyboard.press("Control+z");
    await pacedWait(spage, 90);
  }
  // Sanity: the fixture must have returned to its original order after rh undo passes, or the
  // sweep's own undo step is silently drifting the model and every reading above is suspect.
  const finalOrder = (await rowsByName(spage)).map(r => r.name).join(",");
  const sane = finalOrder === "T1,T2,T3,T4,T5";
  await spage.close(); ss.close();
  console.log(`  ${label} @ ROW_H=${rowHeight} (measured ${rh}px/row): before=${counts.before||0} after=${counts.after||0} into=${counts.into||0} unchanged=${counts.unchanged||0}  [order intact after sweep: ${sane}]`);
  return { label, rowHeight, rh, counts, rows, sane };
}

console.log("═══ STEP 2 — PIXEL SWEEP (real drags, every 1px, T1 dragged toward T3 — non-adjacent, isolates band geometry) ═══");
const sweepResults = [];
if (oldBody) {
  sweepResults.push(await sweepRowHeight(oldBody, "OLD (pre-#1107-fix)", 20));
  sweepResults.push(await sweepRowHeight(oldBody, "OLD (pre-#1107-fix)", 34));
} else {
  console.log("  (skipped OLD sweep — pre-fix source unavailable, see warning above)");
}
sweepResults.push(await sweepRowHeight(newBody, "NEW (this fix)", 20));
sweepResults.push(await sweepRowHeight(newBody, "NEW (this fix)", 34));

for (const r of sweepResults) {
  ok(`sweep sanity · ${r.label} @ ${r.rowHeight}px: fixture order intact after ${r.rh} undo passes`, r.sane);
}
if (oldBody) {
  const old20 = sweepResults.find(r => r.label.startsWith("OLD") && r.rowHeight === 20);
  // NOT literally >50% (into is 40% of the row by construction, before/after are 30% each) — the
  // measured, defensible claim is that the reparent band is never SMALLER than either individual
  // "place beside" band, i.e. the riskier outcome was never the harder one to hit.
  ok(`STEP2 · OLD@20px: the reparent ("into") band is AT LEAST AS WIDE as either individual "place beside" band — the riskier outcome was never the harder target, measured`,
    old20.counts.into >= old20.counts.before && old20.counts.into >= old20.counts.after,
    `into=${old20.counts.into} before=${old20.counts.before} after=${old20.counts.after} (of ${old20.rh}px)`);
}
const new20 = sweepResults.find(r => r.label.startsWith("NEW") && r.rowHeight === 20);
const new34 = sweepResults.find(r => r.label.startsWith("NEW") && r.rowHeight === 34);
ok("STEP2 · NEW@20px: ZERO \"into\" outcomes across the full pixel sweep — a drag can no longer reparent by vertical position",
  new20.counts.into === 0, `into=${new20.counts.into}/${new20.rh}px`);
ok("STEP2 · NEW@34px: ZERO \"into\" outcomes across the full pixel sweep (contrast row height)",
  new34.counts.into === 0, `into=${new34.counts.into}/${new34.rh}px`);

// ════════════════════════════════════════════════════════════════════════════════════════════
// FUNCTIONAL NON-NEGOTIABLES (A–M) — run against the fixed source, one fresh page per test.
// ════════════════════════════════════════════════════════════════════════════════════════════
try {
  page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  await bootAndImport(page, url, FIXTURE);

  // ── A: same-level reorder ────────────────────────────────────────────────────────────────
  {
    const before = (await rowsByName(page)).filter(r => r.name.startsWith("Entitlement Review")).map(r => r.name);
    await dragRowTo(page, "Entitlement Review B", "Entitlement Review A", "before");
    const after = (await rowsByName(page)).filter(r => r.name.startsWith("Entitlement Review")).map(r => r.name);
    ok("A · same-level reorder: dragging B before A swaps their visual order",
      before[0] === "Entitlement Review A" && after[0] === "Entitlement Review B",
      `before=${before} after=${after}`);
    await dragRowTo(page, "Entitlement Review A", "Entitlement Review B", "before"); // restore order
  }

  // ── B: moving a PARENT takes its whole subtree, child count/order preserved ────────────────
  {
    const beforeChildren = ["Draft PUD", "Submit PUD"];
    await dragRowTo(page, "PUD Development Agreement", "PID Formation", "after");
    const rows = await rowsByName(page);
    const pudIdx = rows.findIndex(r => r.name === "PUD Development Agreement");
    const afterChildren = rows.slice(pudIdx + 1, pudIdx + 3).map(r => r.name);
    ok("B · moving a parent carries its whole subtree — 2 children, same order, still directly beneath it",
      JSON.stringify(afterChildren) === JSON.stringify(beforeChildren), `got=${JSON.stringify(afterChildren)}`);
    await dragRowTo(page, "PUD Development Agreement", "PID Formation", "before"); // restore
  }

  // ── C: below a COLLAPSED group lands BESIDE it, never inside, never force-expands it ───────
  // (owner's own worked example — the direct replacement for what drag-into used to do here)
  {
    const phase2Before = await byName(page, "Phase 2");
    ok("C0 · fixture sanity: Phase 2 starts COLLAPSED", phase2Before.expanded === false, JSON.stringify(phase2Before));
    const phase2LevelBefore = await levelOf(page, "Phase 2");
    await dragRowTo(page, "PID Formation", "Phase 2", "after");
    const phase2After = await byName(page, "Phase 2");
    const pidLevel = await levelOf(page, "PID Formation");
    ok("C · dropping below a COLLAPSED group lands the row BESIDE it (same level) and leaves it collapsed — never force-expanded, never nested inside via drag",
      phase2After.expanded === false && pidLevel === phase2LevelBefore,
      `phase2.expanded=${phase2After.expanded} pidLevel=${pidLevel} phase2Level=${phase2LevelBefore}`);
    await dragRowTo(page, "PID Formation", "PUD Development Agreement", "before"); // restore near original spot
  }

  // ── D: a multi-row (contiguous range) selection moves in FULL, not just the grabbed row ────
  {
    await selectRowRange(page, "Entitlement Review A", "Entitlement Review B");
    await dragRowTo(page, "Entitlement Review A", "Phase 1", "before"); // grab the FIRST of the two selected rows
    const rows = await rowsByName(page);
    const phase1Idx = rows.findIndex(r => r.name === "Phase 1");
    const aIdx = rows.findIndex(r => r.name === "Entitlement Review A");
    const bIdx = rows.findIndex(r => r.name === "Entitlement Review B");
    ok("D · dragging one row of a multi-row selection moves the WHOLE selection, not just the grabbed row (the historical indent/outdent bug shape, for move)",
      aIdx < phase1Idx && bIdx < phase1Idx && Math.abs(aIdx - bIdx) === 1,
      `phase1Idx=${phase1Idx} aIdx=${aIdx} bIdx=${bIdx}`);
  }

  // ── E: a predecessor link survives a cross-parent move and stays LIVE ──────────────────────
  {
    const before = await byName(page, "Annexation Petition");
    await dragRowTo(page, "PUD Development Agreement", "Sitework", "after"); // move PUD (Annexation's FS predecessor) under Phase 1
    const after = await byName(page, "Annexation Petition");
    ok("E · a predecessor link survives a cross-parent move — Annexation's FS-derived Start is unchanged (still driven by PUD, not silently dropped)",
      before && after && before.start === after.start && after.start !== "", `before=${before?.start} after=${after?.start}`);
  }

  // ── F: the WHOLE drag gesture is ONE undo step, INCLUDING a depth change ───────────────────
  {
    const snapshot = async () => (await rowsWithLevel(page)).map(r => `${r.name}:${r.level}:${r.expanded}`).join("|");
    const beforeSnap = await snapshot();
    await dragRowTo(page, "Punch List", "Mobilize", "before"); // a depth-CHANGING drop (Punch List becomes Phase 1's child)
    const movedSnap = await snapshot();
    ok("F0 · sanity: the move actually changed something (including depth)", beforeSnap !== movedSnap);
    await page.keyboard.press("Control+z");
    await pacedWait(page, 250);
    const undoneSnap = await snapshot();
    ok("F · ONE Ctrl+Z fully reverts the whole drag gesture, INCLUDING the depth change (not a partial/per-frame revert)",
      undoneSnap === beforeSnap, `before=${beforeSnap.length}ch undone=${undoneSnap.length}ch equal=${undoneSnap===beforeSnap}`);
  }

  // ── G: copy/paste round-trip — original untouched ───────────────────────────────────────────
  {
    const pud = await byName(page, "PUD Development Agreement");
    await page.locator(`[data-task-row="${pud.id}"] [data-col-key="id"]`).click();
    await page.keyboard.press("Control+c");
    await pacedWait(page, 150);
    const punchList = await byName(page, "Punch List");
    await page.locator(`[data-task-row="${punchList.id}"] [data-col-key="id"]`).click();
    await page.keyboard.press("Control+v");
    await pacedWait(page, 350);
    const rows = await rowsByName(page);
    const copies = rows.filter(r => r.name === "PUD Development Agreement");
    const originalStillHasChildren = (() => {
      const origIdx = rows.findIndex(r => r.name === "PUD Development Agreement");
      return rows[origIdx + 1]?.name === "Draft PUD" && rows[origIdx + 2]?.name === "Submit PUD";
    })();
    ok("G · copy+paste round trip: a NEW copy of the parent+children appears AND the original is left completely untouched",
      copies.length === 2 && originalStillHasChildren, `copies=${copies.length} originalIntact=${originalStillHasChildren}`);
  }

  // ── H: "Move to…" — menu wiring AND it's now the ONLY way to nest into a collapsed group ───
  {
    const target = await byName(page, "Phase 2");
    ok("H-1 · sanity: Phase 2 is still collapsed going into this check", target.expanded === false);
    await page.locator(`[data-task-row="${target.id}"] [data-col-key="id"]`).click({ button: "right" }); // right-click Phase 2 itself first, to open Punch List's menu below instead
    await page.keyboard.press("Escape").catch(() => {});
    const punchList = await byName(page, "Punch List");
    await page.locator(`[data-task-row="${punchList.id}"] [data-col-key="id"]`).click({ button: "right" });
    await pacedWait(page, 150);
    await page.locator("i.ti-folder-symlink").locator("..").click();
    await pacedWait(page, 200);
    const modalVisible = await page.locator('[data-move-to-modal]').isVisible().catch(() => false);
    ok("H0 · sanity: the Move to… modal opens from the context menu", modalVisible);
    await page.locator('[data-move-to-modal] input').fill("Phase 2");
    await pacedWait(page, 150);
    await page.locator('[data-move-to-modal] [data-move-to-option]', { hasText: "Phase 2" }).click();
    await pacedWait(page, 350);
    const phase2Level = await levelOf(page, "Phase 2");
    const punchLevel = await levelOf(page, "Punch List");
    const phase2After = await byName(page, "Phase 2");
    const rows = await rowsByName(page);
    const phase2Idx = rows.findIndex(r => r.name === "Phase 2");
    const punchIdx = rows.findIndex(r => r.name === "Punch List");
    ok("H · Move to… commits through the SAME primitive, and — unlike drag — CAN nest into a collapsed destination, auto-expanding it: Punch List now sits one level deeper, right after Phase 2, which is no longer collapsed",
      punchLevel === phase2Level + 1 && punchIdx > phase2Idx && phase2After.expanded === true,
      `phase2Level=${phase2Level} punchLevel=${punchLevel} phase2Idx=${phase2Idx} punchIdx=${punchIdx} phase2Expanded=${phase2After.expanded}`);
  }

  // ── I: a drag across a large list causes ZERO row DOM churn until the drop, AND auto-scroll
  //      doesn't leave the list somewhere nonsensical once the drop's own scroll-anchor effect
  //      (the #1101/B463922 layout effect) has had its say ─────────────────────────────────────
  {
    const bigTasks = [task({ id: 1, name: "Root" })];
    for (let i = 2; i <= 540; i++) bigTasks.push(task({ id: i, name: `Task ${i}`, parentId: 1 }));
    const bigFixture = { aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
      projects: { 1: { id: 1, name: "Perf Fixture", tasks: bigTasks } } };
    const bpage = await browser.newPage({ viewport: { width: 1600, height: 950 } });
    await bootAndImport(bpage, url, bigFixture);
    await bpage.evaluate(() => {
      const wrap = document.querySelector('[data-task-row]')?.parentElement;
      if (!wrap) { window.__moveObs = { error: "no rows wrapper found" }; return; }
      const rec = { childListMutations: 0, attrTargets: new Set() };
      const mo = new MutationObserver(list => list.forEach(m => {
        if (m.type === "childList" && (m.addedNodes.length || m.removedNodes.length)) rec.childListMutations++;
        if (m.type === "attributes") rec.attrTargets.add(m.target.getAttribute?.("data-task-row") || m.target.tagName);
      }));
      mo.observe(wrap, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
      window.__moveObs = rec; window.__moveMo = mo;
      window.__scrollBefore = document.querySelector('[data-task-row]')?.closest('[style*="overflow"]')?.scrollTop ?? null;
    });
    const grip = await bpage.locator('[data-row-drag-handle="2"]').boundingBox();
    await bpage.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await bpage.mouse.down();
    for (let i = 0; i < 6; i++) { await bpage.mouse.move(700, 900, { steps: 4 }); await pacedWait(bpage, 180); }
    const rec = await bpage.evaluate(() => ({ ...window.__moveObs, attrTargets: [...window.__moveObs.attrTargets] }));
    // Drop ABOVE row "Task 3" (a plain top-level sibling of the dragged row 2) so the drop itself
    // is a clean, unambiguous same-level reorder — isolates the DOM-churn measurement from the
    // depth-resolution logic under test elsewhere.
    const target3 = await bpage.locator('[data-task-row="3"]').boundingBox().catch(() => null);
    if (target3) await bpage.mouse.move(target3.x + target3.width / 2, target3.y + 2, { steps: 3 });
    await bpage.mouse.up();
    await pacedWait(bpage, 300);
    const rowsAfter = await bpage.locator('[data-task-row]').count();
    ok("I · dragging across a ~540-row list (auto-scroll engaged) causes ZERO row DOM add/remove — no re-render per mousemove",
      rec.childListMutations === 0, `childListMutations=${rec.childListMutations} attrTargets=${JSON.stringify(rec.attrTargets).slice(0,200)}`);
    ok("I2 · after the drop, the auto-scrolled + post-drop scroll-anchor effect leaves a SANE, non-empty row list on screen (no fight between the two)",
      rowsAfter > 0 && rowsAfter < 600, `rowsRendered=${rowsAfter}`);
    await bpage.close();
  }

} finally {
  // keep server/browser alive into the depth-resolution + grip-spacing sections below
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// J/K/L — DEPTH-RESOLUTION MEASUREMENT, at the owner's five named insertion points. Each boots a
// fresh copy of FIXTURE (or LASTROW_FIXTURE) so results can't cross-contaminate. Reports the
// LANDED DEPTH and, for the danger case, the CHILD COUNT of every affected parent before/after —
// a drop that silently reparents an EXISTING row (not just the dropped one) is worse than #1107.
// ════════════════════════════════════════════════════════════════════════════════════════════
console.log("\n═══ STEP — DEPTH-RESOLUTION MEASUREMENT (owner's 5 named insertion points) ═══");

async function freshFixturePage(fixture) {
  const p = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  await bootAndImport(p, url, fixture);
  return p;
}

// J — gap between an EXPANDED PARENT (Phase 1) and its FIRST CHILD (Mobilize): the adoption-
// danger case. Rule says: clamp to Mobilize's depth (Phase 1's first child), and Phase 1's
// EXISTING children (Mobilize, Sitework) must NOT be adopted into the newly-dropped row.
{
  const jpage = await freshFixturePage(FIXTURE);
  const phase1ChildrenBefore = await directChildCount(jpage, "Phase 1");
  const mobilizeLevelBefore = await levelOf(jpage, "Mobilize");
  await dragRowTo(jpage, "PID Formation", "Mobilize", "before"); // this gap
  const pidLevel = await levelOf(jpage, "PID Formation");
  const mobilizeLevelAfter = await levelOf(jpage, "Mobilize");
  const phase1ChildrenAfter = await directChildCount(jpage, "Phase 1");
  const pidChildrenAfter = await directChildCount(jpage, "PID Formation");
  const rows = await rowsByName(jpage);
  const landedFirst = rows.findIndex(r => r.name === "PID Formation") === rows.findIndex(r => r.name === "Phase 1") + 1;
  console.log(`  J · Platting-style gap (expanded parent → first child): PID Formation lands at level ${pidLevel} (Mobilize is ${mobilizeLevelAfter}); Phase 1 children ${phase1ChildrenBefore}→${phase1ChildrenAfter}; PID Formation's OWN children (should be 0, i.e. no adoption): ${pidChildrenAfter}`);
  ok("J · depth-clamp/adoption-danger: dropping between an EXPANDED PARENT and its first child lands the dropped row AS the parent's own first child (matches the row BELOW, clamped), landing exactly where the line pointed, and does NOT adopt the existing children",
    pidLevel === mobilizeLevelBefore && mobilizeLevelAfter === mobilizeLevelBefore && phase1ChildrenAfter === phase1ChildrenBefore + 1 && pidChildrenAfter === 0 && landedFirst,
    `pidLevel=${pidLevel} mobilizeLevel ${mobilizeLevelBefore}->${mobilizeLevelAfter} phase1Children ${phase1ChildrenBefore}->${phase1ChildrenAfter} pidOwnChildren=${pidChildrenAfter} landedFirst=${landedFirst}`);
  await jpage.close();
}

// K — gap between a parent's LAST CHILD (Sitework) and the next unrelated row (Phase 2): the
// case the owner was specifically asked about. Rule says: matches the row ABOVE (Sitework's own
// depth) — lands as Phase 1's own last child.
{
  const kpage = await freshFixturePage(FIXTURE);
  const phase1ChildrenBefore = await directChildCount(kpage, "Phase 1");
  await dragRowTo(kpage, "PID Formation", "Sitework", "after"); // this gap
  const pidLevel = await levelOf(kpage, "PID Formation");
  const siteworkLevel = await levelOf(kpage, "Sitework");
  const phase2Level = await levelOf(kpage, "Phase 2");
  const phase1ChildrenAfter = await directChildCount(kpage, "Phase 1");
  console.log(`  K · last-child-to-unrelated gap: PID Formation lands at level ${pidLevel} (Sitework/last-child is ${siteworkLevel}, next section Phase 2 is ${phase2Level}); Phase 1 children ${phase1ChildrenBefore}→${phase1ChildrenAfter}`);
  ok("K · depth-match: dropping between a parent's LAST CHILD and the next unrelated row lands as that SAME parent's own last child (matches the row ABOVE) — the exact case he asked about",
    pidLevel === siteworkLevel && phase1ChildrenAfter === phase1ChildrenBefore + 1, `pidLevel=${pidLevel} siteworkLevel=${siteworkLevel} phase1Children ${phase1ChildrenBefore}->${phase1ChildrenAfter}`);
  await kpage.close();
}

// (C above already covers "below a COLLAPSED parent" — beside it, never inside, never force-
// expanded — so it isn't repeated here.)

// L1 — above the very first row: top-level, no row above to match.
{
  const lpage = await freshFixturePage(FIXTURE);
  await dragRowTo(lpage, "PID Formation", "Phase 1", "before");
  const rows = await rowsByName(lpage);
  const level0 = await levelOf(lpage, "PID Formation");
  console.log(`  L1 · above the very first row: PID Formation is now row 0 (${rows[0]?.name}), level ${level0}`);
  ok("L1 · dropping above the very first row lands top-level, in first position (no row above to match, so there's nothing to clamp against either)",
    rows[0]?.name === "PID Formation" && level0 === 0, `firstRow=${rows[0]?.name} level=${level0}`);
  await lpage.close();
}

// L2 — after the last row of the WHOLE SCHEDULE, where that last row is deliberately nested:
// lands deep. Accepted consequence, not a bug — outdent exists and works.
{
  const l2page = await freshFixturePage(LASTROW_FIXTURE);
  const rootAChildrenBefore = await directChildCount(l2page, "Root A");
  await dragRowTo(l2page, "Mover", "Child A1", "after");
  const moverLevel = await levelOf(l2page, "Mover");
  const childA1Level = await levelOf(l2page, "Child A1");
  const rootAChildrenAfter = await directChildCount(l2page, "Root A");
  console.log(`  L2 · after the last row of the schedule (that row is nested, level ${childA1Level}): Mover lands at level ${moverLevel}; Root A children ${rootAChildrenBefore}→${rootAChildrenAfter}. ACCEPTED CONSEQUENCE per owner instruction — it "lands deep"; outdent (Shift+Alt+Left / right-click menu) is the way back out, unchanged by this fix.`);
  ok("L2 · dropping after the LAST ROW of the whole schedule lands at THAT row's own depth (here: nested, as Root A's 2nd child) — matches the row above, exactly as the rule states, with nothing below to clamp against",
    moverLevel === childA1Level && rootAChildrenAfter === rootAChildrenBefore + 1,
    `moverLevel=${moverLevel} childA1Level=${childA1Level} rootAChildren ${rootAChildrenBefore}->${rootAChildrenAfter}`);
  await l2page.close();
}

// ── Q: adjacent cases — dragging a parent WITH children onto a row that already has children,
//      and dropping onto the row directly adjacent to the source (the smallest possible move,
//      and the one he described doing) ─────────────────────────────────────────────────────────
{
  const qpage = await freshFixturePage(FIXTURE);
  // a) drag a parent-with-children (PUD Development Agreement, 2 kids) to BEFORE another row
  //    that ALSO already has children (Phase 1, 2 kids) — a genuinely top-level/sibling gap (no
  //    row above to clamp against), so both subtrees must stay intact and separate. (Deliberately
  //    NOT "after Sitework" — that's the SAME gap check K already covers, where PUD SHOULD become
  //    Phase 1's own child per the depth rule; testing it here would just re-assert check K.)
  await dragRowTo(qpage, "PUD Development Agreement", "Phase 1", "before");
  const rowsA = await rowsByName(qpage);
  const phase1Idx = rowsA.findIndex(r => r.name === "Phase 1");
  const pudIdx = rowsA.findIndex(r => r.name === "PUD Development Agreement");
  const phase1ChildrenQ = await directChildCount(qpage, "Phase 1");
  const pudChildrenQ = await directChildCount(qpage, "PUD Development Agreement");
  const pudLevelQ = await levelOf(qpage, "PUD Development Agreement");
  ok("Q1 · dragging a parent WITH children to a top-level gap ahead of another row that ALSO already has children: both subtrees stay intact and separate (Phase 1 keeps its 2, PUD keeps its 2, PUD lands top-level, no cross-contamination)",
    phase1ChildrenQ === 2 && pudChildrenQ === 2 && pudLevelQ === 0 && pudIdx < phase1Idx,
    `phase1Idx=${phase1Idx} pudIdx=${pudIdx} phase1Children=${phase1ChildrenQ} pudChildren=${pudChildrenQ} pudLevel=${pudLevelQ}`);

  // b) smallest possible move: drag a row ONE position, onto its immediately-adjacent neighbor —
  //    the exact gesture the owner described doing when he hit the original bug.
  const before = (await rowsByName(qpage)).map(r => r.name);
  const entA_idx = before.findIndex(n => n === "Entitlement Review A");
  const neighborBefore = before[entA_idx - 1];
  await dragRowTo(qpage, "Entitlement Review A", neighborBefore, "before"); // swap with its immediate predecessor
  const after = (await rowsByName(qpage)).map(r => r.name);
  const entA_idxAfter = after.findIndex(n => n === "Entitlement Review A");
  ok(`Q2 · smallest possible move — dragging a row onto its immediately-adjacent neighbor ("${neighborBefore}") moves it exactly one slot, cleanly`,
    entA_idxAfter === entA_idx - 1 && after[entA_idxAfter + 1] === neighborBefore,
    `before pos=${entA_idx} after pos=${entA_idxAfter} neighbor="${neighborBefore}"`);
  await qpage.close();
}

// ── R: a genuine no-op drop (release back at the same position) pushes NO undo entry ──────────
// NOTE ON WHAT "no phantom undo step" ACTUALLY MEANS: standard undo semantics are "Ctrl+Z undoes
// the last REAL change" — if a no-op drop pushes NOTHING new, one Ctrl+Z correctly reaches back
// PAST it to whatever real change came before (here: the fixture import itself), and that's
// CORRECT, not a bug. The meaningful, testable claim is narrower: the no-op must not have pushed
// its OWN (redundant) entry — i.e. one Ctrl+Z after the no-op drag must land on the EXACT SAME
// state as one Ctrl+Z with no drag at all. If the no-op had pushed a spurious duplicate entry,
// the drag+undo path would need a SECOND Ctrl+Z to reach that same place. So this runs a CONTROL
// (no drag, straight to one Ctrl+Z) and a TEST (no-op drag, then one Ctrl+Z) from two fresh,
// identical boots and compares where each lands.
{
  const controlPage = await freshFixturePage(FIXTURE);
  await controlPage.keyboard.press("Control+z");
  await pacedWait(controlPage, 200);
  const controlResult = (await rowsByName(controlPage)).map(r => r.name).join(",");
  await controlPage.close();

  const rpage = await freshFixturePage(FIXTURE);
  const before = (await rowsByName(rpage)).map(r => r.name).join(",");
  // Grab Punch List (a top-level leaf) and drop it right back where it already is — after its own
  // preceding sibling, i.e. no-op.
  const rows0 = await rowsByName(rpage);
  const punchIdx = rows0.findIndex(r => r.name === "Punch List");
  await dragRowTo(rpage, "Punch List", rows0[punchIdx - 1].name, "after");
  const afterDrop = (await rowsByName(rpage)).map(r => r.name).join(",");
  await rpage.keyboard.press("Control+z");
  await pacedWait(rpage, 200);
  const testResult = (await rowsByName(rpage)).map(r => r.name).join(",");
  ok("R · a genuine no-op drop (released back at its own current position) changes nothing, and pushes NO spurious undo entry of its own — one Ctrl+Z after the no-op drag lands on the exact same state as one Ctrl+Z with no drag at all (a phantom entry would need a SECOND press to get there)",
    afterDrop === before && testResult === controlResult,
    `same-as-before(drop)=${afterDrop===before} test-matches-control=${testResult===controlResult}`);
  await rpage.close();
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// M — GRIP-TO-ID-NUMBER SPACING (folded into this PR; kept in its own report section). Measures
// the actual rendered gap, confirms no truncation at 3/4-digit ids at both row-height extremes,
// and re-proves row-range select (the exact thing an earlier version of this grip broke).
// ════════════════════════════════════════════════════════════════════════════════════════════
console.log("\n═══ STEP — GRIP-TO-ID-NUMBER SPACING (separate from the band/depth work above) ═══");

async function gripGapMeasurement(page, taskId, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const result = await page.evaluate((id) => {
      const grip = document.querySelector(`[data-row-drag-handle="${id}"]`);
      const idCell = document.querySelector(`[data-task-row="${id}"] [data-col-key="id"]`);
      // The GRIP itself also carries a title ("Drag to move") and sits FIRST in DOM order, so a
      // plain `span[title]` query matches the grip, not the number's own wrapper span — exclude
      // it explicitly.
      const outerSpan = idCell ? [...idCell.querySelectorAll('span[title]')].find(s => !s.hasAttribute('data-row-drag-handle')) : null;
      // Match by NUMERIC content, not exact-string-equals-id — robust to a leading rowColor
      // swatch/trailing B/I badge span sitting alongside it, and to any incidental whitespace.
      const numberSpan = outerSpan ? [...outerSpan.querySelectorAll('span')].find(s => /^\d+$/.test((s.textContent || "").trim())) : null;
      if (!grip || !idCell || !numberSpan) return { missing: { grip: !grip, idCell: !idCell, outerSpan: !outerSpan, numberSpan: !numberSpan }, outerHTML: idCell ? idCell.outerHTML : null };
      const g = grip.getBoundingClientRect(), n = numberSpan.getBoundingClientRect(), c = idCell.getBoundingClientRect();
      // The real font actually applied to the number, so the 4-digit projection below (the app
      // can't yet render a real 4-digit id — see gripFixture) uses MEASURED metrics, not a guess.
      const font = getComputedStyle(numberSpan).font;
      return { gapPx: +(n.left - g.right).toFixed(2), cellWidthPx: +c.width.toFixed(2), cellRight: c.right,
        numberText: numberSpan.textContent, numberRight: n.right, truncated: n.right > c.right + 0.5, font };
    }, taskId);
    if (!result.missing) return result;
    if (attempt === retries - 1) { console.log(`  ⚠ gripGapMeasurement(${taskId}): row never rendered — missing=${JSON.stringify(result.missing)} idCellHTML=${result.outerHTML}`); return null; }
    await pacedWait(page, 250);
  }
  return null;
}

// Canvas-measured width of a candidate id STRING at the exact font the app renders the number
// in (pulled live from m121.font above) — used only for the 4-digit projection, since the app
// structurally cannot render a real 4-digit id without 1000+ tasks (impractical to construct
// here just to prove a font metric that's already measured).
async function textWidthAtFont(page, str, font) {
  return page.evaluate(({ str, font }) => {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = font;
    return ctx.measureText(str).width;
  }, { str, font });
}

for (const rh of [20, 34]) {
  const gpage = await freshFixturePage(gripFixture(rh));
  // The grid is VIRTUALIZED (data-grid-scroll — only the rows near the viewport are ever in the
  // DOM), so task 121 (the last of 121 rows) isn't rendered at the initial scroll position.
  // Scroll it into the rendered window before measuring anything about it — with real clearance
  // below the sticky column-header row, not just barely past it. getBoundingClientRect() (used by
  // the gap/truncation measurements below) doesn't care about visual stacking, so a row sitting
  // right at the header's edge still measures fine — but a REAL mouse click there hits the sticky
  // header instead (higher paint order), which is exactly what silently broke the first version
  // of the range-select re-check below: rows rendered correctly, geometry read correctly, and a
  // real drag still landed on the wrong element. 5 rows of buffer clears it.
  await gpage.evaluate((rowHeight) => { const el = document.querySelector('[data-grid-scroll]'); if (el) el.scrollTop = Math.max(0, (121 - 5) * rowHeight); }, rh);
  await pacedWait(gpage, 200);
  const m121 = await gripGapMeasurement(gpage, 121);
  console.log(`  ROW_H=${rh}: 3-digit "121" (real DOM render) — gap=${m121?.gapPx}px, cell=${m121?.cellWidthPx}px, truncated=${m121?.truncated}, font="${m121?.font}"`);
  ok(`M1 · ROW_H=${rh}: grip↔number gap is now a real, visible gap (>1px) instead of 0/negative (touching/overlapping)`,
    m121 && m121.gapPx > 1, `gapPx=${m121?.gapPx}`);
  ok(`M2 · ROW_H=${rh}: the ID cell is still 30px wide (unchanged) — the gap came from the number's own padding, not from widening the cell`,
    m121 && Math.abs(m121.cellWidthPx - 30) < 0.5, `cellWidthPx=${m121?.cellWidthPx}`);
  ok(`M3 · ROW_H=${rh}: a 3-digit id ("121", his real row numbers) is NOT truncated by the added padding`,
    m121 && m121.truncated === false, JSON.stringify(m121));

  // 4-digit projection: the app auto-renumbers every project to sequential 1..N on load, so a
  // literal 4-digit id would need a 1000+-task fixture — impractical just to re-prove a font
  // metric already measured above. Instead: take the REAL available width from the 3-digit
  // render (cellRight - numberLeft-equivalent, i.e. how much room was left over) and check
  // whether "9999" (the widest plausible 4-digit string) fits in that same space at the SAME
  // measured font.
  const availablePx = m121.cellRight - (m121.numberRight - await textWidthAtFont(gpage, "121", m121.font));
  const w9999 = await textWidthAtFont(gpage, "9999", m121.font);
  const w121 = await textWidthAtFont(gpage, "121", m121.font);
  console.log(`  ROW_H=${rh}: 4-digit projection — "121" measures ${w121.toFixed(2)}px, "9999" measures ${w9999.toFixed(2)}px, ${availablePx.toFixed(2)}px available before the cell's right edge`);
  // NOT gated as a pass/fail (`ok()`) — this projects a scenario the app cannot currently reach
  // (a 4-digit id needs 1000+ tasks in one project, and ids auto-renumber to sequential 1..N on
  // every load) and is not a regression against anything that worked before: the OLD 4px padding
  // had MORE room, but "9999" never actually rendered under it either. Reported honestly per
  // LOUD-FAILURE rather than silently forced to green or silently omitted.
  const fits4Digit = w9999 <= availablePx;
  console.log(`  ${fits4Digit ? "✅" : "⚠"} M4 · ROW_H=${rh}: a 4-digit id ("9999") is${fits4Digit ? "" : " NOT"} projected to fit in the current 30px ID column at 12px padding (by real font metrics; not yet DOM-verifiable — no project has 1000+ tasks). w9999=${w9999.toFixed(2)}px available=${availablePx.toFixed(2)}px`);
  if (!fits4Digit) console.log(`     Not a regression today (his real 3-digit ids have full headroom — see M1-M3) — if a project ever reaches 1000+ tasks, the ID column would need widening by ~${(w9999 - availablePx).toFixed(1)}px. Flagging now rather than silently clipping later.`);

  // Re-verify row-range select still works — the exact thing an EARLIER version of this grip
  // broke by covering the whole ID cell. Measured via the range badge text AND the selected-
  // range cell background color, not eyeballed. (Tasks 120 and 121 — the last two of the 121-row
  // fixture — are adjacent, plain top-level rows.)
  await selectRowRange(gpage, "Task 120", "Task 121");
  const badgeText = await gpage.evaluate(() => {
    const badge = [...document.querySelectorAll('div')].find(d => /^\d+\s*×\s*\d+$/.test((d.textContent || "").trim()) && d.children.length === 0);
    return badge ? badge.textContent.trim() : null;
  });
  const bg121 = await gpage.evaluate(() => getComputedStyle(document.querySelector('[data-task-row="121"] [data-col-key="id"]')).backgroundColor);
  // Dragging in the ID column is Excel row-header behavior — it selects the WHOLE row across
  // every visible column ("2 × 18", not "2 × 1"), by design (see the rowMode branch in the
  // mousedown handler). Assert the ROW count only; the column count is fixture/column-config
  // dependent and isn't what this check is about.
  const badgeRows = badgeText ? Number(badgeText.split("×")[0].trim()) : null;
  ok(`M5 · ROW_H=${rh}: a two-row drag across the ID cells STILL produces a range selection spanning both rows (badge="${badgeText}"), selected cell background is the range-select blue — the grip change did not regress this`,
    badgeRows === 2 && bg121 === "rgb(219, 234, 254)", `badge="${badgeText}" bg121="${bg121}"`);
  await gpage.close();
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// SCREENSHOTS — at his 20px row height: at-rest with the grip visible, mid-drag with the
// indicator between two siblings, mid-drag with the indicator at a nested depth. Saved as PNGs;
// sent alongside the PR since a paragraph describing a drag affordance isn't reviewable.
// ════════════════════════════════════════════════════════════════════════════════════════════
console.log("\n═══ SCREENSHOTS (ROW_H=20) ═══");
// Each shot gets its OWN fresh page boot — no shared state, no undo between shots. (An earlier
// version reused one page and Ctrl+Z'd between shots; dragging "Entitlement Review A" to just
// before "Entitlement Review B" is a NO-OP — they're already adjacent — so that Ctrl+Z had
// nothing of its OWN to undo and instead undid the fixture IMPORT itself, per the same mechanism
// check R measures. Isolation avoids the whole class of bug rather than working around it.)
{
  // 1. At rest, grip visible (hover the row so `.drow:hover .rowgrip{opacity:1}` is showing it at
  //    full strength, not just its always-on .55 baseline).
  const p1 = await freshFixturePage({ ...FIXTURE, settings: { rowHeight: 20 } });
  const phase1Row = await p1.locator('[data-task-row]').first().boundingBox();
  await p1.mouse.move(phase1Row.x + 15, phase1Row.y + phase1Row.height / 2);
  await pacedWait(p1, 120);
  await p1.screenshot({ path: `${SHOT_DIR}01-at-rest-grip-visible.png`, clip: { x: 0, y: Math.max(0, phase1Row.y - 4), width: 420, height: 120 } });
  await p1.close();

  // 2. Mid-drag, indicator between two SIBLINGS (Punch List -> before Entitlement Review A —
  //    both top-level and NOT adjacent, so this is a real, in-flight drag) — the line should sit
  //    at level-0 (flush) indent.
  {
    const p2 = await freshFixturePage({ ...FIXTURE, settings: { rowHeight: 20 } });
    const from = await byName(p2, "Punch List");
    const to = await byName(p2, "Entitlement Review A");
    const grip = await p2.locator(`[data-row-drag-handle="${from.id}"]`).boundingBox();
    const target = await p2.locator(`[data-task-row="${to.id}"]`).boundingBox();
    await p2.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await p2.mouse.down();
    await pacedWait(p2, 60);
    await p2.mouse.move(target.x + target.width / 2, target.y + 2, { steps: 6 }); // top of A = "before" band
    await pacedWait(p2, 150);
    await p2.screenshot({ path: `${SHOT_DIR}02-mid-drag-sibling-depth.png`, clip: { x: 0, y: Math.max(0, target.y - 40), width: 420, height: 120 } });
    await p2.mouse.up();
    await pacedWait(p2, 250);
    await p2.close(); // discard — no need to undo, this page is thrown away
  }

  // 3. Mid-drag, indicator at a NESTED depth (drop between Phase 1 and its first child Mobilize —
  //    the exact "Platting" gap from the depth-resolution rule). Mover is "Phase 2" — close to the
  //    target rows (unlike PID Formation, several rows further down), so the drag doesn't risk
  //    auto-scroll shifting the layout between capturing the target box and settling the drop.
  {
    const p3 = await freshFixturePage({ ...FIXTURE, settings: { rowHeight: 20 } });
    const from = await byName(p3, "Phase 2");
    const to = await byName(p3, "Mobilize");
    const grip = await p3.locator(`[data-row-drag-handle="${from.id}"]`).boundingBox();
    const target = await p3.locator(`[data-task-row="${to.id}"]`).boundingBox();
    await p3.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await p3.mouse.down();
    await pacedWait(p3, 60);
    await p3.mouse.move(target.x + target.width / 2, target.y + 2, { steps: 6 }); // top of Mobilize = "before" band = the Platting gap
    await pacedWait(p3, 150);
    // Verify the line actually landed on the expected gap (indented — a nested drop, not flush
    // against the row list's left edge) before capturing; retry once if not settled yet.
    let lineBox = await p3.locator('[data-drag-insert-line]').boundingBox();
    const nameBox = await p3.locator(`[data-task-row="${to.id}"] [data-col-key="name"]`).boundingBox();
    if (!lineBox || lineBox.x <= nameBox.x) {
      await pacedWait(p3, 200);
      lineBox = await p3.locator('[data-drag-insert-line]').boundingBox();
    }
    const phase1Box = await p3.locator('[data-task-row]').first().boundingBox();
    await p3.screenshot({ path: `${SHOT_DIR}03-mid-drag-nested-depth.png`, clip: { x: 0, y: Math.max(0, phase1Box.y - 4), width: 420, height: 120 } });
    await p3.mouse.up();
    await pacedWait(p3, 250);
    await p3.close();
  }
  console.log(`  saved: ${SHOT_DIR}01-at-rest-grip-visible.png, 02-mid-drag-sibling-depth.png, 03-mid-drag-nested-depth.png`);
}

if (page) await page.close();
server.close();

// ════════════════════════════════════════════════════════════════════════════════════════════
// MUTATION BATTERY — each non-negotiable proven discriminating against a targeted regression.
// ════════════════════════════════════════════════════════════════════════════════════════════
async function runMutation(label, needle, replacement, run, fixture = FIXTURE) {
  if (!newBody.includes(needle)) { ok(`${label} · mutation target found in source`, false); return; }
  const mutated = newBody.replace(needle, replacement);
  const { server: ms, url: murl } = await makeServer(mutated);
  const mpage = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  try {
    await bootAndImport(mpage, murl, fixture);
    await run(mpage);
  } finally {
    await mpage.close(); ms.close();
  }
}

// TWO-BAND · MUTATION: reintroduce a middle dead zone (widen back toward the old 30/40/30 split,
// but landing NOWHERE rather than "into" — see below), proving the STEP2 "zero into" sweep is
// discriminating, not just never exercised. Verified via the SAME sweep methodology STEP2 itself
// uses (bandFixture, T1→T3, dragRowToPixelY + classifyBandOutcome), rather than a single ad-hoc
// drag: an early version of this check aimed one exact drag at the full nested FIXTURE's
// dead-center pixel and was flaky there (real tick-to-tick jitter of a whole row's worth of Y
// under headless Chromium against that more complex fixture — confirmed via instrumentation to
// be a measurement artifact, not a product defect). The flat bandFixture + a multi-pixel sweep is
// what STEP2 already proved reliable across 20–34 samples with zero instability; reusing it here
// inherits that reliability instead of re-deriving a new flaky probe.
await runMutation("TWOBAND",
  'const frac = rowFloat - idx;\n          gapIndex = frac < 0.5 ? idx : idx + 1;',
  'const frac = rowFloat - idx;\n          if (frac > 0.3 && frac < 0.7) { gapIndex = null; }\n          else gapIndex = frac < 0.5 ? idx : idx + 1;',
  async (mpage) => {
    // this mutation makes the middle band produce NO drop (gapIndex null) rather than a true
    // "into" — different failure shape than the original #1107 bug, but still proves the
    // band-count check is live: some pixel in the row's middle now does NOTHING on drop, where
    // the real two-band code always lands before/after.
    const before = (await rowsByName(mpage)).map(r => r.name).join(",");
    const target = await mpage.locator('[data-task-row="3"]').boundingBox(); // T3
    let anyNoOp = false;
    for (let y = 0; y < target.height && !anyNoOp; y++) {
      await dragRowToPixelY(mpage, "T1", "T3", y);
      const after = (await rowsByName(mpage)).map(r => r.name).join(",");
      if (after === before) anyNoOp = true;
      else { await mpage.keyboard.press("Control+z"); await pacedWait(mpage, 90); }
    }
    ok("TWOBAND · MUTATION (middle dead-zone reintroduced): at least one pixel in the row's middle now produces NO drop at all, where the real two-band code always lands before/after it — check correctly goes red",
      anyNoOp, `anyNoOp=${anyNoOp}`);
  },
  bandFixture(24));

// DEPTHCLAMP · MUTATION: remove the depth-clamp condition entirely — the DANGEROUS mutation the
// owner specifically asked this file be able to catch (silent adoption of an existing child).
await runMutation("DEPTHCLAMP",
  'if (rowBelow && rowBelow.parentId === rowAbove.id) return { destParentId: rowAbove.id, insertAfterId: "start", level: rowBelow.level };',
  '// MUTATED: clamp removed — always matches the row above, never the row below',
  async (mpage) => {
    const phase1ChildrenBefore = await directChildCount(mpage, "Phase 1");
    await dragRowTo(mpage, "PID Formation", "Mobilize", "before"); // the Platting-style gap
    const pidChildrenAfter = await directChildCount(mpage, "PID Formation");
    const phase1ChildrenAfter = await directChildCount(mpage, "Phase 1");
    // Without the clamp, "before Mobilize" resolves via rowAbove=Phase1 → destParentId=Phase1's
    // OWN parent (top-level) — PID Formation becomes Phase 1's SIBLING, and because it's spliced
    // in ahead of Phase 1's whole subtree in array order... the adoption shows up as PID Formation
    // NOT being Phase 1's child at all (undershooting depth), which is itself the danger case:
    // Mobilize/Sitework's own parentage doesn't move, but the row lands at the WRONG depth,
    // silently NOT nested where the line pointed.
    ok("DEPTHCLAMP · MUTATION (clamp removed): dropping between an expanded parent and its first child no longer lands the row AS that parent's own child — check J correctly goes red",
      pidChildrenAfter !== 0 || phase1ChildrenAfter !== phase1ChildrenBefore + 1, `pidChildrenAfter=${pidChildrenAfter} phase1Children ${phase1ChildrenBefore}->${phase1ChildrenAfter}`);
  });

// B · MUTATION: reparent DIRECT CHILDREN of a moved root too (flattens one level instead of
// leaving the subtree untouched) — unchanged target, moveSelectionToDestination wasn't touched.
await runMutation("B",
  "let working = tasks.map(t => rootSet.has(t.id) ? { ...t, parentId: destParentId } : t);",
  "let working = tasks.map(t => rootSet.has(t.id) ? { ...t, parentId: destParentId } : (rootIds.some(r => t.parentId === r) ? { ...t, parentId: destParentId } : t));",
  async (mpage) => {
    await dragRowTo(mpage, "PUD Development Agreement", "PID Formation", "after");
    const rows = await rowsByName(mpage);
    const pudIdx = rows.findIndex(r => r.name === "PUD Development Agreement");
    const childrenStillUnderPud = rows[pudIdx + 1]?.name === "Draft PUD" && rows[pudIdx + 2]?.name === "Submit PUD";
    ok("B · MUTATION (direct children flattened onto the destination): the subtree no longer stays under the moved parent — check B correctly goes red",
      !childrenStillUnderPud, `childrenStillUnderPud=${childrenStillUnderPud}`);
  });

// C · MUTATION: force-expand ANY destParentId's sibling gap too (simulates auto-expand no longer
// being scoped to genuine "into" destinations) — proves check C would catch Phase 2 popping open.
await runMutation("C",
  'if (destParentId != null) working = working.map(t => t.id === destParentId ? { ...t, isExpanded: true, focused: false } : t);',
  'working = working.map(t => t.id === 4 ? { ...t, isExpanded: true, focused: false } : t); // MUTATED: force-expand Phase 2 unconditionally',
  async (mpage) => {
    await dragRowTo(mpage, "PID Formation", "Phase 2", "after"); // beside it, should NOT touch its expand state
    const phase2 = await byName(mpage, "Phase 2");
    ok("C · MUTATION (Phase 2 force-expanded regardless of destination): dropping BESIDE it no longer leaves it collapsed — check C correctly goes red",
      phase2.expanded !== false, JSON.stringify(phase2));
  });

// D · MUTATION: structuralTargets ignores the active row range.
await runMutation("D",
  "return ids.length > 1 && ids.includes(anchorId) ? ids : [anchorId];",
  "return [anchorId];",
  async (mpage) => {
    await selectRowRange(mpage, "Entitlement Review A", "Entitlement Review B");
    await dragRowTo(mpage, "Entitlement Review A", "Phase 1", "before");
    const rows = await rowsByName(mpage);
    const phase1Idx = rows.findIndex(r => r.name === "Phase 1");
    const aIdx = rows.findIndex(r => r.name === "Entitlement Review A");
    const bIdx = rows.findIndex(r => r.name === "Entitlement Review B");
    const bothMoved = aIdx < phase1Idx && bIdx < phase1Idx && Math.abs(aIdx - bIdx) === 1;
    ok("D · MUTATION (structuralTargets ignores the range): only the grabbed row moves, its selected sibling is left behind — check D correctly goes red",
      !bothMoved, `phase1Idx=${phase1Idx} aIdx=${aIdx} bIdx=${bIdx}`);
  });

// E · MUTATION: root rows reparent WITHOUT their other fields (predecessors silently dropped).
await runMutation("E",
  "let working = tasks.map(t => rootSet.has(t.id) ? { ...t, parentId: destParentId } : t);",
  "let working = tasks.map(t => rootSet.has(t.id) ? { id: t.id, name: t.name, parentId: destParentId, isExpanded: t.isExpanded, start: t.start, end: t.end, duration: t.duration, durValue: t.durValue, durUnit: t.durUnit, health: t.health, percentComplete: t.percentComplete } : t);",
  async (mpage) => {
    const before = await byName(mpage, "Annexation Petition");
    await dragRowTo(mpage, "PUD Development Agreement", "Sitework", "after");
    const after = await byName(mpage, "Annexation Petition");
    ok("E · MUTATION (predecessors dropped on reparent): Annexation's FS-derived Start is no longer preserved — check E correctly goes red",
      !(before && after && before.start === after.start), `before=${before?.start} after=${after?.start}`);
  });

// F · MUTATION: wire moveRows into the per-frame paint loop too (the B1121-shaped regression).
await runMutation("F",
  "const onMove = (ev) => { state.lastClientY = ev.clientY; };",
  "const onMove = (ev) => { state.lastClientY = ev.clientY; if (state.overGapIndex != null && moveRows) { const { destParentId, insertAfterId } = resolveDropParent(state.overGapIndex); moveRows(anchorTaskId, destParentId, insertAfterId); } };",
  async (mpage) => {
    const snapshot = async () => (await rowsByName(mpage)).map(r => r.name).join("|");
    const beforeSnap = await snapshot();
    await dragRowTo(mpage, "Punch List", "Mobilize", "before");
    await mpage.keyboard.press("Control+z");
    await pacedWait(mpage, 250);
    const undoneSnap = await snapshot();
    ok("F · MUTATION (commit wired into the per-frame paint loop): ONE Ctrl+Z no longer fully reverts the gesture (multiple undo-worthy ops were pushed) — check F correctly goes red",
      undoneSnap !== beforeSnap, `equal=${undoneSnap===beforeSnap}`);
  });

// G · MUTATION: copyTaskById silently behaves like cut (regression: copy strips the source).
await runMutation("G",
  'clipboardRef.current = { mode: "copy", tasks: subtree, sourceProjId: pid, sourceRootIds: rootIds };\n    setClipboardTick(t => t + 1);\n    const extra = subtree.length - rootIds.length;\n    const label = rootIds.length > 1 ? `${rootIds.length} tasks` : `“${subtree[0].name || "task"}”`;\n    showToast(`Copied ${label}${extra > 0 ? ` + ${extra} subtask${extra > 1 ? "s" : ""}` : ""}`, { duration: 1800 });',
  'clipboardRef.current = { mode: "cut", tasks: subtree, sourceProjId: pid, sourceRootIds: rootIds };\n    setClipboardTick(t => t + 1);\n    const extra = subtree.length - rootIds.length;\n    const label = rootIds.length > 1 ? `${rootIds.length} tasks` : `“${subtree[0].name || "task"}”`;\n    showToast(`Copied ${label}${extra > 0 ? ` + ${extra} subtask${extra > 1 ? "s" : ""}` : ""}`, { duration: 1800 });',
  async (mpage) => {
    const pud = await byName(mpage, "PUD Development Agreement");
    await mpage.locator(`[data-task-row="${pud.id}"] [data-col-key="id"]`).click();
    await mpage.keyboard.press("Control+c");
    await pacedWait(mpage, 150);
    const punchList = await byName(mpage, "Punch List");
    await mpage.locator(`[data-task-row="${punchList.id}"] [data-col-key="id"]`).click();
    await mpage.keyboard.press("Control+v");
    await pacedWait(mpage, 350);
    const copies = (await rowsByName(mpage)).filter(r => r.name === "PUD Development Agreement");
    ok("G · MUTATION (copy silently cuts): the original vanishes after a \"copy\"+paste — check G correctly goes red",
      copies.length !== 2, `copies=${copies.length}`);
  });

// H · MUTATION: the context-menu item no longer opens the picker.
await runMutation("H",
  'onMoveTo={() => { setMoveToCtx({ ids: structuralTargets(taskCtx.task.id), projId: taskCtx.projId }); setTaskCtx(null); }}',
  'onMoveTo={() => { setTaskCtx(null); }}',
  async (mpage) => {
    const target = await byName(mpage, "Punch List");
    await mpage.locator(`[data-task-row="${target.id}"] [data-col-key="id"]`).click({ button: "right" });
    await pacedWait(mpage, 150);
    await mpage.locator("i.ti-folder-symlink").locator("..").click();
    await pacedWait(mpage, 200);
    const modalVisible = await mpage.locator('[data-move-to-modal]').isVisible().catch(() => false);
    ok("H · MUTATION (menu item wiring removed): the picker no longer opens — check H correctly goes red",
      !modalVisible);
  });

// M · MUTATION: revert the grip-spacing padding back to its old (touching) value.
await runMutation("M",
  'paddingLeft:12}}',
  'paddingLeft:4}}',
  async (mpage) => {
    const g = await gripGapMeasurement(mpage, 9); // PID Formation, id 9, single digit in this fixture — still measures the gap
    ok("M · MUTATION (paddingLeft reverted to 4): the grip↔number gap collapses back to ~0/negative — check M1 correctly goes red",
      g && g.gapPx <= 1, `gapPx=${g?.gapPx}`);
  });

await browser.close();

const passed = results.filter(r => r.pass).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
if (passed !== results.length) process.exit(1);
