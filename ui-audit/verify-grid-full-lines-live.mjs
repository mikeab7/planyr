/* B2160464 / V1575712 — live signed-in check that the Schedule grid draws one light full grid on a deploy.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-grid-full-lines-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * Signs in as the test account (ONE browser), reads /version.json IN THE SAME CALL as the assertions, imports a
 * throwaway fixture schedule into the grid (never a real plan; the import is local to this browser context — the
 * cloud write is refused for the fixture, so nothing is stored; step 7 proves that) and checks, from PAINTED pixels:
 *   1. plain / red / yellow / green / summary rows: the row line under ID, TASK, START, NOTES is one colour;
 *   2. a drag-selected range across TASK..DUR: range lines are single 1px (no doubled line at the shared edge);
 *   3. frozen ID/TASK while scrolled sideways: row lines stay, the frozen edge is not doubled;
 *   4. Split view's grid half carries the same lines; double-click a TASK cell -> the editor sits inside the cell;
 *   5. Gantt renders; the Spreadsheet route renders (the diff touched neither);
 *   7. cleanup: no fixture schedule row was written to the test account. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
const base = process.argv[2] || "https://planyr.io", want = process.argv[3] || "";
const task = o => ({ start: "2026-01-05", end: "2026-01-09", duration: 5, predecessors: [], health: "gray", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 5, predUnresolved: [], ...o });
const tasks = [task({ id: 1, name: "Summary" }), task({ id: 2, name: "Plain", parentId: 1 }), task({ id: 3, name: "Red", parentId: 1, health: "red" }), task({ id: 4, name: "Yellow", parentId: 1, health: "yellow" }), task({ id: 5, name: "Green", parentId: 1, health: "green" }), task({ id: 6, name: "Plain 2" })];
const NAME = "Grid Lines Live Check";
const fixture = { aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects", projects: { 1: { id: 1, name: NAME, tasks, colConfig: { visible: ["id","name","start","end","duration","predecessors","successors","health","status","responsibleParty","cost","notes"], widths: {} } } } };
const results = []; const ok = (n, c, x = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"} — ${n}${x ? " :: " + x : ""}`); };
const s = await openSignedIn({ base, viewport: { width: 1600, height: 800 } });
const page = await s.page.context().newPage(); await page.setViewportSize({ width: 1600, height: 800 });
const errs = []; page.on("pageerror", e => errs.push(String(e)));
page.on("dialog", d => d.accept());
await page.goto(base + "/sequence/", { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-task-row]", { timeout: 40000 });
await assertMeasurable(page, "verify-grid-full-lines-live");
await page.locator('[data-testid="open-history-desktop"]').click(); await pacedWait(page, 250);
await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
await pacedWait(page, 700); await page.locator('[data-testid="history-panel"] button:has-text("Close")').click(); await pacedWait(page, 1500);
await page.locator('.hdr-view button:has-text("Grid")').click(); await pacedWait(page, 800);
const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then(r => r.json()));  // same call as the assertions
console.log("signed in as", s.proof.email, "| build", JSON.stringify(build));
if (want) ok(`served build matches ${want}`, JSON.stringify(build).includes(want));

const px = (png, x, y) => { const i = (y * png.width + x) * png.channels; return `${png.data[i]},${png.data[i+1]},${png.data[i+2]}`; };
const shot = async () => decodePng(await page.screenshot());
const geo = () => page.evaluate(() => [...document.querySelectorAll("[data-task-row]")].slice(0, 6).map(r => {
  const rr = r.getBoundingClientRect(); const cell = k => { const c = r.querySelector(`[data-col-key="${k}"]`); if (!c) return null; const b = c.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: b.width, x: Math.round(b.left + b.width * 0.62) }; };
  return { bottom: Math.round(rr.bottom), mid: Math.round(rr.top + rr.height / 2), c: { id: cell("id"), name: cell("name"), start: cell("start"), duration: cell("duration"), notes: cell("notes") } }; }));
const LINE = "225,228,232", BD2 = "208,215,222";

// ── 1. row lines ────────────────────────────────────────────────────────────
async function rowLines(tag, keys) {
  const g = await geo(), png = await shot();
  ok(`${tag}: fixture rows rendered`, g.length === 6);
  g.forEach((r, n) => { const ref = px(png, r.c.start.x, r.bottom - 1);
    ok(`${tag}: row ${n + 1} line is the faint line colour`, ref === LINE, ref);
    for (const k of keys) if (r.c[k]) ok(`${tag}: row ${n + 1} line under ${k.toUpperCase()} equals START's`, px(png, r.c[k].x, r.bottom - 1) === ref, px(png, r.c[k].x, r.bottom - 1)); });
  return { g, png };
}
await rowLines("1 grid", ["id", "name", "notes"]);

// ── 2. range drag across TASK..DUR, rows 2..4 ───────────────────────────────
{
  const g = await geo();
  const pt = (row, k) => ({ x: g[row].c[k].x, y: g[row].mid });
  const a = pt(1, "name"), b = pt(3, "duration");
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 }); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  await pacedWait(page, 400);
  const png = await shot(), g2 = await geo();
  const lbl = await page.evaluate(() => [...document.querySelectorAll("div")].map(d => d.innerText).find(t => /^\d+ × \d+$/.test((t || "").trim())) || null);
  ok("2 range: the header shows the selection size", !!lbl, String(lbl));
  // TASK (col 2) .. DUR, rows 2..4 -> the row-2/row-3 boundary under TASK is a single range-blue line
  // sample a NON-anchor cell (the anchor, row 2 / TASK, wears the selected-cell outline on purpose): row 3 -> row 4 boundary
  const rr = g2[2];
  const y = rr.bottom - 1;
  ok("2 range: shared row edge under TASK is the range line", px(png, rr.c.name.x, y) === "147,197,253", px(png, rr.c.name.x, y));
  ok("2 range: the pixel above it is the range fill, not a second line", px(png, rr.c.name.x, y - 1) !== "147,197,253" && px(png, rr.c.name.x, y - 1) !== LINE, px(png, rr.c.name.x, y - 1));
  ok("2 range: the first pixel of the next row is fill, not a stacked line", px(png, rr.c.name.x, rr.bottom) !== "147,197,253" && px(png, rr.c.name.x, rr.bottom) !== LINE, px(png, rr.c.name.x, rr.bottom));
  const xr = rr.c.name.r - 1, my = rr.mid;
  ok("2 range: shared column edge TASK|START is one range line", px(png, xr, my) === "147,197,253", px(png, xr, my));
  ok("2 range: no second line one pixel inside it", px(png, xr - 1, my) !== "147,197,253" && px(png, xr - 1, my) !== LINE, px(png, xr - 1, my));
  await page.mouse.click(g2[5].c.start.x, g2[5].mid); await pacedWait(page, 300);   // deselect via START (a NOTES click would open the notes dialog)
}

// ── 3. frozen ID/TASK while scrolled sideways (narrow window forces overflow) ──
{
  await page.setViewportSize({ width: 1000, height: 800 }); await pacedWait(page, 600);
  await page.evaluate(() => { const gr = document.querySelector('[data-grid-scroll="1"]'); gr.scrollLeft = 380; });
  await pacedWait(page, 500);
  const sl = await page.evaluate(() => document.querySelector('[data-grid-scroll="1"]').scrollLeft);
  ok("3 frozen: the grid really scrolled sideways (vacuity guard)", sl > 100, "scrollLeft=" + sl);
  const g = await geo(), png = await shot();
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/live-frozen.png" });
  g.forEach((r, n) => {
    const ref = px(png, r.c.start ? Math.min(r.c.start.x, 990) : 600, r.bottom - 1);
    ok(`3 frozen: row ${n + 1} line under pinned ID is the line colour`, px(png, r.c.id.x, r.bottom - 1) === LINE, px(png, r.c.id.x, r.bottom - 1));
    ok(`3 frozen: row ${n + 1} line under pinned TASK is the line colour`, px(png, r.c.name.x, r.bottom - 1) === LINE, px(png, r.c.name.x, r.bottom - 1));
  });
  const r0 = g[1]; const edge = r0.c.name.r - 1, my = r0.mid;
  const e = px(png, edge, my), inner = px(png, edge - 2, my);
  ok("3 frozen: the frozen edge is drawn (line or its scroll shadow), not blank", e === LINE || e === BD2, e);
  ok("3 frozen: the frozen edge is not doubled", inner !== LINE && inner !== BD2, inner);
  await page.setViewportSize({ width: 1600, height: 800 }); await pacedWait(page, 500);
  await page.evaluate(() => { document.querySelector('[data-grid-scroll="1"]').scrollLeft = 0; }); await pacedWait(page, 300);
}

// ── 4. Split view + edit a TASK cell ────────────────────────────────────────
{
  await page.locator('.hdr-view button:has-text("Split")').click(); await pacedWait(page, 900);
  await page.waitForSelector('[data-grid-scroll="1"] [data-task-row]');
  const g = await geo(), png = await shot();
  ok("4 split: grid half rendered rows", g.length === 6);
  g.forEach((r, n) => ok(`4 split: row ${n + 1} line under ID/TASK equals the START/other line`, px(png, r.c.id.x, r.bottom - 1) === LINE && px(png, r.c.name.x, r.bottom - 1) === LINE, `${px(png, r.c.id.x, r.bottom - 1)} / ${px(png, r.c.name.x, r.bottom - 1)}`));
  const t = g[1].c.name; await page.mouse.dblclick(t.x, g[1].mid); await pacedWait(page, 500);
  const ed = await page.evaluate(() => { const i = document.querySelector('[data-task-row] input.ei'); if (!i) return null; const ib = i.getBoundingClientRect(), cb = i.closest("[data-col-key]").getBoundingClientRect(); return { colKey: i.closest("[data-col-key]").getAttribute("data-col-key"), inside: ib.left >= cb.left - 0.5 && ib.right <= cb.right + 0.5 && ib.bottom <= cb.bottom + 0.5 && ib.top >= cb.top - 0.5, val: i.value }; });
  ok("4 edit: double-click a TASK cell opens the editor in the TASK cell", !!ed && ed.colKey === "name", JSON.stringify(ed));
  ok("4 edit: the editor sits inside the cell's own lines", !!ed && ed.inside, JSON.stringify(ed));
  const png2 = await shot(); const gg = await geo();
  ok("4 edit: the cell's bottom line is intact while editing", px(png2, gg[1].c.name.x, gg[1].bottom - 1) === LINE, px(png2, gg[1].c.name.x, gg[1].bottom - 1));
  await page.keyboard.press("Escape"); await pacedWait(page, 400);
  const after = await page.evaluate(() => ({ editing: !!document.querySelector('[data-task-row] input.ei'), names: [...document.querySelectorAll('[data-task-row] [data-col-key="name"]')].map(c => c.innerText.trim()).slice(0, 6) }));
  ok("4 edit: Escape closes the editor and keeps the name", !after.editing && after.names[1] === "Plain", JSON.stringify(after));
}

// ── 5. Gantt renders; Spreadsheet route renders ─────────────────────────────
{
  await page.locator('.hdr-view button:has-text("Gantt")').click(); await pacedWait(page, 1200);
  const gantt = await page.evaluate(() => ({ svg: document.querySelectorAll("svg").length, rows: document.querySelectorAll("[data-task-row]").length, text: document.body.innerText.includes("Plain") }));
  ok("5 gantt: the Gantt rendered with the fixture tasks", gantt.text, JSON.stringify(gantt));
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + "/live-gantt.png" });
}
ok("no page errors on the schedule page", errs.length === 0, errs.slice(0, 2).join(" | "));
await page.close();
{
  const sp = await s.page.context().newPage(); await sp.setViewportSize({ width: 1440, height: 900 });
  const e2 = []; sp.on("pageerror", e => e2.push(String(e)));
  await sp.goto(base + "/#/project/e2e-fixture-site/spreadsheet", { waitUntil: "domcontentloaded" });
  await sp.waitForSelector("header", { timeout: 40000 }); await pacedWait(sp, 2500);
  const st = await sp.evaluate(() => ({ hash: location.hash, tabs: [...document.querySelectorAll("header [role=tab], header a, header button")].map(x => x.innerText.trim()).filter(Boolean).slice(0, 12), body: document.body.innerText.length }));
  ok("5 spreadsheet: the Spreadsheet route rendered (header + content)", st.hash.includes("spreadsheet") && st.body > 100, JSON.stringify(st).slice(0, 200));
  ok("5 spreadsheet: no page errors", e2.length === 0, e2.slice(0, 2).join(" | "));
  if (process.env.SHOT_DIR) await sp.screenshot({ path: process.env.SHOT_DIR + "/live-spreadsheet.png" });
  await sp.close();
}
// ── 7. cleanup proof: nothing from this check was stored on the test account ──
{
  const left = await s.page.evaluate(async (name) => {
    const out = {};
    for (const t of ["schedules"]) { const q = await window.pfSupabase.from(t).select("*").limit(200); out[t] = q.error ? "err:" + q.error.message : (q.data || []).filter(r => JSON.stringify(r).includes(name)).length; }
    return out; }, NAME);
  ok("7 cleanup: no stored schedule row from this check remains on the test account", left.schedules === 0, JSON.stringify(left));
}
await s.close();
console.log(results.filter(Boolean).length + "/" + results.length + " passed");
process.exit(results.every(Boolean) ? 0 : 1);
