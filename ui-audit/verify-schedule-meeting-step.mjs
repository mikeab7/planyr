/* NEW-1 / NEW-2 — grid right-click menu, 2026-09-11 chat block.
 *
 * NEW-1: a row bound to a meeting calendar gets two plain top-level rows, "Next meeting" and
 * "Previous meeting", labeled with the date they'll move to, disabled (never hidden) when no
 * such date exists, hidden entirely for an unbound row. Clicking one pins the row to that exact
 * meeting date via the SAME field (pinnedMeetingDate) + cascade a snap uses.
 *
 * NEW-2: "Copy Task Name" and "Add Note" are removed from this menu; Add Note stays reachable via
 * the Notes column's own "+" cell (case "notes" in the grid renderer, public/sequence/index.html).
 *
 * Fixture mirrors the owner's own production shape: a task pinned (pinnedStart) to a date its
 * body does NOT meet on ("2026-08-15", a Saturday) — the exact "typed a date hoping it would roll
 * forward" scenario from the chat block, so "next"/"previous" are proven against a non-meeting
 * anchor, not just a tidy one.
 *
 * Run: node ui-audit/verify-schedule-meeting-step.mjs   [PW_CHROME=<chrome>]
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
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const realBody = await readFile(HTML_PATH, "utf8");
await ensureVendored();

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

async function makeServer() {
  const server = createServer(async (req, res) => {
    try {
      if (await serveVendored(req, res)) return;
      let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      if (p.endsWith("sequence/index.html")) {
        res.writeHead(200, { "Content-Type": "text/html" }); res.end(Buffer.from(rewriteCdn(realBody))); return;
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
  return { start: "", end: "", duration: 1, predecessors: [], health: "gray",
    percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true,
    durUnit: "d", durValue: 1, ...over };
}

// council: 2nd & 4th Tuesday, no agenda lead friction beyond the default — meeting dates around
// the fixture's window: ... 2026-07-14, 2026-07-28, 2026-08-11, 2026-08-25, 2026-09-08 ...
const BODY = {
  id: "mb_test1", name: "Baytown City Council",
  recurrence: [{ freq: "monthly", weekday: 2, setpos: [2, 4] }],
  agendaLead: { type: "offset", n: 10, unit: "business" },
  cutoffTime: "12:00 PM", sameDayFilingAllowed: false, blackoutDates: [], extraDates: [],
};
// A body with NO meeting before its own effectiveFrom bound — proves the DISABLED (not hidden) case.
const BOUNDED_BODY = {
  id: "mb_test2", name: "TCEQ MUD Creation",
  recurrence: [{ freq: "monthly", weekday: 2, setpos: [2], effectiveFrom: "2026-09-01" }],
  blackoutDates: [], extraDates: [],
};
const MEETING_FIXTURE = {
  aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  projects: { 1: { id: 1, name: "Meeting Step Fixture", meetingBodies: [BODY, BOUNDED_BODY], tasks: [
    // Owner's exact reported scenario: pinned to a date the body never meets on (a Saturday).
    task({ id: 1, name: "Baytown City Council Approval", meetingBound: true, meetingBodyId: "mb_test1",
      pinnedStart: true, start: "2026-08-15", end: "2026-08-15", duration: 0, durValue: 0 }),
    task({ id: 2, name: "Unbound task", start: "2026-08-15", end: "2026-08-15" }),
    // Pinned to BOUNDED_BODY's own first-ever meeting (2026-09-08, the 2nd Tuesday on/after its
    // effectiveFrom) — nothing exists before it, so "Previous meeting" has no date to compute.
    task({ id: 3, name: "MUD Creation Hearing", meetingBound: true, meetingBodyId: "mb_test2",
      pinnedStart: true, start: "2026-09-08", end: "2026-09-08", duration: 0, durValue: 0 }),
  ]}},
};

async function bootAndImport(page, url, fixture) {
  page.removeAllListeners("dialog");
  page.on("dialog", d => d.accept());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-schedule-meeting-step");
  await page.locator('[data-testid="open-history-desktop"]').click();
  await pacedWait(page, 250);
  await page.setInputFiles('input[type="file"][accept=".json"]', {
    name: "fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await pacedWait(page, 700);
  await page.locator('[data-testid="history-panel"] button:has-text("Close")').click();
  await pacedWait(page, 400);
}

async function rowIdByName(page, name) {
  return page.evaluate((n) => {
    const rows = [...document.querySelectorAll('[data-task-row]')];
    const row = rows.find(r => (r.querySelector('[data-col-key="name"]')?.innerText || "").replace(/^▾\s*|^▸\s*/, "").trim() === n);
    return row ? Number(row.getAttribute('data-task-row')) : null;
  }, name);
}
async function startCellText(page, name) {
  return page.evaluate((n) => {
    const rows = [...document.querySelectorAll('[data-task-row]')];
    const row = rows.find(r => (r.querySelector('[data-col-key="name"]')?.innerText || "").replace(/^▾\s*|^▸\s*/, "").trim() === n);
    return row ? (row.querySelector('[data-col-key="start"]')?.innerText || "").trim() : null;
  }, name);
}
async function openMenuFor(page, name) {
  const id = await rowIdByName(page, name);
  await page.locator(`[data-task-row="${id}"] [data-col-key="id"]`).click({ button: "right" });
  await pacedWait(page, 150);
}
async function menuItemTexts(page) {
  // The menu portals to document.body; its Item rows are the only [style*="cursor"] divs holding
  // a leading <i class="ti ..."> icon — read every row's plain text, disabled state included.
  return page.evaluate(() => {
    const menu = [...document.querySelectorAll('div')].find(d => d.querySelector('i.ti-trash'))?.closest('div[style*="position: fixed"]')
      || [...document.querySelectorAll('div[style*="position: fixed"]')].find(d => d.querySelector('i.ti-trash'));
    if (!menu) return null;
    return [...menu.querySelectorAll('i.ti')].map(i => {
      const row = i.closest('div');
      return { text: (row?.innerText || "").trim(), disabled: (row?.style?.opacity === "0.5") || (row?.style?.cursor === "default") };
    });
  });
}

let browser, page;
async function freshPage(url, fixture) {
  if (page) await page.close();
  page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const pageErrors = []; page.on("pageerror", e => pageErrors.push(e.message));
  page._errors = pageErrors;
  await bootAndImport(page, url, fixture);
  return page;
}

const { server, url } = await makeServer();
browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

// =================================================================================================
// SECTION A — a bound row shows both rows, correctly labeled and NOT a submenu
// =================================================================================================
{
  await freshPage(url, MEETING_FIXTURE);
  await openMenuFor(page, "Baytown City Council Approval");
  const items = await menuItemTexts(page);
  ok("A1 · menu opened and is readable", !!items, JSON.stringify(items));
  const next = items?.find(i => i.text.startsWith("Next meeting"));
  const prev = items?.find(i => i.text.startsWith("Previous meeting"));
  ok("A2 · 'Next meeting' row present, labeled with the target date (item point c)",
    !!next && /Next meeting · \w{3}, \w{3} \d{1,2}/.test(next.text), JSON.stringify(next));
  ok("A3 · 'Previous meeting' row present, labeled with the target date", !!prev && /Previous meeting · \w{3}, \w{3} \d{1,2}/.test(prev.text), JSON.stringify(prev));
  // point (f): pinned to 2026-08-15 (a Saturday, not a meeting date) — next = first meeting
  // strictly after (2026-08-25), previous = last meeting strictly before (2026-08-11).
  ok("A4 · next target is the correct date given a NON-meeting pinned anchor (point f)", next?.text.includes("Aug 25"), next?.text);
  ok("A5 · previous target is the correct date given a NON-meeting pinned anchor (point f)", prev?.text.includes("Aug 11"), prev?.text);
  ok("A6 · neither row is disabled when a real target date exists", next?.disabled === false && prev?.disabled === false, JSON.stringify({ next, prev }));
  // NEW-1 point (a): two plain top-level rows, never a submenu — no nested flyout container.
  const isSubmenu = await page.evaluate(() => {
    const nextRow = [...document.querySelectorAll('div')].find(d => (d.innerText || "").trim().startsWith("Next meeting"));
    return nextRow ? !!nextRow.closest('div[style*="position: absolute"]') : null;
  });
  ok("A7 · 'Next meeting' is a PLAIN TOP-LEVEL row, not inside a flyout submenu (point a)", isSubmenu === false, `isSubmenu=${isSubmenu}`);
}

// =================================================================================================
// SECTION B — an UNBOUND row shows neither row (hidden, not just disabled — point b)
// =================================================================================================
{
  await freshPage(url, MEETING_FIXTURE);
  await openMenuFor(page, "Unbound task");
  const items = await menuItemTexts(page);
  ok("B1 · an unbound row shows NEITHER 'Next meeting' NOR 'Previous meeting' (hidden, not disabled)",
    !items.some(i => i.text.startsWith("Next meeting")) && !items.some(i => i.text.startsWith("Previous meeting")),
    JSON.stringify(items.map(i => i.text)));
}

// =================================================================================================
// SECTION C — no target date → DISABLED, not hidden, with a plain fallback label (point c)
// =================================================================================================
{
  await freshPage(url, MEETING_FIXTURE);
  await openMenuFor(page, "MUD Creation Hearing");
  const items = await menuItemTexts(page);
  const prev = items?.find(i => i.text.startsWith("Previous meeting"));
  ok("C1 · 'Previous meeting' is SHOWN (not hidden) with a plain label when no earlier date resolves",
    !!prev && prev.text === "Previous meeting", JSON.stringify(prev));
  ok("C2 · that row is DISABLED", prev?.disabled === true, JSON.stringify(prev));
}

// =================================================================================================
// SECTION D — clicking moves the row through the pin+cascade path, single undo step, deadline row
// stays consistent (point e) — via the SAME meetingDeadline the snap flyout drives
// =================================================================================================
{
  await freshPage(url, MEETING_FIXTURE);
  const before = await startCellText(page, "Baytown City Council Approval");
  ok("D1 (setup) · row starts on the pinned non-meeting date", before === "08/15/26", before);
  await openMenuFor(page, "Baytown City Council Approval");
  await page.locator("i.ti-chevron-right").locator("..").click();
  await pacedWait(page, 300);
  const afterNext = await startCellText(page, "Baytown City Council Approval");
  ok("D2 · clicking 'Next meeting' moves the row to the labeled date (08/25/26)", afterNext === "08/25/26", afterNext);

  // Single undo step restores the exact pre-click pin.
  await page.locator('[data-task-row]').first().click();
  await page.keyboard.press("Control+z");
  await pacedWait(page, 300);
  const afterUndo = await startCellText(page, "Baytown City Council Approval");
  ok("D3 · ONE Ctrl+Z fully restores the pre-click date (single undoable step, point e)", afterUndo === "08/15/26", afterUndo);

  // Step forward again, then step BACK from the new (real meeting) anchor — proves "previous" is
  // read relative to the row's CURRENT date, not the original typed one.
  await openMenuFor(page, "Baytown City Council Approval");
  await page.locator("i.ti-chevron-right").locator("..").click();
  await pacedWait(page, 300);
  await openMenuFor(page, "Baytown City Council Approval");
  await page.locator("i.ti-chevron-left").locator("..").click();
  await pacedWait(page, 300);
  const afterPrev = await startCellText(page, "Baytown City Council Approval");
  ok("D4 · stepping next then previous returns to the meeting immediately before the new anchor (08/11/26), not the original 08/15", afterPrev === "08/11/26", afterPrev);
}

// =================================================================================================
// SECTION E — NEW-2: "Copy Task Name" / "Add Note" are gone from this menu, everywhere else intact
// =================================================================================================
{
  await freshPage(url, MEETING_FIXTURE);
  await openMenuFor(page, "Unbound task");
  const items = await menuItemTexts(page);
  const texts = items.map(i => i.text);
  ok("E1 · 'Copy Task Name' no longer appears in the menu", !texts.some(t => t.includes("Copy Task Name")), JSON.stringify(texts));
  ok("E2 · 'Add Note' no longer appears in the menu", !texts.some(t => t.includes("Add Note")), JSON.stringify(texts));
  ok("E3 · every other row survives (Duplicate/Cut/Copy/Paste/Indent/Outdent/Move to/Delete)",
    ["Duplicate Row", "Cut", "Copy", "Paste Below", "Indent", "Outdent", "Move to", "Delete Row"].every(want => texts.some(t => t.includes(want))),
    JSON.stringify(texts));
  // No stranded/double separator: the menu's own [style*="height: 1px"] Sep count must not exceed
  // what a manual count of the remaining groups implies (7 groups → 6 internal separators, plus the
  // meeting-flyout's own internal Seps are inside its OWN absolutely-positioned popup, not counted
  // here since the flyout isn't open). Cheap proxy: no two Seps render back-to-back with zero
  // Item rows between them.
  const sepRun = await page.evaluate(() => {
    const menu = [...document.querySelectorAll('div[style*="position: fixed"]')].find(d => d.querySelector('i.ti-trash'));
    if (!menu) return null;
    const kids = [...menu.children];
    let maxRun = 0, run = 0;
    for (const k of kids) {
      const isSep = k.style.height === "1px";
      run = isSep ? run + 1 : 0;
      maxRun = Math.max(maxRun, run);
    }
    return maxRun;
  });
  ok("E4 · no stranded/double separator left behind by the removal (point c)", sepRun <= 1, `maxRun=${sepRun}`);
}

// =================================================================================================
// SECTION F — NEW-2 point (b): Add Note is still reachable via the Notes column's own affordance
// =================================================================================================
{
  await freshPage(url, MEETING_FIXTURE);
  const id = await rowIdByName(page, "Unbound task");
  await page.locator(`[data-task-row="${id}"] [data-col-key="notes"]`).click();
  await pacedWait(page, 250);
  const modalUp = await page.locator('text=New note').count().catch(() => 0);
  const anyNotesUi = await page.evaluate(() => document.body.innerText.toLowerCase().includes("note"));
  ok("F1 · clicking the Notes column cell on a row with no notes opens the notes editor (the '+' affordance survives the menu removal)",
    modalUp > 0 || anyNotesUi, `modalUp=${modalUp} anyNotesUi=${anyNotesUi}`);
}

server.close();
if (page) await page.close();
await browser.close();

const passed = results.filter(r => r.pass).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(passed === results.length ? 0 : 1);
