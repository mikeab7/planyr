/* NEW-1 — CTRL+Z GETS STUCK WHEN AN EDIT'S SIDE EFFECT FLIPS A TASK'S "NEEDS ATTN." STATUS.
 *
 * Owner report, live-confirmed on his own data: Goose Creek Master Schedule, task 168 "P&Z Public
 * Hearing & Consideration" — changed from 2026-09-10 to 2026-09-30, pressed Ctrl+Z, the date did
 * not revert.
 *
 * THE MECHANISM (found by instrumenting the real undo/history refs, not by reading the code cold):
 * `reconcileNeedsAttention` restamps/clears a task's `needsAttentionSince` field from a `useEffect`
 * that reacts to `data` itself — it is not the user's edit, it is a REACTION to it, and its own
 * `setData` call was NOT gated by the same `isUndoing` flag the Ctrl+Z handler already uses. So:
 *   1. User edits a date whose side effect flips SOME task's computed red/not-red status (most
 *      commonly the default overdue rule — a date edit is exactly what moves a task across that
 *      line). The edit commits; the history-capture effect pushes the PRE-edit snapshot — correct.
 *   2. The reconcile effect reacts to the NEW data, clears/stamps needsAttentionSince, and issues
 *      its OWN setData. That commit ALSO trips the history-capture effect (isUndoing is false for
 *      it), which pushes the POST-edit-PRE-reconcile snapshot on top. That snapshot is visually
 *      IDENTICAL to the current state (same date — the only field that moved is the invisible
 *      needsAttentionSince flag).
 *   3. Ctrl+Z pops that invisible snapshot. Its date, still mismatched against its own freshly
 *      computed status, immediately re-triggers the SAME reconcile effect, which pushes an
 *      equivalent snapshot right back. The real prior edit sits one level further back and can
 *      NEVER be reached — every further Ctrl+Z repeats the same cycle. The user sees no revert, at
 *      any number of presses.
 *
 * THE FIX (public/sequence/index.html, `isDerivedUpdate` ref beside `isUndoing`): a derived
 * recompute now marks itself before its own setData and the history-capture effect folds it into
 * the CURRENT snapshot instead of pushing a new one — exactly like an undo/redo restore already
 * does. Mirrored in ui-audit/stress/scheduler-engine.mjs is out of scope here (that mirror holds
 * only the PURE cascade functions — this bug lives entirely in the React effect wiring, which is
 * why it needs a live browser to prove, not a unit test).
 *
 * This harness reproduces the exact defect shape (an ordinary task, overdue at load so the default
 * rule already flags it red, edited into the future so the flag clears as a side effect) against a
 * throwaway fixture — never a real project — and asserts ONE Ctrl+Z press fully reverts it. It also
 * re-covers the edit types the dispatch brief asked to be swept: a plain text edit, a duration edit,
 * a date edit on an ordinary row, a date edit on a meeting-bound+pinned row (the owner's literal
 * scenario), and the right-click "Meeting" submenu snap action — none of these were ever broken by
 * the generic undo/redo mechanism itself; only the reconcile-effect race was.
 *
 * Run: node ui-audit/verify-grid-undo.mjs
 * Exit 0 = every case reverted in one Ctrl+Z. Exit 1 = something didn't.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

// A default-overdue health rule (the app's own DEFAULT_HEALTH_RULES shape) — needed so an ordinary
// task's computed status genuinely flips red -> not-red as a SIDE EFFECT of the date edit below.
const RULE_COMPLETE_PAUSED_GUARD = [{ field: "status", op: "is", value: "green" }, { field: "status", op: "is", value: "paused" }];
const DEFAULT_HEALTH_RULES = [
  { id: "default-overdue", when: [{ field: "finish", op: "pastDueAtLeast", value: 1 }], whenCombinator: "AND",
    color: "red", unless: [...RULE_COMPLETE_PAUSED_GUARD], unlessCombinator: "OR" },
];

// "Today" for the running container is read live (fdLocal-equivalent) so the fixture's overdue/
// future dates stay correct regardless of when this harness runs.
const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const PAST = addDays(todayIso(), -10);   // overdue at load
const FUTURE = addDays(todayIso(), 14);  // not overdue once edited to this

const FIXTURE = {
  aPid: 1, nPid: 2, nTid: { 1: 3 }, view: "grid", section: "projects",
  settings: { healthRules: DEFAULT_HEALTH_RULES },
  projects: {
    1: {
      id: 1, name: "UNDO-TEST Throwaway (delete me)",
      meetingBodies: [{ id: "mb_test1", name: "Test P&Z Commission",
        recurrence: [{ freq: "monthly", weekday: 2, setpos: [3] }] }],
      tasks: [
        { id: 1, name: "Ordinary Task", start: PAST, end: PAST, duration: 0, predecessors: [], health: "gray",
          percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true },
        { id: 2, name: "P&Z Public Hearing & Consideration", start: PAST, end: PAST, duration: 0, predecessors: [],
          health: "gray", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true,
          meetingBound: true, meetingBodyId: "mb_test1", pinnedStart: true, meetingDeadline: PAST },
      ],
    },
  },
};
const FIXTURE_JSON = JSON.stringify(FIXTURE);

await ensureVendored();
const server = createServer(async (req, res) => {
  try {
    if (await serveVendored(req, res)) return;
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (p.endsWith("sequence/index.html")) {
      let html = rewriteCdn(body.toString("utf8"));
      // The file ships its own baked-in <script id="planar-data"> demo dataset, parsed BEFORE React
      // mounts (earlier than addInitScript would run) — override it by injecting a second assignment
      // right after that tag, before <div id="root">.
      html = html.replace('<div id="root"', `<script>window.__PLANAR_DATA__=${FIXTURE_JSON};</script>\n<div id="root"`);
      body = Buffer.from(html);
    }
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector('[data-task-row="1"]', { timeout: 40000 });
await assertMeasurable(page, "verify-grid-undo");
await pacedWait(page, 400);

const failures = [];
const cellText = (taskId, col) => page.locator(`[data-task-row="${taskId}"] [data-col-key="${col}"]`).innerText();

async function editCell(taskId, col, value) {
  const cell = page.locator(`[data-task-row="${taskId}"] [data-col-key="${col}"]`);
  await cell.dblclick();
  const input = page.locator(`[data-task-row="${taskId}"] [data-col-key="${col}"] input`);
  await input.waitFor({ state: "visible", timeout: 5000 });
  await input.fill("");
  await input.type(value);
  await input.press("Enter");
  await pacedWait(page, 250);
}

async function ctrlZ() {
  await page.keyboard.down("Control");
  await page.keyboard.press("z");
  await page.keyboard.up("Control");
  await pacedWait(page, 250);
}

async function runCase(label, taskId, col, newValue) {
  const preEdit = await cellText(taskId, col);
  await editCell(taskId, col, newValue);
  const afterEdit = await cellText(taskId, col);
  await ctrlZ();
  const afterUndo = await cellText(taskId, col);
  const reverted = afterUndo === preEdit;
  console.log(`${reverted ? "✅" : "❌"} ${label}: "${preEdit}" -> "${afterEdit}" -> Ctrl+Z -> "${afterUndo}"`);
  if (!reverted) failures.push(label);
}

// THE CONFIRMED ROOT CAUSE — an ordinary task, overdue at load (so the default rule already flags
// it red and needsAttentionSince is already stamped), edited into the future so the flag clears as
// a side effect of the SAME edit the user made.
const fmtMonth = iso => { const [y, m, d] = iso.split("-"); return `${Number(m)}/${Number(d)}/${y.slice(2)}`; };
await runCase("date edit crossing the overdue-red boundary (the confirmed root cause)", 1, "start", fmtMonth(FUTURE));

// The dispatch brief's full sweep of edit types, none of which were ever broken by the generic
// undo/redo mechanism — only the reconcile-effect race above was.
await runCase("plain text edit (name)", 1, "name", "Renamed Task XYZ");
await runCase("duration edit", 1, "duration", "9d");
await runCase("date edit on an ordinary (non-meeting-bound) row", 1, "start", fmtMonth(addDays(FUTURE, 3)));
await runCase("date edit on a meeting-bound + pinnedStart row (the owner's literal scenario)", 2, "start", fmtMonth(FUTURE));

// The right-click "Meeting" submenu snap action.
{
  const beforeBind = await cellText(2, "start");
  await page.locator('[data-task-row="2"] [data-col-key="name"]').click();
  await page.locator('[data-task-row="2"] [data-col-key="name"]').click({ button: "right" });
  await pacedWait(page, 200);
  await page.locator('text=/Meeting:/').first().hover();
  await pacedWait(page, 200);
  await page.locator('text="Test P&Z Commission" >> visible=true').first().click();
  await pacedWait(page, 300);
  const afterBind = await cellText(2, "start");
  await ctrlZ();
  const afterBindUndo = await cellText(2, "start");
  const reverted = afterBindUndo === beforeBind;
  console.log(`${reverted ? "✅" : "❌"} right-click Meeting-submenu snap action: "${beforeBind}" -> "${afterBind}" -> Ctrl+Z -> "${afterBindUndo}"`);
  if (!reverted) failures.push("right-click Meeting-submenu snap action");
}

await browser.close();
server.close();
if (failures.length) {
  console.log(`\nFAIL — ${failures.length} case(s) did not revert on one Ctrl+Z:`, failures);
  process.exit(1);
}
console.log("\nPASS — every case reverted on exactly one Ctrl+Z.");
process.exit(0);
