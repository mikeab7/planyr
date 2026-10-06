/* B2132257 / V1568032 — live signed-in check of the Predecessor/Successor line mode on a deploy.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-dep-cell-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * Signs in as the test account, reads /version.json IN THE SAME CALL as the assertions, imports a throwaway
 * fixture schedule into the Schedule grid, and asserts the width->mode rule (>=126 two lines, <110 one line). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";
const base = process.argv[2] || "https://planyr.io", want = process.argv[3] || "";
const task = o => ({ start: "2026-01-01", end: "2026-01-01", duration: 1, predecessors: [], health: "gray", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 1, predUnresolved: [], ...o });
const names = ["Find and send Wire Receipt to MUD", "Baytown to provide response", "Submit the Phase 2 environmental report to the county", "Review and approve geotechnical findings with civil engineer"];
const tasks = []; for (let i = 1; i <= 30; i++) tasks.push(task({ id: i, name: names[i % 4] + ` (${i})`, predecessors: i === 5 ? [2, 3, 4].map(id => ({ id, type: "FS", lag: 0 })) : i > 1 ? [{ id: i - 1, type: "FS", lag: 0 }] : [] }));
const fixture = widths => ({ aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects", projects: { 1: { id: 1, name: "DepCell Live Check", tasks, colConfig: { visible: ["id","name","start","end","duration","predecessors","successors","health"], widths } } } });
const results = []; const ok = (n, c, x = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"} — ${n}${x ? " :: " + x : ""}`); };
const s = await openSignedIn({ base, viewport: { width: 1440, height: 900 } });
const ctx = s.page.context();
console.log("signed in as", s.proof.email, "fixture visible", s.proof.fixtureVisible, "| build", JSON.stringify(s.build));
if (want) ok(`served build matches ${want}`, JSON.stringify(s.build).includes(want));
for (const [label, widths, expect] of [["default 148", {}, "2"], ["resized wide 260", { predecessors: 260, successors: 260 }, "2"], ["resized narrow 96", { predecessors: 96, successors: 96 }, "1"]]) {
  const page = await ctx.newPage(); await page.setViewportSize({ width: 1440, height: 900 });
  page.on("dialog", d => d.accept());
  await page.goto(base + "/sequence/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-dep-cell-live");
  await page.locator('[data-testid="open-history-desktop"]').click(); await pacedWait(page, 250);
  await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture(widths))) });
  await pacedWait(page, 700); await page.locator('[data-testid="history-panel"] button:has-text("Close")').click(); await pacedWait(page, 1500);
  await page.locator('.hdr-view button:has-text("Grid")').click(); await pacedWait(page, 600);
  const m = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-task-row]")];
    const dep = []; for (const r of rows) for (const k of ["predecessors", "successors"]) { const c = r.querySelector(`[data-col-key="${k}"]`); const root = c && (c.matches("[data-dep-lines]") ? c : c.querySelector("[data-dep-lines]")); if (root) dep.push({ k, w: Math.round(c.getBoundingClientRect().width), lines: root.getAttribute("data-dep-lines"), text: root.innerText.trim().replace(/\s+/g, " "), h: c.getBoundingClientRect().height }); }
    return { heights: [...new Set(rows.map(r => Math.round(r.getBoundingClientRect().height)))], dep, build: [...document.querySelectorAll("script[src]")].map(x => x.src.split("/").pop()).slice(0, 2) };
  });
  ok(`${label}: ${m.dep.length} dep cells rendered`, m.dep.length > 20);
  ok(`${label}: every Pred/Succ cell reports ${expect} line(s) (widths ${[...new Set(m.dep.map(d => d.w))]})`, m.dep.every(d => d.lines === expect), JSON.stringify(m.dep.filter(d => d.lines !== expect).slice(0, 2)));
  ok(`${label}: every row one height`, m.heights.length === 1, JSON.stringify(m.heights));
  if (expect === "1") { const t = m.dep.find(d => d.k === "predecessors" && /\+2/.test(d.text)); ok(`${label}: three predecessors -> first + "+2"`, !!t, t && t.text); }
  await page.close();
}
await s.close();
process.exit(results.every(Boolean) ? 0 : 1);
