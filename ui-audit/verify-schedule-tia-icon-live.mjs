/* B2671232 / V2115884 — the custom-drawn TIA task icon (cars on a road) on a REAL deploy, signed in as the test account, in a
 * THROWAWAY cloud schedule that is deleted afterwards (constraint #15). Steps 1-5 of V2115884 (step 6 is the owner's own look).
 *   E2E_LOGIN_KEY=… EXPECT_SHA=<merge commit> node ui-audit/verify-schedule-tia-icon-live.mjs [https://planyr.io]
 *
 *   1  deploy: the served build contains the merge commit (/version.json read in the page session of the assertions) and
 *      /sequence/taskIcons.js is 200 and carries svg:tia
 *   2  pick: Set icon… → search tia / traffic → exactly the new TIA, no 🚦 anywhere in the picker; pick it → it draws in the row
 *      as an inline drawing (no image) before the name
 *   3  persistence: the saved cloud row carries the KEY svg:tia (never markup); a cache-busted reload of the same page AND a fresh
 *      page (a second device) show it
 *   4  looks: the three windshields are open (the row's own background) on a normal, a hovered and a selected row, the car bodies
 *      are drawn (device pixel ratio 4 through the context so a ~1 px windshield is measurable)
 *   5  nothing else moved: a task that already saved 🚦 still shows it (a loaded image); an emoji task still shows its emoji; a
 *      collapsed phase's faded summary draws the TIA
 * KNOWN-GOOD ARMS: signed in as the test account; the emoji row reports an <img> and no <svg>; every sampled background is opaque;
 *   a run that cannot see them is VOID.
 * Cleanup soft-deletes every schedule row this run created and proves none remains live. */
import { execSync } from "node:child_process";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const base = (process.argv.find((a) => /^https?:/.test(a)) || "https://planyr.io").replace(/\/$/, "");
const EXPECT_SHA = process.env.EXPECT_SHA || "";
const results = [];
const ok = (n, c, x = "") => { results.push({ n, c: !!c }); console.log(`${c ? "PASS" : "FAIL"} — ${n}${x ? " :: " + String(x).slice(0, 300) : ""}`); };
const NAME = "TIA Icon Live Fixture";
const task = (o) => ({ start: "2027-03-01", end: "2027-03-01", duration: 1, predecessors: [], health: "gray", percentComplete: 0,
  parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 1, predUnresolved: [], ...o });
const TASKS = [
  task({ id: 1, name: "TIA submitted" }),
  task({ id: 2, name: "Zoning review", icons: ["🗺️"] }),
  task({ id: 3, name: "Old traffic light task", icons: ["🚦"] }),
  task({ id: 4, name: "Traffic phase", isExpanded: false }),
  task({ id: 5, name: "Child TIA", parentId: 4, icons: ["svg:tia"] }),
  task({ id: 6, name: "Spacer one" }),
  task({ id: 7, name: "Spacer two" }),
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
  await assertMeasurable(page, "verify-schedule-tia-icon-live");
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
  const js = await page.evaluate(async () => { const r = await fetch("/sequence/taskIcons.js?cb=" + Date.now(), { cache: "no-store" }); return { status: r.status, has: (await r.text()).includes("svg:tia") }; });
  ok("1 GET /sequence/taskIcons.js is 200 and carries svg:tia", js.status === 200 && js.has, JSON.stringify(js));

  // ── KNOWN-GOOD ARM ──────────────────────────────────────────────────────────
  const g2 = await glyphs(page, 2);
  ok("[known-good] the emoji task reports an <img> (🗺️) and no <svg>; the phase child row exists", g2?.length === 1 && g2[0].img && !g2[0].svg && (await page.locator(row(1)).count()) === 1, JSON.stringify(g2));

  // ── 2 pick ──────────────────────────────────────────────────────────────────
  await page.locator(`${row(1)} [data-col-key="name"]`).click({ button: "right", position: { x: 90, y: 8 } }); await pacedWait(page, 300);
  await page.locator("div", { hasText: /^Set icon…$/ }).filter({ has: page.locator("i.ti") }).last().click(); await pacedWait(page, 400);
  const picker = page.locator("[data-task-icon-picker]");
  ok("2 Set icon… opens the picker", (await picker.count()) === 1);
  const ids = () => picker.locator("[data-icon-id]").evaluateAll((bs) => bs.map((b) => b.getAttribute("data-icon-id")));
  for (const q of ["tia", "traffic"]) { await picker.locator("input").fill(q); await pacedWait(page, 150); const got = await ids(); ok(`2 search “${q}” offers the new TIA and no 🚦`, got.includes("svg:tia") && !got.includes("🚦"), JSON.stringify(got)); }
  await picker.locator("input").fill("tia"); await pacedWait(page, 150);
  ok("2 search “tia” finds exactly the TIA", JSON.stringify(await ids()) === JSON.stringify(["svg:tia"]), JSON.stringify(await ids()));
  await picker.locator("input").fill(""); await pacedWait(page, 150);
  ok("2 the whole picker holds no 🚦", !(await ids()).includes("🚦"));
  await picker.locator("input").fill("traffic"); await pacedWait(page, 150);
  ok("2 in the picker the entry is “Traffic impact analysis (TIA) · drawn for Planyr”, an inline <svg>, not an image", await picker.locator('[data-icon-id="svg:tia"]').evaluate((b) => b.title === "Traffic impact analysis (TIA) · drawn for Planyr" && !!b.querySelector("svg") && !b.querySelector("img")));
  await picker.locator('[data-icon-id="svg:tia"]').click(); await pacedWait(page, 300);
  await page.keyboard.press("Escape"); await pacedWait(page, 300);
  const g1 = await glyphs(page, 1);
  ok("2 the pick draws in the row before the name, as an inline drawing (no image)", g1?.length === 1 && g1[0].id === "svg:tia" && g1[0].svg && !g1[0].img, JSON.stringify(g1));

  // ── 3 persistence ───────────────────────────────────────────────────────────
  let saved = null;
  for (let i = 0; i < 40; i++) { saved = await savedIcons(seededId); const t = saved.tasks && saved.tasks.find((x) => x.id === 1); if (t && t.icons && t.icons.includes("svg:tia")) break; await pacedWait(s.page, 1000); }
  const t1 = saved.tasks && saved.tasks.find((x) => x.id === 1), t3 = saved.tasks && saved.tasks.find((x) => x.id === 3);
  ok("3 the saved cloud row carries the KEY svg:tia on that task", t1 && JSON.stringify(t1.icons) === JSON.stringify(["svg:tia"]), JSON.stringify(t1));
  ok("3 the task that saved 🚦 was not rewritten (still exactly [🚦])", t3 && JSON.stringify(t3.icons) === JSON.stringify(["🚦"]), JSON.stringify(t3));
  ok("3 no SVG markup is stored in the cloud row", saved.raw && !/<path|<svg|<rect|currentColor/.test(saved.raw));
  await page.close();
  page = await openApp("b" + Date.now().toString(36));
  const g1b = await glyphs(page, 1);
  ok("3 after a cache-busted reload the TIA is still on the row, drawn", g1b?.length === 1 && g1b[0].id === "svg:tia" && g1b[0].svg, JSON.stringify(g1b));
  const page2 = await openApp("c" + Date.now().toString(36));
  const g1c = await glyphs(page2, 1);
  ok("3 a second, fresh page (a second device) shows it too", g1c?.length === 1 && g1c[0].id === "svg:tia" && g1c[0].svg, JSON.stringify(g1c));
  await page2.close();

  // ── 4 looks: pixels at device ratio 4 ───────────────────────────────────────
  const WS = [[7.4, 7.7], [16.1, 7.7], [15.4, 16.3]];
  const pixels = async () => {
    const svg = page.locator(`${row(1)} [data-task-icon="svg:tia"] svg`).first();
    const r = await svg.boundingBox(); const M = 3;
    const buf = await page.screenshot({ clip: { x: r.x - M, y: r.y - M, width: r.width + 2 * M, height: r.height + 2 * M } });
    const k = (r.width * DSF) / 24, ox = M * DSF, oy = M * DSF, pt = (u, v) => [ox + u * k, oy + v * k];
    const probes = []; WS.forEach(([cu, cv]) => { for (const du of [-0.1, 0, 0.1]) for (const dv of [-0.4, 0, 0.4]) probes.push(pt(cu + du, cv + dv)); });
    const [bg, body1, body2, body3, ...ws] = await samplePng(page, buf, [[1.5 * DSF, oy + (r.height * DSF) / 2], pt(3.6, 7.7), pt(12.6, 7.7), pt(19.6, 16.3), ...probes]);
    return { ws, body1, body2, body3, bg };
  };
  const near = (a, b, t = 3) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= t);
  const differs = (a, b, t = 8) => a.slice(0, 3).some((v, i) => Math.abs(v - b[i]) >= t);
  // a windshield is under one CSS pixel wide at row size, so its outer columns are anti-aliased: it reads as OPEN when 5 of its 9 sample points are the row's background
  const open = (p) => [0, 1, 2].every((w) => p.ws.slice(w * 9, w * 9 + 9).filter((c) => near(c, p.bg)).length >= 5);
  const judge = (label, p) => {
    ok(`4 [known-good] ${label}: the sampled row background is an OPAQUE pixel (a transparent sample means the instrument returned a blank image)`, p.bg[3] === 255, JSON.stringify(p.bg));
    ok(`4 ${label}: all three windshields read as OPEN (the row's own background), the car bodies are drawn`, open(p) && differs(p.body1, p.bg) && differs(p.body2, p.bg) && differs(p.body3, p.bg), JSON.stringify({ bg: p.bg, bodies: [p.body1, p.body2, p.body3] }));
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
  const old = await page.evaluate(async () => { const e = document.querySelector('[data-task-row="3"] [data-col-key="name"] [data-task-icon]'); const img = e && e.querySelector("img"); if (img && !img.complete) await new Promise((r) => { img.onload = img.onerror = r; setTimeout(r, 3000); }); return { id: e && e.getAttribute("data-task-icon"), title: e && e.title, img: !!img, svg: !!(e && e.querySelector("svg")), loaded: !!(img && img.complete && img.naturalWidth > 0) }; });
  ok("5 the task that already saved 🚦 still shows it (a loaded traffic-light image, with its hover label)", old.id === "🚦" && old.img && !old.svg && old.loaded && old.title === "Traffic impact analysis (TIA)", JSON.stringify(old));
  const sum = await page.evaluate(() => { const c = document.querySelector('[data-task-row="4"] [data-col-key="name"]'); const sm = c && c.querySelector("[data-phase-icons]"); return { n: sm ? sm.querySelectorAll("svg").length : 0, faded: sm ? Number(getComputedStyle(sm.querySelector("svg")).opacity) < 1 : null }; });
  ok("5 the collapsed phase's faded summary draws the TIA", sum.n === 1 && sum.faded === true, JSON.stringify(sum));
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
