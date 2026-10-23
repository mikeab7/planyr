/* B2445008 / V1888512 — drag rows onto the CENTRE of a childless task to nest them, on a real deploy, signed in as
 * the test account, in a THROWAWAY cloud schedule that is deleted afterwards (constraints 7 / 15).
 *   E2E_LOGIN_KEY=… node ui-audit/verify-schedule-row-nest-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * Shape = the owner's report (Grand Port › Master Schedule): a 7-row mixed-depth range (two rows under "Plan B" plus
 * siblings of "Plan B", one a collapsed parent with hidden children) dragged by the real mouse onto the childless "Plan A".
 * Asserts: the nest box shows mid-drag; the drop nests; the CLOUD row (read back through the app's own Supabase client)
 * holds the new parents with links intact; a cache-busted reload still shows it; ONE Ctrl+Z undoes it (and the cloud
 * follows); a drop on a dragged parent's own descendant is refused. /version.json is read in the SAME call as every
 * assertion that matters. Real mouse + real keys only (SYNTHETIC-KEYS-DONT-EDIT). Known-good arm: the untouched
 * fixture's structure before the drag — the run is VOID if it is not as seeded. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io", want = process.argv[3] || "";
const NAME = "Row Nest Live Check (throwaway)";
const task = o => ({ start: "2026-01-05", end: "2026-01-05", duration: 1, predecessors: [], health: "yellow", percentComplete: 0, parentId: null,
  responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 1, predUnresolved: [], ...o });
const FIXTURE = { aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects", projects: { 1: { id: 1, name: NAME, tasks: [
  task({ id: 1, name: "Pipeline Coordination" }),
  task({ id: 2, name: "Plan B", parentId: 1 }),
  task({ id: 3, name: "Easement Acquisition", parentId: 2, start: "2026-01-05", end: "2026-01-06", duration: 2, durValue: 2 }),
  task({ id: 4, name: "Design", parentId: 2, start: "2026-01-07", end: "2026-01-07" }),
  task({ id: 5, name: "Surveying", parentId: 1, start: "2026-01-08", end: "2026-01-08" }),
  task({ id: 6, name: "Kinder Morgan", parentId: 1, start: "2026-01-09", end: "2026-01-09", predecessors: [{ id: 5, type: "FS", lag: 0 }] }),
  task({ id: 7, name: "Enterprise", parentId: 1, isExpanded: false, start: "2026-01-12", end: "2026-01-13", duration: 2 }),
  task({ id: 8, name: "Enterprise Fab", parentId: 7, start: "2026-01-12", end: "2026-01-12" }),
  task({ id: 9, name: "Enterprise Install", parentId: 7, start: "2026-01-13", end: "2026-01-13" }),
  task({ id: 10, name: "Exxon", parentId: 1, start: "2026-01-14", end: "2026-01-14" }),
  task({ id: 11, name: "Air Liquide", parentId: 1, start: "2026-01-15", end: "2026-01-15", predecessors: [{ id: 10, type: "FS", lag: 0 }] }),
  task({ id: 12, name: "Plan A", start: "2026-02-02", end: "2026-02-02", duration: 0, durValue: 0 }),
]}}};
const KIDS = ["Easement Acquisition", "Design", "Surveying", "Kinder Morgan", "Enterprise", "Exxon", "Air Liquide"];
const ORIGINAL_PARENT = { "Plan B": "Pipeline Coordination", "Easement Acquisition": "Plan B", "Design": "Plan B", "Surveying": "Pipeline Coordination",
  "Kinder Morgan": "Pipeline Coordination", "Enterprise": "Pipeline Coordination", "Enterprise Fab": "Enterprise", "Enterprise Install": "Enterprise",
  "Exxon": "Pipeline Coordination", "Air Liquide": "Pipeline Coordination", "Plan A": null, "Pipeline Coordination": null };

const results = [];
const ok = (n, c, x = "") => { results.push({ n, c: !!c }); console.log(`${c ? "PASS" : "FAIL"} — ${n}${x ? " :: " + x : ""}`); };

const rows = page => page.evaluate(async () => {
  const build = await fetch("/version.json", { cache: "no-store" }).then(r => r.json()).catch(e => ({ error: String(e) }));
  return { build: build.build || JSON.stringify(build), rows: [...document.querySelectorAll("[data-task-row]")].map(r => ({
    id: Number(r.getAttribute("data-task-row")),
    name: ([...r.querySelectorAll('[data-col-key="name"] span[title]')].map(e => e.getAttribute("title")).find(t => !/^(Collapse|Expand|Focus: hide|Show all tasks)/.test(t)) || "").trim(),
    pad: parseFloat(getComputedStyle(r.querySelector('[data-col-key="name"] > span') || r).paddingLeft) || 0,
  })) };
});
const levelsOf = async page => Object.fromEntries((await rows(page)).rows.map(r => [r.name, Math.round((r.pad - 4) / 14)]));
const idOf = async (page, name) => (await rows(page)).rows.find(r => r.name === name)?.id;

const s = await openSignedIn({ base, viewport: { width: 1600, height: 950 } });
console.log("signed in as", s.proof.email, "| fixture site visible", s.proof.fixtureVisible);
ok("signed in as the test account (known-good arm)", s.proof.email === "e2e@planyr.test", s.proof.email);
const liveIds = () => s.page.evaluate(async () => { const q = await window.pfSupabase.from("schedules").select("id").is("deleted_at", null); if (q.error) throw new Error(q.error.message); return q.data.map(r => r.id); });
const before = new Set(await liveIds());
const errs = [];

/* The cloud row, read back through the app's own Supabase client: name → parent name, plus Kinder Morgan's / Air
 * Liquide's predecessor resolved to NAMES (ids are renumbered by every structural save). */
const cloudShape = (id) => s.page.evaluate(async (id) => {
  const q = await window.pfSupabase.from("schedules").select("rev,data").eq("id", id).single();
  if (q.error) return { error: q.error.message };
  const tasks = (q.data.data && q.data.data.tasks) || [], byId = new Map(tasks.map(t => [t.id, t]));
  return { rev: q.data.rev, parent: Object.fromEntries(tasks.map(t => [t.name, t.parentId == null ? null : (byId.get(t.parentId) || {}).name || "?"])),
    preds: Object.fromEntries(tasks.filter(t => (t.predecessors || []).length).map(t => [t.name, t.predecessors.map(p => (byId.get(p.id) || {}).name || "?")])),
    order: tasks.map(t => t.name) };
}, id);
const sameParents = (a, b) => Object.keys(b).every(k => a[k] === b[k]);

let rowId = null;
async function seedCloudSchedule() {
  let ids = (await liveIds()).filter(i => !before.has(i));
  if (!ids.length) {
    const p = await s.page.context().newPage(); await p.setViewportSize({ width: 1600, height: 950 });
    await p.goto(base + "/sequence/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForSelector('[data-testid="open-history-desktop"], button:has-text("New schedule")', { timeout: 40000 });
    if (!(await p.locator('[data-testid="open-history-desktop"]').count())) { await p.getByRole("button", { name: "New schedule" }).click(); await pacedWait(p, 3000); }
    await pacedWait(p, 3000); await p.close();
    ids = (await liveIds()).filter(i => !before.has(i));
  }
  if (ids.length !== 1) throw new Error("expected exactly one throwaway schedule row, found " + JSON.stringify(ids));
  const id = ids[0];
  const err = await s.page.evaluate(async ({ id, fx }) => {
    const r = await window.pfSupabase.from("schedules").select("rev").eq("id", id).single();
    if (r.error) return r.error.message;
    const u = await window.pfSupabase.from("schedules").update({ name: fx.name, data: { ...fx, id }, rev: (r.data.rev || 0) + 1 }).eq("id", id).select("id");
    return u.error ? u.error.message : (u.data && u.data.length ? null : "update matched no row");
  }, { id, fx: FIXTURE.projects[1] });
  if (err) throw new Error("could not seed the throwaway row " + id + ": " + err);
  return id;
}

async function boot(page, url) {
  page.on("pageerror", e => errs.push(String(e)));
  page.on("dialog", d => d.accept());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 }); await pacedWait(page, 1800);
  await assertMeasurable(page, "verify-schedule-row-nest-live");
}
async function selectRange(page, top, bottom) {
  const t = await page.locator(`[data-task-row="${await idOf(page, top)}"] [data-col-key="id"]`).boundingBox();
  const b = await page.locator(`[data-task-row="${await idOf(page, bottom)}"] [data-col-key="id"]`).boundingBox();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 }); await page.mouse.up(); await pacedWait(page, 200);
}
async function holdDrag(page, fromName, toName, frac) {
  const grip = await page.locator(`[data-row-drag-handle="${await idOf(page, fromName)}"]`).boundingBox();
  const target = await page.locator(`[data-task-row="${await idOf(page, toName)}"]`).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down(); await pacedWait(page, 80);
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 }); await pacedWait(page, 150);
  await page.mouse.move(target.x + target.width / 2, target.y + target.height * frac, { steps: 3 }); await pacedWait(page, 250);
  return target;
}
const nestBox = page => page.evaluate(() => {
  const n = document.querySelector("[data-drag-nest]"), l = document.querySelector("[data-drag-insert-line]");
  const vis = e => !!e && getComputedStyle(e).display !== "none";
  return { nestVisible: vis(n), kind: n && n.getAttribute("data-drag-nest-kind"), lineVisible: vis(l), chip: n && n.firstChild && n.firstChild.textContent };
});
const toast = page => page.evaluate(() => (document.querySelector('[data-testid="schedule-toast-text"]') || {}).textContent || "");

async function waitCloud(pred, tries = 30) {
  let c = null;
  for (let k = 0; k < tries; k++) { await pacedWait(s.page, 1000); c = await cloudShape(rowId); if (!c.error && pred(c)) return c; }
  return c;
}

try {
  rowId = await seedCloudSchedule();
  const page = await s.page.context().newPage(); await page.setViewportSize({ width: 1600, height: 950 });
  await boot(page, base + "/sequence/");
  const b0 = await rows(page);
  console.log(`build ${b0.build}`);
  if (want) ok(`served build matches ${want}`, String(b0.build).startsWith(want.slice(0, 7)), b0.build);
  const c0 = await cloudShape(rowId);
  ok("[known-good] the seeded cloud row has the fixture's structure before any drag", !c0.error && sameParents(c0.parent, ORIGINAL_PARENT), JSON.stringify(c0.parent || c0));
  const lv0 = await levelsOf(page);
  ok("[known-good] on screen: Plan A is a childless top-level row and Plan B has its two children", lv0["Plan A"] === 0 && lv0["Easement Acquisition"] === 2 && lv0["Design"] === 2 && lv0["Enterprise Fab"] === undefined, JSON.stringify(lv0));

  // 1. the reported drag
  await selectRange(page, "Easement Acquisition", "Air Liquide");
  const target = await holdDrag(page, "Surveying", "Plan A", 0.5);
  const box = await nestBox(page);
  ok(`mid-drag: the centre of childless Plan A shows the "Nest inside" box and not the insertion line (build ${(await rows(page)).build})`, box.nestVisible && box.kind === "into" && !box.lineVisible && box.chip === "Nest inside", JSON.stringify(box));
  await page.mouse.move(target.x + target.width / 2, target.y + 1.5, { steps: 3 }); await pacedWait(page, 250);
  const top = await nestBox(page);
  ok("mid-drag: the top edge of the same row switches to the insertion line", top.lineVisible && !top.nestVisible, JSON.stringify(top));
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 3 }); await pacedWait(page, 250);
  await page.mouse.up(); await pacedWait(page, 800);
  const after = await rows(page), lv1 = await levelsOf(page);
  ok(`drop: all 7 range rows are now level-1 children of Plan A, in order (build ${after.build})`,
    KIDS.every(k => lv1[k] === 1) && lv1["Plan A"] === 0 && after.rows.map(r => r.name).join("|").includes(KIDS.join("|")), JSON.stringify(lv1));
  ok("drop: Plan B is childless again; Pipeline Coordination untouched at the top", lv1["Pipeline Coordination"] === 0 && lv1["Plan B"] === 1 && !("Easement Acquisition" in lv1 && lv1["Easement Acquisition"] === 2));
  ok("drop: a toast said Plan A became a summary row", /Plan A.*summary row/.test(await toast(page)), await toast(page));

  // 2. the cloud holds it
  const NEWPARENT = { ...ORIGINAL_PARENT, ...Object.fromEntries(KIDS.map(k => [k, "Plan A"])), "Plan B": "Pipeline Coordination" };
  const c1 = await waitCloud(c => c.parent["Surveying"] === "Plan A");
  console.log("[cloud after drop]", JSON.stringify(c1));
  ok("cloud: every moved row's parent is Plan A; hidden Enterprise children stayed under Enterprise; Plan B/Pipeline unchanged", !c1.error && sameParents(c1.parent, NEWPARENT), JSON.stringify(c1.parent));
  ok("cloud: predecessor links survived the move (Kinder Morgan ← Surveying, Air Liquide ← Exxon)", JSON.stringify(c1.preds["Kinder Morgan"]) === '["Surveying"]' && JSON.stringify(c1.preds["Air Liquide"]) === '["Exxon"]', JSON.stringify(c1.preds));
  ok("cloud: the 7 rows sit in order directly under Plan A in the saved array", (() => { const i = c1.order.indexOf("Plan A"); const seq = c1.order.slice(i + 1).filter(n => KIDS.includes(n)); return seq.join("|") === KIDS.join("|"); })(), c1.order.join(" | "));

  // 3. one Ctrl+Z undoes the whole move (same session — a reloaded page has no undo history) and the cloud follows
  await page.locator(`[data-task-row="${await idOf(page, "Plan A")}"] [data-col-key="id"]`).click(); await pacedWait(page, 200);
  await page.keyboard.press("Control+z"); await pacedWait(page, 800);
  const lv4 = await levelsOf(page);
  ok("undo: ONE Ctrl+Z puts all 7 rows back where they were (Plan A childless again)", lv4["Easement Acquisition"] === 2 && lv4["Design"] === 2 && lv4["Surveying"] === 1 && lv4["Plan A"] === 0 && !KIDS.every(k => lv4[k] === 1), JSON.stringify(lv4));
  const c2 = await waitCloud(c => c.parent["Surveying"] === "Pipeline Coordination");
  ok("undo: the cloud row follows", !c2.error && sameParents(c2.parent, ORIGINAL_PARENT), JSON.stringify(c2.parent || c2));

  // 4. drop it again, then a cache-busted reload shows it persisted
  await selectRange(page, "Easement Acquisition", "Air Liquide");
  await holdDrag(page, "Surveying", "Plan A", 0.5);
  await page.mouse.up(); await pacedWait(page, 800);
  const c3 = await waitCloud(c => c.parent["Surveying"] === "Plan A");
  ok("re-drop: the cloud row holds the nest again", !c3.error && sameParents(c3.parent, NEWPARENT), JSON.stringify(c3.parent || c3));
  await page.goto(base + "/sequence/?cb=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 }); await pacedWait(page, 2500);
  const rl = await rows(page), lv2 = await levelsOf(page);
  ok(`reload (cache-busted): the nest is still there (build ${rl.build})`, KIDS.every(k => lv2[k] === 1) && lv2["Plan A"] === 0, JSON.stringify(lv2));
  const entId = await idOf(page, "Enterprise");
  await page.locator(`[data-task-row="${entId}"] [title^="Expand"]`).first().click(); await pacedWait(page, 500);
  const lv3 = await levelsOf(page);
  ok("reload: expanding Enterprise shows its two hidden children still beneath it", lv3["Enterprise Fab"] === 2 && lv3["Enterprise Install"] === 2, JSON.stringify({ f: lv3["Enterprise Fab"], i: lv3["Enterprise Install"] }));
  await page.locator(`[data-task-row="${entId}"] [title^="Collapse"]`).first().click(); await pacedWait(page, 300);
  // put Plan B back as the parent of Easement/Design for the blocked check: undo is gone after reload, so re-seed via the cloud row
  await page.close();
  const p2 = await s.page.context().newPage(); await p2.setViewportSize({ width: 1600, height: 950 });
  await s.page.evaluate(async ({ id, fx }) => { const r = await window.pfSupabase.from("schedules").select("rev").eq("id", id).single();
    await window.pfSupabase.from("schedules").update({ data: { ...fx, id }, rev: (r.data.rev || 0) + 1 }).eq("id", id); }, { id: rowId, fx: FIXTURE.projects[1] });
  await boot(p2, base + "/sequence/?cb=" + Date.now());

  // 5. refused: a parent onto its own descendant
  const beforeBlocked = JSON.stringify(await levelsOf(p2));
  await holdDrag(p2, "Plan B", "Design", 0.5);
  const blocked = await nestBox(p2);
  ok("blocked: the centre of a row inside the dragged parent shows the red 'Not allowed' box", blocked.nestVisible && blocked.kind === "blocked" && blocked.chip === "Not allowed", JSON.stringify(blocked));
  await p2.mouse.up(); await pacedWait(p2, 600);
  ok("blocked: releasing there changes nothing and says why", JSON.stringify(await levelsOf(p2)) === beforeBlocked && /into itself/.test(await toast(p2)), await toast(p2));

  ok("no page errors on the schedule page", errs.length === 0, errs.slice(0, 2).join(" | "));
  await p2.close();
} catch (e) { ok("run completed without throwing", false, e.stack || e.message); }
finally {
  // Cleanup (constraint #15): soft-delete every schedule row this run created, then prove none remains live.
  await pacedWait(s.page, 2000);
  const created = (await liveIds()).filter(i => !before.has(i));
  const err = await s.page.evaluate(async (ids) => {
    for (const i of ids) { const u = await window.pfSupabase.from("schedules").update({ deleted_at: new Date().toISOString() }).eq("id", i); if (u.error) return u.error.message; }
    return null; }, created);
  const left = (await liveIds()).filter(i => !before.has(i));
  ok(`cleanup: the ${created.length} throwaway schedule row(s) this run created are deleted and none remains live`, !err && left.length === 0, JSON.stringify({ created, err, left }));
  await s.close();
}
const known = results.filter(r => r.n.startsWith("[known-good]") && !r.c);
if (known.length) { console.log("VOID — a known-good arm failed, so this instrument cannot vouch for the rest."); process.exit(1); }
console.log(results.filter(r => r.c).length + "/" + results.length + " passed");
process.exit(results.every(r => r.c) ? 0 : 1);
