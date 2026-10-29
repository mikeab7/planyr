/* verify-crop-contained-live — B2448816 / B2448817 (V1892320) on a REAL deploy, signed in as the throwaway test account.
 *
 * The same in-page probe as the sandbox harness (ui-audit/lib/cropContainment.mjs): zoom the crop deep and require that every
 * control (Rectangle | Polygon switch, Cancel, Done, the toolbar) answers its own press, that nothing the crop draws has a box past
 * `crop-canvas`, and that a real click on Polygon switches the mode.
 *   1. Site tab: a THROWAWAY plan (seeded through the app's own cache path, never one of Michael's) with a sheet overlay → Overlays → Crop.
 *   2. Map/Comps: the add-a-site-plan flow → a generated PNG → "Crop…" opens the FULL-SIZE window → same probe → Cancel.
 *      The flow is never taken past Cancel ("Place on map" would write), so it creates nothing.
 * The throwaway plan is ALWAYS deleted and confirmed gone (owner constraint 7/15). The served build is read from /version.json in the same run.
 * KNOWN-GOOD ARM: the toolbar answers before zooming, and the deep zoom is reached — else the run is VOID (exit 2).
 *
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=… node ui-audit/verify-crop-contained-live.mjs [--expect-build <sha>] */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openCropEditor } from "./lib/overlayCropPanel.mjs";
import { readCropPage, zoomCropIn } from "./lib/cropContainment.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const EXPECT = (() => { const i = process.argv.indexOf("--expect-build"); return i > 0 ? process.argv[i + 1] : ""; })();
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = "zz-cc-" + Math.random().toString(36).slice(2, 7);
const ID = `${RUN}-U`, NAME = `ZZ CC ${RUN.slice(-5)}`;
const W = 1275, H = 1650;
const SKETCH = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}'><rect width='${W}' height='${H}' fill='#e8a83c'/><circle cx='${W / 2}' cy='${H / 2}' r='${W / 4}' fill='#2f6fb0'/></svg>`);
const site = { id: ID, groupId: ID, site: NAME, name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris", status: "active", schemaVersion: 12, updatedAt: Date.now(),
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 700 }, { x: 0, y: 700 }], active: true, z: 0 }],
  sheetOverlays: [{ id: "ov1", name: "Fixture sheet.png", src: SKETCH, x: 100, y: 100, imgW: W, imgH: H, ftPerPx: 0.5, rotation: 0, opacity: 0.85, locked: false, visible: true }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [] };

const s = await openSignedIn({ base: BASE });
const { browser, page } = s;
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
const buildNow = () => page.evaluate(async () => { try { return await (await fetch("/version.json", { cache: "no-store" })).json(); } catch (_) { return null; } });
const T = (id) => page.getByTestId(id);

async function probe(tag) {
  await T("crop-canvas").waitFor({ state: "visible", timeout: 15000 });
  await sleep(600);
  const before = await readCropPage(page);
  if (before.ctl["crop-zoom-in"] !== "ok") { console.log(`VOID — ${tag}: the toolbar does not answer before zooming`); throw Object.assign(new Error("VOID"), { void: true }); }
  const z = await zoomCropIn(page, 800);
  if (z < 400) { console.log(`VOID — ${tag}: deep zoom not reached (${z}%)`); throw Object.assign(new Error("VOID"), { void: true }); }
  await sleep(300);
  const st = await readCropPage(page);
  const blocked = Object.entries(st.ctl).filter(([, v]) => String(v).startsWith("BLOCKED"));
  ok(`[${tag}] at ${st.zoom}% every control answers its own press (switch, Cancel, Done, toolbar)`, blocked.length === 0, blocked.map(([k, v]) => `${k}→${v}`).join(", "));
  ok(`[${tag}] nothing the crop draws reaches past the canvas`, st.outside.length === 0, JSON.stringify(st.outside.slice(0, 3)));
  const bad = st.grips.filter((g) => !g.inside || !g.hitsSelf);
  ok(`[${tag}] every grip shown is whole and grabbable`, bad.length === 0, JSON.stringify(bad.slice(0, 3)));
  await T("crop-mode-poly").click({ timeout: 4000 }).catch(() => {});
  await sleep(300);
  ok(`[${tag}] a real click on Polygon switches the mode`, (await readCropPage(page)).polyHint === true);
  await T("crop-cancel").click({ timeout: 4000 }).catch(() => {});
  await sleep(500);
}

let voided = false;
try {
  const v = await buildNow();
  console.log("signed in as", s.proof.email, "| served build", JSON.stringify(v));
  if (EXPECT) ok(`the served build is the one under test (${EXPECT.slice(0, 7)})`, JSON.stringify(v || {}).includes(EXPECT.slice(0, 7)), JSON.stringify(v));
  console.log("chunks:", (await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((e) => e.getAttribute("src").split("/").pop()).join(","))).slice(0, 220));

  // ---- 1. Site tab on a throwaway plan
  await page.evaluate(([uid, sites]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify(sites)); localStorage.setItem("planarfit:currentSite:v1", Object.keys(sites)[0]); }, [UID, { [ID]: site }]);
  await page.goto(`${BASE}/#/site-planner`, { waitUntil: "load" });
  await page.getByText(NAME, { exact: false }).filter({ visible: true }).first().evaluate((el) => el.click(), null, { timeout: 45000 });
  await T("planner-canvas").waitFor({ timeout: 45000 });
  await sleep(2000);
  for (let i = 0; i < 3 && (await page.locator(".psw-panel").count()); i++) { await page.keyboard.press("Escape"); await sleep(500); }
  await assertMeasurable(page, "verify-crop-contained-live");
  await page.locator('[data-rail-tab="references"]').first().evaluate((el) => el.click());
  await sleep(900);
  const row = T("reference-open-ov1");
  await row.waitFor({ timeout: 20000 });
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.evaluate((el) => el.click());
  await sleep(500);
  await openCropEditor(page, "ov1");
  await probe("site-tab");

  // ---- 2. Map/Comps pre-placement (no write: stops at Cancel)
  await page.goto(`${BASE}/#/site`, { waitUntil: "load" });
  await sleep(4500);
  await page.locator("text=Records >> visible=true").first().click().catch(() => {});
  await sleep(800);
  const up = page.locator('[title="Upload a broker flyer or park plan"] >> visible=true').first();
  const reach = await up.count().then((n) => n > 0);
  ok("the add-a-site-plan entry is reachable on the Map Records rail", reach);
  if (reach) {
    await up.click();
    await sleep(700);
    const b64 = await page.evaluate(({ w, h }) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); g.fillStyle = "#e8a83c"; g.fillRect(0, 0, w, h); g.fillStyle = "#2f6fb0"; g.beginPath(); g.arc(w / 2, h / 2, w / 4, 0, 7); g.fill(); return c.toDataURL("image/png").split(",")[1]; }, { w: W, h: H });
    await page.locator('input[type="file"]').first().setInputFiles({ name: "zz-crop-check.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") });
    const cropBtn = page.getByTestId("site-plan-flow-crop");
    await cropBtn.waitFor({ timeout: 20000 });
    await cropBtn.click();
    const mb = await page.locator('[data-testid="site-plan-precrop-modal"] [role="dialog"]').boundingBox();
    const vp = page.viewportSize();
    ok("pre-placement Crop opens the full-size window (≥ 90% of the window both ways)", mb && mb.width >= 0.9 * vp.width && mb.height >= 0.9 * vp.height, mb ? `${Math.round(mb.width)}×${Math.round(mb.height)} of ${vp.width}×${vp.height}` : "no modal");
    await probe("map-preplace");
    ok("Cancel returns to the placement step with no crop (button still reads Crop…)", /Crop…/.test(await cropBtn.textContent()));
    // leave the flow without placing: Cancel on the step itself
    await page.getByRole("button", { name: "Cancel", exact: true }).filter({ visible: true }).first().click().catch(() => {});
  }
  ok("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} catch (e) {
  if (e.void) voided = true; else { console.error("HARNESS ERROR:", e.message); ok("harness ran to completion", false, e.message); }
} finally {
  const gone = await page.evaluate(async ([id, uid]) => {
    await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
    await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    await window.pfSupabase.from("sites").delete().eq("id", id);
    const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
    try { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } catch (e) {}
    return !q.error && !(q.data || []).length;
  }, [ID, UID]).catch(() => false);
  ok("the throwaway plan is deleted and confirmed gone from the cloud", gone);
  await browser.close();
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed${voided ? " — RUN VOID" : ""}`);
process.exit(voided ? 2 : fails.length ? 1 : 0);
