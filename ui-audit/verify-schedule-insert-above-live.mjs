/* B2428272 / V1861216 — Insert adds the row directly above the selection WITHOUT opening Focus-hidden rows,
 * on a real deploy, signed in as the test account, in a THROWAWAY schedule that is deleted afterwards.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-schedule-insert-above-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * Mirrors verify-schedule-insert-above.mjs (the signed-out local harness) and adds: /version.json read IN THE
 * SAME CALL as every scenario's assertions, a reload step (the inserted row must survive and the finished
 * rows must stay hidden), and a cleanup that soft-deletes every schedule row this run created (the way the
 * app deletes one) and proves none remains live. Real keys only (SYNTHETIC-KEYS-DONT-EDIT). Known-good arm:
 * the "before" state of each scenario (finished rows hidden behind Focus) — the run is VOID if it is not. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io", want = process.argv[3] || "";
const NAME = "Insert Above Live Check (throwaway)";
const task = o => ({ start: "2026-01-05", end: "2026-01-05", duration: 1, predecessors: [], health: "yellow", percentComplete: 0, parentId: null,
  responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 1, predUnresolved: [], ...o });
const FIXTURE = { aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects", projects: { 1: { id: 1, name: NAME, tasks: [
  task({ id: 1, name: "Kickoff" }),
  task({ id: 2, name: "Baytown Platting" }),
  task({ id: 3, name: "Baytown Approval", parentId: 2 }),
  task({ id: 4, name: "P&Z Consideration & Approval", parentId: 2 }),
  ...[5, 6, 7, 8, 9].map(i => task({ id: i, name: "Done step " + i, parentId: 2, health: "green" })),
  task({ id: 10, name: "TIA" }),
  task({ id: 11, name: "TIA scoping", parentId: 10 }),
  ...[12, 13, 14].map(i => task({ id: i, name: "TIA done " + i, parentId: 10, health: "green" })),
  task({ id: 15, name: "Closing" }),
]}}};
const NAMES = ["Kickoff", "Baytown Platting", "Baytown Approval", "P&Z Consideration & Approval", "TIA", "TIA scoping", "Closing"];

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
const idOf = async (page, name) => (await rows(page)).rows.find(r => r.name === name)?.id;

const s = await openSignedIn({ base, viewport: { width: 1600, height: 950 } });
console.log("signed in as", s.proof.email, "| fixture site visible", s.proof.fixtureVisible);
ok("signed in as the test account (known-good arm)", s.proof.email === "e2e@planyr.test", s.proof.email);
const liveIds = () => s.page.evaluate(async () => { const q = await window.pfSupabase.from("schedules").select("id").is("deleted_at", null); if (q.error) throw new Error(q.error.message); return q.data.map(r => r.id); });
const before = new Set(await liveIds());
const errs = [];
let scheduleUrl = null;

/* A REAL cloud schedule (an imported fixture is local-only and would not survive a reload): press "New schedule" the
 * way a person does when the account has none, then overwrite that throwaway row's data with the fixture project
 * (a guarded rev+1 UPDATE as the test account) so the app loads it from the cloud on the next page load. */
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
    const proj = { ...fx, id };
    const u = await window.pfSupabase.from("schedules").update({ name: fx.name, data: proj, rev: (r.data.rev || 0) + 1 }).eq("id", id).select("id");
    return u.error ? u.error.message : (u.data && u.data.length ? null : "update matched no row");
  }, { id, fx: FIXTURE.projects[1] });
  if (err) throw new Error("could not seed the throwaway row " + id + ": " + err);
  return id;
}

async function boot(page, fresh) {
  page.on("pageerror", e => errs.push(String(e)));
  page.on("dialog", d => d.accept());
  if (fresh) await seedCloudSchedule();
  await page.goto(base + "/sequence/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 }); await pacedWait(page, 1500);
  await assertMeasurable(page, "verify-schedule-insert-above-live");
  if (fresh) {
    for (const g of ["Baytown Platting", "TIA"]) {
      const id = await idOf(page, g);
      const btn = page.locator(`[data-task-row="${id}"] [title^="Focus: hide"]`);   // Focus is remembered per device: skip a group already focused
      if (await btn.count()) { await btn.click(); await pacedWait(page, 250); }
    }
  }
}

async function scenario(label, act, { reload = false } = {}) {
  const page = await s.page.context().newPage(); await page.setViewportSize({ width: 1600, height: 950 });
  await boot(page, true);
  const b = await rows(page);
  console.log(`[${label}] build ${b.build}`);
  if (want) ok(`${label}: served build matches ${want}`, String(b.build).startsWith(want.slice(0, 7)), b.build);
  ok(`[known-good] ${label}: precondition — finished rows hidden behind Focus`, b.rows.map(r => r.name).join("|") === NAMES.join("|"), b.rows.map(r => r.name).join(" | "));
  await act(page); await pacedWait(page, 500);
  const a = await rows(page); const names = a.rows.map(r => r.name); const iNew = names.indexOf("");
  ok(`${label}: new row directly below P&Z, directly above TIA (build ${a.build})`, iNew > 0 && names[iNew - 1] === "P&Z Consideration & Approval" && names[iNew + 1] === "TIA", names.join(" | "));
  ok(`${label}: nothing hidden was opened`, a.rows.length === b.rows.length + 1 && !names.some(n => /^Done step|^TIA done/.test(n)));
  const pz = a.rows.find(r => r.name === "P&Z Consideration & Approval");
  ok(`${label}: same indent as P&Z (child of Baytown Platting)`, iNew > 0 && Math.abs(a.rows[iNew].pad - pz.pad) < 0.5, `${a.rows[iNew]?.pad} vs ${pz.pad}`);
  await page.keyboard.type("Inserted row"); await page.keyboard.press("Enter"); await pacedWait(page, 400);
  const typed = (await rows(page)).rows.map(r => r.name);
  ok(`${label}: new row is selected — typing names it`, typed[iNew] === "Inserted row", typed.join(" | "));
  await page.keyboard.press("Escape");
  for (let k = 0; k < 2; k++) { await page.keyboard.press("Control+z"); await pacedWait(page, 500); }
  const undone = (await rows(page)).rows.map(r => r.name);
  ok(`${label}: undo (twice) puts the grid back exactly`, undone.join("|") === NAMES.join("|"), undone.join(" | "));
  if (reload) {   // Insert once more, name it, reload: still in place, finished rows still hidden
    const id = await idOf(page, "TIA");
    await page.locator(`[data-task-row="${id}"] [data-col-key="id"]`).click(); await pacedWait(page, 150);
    await page.keyboard.press("Insert"); await pacedWait(page, 400);
    await page.keyboard.type("Persisted row"); await page.keyboard.press("Enter"); await pacedWait(page, 400);
    await page.keyboard.press("Escape");
    // Wait for the cloud row itself to hold the new task (a reload before the autosave lands proves nothing).
    let cloud = [];
    for (let k = 0; k < 30; k++) {
      await pacedWait(page, 1000);
      cloud = await s.page.evaluate(async () => { const q = await window.pfSupabase.from("schedules").select("id,rev,data").is("deleted_at", null); return (q.data || []).map(r => ({ id: r.id, rev: r.rev, tasks: ((r.data && r.data.tasks) || []).map(t => t.name), parents: ((r.data && r.data.tasks) || []).map(t => t.parentId) })); });
      if (cloud.some(r => r.tasks.includes("Persisted row"))) break;
    }
    console.log(`[${label}/cloud] ${JSON.stringify(cloud.map(r => ({ id: r.id, rev: r.rev, n: r.tasks.length, has: r.tasks.includes("Persisted row"), tasks: r.tasks })))}`);
    ok(`${label}/cloud: the inserted row reached the cloud row`, cloud.some(r => r.tasks.includes("Persisted row")));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-task-row]", { timeout: 40000 }); await pacedWait(page, 2500);
    const r = await rows(page); const rn = r.rows.map(x => x.name);
    console.log(`[${label}/reload] visible: ${rn.join(" | ")}`);
    ok(`${label}/reload: the finished rows are still hidden behind Focus (build ${r.build})`, !rn.some(n => /^Done step|^TIA done/.test(n)));
    // The saved position: in the cloud row's own order the new task is the LAST child of Baytown Platting, right before TIA.
    const ct = cloud.find(c => c.tasks.includes("Persisted row"));
    const ci = ct.tasks.indexOf("Persisted row");
    ok(`${label}/reload: saved order — directly after Baytown Platting's last child, directly before TIA`, ct.tasks[ci - 1] === "Done step 9" && ct.tasks[ci + 1] === "TIA", ct.tasks.join(" | "));
    ok(`${label}/reload: saved as a child of Baytown Platting (same parent as P&Z)`, ct.parents[ci] === ct.parents[ct.tasks.indexOf("P&Z Consideration & Approval")] && ct.parents[ci] != null);
    // By design the session pin is gone after a reload: a blank (not started) row is hidden by its group's Focus like any
    // other not-started task. Reveal the group (the chip) and read the order: it must be exactly where it was saved.
    const bp = await idOf(page, "Baytown Platting");
    await page.locator(`[data-task-row="${bp}"] [title^="Show all tasks"]`).click(); await pacedWait(page, 500);
    const shown = (await rows(page)).rows; const sn = shown.map(x => x.name); const si = sn.indexOf("Persisted row");
    console.log(`[${label}/reload] after Show all on Baytown Platting: ${sn.join(" | ")}`);
    ok(`${label}/reload: with the group shown, the row sits after Done step 9 and before TIA, at P&Z's indent`, si > 0 && sn[si - 1] === "Done step 9" && sn[si + 1] === "TIA" && Math.abs(shown[si].pad - shown[sn.indexOf("P&Z Consideration & Approval")].pad) < 0.5, sn.join(" | "));
  }
  await page.close();
}

try {
  await scenario("Insert key", async page => {
    const id = await idOf(page, "TIA");
    await page.locator(`[data-task-row="${id}"] [data-col-key="id"]`).click(); await pacedWait(page, 150);
    await page.keyboard.press("Insert");
  }, { reload: true });
  await scenario("Right-click Insert Row Above", async page => {
    const id = await idOf(page, "TIA");
    await page.locator(`[data-task-row="${id}"] [data-col-key="id"]`).click({ button: "right" }); await pacedWait(page, 150);
    await page.locator("i.ti-row-insert-top").locator("..").click();
  });
  ok("no page errors on the schedule page", errs.length === 0, errs.slice(0, 2).join(" | "));
} catch (e) { ok("run completed without throwing", false, e.message); }
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
