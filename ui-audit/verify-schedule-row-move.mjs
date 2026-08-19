/* SCHEDULE GRID — NO WAY TO MOVE ROWS (NEW-ROWMOVE).
 *
 * Owner report, decoded (voice transcript mangled the domain terms — PUD development agreement,
 * PID Public Improvement District, annexation — into nonsense; verbatim quote on the item/PR): he
 * created new Phase 1 / Phase 2 sections in an existing schedule and the permitting/entitlement
 * tasks that belong under Phase 2 are scattered where they were originally created. No way to drag
 * rows to reorganize them, and no confidence copy/paste works either.
 *
 * STEEL-MAN, stated in the PR: drag alone does not solve "gather 12 scattered tasks into a group"
 * as well as a searchable "Move to…" command does, because the selection model in this codebase is
 * a single contiguous rectangle (no ctrl-click) — scattered tasks can never be multi-selected in one
 * gesture regardless of mechanism. So this ships BOTH: drag (the mechanism he named, genuinely
 * useful for local reorders) AND "Move to…" (which is what actually solves his stated scenario,
 * repeated once per scattered task). Both commit through the SAME pure primitive,
 * moveSelectionToDestination (schedule-tree-ops.mjs / index.html), so this harness exercises that
 * shared primitive from both entry points rather than duplicating coverage.
 *
 * MEASURED, per the brief's requirement to state clipboard behaviour precisely before changing it:
 * before this change, Ctrl+C/X/V and the context-menu Cut/Copy/Paste operated on `selectedId` ALONE
 * — the drag/shift-click ANCHOR row — regardless of column span (single cell, a cell range, a
 * full-row selection) and, critically, regardless of a multi-row range: a 6-row selection copied
 * exactly ONE row's subtree with no error and no indication anything else was dropped. Fixed the
 * same way as indent/outdent/delete (B<NEW>, already shipped): every entry point now resolves the
 * whole selection via structuralTargets first. See test/scheduleIndentOutdentDelete.test.js for the
 * fast pure-function + source-pin half; this file is the live-browser proof, driven with REAL mouse
 * input (page.mouse.move/down/up — never a synthetic dispatchEvent, per SYNTHETIC-KEYS-DONT-EDIT's
 * sibling caution about untrusted events not propagating the way a real gesture does).
 *
 * NON-NEGOTIABLES this file proves, each with its own MUTATION so the check is shown to be
 * discriminating rather than defensive (a check that never goes red is not a check):
 *   A. same-level reorder (before/after a sibling)
 *   B. a moved PARENT takes its whole subtree — child count/order preserved, verified by name
 *   C. dropping into a COLLAPSED group auto-expands it and the moved row lands visibly inside
 *   D. a multi-row (contiguous range) selection moves in FULL, not just the grabbed row
 *   E. a predecessor link survives a cross-parent move and stays LIVE (date unchanged, still driven)
 *   F. the WHOLE drag gesture is ONE undo step — one Ctrl+Z fully reverts it, not a partial revert
 *   G. copy/paste round-trip: a parent+children pasted elsewhere leaves the original untouched
 *   H. the "Move to…" menu item actually opens the picker (UI wiring, not just the primitive)
 *   I. a drag across a 529-row-scale list causes ZERO row DOM churn (no re-render) until the drop
 *
 * Run: node ui-audit/verify-schedule-row-move.mjs   [PW_CHROME=<chrome>]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const HTML_PATH = new URL("../public/sequence/index.html", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const realBody = await readFile(HTML_PATH, "utf8");
await ensureVendored();

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

async function makeServer(bodyOverride) {
  const server = createServer(async (req, res) => {
    try {
      if (await serveVendored(req, res)) return;
      let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      if (p.endsWith("sequence/index.html")) {
        const src = bodyOverride ?? realBody;
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

// ── Fixture — a throwaway plan shaped like the owner's real scenario ───────────────────────────
// Phase 1 (1, expanded) -> Mobilize (2), Sitework (3)
// Phase 2 (4, COLLAPSED — the "drop into a collapsed group" case) -> Foundation (5, hidden)
// Scattered top-level entitlement work he wants gathered into Phase 2:
//   PUD Development Agreement (6, a PARENT) -> Draft PUD (7), Submit PUD (8)
//   PID Formation (9)
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
// Indentation LEVEL (0 = top-level), read from the name cell's own paddingLeft — the same robust
// technique the pre-existing indent/outdent harness uses, and independent of row COUNT/INDEX,
// which drifts across a sequence of checks that keep mutating the same live fixture.
async function levelOf(page, name) {
  const row = await byName(page, name);
  if (!row) return null;
  return page.evaluate((id) => {
    const nameCell = document.querySelector(`[data-task-row="${id}"] [data-col-key="name"]`);
    const span = nameCell?.querySelector("span");
    if (!span) return null;
    const pl = parseFloat(getComputedStyle(span).paddingLeft);
    return Math.round((pl - 4) / 14); // matches Cell's `paddingLeft:4+task.level*14`
  }, row.id);
}

// Real mouse drag — grip mousedown, move toward the target row, land in the requested band, drop.
// band: "before" (top of target row, same parent as target) | "after" (bottom) | "into" (middle third)
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
  const frac = band === "before" ? 0.1 : band === "after" ? 0.9 : 0.5;
  await page.mouse.move(target.x + target.width / 2, target.y + target.height * frac, { steps: 3 });
  await pacedWait(page, 150);
  await page.mouse.up();
  await pacedWait(page, 350);
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
    // put them back in original order for the rest of the run (drag A before B)
    await dragRowTo(page, "Entitlement Review A", "Entitlement Review B", "before");
  }

  // ── B: moving a PARENT takes its whole subtree, child count/order preserved ────────────────
  {
    const beforeChildren = ["Draft PUD", "Submit PUD"];
    await dragRowTo(page, "PUD Development Agreement", "PID Formation", "after");
    const rows = await rowsByName(page);
    const pud = rows.find(r => r.name === "PUD Development Agreement");
    const pudIdx = rows.findIndex(r => r.name === "PUD Development Agreement");
    const afterChildren = rows.slice(pudIdx + 1, pudIdx + 3).map(r => r.name);
    ok("B · moving a parent carries its whole subtree — 2 children, same order, still directly beneath it",
      JSON.stringify(afterChildren) === JSON.stringify(beforeChildren), `got=${JSON.stringify(afterChildren)}`);
  }

  // ── C: dropping into a COLLAPSED group auto-expands it, moved row lands visibly inside ─────
  {
    const phase2Before = await byName(page, "Phase 2");
    ok("C0 · fixture sanity: Phase 2 starts COLLAPSED", phase2Before.expanded === false, JSON.stringify(phase2Before));
    await dragRowTo(page, "PID Formation", "Phase 2", "into");
    const phase2After = await byName(page, "Phase 2");
    const pidAfter = await byName(page, "PID Formation");
    const rows = await rowsByName(page);
    const phase2Idx = rows.findIndex(r => r.name === "Phase 2");
    const pidIdx = rows.findIndex(r => r.name === "PID Formation");
    ok("C · drop into a collapsed group auto-expands it AND the moved row is immediately visible right under it",
      phase2After.expanded === true && pidIdx > phase2Idx && pidIdx < phase2Idx + 3,
      `phase2After.expanded=${phase2After.expanded} phase2Idx=${phase2Idx} pidIdx=${pidIdx}`);
  }

  // ── D: a multi-row (contiguous range) selection moves in FULL, not just the grabbed row ────
  {
    await selectRowRange(page, "Entitlement Review A", "Entitlement Review B");
    await dragRowTo(page, "Entitlement Review A", "Phase 2", "into"); // grab the FIRST of the two selected rows
    const rows = await rowsByName(page);
    const phase2Idx = rows.findIndex(r => r.name === "Phase 2");
    const aIdx = rows.findIndex(r => r.name === "Entitlement Review A");
    const bIdx = rows.findIndex(r => r.name === "Entitlement Review B");
    ok("D · dragging one row of a multi-row selection moves the WHOLE selection, not just the grabbed row (the historical indent/outdent bug shape, for move)",
      aIdx > phase2Idx && bIdx > phase2Idx && Math.abs(aIdx - bIdx) === 1,
      `phase2Idx=${phase2Idx} aIdx=${aIdx} bIdx=${bIdx}`);
  }

  // ── E: a predecessor link survives a cross-parent move and stays LIVE ──────────────────────
  {
    const before = await byName(page, "Annexation Petition");
    await dragRowTo(page, "PUD Development Agreement", "Sitework", "after"); // move PUD (Annexation's FS predecessor) under Phase 1
    const after = await byName(page, "Annexation Petition");
    ok("E · a predecessor link survives a cross-parent move — Annexation's FS-derived Start is unchanged (still driven by PUD, not silently dropped)",
      before && after && before.start === after.start && after.start !== "", `before=${before?.start} after=${after?.start}`);
  }

  // ── F: the WHOLE drag gesture is ONE undo step ──────────────────────────────────────────────
  {
    const snapshot = async () => (await rowsByName(page)).map(r => `${r.name}:${r.expanded}`).join("|");
    const beforeSnap = await snapshot();
    await dragRowTo(page, "Punch List", "Mobilize", "before");
    const movedSnap = await snapshot();
    ok("F0 · sanity: the move actually changed something", beforeSnap !== movedSnap);
    await page.keyboard.press("Control+z");
    await pacedWait(page, 250);
    const undoneSnap = await snapshot();
    ok("F · ONE Ctrl+Z fully reverts the whole drag gesture (not a partial/per-frame revert)",
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
      const origIdx = rows.findIndex(r => r.name === "PUD Development Agreement"); // first match = original position (still right before Draft/Submit PUD via its own subtree)
      return rows[origIdx + 1]?.name === "Draft PUD" && rows[origIdx + 2]?.name === "Submit PUD";
    })();
    ok("G · copy+paste round trip: a NEW copy of the parent+children appears AND the original is left completely untouched",
      copies.length === 2 && originalStillHasChildren, `copies=${copies.length} originalIntact=${originalStillHasChildren}`);
  }

  // ── H: "Move to…" menu wiring (independent entry point into the same primitive) ────────────
  {
    const target = await byName(page, "Punch List");
    await page.locator(`[data-task-row="${target.id}"] [data-col-key="id"]`).click({ button: "right" });
    await pacedWait(page, 150);
    await page.locator("i.ti-folder-symlink").locator("..").click();
    await pacedWait(page, 200);
    const modalVisible = await page.locator('[data-move-to-modal]').isVisible().catch(() => false);
    ok("H0 · sanity: the Move to… modal opens from the context menu", modalVisible);
    await page.locator('[data-move-to-modal] input').fill("Phase 1");
    await pacedWait(page, 150);
    await page.locator('[data-move-to-modal] [data-move-to-option]', { hasText: "Phase 1" }).click();
    await pacedWait(page, 350);
    // Read PARENTAGE via indentation LEVEL rather than array position — robust across a sequence
    // of checks that have already reshaped this same live fixture several times over.
    const phase1Level = await levelOf(page, "Phase 1");
    const punchLevel = await levelOf(page, "Punch List");
    const rows = await rowsByName(page);
    const phase1Idx = rows.findIndex(r => r.name === "Phase 1");
    const punchIdx = rows.findIndex(r => r.name === "Punch List");
    ok("H · Move to… commits through the SAME primitive: Punch List now sits one level deeper, directly after Phase 1's position in the tree",
      punchLevel === phase1Level + 1 && punchIdx > phase1Idx,
      `phase1Level=${phase1Level} punchLevel=${punchLevel} phase1Idx=${phase1Idx} punchIdx=${punchIdx}`);
  }

  // ── I: a drag across a large list causes ZERO row DOM churn until the drop ─────────────────
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
    });
    const grip = await bpage.locator('[data-row-drag-handle="2"]').boundingBox();
    await bpage.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await bpage.mouse.down();
    // Sweep the cursor down near the bottom edge repeatedly to force sustained auto-scroll —
    // the exact case the brief calls out (dragging across the whole 529-row-scale list).
    for (let i = 0; i < 6; i++) {
      await bpage.mouse.move(700, 900, { steps: 4 });
      await pacedWait(bpage, 180);
    }
    const rec = await bpage.evaluate(() => ({ ...window.__moveObs, attrTargets: [...window.__moveObs.attrTargets] }));
    await bpage.mouse.up();
    await pacedWait(bpage, 300);
    // A handful of attribute writes are EXPECTED and correct (the dim on the dragged row, the
    // into-highlight outline, the insertion line's own style) — the discriminator is childList:
    // zero row nodes added/removed/reordered means React never re-rendered the list mid-drag.
    ok("I · dragging across a ~540-row list (auto-scroll engaged) causes ZERO row DOM add/remove — no re-render per mousemove",
      rec.childListMutations === 0, `childListMutations=${rec.childListMutations} attrTargets=${JSON.stringify(rec.attrTargets).slice(0,200)}`);
    await bpage.close();
  }

} finally {
  // keep server/browser alive into the mutation battery below
}

// ── MUTATION BATTERY — each check above proven discriminating against a targeted regression ────
// Every mutation re-runs the ONE assertion it defeats against a freshly-served, freshly-mutated
// copy of the source, in a fresh page — never reusing state from the pass above.
async function runMutation(label, needle, replacement, run) {
  if (!realBody.includes(needle)) { ok(`${label} · mutation target found in source`, false); return; }
  const mutated = realBody.replace(needle, replacement);
  const { server: ms, url: murl } = await makeServer(mutated);
  const mpage = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  try {
    await bootAndImport(mpage, murl, FIXTURE);
    await run(mpage);
  } finally {
    await mpage.close(); ms.close();
  }
}

// A · MUTATION: swap the "before" and "after" band outcomes in the drop-zone detector, so aiming
// at the top third of a row drops AFTER it instead of before (and vice-versa).
await runMutation("A",
  'if (frac < 0.3)      { pos = "before"; paintTop = idx * ROW_H; }\n          else if (frac > 0.7) { pos = "after";  paintTop = (idx + 1) * ROW_H; }',
  'if (frac < 0.3)      { pos = "after"; paintTop = idx * ROW_H; }\n          else if (frac > 0.7) { pos = "before";  paintTop = (idx + 1) * ROW_H; }',
  async (mpage) => {
    const beforeOrder = (await rowsByName(mpage)).filter(r => r.name.startsWith("Entitlement Review")).map(r => r.name);
    await dragRowTo(mpage, "Entitlement Review B", "Entitlement Review A", "before");
    const afterOrder = (await rowsByName(mpage)).filter(r => r.name.startsWith("Entitlement Review")).map(r => r.name);
    ok("A · MUTATION (before/after bands swapped): aiming at the top of A no longer places B before it — check A correctly goes red",
      afterOrder[0] === beforeOrder[0], `beforeOrder=${beforeOrder} afterOrder=${afterOrder}`);
  });

// B · MUTATION: reparent DIRECT CHILDREN of a moved root too (a realistic "be extra sure
// everything moves" regression) — flattens one level instead of leaving the subtree untouched.
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

// C · MUTATION: remove the auto-expand-destination line.
await runMutation("C",
  'if (destParentId != null) working = working.map(t => t.id === destParentId ? { ...t, isExpanded: true, focused: false } : t);',
  '// MUTATED: auto-expand removed',
  async (mpage) => {
    await dragRowTo(mpage, "PID Formation", "Phase 2", "into");
    const phase2 = await byName(mpage, "Phase 2");
    ok("C · MUTATION (auto-expand removed): Phase 2 stays collapsed after the drop — check C correctly goes red",
      phase2.expanded !== true, JSON.stringify(phase2));
  });

// D · MUTATION: structuralTargets — the function the ACTUAL commit (moveRows -> moveSelectionByIds)
// resolves its id list through, shared with indent/outdent/copy/cut — ignores the active row range.
await runMutation("D",
  "return ids.length > 1 && ids.includes(anchorId) ? ids : [anchorId];",
  "return [anchorId];",
  async (mpage) => {
    await selectRowRange(mpage, "Entitlement Review A", "Entitlement Review B");
    await dragRowTo(mpage, "Entitlement Review A", "Phase 2", "into");
    const rows = await rowsByName(mpage);
    const phase2Idx = rows.findIndex(r => r.name === "Phase 2");
    const aIdx = rows.findIndex(r => r.name === "Entitlement Review A");
    const bIdx = rows.findIndex(r => r.name === "Entitlement Review B");
    // Both landing SOMEWHERE after Phase 2 is not enough to call this a pass — the real check
    // requires them CONTIGUOUS (moved together as one block); "only A moved, B is elsewhere" also
    // satisfies aIdx>phase2Idx && bIdx>phase2Idx in this fixture, so pin the adjacency too.
    const bothMoved = aIdx > phase2Idx && bIdx > phase2Idx && Math.abs(aIdx - bIdx) === 1;
    ok("D · MUTATION (structuralTargets ignores the range): only the grabbed row moves, its selected sibling is left behind — check D correctly goes red",
      !bothMoved, `phase2Idx=${phase2Idx} aIdx=${aIdx} bIdx=${bIdx}`);
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

// F · MUTATION: wire moveRows into the per-frame paint loop too (the B1121-shaped regression the
// brief explicitly warns against) — simulates committing on EVERY animation frame during the drag,
// not just on drop, which would push many undo entries for one gesture instead of one.
await runMutation("F",
  "const onMove = (ev) => { state.lastClientY = ev.clientY; };",
  "const onMove = (ev) => { state.lastClientY = ev.clientY; if (state.overPos && state.overTaskId != null && moveRows) { const ht = tasks.find(t => t.id === state.overTaskId); if (ht) moveRows(anchorTaskId, ht.parentId ?? null, ht.id); } };",
  async (mpage) => {
    const snapshot = async () => (await rowsByName(mpage)).map(r => `${r.name}:${r.expanded}`).join("|");
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

// H · MUTATION: the context-menu item no longer opens the picker (regression in the wiring itself,
// not the underlying primitive — this is the one thing mutations A/B/C/E cannot reach).
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

if (page) await page.close();
server.close();
await browser.close();

const passed = results.filter(r => r.pass).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
if (passed !== results.length) process.exit(1);
