/* B463922 — THE ROW YOU ARE WORKING ON MUST HOLD ITS PLACE ON SCREEN WHEN THE LIST RE-LAYS OUT.
 *
 * The verdict quantity is RENDERED POSITION — the anchor row's `getBoundingClientRect().top`
 * expressed relative to the scroll container, keyed on the row's IDENTITY, before and after each
 * action. Never `scrollTop`: that number moves on plenty of actions where the picture does not, and
 * holds still on some where it does.
 *
 * ⛔ EVERY CLICK GOES THROUGH `visibleClick`, AND THAT IS THE POINT. The predecessor of this file
 * clicked a collapse toggle that the virtualiser had rendered 75px ABOVE the viewport; Playwright
 * scrolled the container to reach it (through CDP, invisible to a patched scrollTop setter) and the
 * harness reported that scroll as the app throwing the edited row 477px down the screen, with
 * "programmatic writes: 0" as corroboration. Clicking only what a human could actually see is what
 * makes these numbers the product's. `lib/visibleClick.mjs` holds the three measurements that
 * settled it.
 *
 * ⛔ AND EVERY STEP CARRIES TWO WITNESSES, because this file's family of failures is the vacuous
 * green: the MODEL must have changed (the list got shorter or longer), and the SELECTION must still
 * be on the row we think is being edited — a click that lands on a row instead of its 13px toggle
 * silently moves the selection, and then the harness measures a row nobody is editing and reports
 * calm. Both were caught happening while this file was being written.
 *
 * ⛔ B463922 (×2), owner repro 2026-08-18: "clicking to open up the ALTA & Topo Survey stuff...
 * jumps me down to the middle of the schedule so I can't even see what I just opened." The FIRST
 * fix (above) made the row you're EDITING hold still — but it anchored on `selectedId` even when
 * nothing is actively being edited, just clicked-on-a-while-ago. Expanding a group with a stale,
 * merely-selected row sitting BELOW it and still on screen threw the toggled group and its brand
 * new children off screen ABOVE, to hold that stale row's screen position instead. Section 6 below
 * reproduces this exactly (a distant selection, no open editor, an expand target above it, both on
 * screen) and section 7 covers the sibling defect a row-height change has the same shape: rescaling
 * every row with no scrollTop compensation threw the on-screen row clean out of the render window.
 *
 * Run:  node ui-audit/verify-grid-row-hold.mjs      [PW_CHROME=<chrome>]
 *       PLANYR_URL=https://planyr.io/sequence/ node ui-audit/verify-grid-row-hold.mjs   (the deployed bytes)
 * Exit 0 = every anchor held. Exit 1 = a real jump, a vacuous step, or a wandering selection.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";
import { servedProvenance, provenanceReport } from "./lib/deployedTarget.mjs";
import { visibleClick, installScrollWitness, targetVisibility } from "./lib/visibleClick.mjs";

const TOL = 2;                       // px the anchor row may move on screen
const GRID = '[data-grid-scroll="1"]';
const ROOT = new URL("../public/", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

/* MERGED IS NOT DEPLOYED. With PLANYR_URL set this drives the artifact the owner actually opens,
   and states which commit's bytes came back before it measures anything. */
const DEPLOYED = process.env.PLANYR_URL || null;
let deployedBody = null;
await ensureVendored();
const server = createServer(async (req, res) => {
  try {
    if (await serveVendored(req, res)) return;
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = (deployedBody && p.endsWith("sequence/index.html")) ? deployedBody : await readFile(fp);
    if (p.endsWith("sequence/index.html")) body = Buffer.from(rewriteCdn(body.toString("utf8")));
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
if (DEPLOYED) {
  const prov = await servedProvenance(DEPLOYED);
  console.log(provenanceReport(prov, DEPLOYED));
  if (!prov.ok) { console.log("FAIL — the deployed artifact could not be read, so nothing here is a measurement of it."); process.exit(1); }
  deployedBody = prov.body;                       // drive the bytes he actually receives
}
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
/* A background tab cannot be measured: rAF is suspended, so a view change updates state while the
   picture never repaints and every geometry read describes a view the app already left. */
await assertMeasurable(page, "verify-grid-row-hold");
page.on("pageerror", e => console.log("  [pageerror]", e.message.slice(0, 160)));

const failures = [];
const line = s => console.log(s);

/* NEW-1 — every helper below closes over the scroll container node captured at install time, so
 * it must be RE-RUN (not just re-pointing window.__g) after anything that remounts the grid — a
 * Grid/Split/Gantt view switch, in particular, since App's `<ErrorBoundary key={data.view}>`
 * remounts the whole subtree and the old container node is detached. Extracted out of boot() so
 * the view-switch scenarios (D, E) can re-install against the fresh node without a page reload. */
async function installHelpers() {
  await page.waitForSelector(GRID, { timeout: 20000 });
  await page.evaluate(sel => {
    const g = document.querySelector(sel); window.__g = g;
    window.__rowTop = id => { const r = document.querySelector(`[data-task-row="${id}"]`); if (!r) return null;
      return Math.round(r.getBoundingClientRect().top - g.getBoundingClientRect().top); };
    // The model witness: the spacer's height tracks how many rows the flat list holds.
    window.__listLen = () => Math.round(g.scrollHeight);
    // The selection witness: the focused row is the one wearing the blue left border.
    window.__selRow = () => { const r = document.querySelector('.drow[style*="var(--blue)"]');
      return r ? r.getAttribute("data-task-row") : null; };
    /* The step witness. It has to watch the SELECTED row, not the top one: indenting changes one
       row's indent, Tab changes only which cell is active, and an undo changes one row's text —
       a witness watching the list length alone is blind to every one of them and reports a
       vacuous pass. */
    window.__witness = () => {
      const r = document.querySelector('.drow[style*="var(--blue)"]');
      const name = r ? r.children[1] : null;
      const active = [...document.querySelectorAll('.drow > div')].findIndex(d => (d.getAttribute("style")||"").includes("inset 0 0 0 2px"));
      return { len: Math.round(g.scrollHeight), row: r ? r.getAttribute("data-task-row") : null,
               text: r ? r.innerText : null, indent: name ? getComputedStyle(name.firstElementChild || name).paddingLeft : null,
               active };
    };
    window.__topRow = () => { const gr = g.getBoundingClientRect();
      for (const r of document.querySelectorAll("[data-task-row]")) { const b = r.getBoundingClientRect();
        if (b.top >= gr.top + 34) return r.getAttribute("data-task-row"); } return null; };
    // Rows carrying an expand/collapse toggle, with where each sits in the container's viewport.
    window.__toggles = title => { const gr = g.getBoundingClientRect();
      return [...document.querySelectorAll(`[data-task-row] span[title="${title}"]`)].map(t => {
        const r = t.getBoundingClientRect();
        return { row: t.closest("[data-task-row]").getAttribute("data-task-row"), top: Math.round(r.top - gr.top),
                 visible: r.top > gr.top + 40 && r.bottom < gr.bottom - 40 };
      }); };
  }, GRID);
}

async function boot() {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await installScrollWitness(page, GRID);
  await installHelpers();
  await page.evaluate(() => { window.__g.scrollTop = Math.floor(window.__g.scrollHeight / 2); });
  await pacedWait(page, 450);
}

/** A leaf row comfortably inside the viewport — "the row he is editing". */
const midRow = () => page.evaluate(() => {
  const g = window.__g, gr = g.getBoundingClientRect();
  const rows = [...document.querySelectorAll("[data-task-row]")].filter(r => {
    const b = r.getBoundingClientRect();
    return b.top > gr.top + 200 && b.bottom < gr.bottom - 200 && r.querySelector("[data-health-dot]");
  });
  return rows.length ? rows[Math.floor(rows.length / 2)].getAttribute("data-task-row") : null;
});

/** A leaf row comfortably NEAR THE TOP of the viewport — "he clicked it a while ago, then
 * scrolled away", the exact shape NEW-1 scenarios A/B stage. */
const nearTopRow = () => page.evaluate(() => {
  const g = window.__g, gr = g.getBoundingClientRect();
  const rows = [...document.querySelectorAll("[data-task-row]")].filter(r => {
    const b = r.getBoundingClientRect();
    return b.top > gr.top + 40 && b.top < gr.top + 160 && r.querySelector("[data-health-dot]");
  });
  return rows.length ? rows[0].getAttribute("data-task-row") : null;
});

/** Real wheel scrolling (not a scrollTop assignment) toward `target` — this is how he actually
 * scrolls, and it's what the owner's own repro used ("wheel down to scrollTop 2400"). */
async function wheelScrollTo(target) {
  const box = await page.locator(GRID).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => window.__g.scrollTop);
    if (st >= target) break;
    await page.mouse.wheel(0, Math.min(500, target - st + 60));
    await pacedWait(page, 25);
  }
  await pacedWait(page, 250);
}

async function selectRow(id) {
  await page.locator(`[data-task-row="${id}"] > div`).nth(1).click();
  await pacedWait(page, 300);
  const sel = await page.evaluate(() => window.__selRow());
  if (sel !== String(id)) { failures.push(`could not select row ${id} — the grid says ${sel}`); line(`  ✗ selection did not land on row ${id} (it is on ${sel})`); }
  return sel;
}

/** The closest VISIBLE toggle row sitting above `aboveTop` px in the container's viewport. */
async function pickToggleRow(title, aboveTop) {
  const ts = await page.evaluate(t => window.__toggles(t), title);
  const cand = ts.filter(t => t.visible && (aboveTop === null || t.top < aboveTop - 20));
  return cand.length ? cand[cand.length - 1].row : null;
}

async function clickToggle(rowId, title) {
  if (!rowId) return false;
  const tog = page.locator(`[data-task-row="${rowId}"] span[title="${title}"]`);
  const v = await targetVisibility(page, GRID, tog);
  if (!v.visible) return false;
  await visibleClick(page, GRID, tog, `${title} toggle on row ${rowId}`);
  return true;
}

async function step(label, anchorId, expectSel, act) {
  await page.evaluate(() => { window.__scrollWitness.writes.length = 0; });
  const before = await page.evaluate(i => ({ top: window.__rowTop(i), len: window.__listLen(), sel: window.__selRow() }), anchorId);
  const ok = await act();
  if (ok === false) { failures.push(`${label}: could not drive it (no visible target)`); line(`  ✗ ${label} — no visible target to drive`); return; }
  await pacedWait(page, 600);
  const after = await page.evaluate(i => ({ top: window.__rowTop(i), len: window.__listLen(), sel: window.__selRow() }), anchorId);
  const writes = await page.evaluate(() => window.__scrollWitness.writes.slice());
  if (after.len === before.len) {
    failures.push(`${label}: NOTHING CHANGED — the step did nothing, so its calm proves nothing`);
    line(`  ✗ ${label} — ⚠ the model did not change; a vacuous pass is not a pass`);
    return;
  }
  if (expectSel && after.sel !== String(expectSel)) {
    failures.push(`${label}: the selection moved (${before.sel} → ${after.sel}) — the step drove the wrong thing`);
    line(`  ✗ ${label} — the selection moved to ${after.sel}; this step is measuring a row nobody is editing`);
    return;
  }
  if (after.top === null) {
    failures.push(`${label}: the anchor row left the rendered window entirely`);
    line(`  ✗ ${label} — the anchor row is no longer rendered (the view left it)`);
    return;
  }
  const d = after.top - before.top;
  const pass = Math.abs(d) <= TOL;
  if (!pass) failures.push(`${label}: the anchor row moved ${d}px on screen (budget ±${TOL})`);
  line(`  ${pass ? "✓" : "✗"} ${label}`);
  line(`      anchor row ${anchorId}: ${before.top}px → ${after.top}px  (Δ ${d >= 0 ? "+" : ""}${d}px, budget ±${TOL})` +
       `   list height ${before.len} → ${after.len}   app scroll writes ${writes.length}`);
}

// ───────────────────────────────────────────────────────────────────────────────
line("\nB463922 — does the row you are working on hold its place when the list re-lays out?\n");

// 1. A group ABOVE the edited row collapses, then expands again, then a second one collapses.
await boot();
let ROW = await midRow();
await selectRow(ROW);
let rowTop = await page.evaluate(i => window.__rowTop(i), ROW);
line(`editing row ${ROW}, on screen at ${rowTop}px from the top of the grid`);
const g1 = await pickToggleRow("Collapse", rowTop);
await step(`collapse group ${g1}, ABOVE the row being edited`, ROW, ROW, () => clickToggle(g1, "Collapse"));
/* B463922 (×2) — this step's anchor changed from ROW to g1. A collapse never reveals anything, so
   protecting the row being edited (ROW) is still correct there (above). But an EXPAND's whole point
   is to reveal what it just uncovered — g1's own new children — so g1, the row that was actually
   clicked, is the anchor now, and ROW (merely selected, not being typed into) is expected to drift
   as those new rows push it down. Section 6 below is the owner's exact repro of the OLD behaviour
   choosing wrong here; this step proves the new priority holds for the toggle itself. */
await step(`expand group ${g1} again — the CLICKED row is the anchor, not the merely-selected one`, g1, ROW, () => clickToggle(g1, "Expand"));
rowTop = await page.evaluate(i => window.__rowTop(i), ROW);
const g2 = await pickToggleRow("Collapse", rowTop);
await step(`collapse a second group (${g2}) above it`, ROW, ROW, () => clickToggle(g2, "Collapse"));

/* 1b. THE CONSEQUENCE THE OWNER WOULD FEEL: after folding a group, the next thing he types must
   land in the cell he was in — not in a neighbour. The selection witness above proves the highlight
   stayed put; this proves the WRITE followed it. Before the fix the fold moved the selection onto
   the group row, so the next keystroke edited a different task altogether.
   Two things this step has to get right, both learned by getting them wrong: the group folded must
   NOT be an ancestor of the edited row (folding its own parent hides it, and then nothing can be
   typed into it — a vacuous "nothing was written"), and a SUMMARY row above it legitimately changes
   too, because a parent rolls up its children's dates. So the assertion is: the edited row changed,
   and every other row that changed is a summary row. */
await boot();
ROW = await midRow();
{
  const START = 2;                                  // the Start column — type-to-edit commits on Enter
  const reads = () => page.evaluate(() => [...document.querySelectorAll("[data-task-row]")]
    .map(r => [r.getAttribute("data-task-row"), ((r.children[2] || {}).innerText || "").trim(),
               !!r.querySelector('span[title="Collapse"], span[title="Expand"]')]));
  await page.locator(`[data-task-row="${ROW}"] > div`).nth(START).click();
  await pacedWait(page, 250);
  // the FARTHEST visible group above — the closest one is usually the row's own parent
  const cands = (await page.evaluate(() => window.__toggles("Collapse")))
    .filter(t => t.visible && t.top < 0 + 10000);
  let folded = null;
  const rowTop1b = await page.evaluate(i => window.__rowTop(i), ROW);
  for (const c of cands.filter(t => t.top < rowTop1b - 20)) {
    await clickToggle(c.row, "Collapse");
    await pacedWait(page, 500);
    const stillThere = await page.evaluate(i => !!document.querySelector(`[data-task-row="${i}"]`), ROW);
    if (stillThere) { folded = c.row; break; }
    await clickToggle(c.row, "Expand");             // that one was an ancestor — put it back
    await pacedWait(page, 400);
  }
  const before = await reads();
  if (!folded) { failures.push("type-after-fold: no non-ancestor group was foldable, so the check never ran"); line("  ✗ type-after-fold — nothing foldable that keeps the edited row on screen"); }
  else {
    await page.keyboard.type("2/3/27", { delay: 30 });
    await page.keyboard.press("Enter");
    await pacedWait(page, 700);
    const after = await reads();
    const bMap = new Map(before.map(([id, v]) => [id, v]));
    const sum = new Map(after.map(([id, v, isSummary]) => [id, isSummary]));
    const moved = after.filter(([id, v]) => bMap.has(id) && bMap.get(id) !== v).map(([id, v]) => [id, v]);
    const ours = moved.filter(([id]) => id === String(ROW));
    const strays = moved.filter(([id]) => id !== String(ROW) && !sum.get(id));
    if (!moved.length) { failures.push("type-after-fold: NOTHING was written — the step proves nothing"); line("  ✗ type-after-fold — ⚠ nothing was written anywhere"); }
    else if (!ours.length) { failures.push(`type-after-fold: the value did NOT land on row ${ROW} — it went to ${JSON.stringify(moved)}`); line(`  ✗ type-after-fold — the value landed on ${JSON.stringify(moved)}, not on the edited row`); }
    else if (strays.length) { failures.push(`type-after-fold: it also wrote to non-summary row(s) ${JSON.stringify(strays)}`); line(`  ✗ type-after-fold — it also changed ${JSON.stringify(strays)}`); }
    else line(`  ✓ after folding group ${folded}, what he types lands in the cell he was in — row ${ROW} = ${JSON.stringify(ours[0][1])}` +
              (moved.length > 1 ? `; the only other change is the summary roll-up ${JSON.stringify(moved.filter(([id]) => id !== String(ROW)))}` : ""));
  }
}

// 2. Nothing selected: the top of the view is what must hold.
await boot();
const TOP = await page.evaluate(() => window.__topRow());
const g3 = await pickToggleRow("Collapse", null);
line(`\nnothing selected — the row at the top of the view is ${TOP}`);
await step(`collapse group ${g3} with nothing selected`, TOP, null, () => clickToggle(g3, "Collapse"));

// 3. The anchor row itself is collapsed away — the view holds on its surviving parent.
await boot();
ROW = await midRow();
await selectRow(ROW);
const PARENT = await page.evaluate(id => {
  const rows = [...document.querySelectorAll("[data-task-row]")];
  const i = rows.findIndex(r => r.getAttribute("data-task-row") === id);
  for (let k = i - 1; k >= 0; k--) if (rows[k].querySelector('span[title="Collapse"]')) return rows[k].getAttribute("data-task-row");
  return null;
}, ROW);
line(`\nediting row ${ROW}; collapsing its enclosing group ${PARENT} hides the row being edited`);
await step(`collapse the group the edited row lives in (${PARENT})`, PARENT, null, () => clickToggle(PARENT, "Collapse"));

/* 4. THE PATHS THE PREVIOUS SESSION NEVER ACTUALLY DROVE. Its run reported seven of them "steady"
   while its own witness said NOTHING CHANGED — they no-opped because the selection was lost after
   the grid re-rendered and every keystroke went nowhere. Here each one re-selects first, and the
   witness is widened: the list length, the anchor row's TEXT, or the selection itself must move,
   or the step is reported as proving nothing. The invariant asserted is the view's: the row at the
   top of the viewport must not move. */
line("\nthe keyboard paths the earlier run never actually drove:");
await boot();
ROW = await midRow();
await selectRow(ROW);

async function keyStep(label, fn, { expectModel = true } = {}) {
  const sel = await page.evaluate(() => window.__selRow());
  if (sel !== String(ROW)) await selectRow(ROW);           // re-arm, or the keystroke goes nowhere
  const top = await page.evaluate(() => window.__topRow());
  const before = await page.evaluate(i => ({ top: window.__rowTop(i), w: window.__witness() }), top);
  await fn();
  await pacedWait(page, 700);
  const after = await page.evaluate(i => ({ top: window.__rowTop(i), w: window.__witness() }), top);
  const changed = JSON.stringify(before.w) !== JSON.stringify(after.w);
  if (!changed && expectModel) {
    failures.push(`${label}: NOTHING CHANGED — driven, but it did nothing, so its calm proves nothing`);
    line(`  ✗ ${label} — ⚠ nothing changed; this path is still unproven`);
    return;
  }
  if (after.top === null) {
    failures.push(`${label}: the row at the top of the view left the rendered window`);
    line(`  ✗ ${label} — the view left the row it was showing`);
    return;
  }
  const d = after.top - before.top;
  const pass = Math.abs(d) <= TOL;
  if (!pass) failures.push(`${label}: the view moved ${d}px (top row ${top})`);
  line(`  ${pass ? "✓" : "✗"} ${label} — top-of-view row ${top}: Δ ${d >= 0 ? "+" : ""}${d}px (budget ±${TOL})`);
}

await keyStep("insert a row above the selection", () => page.keyboard.press("Insert"));
await keyStep("undo the insert", () => page.keyboard.press("Control+z"));
/* Outdent FIRST, then indent back: a row that is already the first child of its group has no
   previous sibling to become a child of, so an indent there legitimately does nothing — and a
   step that legitimately does nothing can never be told apart from one that is broken. */
await keyStep("outdent the row (Alt+Shift+Left)", () => page.keyboard.press("Alt+Shift+ArrowLeft"));
await keyStep("indent it back (Alt+Shift+Right)", () => page.keyboard.press("Alt+Shift+ArrowRight"));
await keyStep("edit the start date (Enter commits)", async () => {
  await page.locator(`[data-task-row="${ROW}"] > div`).nth(2).click(); await pacedWait(page, 200);
  await page.keyboard.press("Control+a").catch(() => {});
  await page.keyboard.type("1/2/26", { delay: 20 }); await page.keyboard.press("Enter");
});
await keyStep("undo that edit", () => page.keyboard.press("Control+z"));
await keyStep("redo it", () => page.keyboard.press("Control+y"));
await keyStep("Tab across six columns", async () => { for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); await pacedWait(page, 90); } });

/* 6. ⛔ THE OWNER'S EXACT REPRO (B463922 ×2, 2026-08-18): "clicking to open up the ALTA & Topo
   Survey stuff... jumps me down to the middle of the schedule so I can't even see what I just
   opened." Stage it precisely: a row clicked (selected) a while ago, NOT being edited, sitting
   BELOW a currently-collapsed group that is also on screen — then expand that group. Before the
   fix, `installScrollWitness` caught a real APP write (not a driver artifact — the toggle and the
   distant row are proven on-screen with `targetVisibility` first, so nothing here needed
   Playwright's own scroll-into-view) throwing the toggled row and its new children off screen
   above by exactly the height of what was revealed, to hold the stale selection's position instead.
   The assertion: the toggled row itself holds (it's the anchor now), and the row that appears
   immediately below it afterward is BOTH new (wasn't there before — the reveal genuinely happened)
   and actually on screen (not just rendered off in the virtualiser's buffer). */
line("\nB463922 (×2) — the owner's exact repro: expand a group while a stale selection sits below it, on screen\n");
await boot();
await page.evaluate(() => { window.__g.scrollTop = 0; });
await pacedWait(page, 300);
const TOGGLE = await pickToggleRow("Collapse", null);
await clickToggle(TOGGLE, "Collapse");             // start collapsed — like the group he reopened
await pacedWait(page, 300);
// A row ~400px below the toggle — comfortably clear of it, and (after we scroll the toggle near
// the top) still on screen at the same time, matching a tall-viewport real-world layout.
const DISTANT = await page.evaluate(id => {
  const rows = [...document.querySelectorAll("[data-task-row]")];
  const tTop = document.querySelector(`[data-task-row="${id}"]`).getBoundingClientRect().top;
  let best = null, bestDelta = Infinity;
  for (const r of rows) {
    const rid = r.getAttribute("data-task-row");
    if (rid === String(id)) continue;
    const delta = Math.abs((r.getBoundingClientRect().top - tTop) - 400);
    if (delta < bestDelta) { bestDelta = delta; best = rid; }
  }
  return best;
}, TOGGLE);
await selectRow(DISTANT);                          // a click, a while ago — not an open editor
await page.evaluate(id => {
  const g = window.__g, t = document.querySelector(`[data-task-row="${id}"]`);
  g.scrollTop = Math.max(0, g.scrollTop + (t.getBoundingClientRect().top - g.getBoundingClientRect().top) - 40);
}, TOGGLE);
await pacedWait(page, 300);
const toggleVis = await targetVisibility(page, GRID, page.locator(`[data-task-row="${TOGGLE}"] span[title="Expand"]`));
const distantVis = await targetVisibility(page, GRID, page.locator(`[data-task-row="${DISTANT}"] > div`).nth(1));
if (!toggleVis.visible || !distantVis.visible) {
  failures.push(`owner-repro: could not stage both rows on screen at once (toggle ${JSON.stringify(toggleVis)}, distant ${JSON.stringify(distantVis)})`);
  line("  ✗ owner-repro — could not stage the scenario (toggle or distant row not on screen together)");
} else {
  const before = await page.evaluate((ids) => ({
    toggle: window.__rowTop(ids[0]), distant: window.__rowTop(ids[1]), len: window.__listLen(), sel: window.__selRow(),
    nextRow: (() => { const rows = [...document.querySelectorAll("[data-task-row]")]; const i = rows.findIndex(r => r.getAttribute("data-task-row") === String(ids[0])); return i >= 0 && i + 1 < rows.length ? rows[i + 1].getAttribute("data-task-row") : null; })(),
  }), [TOGGLE, DISTANT]);
  await page.evaluate(() => { window.__scrollWitness.writes.length = 0; });
  await visibleClick(page, GRID, page.locator(`[data-task-row="${TOGGLE}"] span[title="Expand"]`), "expand the owner's group");
  await pacedWait(page, 500);
  const after = await page.evaluate((ids) => ({
    toggle: window.__rowTop(ids[0]), distant: window.__rowTop(ids[1]), len: window.__listLen(), sel: window.__selRow(),
    nextRow: (() => { const rows = [...document.querySelectorAll("[data-task-row]")]; const i = rows.findIndex(r => r.getAttribute("data-task-row") === String(ids[0])); return i >= 0 && i + 1 < rows.length ? rows[i + 1].getAttribute("data-task-row") : null; })(),
  }), [TOGGLE, DISTANT]);
  const writes = await page.evaluate(() => window.__scrollWitness.writes.slice());
  line(`  toggle ${TOGGLE}: ${before.toggle}px → ${after.toggle}px   distant ${DISTANT}: ${before.distant}px → ${after.distant}px` +
       `   list ${before.len} → ${after.len}   app scroll writes ${writes.length}`);
  if (after.len === before.len) {
    failures.push("owner-repro: NOTHING CHANGED — the expand did nothing, so this proves nothing");
    line("  ✗ owner-repro — ⚠ the model did not change");
  } else if (after.sel !== String(DISTANT)) {
    failures.push(`owner-repro: the selection moved (${before.sel} → ${after.sel}) — the toggle stole it`);
    line(`  ✗ owner-repro — the selection moved to ${after.sel}; the toggle click is supposed to leave it alone`);
  } else if (after.toggle === null) {
    failures.push("owner-repro: the toggled row itself left the rendered window");
    line("  ✗ owner-repro — the toggled row is no longer rendered");
  } else if (Math.abs(after.toggle - before.toggle) > TOL) {
    failures.push(`owner-repro: the toggled row moved ${after.toggle - before.toggle}px on screen (budget ±${TOL}) — what he opened is not where he left it`);
    line(`  ✗ owner-repro — the toggled row moved ${after.toggle - before.toggle}px; budget ±${TOL}`);
  } else if (after.nextRow === before.nextRow) {
    failures.push(`owner-repro: no new row appeared below the toggle (still ${after.nextRow}) — nothing was actually revealed`);
    line(`  ✗ owner-repro — the row below the toggle didn't change (${after.nextRow}); the expand revealed nothing`);
  } else {
    const revealedVis = await targetVisibility(page, GRID, page.locator(`[data-task-row="${after.nextRow}"] > div`).nth(1));
    if (!revealedVis.visible) {
      failures.push(`owner-repro: the newly revealed row ${after.nextRow} is NOT on screen (${revealedVis.reason}) — exactly what he reported`);
      line(`  ✗ owner-repro — the newly revealed row ${after.nextRow} is off screen: ${revealedVis.reason}`);
    } else {
      line(`  ✓ owner-repro — the toggled row held its place (Δ ${after.toggle - before.toggle}px) and its new child (row ${after.nextRow}) is on screen at ${revealedVis.offset}px`);
    }
  }
}

/* 7. B548xxx — a row-height change (Format panel slider) must not throw the on-screen view out of
   the rendered window. Stage a mid-viewport row, change the height, and require it to still be
   RENDERED (virtualisation didn't drop it) — the pre-fix failure was `getBoundingClientRect()`
   returning nothing at all because the row fell entirely outside the buffered render window, with
   zero app scrollTop writes (a re-render nobody compensated for, not a jump somewhere else). */
line("\nB548xxx — a row-height change must not throw the view out of the rendered window\n");
await boot();
await page.evaluate(() => { window.__g.scrollTop = Math.floor(window.__g.scrollHeight / 2); });
await pacedWait(page, 300);
const RHROW = await midRow();
await selectRow(RHROW);
const rhBefore = await page.evaluate(i => ({ top: window.__rowTop(i) }), RHROW);
await page.click('button[title="Format — row height & bar labels"]');
await pacedWait(page, 300);
const slider = page.locator('input[type="range"][max="34"]');
const sliderCount = await slider.count();
if (!sliderCount) {
  failures.push("row-height: the Format panel's row-height slider was not found — could not drive it");
  line("  ✗ row-height — slider not found");
} else {
  await page.evaluate(() => {
    const inp = document.querySelector('input[type="range"][max="34"]');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(inp, "34");
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await pacedWait(page, 400);
  await page.keyboard.press("Escape");               // close the Format panel so it's not covering the grid for later runs
  const rhAfter = await page.evaluate(i => ({ top: window.__rowTop(i) }), RHROW);
  if (rhAfter.top === null) {
    failures.push(`row-height: row ${RHROW} left the rendered window entirely after the resize`);
    line(`  ✗ row-height — row ${RHROW} is no longer rendered (was at ${rhBefore.top}px)`);
  } else if (Math.abs(rhAfter.top - rhBefore.top) > TOL) {
    // A selected row is the anchor for this compensation too — it should hold near-exactly, not just "somewhere on screen".
    failures.push(`row-height: the selected row moved ${rhAfter.top - rhBefore.top}px on screen (budget ±${TOL})`);
    line(`  ✗ row-height — selected row ${RHROW} moved ${rhAfter.top - rhBefore.top}px: ${rhBefore.top}px → ${rhAfter.top}px`);
  } else {
    line(`  ✓ row-height — selected row ${RHROW} held its place across the resize (${rhBefore.top}px → ${rhAfter.top}px)`);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * NEW-1 (RECURRENCE of B463922, ×3) — "there's a million ways that I press something on the
 * schedule and it jumps me to somewhere else... sometimes I'll open something and it'll take me
 * to somewhere completely different." Five distinct defects, all in GridView:
 *   A. a tasks-only change (collapse) while the selection sits off screen chases it anyway
 *   B. same as A, but the change is an undo (Ctrl+Z) — the general case: ANY tasks-identity change
 *   C. clicking/double-clicking the topmost fully-visible row nudges the view a header's height
 *   D. a Grid/Split/Gantt view switch remounts the pane and resets it to the top
 *   E. a dashboard/report jump (goToFocus) replays on a LATER, unrelated remount
 * Each of A/B/C must FAIL on the pre-fix build (mutation-proven below the file, not inline —
 * see the PR description for the stash-and-rerun results). D/E are new mechanisms (scroll memory,
 * a cleared token) with nothing to accidentally satisfy pre-fix, so their assertions are the proof.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/* A/B share a subtlety neither `step()` nor `keyStep()` was built for: the whole POINT of these
 * scenarios is that the selected row is scrolled far enough away to be VIRTUALIZED OUT OF THE DOM
 * entirely — so `window.__selRow()` (which reads the row wearing the blue selection border) reads
 * `null` whether the selection genuinely survived or was silently cleared, and `step()`'s
 * `expectSel` check would report a false "the selection moved" on every honest pass. Likewise
 * `step()`'s vacuity gate reads list LENGTH, which a plain date-edit/undo never changes at all —
 * using it here would report every honest pass as vacuous. Both scenarios use their own bespoke
 * assertions instead: the anchor-position check `step()` already does well, plus a real,
 * DOM-visible proof that the selection/edit actually survived, taken after scrolling back. */

// A. A click near the top, scrolled away, then a tasks-only change (collapse) must not chase it.
line("\nNEW-1 [A] — a stale selection scrolled off screen must not be chased back by an unrelated collapse\n");
await boot();
await page.evaluate(() => { window.__g.scrollTop = 0; });
await pacedWait(page, 250);
const A_SEL = await nearTopRow();
await selectRow(A_SEL);
await wheelScrollTo(2400);
const A_TOP = await page.evaluate(() => window.__topRow());
const A_TOGGLE = await pickToggleRow("Collapse", null);
await step(`[A] collapse a visible group with the selection (${A_SEL}) scrolled off screen above`, A_TOP, null, () => clickToggle(A_TOGGLE, "Collapse"));
await page.evaluate(() => { window.__g.scrollTop = 0; });
await pacedWait(page, 300);
const A_survived = await page.evaluate(() => window.__selRow());
if (A_survived !== String(A_SEL)) { failures.push(`[A] the selection did not survive the collapse (expected ${A_SEL}, scrolling back shows ${A_survived})`); line(`  ✗ [A] — selection lost: expected ${A_SEL}, found ${A_survived} after scrolling back`); }
else line(`  ✓ [A] — the off-screen selection (${A_SEL}) survived the collapse untouched`);

// B. Same setup — the change this time is an UNDO. The general case: ANY tasks-identity change.
line("\nNEW-1 [B] — same setup, but the change is an UNDO (Ctrl+Z)\n");
await boot();
await page.evaluate(() => { window.__g.scrollTop = 0; });
await pacedWait(page, 250);
const B_SEL = await nearTopRow();
await selectRow(B_SEL);
const B_ORIG = await page.evaluate(i => (document.querySelector(`[data-task-row="${i}"] > div:nth-child(3)`) || {}).innerText, B_SEL);
await page.locator(`[data-task-row="${B_SEL}"] > div`).nth(2).click(); await pacedWait(page, 200);
await page.keyboard.press("Control+a").catch(() => {});
await page.keyboard.type("5/6/27", { delay: 20 });
await page.keyboard.press("Enter");
await pacedWait(page, 400);
const B_edited = await page.evaluate(i => (document.querySelector(`[data-task-row="${i}"] > div:nth-child(3)`) || {}).innerText, B_SEL);
if (B_edited === B_ORIG) {
  failures.push(`[B] the setup edit never took (still "${B_ORIG}") — Ctrl+Z would have nothing to prove`);
  line(`  ✗ [B] — setup edit did not take, "${B_ORIG}" unchanged; scenario cannot run`);
} else {
  await wheelScrollTo(2400);
  const B_TOP = await page.evaluate(() => window.__topRow());
  const B_before = await page.evaluate(i => window.__rowTop(i), B_TOP);
  await page.keyboard.press("Control+z");
  await pacedWait(page, 500);
  const B_after = await page.evaluate(i => window.__rowTop(i), B_TOP);
  if (B_after === null) { failures.push(`[B] undo: top-of-view row ${B_TOP} left the rendered window`); line(`  ✗ [B] — top-of-view row ${B_TOP} left the rendered window`); }
  else if (Math.abs(B_after - B_before) > TOL) { failures.push(`[B] undo (Ctrl+Z) with the selection (${B_SEL}) scrolled off screen above: the view moved ${B_after - B_before}px (top row ${B_TOP}, budget ±${TOL})`); line(`  ✗ [B] — top-of-view row ${B_TOP}: ${B_before}px → ${B_after}px (Δ ${B_after - B_before}px)`); }
  else line(`  ✓ [B] — undo (Ctrl+Z) with the selection (${B_SEL}) scrolled off screen: top-of-view row ${B_TOP} held (Δ ${B_after - B_before}px)`);
  await page.evaluate(() => { window.__g.scrollTop = 0; });
  await pacedWait(page, 300);
  const B_reverted = await page.evaluate(i => (document.querySelector(`[data-task-row="${i}"] > div:nth-child(3)`) || {}).innerText, B_SEL);
  if (B_reverted !== B_ORIG) { failures.push(`[B] the undo did not actually revert the edit (expected "${B_ORIG}", got "${B_reverted}")`); line(`  ✗ [B] — undo did not revert: expected "${B_ORIG}", got "${B_reverted}"`); }
  else line(`  ✓ [B] — the undo genuinely reverted the date (back to "${B_ORIG}") — this scenario proved something, not a vacuous pass`);
}

// C. The topmost fully-visible row must not be nudged a header's height by selecting it.
line("\nNEW-1 [C] — clicking (or double-clicking into) the topmost fully-visible row must not nudge it a header's height\n");
await boot();
/* The buggy formula only misfires in a narrow band: a row whose TRUE on-screen top sits between
 * one and two header-heights down (HEADER_H..2*HEADER_H) reads as "above the visible top" and gets
 * nudged, even though it's genuinely on screen. `__topRow()`'s own 34px threshold (a few px of
 * slack past HEADER_H) lands just OUTSIDE that band far more often than in it, so picking "the
 * topmost row" at an arbitrary scrollTop mostly missed the bug entirely (confirmed: it read ✓ even
 * on the unpatched pre-fix build). Instead, place a real row's on-screen top DIRECTLY inside that
 * band by measuring where it currently sits and adjusting scrollTop by the exact delta — that
 * doesn't depend on knowing ROW_H (which this file doesn't expose and which a prior test in this
 * same run may have changed via the row-height slider). HEADER_H mirrors `TL_H` in
 * public/sequence/index.html (the sticky grid header's height, a stable, long-standing constant). */
const HEADER_H = 30;
const C_CAND = await midRow();
const candTop = await page.evaluate(i => window.__rowTop(i), C_CAND);
await page.evaluate(d => { window.__g.scrollTop = Math.max(0, window.__g.scrollTop + d); }, candTop - Math.round(HEADER_H * 1.5));
await pacedWait(page, 300);
const C_ROW = C_CAND;
const placedAt = await page.evaluate(i => window.__rowTop(i), C_ROW);
if (placedAt === null || placedAt <= HEADER_H || placedAt >= HEADER_H * 2) {
  failures.push(`[C] could not stage the scenario — row ${C_ROW} landed at ${placedAt}px, not inside the (${HEADER_H}, ${HEADER_H * 2})px band the bug lives in`);
  line(`  ✗ [C] — could not place row ${C_ROW} inside the danger band (landed at ${placedAt}px)`);
} else {
  // Must be a row that's GENUINELY on screen, not just any other id in the DOM: a plain
  // Playwright `.click()` auto-scrolls to reach an off-screen target (DRIVER-SCROLL-IS-NOT-
  // APP-SCROLL), which would silently destroy the exact scrollTop just staged above before
  // C_ROW's position is even measured. `midRow()` is comfortably clear of the header band C_ROW
  // was deliberately placed in, so it's never the same row.
  const C_OTHER = await midRow();
  await selectRow(C_OTHER);
  const cBefore = await page.evaluate(i => window.__rowTop(i), C_ROW);
  await selectRow(C_ROW);
  const cAfter = await page.evaluate(i => window.__rowTop(i), C_ROW);
  if (cAfter === null) { failures.push("[C] click: the topmost row left the rendered window"); line("  ✗ [C] click — row left the rendered window"); }
  else if (Math.abs(cAfter - cBefore) > TOL) { failures.push(`[C] click: selecting the topmost visible row nudged it ${cAfter - cBefore}px (budget ±${TOL})`); line(`  ✗ [C] click — row ${C_ROW}: ${cBefore}px → ${cAfter}px (Δ ${cAfter - cBefore}px)`); }
  else line(`  ✓ [C] click — topmost visible row ${C_ROW} held its place (${cBefore}px → ${cAfter}px)`);

  await selectRow(C_OTHER);
  const cBefore2 = await page.evaluate(i => window.__rowTop(i), C_ROW);
  await page.locator(`[data-task-row="${C_ROW}"] > div`).nth(2).dblclick();
  await pacedWait(page, 300);
  await page.keyboard.press("Escape");                // close the editor so it doesn't linger for later scenarios
  await pacedWait(page, 200);
  const cAfter2 = await page.evaluate(i => window.__rowTop(i), C_ROW);
  if (cAfter2 === null) { failures.push("[C] double-click: the topmost row left the rendered window"); line("  ✗ [C] double-click — row left the rendered window"); }
  else if (Math.abs(cAfter2 - cBefore2) > TOL) { failures.push(`[C] double-click: opening an editor on the topmost visible row nudged it ${cAfter2 - cBefore2}px (budget ±${TOL})`); line(`  ✗ [C] double-click — row ${C_ROW}: ${cBefore2}px → ${cAfter2}px (Δ ${cAfter2 - cBefore2}px)`); }
  else line(`  ✓ [C] double-click — topmost visible row ${C_ROW} held its place opening an editor (${cBefore2}px → ${cAfter2}px)`);
}

// D. A Grid/Split/Gantt view switch must restore each pane's own scroll position, not reset it.
line("\nNEW-1 [D] — a Grid/Split/Gantt view switch must restore scroll position, not reset to the top\n");
await boot();
await page.evaluate(() => { window.__g.scrollTop = 1400; });
await pacedWait(page, 300);
const D_before = await page.evaluate(() => window.__g.scrollTop);
await page.locator(".hdr-view button", { hasText: "Gantt" }).click();
await pacedWait(page, 400);
await page.locator(".hdr-view button", { hasText: "Grid" }).click();
await installHelpers();                              // the grid remounted — re-bind every helper to the fresh node
await pacedWait(page, 400);
const D_after = await page.evaluate(() => document.querySelector('[data-grid-scroll="1"]')?.scrollTop ?? null);
if (D_after === null) { failures.push("[D] Grid→Gantt→Grid: no grid scroll container after switching back"); line("  ✗ [D] Grid→Gantt→Grid — grid container missing after remount"); }
else if (Math.abs(D_after - D_before) > TOL) { failures.push(`[D] Grid→Gantt→Grid: scroll position was not restored (${D_before}px reset to ${D_after}px)`); line(`  ✗ [D] Grid→Gantt→Grid — ${D_before}px → ${D_after}px (reset, not restored)`); }
else line(`  ✓ [D] Grid→Gantt→Grid — scroll position restored (${D_before}px → ${D_after}px)`);

// Split's own grid pane shares the same per-project memory, so Grid → Split also restores.
await page.evaluate(() => { window.__g.scrollTop = 2100; });
await pacedWait(page, 300);
const D2_before = await page.evaluate(() => window.__g.scrollTop);
await page.locator(".hdr-view button", { hasText: "Gantt" }).click();
await pacedWait(page, 400);
await page.locator(".hdr-view button", { hasText: "Split" }).click();
await pacedWait(page, 400);
const D2_after = await page.evaluate(() => document.querySelector('[data-grid-scroll="1"]')?.scrollTop ?? null);
if (D2_after === null) { failures.push("[D] Grid→Split: no grid pane found in Split"); line("  ✗ [D] Grid→Split — grid pane missing in Split"); }
else if (Math.abs(D2_after - D2_before) > TOL) { failures.push(`[D] Grid→Split: scroll position was not restored (${D2_before}px reset to ${D2_after}px)`); line(`  ✗ [D] Grid→Split — ${D2_before}px → ${D2_after}px (reset, not restored)`); }
else line(`  ✓ [D] Grid→Split — scroll position restored (${D2_before}px → ${D2_after}px)`);

// The standalone Gantt pane gets its own memory too.
const D3_before = 900;
await page.evaluate(v => { const g = document.querySelector('[data-gantt-scroll="1"]'); if (g) g.scrollTop = v; }, D3_before);
await pacedWait(page, 300);
await page.locator(".hdr-view button", { hasText: "Gantt" }).click();
await pacedWait(page, 400);
await page.locator(".hdr-view button", { hasText: "Grid" }).click();
await installHelpers();
await pacedWait(page, 300);
await page.locator(".hdr-view button", { hasText: "Gantt" }).click();
await pacedWait(page, 400);
const D3_after = await page.evaluate(() => document.querySelector('[data-gantt-scroll="1"]')?.scrollTop ?? null);
if (D3_after === null) { failures.push("[D] standalone Gantt: no scroll container after switching back"); line("  ✗ [D] Gantt — scroll container missing after remount"); }
else if (Math.abs(D3_after - D3_before) > TOL) { failures.push(`[D] standalone Gantt: scroll position was not restored (${D3_before}px reset to ${D3_after}px)`); line(`  ✗ [D] Gantt — ${D3_before}px → ${D3_after}px (reset, not restored)`); }
else line(`  ✓ [D] standalone Gantt — scroll position restored (${D3_before}px → ${D3_after}px)`);
await page.locator(".hdr-view button", { hasText: "Grid" }).click();
await installHelpers();
await pacedWait(page, 300);

// E. A dashboard/report jump (goToFocus) must land exactly once — not replay on a later remount.
line("\nNEW-1 [E] — a Task Report jump must land once and must NOT replay on a later, unrelated view switch\n");
await boot();
await page.locator(".hdr-mode button", { hasText: "Dashboard" }).click();
await pacedWait(page, 400);
const jumpBtn = page.locator('button[title^="Open row in "]').first();
const jumpCount = await jumpBtn.count();
if (!jumpCount) {
  failures.push("[E] no Task Report jump row found — could not stage the scenario");
  line("  ✗ [E] — no jump row in the Task Report to click");
} else {
  await jumpBtn.click();
  await pacedWait(page, 500);                        // the 60ms scroll + 120ms pulse landing
  await installHelpers();                             // goToTask flips section back to "projects" — a fresh GridView mount
  const landedSel = await page.evaluate(() => window.__selRow());
  if (!landedSel) {
    failures.push("[E] the Task Report jump did not land — no row is selected after clicking it");
    line("  ✗ [E] — jump did not land");
  } else {
    const landedTop = await page.evaluate(() => window.__g.scrollTop);
    const scrollHeight = await page.evaluate(() => window.__g.scrollHeight);
    // Scroll well clear of the landed position — simulating him continuing to work after the jump —
    // far enough that a stale goToFocus replaying the jump can't be mistaken for a coincidence.
    const AWAY_TARGET = landedTop > scrollHeight / 2 ? 40 : Math.max(scrollHeight - 400, landedTop + 800);
    // Re-read the actual result, not the intended target: a target beyond scrollHeight-clientHeight
    // is silently CLAMPED by the browser the instant it's assigned, and comparing against the
    // unclamped number would report a false replay every time the target landed out of range.
    const AWAY = await page.evaluate(v => { window.__g.scrollTop = v; return window.__g.scrollTop; }, AWAY_TARGET);
    await pacedWait(page, 250);
    await page.locator(".hdr-view button", { hasText: "Gantt" }).click();
    await pacedWait(page, 400);
    await page.locator(".hdr-view button", { hasText: "Grid" }).click();
    await installHelpers();
    await pacedWait(page, 500);                       // long enough for a stale goToFocus's timers to fire if it replayed
    const afterSwitch = await page.evaluate(() => document.querySelector('[data-grid-scroll="1"]')?.scrollTop ?? null);
    if (afterSwitch === null) { failures.push("[E] no grid container after the view switch"); line("  ✗ [E] — grid container missing after switch"); }
    else if (Math.abs(afterSwitch - AWAY) > TOL) {
      failures.push(`[E] the stale jump replayed on remount — scroll reset from ${AWAY}px to ${afterSwitch}px instead of holding`);
      line(`  ✗ [E] — replayed: ${AWAY}px → ${afterSwitch}px (expected to hold near ${AWAY}px)`);
    } else {
      line(`  ✓ [E] — the jump landed once (selected ${landedSel}) and did NOT replay on the later Grid↔Gantt↔Grid switch (held near ${AWAY}px)`);
    }
  }
}

/* 5. THE GUARD'S OWN MUTATION PROOF, run every time so it cannot rot green: aim `visibleClick` at
   the exact target the old harness clicked — the first toggle the virtualiser renders, which sits
   ABOVE the viewport — and require it to REFUSE. A guard nobody has seen fail is not a guard. */
await boot();
const buffered = await page.evaluate(() => (window.__toggles("Collapse")[0] || null));
if (!buffered || buffered.visible) {
  failures.push("self-test: the virtualiser rendered no off-screen toggle, so the refusal path went unexercised");
  line(`\n  ✗ self-test — no buffered off-screen toggle to aim at; the refusal path proved nothing`);
} else {
  let threw = null;
  try { await visibleClick(page, GRID, page.locator(`[data-task-row="${buffered.row}"] span[title="Collapse"]`), "buffered toggle"); }
  catch (e) { threw = e.message; }
  if (threw) line(`\n  ✓ self-test — visibleClick REFUSED the off-screen toggle on row ${buffered.row} (${buffered.top}px, above the view)`);
  else { failures.push("self-test: visibleClick clicked an OFF-SCREEN target — the whole file's numbers would be the driver's"); line(`\n  ✗ self-test — visibleClick allowed an off-screen click`); }
}

line("");
if (failures.length) { console.log(`FAIL — ${failures.length} problem(s):`); failures.forEach(f => console.log("  · " + f)); }
else console.log(`PASS — every anchor held its place on screen within ±${TOL}px, every step changed the model, and the selection never wandered.`);
await browser.close(); server.close();
process.exit(failures.length ? 1 : 0);
