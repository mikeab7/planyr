/* B2484784 / V1934784 — a click on a Schedule row's ID cell / grip never moves the row. Signed in as the test account on a real deploy,
 * in a THROWAWAY cloud schedule holding Grand Port's 365-row structure at 125% grid zoom (deleted afterwards; never Grand Port).
 *   E2E_LOGIN_KEY=… node ui-audit/verify-schedule-id-click-no-move-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * Real mouse. Press-and-release with ZERO movement on a row near the bottom edge of the grid (the old drag auto-scrolled under a
 * still pointer and a grip release committed the drop): grip and ID cell, single and inside a selection, held 0/150/400 ms; plus
 * 5 px of jitter; each asserts nothing armed, no row moved in the CLOUD row, no rev bump. Then the #2544 behaviour: his gesture still
 * nests onto Plan A and one Ctrl+Z undoes it. /version.json is read in the same call as the assertions that matter.
 * Known-good arms: the signed-in account, the seeded structure, and the real drag writing the cloud (so "no rev bump" is observable). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { grandPortTasks } from "./lib/grandPortScheduleStructure.mjs";

const base = process.argv[2] || "https://planyr.io", want = process.argv[3] || "";
const NAME = "Grand Port structure — id-click live check (throwaway)";
const ZOOM = 1.25;
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
  await assertMeasurable(page, "verify-schedule-id-click-no-move-live");
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

const cloudRev = (id) => s.page.evaluate(async (id) => { const q = await window.pfSupabase.from("schedules").select("rev").eq("id", id).single(); return q.error ? -1 : q.data.rev; }, id);
const armedNow = (page) => page.evaluate(() => ({ dashed: [...document.querySelectorAll("[data-grid-scroll] [data-task-row]")].filter(r => r.style.outline.includes("dashed") || r.style.opacity === "0.45").length, pinned: !!document.querySelector("style[data-pinned-cursor]") }));
const struct = (page) => page.evaluate(() => [...document.querySelectorAll("[data-grid-scroll] [data-task-row]")].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map(r => { const n = r.querySelector('[data-col-key="name"]'); const sp = n && n.querySelector("span"); return (n ? n.innerText : "").replace(/^[▾▸]\s*/, "").trim() + "@" + (sp ? getComputedStyle(sp).paddingLeft : ""); }).join("|"));

let rowId = null;
try {
  rowId = await seed();
  const c0 = await cloudShape(rowId);
  ok("[known-good] the seeded cloud row holds the 365-row structure", c0.n === 365 && original(c0), JSON.stringify(c0));
  const page = await s.page.context().newPage(); await page.setViewportSize({ width: 1600, height: 950 });
  await boot(page, base + "/sequence/");
  const b0 = await build(page);
  if (want) ok(`served build matches ${want}`, String(b0).startsWith(want.slice(0, 7)), b0);

  const cases = [];
  for (const target of ["grip", "id"]) for (const sel of ["single", "selection"]) for (const hold of [0, 150, 400]) cases.push({ target, sel, hold });
  for (const c of cases) {
    await page.evaluate(() => { document.querySelector("[data-grid-scroll]").scrollTop = 3000; }); await pacedWait(page, 300);
    const sr = await page.evaluate(() => { const r = document.querySelector("[data-grid-scroll]").getBoundingClientRect(); return { bottom: r.bottom }; });
    const rs = await page.evaluate(() => [...document.querySelectorAll("[data-grid-scroll] [data-task-row]")].map(r => { const b = r.querySelector('[data-col-key="id"]').getBoundingClientRect(); return { id: Number(r.dataset.taskRow), cy: b.top + b.height / 2 }; }));
    const band = rs.filter(r => r.cy > sr.bottom - 34 && r.cy < sr.bottom - 4), r = band[band.length >> 1];
    if (!r) { ok(`${c.target}/${c.sel}/${c.hold}ms · a row in the bottom-edge band`, false); continue; }
    const idLoc = id => page.locator(`[data-grid-scroll] [data-task-row="${id}"] [data-col-key="id"]`).first();
    if (c.sel === "selection") {
      const prev = rs.filter(x => x.cy < r.cy).sort((a, b) => b.cy - a.cy)[0];
      for (const q of [prev, r]) { const b = await idLoc(q.id).boundingBox(); if (q === r) await page.keyboard.down("Shift"); await page.mouse.click(b.x + b.width * 0.7, b.y + b.height / 2); if (q === r) await page.keyboard.up("Shift"); await pacedWait(page, 120); }
    } else { await page.keyboard.press("Escape"); }
    const bx = await (c.target === "grip" ? page.locator(`[data-grid-scroll] [data-row-drag-handle="${r.id}"]`).first() : idLoc(r.id)).boundingBox();
    const x = c.target === "grip" ? bx.x + bx.width / 2 : bx.x + bx.width * 0.7, y = bx.y + bx.height / 2;
    const s0 = await struct(page), st0 = await page.evaluate(() => document.querySelector("[data-grid-scroll]").scrollTop), rev0 = await cloudRev(rowId), sh0 = await cloudShape(rowId);
    await page.mouse.move(x, y); await page.mouse.down(); if (c.hold) await pacedWait(page, c.hold);
    const mid = await armedNow(page);
    await page.mouse.up(); await pacedWait(page, 3500);
    const st1 = await page.evaluate(() => document.querySelector("[data-grid-scroll]").scrollTop);
    await page.evaluate(t => { document.querySelector("[data-grid-scroll]").scrollTop = t; }, st0); await pacedWait(page, 300);
    const s1 = await struct(page), rev1 = await cloudRev(rowId), sh1 = await cloudShape(rowId);
    ok(`${c.target} · ${c.sel} · zero-movement click held ${c.hold}ms near the bottom edge: nothing armed, no auto-scroll, no row moved, cloud rev unchanged (build ${await build(page)})`,
      mid.dashed === 0 && !mid.pinned && Math.abs(st1 - st0) <= 30 && s1 === s0 && rev1 === rev0 && JSON.stringify(sh1) === JSON.stringify(sh0), JSON.stringify({ mid, scroll: [st0, st1], moved: s1 !== s0, rev: [rev0, rev1] }));
  }

  // jitter: 5px toward the row below the selection
  await scrollTo(page, "Kinder Morgan");
  { const a = await idBox(page, "Kinder Morgan"), b = await idBox(page, LAST_SELECTED);
    await page.mouse.click(a.x + a.width * 0.7, a.y + a.height / 2); await pacedWait(page, 150);
    await page.keyboard.down("Shift"); await page.mouse.click(b.x + b.width * 0.7, b.y + b.height / 2); await page.keyboard.up("Shift"); await pacedWait(page, 250);
    const rev0 = await cloudRev(rowId), s0 = await struct(page);
    await page.mouse.move(b.x + b.width * 0.7, b.y + b.height - 2); await page.mouse.down();
    for (const d of [2, 4, 5, 4, 5]) { await page.mouse.move(b.x + b.width * 0.7, b.y + b.height - 2 + d); await pacedWait(page, 40); }
    await page.mouse.up(); await pacedWait(page, 3500);
    ok("5px of jitter on an ID press at the selection's bottom edge: nothing moves, cloud rev unchanged", (await struct(page)) === s0 && (await cloudRev(rowId)) === rev0 && original(await cloudShape(rowId)), `rev ${rev0}→${await cloudRev(rowId)}`); }

  // #2544 still works: his gesture nests, the cloud follows (known-good arm: a real move DOES bump the rev), one Ctrl+Z undoes
  const rev0 = await cloudRev(rowId);
  const g1 = await hisGesture(page);
  ok("his gesture still shows the \"Nest inside\" box ON Plan A", g1.box.vis && g1.box.kind === "into" && Math.abs(g1.box.top - g1.targetTop) < 3, JSON.stringify(g1));
  const c1 = await waitCloud(rowId, nested);
  ok("[known-good] the deliberate drag nests in the cloud and bumps the rev (so \"rev unchanged\" above could have failed)", nested(c1) && (await cloudRev(rowId)) > rev0, JSON.stringify(c1));
  await page.keyboard.press("Control+z"); await pacedWait(page, 900);
  ok("one Ctrl+Z restores the structure and the cloud follows", original(await waitCloud(rowId, original)));
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
