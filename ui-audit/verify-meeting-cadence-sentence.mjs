/* NEW-1/NEW-2 (2026-09-22 chat block) — Meeting Calendars dialog: the sentence-model cadence
 * editor + the footer contradiction fix.
 *
 * Fixture seeds a body in the OLD {freq,setpos,onOrAfter} shape (Baytown City Council, 2nd & 4th
 * Tuesday) to prove the load-time migration (normalizeMeetingCadence) runs transparently before
 * the dialog ever renders — the dialog itself only ever sees the new shape.
 *
 * ATTEMPT-BEFORE-YOU-PARK: this is a logged-out, no-external-GIS UI check (open a dialog, click
 * popovers, type text) — Claude-doable headless, driven here rather than filed as needing a live
 * pass.
 *
 * Run: node ui-audit/verify-meeting-cadence-sentence.mjs   [PW_CHROME=<chrome>]
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

// OLD SHAPE on purpose — proves normalizeMeetingCadence migrates it before the dialog ever renders.
const OLD_SHAPE_BODY = {
  id: "mb_council", name: "Baytown City Council", jurisdiction: "Baytown, TX",
  recurrence: [{ freq: "monthly", weekday: 4, setpos: [2, 4] }],
  agendaLead: { type: "offset", n: 10, unit: "business" },
  cutoffTime: "12:00 PM", sameDayFilingAllowed: false, blackoutDates: [], extraDates: [],
};
const FIXTURE = {
  aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  projects: { 1: { id: 1, name: "Cadence Sentence Fixture", meetingBodies: [OLD_SHAPE_BODY], tasks: [
    { id: 1, name: "Unbound task", start: "2026-08-15", end: "2026-08-15", duration: 1, predecessors: [],
      health: "gray", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true,
      durUnit: "d", durValue: 1 },
  ]}},
};

async function bootAndImport(page, url, fixture) {
  page.removeAllListeners("dialog");
  page.on("dialog", d => d.accept());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-meeting-cadence-sentence");
  await page.locator('[data-testid="open-history-desktop"]').click();
  await pacedWait(page, 250);
  await page.setInputFiles('input[type="file"][accept=".json"]', {
    name: "fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await pacedWait(page, 700);
  await page.locator('[data-testid="history-panel"] button:has-text("Close")').click();
  await pacedWait(page, 400);
}

async function openMeetingCalendars(page) {
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("planar-open-settings", { detail: "meetings" })));
  await page.waitForSelector('[data-testid="meeting-calendars-modal"]', { timeout: 10000 });
  await pacedWait(page, 150);
}

const modalText = async (page) => page.locator('[data-testid="meeting-calendars-modal"]').innerText();

const { server, url } = await makeServer();
const browser = await chromium.launch({ executablePath: EXEC });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await bootAndImport(page, url, FIXTURE);
  await openMeetingCalendars(page);

  // ── A: migration ran before the dialog ever saw the body ─────────────────────────────
  let txt = await modalText(page);
  ok("A1 · the OLD-shape body ({freq,setpos}) renders as the new sentence, not raw fields",
    txt.includes("Meets") && txt.includes("2nd") && txt.includes("4th") && txt.includes("Thursday") && !txt.includes("freq"),
    txt.slice(0, 200));
  ok("A2 · the body list sidebar shows the migrated sentence too", txt.includes("2nd and 4th Thursday of every month"));

  // ── B: footer — NEW-2, no contradiction on a clean (just-opened) dialog ───────────────
  const footerHasSave = async () => page.locator('[data-testid="meeting-calendars-modal"] button:has-text("Save changes")').count();
  const footerText = async () => page.locator('[data-testid="meeting-calendars-modal"]').locator('text=All changes saved').count();
  ok("B1 · clean dialog: 'All changes saved' is shown", (await footerText()) > 0);
  ok("B2 · clean dialog: NO 'Save changes' button is present (was the contradiction)", (await footerHasSave()) === 0);

  // ── C: POSITION popover — open, multi-pick, keyboard Escape closes IT, not the modal ──
  const positionTrigger = page.locator('[data-testid="meeting-calendars-modal"] button:has-text("2nd and 4th")').first();
  await positionTrigger.click();
  await pacedWait(page, 150);
  const popoverVisible = async () => page.locator('button[role="checkbox"]:has-text("Every week")').isVisible().catch(() => false);
  ok("C1 · the POSITION popover opens on click", await popoverVisible());
  await page.keyboard.press("Escape");
  await pacedWait(page, 150);
  ok("C2 · Escape closes the POSITION popover", !(await popoverVisible()));
  ok("C3 · Escape did NOT close the whole modal (popover-first routing)", await page.locator('[data-testid="meeting-calendars-modal"]').isVisible());

  // Re-open and pick "Every week" (exclusive) — the sentence must switch shape and become dirty.
  await positionTrigger.click();
  await pacedWait(page, 150);
  await page.locator('button[role="checkbox"]:has-text("Every week")').click();
  await pacedWait(page, 150);
  txt = await modalText(page);
  ok("C4 · picking 'Every week' switches the sentence to the every-week shape ('all year')", txt.includes("all year"));
  ok("C5 · editing makes the dialog dirty (footer now shows Unsaved + a Save button)",
    (await page.locator('text=Unsaved changes').count()) > 0 && (await footerHasSave()) > 0);

  // Undo the pick via the ✕ removing this pattern is not available for a single-pattern body —
  // instead just re-pick 2nd & 4th so downstream date math in this run stays on familiar ground.
  await page.locator('[data-testid="meeting-calendars-modal"] button:has-text("every")').first().click();
  await pacedWait(page, 150);
  await page.locator('button[role="checkbox"]:has-text("2nd")').first().click();
  await pacedWait(page, 100);
  await page.locator('button[role="checkbox"]:has-text("4th")').first().click();
  await pacedWait(page, 100);
  await page.keyboard.press("Escape");
  await pacedWait(page, 150);

  // ── D: MONTHS popover + the anchor line + "+ And also…" ───────────────────────────────
  const monthsTrigger = page.locator('[data-testid="meeting-calendars-modal"] button:has-text("every month")').first();
  await monthsTrigger.click();
  await pacedWait(page, 150);
  const marJan = page.locator('button[role="checkbox"]:has-text("Mar")');
  ok("D1 · the MONTHS popover opens with month chips", await marJan.isVisible().catch(() => false));
  await marJan.click();
  await pacedWait(page, 100);
  await page.keyboard.press("Escape");
  await pacedWait(page, 150);
  txt = await modalText(page);
  ok("D2 · restricting to March updates the sentence to name the month", txt.includes("Mar") && !txt.includes("every month"));

  ok("D3 · the anchor checkbox ('counting from after the') is present for a non-every pattern",
    (await page.locator('[data-testid="meeting-calendars-modal"]').locator("text=counting from after the").count()) > 0);

  const addAlsoBefore = await page.locator('[data-testid="meeting-calendars-modal"] .btn:has-text("And also")').count();
  await page.locator('[data-testid="meeting-calendars-modal"] button:has-text("And also")').click();
  await pacedWait(page, 150);
  const removeIcons = await page.locator('[data-testid="meeting-calendars-modal"] span[title="Remove this pattern"]').count();
  ok("D4 · '+ And also…' adds a second pattern row (a remove ✕ now appears)", addAlsoBefore >= 1 && removeIcons >= 1);

  await browser.close();
} catch (e) {
  console.error("FAIL ❌ — script error:", e);
  results.push({ name: "script-error", pass: false });
  try { await browser.close(); } catch {}
} finally {
  server.close();
}

const passed = results.filter(r => r.pass).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(passed === results.length ? 0 : 1);
