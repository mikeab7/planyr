/* NEW-1 (Permit icon) — the colour Permit / approval task icon (clipboard + approved seal + stamp) on a REAL deploy, signed in as the
 * test account, in a THROWAWAY cloud schedule that is deleted afterwards (constraint #15). The machine half of the live-verify gate.
 *   E2E_LOGIN_KEY=… EXPECT_SHA=<merge commit> node ui-audit/verify-schedule-permit-icon-live.mjs [https://planyr.io]
 *
 *   1  deploy: the served build contains the merge commit (/version.json read in the page session of the assertions) and
 *      /sequence/taskIcons.js is 200 and carries the new drawing (a mask, the stamp colour, no green seal)
 *   2  already-permit: a task seeded with the stored key c:permit (what every existing permit task holds) shows the NEW 24x24 drawing
 *   3  pick: Set icon… → search permit → Permit / approval → it draws in the row as an inline drawing before the name
 *   4  persistence: the saved cloud row carries the KEY c:permit (never markup); a cache-busted reload AND a fresh page (a second
 *      device) show it
 *   5  looks (device ratio 4 so a ~1 px gap is measurable): on a normal, a hovered and a selected row the three gaps round the stamp
 *      are the row's OWN background (no white ring) and the stamp is #d4506c
 *   6  many on one page: every mask id in the document is unique, every url(#id) resolves, and every icon shows its gap
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
const NAME = "Permit Icon Live Fixture";
const task = (o) => ({ start: "2027-03-01", end: "2027-03-01", duration: 1, predecessors: [], health: "gray", percentComplete: 0,
  parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 1, predUnresolved: [], ...o });
const TASKS = [
  task({ id: 1, name: "Pick me" }),
  task({ id: 2, name: "Zoning review", icons: ["🗺️"] }),
  task({ id: 3, name: "Site plan approved", icons: ["c:permit"] }),   // what an EXISTING permit task stores
  task({ id: 4, name: "Permit phase", isExpanded: false }),
  task({ id: 5, name: "Child permit", parentId: 4, icons: ["c:permit"] }),
  task({ id: 6, name: "Plat and permit", icons: ["c:plat", "c:permit"] }),
  task({ id: 7, name: "Permit B", icons: ["c:permit"] }),
  task({ id: 8, name: "Permit C", icons: ["c:permit"] }),
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
  await assertMeasurable(page, "verify-schedule-permit-icon-live");
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
  const js = await page.evaluate(async () => { const r = await fetch("/sequence/taskIcons.js?cb=" + Date.now(), { cache: "no-store" }); const t = await r.text(); return { status: r.status, mask: t.includes("pm-__UID__"), stamp: t.includes("#d4506c"), oldSeal: t.includes("#77B255") && t.includes('permit: \'<rect x="6" y="3"') }; });
  ok("1 GET /sequence/taskIcons.js is 200 and carries the new drawing (mask, stamp colour) and not the old green seal", js.status === 200 && js.mask && js.stamp && !js.oldSeal, JSON.stringify(js));

  // ── KNOWN-GOOD ARM ──────────────────────────────────────────────────────────
  const g2 = await glyphs(page, 2);
  ok("[known-good] the emoji task reports an <img> (🗺️) and no <svg>; the phase child row exists", g2?.length === 1 && g2[0].img && !g2[0].svg && (await page.locator(row(1)).count()) === 1, JSON.stringify(g2));

  // ── 2 a task that ALREADY holds c:permit ────────────────────────────────────
  const old = await page.evaluate(() => { const e = document.querySelector('[data-task-row="3"] [data-task-icon="c:permit"] svg'); return e ? { vb: e.getAttribute("viewBox"), mask: !!e.querySelector("mask"), stamp: !!e.querySelector('g[fill="#d4506c"]'), oldSeal: /#77B255/i.test(e.innerHTML) } : null; });
  ok("2 a task that already stored c:permit now shows the NEW drawing (24x24, mask, red stamp, no green seal)", old && old.vb === "0 0 24 24" && old.mask && old.stamp && !old.oldSeal, JSON.stringify(old));

  // ── 3 pick ──────────────────────────────────────────────────────────────────
  await page.locator(`${row(1)} [data-col-key="name"]`).click({ button: "right", position: { x: 90, y: 8 } }); await pacedWait(page, 300);
  await page.locator("div", { hasText: /^Set icon…$/ }).filter({ has: page.locator("i.ti") }).last().click(); await pacedWait(page, 400);
  const picker = page.locator("[data-task-icon-picker]");
  ok("3 Set icon… opens the picker", (await picker.count()) === 1);
  const ids = () => picker.locator("[data-icon-id]").evaluateAll((bs) => bs.map((b) => b.getAttribute("data-icon-id")));
  await picker.locator("input").fill("permit"); await pacedWait(page, 150);
  ok("3 search “permit” offers Permit / approval", (await ids()).includes("c:permit"), JSON.stringify(await ids()));
  ok("3 in the picker the entry is “Permit / approval · drawn for Planyr”, an inline 24x24 <svg> with its mask, not an image", await picker.locator('[data-icon-id="c:permit"]').evaluate((b) => b.title === "Permit / approval · drawn for Planyr" && !!b.querySelector("svg") && !b.querySelector("img") && b.querySelector("svg").getAttribute("viewBox") === "0 0 24 24" && !!b.querySelector("svg mask")));
  await picker.locator('[data-icon-id="c:permit"]').click(); await pacedWait(page, 300);
  await page.keyboard.press("Escape"); await pacedWait(page, 300);
  const g1 = await glyphs(page, 1);
  ok("3 the pick draws in the row before the name, as an inline drawing (no image)", g1?.length === 1 && g1[0].id === "c:permit" && g1[0].svg && !g1[0].img, JSON.stringify(g1));

  // ── 4 persistence ───────────────────────────────────────────────────────────
  let saved = null;
  for (let i = 0; i < 40; i++) { saved = await savedIcons(seededId); const t = saved.tasks && saved.tasks.find((x) => x.id === 1); if (t && t.icons && t.icons.includes("c:permit")) break; await pacedWait(s.page, 1000); }
  const t1 = saved.tasks && saved.tasks.find((x) => x.id === 1), t3 = saved.tasks && saved.tasks.find((x) => x.id === 3);
  ok("4 the saved cloud row carries the KEY c:permit on that task", t1 && JSON.stringify(t1.icons) === JSON.stringify(["c:permit"]), JSON.stringify(t1));
  ok("4 the task that already held c:permit was not rewritten (still exactly [c:permit])", t3 && JSON.stringify(t3.icons) === JSON.stringify(["c:permit"]), JSON.stringify(t3));
  ok("4 no SVG markup is stored in the cloud row", saved.raw && !/<path|<svg|<rect|<mask|#d4506c/.test(saved.raw));
  await page.close();
  page = await openApp("b" + Date.now().toString(36));
  const g1b = await glyphs(page, 1);
  ok("4 after a cache-busted reload the permit icon is still on the row, drawn", g1b?.length === 1 && g1b[0].id === "c:permit" && g1b[0].svg, JSON.stringify(g1b));
  const page2 = await openApp("c" + Date.now().toString(36));
  const g1c = await glyphs(page2, 1);
  ok("4 a second, fresh page (a second device) shows it too", g1c?.length === 1 && g1c[0].id === "c:permit" && g1c[0].svg, JSON.stringify(g1c));
  await page2.close();

  // ── 5 looks: pixels at device ratio 4 ───────────────────────────────────────
  const GAP = [[14.35, 18.4], [14.35, 20.6], [16.1, 14.2]];
  const pixelsOf = async (selector) => {
    const svg = page.locator(selector).first();
    const r = await svg.boundingBox(); const M = 3;
    const buf = await page.screenshot({ clip: { x: r.x - M, y: r.y - M, width: r.width + 2 * M, height: r.height + 2 * M } });
    const k = (r.width * DSF) / 24, ox = M * DSF, oy = M * DSF, pt = (u, v) => [ox + u * k, oy + v * k];
    const probes = []; GAP.forEach(([cu, cv]) => { for (const du of [-0.12, 0, 0.12]) for (const dv of [-0.2, 0, 0.2]) probes.push(pt(cu + du, cv + dv)); });
    const [bg, edge, stamp, ...gap] = await samplePng(page, buf, [[1.5 * DSF, oy + (r.height * DSF) / 2], pt(16.5, 8), pt(18.6, 18.4), ...probes]);
    return { gap, bg, edge, stamp };
  };
  const near = (a, b, t = 4) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= t);
  const differs = (a, b, t = 12) => a.slice(0, 3).some((v, i) => Math.abs(v - b[i]) >= t);
  // a gap is ~1 CSS pixel wide at row size, so its outer columns are anti-aliased: it reads as OPEN when 5 of its 9 sample points are the row's background
  const open = (p) => [0, 1, 2].every((w) => p.gap.slice(w * 9, w * 9 + 9).filter((c) => near(c, p.bg)).length >= 5);
  const judge = (label, p) => {
    ok(`5 [known-good] ${label}: the sampled row background is an OPAQUE pixel (a transparent sample means the instrument returned a blank image)`, p.bg[3] === 255, JSON.stringify(p.bg));
    ok(`5 ${label}: the gap beside the stamp is the row's OWN background (no white ring), the outline is drawn, the stamp is #d4506c`, open(p) && differs(p.edge, p.bg) && near(p.stamp, [212, 80, 108], 14), JSON.stringify({ bg: p.bg, edge: p.edge, stamp: p.stamp }));
  };
  const sel1 = `${row(1)} [data-task-icon="c:permit"] svg`;
  await page.mouse.move(5, 5); await pacedWait(page, 250);
  judge("normal row", await pixelsOf(sel1));
  const sl = await page.locator(`${row(1)} [data-task-icon-slot]`).boundingBox();
  await page.mouse.move(sl.x + sl.width / 2, sl.y + sl.height / 2); await pacedWait(page, 300);
  judge("hovered (slot tinted)", await pixelsOf(sel1));
  await page.mouse.move(5, 5);
  const nb = await page.locator(`${row(1)} [data-col-key="name"]`).boundingBox();
  await page.locator(`${row(1)} [data-col-key="name"]`).click({ position: { x: nb.width - 14, y: 8 } }); await pacedWait(page, 400);
  judge("selected row", await pixelsOf(sel1));

  // ── 6 many on one page ──────────────────────────────────────────────────────
  const G = await page.evaluate(() => {
    const masks = [...document.querySelectorAll("mask")].map((m) => m.id);
    const refs = [...document.querySelectorAll("g[mask]")].map((g) => (g.getAttribute("mask").match(/#([^)]+)/) || [])[1]);
    return { n: masks.length, dup: masks.filter((id, i) => masks.indexOf(id) !== i), resolve: refs.every((id) => id && document.getElementById(id) && document.getElementById(id).tagName.toLowerCase() === "mask"), refs: refs.length };
  });
  ok("6 many permit icons on one page: every mask id is UNIQUE and every url(#id) resolves to its own mask", G.n >= 5 && G.dup.length === 0 && G.resolve && G.refs === G.n, JSON.stringify(G));
  const total = await page.locator('[data-task-icon="c:permit"] svg').count();
  const bad = [];
  for (let i = 0; i < total; i++) {
    const loc = page.locator('[data-task-icon="c:permit"] svg').nth(i);
    if (!(await loc.isVisible())) continue;
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const r = await loc.boundingBox(); if (!r) continue;
    const M = 3, buf = await page.screenshot({ clip: { x: r.x - M, y: r.y - M, width: r.width + 2 * M, height: r.height + 2 * M } });
    const k = (r.width * DSF) / 24, o = M * DSF;
    const [bg, g0, g1_, g2_, st] = await samplePng(page, buf, [[1.5 * DSF, o + (r.height * DSF) / 2], ...GAP.map(([u, v]) => [o + u * k, o + v * k]), [o + 18.6 * k, o + 18.4 * k]]);
    if (!([g0, g1_, g2_].every((c) => near(c, bg, 14)) && near(st, [212, 80, 108], 20))) bad.push(i);
  }
  ok(`6 every one of the ${total} permit icons on the page shows its gap and its stamp`, total >= 5 && bad.length === 0, JSON.stringify({ total, bad }));
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
