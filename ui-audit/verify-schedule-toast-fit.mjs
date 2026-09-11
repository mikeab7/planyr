/* B1539584 — the schedule toast spills its message outside the toast.
 *
 * Owner report, his own Goose Creek Master Schedule, 2:35 PM Central 2026-09-11, screenshot
 * attached: after right-click → "Next meeting" on a meeting-bound row, the confirmation toast's
 * white rounded pill ends shortly after the sentence's first dash and the rest of the message
 * ("... - the 09/24/26 agenda closed 09/10/26.") paints straight onto the bare page over the
 * grid behind it, overlapping the Notes column and a row of task text. His words: "the text in
 * the banner isnt containted in the banner, the banner should always contain the text."
 *
 * ROOT CAUSE (public/sequence/index.html, showToast): the pill had `maxWidth: "420px"` AND
 * `whiteSpace: "nowrap"` on a `display:flex` container. `max-width` genuinely capped the
 * container's own painted background at 420px, but the flex-item text span's default
 * `min-width: auto` means a flex item never shrinks below its own content's intrinsic size while
 * `overflow` is `visible` — so the nowrap text rendered at its full, uncapped width and simply
 * overflowed past the (correctly capped) background, exactly matching the screenshot: a pill that
 * ends, with text continuing past it. This was NOT pixel-arithmetic positioning (the fixed
 * bottom/left + translateX(-50%) centering is ordinary, legitimate layout) — the defect was the
 * white-space/min-width interaction that let content escape a real, correctly-sized box.
 *
 * FIX: drop `white-space: nowrap`; let the text wrap (`minWidth: 0` on the span so the flex item
 * can actually shrink to the cap, `overflowWrap: break-word` as a backstop). `max-width` becomes
 * `min(420px, calc(100vw - 32px))` so the cap itself never exceeds a phone viewport. The toast
 * grows TALLER instead of spilling text sideways — nothing is truncated or shortened.
 *
 * This checks the fix against the toast's shared container (not one string): the meeting-step
 * long message (owner's exact reported sentence, driven through the real "Next meeting" menu
 * action) AND the separate weekend-roll message (B624, driven by typing a Saturday into a Start
 * cell) — two different call sites of the same `showToast`, both measured at desktop AND phone
 * width. The pass condition, every time, is a real DOM measurement: the toast's own box has no
 * horizontal scroll overflow (`scrollWidth <= clientWidth`, i.e. nothing painted past its own
 * background) and the box itself never extends past the viewport's left/right edge.
 *
 * Run: node ui-audit/verify-schedule-toast-fit.mjs   [PW_CHROME=<chrome>]
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

// Same council body shape as the meeting-step harness (2nd & 4th Tuesday): meeting dates around
// this fixture's window include 2026-08-25 and 2026-09-08.
const BODY = {
  id: "mb_test1", name: "Baytown City Council",
  recurrence: [{ freq: "monthly", weekday: 2, setpos: [2, 4] }],
  agendaLead: { type: "offset", n: 10, unit: "business" },
  cutoffTime: "12:00 PM", sameDayFilingAllowed: false, blackoutDates: [], extraDates: [],
};
const FIXTURE = {
  aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  projects: { 1: { id: 1, name: "Toast Fit Fixture", meetingBodies: [BODY], tasks: [
    // Owner's own task name, so section A reproduces his reported sentence close to verbatim:
    // "City Council Public Hearing and Consideration moved to 10/08/26 - the 09/24/26 agenda
    // closed 09/10/26." — pinned to a non-meeting date so "Next meeting" rolls it forward.
    task({ id: 1, name: "City Council Public Hearing and Consideration", meetingBound: true, meetingBodyId: "mb_test1",
      pinnedStart: true, start: "2026-08-15", end: "2026-08-15", duration: 0, durValue: 0 }),
    task({ id: 2, name: "Weekend roll task", start: "2026-09-01", end: "2026-09-01" }),
  ]}},
};

async function bootAndImport(page, url, fixture) {
  page.removeAllListeners("dialog");
  page.on("dialog", d => d.accept());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-schedule-toast-fit");
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
async function openMenuFor(page, name) {
  const id = await rowIdByName(page, name);
  await page.locator(`[data-task-row="${id}"] [data-col-key="id"]`).click({ button: "right" });
  await pacedWait(page, 150);
}

// Reads the toast's own measured fit: whether its painted content ever escapes its own box
// (scrollWidth > clientWidth means something is drawn wider than the background it sits on —
// exactly the reported defect), and whether the box itself stays inside the viewport.
async function readToastFit(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="schedule-toast"]');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      text: el.innerText,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowsOwnBox: el.scrollWidth > el.clientWidth + 1,   // +1px rounding slack
      rectLeft: rect.left,
      rectRight: rect.right,
      viewportWidth: window.innerWidth,
      withinViewport: rect.left >= -0.5 && rect.right <= window.innerWidth + 0.5,
      lineCount: Math.round(rect.height / (parseFloat(getComputedStyle(el).lineHeight) || 1)),
    };
  });
}

async function waitForToast(page) {
  await page.waitForSelector('[data-testid="schedule-toast"]', { timeout: 4000 }).catch(() => {});
  // Let the enter transition settle so the measured box is the final, not the pre-animation, size.
  await pacedWait(page, 150);
}

let browser, page;
async function freshPage(url, fixture, viewport) {
  if (page) await page.close();
  page = await browser.newPage({ viewport });
  await bootAndImport(page, url, fixture);
  return page;
}

const { server, url } = await makeServer();
browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

const DESKTOP = { width: 1600, height: 950 };
const PHONE = { width: 390, height: 844 };   // iPhone-class CSS width — the narrowest realistic case

// =================================================================================================
// SECTION A — the owner's exact reported case: a long meeting-step message, desktop width
// =================================================================================================
{
  await freshPage(url, FIXTURE, DESKTOP);
  await openMenuFor(page, "City Council Public Hearing and Consideration");
  await page.locator("i.ti-chevron-right").locator("..").click();   // "Next meeting"
  await waitForToast(page);
  const fit = await readToastFit(page);
  ok("A1 · the toast appears with the expected long message", !!fit && /agenda closed/.test(fit.text), JSON.stringify(fit?.text));
  ok("A2 · the message text does NOT overflow the toast's own box (the reported defect)", !!fit && !fit.overflowsOwnBox,
    fit ? `scrollWidth=${fit.scrollWidth} clientWidth=${fit.clientWidth}` : "no toast");
  ok("A3 · the toast box stays fully inside the viewport", !!fit && fit.withinViewport,
    fit ? `rectLeft=${fit.rectLeft} rectRight=${fit.rectRight} viewportWidth=${fit.viewportWidth}` : "no toast");
  ok("A4 · the long message actually WRAPPED (grew taller) rather than staying single-line-and-escaping",
    !!fit && fit.lineCount >= 2, fit ? `lineCount≈${fit.lineCount}` : "no toast");
}

// =================================================================================================
// SECTION B — a SECOND, unrelated call site of the same showToast: the B624 weekend-roll message,
// desktop width. Proves the fix is in the shared container, not a patch on one string (point b).
// =================================================================================================
{
  await freshPage(url, FIXTURE, DESKTOP);
  const id = await rowIdByName(page, "Weekend roll task");
  await page.locator(`[data-task-row="${id}"] [data-col-key="start"]`).click();
  await page.keyboard.press("Enter");
  await pacedWait(page, 150);
  // .fill() replaces the input's pre-seeded existing value outright; keyboard.type() would just
  // insert at the cursor after it (the date editor doesn't select-on-focus), producing garbage.
  await page.locator("input.ei").fill("9/12/26");   // a Saturday — rolls forward to Mon 9/14/26
  await page.keyboard.press("Enter");
  await waitForToast(page);
  const fit = await readToastFit(page);
  ok("B1 · the weekend-roll toast appears with the expected message", !!fit && /you picked a weekend/.test(fit.text), JSON.stringify(fit?.text));
  ok("B2 · it does not overflow its own box either (same shared container fix)", !!fit && !fit.overflowsOwnBox,
    fit ? `scrollWidth=${fit.scrollWidth} clientWidth=${fit.clientWidth}` : "no toast");
}

// =================================================================================================
// SECTION C — the same long meeting-step message at PHONE width (point d): must still fully
// contain its text and stay clear of the viewport edges.
// =================================================================================================
{
  // Boot/import at desktop width (the mobile menu gates the history/import affordance behind a
  // hamburger this harness doesn't need to drive), THEN resize down — same content, phone viewport.
  await freshPage(url, FIXTURE, DESKTOP);
  await page.setViewportSize(PHONE);
  await pacedWait(page, 200);
  await openMenuFor(page, "City Council Public Hearing and Consideration");
  await page.locator("i.ti-chevron-right").locator("..").click();
  await waitForToast(page);
  const fit = await readToastFit(page);
  ok("C1 · at phone width, the toast still appears with the full message", !!fit && /agenda closed/.test(fit.text), JSON.stringify(fit?.text));
  ok("C2 · at phone width, the message does not overflow the toast's own box", !!fit && !fit.overflowsOwnBox,
    fit ? `scrollWidth=${fit.scrollWidth} clientWidth=${fit.clientWidth}` : "no toast");
  ok("C3 · at phone width, the toast box never runs off either viewport edge", !!fit && fit.withinViewport,
    fit ? `rectLeft=${fit.rectLeft} rectRight=${fit.rectRight} viewportWidth=${fit.viewportWidth}` : "no toast");
}

server.close();
if (page) await page.close();
await browser.close();

const passed = results.filter(r => r.pass).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(passed === results.length ? 0 : 1);
