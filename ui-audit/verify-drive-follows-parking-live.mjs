/* verify-drive-follows-parking-live — B2498961 (owner 2026-10-29): a road connected to a building's parking FOLLOWS it on a small move and LETS GO on a big one.
 *
 * The REAL tools on a THROWAWAY plan: draw a building, give it a bonded parking field from the Properties panel, connect a road to the field with the Road tool,
 * then drag the building and read the persisted plan + the app's own junction hook:
 *   1  a ~40 ft drag  → the road's LAST point travels with the field (same offset), every other control point stays, the junction stays drawn
 *   2  Ctrl+Z         → ONE step puts the building, the field and the road back; Ctrl+Y replays all three
 *   3  a ~300 ft drag → the road stays exactly where it was drawn, the connection is cleared, no junction is drawn; Ctrl+Z restores the connection
 *   4  the preview is live: with the pointer still DOWN the road already follows, shows let go past the threshold and re-connects when dragged back
 * KNOWN-GOOD ARM: the building really carries a bonded parking field and the Road tool really stamped a connection to it (VOID otherwise).
 * A throwaway plan only (never a real one): local seed, or with SIGNED_IN=1 a row inserted on the e2e test account that is DELETED (trash first) AND VERIFIED GONE
 * at the end (owner rule 15). Modes: BASE_URL (default local preview) · SIGNED_IN=1 · EXPECT_SHA=<merge sha> (read from /version.json in the SAME call).
 *   PW_CHROME=/opt/pw-browsers/chromium node ui-audit/verify-drive-follows-parking-live.mjs      (local)
 *   SIGNED_IN=1 BASE_URL=https://planyr.io EXPECT_SHA=<sha> SHOTS_DIR=/tmp/x node ui-audit/verify-drive-follows-parking-live.mjs */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const EXPECT_SHA = process.env.EXPECT_SHA || "";
const SIGNED = !!process.env.SIGNED_IN;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE_ID = "zz-drivefollow-" + Math.random().toString(36).slice(2, 8);
const site = { id: SITE_ID, groupId: SITE_ID, site: "ZZ Drive Follows Parking", name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12 };
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
const planEls = () => page.evaluate(([id, uid]) => { const keys = uid ? ["planarfit:sites:cloud:" + uid, "planarfit:sites:v1"] : ["planarfit:sites:v1"]; for (const k of keys) { const m = JSON.parse(localStorage.getItem(k) || "{}"); if (m[id]) return m[id].els || []; } return []; }, [SITE_ID, UID]);
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
  await assertMeasurable(page, "verify-drive-follows-parking-live");
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
  await row.getByTestId("wall-add").click(); await page.getByTestId("wall-add-sidewalk").click(); await sleep(300);
  await row.getByTestId("wall-add").click(); await page.getByTestId("wall-add-parking").click();
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

  // ---- 1 · small drag --------------------------------------------------------------------------------------------------------------
  await drag(40, 25);
  await sleep(900);
  const f1 = await readEl(field.id), r1 = await readEl(road0.id);
  const fdx = f1.cx - field.cx, fdy = f1.cy - field.cy;
  ok("1 the building drag moved the bonded field", Math.hypot(fdx, fdy) > 30, `field moved ${fdx.toFixed(1)},${fdy.toFixed(1)}`);
  ok("1 the road's last point went with the field by the SAME offset", Math.abs(last(r1).x - last(road0).x - fdx) < 1 && Math.abs(last(r1).y - last(road0).y - fdy) < 1, `end moved ${(last(r1).x - last(road0).x).toFixed(1)},${(last(r1).y - last(road0).y).toFixed(1)}`);
  ok("1 every other control point stayed exactly where it was drawn", JSON.stringify(r1.pts.slice(0, -1)) === JSON.stringify(road0.pts.slice(0, -1)));
  ok("1 the connection is kept and the junction is still drawn", !!r1.driveTee && r1.driveTee.targetId === field.id && (await net()).drives.length === 1);
  await shot("1-followed");

  // ---- 2 · undo / redo -------------------------------------------------------------------------------------------------------------
  await page.keyboard.press("Control+z");
  await sleep(900);
  const u1 = await readEl(road0.id), uf = await readEl(field.id);
  ok("2 ONE Ctrl+Z puts the road back exactly (and the field with it)", JSON.stringify(u1.pts) === JSON.stringify(road0.pts) && Math.abs(uf.cx - field.cx) < 0.5 && Math.abs(uf.cy - field.cy) < 0.5);
  await page.keyboard.press("Control+y");
  await sleep(900);
  const re = await readEl(road0.id);
  ok("2 Ctrl+Y replays the move AND the follow", Math.abs(last(re).x - last(r1).x) < 0.5 && Math.abs(last(re).y - last(r1).y) < 0.5);
  await page.keyboard.press("Control+z");
  await sleep(700);

  // ---- 3 · big drag ----------------------------------------------------------------------------------------------------------------
  await drag(300, 0);
  await sleep(900);
  const f3 = await readEl(field.id), r3 = await readEl(road0.id);
  ok("3 the field really went far", Math.hypot(f3.cx - field.cx, f3.cy - field.cy) > 200, `moved ${(f3.cx - field.cx).toFixed(0)},${(f3.cy - field.cy).toFixed(0)}`);
  ok("3 the road stayed exactly where it was drawn", JSON.stringify(r3.pts) === JSON.stringify(road0.pts));
  ok("3 its connection is cleared and no junction is drawn", !r3.driveTee && !r3.driveTee2 && (await net()).drives.length === 0);
  await shot("3-let-go");
  await page.keyboard.press("Control+z");
  await sleep(900);
  const u3 = await readEl(road0.id);
  ok("3 Ctrl+Z brings the connection back", !!u3.driveTee && u3.driveTee.targetId === field.id && (await net()).drives.length === 1);

  // ---- 4 · the preview is live ------------------------------------------------------------------------------------------------------
  await drag(40, 0, { release: false });
  ok("4 mid-drag (pointer still down) the junction is drawn to the moved field", (await net()).drives.length === 1);
  const p4 = await at(mid.x + 40, mid.y), q4 = await at(mid.x + 300, mid.y);
  await page.mouse.move((p4.x + q4.x) / 2, (p4.y + q4.y) / 2, { steps: 8 }); await page.mouse.move(q4.x, q4.y, { steps: 8 });
  await sleep(400);
  ok("4 past the threshold the preview shows the road let go, BEFORE the drop", (await net()).drives.length === 0);
  const bk = await at(mid.x + 30, mid.y);
  await page.mouse.move(bk.x, bk.y, { steps: 12 });
  await sleep(400);
  ok("4 dragged back inside it, the connection returns", (await net()).drives.length === 1);
  await page.mouse.up();
  await sleep(700);
  await page.keyboard.press("Control+z");
  await sleep(500);
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
