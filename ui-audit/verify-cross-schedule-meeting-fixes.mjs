/* NEW-1 / NEW-2 (chat, 2026-09-23) — two bugs on the SAME real fixture (Goose Creek → "MUD v PID",
 * task 49 "Conduct Confirmation Election"), measured live on the owner's account at __rev 5026,
 * build 4681016:
 *
 *   NEW-1 — a task bound to a meeting body that lives on ANOTHER schedule read as "Meeting: Meeting
 *   body" everywhere (context-menu label, grid "Meeting" column) instead of naming the real body +
 *   the schedule it comes from. MEETING_BODY_INDEX already resolved the OBJECT correctly for date
 *   math (ids are globally unique, B816) — only the UI surfaces that NAME it were local-array-only.
 *
 *   NEW-2 — a meeting-bound task's own predecessor LAG can silently count the same wait the bound
 *   body's own filing LEAD already counts (applyMeetingBinding folds the lag into predEarly, then
 *   agendaDeadline subtracts the lead) — task 49's 78-calendar-day link lag + TCEQ MUD Creation's own
 *   78-calendar-day lead pushes it out a full extra meeting cycle (2027-11-02 → 2028-05-06) with
 *   nothing on the row saying so.
 *
 * ATTEMPT-BEFORE-YOU-PARK: this is a logged-out, no-external-GIS UI check (right-click a row, read
 * grid cells/tooltips, click a fix) — Claude-doable headless, driven here rather than filed as
 * needing a live pass. What this harness can NOT prove is a genuine signed-in Supabase round-trip on
 * the owner's REAL "MUD v PID" schedule — that stays parked as this item's live-verify step
 * (`Blocker: real-data` — the acceptance explicitly requires a THROWAWAY DUPLICATE of the real
 * schedule, never the schedule itself, and only a signed-in session can duplicate it).
 *
 * Run: node ui-audit/verify-cross-schedule-meeting-fixes.mjs   [PW_CHROME=<chrome>]
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

// Real ids/names/numbers from the brief — reproduced verbatim so this is the same fixture the
// live check will duplicate, not an approximation.
const BAYTOWN = {
  id: "mb_mrml6q2vmi8m", name: "Baytown City Council",
  recurrence: [{ positions: [2], weekday: 2, months: "all", anchor: null }],
  agendaLead: { type: "offset", n: 10, unit: "business" },
  cutoffTime: "", sameDayFilingAllowed: false, blackoutDates: [], extraDates: [],
};
// TCEQ MUD Creation — Texas's two uniform election dates: 1st Saturday of May, and the Tuesday
// after the 1st Monday of November (the generalized Election-Day anchor primitive, NEW-1 2026-09-22).
const TCEQ = {
  id: "mb_mrmdy43mlhjr", name: "TCEQ MUD Creation",
  recurrence: [
    { positions: [1], weekday: 6, months: [5], anchor: null },
    { positions: [1], weekday: 2, months: [11], anchor: { position: 1, weekday: 1 } },
  ],
  agendaLead: { type: "offset", n: 78, unit: "calendar" },
  cutoffTime: "", sameDayFilingAllowed: false, blackoutDates: [], extraDates: [],
};

const FIXTURE = {
  aPid: 30, nPid: 31, nTid: 1000, view: "grid", section: "projects",
  projects: {
    1: {
      id: 1, name: "Master Schedule", meetingBodies: [BAYTOWN, TCEQ],
      tasks: [task({ id: 1, name: "Anchor" })],
    },
    30: {
      id: 30, name: "MUD v PID", meetingBodies: [],   // zero bodies of its own — the whole point
      tasks: [
        task({ id: 39, name: "1st reading",  meetingBound: true, meetingBodyId: "mb_mrml6q2vmi8m" }),
        task({ id: 40, name: "2nd reading",  meetingBound: true, meetingBodyId: "mb_mrml6q2vmi8m", predecessors: [{ id: 39, type: "FS" }] }),
        task({ id: 41, name: "3rd reading",  meetingBound: true, meetingBodyId: "mb_mrml6q2vmi8m", predecessors: [{ id: 40, type: "FS" }] }),
        task({ id: 48, name: "Petition filed", start: "2027-07-01", end: "2027-07-01", duration: 0 }),
        task({ id: 49, name: "Conduct Confirmation Election", meetingBound: true, meetingBodyId: "mb_mrmdy43mlhjr",
               predecessors: [{ id: 48, lag: 78, lagUnit: "calendar", type: "FS" }] }),
        task({ id: 50, name: "Genuinely orphaned", meetingBound: true, meetingBodyId: "mb_nowhere_at_all" }),
      ],
    },
  },
};

// This harness drives /sequence/ directly, so a fixture's own `aPid` is IGNORED whenever this
// browser context already has a per-tab aPid saved from the page's initial (pre-import) boot —
// every fresh page gets one, since the app loads its own default seed before the JSON import ever
// runs. Switching the ACTIVE schedule is always done through the real project switcher in the
// header, exactly as a person would (same pattern as verify-meeting-import.mjs).
async function switchToProject(page, name) {
  await page.locator('button:has(i.ti-chevron-down)').first().click();
  await pacedWait(page, 200);
  await page.getByText(name, { exact: true }).click();
  await pacedWait(page, 300);
}

async function bootAndImport(page, url, fixture, switchTo) {
  page.removeAllListeners("dialog");
  page.on("dialog", d => d.accept());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-cross-schedule-meeting-fixes");
  await page.locator('[data-testid="open-history-desktop"]').click();
  await pacedWait(page, 250);
  await page.setInputFiles('input[type="file"][accept=".json"]', {
    name: "fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await pacedWait(page, 700);
  await page.locator('[data-testid="history-panel"] button:has-text("Close")').click();
  await pacedWait(page, 400);
  if (switchTo) await switchToProject(page, switchTo);
}

async function rowIdByName(page, name) {
  return page.evaluate((n) => {
    const rows = [...document.querySelectorAll('[data-task-row]')];
    const row = rows.find(r => (r.querySelector('[data-col-key="name"]')?.innerText || "").replace(/^▾\s*|^▸\s*/, "").trim() === n);
    return row ? Number(row.getAttribute('data-task-row')) : null;
  }, name);
}
async function cellText(page, taskId, colKey) {
  return page.evaluate(([id, k]) => {
    const row = document.querySelector(`[data-task-row="${id}"]`);
    return row ? (row.querySelector(`[data-col-key="${k}"]`)?.innerText || "").trim() : null;
  }, [taskId, colKey]);
}
// Fixture task ids are NOT guaranteed to survive the History-panel JSON import verbatim (the app
// owns id assignment) — every other lookup here already resolves the real `data-task-row` id via
// rowIdByName rather than assuming the fixture's literal id; this does the same for reading a cell.
async function cellTextByName(page, name, colKey) {
  const id = await rowIdByName(page, name);
  return id == null ? null : cellText(page, id, colKey);
}
async function openMenuFor(page, name) {
  const id = await rowIdByName(page, name);
  await page.locator(`[data-task-row="${id}"] [data-col-key="id"]`).click({ button: "right" });
  await pacedWait(page, 150);
  return id;
}
async function menuItemTexts(page) {
  return page.evaluate(() => {
    const menu = [...document.querySelectorAll('div')].find(d => d.querySelector('i.ti-trash'))?.closest('div[style*="position: fixed"]')
      || [...document.querySelectorAll('div[style*="position: fixed"]')].find(d => d.querySelector('i.ti-trash'));
    if (!menu) return null;
    return [...menu.querySelectorAll('i.ti')].map(i => ({ text: (i.closest('div')?.innerText || "").trim() }));
  });
}
async function closeMenu(page) { await page.keyboard.press("Escape"); await pacedWait(page, 100); }

let browser, page;
async function freshPage(url, fixture, switchTo) {
  if (page) await page.close();
  page = await browser.newPage({ viewport: { width: 1700, height: 950 } });
  const pageErrors = []; page.on("pageerror", e => pageErrors.push(e.message));
  page._errors = pageErrors;
  await bootAndImport(page, url, fixture, switchTo);
  return page;
}

const { server, url } = await makeServer();
browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
await freshPage(url, FIXTURE, "MUD v PID");

// =================================================================================================
// SECTION A (NEW-1) — the "Meeting" column appears by default even though this schedule defines
// ZERO bodies of its own (only tasks bound to bodies imported from elsewhere), and it NAMES the
// real body + its origin schedule instead of "set up…" or a blank/mismatched select.
// =================================================================================================
{
  const meetingColVisible = await page.locator('[data-col-key="meetingBody"]').count();
  ok("A1 · the Meeting column is visible by default (this schedule has bound tasks, even with zero bodies of its own)", meetingColVisible > 0, `cells=${meetingColVisible}`);

  const t49 = await cellTextByName(page, "Conduct Confirmation Election", "meetingBody");
  ok("A2 · task 49's Meeting cell names the real body AND its origin schedule (not 'set up…')", t49 === "TCEQ MUD Creation · Master Schedule", t49);

  const t39 = await cellTextByName(page, "1st reading", "meetingBody");
  const t40 = await cellTextByName(page, "2nd reading", "meetingBody");
  const t41 = await cellTextByName(page, "3rd reading", "meetingBody");
  ok("A3 · tasks 39/40/41 (same schedule, Baytown City Council) all resolve identically",
    [t39, t40, t41].every(t => t === "Baytown City Council · Master Schedule"), JSON.stringify([t39, t40, t41]));

  const t50 = await cellTextByName(page, "Genuinely orphaned", "meetingBody");
  ok("A4 · a body genuinely missing from every schedule reads plainly as missing, never 'Meeting body'", t50 === "⚠ calendar missing", t50);
}

// =================================================================================================
// SECTION B (NEW-1) — the task right-click submenu names the foreign body + its schedule, instead
// of "Meeting: Meeting body".
// =================================================================================================
{
  await openMenuFor(page, "Conduct Confirmation Election");
  let items = await menuItemTexts(page);
  const bindRow = items?.find(i => /^Meeting:/.test(i.text));
  ok("B1 · the parent row reads 'Meeting: TCEQ MUD Creation — from Master Schedule' (not 'Meeting: Meeting body')",
    bindRow?.text.includes("TCEQ MUD Creation") && bindRow?.text.includes("from Master Schedule") && !bindRow?.text.includes("Meeting: Meeting body"),
    JSON.stringify(items?.map(i => i.text)));
  await closeMenu(page);

  await openMenuFor(page, "1st reading");
  items = await menuItemTexts(page);
  const bindRow39 = items?.find(i => /^Meeting:/.test(i.text));
  ok("B2 · task 39 (Baytown, same relationship) also names the real body + origin, not the fallback string",
    bindRow39?.text.includes("Baytown City Council") && bindRow39?.text.includes("from Master Schedule"),
    JSON.stringify(items?.map(i => i.text)));
  await closeMenu(page);

  await openMenuFor(page, "Genuinely orphaned");
  items = await menuItemTexts(page);
  const bindRowMissing = items?.find(i => /^Meeting:/.test(i.text));
  ok("B3 · a genuinely-missing-everywhere body reads '⚠ calendar missing', never the bare fallback string",
    bindRowMissing?.text.includes("⚠ calendar missing") && !/Meeting: Meeting body$/.test(bindRowMissing?.text || ""),
    JSON.stringify(items?.map(i => i.text)));
  await closeMenu(page);
}

// =================================================================================================
// SECTION C (NEW-2) — task 49 lands on the double-lagged date, carries the double-count flag, and
// the date-cell hover names the driving predecessor + the skipped meeting in plain English.
// =================================================================================================
const t49id = await rowIdByName(page, "Conduct Confirmation Election");
const t39id = await rowIdByName(page, "1st reading");
{
  const startBefore = await cellText(page, t49id, "start");
  ok("C1 · task 49 lands on the double-lagged date (05/06/28) before any fix is applied", startBefore === "05/06/28", startBefore);

  const flagTitle = await page.evaluate((id) => {
    const row = document.querySelector(`[data-task-row="${id}"]`);
    const span = row?.querySelector('span[title^="⚠ Possible double count"]');
    return span ? span.getAttribute("title") : null;
  }, t49id);
  ok("C2 · the double-count flag mark is present on task 49's row", !!flagTitle, flagTitle);
  ok("C3 · the flag names both the 78-day link lag and the 78-day filing lead", !!flagTitle && flagTitle.includes("78-calendar-day link lag") && flagTitle.includes("78-calendar-day filing lead"), flagTitle);

  const civicTitle = await page.evaluate((id) => {
    const row = document.querySelector(`[data-task-row="${id}"]`);
    const span = row?.querySelector('span[title*="Hearing "]');   // unique to the civic-mark tooltip, not the flag mark
    return span ? span.getAttribute("title") : null;
  }, t49id);
  ok("C4 · the date-cell hover names the driving predecessor (Petition filed) and the earliest-ready date",
    !!civicTitle && civicTitle.includes("Petition filed") && civicTitle.includes("ready no earlier than"), civicTitle);
  ok("C5 · the hover names the skipped 2027-11-02 meeting and why (agenda closed before the packet was ready)",
    !!civicTitle && civicTitle.includes("Skipped meeting") && civicTitle.includes("11/02/27") && civicTitle.includes("agenda closed"), civicTitle);

  // No flag on the OTHER bound tasks (39/40/41 have no predecessor lag at all) — precondition that
  // the flag is scoped to the real case, not a blanket mark on every meeting-bound row.
  const flag39 = await page.evaluate((id) => !!document.querySelector(`[data-task-row="${id}"] span[title^="⚠ Possible double count"]`), t39id);
  ok("C6 · task 39 (no predecessor lag) carries NO double-count flag — the mark is scoped to the real case", flag39 === false);
}

// =================================================================================================
// SECTION D (NEW-2) — clicking the flag drops the duplicate lag and re-lands on 2027-11-02, and the
// fix survives an undo/redo round-trip (Ctrl+Z brings 2028-05-06 back, exactly as any other edit).
// =================================================================================================
{
  await page.locator(`[data-task-row="${t49id}"] span[title^="⚠ Possible double count"]`).click();
  await pacedWait(page, 300);
  const startAfter = await cellText(page, t49id, "start");
  ok("D1 · clicking the flag moves task 49 from 05/06/28 to 11/02/27 (the brief's exact before/after)", startAfter === "11/02/27", startAfter);

  const flagAfter = await page.evaluate((id) => !!document.querySelector(`[data-task-row="${id}"] span[title^="⚠ Possible double count"]`), t49id);
  ok("D2 · the flag itself is gone once the duplicate lag is dropped (nothing left to double-count)", flagAfter === false);

  const boundAfter = await cellText(page, t49id, "meetingBody");
  ok("D3 · the binding itself is untouched by the fix — still named correctly after the change", boundAfter === "TCEQ MUD Creation · Master Schedule", boundAfter);

  await page.keyboard.press("Control+z");
  await pacedWait(page, 300);
  const startUndone = await cellText(page, t49id, "start");
  ok("D4 · Ctrl+Z reverses the fix like any other edit — back to 05/06/28", startUndone === "05/06/28", startUndone);

  await page.keyboard.press("Control+y");
  await pacedWait(page, 300);
  const startRedone = await cellText(page, t49id, "start");
  ok("D5 · redo re-applies the fix — 11/02/27 again", startRedone === "11/02/27", startRedone);
}

for (const p of [page]) {
  if (p._errors?.length) ok("no uncaught page errors during the whole run", false, JSON.stringify(p._errors));
}

await browser.close();
server.close();

const passed = results.filter(r => r.pass).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(passed === results.length ? 0 : 1);
