/* B2445008 (×2) / V1888512 (reopened) — the nest-under drop on the owner's REAL schedule structure, on a real deploy, signed in as
 * the test account, in a THROWAWAY cloud schedule deleted afterwards (constraints 7 / 15). Never touches Grand Port.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-schedule-nest-real-structure-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * The throwaway holds the 365-row Grand Port › Master Schedule structure (ui-audit/lib/grandPortScheduleStructure.mjs) and
 * the grid runs at 89% zoom — the two things V1888512's 13-row, 100%-zoom, grip-only run could not see. His gesture, real
 * mouse: ID-click Kinder Morgan, shift-ID-click the last row under Air Liquide, press the Kinder Morgan ID number and drag
 * in small steps onto Plan A (the very next row). Asserts the "Nest inside" box sits ON Plan A mid-drag; the drop nests the
 * four top-most rows under Plan A; the CLOUD row holds it with links intact; ONE Ctrl+Z undoes it and the cloud follows; a
 * re-drop survives a cache-busted reload. /version.json is read in the same call as each assertion that matters.
 * Known-good arms: the signed-in account, and the seeded structure before any drag — VOID if either is wrong. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { grandPortTasks } from "./lib/grandPortScheduleStructure.mjs";

const base = process.argv[2] || "https://planyr.io", want = process.argv[3] || "";
const NAME = "Grand Port structure — nest live check (throwaway)";
const ZOOM = 0.89;
const PROJ = { id: 1, name: NAME, tasks: grandPortTasks() };
const KIDS = ["Kinder Morgan", "Enterprise", "Exxon", "Air Liquide"];
const LAST_SELECTED = "Set up meeting once we have pipeline depths";

const results = [];
const ok = (n, c, x = "") => { results.push({ n, c: !!c }); console.log(`${c ? "PASS" : "FAIL"} — ${n}${x ? " :: " + x : ""}`); };

const s = await openSignedIn({ base, viewport: { width: 1600, height: 950 } });
ok("[known-good] signed in as the test account", s.proof.email === "e2e@planyr.test", s.proof.email);
const liveIds = () => s.page.evaluate(async () => { const q = await window.pfSupabase.from("schedules").select("id").is("deleted_at", null); if (q.error) throw new Error(q.error.message); return q.data.map(r => r.id); });
const before = new Set(await liveIds());
const errs = [];

// The cloud row read back through the app's own client: parent NAME of each named row (ids renumber on every structural save).
const cloudShape = (id) => s.page.evaluate(async ({ id, LAST_SELECTED }) => {
  const q = await window.pfSupabase.from("schedules").select("rev,data").eq("id", id).single();
  if (q.error) return { error: q.error.message };
  const tasks = (q.data.data && q.data.data.tasks) || [], byId = new Map(tasks.map(t => [t.id, t]));
  const parentOf = n => { const t = tasks.find(x => x.name === n); return t ? (t.parentId == null ? null : (byId.get(t.parentId) || {}).name || "?") : "missing"; };
  const predOf = n => { const t = tasks.find(x => x.name === n); return t ? (t.predecessors || []).map(p => (byId.get(p.id) || {}).name || "?") : null; };
  return { n: tasks.length, km: parentOf("Kinder Morgan"), ent: parentOf("Enterprise"), exx: parentOf("Exxon"), al: parentOf("Air Liquide"),
    planA: parentOf("Plan A"), surveying: parentOf("Surveying"), planB: parentOf("Plan B"), lastPred: predOf(LAST_SELECTED),
    meetingHeldParent: parentOf("Meeting Held") };
}, { id, LAST_SELECTED });
const nested = c => c && !c.error && c.km === "Plan A" && c.ent === "Plan A" && c.exx === "Plan A" && c.al === "Plan A";
const original = c => c && !c.error && c.km === "Pipeline Coordination & LONOs" && c.ent === "Pipeline Coordination & LONOs" && c.exx === "Pipeline Coordination & LONOs" && c.al === "Pipeline Coordination & LONOs";

async function seed() {
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
  }, { id, fx: PROJ });
  if (err) throw new Error("could not seed the throwaway row " + id + ": " + err);
  return id;
}

async function boot(page, url) {
  await page.addInitScript(z => { try { const k = "planar:viewPrefs:v1"; const v = JSON.parse(localStorage.getItem(k) || "{}"); v.gridZoom = z; localStorage.setItem(k, JSON.stringify(v)); } catch {} }, ZOOM);
  page.on("pageerror", e => errs.push(String(e)));
  page.on("dialog", d => d.accept());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 }); await pacedWait(page, 2000);
  await assertMeasurable(page, "verify-schedule-nest-real-structure-live");
}
const build = page => page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then(r => r.json()).catch(() => ({}))).build || "?");
const rows = page => page.evaluate(() => [...document.querySelectorAll("[data-grid-scroll] [data-task-row]")].map(r => {
  const nc = r.querySelector('[data-col-key="name"]'), span = nc && nc.querySelector("span");
  const name = ([...r.querySelectorAll('[data-col-key="name"] span[title]')].map(e => e.getAttribute("title")).find(t => !/^(Collapse|Expand|Focus: hide|Show all tasks)/.test(t)) || (nc ? nc.innerText.replace(/^[▾▸]\s*/, "") : "")).trim();
  return { id: Number(r.dataset.taskRow), top: parseFloat(r.style.top), name, level: Math.round(((span ? parseFloat(getComputedStyle(span).paddingLeft) : 4) - 4) / 14) };
}).sort((a, b) => a.top - b.top));
const rowByName = async (page, n) => (await rows(page)).find(r => r.name === n) || null;
async function scrollTo(page, n) {
  for (let i = 0; i < 40; i++) {
    const r = await rowByName(page, n);
    if (r) { await page.evaluate(top => { const el = document.querySelector("[data-grid-scroll]"); el.scrollTop = Math.max(0, top - el.clientHeight / 3); }, r.top); await pacedWait(page, 300); if (await rowByName(page, n)) return; }
    await page.evaluate(() => { const el = document.querySelector("[data-grid-scroll]"); el.scrollTop += el.clientHeight * 0.8; }); await pacedWait(page, 150);
  }
  throw new Error(`"${n}" never came into view`);
}
const idBox = async (page, n) => page.locator(`[data-grid-scroll] [data-task-row="${(await rowByName(page, n)).id}"] [data-col-key="id"]`).first().boundingBox();
async function hisGesture(page) {
  await scrollTo(page, "Kinder Morgan");
  const a = await idBox(page, "Kinder Morgan"), b = await idBox(page, LAST_SELECTED);
  await page.mouse.click(a.x + a.width * 0.7, a.y + a.height / 2); await pacedWait(page, 150);
  await page.keyboard.down("Shift"); await page.mouse.click(b.x + b.width * 0.7, b.y + b.height / 2); await page.keyboard.up("Shift"); await pacedWait(page, 250);
  const t = await page.locator(`[data-grid-scroll] [data-task-row="${(await rowByName(page, "Plan A")).id}"]`).first().boundingBox();
  const from = { x: a.x + a.width * 0.7, y: a.y + a.height / 2 }, to = { x: t.x + 300, y: t.y + t.height / 2 };
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await pacedWait(page, 80);
  await page.mouse.move(to.x, to.y, { steps: Math.max(15, Math.round(Math.abs(to.y - from.y) / 6)) }); await pacedWait(page, 300);
  const box = await page.evaluate(() => { const n = document.querySelector("[data-grid-scroll] [data-drag-nest]"); const vis = getComputedStyle(n).display !== "none"; return { vis, kind: n.getAttribute("data-drag-nest-kind"), top: vis ? n.getBoundingClientRect().top : null }; });
  await page.mouse.up(); await pacedWait(page, 900);
  return { box, targetTop: t.y };
}
async function waitCloud(id, pred, tries = 30) { let c = null; for (let k = 0; k < tries; k++) { await pacedWait(s.page, 1000); c = await cloudShape(id); if (pred(c)) return c; } return c; }

let rowId = null;
try {
  rowId = await seed();
  const c0 = await cloudShape(rowId);
  ok("[known-good] the seeded cloud row holds the 365-row structure, Pipeline's four sub-groups where they are in Grand Port", c0.n === 365 && original(c0) && c0.planA === "Entitlements & Third Parties", JSON.stringify(c0));
  const page = await s.page.context().newPage(); await page.setViewportSize({ width: 1600, height: 950 });
  await boot(page, base + "/sequence/");
  const b0 = await build(page);
  if (want) ok(`served build matches ${want}`, String(b0).startsWith(want.slice(0, 7)), b0);
  const z = await page.evaluate(() => getComputedStyle(document.querySelector("[data-grid-scroll]")).zoom);
  ok(`[known-good] the grid is at ${Math.round(ZOOM * 100)}% zoom (the condition the first fix never ran under)`, Math.abs(Number(z) - ZOOM) < 0.005, z);

  const g1 = await hisGesture(page);
  ok(`his gesture (ID-cell drag of a 10-row selection onto Plan A, the next row): "Nest inside" box ON Plan A (build ${await build(page)})`, g1.box.vis && g1.box.kind === "into" && Math.abs(g1.box.top - g1.targetTop) < 3, JSON.stringify(g1));
  await scrollTo(page, "Plan A");
  const rs = await rows(page), ia = rs.findIndex(r => r.name === "Plan A");
  const kids = rs.slice(ia + 1).filter(r => r.level === rs[ia].level + 1).slice(0, 4).map(r => r.name);
  ok("drop: Kinder Morgan, Enterprise, Exxon, Air Liquide are Plan A's children in order", JSON.stringify(kids) === JSON.stringify(KIDS), JSON.stringify(kids));
  const c1 = await waitCloud(rowId, nested);
  ok(`cloud: the four rows' parent is Plan A; Plan B and Surveying stayed under Pipeline; Kinder Morgan's hidden child still under it; the link kept (build ${await build(page)})`,
    nested(c1) && c1.planB === "Pipeline Coordination & LONOs" && c1.surveying === "Pipeline Coordination & LONOs" && c1.meetingHeldParent === "Kinder Morgan" && JSON.stringify(c1.lastPred) === '["Task 152"]',
    JSON.stringify(c1));

  await page.keyboard.press("Control+z"); await pacedWait(page, 900);
  const c2 = await waitCloud(rowId, original);
  ok("undo: ONE Ctrl+Z puts them back under Pipeline, and the cloud follows", original(c2), JSON.stringify(c2));

  await hisGesture(page);
  const c3 = await waitCloud(rowId, nested);
  ok("re-drop: the cloud holds the nest again", nested(c3), JSON.stringify(c3));
  await page.goto(base + "/sequence/?cb=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 }); await pacedWait(page, 2500);
  await scrollTo(page, "Plan A");
  const rr = await rows(page), ja = rr.findIndex(r => r.name === "Plan A");
  const kids2 = rr.slice(ja + 1).filter(r => r.level === rr[ja].level + 1).slice(0, 4).map(r => r.name);
  ok(`reload (cache-busted): still nested under Plan A (build ${await build(page)})`, JSON.stringify(kids2) === JSON.stringify(KIDS), JSON.stringify(kids2));
  ok("no page errors on the schedule page", errs.length === 0, errs.slice(0, 2).join(" | "));
  await page.close();
} catch (e) { ok("run completed without throwing", false, e.stack || e.message); }
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
if (results.some(r => r.n.startsWith("[known-good]") && !r.c)) { console.log("VOID — a known-good arm failed, so this instrument cannot vouch for the rest."); process.exit(1); }
console.log(results.filter(r => r.c).length + "/" + results.length + " passed");
process.exit(results.every(r => r.c) ? 0 : 1);
