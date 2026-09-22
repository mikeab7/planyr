/* NEW-1 (B1824576 / V1295968) — "Reuse a meeting calendar from another schedule instead of
 * rebuilding it." Two entry points, both driven here:
 *   (1) Task right-click → bind-to-meeting submenu → "From other schedules" — imports + binds
 *       in one step, even when the target schedule has zero meeting bodies of its own.
 *   (2) Meeting calendars window → "Import from another schedule…" — multi-select, dedupes an
 *       already-identical body ("already here"), still imports a same-name/different-cadence one.
 *
 * ATTEMPT-BEFORE-YOU-PARK: this is a logged-out, no-external-GIS UI check (right-click a row,
 * open a dialog, tick boxes) — Claude-doable headless, driven here rather than filed as needing
 * a live pass. The ONE thing this harness cannot prove is a genuine signed-in Supabase round-trip
 * on the owner's real account — that stays parked as V1295968's live-verify step (`Blocker: auth`).
 * Everything else the item's acceptance table asks for is proven against the real app, live, below.
 *
 * Run: node ui-audit/verify-meeting-import.mjs   [PW_CHROME=<chrome>]
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

// "the 3rd Tuesday of every month"
const COUNCIL = {
  id: "mb_council_src", name: "Baytown City Council",
  recurrence: [{ positions: [3], weekday: 2, months: "all", anchor: null }],
  agendaLead: { type: "offset", n: 10, unit: "business" },
  cutoffTime: "", sameDayFilingAllowed: false, blackoutDates: [], extraDates: [],
};
// "the 2nd and 4th Thursday of every month" — a second, distinct source body.
const PZ = {
  id: "mb_pz_src", name: "P&Z Commission",
  recurrence: [{ positions: [2, 4], weekday: 4, months: "all", anchor: null }],
  agendaLead: { type: "offset", n: 5, unit: "calendar" },
  cutoffTime: "", sameDayFilingAllowed: false, blackoutDates: [], extraDates: [],
};
// Same name + SAME recurrence as COUNCIL, different id — an "already here" fixture, seeded
// directly onto the TARGET schedule so the dedupe check has something real to find.
const COUNCIL_ALREADY_HERE = { ...COUNCIL, id: "mb_council_dup" };

// ── Phase 1 fixture: context-menu quick import+bind (target schedule has ZERO bodies) ──────────
const CTX_FIXTURE = {
  aPid: 2, nPid: 4, nTid: 1000, view: "grid", section: "projects",
  projects: {
    1: { id: 1, name: "Sched A — source", meetingBodies: [COUNCIL, PZ], tasks: [task({ id: 1, name: "Src task" })] },
    // A real (unpinned) start gives cascadeDates a "packet ready" anchor to search forward from —
    // an unbound task with NO start and NO predecessor deliberately stays blank on binding (B386,
    // "nothing schedules it yet"), which is correct existing behavior, not something to fight here.
    2: { id: 2, name: "Sched B — ctx-menu target", meetingBodies: [], tasks: [task({ id: 1, name: "Bind me", start: "2026-09-01" })] },
  },
};
// ── Phase 2 fixture: modal multi-import + dedupe tag (target already has COUNCIL's twin) ───────
const MODAL_FIXTURE = {
  aPid: 3, nPid: 4, nTid: 1000, view: "grid", section: "projects",
  projects: {
    1: { id: 1, name: "Sched A — source", meetingBodies: [COUNCIL, PZ], tasks: [task({ id: 1, name: "Src task" })] },
    3: { id: 3, name: "Sched C — modal target", meetingBodies: [COUNCIL_ALREADY_HERE], tasks: [task({ id: 1, name: "Whatever" })] },
  },
};
// ── Phase 3 fixture: a solo account (no OTHER schedule at all) — the option must be hidden, not dead ──
const SOLO_FIXTURE = {
  aPid: 9, nPid: 10, nTid: 1000, view: "grid", section: "projects",
  projects: { 9: { id: 9, name: "Only schedule", meetingBodies: [], tasks: [task({ id: 1, name: "Solo task" })] } },
};

// This harness drives /sequence/ directly (never inside the Planyr shell's iframe), so the
// shell's postMessage nav bridge is dead code here (`inShell` is false — see App()'s "Embedded-
// mode bridge"). resolveViewState also means a fixture's own `aPid` is IGNORED whenever this
// browser context already has a per-tab aPid saved from the page's initial (pre-import) boot —
// which every fresh page gets, since the app loads its own default seed before the JSON import
// ever runs. So switching the ACTIVE schedule is always done through the real project switcher
// in the header, exactly as a person would, never by trusting the fixture's `aPid` field.
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
  await assertMeasurable(page, "verify-meeting-import");
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
async function openMenuFor(page, name) {
  const id = await rowIdByName(page, name);
  await page.locator(`[data-task-row="${id}"] [data-col-key="id"]`).click({ button: "right" });
  await pacedWait(page, 150);
}
async function menuItemTexts(page) {
  return page.evaluate(() => {
    const menu = [...document.querySelectorAll('div')].find(d => d.querySelector('i.ti-trash'))?.closest('div[style*="position: fixed"]')
      || [...document.querySelectorAll('div[style*="position: fixed"]')].find(d => d.querySelector('i.ti-trash'));
    if (!menu) return null;
    return [...menu.querySelectorAll('i.ti')].map(i => {
      const row = i.closest('div');
      return { text: (row?.innerText || "").trim() };
    });
  });
}
async function hoverBindTrigger(page) {
  // The "Bind to meeting calendar ▸" / "Meeting: X ▸" row is the one carrying the calendar icon
  // right after the Duplicate/Cut/Copy/Paste separator — hover it to open the flyout, same as a
  // real mouse user (the flyout is `onMouseEnter`-gated, per B844).
  await page.locator('i.ti-calendar-event, i.ti-calendar-plus').first().locator('..').hover();
  await pacedWait(page, 200);
}
// Reads the "Snap this row to" list inside an OPEN bind-flyout: each own body's name + whether
// its radio icon is checked (ti-check) or not (ti-circle) — this is how the live UI itself shows
// "this task is now bound to ITS OWN schedule's copy", with no need to peek at internal storage.
async function ownBodySnapRows(page) {
  return page.evaluate(() => {
    const cap = [...document.querySelectorAll('div')].find(d => (d.textContent || "").trim().startsWith("Snap this row to") || (d.textContent || "").trim().startsWith("Snap "));
    const flyout = cap ? cap.closest('div[style*="position: absolute"]') : null;
    if (!flyout) return null;
    return [...flyout.querySelectorAll('i.ti-check, i.ti-circle')].map(i => ({
      checked: i.className.includes("ti-check"),
      text: (i.closest('div')?.innerText || "").trim(),
    }));
  });
}
async function openMeetingCalendars(page) {
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("planar-open-settings", { detail: "meetings" })));
  await page.waitForSelector('[data-testid="meeting-calendars-modal"]', { timeout: 10000 });
  await pacedWait(page, 150);
}
const modalText = async (page) => page.locator('[data-testid="meeting-calendars-modal"]').innerText();
const modal = (page) => page.locator('[data-testid="meeting-calendars-modal"]');

let browser, page;
async function freshPage(url, fixture, switchTo) {
  if (page) await page.close();
  page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const pageErrors = []; page.on("pageerror", e => pageErrors.push(e.message));
  page._errors = pageErrors;
  await bootAndImport(page, url, fixture, switchTo);
  return page;
}

const { server, url } = await makeServer();
browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

// =================================================================================================
// SECTION A — task right-click: zero own bodies but bodies exist elsewhere → the flyout opens
// (not the flat "Add a meeting calendar…" row), shows "From other schedules", import-binds in
// one step, and the target schedule ends up with its OWN copy (not a reference into the source).
// =================================================================================================
{
  await freshPage(url, CTX_FIXTURE, "Sched B — ctx-menu target");
  await openMenuFor(page, "Bind me");
  let items = await menuItemTexts(page);
  const bindTrigger = items?.find(i => /Bind to meeting calendar/.test(i.text));
  ok("A1 · zero-body schedule shows the flyout trigger, not the flat 'Add a meeting calendar…' row",
    !!bindTrigger, JSON.stringify(items?.map(i => i.text)));

  await hoverBindTrigger(page);
  const flyoutText = await page.evaluate(() => {
    const cap = [...document.querySelectorAll('div')].find(d => (d.textContent || "").trim() === "From other schedules");
    return cap ? cap.closest('div[style*="position: absolute"]')?.innerText || null : null;
  });
  ok("A2 · flyout shows a 'From other schedules' group", !!flyoutText, flyoutText);
  ok("A3 · both source bodies are listed, tagged with their schedule name",
    !!flyoutText && flyoutText.includes("Baytown City Council") && flyoutText.includes("Sched A — source") && flyoutText.includes("P&Z Commission"),
    flyoutText);

  await page.locator('div[style*="position: absolute"] >> text=Baytown City Council').first().click();
  await pacedWait(page, 300);

  const startAfter = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-task-row]')];
    const row = rows.find(r => (r.querySelector('[data-col-key="name"]')?.innerText || "").trim() === "Bind me");
    return row ? (row.querySelector('[data-col-key="start"]')?.innerText || "").trim() : null;
  });
  ok("A4 · the task is now bound and snapped to a real meeting date (not blank)", !!startAfter && startAfter !== "", startAfter);
  const startDow = startAfter ? new Date(
    Number("20" + startAfter.slice(6, 8)), Number(startAfter.slice(0, 2)) - 1, Number(startAfter.slice(3, 5))
  ).getDay() : null;
  ok("A5 · the snapped date is a Tuesday (COUNCIL meets on weekday 2)", startDow === 2, `dow=${startDow} from ${startAfter}`);

  // Re-open the bind flyout: Sched B must now show its OWN copy of "Baytown City Council" in the
  // "Snap this row to" list (not just in "From other schedules" any more), checked as the current
  // binding — proving the copy landed in THIS schedule's own meetingBodies, not a live reference
  // into schedule A's.
  await openMenuFor(page, "Bind me");
  await hoverBindTrigger(page);
  const ownRows = await ownBodySnapRows(page);
  const ownCouncil = ownRows?.find(r => r.text.includes("Baytown City Council"));
  ok("A6 · Sched B's own body list now includes a 'Baytown City Council' entry (the copy)", !!ownCouncil, JSON.stringify(ownRows));
  ok("A7 · that entry is CHECKED — the task is bound to Sched B's own copy", ownCouncil?.checked === true, JSON.stringify(ownCouncil));
  // "From other schedules" must still list the SOURCE body too (untouched, re-importable, and not
  // hidden just because a copy now exists) — proving schedule A itself was never mutated.
  const flyoutAfter = await page.evaluate(() => {
    const cap = [...document.querySelectorAll('div')].find(d => (d.textContent || "").trim() === "From other schedules");
    return cap ? cap.closest('div[style*="position: absolute"]')?.innerText || null : null;
  });
  ok("A8 · schedule A's source body is still listed under 'From other schedules' (A was never mutated)",
    !!flyoutAfter && flyoutAfter.includes("Baytown City Council") && flyoutAfter.includes("Sched A — source"), flyoutAfter);
}

// =================================================================================================
// SECTION B — Meeting calendars window: "Import from another schedule…", dedupe tag, multi-select,
// no silent duplicate, draft/save gate still applies (nothing commits until Save changes).
// =================================================================================================
{
  await freshPage(url, MODAL_FIXTURE, "Sched C — modal target");
  await openMeetingCalendars(page);
  const importBtn = modal(page).locator('button:has-text("Import from another schedule")').first();
  ok("B1 · the Import button is present (an other schedule DOES exist)", await importBtn.isVisible().catch(() => false));
  await importBtn.click();
  await pacedWait(page, 200);

  let txt = await modalText(page);
  ok("B2 · the picker lists the source schedule's bodies, each with its cadence sentence + next dates",
    txt.includes("Baytown City Council") && txt.includes("P&Z Commission") && txt.includes("3rd Tuesday") && txt.includes("2nd and 4th Thursday"),
    txt.slice(0, 400));
  ok("B3 · the body that's already here (same name + cadence) is tagged 'already here'",
    /Baytown City Council[\s\S]{0,40}already here/i.test(txt), txt.slice(0, 400));
  ok("B4 · the genuinely new body carries NO 'already here' tag",
    !new RegExp("P&Z Commission[\\s\\S]{0,40}already here", "i").test(txt));

  // Pick BOTH — the already-here one (must dedupe) and the new one (must import).
  await modal(page).locator('label:has-text("Baytown City Council") input[type="checkbox"]').check();
  await modal(page).locator('label:has-text("P&Z Commission") input[type="checkbox"]').check();
  const importActionBtn = modal(page).locator('button:has-text("Import")').last();
  ok("B5 · the Import action button shows the picked count", (await importActionBtn.innerText()).includes("2"));
  await importActionBtn.click();
  await pacedWait(page, 250);

  txt = await modalText(page);
  ok("B6 · back on the normal body list after import", await modal(page).locator('button:has-text("+ Add meeting body")').isVisible());
  ok("B7 · the dialog is DIRTY — nothing has touched the schedule yet (draft/save gate honored)", txt.includes("Unsaved changes"));

  // Count bodies in the sidebar list — must be exactly 2 (COUNCIL_ALREADY_HERE reused + PZ new), never 3.
  const rowCount = () => modal(page).locator('[data-testid="meeting-body-row"]').count();
  ok("B8 · exactly 2 bodies in the draft (the already-here one was REUSED, not duplicated)", (await rowCount()) === 2, `rows=${await rowCount()}`);

  // Save — commits the draft to this tab's live `data` (the schedule's actual meetingBodies).
  await modal(page).locator('button:has-text("Save changes")').click();
  await pacedWait(page, 300);
  ok("B9 · after Save, footer reads saved (no more 'Unsaved changes')", !(await modalText(page)).includes("Unsaved changes"));

  // Close and reopen the SAME live tab (no reload — this in-memory round-trip is what a headless,
  // signed-out check can prove) — the saved state must still read 2 bodies, and the earlier
  // "already here" body must still resolve to a SINGLE id (not have grown a second copy on save).
  await modal(page).locator('span[title="Close (Esc)"]').click();
  await pacedWait(page, 200);
  await openMeetingCalendars(page);
  ok("B10 · reopening the (now-saved) modal still shows exactly 2 bodies", (await rowCount()) === 2, `rows=${await rowCount()}`);
  ok("B11 · the reopened dialog is clean — 'All changes saved', matching what was just committed",
    (await modalText(page)).includes("All changes saved"));
  // NOTE — what this harness can NOT prove, logged out: that the save survives a genuine page
  // reload against the signed-in cloud copy (Supabase requires auth; this sandbox's proxy blocks
  // that handshake). That specific leg is V1295968's still-pending live-verify step.
}

// =================================================================================================
// SECTION C — an account with no OTHER schedule at all: the option is hidden, never a dead button.
// =================================================================================================
{
  await freshPage(url, SOLO_FIXTURE);
  ok("C0 · booted onto the solo schedule (precondition)", (await rowIdByName(page, "Solo task")) != null);
  await openMeetingCalendars(page);
  const importBtn = modal(page).locator('button:has-text("Import from another schedule")');
  ok("C1 · with no other schedule on the account, the Import button is simply absent (not disabled)", (await importBtn.count()) === 0);

  await modal(page).locator('span[title="Close (Esc)"]').click();
  await pacedWait(page, 150);
  await openMenuFor(page, "Solo task");
  const items = await menuItemTexts(page);
  const bindItem = items?.find(i => /Add a meeting calendar…/.test(i.text));
  ok("C2 · task right-click falls back to the plain 'Add a meeting calendar…' row (no other bodies exist anywhere)",
    !!bindItem, JSON.stringify(items?.map(i => i.text)));
}

await browser.close();
server.close();

const passed = results.filter(r => r.pass).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(passed === results.length ? 0 : 1);
