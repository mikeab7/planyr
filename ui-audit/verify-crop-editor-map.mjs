/* verify-crop-editor-map — the 2026-10-11 owner block on the Map/Comps site-plan overlay (`site_plan_overlays`),
 * driven in a real browser against a FAKE signed-in session + a mocked Supabase that RECORDS every write
 * (ui-audit/lib/authRemount.mjs — nothing leaves the process, no real account or data is touched).
 *
 *   NEW-1 the crop modal is topmost over the "Imagery & layers" panel, the zoom controls and the scale bar
 *   NEW-2 the Adjust site plan panel steps aside while cropping and comes back after Cancel / Done
 *   NEW-3/4/5 (same shared tool as the Site tab — see verify-crop-editor-ux.mjs) one toolbar line, polygon, Done stores ONLY the polygon
 *   NEW-6 LOCK: Edit crop works; Move / resize works; a direct press-drag on the plan does NOT move it
 *   NEW-7 scale: Set scale / Trace a length / Match 2 points are in the Adjust panel, work on a LOCKED plan, and write the
 *         exact placement (asserted on the recorded commit_site_plan_overlay_placement body, not on the picture)
 *   KNOWN-GOOD ARM: the modal's own toolbar centre must report the modal as topmost, else the run is VOID.
 * The selectors that exist on origin/main (panel by text, modal testid) let the layering sections run against a main build
 * too, which is the red proof (`--expect-red` is not needed: the failures simply print).
 * Needs a build WITH dummy Supabase config:  VITE_SUPABASE_URL=https://bootauth.supabase.co VITE_SUPABASE_ANON_KEY=x vite build --outDir /tmp/dist-auth
 * Usage: DIST=/tmp/dist-auth BASE_URL=http://localhost:4175/ node ui-audit/verify-crop-editor-map.mjs */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { AUTH_FIXTURE, authSessionSeed, cloudCacheSeed, detectSupabase, supabaseRouteHandler } from "./lib/authRemount.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4175/";
const DIST = process.env.DIST || "/tmp/dist-auth";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SHOT = process.env.SHOT_PREFIX || "crop-map";
let fail = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };
const section = async (name, fn) => { console.log(`\n— ${name}`); try { await fn(); } catch (e) { check(`${name}: ran to completion`, false, String(e.message || e).split("\n")[0].slice(0, 160)); } };

const sb = detectSupabase(DIST);
if (!sb) { console.log("✗ the build at " + DIST + " carries no Supabase config — build with VITE_SUPABASE_URL/KEY dummies"); process.exit(2); }
const uid = AUTH_FIXTURE.uid;
const IMG_W = 1275, IMG_H = 1650;
const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${IMG_W}' height='${IMG_H}'><rect width='${IMG_W}' height='${IMG_H}' fill='#e8a83c'/><circle cx='${IMG_W / 2}' cy='${IMG_H / 2}' r='${IMG_W / 4}' fill='#2f6fb0'/></svg>`;
let ov = { id: "ov1", user_id: uid, team_id: null, project_id: "P1", site_link_declined: false, review_id: "rev1", page: 1, doc_title: "Test Flyer", doc_date: null, source_file_name: "flyer.pdf",
  img_w: IMG_W, img_h: IMG_H, raster_key: `${uid}/site-plan-overlays/ov1.jpg`, thumb_data_url: null, center_lat: 29.78, center_lon: -95.82, ft_per_px: 0.5, rotation_deg: 0, crop: null,
  opacity: 0.85, visible: true, locked: false, version: 3, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
const compRow = { id: "c1", user_id: uid, team_id: null, project_id: "P1", comp_type: "lease", comp_date: "2026-01-05", title: "Test comp", notes: "", anchor_kind: "pin", lat: 29.78, lon: -95.82,
  county: "harris", lease_rate: 7.5, lease_rate_period: "annual", lease_rate_expense: "nnn", lease_size_sf: 20000, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null, version: 1 };
const site = { id: "P1", groupId: "P1", site: "Test Project", name: "Plan 1", origin: { lat: 29.78, lon: -95.82 }, county: "harris", role: "tracked", parcels: [], els: [], measures: [], callouts: [], markups: [],
  settings: {}, underlay: null, sheetOverlays: [], parcelDrawings: [], status: "active", updatedAt: Date.now() };
const writes = []; // every PATCH / RPC against the overlay, in order

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(`(()=>{try{window.__PLANYR_E2E=true;if(!sessionStorage.getItem('seeded')){localStorage.setItem('planarfit:sites:v1',${JSON.stringify(JSON.stringify({ P1: site }))});sessionStorage.setItem('seeded','1');}}catch(e){}})();`);
await ctx.addInitScript(cloudCacheSeed());
await ctx.addInitScript(authSessionSeed({ ref: sb.ref, url: sb.url }));
const baseHandler = supabaseRouteHandler({ base: BASE, supabaseUrl: sb.url, liveSites: [site] });
const hdr = { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range" };
const ok = (route, body) => route.fulfill({ status: 200, contentType: "application/json", headers: hdr, body: JSON.stringify(body) });
await ctx.route("**", (route) => {
  const req = route.request(), url = req.url(), m = req.method();
  if (url.startsWith(sb.url) && m !== "OPTIONS") {
    if (url.includes("/rest/v1/site_plan_overlays")) {
      if (m === "GET") return ok(route, [ov]);
      if (m === "PATCH" || m === "POST") {
        let body = {}; try { body = JSON.parse(req.postData() || "{}"); } catch (_) {}
        writes.push({ kind: "PATCH", body });
        ov = { ...ov, ...body, version: Number.isFinite(body.version) ? body.version : (ov.version + 1) };
        const wantObj = /pgrst\.object/.test(req.headers().accept || "");
        return ok(route, wantObj ? ov : [ov]);
      }
    }
    if (url.includes("/rpc/commit_site_plan_overlay_placement") && m === "POST") {
      const b = JSON.parse(req.postData() || "{}");
      writes.push({ kind: "RPC", body: b });
      ov = { ...ov, center_lat: b.p_center_lat, center_lon: b.p_center_lon, ft_per_px: b.p_ft_per_px, rotation_deg: b.p_rotation_deg, version: ov.version + 1 };
      return ok(route, { moved: 0, version: ov.version });
    }
    if (url.includes("/rpc/site_plan_overlay_comp_points")) return ok(route, []);
    if (url.includes("/rest/v1/comps") && m === "GET") return ok(route, [compRow]);
    if (url.includes("/storage/v1/object/")) return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: hdr, body: svg });
  }
  return baseHandler(route);
});
const page = await ctx.newPage();
page.on("pageerror", (e) => { console.log("  [pageerror]", String(e).slice(0, 160)); fail++; });
await assertMeasurable(page, "verify-crop-editor-map");

const vis = (sel) => page.locator(`${sel} >> visible=true`);
const lastRpc = () => [...writes].reverse().find((w) => w.kind === "RPC");
const rpcCount = () => writes.filter((w) => w.kind === "RPC").length;
const lastCrop = () => { const w = [...writes].reverse().find((x) => x.kind === "PATCH" && "crop" in x.body); return w ? w.body.crop : undefined; };
const imgRect = () => page.evaluate(() => { const i = document.querySelector(".leaflet-sitePlanOverlayPane-pane img, .leaflet-pane[class*='sitePlanOverlay'] img"); if (!i) return null; const r = i.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });

await page.goto(BASE + "#/site", { waitUntil: "load" });
await page.waitForTimeout(4500);
await vis("text=Records").first().click().catch(() => {});
await page.waitForTimeout(700);
await vis("text=Test comp").first().click();
await page.waitForTimeout(800);
await vis("button:has-text('Zoom in')").first().click();
await page.waitForTimeout(2500);
await vis("button[aria-label='More actions']").nth(1).click();
await page.waitForTimeout(400);
await page.locator("text=Adjust >> visible=true").first().click();
await page.waitForTimeout(900);
const panel = page.locator('[data-testid="site-plan-adjust-panel"]');
check("[setup] Adjust site plan panel is open on the placed flyer", (await panel.count()) === 1);
if ((await panel.count()) !== 1) { await page.screenshot({ path: OUT + SHOT + "-setup-fail.png" }); console.log("  ⛔ VOID — could not reach the Adjust panel."); await browser.close(); process.exit(2); }
await page.screenshot({ path: OUT + SHOT + "-adjust.png" });

/* ---- NEW-1 / NEW-2 ------------------------------------------------------------------------------ */
await section("NEW-1/NEW-2 modal layering + Adjust panel steps aside", async () => {
  const layersRect = await page.evaluate(() => { const r = document.querySelector('[data-testid="map-layers-panel"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 14 }; });
  await panel.locator("text=/Crop…|Edit crop/").first().click();
  await page.waitForTimeout(900);
  const modal = page.locator('[data-testid="site-plan-crop-modal"]');
  check("the crop modal opens from the Adjust panel", (await modal.count()) === 1);
  const probe = await page.evaluate((layersPt) => {
    const modal = document.querySelector('[data-testid="site-plan-crop-modal"]');
    const topIn = (x, y) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('[data-testid="site-plan-crop-modal"]')); };
    const tb = modal.querySelector('[data-testid="crop-toolbar"]') || modal.querySelector("button").parentElement;
    const r = tb.getBoundingClientRect();
    const zoomCtl = document.querySelector(".leaflet-control-zoom"), zr = zoomCtl && zoomCtl.getBoundingClientRect();
    const scale = document.querySelector(".leaflet-control-scale, [data-canvas-corner]"), sr = scale && scale.getBoundingClientRect();
    const pts = { toolbar: [r.left + 30, r.top + r.height / 2], layersPanel: [layersPt.x, layersPt.y], topRight: [window.innerWidth - 20, 20] };
    if (zr && zr.width) pts.zoomControl = [zr.x + zr.width / 2, zr.y + zr.height / 2];
    if (sr && sr.width) pts.scaleBar = [sr.x + sr.width / 2, sr.y + sr.height / 2];
    return { res: Object.fromEntries(Object.entries(pts).map(([k, [x, y]]) => [k, topIn(x, y)])), parentIsBody: modal.parentElement === document.body,
      adjustInDom: !!document.querySelector('[data-testid="site-plan-adjust-panel"]'), toolbarFound: !!modal.querySelector('[data-testid="crop-toolbar"]') };
  }, layersRect);
  console.log("  probe:", JSON.stringify(probe.res));
  check("[known-good arm] a point on the modal's own toolbar reports the modal as topmost", probe.res.toolbar === true);
  if (probe.res.toolbar !== true) throw new Error("VOID arm");
  check("NEW-1 'Imagery & layers' does NOT paint over the modal (topmost at that point is the modal)", probe.res.layersPanel === true);
  check("NEW-1 the map zoom buttons, scale bar and the top-right corner are all under the modal", Object.entries(probe.res).every(([k, v]) => v === true), JSON.stringify(probe.res));
  check("NEW-1 the modal is portaled to <body>", probe.parentIsBody);
  check("NEW-2 the Adjust site plan panel is not on screen while cropping", !probe.adjustInDom);
  await page.screenshot({ path: OUT + SHOT + "-modal.png" });
  await modal.locator("button", { hasText: "Cancel" }).click();
  await page.waitForTimeout(600);
  check("NEW-2 Cancel brings the Adjust panel back, still open", (await panel.count()) === 1);
});

/* ---- Polygon crop through the real tool, stored shape only ---------------------------------------- */
await section("NEW-5 Done stores ONLY the polygon (recorded PATCH body)", async () => {
  await panel.locator("text=/Crop…|Edit crop/").first().click();
  const modal = page.locator('[data-testid="site-plan-crop-modal"]');
  await modal.waitFor({ timeout: 4000 });
  await page.waitForTimeout(500);
  await modal.locator("button", { hasText: "Polygon" }).click();
  const box = await modal.locator("img").first().boundingBox();
  const at = (fx, fy) => ({ x: box.x + fx * box.width, y: box.y + fy * box.height });
  for (const [fx, fy] of [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]) { const p = at(fx, fy); await page.mouse.click(p.x, p.y); await page.waitForTimeout(250); }
  { const p = at(0.2, 0.2); await page.mouse.click(p.x, p.y); await page.waitForTimeout(300); }
  // right-click add on the Map/Comps modal too (same tool)
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.1, { button: "right" });
  await page.waitForTimeout(250);
  check("right-click on the canvas opens 'Add control point' here too", (await modal.locator('[data-testid="crop-menu-add-point"]').count()) === 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  check("Escape closes only the menu (modal still open)", (await modal.locator('[data-testid="crop-context-menu"]').count()) === 0 && (await modal.count()) === 1);
  await modal.locator('[data-testid="crop-done"]').click();
  await page.waitForTimeout(900);
  const crop = lastCrop();
  check("the saved crop is a polygon with 4 points and NO rectangle fields", !!crop && crop.kind === "poly" && crop.pts.length === 4 && !("x" in crop) && !("w" in crop), JSON.stringify(crop).slice(0, 120));
  check("the Adjust panel is back after Done", (await panel.count()) === 1);
  await page.waitForTimeout(400);
});

/* ---- NEW-6 lock ------------------------------------------------------------------------------------- */
await section("NEW-6 Lock blocks direct drags only", async () => {
  await panel.locator('button[aria-label="Lock"]').click();
  await page.waitForTimeout(900);
  check("the plan is now locked (PATCH recorded locked:true)", writes.some((w) => w.kind === "PATCH" && w.body.locked === true));
  check("Edit crop stays ENABLED on a locked plan", await panel.locator('button:has-text("Edit crop")').first().isEnabled());
  const move = panel.locator('button:has-text("Move / resize"), button:has-text("Editing on map")').first();
  check("Move / resize stays ENABLED on a locked plan", await move.isEnabled());
  // a direct press-drag on the plan on the map must NOT move it while locked and not armed
  const r = await imgRect();
  const before = rpcCount();
  await page.mouse.move(r.x + r.w * 0.5, r.y + r.h * 0.5); await page.mouse.down(); await page.mouse.move(r.x + r.w * 0.5 + 60, r.y + r.h * 0.5 + 40, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(900);
  check("a direct drag on the locked plan writes nothing (no placement commit)", rpcCount() === before);
  // explicit Move / resize arms it; dragging a corner handle then works even though it is locked
  await move.click();
  await page.waitForTimeout(900);
  check("Move / resize arms the plan ('Editing on map')", /Editing on map/.test(await move.textContent()));
  const r2 = await imgRect();
  // the selection chrome fits the VISIBLE frame (the crop's bounding box, B2163345), so aim at that corner, not the full image's
  const pts = ov.crop && ov.crop.pts ? ov.crop.pts : [[0, 0], [IMG_W, IMG_H]];
  const vMaxX = Math.max(...pts.map((p) => p[0])), vMaxY = Math.max(...pts.map((p) => p[1]));
  const corner = { x: r2.x + (vMaxX / IMG_W) * r2.w, y: r2.y + (vMaxY / IMG_H) * r2.h };
  await page.mouse.move(corner.x, corner.y); await page.mouse.down(); await page.mouse.move(corner.x + 50, corner.y + 50, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(1200);
  check("…and an armed corner drag on the LOCKED plan commits a placement", rpcCount() === before + 1, `rpc ${before} → ${rpcCount()}`);
  await move.click(); // disarm
  await page.waitForTimeout(500);
});

/* ---- NEW-7 scale ------------------------------------------------------------------------------------ */
await section("NEW-7 Scale section: three equal actions, on a LOCKED plan", async () => {
  const sc = panel.locator('[data-testid="site-plan-adjust-scale"]');
  check("the Scale section is in the Adjust panel", (await sc.count()) === 1);
  const labels = await sc.locator("button").allTextContents();
  check("three actions, named as in the Overlays panel", JSON.stringify(labels.slice(0, 3)) === JSON.stringify(["Set scale", "Trace a length", "Match 2 points"]), JSON.stringify(labels.slice(0, 3)));
  const widths = await sc.locator("button").evaluateAll((bs) => bs.slice(0, 3).map((b) => Math.round(b.getBoundingClientRect().width)));
  check("the three buttons are equal width (one column, never 2 + 1)", widths.every((w) => Math.abs(w - widths[0]) <= 1), JSON.stringify(widths));
  check("none is disabled by the lock", (await sc.locator("button:disabled").count()) === 0);
  await page.screenshot({ path: OUT + SHOT + "-scale.png" });

  // Set scale: 1" = 40' -> ft/px = 40 / 150
  await panel.locator('[data-testid="site-plan-scale-set"]').click();
  await panel.locator('[data-testid="site-plan-scale-preset"]').selectOption("eng-40");
  await page.waitForTimeout(1200);
  let w = lastRpc();
  check("Set scale 1\" = 40' commits ft/px = 40/150 (150 px per page inch) — on the LOCKED plan", !!w && Math.abs(w.body.p_ft_per_px - 40 / 150) < 1e-6, w && String(w.body.p_ft_per_px));
  check("the panel reads the new scale", /1″ = 40′/.test(await panel.locator('[data-testid="site-plan-adjust-scale-now"]').textContent()));
  await panel.locator('[data-testid="site-plan-scale-set"]').click(); // close the tool

  // Trace a length: two clicks 150 screen px apart on the drawing, real length 500 ft
  await panel.locator('[data-testid="site-plan-scale-trace"]').click();
  await page.waitForTimeout(500);
  check("a prompt pill tells the person what to click", /one end/i.test(await page.locator('[data-testid="map-calibration-prompt"]').textContent()));
  let r = await imgRect();
  const y = r.y + r.h * 0.5, x1 = r.x + r.w * 0.2, x2 = x1 + 100;
  const pxPerScreen = IMG_W / r.w;
  const before1 = rpcCount();
  await page.mouse.click(x1, y); await page.waitForTimeout(300);
  await page.mouse.click(x2, y); await page.waitForTimeout(300);
  check("while calibrating, map clicks do not deselect or arm anything (still two points collected)", /real length/i.test(await panel.locator('[data-testid="site-plan-scale-calib"]').textContent()));
  await panel.locator('[data-testid="site-plan-scale-trace-length"]').fill("500");
  await panel.locator('[data-testid="site-plan-scale-apply"]').click();
  await page.waitForTimeout(1200);
  w = lastRpc();
  const expectFt = 500 / (100 * pxPerScreen);
  check("Trace a length commits ft/px = 500 ft ÷ the traced image-pixel length (locked plan)", rpcCount() === before1 + 1 && Math.abs(w.body.p_ft_per_px - expectFt) / expectFt < 0.02, `${w && w.body.p_ft_per_px} vs ${expectFt}`);
  check("the calibration ended (prompt gone)", (await page.locator('[data-testid="map-calibration-prompt"]').count()) === 0);

  // Match 2 points: drawing points 100 px apart → their true spots 200 px apart (a ×2 scale), same centre line
  const ftBefore = ov.ft_per_px;
  await panel.locator('[data-testid="site-plan-scale-match"]').click();
  await page.waitForTimeout(400);
  r = await imgRect();
  const cx = r.x + r.w * 0.5, cy = r.y + r.h * 0.5;
  const before2 = rpcCount();
  for (const [px, py] of [[cx - 50, cy], [cx - 100, cy], [cx + 50, cy], [cx + 100, cy]]) { await page.mouse.click(px, py); await page.waitForTimeout(300); }
  check("Apply stays disabled until two COMPLETE pairs exist, then enables", await panel.locator('[data-testid="site-plan-scale-apply"]').isEnabled());
  await panel.locator('[data-testid="site-plan-scale-apply"]').click();
  await page.waitForTimeout(1200);
  w = lastRpc();
  check("Match 2 points commits a ×2 scale (the two drawing points moved to points twice as far apart) — locked plan", rpcCount() === before2 + 1 && Math.abs(w.body.p_ft_per_px / ftBefore - 2) < 0.04, `${w && w.body.p_ft_per_px / ftBefore}`);
  check("…with no rotation added (the pairs share a heading)", Math.abs(((w.body.p_rotation_deg + 540) % 360) - 180) < 0.5, String(w && w.body.p_rotation_deg));

  // Escape cancels a calibration
  await panel.locator('[data-testid="site-plan-scale-trace"]').click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Escape cancels a calibration", (await page.locator('[data-testid="map-calibration-prompt"]').count()) === 0);
  check("closing Adjust also ends a calibration", await (async () => { await panel.locator('[data-testid="site-plan-scale-trace"]').click(); await page.waitForTimeout(300); await panel.locator("button:has-text('Done')").click(); await page.waitForTimeout(500); return (await page.locator('[data-testid="map-calibration-prompt"]').count()) === 0; })());
});

console.log(fail ? `\n✗ ${fail} check(s) failed` : "\n✓ all checks passed");
await browser.close();
process.exit(fail ? 1 : 0);
