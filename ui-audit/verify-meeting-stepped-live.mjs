/* B2642096 ×2 / V2096944 — a meeting row that was STEPPED (right-click Next/Previous meeting → `pinnedMeetingDate`)
 * must obey a typed date; the toast, the grid row and the Gantt marker must agree; Unpin must really unpin.
 *
 *   LIVE  (signed in as the test account, throwaway schedule, deleted at the end — constraint 15):
 *     E2E_LOGIN_KEY=… node ui-audit/verify-meeting-stepped-live.mjs https://planyr.io [expectedBuildPrefix]
 *   LOCAL (no sign-in; serves public/ with the vendored CDN copies — a dry run of the SAME steps):
 *     node ui-audit/verify-meeting-stepped-live.mjs
 *
 * V2086768 only ever exercised rows that had never been stepped (the false "pinnedMeetingDate is never set"
 * belief). EVERY row below is stepped through the REAL context menu before it is edited. KNOWN-GOOD ARM: step 0
 * reads a Next-meeting step on its own (09/15 → 10/20) before any edit is judged; if that is wrong the run is VOID. */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored, CDN_ASSETS } from "./lib/vendorCdn.mjs";

const arg = process.argv[2] || "";
const LIVE = /^https?:\/\//.test(arg) && !/localhost/.test(arg);
const base = arg.replace(/\/$/, ""), want = process.argv[3] || "";
const results = [];
const ok = (n, c, x = "") => { results.push(!!c); console.log(`${c ? "PASS ✅" : "FAIL ❌"} — ${n}${x ? "  ::  " + x : ""}`); };

const task = o => ({ start: "2026-09-15", end: "2026-09-15", duration: 0, durValue: 0, durUnit: "d", predecessors: [], health: "gray", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true, predUnresolved: [], ...o });
const body = { id: "mb_livestep1", name: "Live Board", jurisdiction: "Test", recurrence: [{ positions: [3], weekday: 2, months: "all", anchor: null }], blackoutDates: [], extraDates: [] };
const bound = o => task({ meetingBound: true, meetingBodyId: body.id, ...o });
const NAME = "ZZ Stepped Meeting Live Check";
const fixture = {
  aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  projects: { 1: { id: 1, name: NAME, meetingBodies: [body],
    colConfig: { visible: ["id", "name", "start", "end", "duration", "predecessors", "meetingBody", "health"] },
    tasks: [
      task({ id: 1, name: "Pred A", start: "2026-09-01", end: "2026-09-01", duration: 1, durValue: 1, pinnedStart: true }),
      bound({ id: 2, name: "Hearing B" }),
      bound({ id: 3, name: "Hearing C" }),
      bound({ id: 4, name: "Hearing D" }),
      bound({ id: 5, name: "Hearing E" }),
      bound({ id: 6, name: "Hearing F", start: "", end: "", predecessors: [{ id: 1, type: "FS", lag: 0 }] }),
      task({ id: 7, name: "Ref 11/17", start: "2026-11-17", end: "2026-11-17", pinnedStart: true }),
      task({ id: 8, name: "Ref 12/15", start: "2026-12-15", end: "2026-12-15", pinnedStart: true }),
    ] } },
};

let server, url, s, ctx, page, browser;
if (LIVE) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  s = await openSignedIn({ base, viewport: { width: 1440, height: 900 } });
  console.log("signed in as", s.proof.email, "| build", JSON.stringify(s.build));
  if (want) ok(`served build matches ${want}`, JSON.stringify(s.build).includes(want));
  ctx = s.page.context();
  const dir = await ensureVendored();
  await ctx.route(/cdn\.jsdelivr\.net|tabler/, async route => {
    const u = route.request().url();
    for (const [cu, name] of Object.entries(CDN_ASSETS)) if (u.startsWith(cu)) return route.fulfill({ status: 200, contentType: "text/javascript", body: await readFile(dir + "/" + name) });
    return route.fulfill({ status: 200, contentType: "text/css", body: "" });
  });
  page = await ctx.newPage();
  url = base + "/sequence/";
} else {
  await ensureVendored();
  const ROOT = new URL("../public/", import.meta.url).pathname;
  const real = await readFile(new URL("../public/sequence/index.html", import.meta.url).pathname, "utf8");
  server = createServer(async (req, res) => {
    try {
      if (await serveVendored(req, res)) return;
      let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      if (p.endsWith("sequence/index.html")) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(Buffer.from(rewriteCdn(real))); }
      const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      res.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" }[extname(fp)] || "application/octet-stream" }); res.end(await readFile(fp));
    } catch { res.writeHead(404); res.end("nf"); }
  });
  await new Promise(r => server.listen(0, r));
  url = `http://localhost:${server.address().port}/sequence/`;
  browser = await chromium.launch({ executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
}
const errs = []; page.on("pageerror", e => errs.push(e.message));
page.on("dialog", d => d.accept());
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => /No schedules yet|ID/.test(document.body.innerText) || document.querySelector("[data-task-row]"), null, { timeout: 60000 });
await assertMeasurable(page, "verify-meeting-stepped-live");
if (LIVE) {
  const emptyBefore = await page.evaluate(() => /No schedules yet/.test(document.body.innerText));
  ok("the test account holds no schedules before the run (nothing real can be overwritten)", emptyBefore);
  if (!emptyBefore) { console.log("VOID — refusing to import over existing schedules."); await s.close(); process.exit(2); }
  await page.getByRole("button", { name: /New schedule/ }).first().click();
}
await page.waitForSelector('[data-testid="open-history-desktop"]', { timeout: 30000 }); await pacedWait(page, 800);
await page.locator('[data-testid="open-history-desktop"]').click(); await pacedWait(page, 250);
await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
await pacedWait(page, 900); await page.locator('[data-testid="history-panel"] button:has-text("Close")').click(); await pacedWait(page, 1200);
await page.locator('.hdr-view button:has-text("Grid")').click(); await pacedWait(page, 700);
await page.waitForSelector('[data-task-row="2"]', { timeout: 20000 });

const cell = (id, key) => page.locator(`[data-task-row="${id}"] [data-col-key="${key}"]`).first();
const dateIn = async (id, key) => { const t = (await cell(id, key).innerText()).replace(/\s+/g, " "); const m = t.match(/\d\d\/\d\d\/\d\d/); return m ? m[0] : t.trim(); };
const padlock = id => cell(id, "start").locator('[title^="Pinned start"]').count();
const toastText = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="schedule-toast"]')].map(e => e.innerText).join(" | "));
const clearToasts = async () => { await page.evaluate(() => document.querySelectorAll('[data-testid="schedule-toast"]').forEach(e => e.remove())); await pacedWait(page, 100); };
const typeInto = async (id, key, text) => {
  await clearToasts();
  await cell(id, key).dblclick(); await pacedWait(page, 250);
  await page.keyboard.press("Control+a"); await pacedWait(page, 60);
  if (text) await page.keyboard.type(text, { delay: 20 }); else await page.keyboard.press("Backspace");
  await pacedWait(page, 120);
  await page.keyboard.press("Enter"); await pacedWait(page, 800);
};
const menuLabel = async (id, which) => {   // opens the REAL row context menu and returns the item's text
  await page.locator(`[data-task-row="${id}"] [data-col-key="id"]`).click({ button: "right" }); await pacedWait(page, 250);
  return (await page.getByText(new RegExp("^" + which + " meeting")).first().innerText()).trim();
};
const step = async (id, which) => { await clearToasts(); const l = await menuLabel(id, which); await page.getByText(new RegExp("^" + which + " meeting")).first().click(); await pacedWait(page, 900); return l; };
const undo = async () => { await page.keyboard.press("Escape"); await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {}); await page.keyboard.press("Control+z"); await pacedWait(page, 800); };
const ganttLeft = async id => {
  await page.locator('.hdr-view button:has-text("Gantt")').click(); await pacedWait(page, 900);
  const l = await page.evaluate(i => { const e = document.querySelector(`[data-gantt-bar="${i}"]`); return e ? Math.round(e.getBoundingClientRect().left) : null; }, id);
  await page.locator('.hdr-view button:has-text("Grid")').click(); await pacedWait(page, 700);
  await page.waitForSelector('[data-task-row="2"]', { timeout: 20000 });
  return l;
};

// 0 — KNOWN-GOOD ARM
const l0 = await step(2, "Next");
const b0 = await dateIn(2, "start");
ok("0. (known-good arm) right-click Next meeting steps Hearing B from 09/15 to 10/20/26, and the menu said so", b0 === "10/20/26" && /Oct 20/.test(l0), `${l0} → ${b0}`);
if (b0 !== "10/20/26") { console.log("VOID — stepping itself is wrong; nothing below is scored."); if (LIVE) await s.close(); process.exit(2); }
ok("0b. the stepped row shows the padlock (reads pinnedMeetingDate)", (await padlock(2)) >= 1);

// 1 — THE OWNER'S REPRO: typed non-meeting date on a stepped row
await typeInto(2, "start", "11/05/26");
let t = await toastText();
ok("1. stepped to 10/20, typed 11/05/26 → the ROW lands on 11/17/26", (await dateIn(2, "start")) === "11/17/26", await dateIn(2, "start"));
ok("1b. the toast names the same date the row holds", /Hearing B moved to 11\/17\/26, the next Live Board meeting/.test(t) && /11\/05\/26/.test(t), t.slice(0, 180));
ok("1c. Finish follows (start == end)", (await dateIn(2, "end")) === "11/17/26", await dateIn(2, "end"));

// 8 — undo: ONE step, restores the stepped date AND its pin
await undo();
ok("8. Ctrl+Z restores the stepped 10/20/26 in ONE step", (await dateIn(2, "start")) === "10/20/26", await dateIn(2, "start"));
ok("8b. …with its padlock (the earlier pin is restored)", (await padlock(2)) >= 1);
await page.keyboard.press("Control+Shift+z"); await pacedWait(page, 800);
ok("8c. redo re-applies the typed jump (11/17/26)", (await dateIn(2, "start")) === "11/17/26", await dateIn(2, "start"));

// 9 — step AFTER a typed date reads the new date, and pins it
const nl = await menuLabel(2, "Next"); await page.keyboard.press("Escape");
const pl = await menuLabel(2, "Previous"); await page.keyboard.press("Escape");
ok("9. after the typed edit the menu offers Next = Dec 15 and Previous = Oct 20 (read from the NEW date)", /Dec 15/.test(nl) && /Oct 20/.test(pl), `${nl} | ${pl}`);
await step(2, "Next");
ok("9b. Next meeting lands on 12/15/26 and pins it", (await dateIn(2, "start")) === "12/15/26" && (await padlock(2)) >= 1, await dateIn(2, "start"));

// 1d — the Gantt agrees with the grid (done AFTER the undo steps: the Grid/Gantt switch is itself part of the undo history)
const gB = await ganttLeft(2), gRef = await ganttLeft(7), gRef2 = await ganttLeft(8);
ok("9c. the GANTT marker agrees with the grid (B's x equals the 12/15 reference, not the 11/17 one)", gB != null && gB === gRef2 && gB !== gRef, `B=${gB} ref1117=${gRef} ref1215=${gRef2}`);

// 2 — typed date that IS a meeting, on a stepped row (used to snap back with NO toast)
await step(3, "Next");
await typeInto(3, "start", "11/17/26"); t = await toastText();
ok("2. stepped row C, typed exactly 11/17/26 (a real meeting) → lands on it", (await dateIn(3, "start")) === "11/17/26", await dateIn(3, "start"));
ok("2b. …with no 'moved' notice", !/moved to/.test(t), t.slice(0, 120));

// 3 — typed Finish on a stepped row
await step(4, "Next");
await typeInto(4, "end", "11/05/26");
ok("3. stepped row D, typed Finish 11/05/26 → Start AND Finish land on 11/17/26", (await dateIn(4, "start")) === "11/17/26" && (await dateIn(4, "end")) === "11/17/26", `${await dateIn(4, "start")} / ${await dateIn(4, "end")}`);

// 4 — clearing the date
await step(5, "Next");
await typeInto(5, "start", "");
const e5 = await dateIn(5, "start");
ok("4. stepped row E, Start cleared → the old stepped 10/20/26 does not come back", e5 !== "10/20/26", e5);

// 5 — Unpin really unpins (row driven by predecessor A → 09/15 meeting)
const f0 = await dateIn(6, "start");
await step(6, "Next");
const f1 = await dateIn(6, "start");
ok("5. row F follows predecessor A (09/15/26); stepping Next pins it to 10/20/26", f0 === "09/15/26" && f1 === "10/20/26" && (await padlock(6)) >= 1, `${f0} → ${f1}`);
await clearToasts();
// the lock's left edge sits under the frozen Name column's drag edge in this narrow fixture; click its visible right half (where a person would)
await cell(6, "start").locator('[title^="Pinned start"]').first().click({ position: { x: 7, y: 4 }, timeout: 8000 }); await pacedWait(page, 900);
ok("5b. click the padlock: padlock gone AND the row goes back to its predecessor's meeting (09/15/26)", (await padlock(6)) === 0 && (await dateIn(6, "start")) === "09/15/26", `${await padlock(6)} / ${await dateIn(6, "start")}`);
await step(6, "Next");
ok("5c. right-click Next meeting still works after an unpin and pins again", (await dateIn(6, "start")) === "10/20/26" && (await padlock(6)) >= 1, await dateIn(6, "start"));

ok("no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));

// persistence (LIVE only): reload with a cache-busting query and confirm the typed date held — if the throwaway is persisted
if (LIVE) {
  const fresh = await ctx.newPage(); await fresh.goto(base + "/sequence/?cb=" + Date.now(), { waitUntil: "domcontentloaded" });
  await fresh.waitForFunction(() => /No schedules yet|ID/.test(document.body.innerText), null, { timeout: 45000 }); await pacedWait(fresh, 2000);
  const persisted = await fresh.evaluate(() => !/No schedules yet/.test(document.body.innerText));
  if (persisted) {
    const held = await fresh.evaluate(() => { const r = document.querySelector('[data-task-row="2"] [data-col-key="start"]'); return r ? r.innerText.replace(/\s+/g, " ").match(/\d\d\/\d\d\/\d\d/)?.[0] : null; });
    ok("11. after a cache-busting reload Hearing B still holds 12/15/26 and nothing moved on load", held === "12/15/26", String(held));
  } else console.log("NOTE — the throwaway import is not persisted to the account (as V2086768 recorded); reload step not applicable, the load path is covered by the unit test (nothing moves on load).");
  await fresh.close();
  // cleanup (constraint 15)
  await page.bringToFront();
  await page.locator("button:has(i.ti-chevron-down)", { hasText: NAME }).first().click(); await pacedWait(page, 300);
  await page.getByText(NAME).last().click({ button: "right" }); await pacedWait(page, 300);
  await page.getByText(/^Delete/).last().click(); await pacedWait(page, 1500);
  ok("12. the throwaway schedule is deleted and the account is back to 'No schedules yet'", await page.evaluate(() => /No schedules yet/.test(document.body.innerText)));
  const f2 = await ctx.newPage(); await f2.goto(base + "/sequence/?cb=" + Date.now(), { waitUntil: "domcontentloaded" });
  await f2.waitForFunction(() => /No schedules yet|ID/.test(document.body.innerText), null, { timeout: 45000 }); await pacedWait(f2, 1500);
  ok("12b. a FRESH load also reads 'No schedules yet' (nothing left behind)", await f2.evaluate(() => /No schedules yet/.test(document.body.innerText)));
  await s.close();
} else { await browser.close(); server.close(); }
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
