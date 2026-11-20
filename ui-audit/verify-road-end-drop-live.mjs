/* verify-road-end-drop-live — B2671214 / V2115873 (owner 2026-11-10): a road's control point, dragged and dropped, STAYS where it was dropped, on a drive whose
 * OTHER end is connected to a parking field. (Before the fix the base geometry of the drag was written back over the drop: the end snapped back to where it started.)
 *
 * The REAL tools on a THROWAWAY plan (never a real one): a building with a bonded parking field, a drive road into the field (stamps the connection), a main
 * road ~70 ft off the drive's free end, then:
 *   1  drag the free end onto the main road ~25 ft along   -> it sits on the main road, the main road gained the tee, still there after 2 s AND after a reload
 *   2  drag that junction 4 ft along the main road          -> it moves and stays (also after a reload)
 *   3  drag the building 40 ft, then 300 ft                 -> the 2026-10-29 rule is intact: the field-end follows at 40 ft, lets go at 300 ft
 * KNOWN-GOOD ARMS: the Road tool really connected the drive to the field (VOID otherwise); the main road is really drawn; step 3 is the control for follow.
 * Modes: BASE_URL · SIGNED_IN=1 (test account; the plan row is DELETED and VERIFIED GONE at the end, owner rule 15) · EXPECT_SHA=<merge sha> (read from /version.json in the SAME call).
 *   SIGNED_IN=1 BASE_URL=https://planyr.io EXPECT_SHA=<sha> node ui-audit/verify-road-end-drop-live.mjs */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { addWallLayer } from "./lib/wallLayerDrive.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const EXPECT_SHA = process.env.EXPECT_SHA || "";
const SIGNED = !!process.env.SIGNED_IN;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE_ID = "zz-roadenddrop-" + Math.random().toString(36).slice(2, 8);
const site = { id: SITE_ID, groupId: SITE_ID, site: "ZZ Road End Drop", name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12 };
const PPF = 1.5;

let browser, ctx, page, S = null, UID = null;
const errors = [];
if (SIGNED) {
  S = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; localStorage.setItem("planarfit:startHintDismissed", "1"); }, null]] });
  browser = S.browser; ctx = S.context; page = S.page;
} else {
  const exe = existsSync(chromium.executablePath()) ? undefined : (process.env.PW_CHROME || "/opt/pw-browsers/chromium");
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await page.addInitScript((s) => { try { window.__PLANYR_E2E = true; localStorage.setItem("planarfit:startHintDismissed", "1"); if (!localStorage.getItem("zz-seeded-" + s.id)) { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [s.id]: s })); localStorage.setItem("planarfit:currentSite:v1", s.id); localStorage.setItem("zz-seeded-" + s.id, "1"); } } catch (_) {} }, site);
}
page.on("pageerror", (e) => { if (!/infinite number of tiles/.test(String(e))) errors.push(String(e)); });
await page.route("**/*.jpg", (r) => r.abort());
const T = (id) => page.getByTestId(id);
const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png` }); };
const net = () => page.evaluate(() => (window.__plannerRoadNet ? window.__plannerRoadNet() : null));
const view = () => page.evaluate(() => window.__plannerView.get());
let OFF = { x: 0, y: 0 };   // each case lives on its own patch of the plan, 400 ft apart, so one case's field never meets another's road
const at = async (fx, fy) => { const box = await T("planner-canvas").boundingBox(); const v = await view(); return { x: box.x + v.offX + (fx + OFF.x) * v.ppf, y: box.y + v.offY + (fy + OFF.y) * v.ppf }; };
const click = async (fx, fy, o) => { const p = await at(fx, fy); await page.mouse.click(p.x, p.y, o); };
const planEls = () => page.evaluate(([id, uid]) => { const keys = uid ? ["planarfit:sites:cloud:" + uid, "planarfit:sites:v1"] : ["planarfit:sites:v1"]; for (const k of keys) { const m = JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(k) || "{}"); if (m[id]) return m[id].els || []; } return []; }, [SITE_ID, UID]);
const clipOf = async (id) => ((await net())?.stallClips || []).find((c) => c.id === id) || null;
const center = (fx, fy, ppf = PPF) => page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [fx + OFF.x, fy + OFF.y, ppf]);
const patch = async (ox, oy) => { OFF = { x: ox, y: oy }; await center(0, 0); await sleep(500); };
const seen = new Set();
const newField = async () => { const f = (await planEls()).find((e) => e.type === "parking" && !seen.has(e.id)); if (f) seen.add(f.id); return f; };
const drawField = async (x0, y0, x1, y1) => {
  await page.getByRole("button", { name: "Parking", exact: true }).click();
  const a = await at(x0, y0), b = await at(x1, y1);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up(); await page.keyboard.press("Escape");
};
const drawRoad = async (pts) => {
  await page.getByRole("button", { name: "Road", exact: true }).click();
  for (const [x, y] of pts) await click(x, y);
  await page.keyboard.press("Enter"); await page.keyboard.press("Escape");
};
const clearPlan = async () => { await page.keyboard.press("Escape"); await page.keyboard.press("Control+a"); await page.keyboard.press("Delete"); await sleep(600); };
const openPlan = async () => {
  if (SIGNED) { await page.goto(`${BASE}/#/project/${SITE_ID}/site`, { waitUntil: "load" }); await page.reload({ waitUntil: "load" }); }
  else {
    await page.goto(BASE + "/", { waitUntil: "load" });
    await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click().catch(() => {});
  }
  await T("planner-canvas").waitFor({ timeout: 45000 });
  await sleep(1500);
};

try {
  if (SIGNED) {
    UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
    const ins = await page.evaluate(async (st) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const row = { id: st.id, group_id: st.groupId, site: st.site, name: st.name, county: st.county, updated_at: new Date().toISOString(), data: st, user_id: u.user.id };
      let r = await window.pfSupabase.from("sites").insert(row);
      if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
      return r.error ? String(r.error.message) : null;
    }, site);
    ok("throwaway plan written to the test account", !ins, ins || "");
  }
  await openPlan();
  await assertMeasurable(page, "verify-road-end-drop-live");
  const served = await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build);
  console.log("served build", served);
  if (EXPECT_SHA) ok("the deploy is serving the merge commit", String(served || "").startsWith(EXPECT_SHA.slice(0, 7)), `served ${served}`);
  await center(0, 0);
  await sleep(500);

  // ---- setup · a building, a bonded parking field, a road connected to it ----------------------------------------------------------
  const readEl = async (id) => (await planEls()).find((e) => e.id === id);
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  const a0 = await at(-120, -45), b0 = await at(120, 45);
  await page.mouse.move(a0.x, a0.y); await page.mouse.down();
  await page.mouse.move((a0.x + b0.x) / 2, (a0.y + b0.y) / 2, { steps: 4 }); await page.mouse.move(b0.x, b0.y, { steps: 6 });
  await page.mouse.up();
  await page.getByRole("button", { name: /^Properties$/ }).click();
  const row = page.locator('[data-testid="wall-row"]:not([data-role="dock"])').first();
  await addWallLayer(page, row, "sidewalk", 300);
  await addWallLayer(page, row, "parking", 0);
  await sleep(900);
  const all0 = await planEls();
  const building = all0.find((e) => e.type === "building" && !e.attachedTo);
  const field = building && all0.find((e) => e.type === "parking" && e.attachedTo === building.id);
  ok("known-good arm: the building carries a bonded parking field", !!field, JSON.stringify(all0.map((e) => [e.type, e.attachedTo || null])));
  if (!field) throw new Error("VOID: no bonded parking field");
  const rad = ((field.rot || 0) * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  const ex = Math.abs(c) * field.w / 2 + Math.abs(s) * field.h / 2, ey = Math.abs(s) * field.w / 2 + Math.abs(c) * field.h / 2;
  const dx0 = field.cx - building.cx, dy0 = field.cy - building.cy;
  const face = Math.abs(dy0) >= Math.abs(dx0)
    ? { n: { x: 0, y: Math.sign(dy0) }, inside: { x: field.cx, y: field.cy + Math.sign(dy0) * (ey - 3) } }
    : { n: { x: Math.sign(dx0), y: 0 }, inside: { x: field.cx + Math.sign(dx0) * (ex - 3), y: field.cy } };
  const far = { x: face.inside.x + face.n.x * 90, y: face.inside.y + face.n.y * 90 };
  await page.keyboard.press("Escape");
  await center((far.x + face.inside.x) / 2 - OFF.x, (far.y + face.inside.y) / 2 - OFF.y, PPF);
  await sleep(300);
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await click(far.x - OFF.x, far.y - OFF.y); await click(face.inside.x - OFF.x, face.inside.y - OFF.y);
  await page.keyboard.press("Enter"); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Select V$/ }).click();
  await sleep(900);
  const road0 = (await planEls()).find((e) => e.type === "road");
  ok("known-good arm: the Road tool connected the road to the parking field", !!road0 && road0.driveTee && road0.driveTee.targetId === field.id, road0 ? JSON.stringify(road0.driveTee) : "no road");
  if (!road0 || !road0.driveTee) throw new Error("VOID: road not connected");
  ok("known-good arm: the junction is drawn", (await net()).drives.length === 1);
  await shot("0-connected");
  const last = (r) => r.pts[r.pts.length - 1];
  const mid = { x: building.cx + 90 - OFF.x, y: building.cy + 10 - OFF.y };   // clear of the "Connected" toast, which sits over the middle
  const drag = async (dx, dy, { release = true } = {}) => {
    const p = await at(mid.x, mid.y), q = await at(mid.x + dx, mid.y + dy);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 12 }); await page.mouse.move(q.x, q.y, { steps: 12 });
    if (release) await page.mouse.up();
  };

  // ---- main road, 70 ft out from the drive's free end, 400 ft long --------------------------------------------------------------
  const nrm = face.n, tan = { x: -nrm.y, y: nrm.x }, gap = 70;
  const A = { x: road0.pts[0].x + nrm.x * gap - tan.x * 200, y: road0.pts[0].y + nrm.y * gap - tan.y * 200 };
  const B = { x: road0.pts[0].x + nrm.x * gap + tan.x * 200, y: road0.pts[0].y + nrm.y * gap + tan.y * 200 };
  await page.keyboard.press("Escape");
  await center((A.x + B.x) / 2 - OFF.x, (A.y + B.y) / 2 - OFF.y, 1.0);
  await sleep(300);
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await click(A.x - OFF.x, A.y - OFF.y); await click(B.x - OFF.x, B.y - OFF.y);
  await page.keyboard.press("Enter"); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Select V$/ }).click();
  await sleep(900);
  const roads = (await planEls()).filter((e) => e.type === "road");
  const main0 = roads.find((e) => e.id !== road0.id);
  ok("known-good arm: the main road is drawn", !!main0 && main0.pts.length === 2, `${roads.length} roads`);
  if (!main0) throw new Error("VOID: no main road");
  const distToMain = (p) => Math.abs((B.x - A.x) * (A.y - p.y) - (A.x - p.x) * (B.y - A.y)) / Math.hypot(B.x - A.x, B.y - A.y);
  const driveOf = async () => (await planEls()).find((e) => e.id === road0.id);
  const grab = async (idx, dxFt, dyFt) => {
    const hd = T(`road-vtx-${idx}`), bb = await hd.boundingBox();
    const p = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }, q = { x: p.x + dxFt * PPF, y: p.y + dyFt * PPF };
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 8 }); await page.mouse.move(q.x, q.y, { steps: 8 });
    await page.mouse.up(); await sleep(900);
  };
  const selectDrive = async () => {
    const d = await driveOf();
    await center((d.pts[0].x + d.pts[1].x) / 2 - OFF.x, (d.pts[0].y + d.pts[1].y) / 2 - OFF.y, PPF);
    await sleep(300);
    await page.keyboard.press("Escape");
    await click((d.pts[0].x + d.pts[1].x) / 2 - OFF.x, (d.pts[0].y + d.pts[1].y) / 2 - OFF.y);
    await T("road-vtx-0").waitFor({ timeout: 10000 });
  };

  // ---- 1 · drop the free end onto the main road ----------------------------------------------------------------------------------
  await selectDrive();
  const start = road0.pts[0];
  await grab(0, nrm.x * gap + tan.x * 25, nrm.y * gap + tan.y * 25);
  const d1 = await driveOf();
  ok("1 the dropped end sits on the main road (not snapped back)", distToMain(d1.pts[0]) < 2, `end ${JSON.stringify(d1.pts[0])} started ${JSON.stringify(start)} · ${distToMain(d1.pts[0]).toFixed(1)} ft off the main road`);
  ok("1 it really left its old spot", Math.hypot(d1.pts[0].x - start.x, d1.pts[0].y - start.y) > 50);
  const m1 = (await planEls()).find((e) => e.id === main0.id);
  ok("1 the main road took the tee", m1.pts.length > main0.pts.length, `${main0.pts.length} -> ${m1.pts.length} points`);
  ok("1 the drive is still connected to its field at the other end", !!d1.driveTee && d1.driveTee.targetId === field.id && JSON.stringify(d1.pts[1]) === JSON.stringify(road0.pts[1]));
  await shot("1-dropped");
  await sleep(2000);
  ok("1 still there 2 s later", JSON.stringify((await driveOf()).pts[0]) === JSON.stringify(d1.pts[0]));
  await openPlan();
  await assertMeasurable(page, "verify-road-end-drop-live");
  const d1r = await driveOf();
  ok("1 and after a reload", !!d1r && JSON.stringify(d1r.pts[0]) === JSON.stringify(d1.pts[0]), d1r ? JSON.stringify(d1r.pts[0]) : "no drive");

  // ---- 2 · nudge that junction 4 ft ------------------------------------------------------------------------------------------------
  await selectDrive();
  await grab(0, tan.x * 4, tan.y * 4);
  const d2 = await driveOf();
  const moved2 = Math.hypot(d2.pts[0].x - d1.pts[0].x, d2.pts[0].y - d1.pts[0].y);
  ok("2 a 4 ft nudge of the junction holds", moved2 > 2, `moved ${moved2.toFixed(1)} ft`);
  await sleep(1500);
  await openPlan();
  const d2r = await driveOf();
  ok("2 and after a reload", !!d2r && JSON.stringify(d2r.pts[0]) === JSON.stringify(d2.pts[0]));

  // ---- 3 · the 2026-10-29 follow rule is intact ----------------------------------------------------------------------------------
  await page.keyboard.press("Escape");
  await center(0, 0); await sleep(300);
  const mid3 = { x: building.cx + 90 - OFF.x, y: building.cy + 10 - OFF.y };
  const dragB = async (dx, dy) => {
    const p = await at(mid3.x, mid3.y), q = await at(mid3.x + dx, mid3.y + dy);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 12 }); await page.mouse.move(q.x, q.y, { steps: 12 });
    await page.mouse.up(); await sleep(900);
  };
  const before = await driveOf(), fBefore = (await planEls()).find((e) => e.id === field.id);
  await dragB(40, 25);
  const f3 = (await planEls()).find((e) => e.id === field.id), d3 = await driveOf();
  const fdx = f3.cx - fBefore.cx, fdy = f3.cy - fBefore.cy;
  ok("3 a 40 ft building drag: the field-end followed by the same offset", Math.hypot(fdx, fdy) > 30 && Math.abs(d3.pts[1].x - before.pts[1].x - fdx) < 1 && Math.abs(d3.pts[1].y - before.pts[1].y - fdy) < 1, `field ${fdx.toFixed(1)},${fdy.toFixed(1)} end ${(d3.pts[1].x - before.pts[1].x).toFixed(1)},${(d3.pts[1].y - before.pts[1].y).toFixed(1)}`);
  ok("3 the junction end on the main road did not move", JSON.stringify(d3.pts[0]) === JSON.stringify(before.pts[0]));
  await dragB(300, 0);
  const d4 = await driveOf();
  ok("3 a further 300 ft drag: the drive lets go (record cleared) and stays as drawn", !d4.driveTee && JSON.stringify(d4.pts) === JSON.stringify(d3.pts));
  ok("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) {
  ok("harness ran to the end", false, String(e && e.stack || e).slice(0, 400));
} finally {
  if (SIGNED) {
    const gone = await page.evaluate(async (id) => {
      // the database refuses a permanent delete of a plan that is not in the trash first (sites_block_delete_live_group)
      try { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); } catch (_) {}
      try { await window.pfSupabase.from("site_elements").delete().eq("site_id", id); } catch (_) {}
      await window.pfSupabase.from("sites").delete().eq("id", id);
      const r = await window.pfSupabase.from("sites").select("id").eq("id", id);
      return { cloud: !!r.data && r.data.length === 0 };
    }, SITE_ID).catch((e) => ({ cloud: false, err: String(e) }));
    ok("throwaway plan deleted and verified gone", !!gone.cloud, JSON.stringify(gone));
  }
  await (S ? S.close() : browser.close());
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
