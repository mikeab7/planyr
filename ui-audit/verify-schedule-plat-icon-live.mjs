/* B2671217 / V2115875 — the custom-drawn PLAT task icon on a REAL deploy, signed in as the test account, in a THROWAWAY cloud
 * schedule that is deleted afterwards (constraint #15). Steps 1-5 of V2115875 (step 6 is the owner's own look on his account).
 *   E2E_LOGIN_KEY=… EXPECT_SHA=<merge commit> node ui-audit/verify-schedule-plat-icon-live.mjs [https://planyr.io]
 *
 *   1  deploy: the served build contains the merge commit (/version.json read in the page session of the assertions) and
 *      /sequence/taskIcons.js is 200 and carries svg:plat
 *   2  pick: Set icon… → search plat / mylar / subdivision / final plat / lots / recordation → the new Plat is offered; pick it → it
 *      draws in the row as an inline drawing (no image) before the name
 *   3  persistence: the saved cloud row carries the KEY svg:plat (never markup); a cache-busted reload of the same page AND a fresh
 *      page (a second device) show it
 *   4  looks: street + bulb are open (the row's own background) on a normal, a hovered and a selected row, the lots are shaded
 *      (device pixel ratio forced to 4 through CDP so a 1 px street is measurable)
 *   5  nothing else moved: an emoji task still shows its emoji; a collapsed phase's faded summary draws the plat
 * KNOWN-GOOD ARMS: signed in as the test account; the emoji row reports an <img> and no <svg>; a run that cannot see them is VOID.
 * Cleanup soft-deletes every schedule row this run created and proves none remains live. */
import { execSync } from "node:child_process";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const base = (process.argv.find((a) => /^https?:/.test(a)) || "https://planyr.io").replace(/\/$/, "");
const EXPECT_SHA = process.env.EXPECT_SHA || "";
const results = [];
const ok = (n, c, x = "") => { results.push({ n, c: !!c }); console.log(`${c ? "PASS" : "FAIL"} — ${n}${x ? " :: " + String(x).slice(0, 300) : ""}`); };
const NAME = "Plat Icon Live Fixture";
const task = (o) => ({ start: "2027-03-01", end: "2027-03-01", duration: 1, predecessors: [], health: "gray", percentComplete: 0,
  parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 1, predUnresolved: [], ...o });
const TASKS = [
  task({ id: 1, name: "Final plat recorded" }),
  task({ id: 2, name: "Zoning review", icons: ["🗺️"] }),
  task({ id: 3, name: "Subdivision phase", isExpanded: false }),
  task({ id: 4, name: "Child lots", parentId: 3, icons: ["svg:plat"] }),
  task({ id: 5, name: "Spacer one" }),
  task({ id: 6, name: "Spacer two" }),
];

// device ratio 4 for the whole session (a 1 px street is only measurable at 4x); screenshots happen only in step 4
const DSF = 4;
const s = await openSignedIn({ base, viewport: { width: 1400, height: 800 }, contextOptions: { deviceScaleFactor: DSF } });
const liveIds = () => s.page.evaluate(async () => { const q = await window.pfSupabase.from("schedules").select("id").is("deleted_at", null); if (q.error) throw new Error(q.error.message); return q.data.map((r) => r.id); });
const before = new Set(await liveIds());
const errs = [];
let seededId = null;

async function seed() {
  const p = await s.page.context().newPage(); await p.setViewportSize({ width: 1400, height: 800 });
  await p.goto(base + "/sequence/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForSelector('[data-testid="open-history-desktop"], button:has-text("New schedule")', { timeout: 40000 });
  if (!(await p.locator('[data-testid="open-history-desktop"]').count())) { await p.getByRole("button", { name: "New schedule" }).click(); await pacedWait(p, 3000); }
  await pacedWait(p, 3000); await p.close();
  const ids = (await liveIds()).filter((i) => !before.has(i));
  if (ids.length !== 1) throw new Error("expected exactly one throwaway schedule row, found " + JSON.stringify(ids));
  const id = ids[0];
  const err = await s.page.evaluate(async ({ id, fx }) => {
    const r = await window.pfSupabase.from("schedules").select("rev").eq("id", id).single();
    if (r.error) return r.error.message;
    const u = await window.pfSupabase.from("schedules").update({ name: fx.name, data: { ...fx, id }, rev: (r.data.rev || 0) + 1 }).eq("id", id).select("id");
    return u.error ? u.error.message : (u.data && u.data.length ? null : "update matched no row");
  }, { id, fx: { id: 1, name: NAME, tasks: TASKS } });
  if (err) throw new Error("could not seed the throwaway row " + id + ": " + err);
  return id;
}
const openApp = async (cb) => {
  const page = await s.page.context().newPage(); await page.setViewportSize({ width: 1400, height: 800 });
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(base + "/sequence/?cb=" + cb, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-schedule-plat-icon-live");
  await pacedWait(page, 3500);   // let the cloud pull finish re-rendering rows
  return page;
};
const row = (id) => `[data-task-row="${id}"]`;
const glyphs = (page, id) => page.evaluate((id) => {
  const r = document.querySelector(`[data-task-row="${id}"]`); if (!r) return null;
  return [...r.querySelector('[data-col-key="name"]').querySelectorAll("[data-task-icon]")].map((e) => ({ id: e.getAttribute("data-task-icon"), svg: !!e.querySelector("svg"), img: !!e.querySelector("img") }));
}, id);
const buildOf = (page) => page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}))).build || "?");
const savedIcons = (id) => s.page.evaluate(async (id) => { const r = await window.pfSupabase.from("schedules").select("data").eq("id", id).single(); return r.error ? { error: r.error.message } : { tasks: (r.data.data.tasks || []).map((t) => ({ id: t.id, icons: t.icons || null })), raw: JSON.stringify(r.data.data) }; }, id);

async function samplePng(page, buf, pts) {
  return page.evaluate(async ({ b64, pts }) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/png" }));
    const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return pts.map(([x, y]) => Array.from(cx.getImageData(Math.round(x), Math.round(y), 1, 1).data));
  }, { b64: buf.toString("base64"), pts });
}

try {
  ok("[known-good] signed in as the test account", s.proof.email === "e2e@planyr.test" && s.proof.fixtureVisible, JSON.stringify(s.proof));
  seededId = await seed();
  let page = await openApp("a" + Date.now().toString(36));

  // ── 1 deploy ────────────────────────────────────────────────────────────────
  const build = await buildOf(page);
  const contains = !EXPECT_SHA || String(build).startsWith(EXPECT_SHA.slice(0, 7)) || (() => { try { execSync(`git merge-base --is-ancestor ${EXPECT_SHA} ${build}`, { stdio: "ignore" }); return true; } catch { return false; } })();
  ok(`1 the served build ${build} contains the merge commit ${EXPECT_SHA.slice(0, 7) || "(unset)"} (read in this page session)`, contains, build);
  const js = await page.evaluate(async () => { const r = await fetch("/sequence/taskIcons.js?cb=" + Date.now(), { cache: "no-store" }); return { status: r.status, has: (await r.text()).includes("svg:plat") }; });
  ok("1 GET /sequence/taskIcons.js is 200 and carries svg:plat", js.status === 200 && js.has, JSON.stringify(js));

  // ── KNOWN-GOOD ARM ──────────────────────────────────────────────────────────
  const g2 = await glyphs(page, 2);
  ok("[known-good] the emoji task reports an <img> (🗺️) and no <svg>; the phase child row exists", g2?.length === 1 && g2[0].img && !g2[0].svg && (await page.locator(row(1)).count()) === 1, JSON.stringify(g2));

  // ── 2 pick ──────────────────────────────────────────────────────────────────
  await page.locator(`${row(1)} [data-col-key="name"]`).click({ button: "right", position: { x: 90, y: 8 } }); await pacedWait(page, 300);
  await page.locator("div", { hasText: /^Set icon…$/ }).filter({ has: page.locator("i.ti") }).last().click(); await pacedWait(page, 400);
  const picker = page.locator("[data-task-icon-picker]");
  ok("2 Set icon… opens the picker", (await picker.count()) === 1);
  const ids = () => picker.locator("[data-icon-id]").evaluateAll((bs) => bs.map((b) => b.getAttribute("data-icon-id")));
  const plat = await (async () => { await picker.locator("input").fill("plat"); await pacedWait(page, 150); return ids(); })();
  ok("2 search “plat” offers the old “Plat / replat” AND the new Plat", plat.includes("c:plat") && plat.includes("svg:plat"), JSON.stringify(plat));
  for (const q of ["mylar", "subdivision", "final plat"]) { await picker.locator("input").fill(q); await pacedWait(page, 150); const got = await ids(); ok(`2 search “${q}” finds only the new Plat`, JSON.stringify(got) === JSON.stringify(["svg:plat"]), JSON.stringify(got)); }
  for (const q of ["lots", "recordation"]) { await picker.locator("input").fill(q); await pacedWait(page, 150); ok(`2 search “${q}” offers the new Plat`, (await ids()).includes("svg:plat")); }
  await picker.locator("input").fill("mylar"); await pacedWait(page, 150);
  ok("2 in the picker the new entry is “Plat · drawn for Planyr”, an inline <svg>, not an image", await picker.locator('[data-icon-id="svg:plat"]').evaluate((b) => b.title === "Plat · drawn for Planyr" && !!b.querySelector("svg") && !b.querySelector("img")));
  await picker.locator('[data-icon-id="svg:plat"]').click(); await pacedWait(page, 300);
  await page.keyboard.press("Escape"); await pacedWait(page, 300);
  const g1 = await glyphs(page, 1);
  ok("2 the pick draws in the row before the name, as an inline drawing (no image)", g1?.length === 1 && g1[0].id === "svg:plat" && g1[0].svg && !g1[0].img, JSON.stringify(g1));

  // ── 3 persistence ───────────────────────────────────────────────────────────
  let saved = null;
  for (let i = 0; i < 40; i++) { saved = await savedIcons(seededId); const t = saved.tasks && saved.tasks.find((x) => x.id === 1); if (t && t.icons && t.icons.includes("svg:plat")) break; await pacedWait(s.page, 1000); }
  const t1 = saved.tasks && saved.tasks.find((x) => x.id === 1);
  ok("3 the saved cloud row carries the KEY svg:plat on that task", t1 && JSON.stringify(t1.icons) === JSON.stringify(["svg:plat"]), JSON.stringify(t1));
  ok("3 no SVG markup is stored in the cloud row", saved.raw && !/<path|<svg|<rect|currentColor/.test(saved.raw));
  await page.close();
  page = await openApp("b" + Date.now().toString(36));
  const g1b = await glyphs(page, 1);
  ok("3 after a cache-busted reload the plat is still on the row, drawn", g1b?.length === 1 && g1b[0].id === "svg:plat" && g1b[0].svg, JSON.stringify(g1b));
  const page2 = await openApp("c" + Date.now().toString(36));
  const g1c = await glyphs(page2, 1);
  ok("3 a second, fresh page (a second device) shows it too", g1c?.length === 1 && g1c[0].id === "svg:plat" && g1c[0].svg, JSON.stringify(g1c));
  await page2.close();

  // ── 4 looks: pixels at device ratio 4 ───────────────────────────────────────
  const pixels = async () => {
    const svg = page.locator(`${row(1)} [data-task-icon="svg:plat"] svg`).first();
    const r = await svg.boundingBox(); const M = 3;
    const buf = await page.screenshot({ clip: { x: r.x - M, y: r.y - M, width: r.width + 2 * M, height: r.height + 2 * M } });
    const k = (r.width * DSF) / 24, ox = M * DSF, oy = M * DSF, pt = (u, v) => [ox + u * k, oy + v * k];
    const chan = []; for (let v = 11.3; v <= 12.71; v += 0.1) for (const u of [4, 5, 6]) chan.push(pt(u, v));
    const [bg, bulb, lot, below, ...cs] = await samplePng(page, buf, [[1.5 * DSF, oy + (r.height * DSF) / 2], pt(14, 12), pt(4.5, 6), pt(5, 17), ...chan]);
    const dist = (a, b) => Math.max(...a.slice(0, 3).map((x, i) => Math.abs(x - b[i])));
    return { street: cs.reduce((best, c) => (dist(c, bg) < dist(best, bg) ? c : best), cs[0]), bulb, lot, below, bg };
  };
  const near = (a, b, t = 3) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= t);
  const differs = (a, b, t = 8) => a.slice(0, 3).some((v, i) => Math.abs(v - b[i]) >= t);
  const judge = (label, p) => {
    ok(`4 [known-good] ${label}: the sampled row background is an OPAQUE pixel (a transparent sample means the instrument returned a blank image)`, p.bg[3] === 255, JSON.stringify(p.bg));
    ok(`4 ${label}: street and bulb read as OPEN (the row's own background), the lots are shaded`, near(p.street, p.bg) && near(p.bulb, p.bg) && differs(p.lot, p.bg) && differs(p.below, p.bg), JSON.stringify(p));
  };
  await page.mouse.move(5, 5); await pacedWait(page, 250);
  judge("normal row", await pixels());
  const sl = await page.locator(`${row(1)} [data-task-icon-slot]`).boundingBox();
  await page.mouse.move(sl.x + sl.width / 2, sl.y + sl.height / 2); await pacedWait(page, 300);
  judge("hovered (slot tinted)", await pixels());
  await page.mouse.move(5, 5);
  const nb = await page.locator(`${row(1)} [data-col-key="name"]`).boundingBox();
  await page.locator(`${row(1)} [data-col-key="name"]`).click({ position: { x: nb.width - 14, y: 8 } }); await pacedWait(page, 400);
  judge("selected row", await pixels());

  // ── 5 nothing else moved ────────────────────────────────────────────────────
  const g2b = await glyphs(page, 2);
  ok("5 the emoji task still shows its emoji", g2b?.length === 1 && g2b[0].id === "🗺️" && g2b[0].img && !g2b[0].svg, JSON.stringify(g2b));
  const sum = await page.evaluate(() => { const c = document.querySelector('[data-task-row="3"] [data-col-key="name"]'); const sm = c && c.querySelector("[data-phase-icons]"); return { n: sm ? sm.querySelectorAll("svg").length : 0, faded: sm ? Number(getComputedStyle(sm.querySelector("svg")).opacity) < 1 : null }; });
  ok("5 the collapsed phase's faded summary draws the plat", sum.n === 1 && sum.faded === true, JSON.stringify(sum));
  ok("no page errors on the schedule page", errs.length === 0, errs.slice(0, 2).join(" | "));
  await page.close();
} catch (e) {
  ok("run completed without throwing", false, String(e && e.stack || e).slice(0, 500));
} finally {
  try {
    const created = (await liveIds()).filter((i) => !before.has(i));
    const err = await s.page.evaluate(async (ids) => { for (const i of ids) { const u = await window.pfSupabase.from("schedules").update({ deleted_at: new Date().toISOString() }).eq("id", i); if (u.error) return u.error.message; } return null; }, created);
    const left = (await liveIds()).filter((i) => !before.has(i));
    ok(`cleanup: the ${created.length} throwaway schedule row(s) this run created are deleted and none remains live`, !err && left.length === 0, JSON.stringify({ created, err, left }));
  } catch (e) { ok("cleanup ran", false, String(e && e.message || e)); }
  await s.close().catch(() => {});
}
const known = results.filter((r) => r.n.includes("[known-good]") && !r.c);
if (known.length) { console.log("VOID — a known-good arm failed, so this instrument cannot vouch for the rest."); process.exit(1); }
console.log(results.filter((r) => r.c).length + "/" + results.length + " passed");
process.exit(results.every((r) => r.c) ? 0 : 1);
