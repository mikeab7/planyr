/* verify-road-parking-approach-live — NEW-1 (road → employee parking, every approach): the REAL tools on a THROWAWAY plan.
 *
 * Draws a car parking field with the Parking tool, then connects roads the way a person does, and reads the finished result through the app's own read-only hooks:
 *   1  a drive crossing a stall ROW → the stalls under it leave the picture and the count (`__plannerRoadNet().stallClips`, the Properties "Stalls" number)
 *   2  a landing a few feet off an aisle's centre → centred on the aisle (the road's stored endpoint, read from the plan itself)
 *   3  a drive running ALONG the aisle-mouth face → one outline opening per aisle (`mouths`)
 *   4  right-click the field's edge → "Add a road from here" → welded
 *   5  Delete the road → the field is whole; Ctrl+Z brings the junction back exactly
 *   6  the export clone carries the same band rows as the canvas
 * A screenshot of each case goes to SHOTS_DIR. KNOWN-GOOD ARM: the field must really be a two-row module with the stall count carStalls gives (VOID otherwise).
 * A throwaway plan only (never a real one): local seed, or with SIGNED_IN=1 a row inserted on the e2e test account that is DELETED AND VERIFIED GONE at the end
 * (owner rule 15). Modes: BASE_URL (default local preview) · SIGNED_IN=1 · EXPECT_SHA=<merge sha> (read from /version.json in the SAME call as the assertions).
 *   PW_CHROME=/opt/pw-browsers/chromium node ui-audit/verify-road-parking-approach-live.mjs      (local)
 *   SIGNED_IN=1 BASE_URL=https://planyr.io EXPECT_SHA=<sha> SHOTS_DIR=/tmp/x node ui-audit/verify-road-parking-approach-live.mjs */
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
const SITE_ID = "zz-roadpark-" + Math.random().toString(36).slice(2, 8);
const site = { id: SITE_ID, groupId: SITE_ID, site: "ZZ Road Parking", name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12 };
const PPF = 3;

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
  await assertMeasurable(page, "verify-road-parking-approach-live");
  const served = await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build);
  console.log("served build", served);
  if (EXPECT_SHA) ok("the deploy is serving the merge commit", String(served || "").startsWith(EXPECT_SHA.slice(0, 7)), `served ${served}`);
  await center(0, 0);
  await sleep(500);

  // ---- 1 · a drive crossing a stall row ------------------------------------------------------------------------------------------
  await patch(0, 0);
  await drawField(-100, -31, 100, 31);
  await sleep(500);
  const field = await newField();
  ok("known-good arm: a parking field was drawn, one full module deep", !!field && field.h > 60 && field.h < 90, field ? `${field.w.toFixed(1)}×${field.h.toFixed(1)}` : "none");
  if (!field) throw new Error("VOID: no field");
  await drawRoad([[0, -100], [0, -28]]);
  await sleep(900);
  let n = await net();
  ok("1 the drive connects to the field with two curb returns", n && n.drives.length === 1 && n.drives[0].wedges === 2 && n.drives[0].kind === "parking", n && JSON.stringify(n.drives.map((d) => [d.kind, d.wedges])));
  const clip = await clipOf(field.id);
  ok("1 the stalls it passes through are removed (3–4 of the crossed row), the count drops by exactly that many", !!clip && clip.removed.length >= 3 && clip.removed.length <= 4 && clip.removed.every((k) => k.startsWith("0:")) && clip.count === clip.base - clip.removed.length, clip && JSON.stringify({ base: clip.base, count: clip.count, removed: clip.removed }));
  await center(0, -20, 6);
  await sleep(700);
  await shot("1-row-side");
  await center(0, 0);
  await sleep(400);
  const gaps = await page.locator(`[data-testid="band-outline-cut"][data-el-id="${field.id}"]`).count();
  ok("1 the crossed row is drawn as two runs (one each side of the gap) plus the far row", gaps >= 3, `band groups ${gaps}`);
  const dc = await at(60, 0);
  await page.mouse.dblclick(dc.x, dc.y);
  const panel = T("property-panel");
  await panel.waitFor({ timeout: 8000 }).catch(() => {});
  ok("1 the Properties card's Stalls number is the clipped count", clip && (await panel.innerText().catch(() => "")).includes(String(clip.count)), clip ? `count ${clip.count}` : "");
  await page.keyboard.press("Escape");

  // ---- 5 · delete / undo / redo ---------------------------------------------------------------------------------------------------
  await click(0, -70);
  await page.keyboard.press("Delete");
  await sleep(700);
  ok("5 Delete the road → no junction, no stall clip: the field is whole", (await net()).drives.length === 0 && (await clipOf(field.id)) === null);
  await page.keyboard.press("Control+z");
  await sleep(900);
  const back = await clipOf(field.id);
  ok("5 Ctrl+Z brings the junction back EXACTLY (same removed stalls)", !!back && !!clip && JSON.stringify(back.removed) === JSON.stringify(clip.removed));
  await page.keyboard.press("Control+y");
  await sleep(700);
  ok("5 Ctrl+Y removes it again", (await clipOf(field.id)) === null);
  await page.keyboard.press("Control+z");
  await sleep(600);
  await click(0, -70); await page.keyboard.press("Delete"); await sleep(500);   // leave the field alone for the next cases

  // ---- 2 · aisle centring ---------------------------------------------------------------------------------------------------------
  const top = field.cy - field.h / 2 - OFF.y, aisleY = top + 30;   // patch-local feet
  await drawRoad([[-170, aisleY + 5], [-98, aisleY + 5]]);
  await sleep(900);
  const r2 = (await planEls()).filter((e) => e.type === "road").pop();
  const end = r2 && r2.pts[r2.pts.length - 1];
  ok("2 a landing 5 ft off the aisle's centre is centred on the aisle (stored endpoint)", !!end && Math.abs(end.y - OFF.y - aisleY) < 0.5 && Math.abs(end.x - OFF.x - (field.cx - OFF.x - field.w / 2)) < 0.5, end ? `end ${end.x.toFixed(2)},${end.y.toFixed(2)} aisle y ${(aisleY + OFF.y).toFixed(2)}` : "no road");
  await center(-100, aisleY, 6);
  await sleep(700);
  await shot("2-aisle-end");
  await center(0, 0);
  await click(-140, aisleY + 5); await page.keyboard.press("Delete"); await sleep(500);

  // ---- 3 · perimeter drive ---------------------------------------------------------------------------------------------------------
  await patch(0, 400);
  await drawField(-100, -61, 100, 61);
  await sleep(500);
  const f3 = await newField();
  await drawRoad([[-114, -100], [-114, 100]]);
  await sleep(900);
  const m3 = ((await net())?.mouths || []).find((m) => m.id === f3.id);
  ok("3 a drive running along the aisle-mouth face opens one outline gap per aisle", !!m3 && m3.mouths.length === 2, m3 ? `mouths ${m3.mouths.length}` : "none");
  await center(-100, 0, 4);
  await sleep(700);
  await shot("3-perimeter");
  await center(0, 0);

  // ---- 4 · Add a road from here ----------------------------------------------------------------------------------------------------
  await patch(0, -400);
  await drawField(-100, -31, 100, 31);
  await sleep(500);
  const f4 = await newField();
  const p4 = await at(-40, -31);
  await page.mouse.click(p4.x, p4.y, { button: "right" });
  const row = T("parking-road-from-here");
  ok("4 right-clicking the field's edge offers 'Add a road from here'", (await row.count()) === 1);
  if ((await row.count()) === 1) {
    await row.click();
    await click(-40, -100);
    await page.keyboard.press("Enter"); await page.keyboard.press("Escape");
    await sleep(900);
    const r4 = (await planEls()).find((e) => e.type === "road" && e.driveTee && e.driveTee.targetId === f4.id);
    ok("4 the new road is welded at the spot, with a stored junction to the field", !!r4 && (await net()).drives.some((d) => d.targetId === f4.id));
    await center(-40, -31, 6); await sleep(700); await shot("4-from-here"); await center(0, 0);
  }

  // ---- 6 · export parity ---------------------------------------------------------------------------------------------------------
  const live = await page.locator(`[data-testid="band-outline-cut"][data-el-id="${f4.id}"]`).count();
  const clone = await page.evaluate(async (id) => { const svg = await window.__plannerExportSvg(); return svg ? new DOMParser().parseFromString(svg, "image/svg+xml").querySelectorAll(`[data-testid="band-outline-cut"][data-el-id="${id}"]`).length : -1; }, f4.id);
  ok("6 the export clone (the flattened PDF's source) carries the same band rows as the canvas", live > 0 && clone === live, `canvas ${live} · export ${clone}`);
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
