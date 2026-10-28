/* NEW-1 / B2465520 — a cell's popover stays attached to its cell, on a REAL deploy, signed in as the test account, in a
 * THROWAWAY schedule that is deleted afterwards (constraint #15).
 *   E2E_LOGIN_KEY=… node ui-audit/verify-schedule-anchored-popovers-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * The same scenarios as verify-schedule-anchored-popovers.mjs (lib/anchoredPopoverScenarios.mjs: real wheel / clicks,
 * vacuity guards), but the page is the deployed /sequence/ and the fixture is a REAL cloud schedule row (press "New
 * schedule" the way a person does, then overwrite that throwaway row with a 70-row fixture, as
 * verify-schedule-focus-key-live.mjs does). /version.json is read in the same page session as every assertion.
 * Cleanup soft-deletes every schedule row this run created and proves none remains live. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { makeScenarios } from "./lib/anchoredPopoverScenarios.mjs";

const base = process.argv[2] || "https://planyr.io", want = process.argv[3] || "";
const results = [];
const ok = (n, c, x = "") => { results.push({ n, c: !!c }); console.log(`${c ? "PASS" : "FAIL"} — ${n}${x ? " :: " + x : ""}`); };
const NAME = "Anchored Popover Fixture";
const task = o => ({ start: "2027-03-01", end: "2027-03-01", duration: 1, predecessors: [], health: "gray", percentComplete: 0,
  parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 1, predUnresolved: [], ...o });
const TASKS = Array.from({ length: 70 }, (_, i) => task({ id: i + 1, name: i === 0 ? "Project Kick Off" : `Step ${i + 1}`, health: ["gray", "yellow", "green", "red"][i % 4] }));

const s = await openSignedIn({ base, viewport: { width: 1600, height: 950 } });
console.log("signed in as", s.proof.email, "| fixture site visible", s.proof.fixtureVisible);
ok("[known-good] signed in as the test account", s.proof.email === "e2e@planyr.test", s.proof.email);
const liveIds = () => s.page.evaluate(async () => { const q = await window.pfSupabase.from("schedules").select("id").is("deleted_at", null); if (q.error) throw new Error(q.error.message); return q.data.map(r => r.id); });
const before = new Set(await liveIds());
const errs = [];

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
  }, { id, fx: { id: 1, name: NAME, tasks: TASKS } });
  if (err) throw new Error("could not seed the throwaway row " + id + ": " + err);
  return id;
}

let seeded = false, buildLogged = false;
async function boot(w = 1400, h = 800, view = "Grid") {
  if (!seeded) { await seedCloudSchedule(); seeded = true; }
  const page = await s.page.context().newPage(); await page.setViewportSize({ width: w, height: h });
  page.on("pageerror", e => errs.push(String(e)));
  await page.goto(base + "/sequence/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 }); await pacedWait(page, 1500);
  await assertMeasurable(page, "verify-schedule-anchored-popovers-live");
  await pacedWait(page, 2500);                       // let the cloud pull finish re-rendering rows: a re-mounted cell legitimately drops its popup
  if (!buildLogged) {
    console.log("[page] columns:", await page.evaluate(() => [...document.querySelectorAll("[data-hdr-col]")].map(h => h.dataset.hdrCol).join(",")));
    const build = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then(r => r.json()).catch(e => ({ error: String(e) }))).build || "?");
    console.log(`[page] build ${build}`); buildLogged = true;
    if (want) ok(`served build matches ${want} (read in this page session: ${build})`, String(build).startsWith(want.slice(0, 7)), build);
  }
  if (view !== "Grid") { await page.evaluate(l => { [...document.querySelectorAll(".hdr-view button")].find(b => b.textContent.trim() === l).click(); }, view); await pacedWait(page, 900); }
  return { ctx: { close: () => page.close() }, page, frame: page };
}
const S = makeScenarios({ boot, rec: (tag, name, pass, extra = "") => ok(`[${tag}] ${name}`, pass, extra), headerH: 0 });

try {
  await S.runAll();
  ok("no page errors on the schedule page", errs.length === 0, errs.slice(0, 2).join(" | "));
} catch (e) { ok("run completed without throwing", false, e.message); }
finally {
  await pacedWait(s.page, 2000);
  const created = (await liveIds()).filter(i => !before.has(i));
  const err = await s.page.evaluate(async (ids) => {
    for (const i of ids) { const u = await window.pfSupabase.from("schedules").update({ deleted_at: new Date().toISOString() }).eq("id", i); if (u.error) return u.error.message; }
    return null; }, created);
  const left = (await liveIds()).filter(i => !before.has(i));
  ok(`cleanup: the ${created.length} throwaway schedule row(s) this run created are deleted and none remains live`, !err && left.length === 0, JSON.stringify({ created, err, left }));
  await s.close();
}
const known = results.filter(r => r.n.includes("[known-good]") && !r.c);
if (known.length) { console.log("VOID — a known-good arm failed, so this instrument cannot vouch for the rest."); process.exit(1); }
console.log(results.filter(r => r.c).length + "/" + results.length + " passed");
process.exit(results.every(r => r.c) ? 0 : 1);
