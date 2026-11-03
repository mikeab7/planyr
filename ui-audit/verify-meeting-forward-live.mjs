/* B2642096 / V2086768 — LIVE signed-in check (test account) of the meeting-calendar forward jump and the
 * "typed date holds, and you are told" notice, driven with REAL keys in the real Schedule grid.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-meeting-forward-live.mjs [https://planyr.io] [expectedBuildPrefix]
 *
 * Reads /version.json IN THE SAME CALL as the assertions (served-chunk rule). The throwaway schedule is imported
 * into the TEST ACCOUNT only (never a real schedule; the account held no schedules when this was written), and is
 * DELETED at the end (constraint 15) — the run is VOID if the account is not back to "No schedules yet".
 * KNOWN-GOOD ARM: step 1 reads a date the engine derived on its own (B on 11/17 from predecessor A) before any
 * edit is judged; if that is wrong the run is VOID, not scored.
 * The browser here cannot reach the scripts' CDN, so Babel/supabase are served from the repo's vendored copies
 * (same bytes, only the origin differs — ui-audit/lib/vendorCdn.mjs). */
import { readFile } from "node:fs/promises";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, CDN_ASSETS } from "./lib/vendorCdn.mjs";

const base = (process.argv[2] || "https://planyr.io").replace(/\/$/, ""), want = process.argv[3] || "";
const results = [];
const ok = (n, c, x = "") => { results.push(!!c); console.log(`${c ? "PASS ✅" : "FAIL ❌"} — ${n}${x ? "  ::  " + x : ""}`); };

const task = o => ({ start: "2026-11-02", end: "2026-11-02", duration: 1, predecessors: [], health: "gray", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 1, predUnresolved: [], ...o });
const FS = id => [{ id, type: "FS", lag: 0 }];
const body = { id: "mb_livefwd1", name: "Live Board", jurisdiction: "Test", recurrence: [{ positions: [3], weekday: 2, months: "all", anchor: null }], blackoutDates: [], extraDates: [] };
const fixture = {
  aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  projects: { 1: { id: 1, name: "ZZ Meeting Forward Live Check", meetingBodies: [body],
    colConfig: { visible: ["id", "name", "start", "end", "duration", "predecessors", "meetingBody", "health"] },
    tasks: [
      task({ id: 1, name: "Pred A", pinnedStart: true }),
      task({ id: 2, name: "Hearing B", start: "", end: "", duration: 0, durValue: 0, meetingBound: true, meetingBodyId: body.id, predecessors: FS(1) }),
      task({ id: 3, name: "Dated C", start: "2026-11-04", end: "2026-11-04", pinnedStart: true }),
      task({ id: 4, name: "Typed D", start: "", end: "", predecessors: FS(1) }),
      task({ id: 5, name: "Follower G", start: "", end: "", duration: 0, durValue: 0, meetingBound: true, meetingBodyId: body.id, predecessors: FS(1) }),   // never typed into: follows A
    ] } },
};
const COL = { name: 1, start: 2, end: 3, meeting: 6 };

const s = await openSignedIn({ base, viewport: { width: 1440, height: 900 } });
console.log("signed in as", s.proof.email, "| build", JSON.stringify(s.build));
if (want) ok(`served build matches ${want}`, JSON.stringify(s.build).includes(want));
const ctx = s.page.context();
const dir = await ensureVendored();
await ctx.route(/cdn\.jsdelivr\.net|tabler/, async route => {
  const u = route.request().url();
  for (const [url, name] of Object.entries(CDN_ASSETS)) if (u.startsWith(url)) return route.fulfill({ status: 200, contentType: "text/javascript", body: await readFile(dir + "/" + name) });
  return route.fulfill({ status: 200, contentType: "text/css", body: "" });
});
const page = await ctx.newPage();
page.on("dialog", d => d.accept());
await page.goto(base + "/sequence/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => /No schedules yet|ID/.test(document.body.innerText), null, { timeout: 45000 });
await assertMeasurable(page, "verify-meeting-forward-live");
const emptyBefore = await page.evaluate(() => /No schedules yet/.test(document.body.innerText));
ok("the test account holds no schedules before the run (nothing real can be overwritten)", emptyBefore);
if (!emptyBefore) { console.log("VOID — refusing to import over existing schedules."); await s.close(); process.exit(2); }

// import the throwaway (the empty state has no History button: create a schedule first — the import then replaces it)
await page.getByRole("button", { name: /New schedule/ }).first().click();
await page.waitForSelector('[data-testid="open-history-desktop"]', { timeout: 30000 }); await pacedWait(page, 800);
await page.locator('[data-testid="open-history-desktop"]').click(); await pacedWait(page, 250);
await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
await pacedWait(page, 900); await page.locator('[data-testid="history-panel"] button:has-text("Close")').click(); await pacedWait(page, 1200);
await page.locator('.hdr-view button:has-text("Grid")').click(); await pacedWait(page, 700);
await page.waitForSelector('[data-task-row="2"]', { timeout: 20000 });

const cell = (id, col) => page.locator(`[data-task-row="${id}"] > div`).nth(col);
const dateIn = async (id, col) => { const t = (await cell(id, col).innerText()).replace(/\s+/g, " "); const m = t.match(/\d\d\/\d\d\/\d\d/); return m ? m[0] : t.trim(); };
const toastText = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="schedule-toast"]')].map(e => e.innerText).join(" | "));
const clearToasts = async () => { await page.evaluate(() => document.querySelectorAll('[data-testid="schedule-toast"]').forEach(e => e.remove())); await pacedWait(page, 100); };   // each check reads ONLY its own edit's notice
const typeInto = async (id, col, text) => {
  await clearToasts();
  await cell(id, col).dblclick(); await pacedWait(page, 250);
  await page.keyboard.press("Control+a"); await pacedWait(page, 60);
  await page.keyboard.type(text, { delay: 20 }); await pacedWait(page, 120);
  await page.keyboard.press("Enter"); await pacedWait(page, 700);
};
const undo = async () => { await page.keyboard.press("Escape"); await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {}); await page.keyboard.press("Control+z"); await pacedWait(page, 700); };

// 1 — KNOWN-GOOD ARM
const b0 = await dateIn(2, COL.start);
ok("1. (known-good arm) Hearing B lands on the 3rd-Tuesday meeting 11/17/26 off predecessor A alone", b0 === "11/17/26", b0);
if (b0 !== "11/17/26") { console.log("VOID — the engine arm is wrong; nothing below is scored."); await s.close(); process.exit(2); }
const mark = await page.evaluate(() => { const r = document.querySelector('[data-task-row="2"]'); const t = r && [...r.querySelectorAll("[title]")].map(e => e.title).find(x => /Live Board/.test(x)); return t || ""; });
ok("1b. the civic mark names the calendar and is not infeasible", /Live Board/.test(mark) && !/INFEASIBLE/.test(mark), mark.slice(0, 80));

// 2 — typed non-meeting date jumps forward + toast
await typeInto(2, COL.start, "11/24/26");
let t = await toastText();
ok("2. typing 11/24/26 (not a meeting day) puts B on the NEXT meeting, 12/15/26", (await dateIn(2, COL.start)) === "12/15/26", await dateIn(2, COL.start));
ok("2b. the toast says where it moved and why", /Hearing B moved to 12\/15\/26, the next Live Board meeting/.test(t) && /11\/24\/26/.test(t), t.slice(0, 160));
ok("2c. Finish follows (start == end)", (await dateIn(2, COL.end)) === "12/15/26", await dateIn(2, COL.end));
// 8 — undo is ONE step, and not stuck (B1536176)
await undo();
ok("8. Ctrl+Z restores the pre-jump date in ONE step", (await dateIn(2, COL.start)) === "11/17/26", await dateIn(2, COL.start));
await page.keyboard.press("Control+Shift+z"); await pacedWait(page, 700);
ok("8b. redo re-applies the jump (undo is not stuck)", (await dateIn(2, COL.start)) === "12/15/26", await dateIn(2, COL.start));
await undo();

// 3 — on a meeting date stays; day after goes FORWARD
await typeInto(2, COL.start, "11/17/26"); t = await toastText();
ok("3. typing exactly a meeting date keeps it, with no 'moved' notice", (await dateIn(2, COL.start)) === "11/17/26" && !/moved to/.test(t), t.slice(0, 120));
await typeInto(2, COL.start, "11/18/26");
ok("3b. the day AFTER a meeting goes to the NEXT one (12/15/26), never back to 11/17", (await dateIn(2, COL.start)) === "12/15/26", await dateIn(2, COL.start));

// 4 — typed Finish
await typeInto(2, COL.end, "12/17/26");
ok("4. a typed Finish also lands on a meeting (Start == Finish, no finish lock) — 01/19/27", (await dateIn(2, COL.start)) === "01/19/27" && (await dateIn(2, COL.end)) === "01/19/27", `${await dateIn(2, COL.start)} / ${await dateIn(2, COL.end)}`);

// 7 — binding a dated task
const sel = cell(3, COL.meeting).locator("select");
if (await sel.count()) {
  await sel.selectOption({ value: body.id }); await pacedWait(page, 800); t = await toastText();
  ok("7. binding the dated task C (11/04/26) moves it forward to the 11/17/26 meeting", (await dateIn(3, COL.start)) === "11/17/26", await dateIn(3, COL.start));
  ok("7b. the move is announced", /Dated C moved to 11\/17\/26, the next Live Board meeting/.test(t), t.slice(0, 160));
} else ok("7. the Meeting column's bind picker is present", false, "no <select> in the Meeting cell");

// 6 — typed date earlier than the predecessor allows (plain task D)
await typeInto(4, COL.start, "11/02/26"); t = await toastText();
ok("6. typing D's Start EARLIER than predecessor A allows: the date HOLDS", (await dateIn(4, COL.start)) === "11/02/26", await dateIn(4, COL.start));
ok("6b. …and he is told, naming both", /"Typed D" is set to 11\/02\/26, earlier than "Pred A" allows/.test(t), t.slice(0, 200));
await typeInto(4, COL.start, "11/20/26"); t = await toastText();
ok("6c. typing a date LATER than the predecessor allows raises no conflict notice", !/earlier than|now runs past/.test(t), t.slice(0, 120));
await typeInto(1, COL.start, "12/01/26"); t = await toastText();
ok("5. PREDECESSOR PUSH: A moved to 12/01 pushes the never-typed meeting row G past the 11/17 meeting to the NEXT one, 12/15/26", (await dateIn(5, COL.start)) === "12/15/26", await dateIn(5, COL.start));
ok("5b. …and G (never typed into) is announced as moved to the next meeting", /Follower G moved to 12\/15\/26, the next Live Board meeting/.test(t), t.slice(0, 200));
ok("6d. moving predecessor A past D's typed date: D holds at 11/20/26", (await dateIn(4, COL.start)) === "11/20/26", await dateIn(4, COL.start));
ok("6e. …and he is told AT THAT EDIT, naming predecessor and task", /"Pred A" now runs past "Typed D"'s typed date 11\/20\/26/.test(t), t.slice(0, 220));
await typeInto(1, COL.start, "11/02/26"); t = await toastText();
ok("6f. fixing the predecessor clears the conflict and announces nothing about D", !/now runs past|earlier than/.test(t), t.slice(0, 120));
ok("6g. …and G follows A back to the 11/17/26 meeting", (await dateIn(5, COL.start)) === "11/17/26", await dateIn(5, COL.start));

// 9 — the LOAD path moves nothing and announces nothing. (A reload cannot be used: the throwaway is never persisted
// to the account. Importing a fixture runs the SAME normalize + cascade a load does — applyLoadedDataRef.)
const loadFx = JSON.parse(JSON.stringify(fixture));
loadFx.projects[1].tasks.push(
  task({ id: 6, name: "Stored off-calendar E", start: "2026-09-30", end: "2026-09-30", duration: 0, durValue: 0, meetingBound: true, meetingBodyId: body.id, pinnedStart: true }),
  task({ id: 7, name: "Stored conflict F", start: "2026-11-02", end: "2026-11-02", predecessors: FS(1), pinnedStart: true }),
);
loadFx.projects[1].tasks[0].start = loadFx.projects[1].tasks[0].end = "2026-11-10";   // so F (11/02) is ALREADY in conflict when loaded
await page.locator('[data-testid="open-history-desktop"]').click(); await pacedWait(page, 250);
await page.evaluate(() => { document.querySelectorAll('[data-testid="schedule-toast"]').forEach(e => e.remove()); });
await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f2.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(loadFx)) });
await pacedWait(page, 500); t = await toastText();
await pacedWait(page, 900); await page.locator('[data-testid="history-panel"] button:has-text("Close")').click(); await pacedWait(page, 1200);
await page.waitForSelector('[data-task-row="6"]', { timeout: 20000 });
ok("9. loading a stored OFF-calendar bound date moves nothing (09/30/26 stays; Goose Creek task 168 shape)", (await dateIn(6, COL.start)) === "09/30/26", await dateIn(6, COL.start));
ok("9b. …and a conflict already sitting in loaded data is not announced", !/earlier than|now runs past|moved to/.test(t.replace(/Imported[^|]*/, "")), t.slice(0, 160));

// 10 — cleanup (constraint 15): delete the throwaway through the app's own project menu, then PROVE the account is empty again
await page.screenshot({ path: process.env.SHOT || "/tmp/meeting-forward-live.png" }).catch(() => {});
await page.locator("button:has(i.ti-chevron-down)", { hasText: "ZZ Meeting Forward Live Check" }).first().click(); await pacedWait(page, 300);
await page.getByText("ZZ Meeting Forward Live Check").last().click({ button: "right" }); await pacedWait(page, 300);
await page.getByText(/^Delete/).last().click(); await pacedWait(page, 1500);
let gone = await page.evaluate(() => /No schedules yet/.test(document.body.innerText));
ok("10. the throwaway schedule is deleted and the account is back to 'No schedules yet'", gone);
const fresh = await ctx.newPage(); await fresh.goto(base + "/sequence/", { waitUntil: "domcontentloaded" });
await fresh.waitForFunction(() => /No schedules yet|ID/.test(document.body.innerText), null, { timeout: 45000 }); await pacedWait(fresh, 1500);
ok("10b. a FRESH load of the account also reads 'No schedules yet' (nothing left behind)", await fresh.evaluate(() => /No schedules yet/.test(document.body.innerText)));
await s.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
