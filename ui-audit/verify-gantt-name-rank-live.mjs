/* B2656160 (×2: every level strictly larger than the one below) — LIVE signed-in check that Gantt task names follow their LEVEL at every row height, on a deploy.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-gantt-name-rank-live.mjs [https://planyr.io] [expectedBuildPrefix]
 *
 * Signs in as the test account (ONE browser, ui-audit/lib/signedInSession.mjs), reads /version.json AND the served
 * /sequence/ page for a literal this change introduced ("<gantt-geom>") IN THE SAME CALL as the measurements, then
 * imports a THROWAWAY four-level schedule (a summary, a task and a milestone at every level + dependency links) at
 * row heights 20 / 24 / 34 — never a real plan; the import is local to this browser context (the cloud write is
 * refused for a fixture) and the last step proves nothing was stored on the account.
 *
 * Per row height, from the REAL computed font sizes off [data-gantt-name]: every name is drawn at its ranked size
 * (10 / 9.25 / 8.5 / 8), level 0 is strictly larger than level 1, a milestone name is never smaller than a task
 * name at its level, no name touches its bar / bracket / diamond, every dependency-arrow endpoint sits on a glyph
 * edge. Then buildGanttSVG on the SAME live page (the exhibit the PDF export prints): captions at their ranked
 * print sizes, level 0 larger than level 1. Known-good arms make a run VOID rather than green: the measured row
 * pitch must equal the requested row height, and arrows must exist. Saves screenshots under ui-audit/screens/.
 *
 * NO ROW IS CREATED (B2656160 ×2, 2026-11-04). The previous run reached the Schedule page via the empty state's "New schedule"
 * button, which INSERTS a `schedules` row the app can only soft-delete (that is how rows 119 and 120 happened). The test account's
 * rows are all soft-deleted (`deleted_at` set), so the app shows "No schedules yet". This run instead REUSES one existing empty
 * "Project NNN" row: it un-hides it (clears `deleted_at`), runs the check, hides it again with the same soft-delete the app's own
 * delete performs, then PROVES the account is back to what it was (same live-row list, that row's data byte-for-byte unchanged and
 * deleted again). "New schedule" is never clicked; with no reusable row the run FAILS LOUDLY rather than create one.
 * REUSE_ID=<id> picks the row (default: the highest-id empty soft-deleted "Project NNN" row). Never a real project. */

import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";
import { mkdirSync } from "node:fs";

const base = process.argv[2] || "https://planyr.io", want = process.argv[3] || "";
const OUT = new URL("./screens/", import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const NAME = "Gantt Name Rank Live Check";
const task = o => ({ start: "2026-03-02", end: "2026-03-13", duration: 10, predecessors: [], health: "gray", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 10, predUnresolved: [], ...o });
const ms = o => task({ duration: 0, durValue: 0, ...o });
const tasks = [
  task({ id: 1, name: "Program Summary (level 0)" }),
  task({ id: 2, name: "Phase Summary (level 1)", parentId: 1 }),
  task({ id: 3, name: "Package Summary (level 2)", parentId: 2 }),
  task({ id: 4, name: "Task at level 3", parentId: 3, start: "2026-03-02", end: "2026-03-06", duration: 5, durValue: 5 }),
  ms({ id: 5, name: "Milestone at level 3", parentId: 3, start: "2026-03-09", predecessors: [{ id: 4, type: "FS" }] }),
  task({ id: 6, name: "Task at level 2", parentId: 2, start: "2026-03-10", predecessors: [{ id: 5, type: "FS" }] }),
  ms({ id: 7, name: "Milestone at level 2", parentId: 2, start: "2026-03-20", predecessors: [{ id: 6, type: "FS" }] }),
  task({ id: 8, name: "Task at level 1", parentId: 1, start: "2026-03-23", predecessors: [{ id: 7, type: "FS" }] }),
  ms({ id: 9, name: "Milestone at level 1", parentId: 1, start: "2026-04-03", predecessors: [{ id: 8, type: "FS" }] }),
  ms({ id: 10, name: "Kickoff milestone (level 0)", start: "2026-04-06", predecessors: [{ id: 9, type: "FS" }] }),
  task({ id: 11, name: "Standalone task (level 0)", start: "2026-04-07", predecessors: [{ id: 10, type: "FS" }] }),
];
const LEVEL = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 3, 6: 2, 7: 2, 8: 1, 9: 1, 10: 0, 11: 0 };
const KIND = { 1: "summary", 2: "summary", 3: "summary", 4: "leaf", 5: "milestone", 6: "leaf", 7: "milestone", 8: "leaf", 9: "milestone", 10: "milestone", 11: "leaf" };
const RANKED = lv => [10, 9.25, 8.5, 8][Math.min(lv, 3)];   // B2656160 ×2: every level strictly larger than the one below
const RANKED_PRINT = lv => [9, 8.5, 8, 7.5][Math.min(lv, 3)];
const fixtureFor = rowH => ({ aPid: 1, nPid: 2, nTid: 1000, view: "split", section: "projects", settings: { rowHeight: rowH },
  projects: { 1: { id: 1, name: NAME, labelAlign: "center", tasks, colConfig: { visible: ["id","name","start","end","duration","predecessors","successors","health","status","responsibleParty","cost","notes"], widths: {} } } } });

const results = []; const ok = (n, c, x = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"} — ${n}${x ? " :: " + x : ""}`); };
const s = await openSignedIn({ base, viewport: { width: 1600, height: 900 } });
ok("signed in as the test account", /e2e@planyr\.test/.test(s.proof.email || ""), String(s.proof.email));
const page = await s.page.context().newPage(); await page.setViewportSize({ width: 1600, height: 900 });
const errs = []; page.on("pageerror", e => errs.push(String(e)));
page.on("dialog", d => d.accept());
// THE ACCOUNT'S OWN ROWS, snapshotted first. This check creates NOTHING: it un-hides ONE existing empty soft-deleted "Project NNN" row,
// and at the end hides it again and proves the account is exactly as it was.
const liveIds = () => s.page.evaluate(async () => { const q = await window.pfSupabase.from("schedules").select("id").is("deleted_at", null).order("id"); return q.error ? null : q.data.map(r => r.id); });
const allIds = () => s.page.evaluate(async () => { const q = await window.pfSupabase.from("schedules").select("id").order("id"); return q.error ? null : q.data.map(r => r.id); });
const idsBefore = await liveIds(), allBefore = await allIds();
ok("snapshot of the account's schedule rows taken before anything is touched", Array.isArray(idsBefore) && Array.isArray(allBefore), `${idsBefore && idsBefore.length} live / ${allBefore && allBefore.length} total`);
const reuse = await s.page.evaluate(async (want) => {
  const q = await window.pfSupabase.from("schedules").select("id,name,deleted_at,data").order("id", { ascending: false });
  if (q.error) return { err: q.error.message };
  const okRow = r => r.deleted_at && /^Project \d+$/.test(r.name) && r.data && Array.isArray(r.data.tasks) && r.data.tasks.length === 0;
  const row = want ? q.data.find(r => r.id === want && okRow(r)) : q.data.find(okRow);
  return row ? { id: row.id, name: row.name, deleted_at: row.deleted_at, dataJson: JSON.stringify(row.data) } : { none: true };
}, Number(process.env.REUSE_ID) || 0);
ok(`a reusable empty soft-deleted "Project NNN" row exists (id ${reuse.id}) — no row will be created`, !!reuse.id, JSON.stringify(reuse.err || reuse.none || ""));
if (!reuse.id) { console.log("FATAL: nothing to reuse; refusing to create a schedule row."); await s.close(); process.exit(1); }
const REUSE = reuse.id;
const setDeleted = (v) => s.page.evaluate(async ([id, v]) => { const q = await window.pfSupabase.from("schedules").update({ deleted_at: v }).eq("id", id).select("id"); return q.error ? "err:" + q.error.message : (q.data || []).length; }, [REUSE, v]);
const finish = async (code) => { await s.close(); process.exit(code); };
// Whatever kills this run (Ctrl-C, a thrown error, a rejected promise), the reused row is hidden again before it exits.
let rehidden = false;
const rehide = async (why, code) => { if (!rehidden) { rehidden = true; console.log("re-hiding the reused row after:", why); await setDeleted(reuse.deleted_at).catch(() => {}); } process.exit(code); };
process.on("SIGINT", () => rehide("SIGINT", 130));
process.on("uncaughtException", e => { console.log(String(e && e.stack || e)); rehide("uncaught exception", 1); });
process.on("unhandledRejection", e => { console.log(String(e && e.stack || e)); rehide("unhandled rejection", 1); });
ok("un-hid the one reusable row", (await setDeleted(null)) === 1);
await page.goto(base + "/sequence/?cb=" + Date.now(), { waitUntil: "domcontentloaded" });
const HIST = '[data-testid="open-history-desktop"]';
await page.locator(HIST).waitFor({ timeout: 40000 }).catch(() => {});
ok("the Schedule page opened on the reused row (no 'New schedule' pressed)", (await page.locator(HIST).count()) === 1 && (await page.getByText("No schedules yet").count()) === 0);
await assertMeasurable(page, "verify-gantt-name-rank-live");

const importFixture = async (fx) => {
  await page.locator('[data-testid="open-history-desktop"]').click(); await pacedWait(page, 250);
  await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fx)) });
  await pacedWait(page, 700); await page.locator('[data-testid="history-panel"] button:has-text("Close")').click(); await pacedWait(page, 1600);
};

// Which build is this? Same call as the measurements: the served build id AND a literal this change introduced.
const served = await page.evaluate(async () => {
  const v = await fetch("/version.json", { cache: "no-store" }).then(r => r.json());
  const html = await fetch("/sequence/", { cache: "no-store" }).then(r => r.text());
  return { build: v.build, hasGeom: html.includes("GANTT_PROFILES") && html.includes("ganttSummaryGeom") && html.includes("GANTT_CAPTION_LH")   /* identifiers survive the compiled page; the <gantt-geom> comment does not */, runsGeom: typeof window.buildGanttSVG === "function" };
});
console.log("build", JSON.stringify(served));
ok("the deploy serves the new geometry block (identifiers this change introduced)", served.hasGeom);
if (want) ok(`served build matches ${want}`, String(served.build).startsWith(want), String(served.build));

const gantt = async () => { // switch to Split (the owner's view) if the import did not land there
  const btn = page.locator('.hdr-view button:has-text("Split")'); if (await btn.count()) { await btn.first().click(); await pacedWait(page, 900); }
};
const measure = () => page.evaluate(() => {
  const norm = x => (x || "").replace(/\s+/g, " ").trim();
  const rows = [...document.querySelectorAll("[data-gantt-row]")].slice(0, 2).map(e => e.getBoundingClientRect().top);
  const names = [...document.querySelectorAll("[data-gantt-name]")].map(el => {
    const id = +el.getAttribute("data-gantt-name"), bar = document.querySelector(`[data-gantt-bar="${id}"]`), r = el.getBoundingClientRect(), b = bar && bar.getBoundingClientRect();
    return { id, text: norm(el.textContent), fs: parseFloat(getComputedStyle(el).fontSize), nameBottom: r.bottom, barTop: b ? b.top : null, barH: b ? b.height : null, barKind: bar ? bar.getAttribute("data-gantt-kind") : null };
  });
  const bars = [...document.querySelectorAll("[data-gantt-bar]")].map(e => e.getBoundingClientRect());
  const arrows = { total: 0, landed: 0, missed: [] };
  for (const svg of document.querySelectorAll("svg")) { const sr = svg.getBoundingClientRect();
    for (const p of svg.querySelectorAll('path[stroke-dasharray="4 3"]')) {
      const m = /M([-\d.]+),([-\d.]+) C[^L]*? ([-\d.]+),([-\d.]+)$/.exec(p.getAttribute("d").trim()); if (!m) continue;
      for (const [x, y] of [[+m[1], +m[2]], [+m[3], +m[4]]]) { const cx = sr.left + x, cy = sr.top + y; arrows.total++;
        // x tolerance 4: every row carries a 3px transparent left border (long-standing); the VERTICAL landing is what the shared geometry owns.
        if (bars.some(q => cx >= q.left - 4 && cx <= q.right + 4 && (Math.abs(cy - q.top) < 0.7 || Math.abs(cy - q.bottom) < 0.7))) arrows.landed++; else if (arrows.missed.length < 4) arrows.missed.push([+cx.toFixed(1), +cy.toFixed(1)]); } } }
  return { pitch: rows.length > 1 ? Math.round(rows[1] - rows[0]) : null, names, arrows };
});

for (const rowH of [20, 24, 34]) {
  console.log(`\n── row height ${rowH} · Split view ──`);
  await importFixture(fixtureFor(rowH)); await gantt();
  await page.waitForSelector("[data-gantt-name]", { timeout: 20000 });
  await pacedWait(page, 600);
  const m = await measure();
  ok(`the chart is really at row height ${rowH} (measured row pitch ${m.pitch})`, m.pitch === rowH);   // known-good arm
  ok("all 11 names rendered", m.names.length === 11, String(m.names.length));
  const rows = m.names.map(n => ({ ...n, level: LEVEL[n.id], kind: KIND[n.id] })).filter(n => n.level != null);
  const wrong = rows.filter(n => Math.abs(n.fs - RANKED(n.level)) > 0.01);
  ok("every name is drawn at its full ranked size", wrong.length === 0, wrong.map(n => `${n.text}=${n.fs}`).join(" | "));
  const fsOf = id => rows.find(n => n.id === id).fs;
  ok(`level 0 (${fsOf(1)}) is strictly larger than level 1 (${fsOf(2)}) — summary`, fsOf(1) > fsOf(2));
  ok(`level 0 task/milestone (${fsOf(11)} / ${fsOf(10)}) is larger than level 1 (${fsOf(8)} / ${fsOf(9)})`, fsOf(11) > fsOf(8) && fsOf(10) > fsOf(9));
  // B2656160 ×2: STRICT at every depth, for each kind (summary 0>1>2, task 0>1>2>3, milestone 0>1>2>3)
  const chain = ids => ids.map(fsOf), strict = a => a.every((v, i) => i === 0 || a[i - 1] > v);
  for (const [kind, ids] of [["summary", [1, 2, 3]], ["task", [11, 8, 6, 4]], ["milestone", [10, 9, 7, 5]]])
    ok(`${kind} sizes ${chain(ids).join(" > ")} are strictly decreasing with depth`, strict(chain(ids)));
  for (const [mid, tid, lv] of [[5, 4, 3], [7, 6, 2], [9, 8, 1], [10, 11, 0]]) ok(`milestone name L${lv} (${fsOf(mid)}) >= task name L${lv} (${fsOf(tid)})`, fsOf(mid) >= fsOf(tid) - 0.01);
  const onBar = rows.filter(n => n.barTop != null && n.nameBottom > n.barTop + 0.5);
  ok("no name touches its own bar / bracket / diamond", onBar.length === 0, onBar.map(n => `${n.text} ${n.nameBottom.toFixed(1)}>${n.barTop.toFixed(1)}`).join(" | "));
  const brH = id => rows.find(n => n.id === id).barH;
  ok(`bracket thickness holds its rank (${brH(1).toFixed(1)} >= ${brH(2).toFixed(1)} >= ${brH(3).toFixed(1)}) and still has legs`, brH(1) >= brH(2) - 0.01 && brH(2) >= brH(3) - 0.01 && brH(3) >= 4);
  ok(`arrows exist (${m.arrows.total} endpoints — known-good arm)`, m.arrows.total >= 10);
  ok(`every arrow endpoint lands on a glyph edge (${m.arrows.landed}/${m.arrows.total})`, m.arrows.landed === m.arrows.total, JSON.stringify(m.arrows.missed));
  await page.screenshot({ path: `${OUT}gantt-rank-live-row${rowH}.png` });
}

// ── the PDF exhibit (the same buildGanttSVG the export prints), on the live page ──
console.log("\n── print exhibit (buildGanttSVG) on the live page ──");
{
  const r = await page.evaluate((proj) => {
    const svg = String(window.buildGanttSVG([proj], 1100, "landscape", { barNames: true, labelAlign: "center", zoomMul: 1 }) || "");
    const host = document.createElement("div"); host.style.cssText = "position:absolute;left:-99999px;top:0;width:1200px"; host.innerHTML = svg; document.body.appendChild(host);
    const caps = [...host.querySelectorAll('text[dominant-baseline="central"]')].map(t => ({ s: t.textContent.replace(/&amp;/g, "&"), fs: parseFloat(t.getAttribute("font-size")) }));
    host.remove(); return { caps, nan: /NaN/.test(svg) };
  }, { id: 1, name: NAME, labelAlign: "center", tasks });
  const byName = new Map(tasks.map(t => [t.name, t.id]));
  const bad = r.caps.filter(c => byName.has(c.s) && Math.abs(c.fs - RANKED_PRINT(LEVEL[byName.get(c.s)])) > 0.01);
  const fsFor = id => (r.caps.find(c => c.s === tasks.find(t => t.id === id).name) || {}).fs;
  ok(`the exhibit prints all 11 captions (${r.caps.length})`, r.caps.length === 11);
  ok("no NaN geometry in the exhibit", !r.nan);
  ok("every printed caption is at its full ranked print size", bad.length === 0, bad.map(c => `${c.s}=${c.fs}`).join(" | "));
  ok(`printed level 0 (${fsFor(1)}) is larger than level 1 (${fsFor(2)}); level 0 milestone (${fsFor(10)}) is not smaller than level 1's (${fsFor(9)})`, fsFor(1) > fsFor(2) && fsFor(10) > fsFor(9));
}

ok("no uncaught page errors", errs.length === 0, errs.slice(0, 3).join(" | "));

// ── cleanup: hide the reused row again (the app's own soft-delete) and PROVE the account is as it was (owner rule: test artifacts are always cleared) ──
{
  ok("hid the reused row again", (await setDeleted(reuse.deleted_at || new Date().toISOString())) === 1);
  const after = await s.page.evaluate(async (id) => { const q = await window.pfSupabase.from("schedules").select("id,deleted_at,data").eq("id", id).maybeSingle(); return q.error ? { err: q.error.message } : { deleted: !!q.data.deleted_at, dataJson: JSON.stringify(q.data.data) }; }, REUSE);
  ok("the reused row is hidden again", after.deleted === true, JSON.stringify(after.err || ""));
  ok("the reused row's data is byte-for-byte what it was (the fixture import stayed local)", after.dataJson === reuse.dataJson);
  const liveEnd = await liveIds(), allEnd = await allIds();
  ok("the account's visible schedules are exactly as before", JSON.stringify(liveEnd) === JSON.stringify(idsBefore), JSON.stringify(liveEnd));
  ok("NO row was created (total rows unchanged)", JSON.stringify(allEnd) === JSON.stringify(allBefore), `${allBefore.length} -> ${allEnd && allEnd.length}`);
}
await s.close();
console.log(results.filter(Boolean).length + "/" + results.length + " passed");
process.exit(results.every(Boolean) ? 0 : 1);
