/* verify-plan-write-race-live — B2540737 (V1981873): a delayed panel save never undoes a move/rotation made while it waited.
 * Real deploy, signed in as the throwaway test account (ui-audit/lib/signedInSession.mjs). Seeds ONE throwaway flyer + comp on the fixture
 * site, opens "Adjust site plan", HOLDS the placement RPC (page.route) and, inside the debounce window, drags the opacity slider (a debounced
 * whole-row save built from the copy captured at slider time) then types a rotation. Pre-fix the opacity save landed LAST with the old
 * rotation and snapped the plan back; the row is read back from the database, then again after a reload.
 * KNOWN-GOOD ARM: the seeded row reads rotation 0 / opacity 0.85 first, and a control rotation (no opacity race) must stick (else VOID).
 * ALWAYS deletes everything it made (owner constraint 15) and verifies it is gone.
 * Usage: node ui-audit/verify-plan-write-race-live.mjs [https://planyr.io]   (needs E2E_LOGIN_KEY) */

import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { mkdirSync } from "node:fs";
const BASE = process.argv[2] || "https://planyr.io";
const OUT = new URL("./screens/", import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (n, ok, x = "") => { console.log(`  ${ok ? "✓" : "✗"} ${n}${x ? ` — ${x}` : ""}`); if (!ok) fail++; };
const section = async (n, fn) => { console.log(`\n— ${n}`); try { await fn(); } catch (e) { check(`${n}: ran to completion`, false, String(e.message || e).split("\n")[0].slice(0, 180)); } };

const s = await openSignedIn({ base: BASE });
const { page } = s;
await assertMeasurable(page, "verify-plan-write-race-live");
const served = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
const chunks = await page.evaluate(() => Array.from(document.querySelectorAll("script[src]")).map((x) => x.src.split("/").pop()).filter((x) => /index/.test(x)).slice(0, 2));
console.log(`build ${served.build} · entry chunk(s) ${chunks.join(",")} · signed in as ${s.proof.email}`);
const ID = "zz-wrace-" + Date.now().toString(36), REV = ID + "-rev", COMP = crypto.randomUUID ? undefined : undefined;
const W = 1275, H = 1650;
const db = (fn, arg) => page.evaluate(fn, arg);

async function seed() {
  return db(async ({ ID, REV, W, H, FIX }) => {
    const sb = window.pfSupabase;
    const { data: au } = await sb.auth.getUser(); const uid = au.user.id;
    const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
    g.fillStyle = "#e8a83c"; g.fillRect(0, 0, W, H); g.fillStyle = "#2f6fb0"; g.beginPath(); g.arc(W / 2, H / 2, W / 4, 0, 7); g.fill();
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
    const key = `${uid}/site-plan-overlays/${ID}.jpg`;
    const steps = {};
    steps.review = (await sb.from("doc_reviews").insert({ id: REV, title: "ZZ wrace-live", kind: "single", data: {} })).error;
    steps.raster = (await sb.storage.from("doc-review-files").upload(key, blob, { contentType: "image/jpeg", upsert: true })).error;
    const ov = await sb.from("site_plan_overlays").insert({ id: crypto.randomUUID(), project_id: FIX, review_id: REV, page: 1, doc_title: "ZZ wrace-live flyer", source_file_name: "ZZ-wrace-live.pdf",
      img_w: W, img_h: H, raster_key: key, center_lat: 29.78, center_lon: -95.82, ft_per_px: 0.5, rotation_deg: 0, opacity: 0.85, visible: true, locked: false }).select("id,version").single();
    steps.overlay = ov.error;
    const comp = await sb.from("comps").insert({ project_id: FIX, comp_type: "lease", comp_date: "2026-01-05", title: "ZZ wrace-live comp", anchor_kind: "pin", lat: 29.78, lon: -95.82, county: "harris",
      lease_rate: 7.5, lease_rate_period: "annual", lease_rate_expense: "nnn", lease_size_sf: 20000 }).select("id").single();
    steps.comp = comp.error;
    return { uid, key, overlayId: ov.data && ov.data.id, compId: comp.data && comp.data.id, errors: Object.fromEntries(Object.entries(steps).filter(([, v]) => v).map(([k, v]) => [k, String(v.message || v)])) };
  }, { ID, REV, W, H, FIX: FIXTURE_SITE_ID });
}
async function cleanup(seeded) {
  if (!seeded) return { gone: true };
  return db(async ({ seeded, REV }) => {
    const sb = window.pfSupabase;
    if (seeded.overlayId) await sb.from("site_plan_overlays").delete().eq("id", seeded.overlayId);
    if (seeded.compId) await sb.from("comps").delete().eq("id", seeded.compId);
    await sb.from("doc_reviews").delete().eq("id", REV);
    if (seeded.key) await sb.storage.from("doc-review-files").remove([seeded.key]);
    const o = seeded.overlayId ? (await sb.from("site_plan_overlays").select("id").eq("id", seeded.overlayId)).data : [];
    const c = seeded.compId ? (await sb.from("comps").select("id").eq("id", seeded.compId)).data : [];
    const r = (await sb.from("doc_reviews").select("id").eq("id", REV)).data;
    return { gone: !(o && o.length) && !(c && c.length) && !(r && r.length) };
  }, { seeded, REV });
}
const row = () => db(async (id) => (await window.pfSupabase.from("site_plan_overlays").select("crop,locked,ft_per_px,rotation_deg,center_lat,center_lon,version,opacity").eq("id", id).single()).data, seeded0.overlayId);
let seeded0 = null;
try {
  seeded0 = await seed();
  check("[setup] throwaway flyer + comp seeded on the test account", !!seeded0.overlayId && !!seeded0.compId && !Object.keys(seeded0.errors).length, JSON.stringify(seeded0.errors));
  if (!seeded0.overlayId || !seeded0.compId) throw new Error("seed failed: " + JSON.stringify(seeded0.errors));
  const vis = (sel) => page.locator(`${sel} >> visible=true`);
  await page.goto(BASE + "/#/site", { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(6000);
  await vis("text=Records").first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await vis("text=ZZ wrace-live comp").first().click({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + "wrace-before-zoom.png" });
  await vis("text=Zoom to").first().click();
  await page.waitForTimeout(3500);
  await vis("button[aria-label='More actions']").nth(1).click();
  await page.waitForTimeout(500);
  await page.locator("text=Adjust >> visible=true").first().click();
  await page.waitForTimeout(1200);
  const panel = page.locator('[data-testid="site-plan-adjust-panel"]');
  check("[setup] Adjust site plan panel is open on the seeded flyer", (await panel.count()) === 1);
  if ((await panel.count()) !== 1) throw new Error("VOID — Adjust panel not reachable");
  const r0 = await row();
  check("known-good arm: the seeded row reads rotation 0 / opacity 0.85", r0.rotation_deg === 0 && Math.abs(r0.opacity - 0.85) < 1e-9, JSON.stringify(r0));
  if (fail) throw new Error("VOID run");
  const rot = panel.locator('input[type="number"][step="0.1"]').first();
  const slider = panel.locator('input[type="range"]').first();

  await section("Control: a rotation with no race sticks", async () => {
    await rot.click(); await rot.fill("10"); await rot.press("Enter"); await page.waitForTimeout(3000);
    const r = await row();
    check("typed 10° saved (instrument can see a normal save)", Math.abs(r.rotation_deg - 10) < 1e-6, `rot ${r.rotation_deg}`);
  });

  await section("Race: debounced opacity save vs a rotation made inside its window, placement RPC held 1.5 s", async () => {
    let held = 0;
    await page.route("**/rest/v1/rpc/commit_site_plan_overlay_placement*", async (route) => { held++; await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
    await slider.fill("0.4");                       // starts the 300 ms debounce; the save is built from this render's copy (rotation 10)
    await rot.click(); await rot.fill("37.5"); await rot.press("Enter");   // the placement commit, inside that window
    await page.waitForTimeout(6000);
    await page.unroute("**/rest/v1/rpc/commit_site_plan_overlay_placement*");
    check("the placement RPC was actually held (the race window existed)", held >= 1, `held ${held}`);
    let r = await row();
    check("after the saves settle the row has BOTH the 37.5° rotation and the 0.4 opacity", Math.abs(r.rotation_deg - 37.5) < 1e-6 && Math.abs(r.opacity - 0.4) < 1e-6, `rot ${r.rotation_deg}, opacity ${r.opacity}`);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 60000 }); await page.waitForTimeout(500);
    r = await row();
    check("after a reload the rotation is still 37.5° and the opacity 0.4", Math.abs(r.rotation_deg - 37.5) < 1e-6 && Math.abs(r.opacity - 0.4) < 1e-6, `rot ${r.rotation_deg}, opacity ${r.opacity}`);
  });
} catch (e) { check("run completed", false, String(e.message || e).slice(0, 200)); }
finally {
  const c = await cleanup(seeded0).catch((e) => ({ gone: false, err: String(e) }));
  check("cleanup: every throwaway row and file is gone (verified)", c.gone === true, c.err || "");
  await s.close();
}
console.log(fail ? `\n✗ ${fail} check(s) failed` : `\n✓ all checks passed on build ${served.build}`);
process.exit(fail ? 1 : 0);
