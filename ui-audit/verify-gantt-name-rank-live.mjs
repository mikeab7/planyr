/* B2656160 / V2100832 — LIVE signed-in check that Gantt task names follow their LEVEL at every row height, on a deploy.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-gantt-name-rank-live.mjs [https://planyr.io] [expectedBuildPrefix]
 *
 * Signs in as the test account (ONE browser, ui-audit/lib/signedInSession.mjs), reads /version.json AND the served
 * /sequence/ page for a literal this change introduced ("<gantt-geom>") IN THE SAME CALL as the measurements, then
 * imports a THROWAWAY four-level schedule (a summary, a task and a milestone at every level + dependency links) at
 * row heights 20 / 24 / 34 — never a real plan; the import is local to this browser context (the cloud write is
 * refused for a fixture) and the last step proves nothing was stored on the account.
 *
 * Per row height, from the REAL computed font sizes off [data-gantt-name]: every name is drawn at its ranked size
 * (9.5 / 8.5 / 8.5 / 8), level 0 is strictly larger than level 1, a milestone name is never smaller than a task
 * name at its level, no name touches its bar / bracket / diamond, every dependency-arrow endpoint sits on a glyph
 * edge. Then buildGanttSVG on the SAME live page (the exhibit the PDF export prints): captions at their ranked
 * print sizes, level 0 larger than level 1. Known-good arms make a run VOID rather than green: the measured row
 * pitch must equal the requested row height, and arrows must exist. Saves screenshots under ui-audit/screens/. */
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
const RANKED = lv => [9.5, 8.5, 8.5, 8][Math.min(lv, 3)];
const RANKED_PRINT = lv => [9, 8.5, 8, 7.5][Math.min(lv, 3)];
const fixtureFor = rowH => ({ aPid: 1, nPid: 2, nTid: 1000, view: "split", section: "projects", settings: { rowHeight: rowH },
  projects: { 1: { id: 1, name: NAME, labelAlign: "center", tasks, colConfig: { visible: ["id","name","start","end","duration","predecessors","successors","health","status","responsibleParty","cost","notes"], widths: {} } } } });

const results = []; const ok = (n, c, x = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"} — ${n}${x ? " :: " + x : ""}`); };
const s = await openSignedIn({ base, viewport: { width: 1600, height: 900 } });
ok("signed in as the test account", /e2e@planyr\.test/.test(s.proof.email || ""), String(s.proof.email));
const page = await s.page.context().newPage(); await page.setViewportSize({ width: 1600, height: 900 });
const errs = []; page.on("pageerror", e => errs.push(String(e)));
page.on("dialog", d => d.accept());
await page.goto(base + "/sequence/?cb=" + Date.now(), { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-task-row]", { timeout: 40000 });
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
  return { build: v.build, hasGeom: html.includes("<gantt-geom>") && html.includes("GANTT_PROFILES"), runsGeom: typeof window.buildGanttSVG === "function" };
});
console.log("build", JSON.stringify(served));
ok("the deploy serves the new geometry block (literal this change introduced)", served.hasGeom);
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
  ok("ranks descend through every level (summary 0 > 1 >= 2)", fsOf(1) > fsOf(2) && fsOf(2) >= fsOf(3));
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

// ── cleanup proof: nothing from this check was stored on the test account ──
{
  const left = await s.page.evaluate(async (name) => {
    const out = {};
    for (const t of ["schedules"]) { const q = await window.pfSupabase.from(t).select("*").limit(200); out[t] = q.error ? "err:" + q.error.message : (q.data || []).filter(r => JSON.stringify(r).includes(name)).length; }
    return out; }, NAME);
  ok("cleanup: no stored schedule row from this check remains on the test account", left.schedules === 0, JSON.stringify(left));
}
await s.close();
console.log(results.filter(Boolean).length + "/" + results.length + " passed");
process.exit(results.every(Boolean) ? 0 : 1);
