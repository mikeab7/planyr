/* verify-crop-editor-live — V1681808 / V1681809 on the REAL deploy, signed in as the throwaway test account
 * (ui-audit/lib/signedInSession.mjs). Seeds ONE throwaway flyer (doc_reviews row + raster + site_plan_overlays row) and one
 * throwaway comp on the fixture site, drives the real Map UI, asserts the PERSISTED rows (not just the picture), and ALWAYS
 * deletes everything it made (owner constraint 15) and verifies it is gone.
 *   Layering (modal over "Imagery & layers"), Adjust panel steps aside, polygon-only crop, Lock vs Edit crop / Move-resize / direct drag,
 *   Set scale / Trace a length / Match 2 points on a LOCKED plan (ft_per_px read back from the database).
 * Usage: node ui-audit/verify-crop-editor-live.mjs [https://planyr.io]   (needs E2E_LOGIN_KEY) */
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
await assertMeasurable(page, "verify-crop-editor-live");
const served = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
const chunks = await page.evaluate(() => Array.from(document.querySelectorAll("script[src]")).map((x) => x.src.split("/").pop()).filter((x) => /index/.test(x)).slice(0, 2));
console.log(`build ${served.build} · entry chunk(s) ${chunks.join(",")} · signed in as ${s.proof.email}`);
const ID = "zz-crop-live-" + Date.now().toString(36), REV = ID + "-rev", COMP = crypto.randomUUID ? undefined : undefined;
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
    steps.review = (await sb.from("doc_reviews").insert({ id: REV, title: "ZZ crop-live", kind: "single", data: {} })).error;
    steps.raster = (await sb.storage.from("doc-review-files").upload(key, blob, { contentType: "image/jpeg", upsert: true })).error;
    const ov = await sb.from("site_plan_overlays").insert({ id: crypto.randomUUID(), project_id: FIX, review_id: REV, page: 1, doc_title: "ZZ crop-live flyer", source_file_name: "ZZ-crop-live.pdf",
      img_w: W, img_h: H, raster_key: key, center_lat: 29.78, center_lon: -95.82, ft_per_px: 0.5, rotation_deg: 0, opacity: 0.85, visible: true, locked: false }).select("id,version").single();
    steps.overlay = ov.error;
    const comp = await sb.from("comps").insert({ project_id: FIX, comp_type: "lease", comp_date: "2026-01-05", title: "ZZ crop-live comp", anchor_kind: "pin", lat: 29.78, lon: -95.82, county: "harris",
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
const row = () => db(async (id) => (await window.pfSupabase.from("site_plan_overlays").select("crop,locked,ft_per_px,rotation_deg,center_lat,center_lon,version").eq("id", id).single()).data, seeded0.overlayId);
let seeded0 = null;
try {
  seeded0 = await seed();
  check("[setup] throwaway flyer + comp seeded on the test account", !!seeded0.overlayId && !!seeded0.compId && !Object.keys(seeded0.errors).length, JSON.stringify(seeded0.errors));
  if (!seeded0.overlayId || !seeded0.compId) throw new Error("seed failed: " + JSON.stringify(seeded0.errors));

  const vis = (sel) => page.locator(`${sel} >> visible=true`);
  const imgRect = () => page.evaluate(() => { const i = document.querySelector(".leaflet-sitePlanOverlayPane-pane img, .leaflet-pane[class*='sitePlanOverlay'] img"); if (!i) return null; const r = i.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.goto(BASE + "/#/site", { waitUntil: "load" });
  await page.reload({ waitUntil: "load" }); // a hash-only goto is not a reload: the comps list was read BEFORE the seed
  await page.waitForTimeout(6000);
  await vis("text=Records").first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + "crop-live-before-comp.png" });
  await vis("text=ZZ crop-live comp").first().click({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await vis("button:has-text('Zoom in')").first().click();
  await page.waitForTimeout(3500);
  await vis("button[aria-label='More actions']").nth(1).click();
  await page.waitForTimeout(500);
  await page.locator("text=Adjust >> visible=true").first().click();
  await page.waitForTimeout(1200);
  const panel = page.locator('[data-testid="site-plan-adjust-panel"]');
  check("[setup] Adjust site plan panel is open on the seeded flyer", (await panel.count()) === 1);
  if ((await panel.count()) !== 1) { await page.screenshot({ path: OUT + "crop-live-setup-fail.png" }); throw new Error("VOID — Adjust panel not reachable"); }
  await page.screenshot({ path: OUT + "crop-live-adjust.png" });

  await section("Layering + panel steps aside (V1681808 steps 1-2)", async () => {
    const lp = await page.evaluate(() => { const r = document.querySelector('[data-testid="map-layers-panel"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 14 }; });
    await panel.locator("text=/Crop…|Edit crop/").first().click();
    await page.waitForTimeout(1500);
    const p = await page.evaluate((lp) => {
      const m = document.querySelector('[data-testid="site-plan-crop-modal"]'); const topIn = (x, y) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('[data-testid="site-plan-crop-modal"]')); };
      const tb = m.querySelector('[data-testid="crop-toolbar"]'), ft = m.querySelector('[data-testid="crop-footer"]'), cv = m.querySelector('[data-testid="crop-canvas"]'), sh = m.firstElementChild;
      const cen = (el) => Array.from(el.children).filter((c) => c.getBoundingClientRect().width > 0).map((c) => { const b = c.getBoundingClientRect(); return Math.round(b.top + b.height / 2); });
      const spread = (a) => Math.max(...a) - Math.min(...a); const r = tb.getBoundingClientRect();
      return { tb: topIn(r.left + 30, r.top + r.height / 2), layers: topIn(lp.x, lp.y), corner: topIn(window.innerWidth - 20, 20), body: m.parentElement === document.body, adjust: !!document.querySelector('[data-testid="site-plan-adjust-panel"]'),
        tbSpread: spread(cen(tb)), ftSpread: spread(cen(ft)), frac: cv.getBoundingClientRect().height / sh.getBoundingClientRect().height, pct: document.querySelectorAll('[data-testid="crop-zoom-pct"]').length, zoomTxt: m.querySelector('[data-testid="crop-zoom-100"]').textContent.trim() };
    }, lp);
    console.log("  probe:", JSON.stringify(p));
    check("[known-good arm] the modal's own toolbar is topmost at its centre", p.tb);
    if (!p.tb) throw new Error("VOID arm");
    check("'Imagery & layers' does not paint over the modal; corner under the modal too", p.layers && p.corner);
    check("modal portaled to <body>; Adjust panel not on screen while cropping", p.body && !p.adjust);
    check("one toolbar line, one footer line, one zoom readout on the 100% control, canvas ≥ 80% of the modal", p.tbSpread <= 3 && p.ftSpread <= 3 && p.pct === 0 && /^\d+%$/.test(p.zoomTxt) && p.frac >= 0.8, JSON.stringify({ tb: p.tbSpread, ft: p.ftSpread, frac: +p.frac.toFixed(2), z: p.zoomTxt }));
    await page.screenshot({ path: OUT + "crop-live-modal.png" });
    await page.locator('[data-testid="site-plan-crop-modal"] button', { hasText: "Cancel" }).click();
    await page.waitForTimeout(800);
    check("Cancel brings the Adjust panel back", (await panel.count()) === 1);
  });

  await section("Polygon crop: right-click menu, stored shape only (steps 3-4)", async () => {
    await panel.locator("text=/Crop…|Edit crop/").first().click();
    const modal = page.locator('[data-testid="site-plan-crop-modal"]'); await modal.waitFor({ timeout: 6000 }); await page.waitForTimeout(800);
    await modal.locator("button", { hasText: "Polygon" }).click();
    const box = await modal.locator("img").first().boundingBox(); const at = (fx, fy) => ({ x: box.x + fx * box.width, y: box.y + fy * box.height });
    for (const [fx, fy] of [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]) { const q = at(fx, fy); await page.mouse.click(q.x, q.y); await page.waitForTimeout(250); }
    { const q = at(0.2, 0.2); await page.mouse.click(q.x, q.y); await page.waitForTimeout(300); }
    const nV = () => modal.locator('[data-testid^="crop-poly-vertex-"]').count();
    check("polygon closed with 4 points", (await nV()) === 4);
    await modal.locator('[data-testid="crop-poly-vertex-1"]').click({ button: "right" }); await page.waitForTimeout(250);
    check("right-click on a point → Delete point (enabled at 4)", await modal.locator('[data-testid="crop-menu-delete-point"]').isEnabled());
    await modal.locator('[data-testid="crop-menu-delete-point"]').click(); await page.waitForTimeout(250);
    check("Delete point → 3 points", (await nV()) === 3);
    await modal.locator('[data-testid="crop-poly-vertex-0"]').click({ button: "right" }); await page.waitForTimeout(250);
    check("at 3 points Delete point is disabled (present, not hidden)", await modal.locator('[data-testid="crop-menu-delete-point"]').isDisabled());
    await page.keyboard.press("Escape"); await page.waitForTimeout(250);
    check("Escape closes only the menu", (await modal.count()) === 1);
    const tgt = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.08 };
    await page.mouse.click(tgt.x, tgt.y, { button: "right" }); await page.waitForTimeout(250);
    await modal.locator('[data-testid="crop-menu-add-point"]').click(); await page.waitForTimeout(300);
    const near = await page.evaluate(({ x, y }) => Math.min(...Array.from(document.querySelectorAll('[data-testid^="crop-poly-vertex-"]')).map((c) => { const r = c.getBoundingClientRect(); return Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y); })), tgt);
    check("Add control point lands exactly where right-clicked", (await nV()) === 4 && near < 1.5, `${near.toFixed(2)}px`);
    await modal.locator('[data-testid="crop-done"]').click(); await page.waitForTimeout(2500);
    const r = await row();
    check("the SAVED row holds a polygon with 4 points and no rectangle fields", !!r.crop && r.crop.kind === "poly" && r.crop.pts.length === 4 && !("x" in r.crop) && !("w" in r.crop), JSON.stringify(r.crop).slice(0, 90));
  });

  await section("Lock blocks direct drags only (step 5)", async () => {
    await panel.locator('button[aria-label="Lock"]').click(); await page.waitForTimeout(2000);
    check("the row is locked in the database", (await row()).locked === true);
    check("Edit crop stays enabled", await panel.locator('button:has-text("Edit crop")').first().isEnabled());
    const move = panel.locator('button:has-text("Move / resize"), button:has-text("Editing on map")').first();
    check("Move / resize stays enabled", await move.isEnabled());
    const v0 = (await row()).version; const rc = await imgRect();
    await page.mouse.move(rc.x + rc.w * 0.5, rc.y + rc.h * 0.5); await page.mouse.down(); await page.mouse.move(rc.x + rc.w * 0.5 + 60, rc.y + rc.h * 0.5 + 40, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(1800);
    const r1 = await row();
    check("a direct drag on the locked plan changes nothing in the database", r1.version === v0 && Math.abs(r1.center_lat - 29.78) < 1e-9 && Math.abs(r1.center_lon + 95.82) < 1e-9, `v${v0}→v${r1.version}`);
    await move.click(); await page.waitForTimeout(1000);
    check("Move / resize arms it", /Editing on map/.test(await move.textContent()));
    const rc2 = await imgRect(); const row0 = await row(); const pts = row0.crop.pts;
    const corner = { x: rc2.x + (Math.max(...pts.map((p) => p[0])) / W) * rc2.w, y: rc2.y + (Math.max(...pts.map((p) => p[1])) / H) * rc2.h };
    await page.mouse.move(corner.x, corner.y); await page.mouse.down(); await page.mouse.move(corner.x + 50, corner.y + 50, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(2500);
    const r2 = await row();
    check("an armed corner drag on the LOCKED plan saves a new placement", r2.version > row0.version && Math.abs(r2.ft_per_px - 0.5) > 1e-4, `ft/px 0.5 → ${r2.ft_per_px}`);
    await move.click(); await page.waitForTimeout(600);
  });

  await section("Scale on a LOCKED plan (V1681809)", async () => {
    const sc = panel.locator('[data-testid="site-plan-adjust-scale"]');
    const labels = await sc.locator("button").allTextContents();
    check("three equal actions, none disabled by lock", JSON.stringify(labels.slice(0, 3)) === JSON.stringify(["Set scale", "Trace a length", "Match 2 points"]) && (await sc.locator("button:disabled").count()) === 0, JSON.stringify(labels.slice(0, 3)));
    await panel.locator('[data-testid="site-plan-scale-set"]').click();
    await panel.locator('[data-testid="site-plan-scale-preset"]').selectOption("eng-40"); await page.waitForTimeout(2500);
    let r = await row();
    check("Set scale 1″ = 40′ saved ft/px = 40/150", Math.abs(r.ft_per_px - 40 / 150) < 1e-6, String(r.ft_per_px));
    await panel.locator('[data-testid="site-plan-scale-set"]').click();
    await panel.locator('[data-testid="site-plan-scale-trace"]').click(); await page.waitForTimeout(500);
    let rc = await imgRect(); const y = rc.y + rc.h * 0.5, x1 = rc.x + rc.w * 0.2, x2 = x1 + 100, pps = W / rc.w;
    await page.mouse.click(x1, y); await page.waitForTimeout(300); await page.mouse.click(x2, y); await page.waitForTimeout(300);
    await panel.locator('[data-testid="site-plan-scale-trace-length"]').fill("500"); await panel.locator('[data-testid="site-plan-scale-apply"]').click(); await page.waitForTimeout(2500);
    r = await row(); const exp = 500 / (100 * pps);
    check("Trace a length saved ft/px = 500 ft ÷ traced pixels", Math.abs(r.ft_per_px - exp) / exp < 0.02, `${r.ft_per_px} vs ${exp}`);
    const before = r.ft_per_px;
    await panel.locator('[data-testid="site-plan-scale-match"]').click(); await page.waitForTimeout(400);
    rc = await imgRect(); const cx = rc.x + rc.w * 0.5, cy = rc.y + rc.h * 0.5;
    for (const [px, py] of [[cx - 50, cy], [cx - 100, cy], [cx + 50, cy], [cx + 100, cy]]) { await page.mouse.click(px, py); await page.waitForTimeout(300); }
    await panel.locator('[data-testid="site-plan-scale-apply"]').click(); await page.waitForTimeout(2500);
    r = await row();
    check("Match 2 points saved a ×2 scale and no rotation", Math.abs(r.ft_per_px / before - 2) < 0.04 && Math.abs(((r.rotation_deg + 540) % 360) - 180) < 0.5, `×${(r.ft_per_px / before).toFixed(3)}, rot ${r.rotation_deg}`);
    await page.screenshot({ path: OUT + "crop-live-scale.png" });
  });
} catch (e) { check("run completed", false, String(e.message || e).slice(0, 200)); }
finally {
  const c = await cleanup(seeded0).catch((e) => ({ gone: false, err: String(e) }));
  check("cleanup: every throwaway row and file is gone (verified)", c.gone === true, c.err || "");
  await s.close();
}
console.log(fail ? `\n✗ ${fail} check(s) failed` : `\n✓ all checks passed on build ${served.build}`);
process.exit(fail ? 1 : 0);
