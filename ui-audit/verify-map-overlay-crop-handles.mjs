/* NEW-2 (B2163345 / V1578593) — MAP/COMPS surface: the selection handles of a CROPPED site-plan overlay hug the crop,
 * and corner-scale / rotate pivot about the VISIBLE centre. Signed in as the test account on a real deploy, real Leaflet.
 *
 * Seeds ONE throwaway (a `sites` row, a `doc_reviews` row, a raster in Storage, a `site_plan_overlays` row carrying a rect crop),
 * drives the real UI (Map → site → Records → "Move / resize"), measures the real handles, and DELETES everything it made
 * (CLAUDE.md constraint 15) — verifying each is gone. Never touches a real plan. One browser, light traffic.
 *   KNOWN-GOOD ARM (DRIVER-SCROLL §6): the same overlay with the crop cleared must put the grips on the FULL image box.
 * Usage: node ui-audit/verify-map-overlay-crop-handles.mjs [https://planyr.io]
 */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.argv[2] || process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;
const RID = "zz-mapov-" + Math.random().toString(36).slice(2, 7);
const OID = globalThis.crypto.randomUUID();
const RECT = { kind: "rect", x: 600, y: 100, w: 200, h: 150 };

const s = await openSignedIn({ base: BASE });
const page = s.page;
console.log("served build:", JSON.stringify(s.build), "| signed in as", s.proof.email);
const dbq = (fn, arg) => page.evaluate(fn, arg);
const overlayRow = () => dbq(async (id) => { const q = await window.pfSupabase.from("site_plan_overlays").select("version,center_lat,center_lon,ft_per_px,rotation_deg,crop").eq("id", id).maybeSingle(); return q.data; }, OID);

async function cleanup() {
  for (let pass = 0; pass < 3; pass++) {
    const left = await dbq(async ([RID, OID]) => {
      const c = window.pfSupabase; const uid = (await c.auth.getUser()).data.user.id;
      await c.from("site_plan_overlays").delete().eq("id", OID);
      await c.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", RID);
      await c.from("sites").delete().eq("id", RID);
      await c.from("doc_reviews").delete().eq("id", RID);
      await c.storage.from("doc-review-files").remove([`${uid}/site-plan-overlays/${OID}.jpg`]);
      const n = async (t, col, v) => (await c.from(t).select("id").eq(col, v)).data?.length ?? -1;
      return [await n("site_plan_overlays", "id", OID), await n("sites", "id", RID), await n("doc_reviews", "id", RID)];
    }, [RID, OID]);
    console.log("cleanup pass", pass, "remaining [overlay, site, review]:", JSON.stringify(left));
    if (left.every((x) => x === 0)) return true;
    await sleep(4000);
  }
  return false;
}

try {
  const seeded = await dbq(async ([RID, OID, RECT]) => {
    const c = window.pfSupabase; const uid = (await c.auth.getUser()).data.user.id;
    const model = { id: RID, groupId: RID, site: "ZZ MapOv Throwaway", name: "Plan 1", origin: { lat: 29.78, lon: -95.82 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, sheetOverlays: [], status: "active", updatedAt: Date.now(), schemaVersion: 12 };
    const rs = await c.from("sites").insert({ id: RID, user_id: uid, group_id: RID, site: model.site, name: "Plan 1", county: "harris", data: model, version: 1 }).select("id");
    if (rs.error) return { step: "site", err: rs.error.message };
    const r1 = await c.from("doc_reviews").insert({ id: RID, user_id: uid, data: { id: RID, title: "ZZ throwaway" }, version: 1 }).select("id");
    if (r1.error) return { step: "review", err: r1.error.message };
    const cv = document.createElement("canvas"); cv.width = 1000; cv.height = 800; const g = cv.getContext("2d");
    g.fillStyle = "#e8a83c"; g.fillRect(0, 0, 1000, 800);
    const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.8));
    const key = `${uid}/site-plan-overlays/${OID}.jpg`;
    const up = await c.storage.from("doc-review-files").upload(key, blob, { contentType: "image/jpeg", upsert: true });
    if (up.error) return { step: "upload", err: up.error.message };
    const r2 = await c.from("site_plan_overlays").insert({ id: OID, review_id: RID, project_id: RID, page: 1, doc_title: "ZZ throwaway overlay", source_file_name: "zz-mapov.jpg", img_w: 1000, img_h: 800, raster_key: key, center_lat: 29.78, center_lon: -95.82, ft_per_px: 1, rotation_deg: 0, crop: RECT, opacity: 0.85, visible: true, locked: false }).select("id");
    if (r2.error) return { step: "overlay", err: r2.error.message };
    return { ok: true };
  }, [RID, OID, RECT]);
  if (!seeded.ok) throw new Error("seed failed: " + JSON.stringify(seeded));

  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await sleep(5000);
  await assertMeasurable(page, "verify-map-overlay-crop-handles");
  await page.locator('input[placeholder^="Filter by name"]').fill("ZZ MapOv"); await sleep(1000);
  await page.getByText("ZZ MapOv Throwaway", { exact: false }).first().click({ timeout: 15000 }); await sleep(3500); // opens the planner on the site
  await page.evaluate(() => { location.hash = "#/site-planner"; }); await sleep(3500);          // back to the Map (no reload)
  await page.locator('button[role="tab"][title^="Site record"]').first().click({ timeout: 15000 }); await sleep(3000);
  const arm = page.getByRole("button", { name: /Move \/ resize/ }).first();
  await arm.click({ timeout: 15000 }); await sleep(2500);

  const geo = () => page.evaluate(() => {
    const pane = document.querySelector(".leaflet-sitePlanHandlesPane-pane");
    const bb = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; };
    const poly = pane ? [...pane.querySelectorAll("polygon")] : [];
    const img = document.querySelector(".leaflet-sitePlanOverlayPane-pane img, .leaflet-sitePlanOverlayPane-pane canvas");
    return { boundary: poly[1] ? bb(poly[1]) : null, grips: pane ? [...pane.querySelectorAll("rect")].filter((r) => r.getAttribute("width") === "11").map(bb) : [], rot: poly[2] ? bb(poly[2]) : null, img: img ? bb(img) : null };
  });
  const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); for (let i = 1; i <= 8; i++) { await page.mouse.move(a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8); await sleep(40); } await page.mouse.up(); await sleep(2500); };

  let g = await geo();
  check("the Map handles are armed on the throwaway overlay (4 grips, outline, rotate grip)", !!g.boundary && g.grips.length === 4 && !!g.rot && !!g.img, JSON.stringify({ grips: g.grips.length, img: !!g.img }));
  if (!g.boundary || g.grips.length !== 4 || !g.img) throw new Error("VOID — handles not armed; the instrument cannot see them");
  const exp = { x: g.img.x + 0.6 * g.img.w, y: g.img.y + 0.125 * g.img.h, w: 0.2 * g.img.w, h: 0.1875 * g.img.h };
  check("outline hugs the CROP (not the full image)", near(g.boundary.x, exp.x, 4) && near(g.boundary.y, exp.y, 4) && near(g.boundary.w, exp.w, 5) && near(g.boundary.h, exp.h, 5), JSON.stringify({ got: [g.boundary.x, g.boundary.y, g.boundary.w, g.boundary.h].map(Math.round), exp: [exp.x, exp.y, exp.w, exp.h].map(Math.round) }));
  check("the four grips sit on the crop's corners", near(g.grips[0].cx, exp.x, 6) && near(g.grips[0].cy, exp.y, 6) && near(g.grips[2].cx, exp.x + exp.w, 6) && near(g.grips[2].cy, exp.y + exp.h, 6));
  check("the rotate grip is above the crop's top edge, centred on it", near(g.rot.cx, exp.x + exp.w / 2, 6) && g.rot.cy < exp.y - 8);

  const row0 = await overlayRow();
  const c0 = { x: g.boundary.cx, y: g.boundary.cy }, w0 = g.boundary.w;
  await drag({ x: g.grips[2].cx, y: g.grips[2].cy }, { x: g.grips[2].cx + 50, y: g.grips[2].cy + 40 });
  g = await geo(); const row1 = await overlayRow();
  check("corner drag scaled the whole overlay (visible outline grew, stored ft_per_px grew)", g.boundary.w > w0 * 1.15 && row1.ft_per_px > row0.ft_per_px * 1.15, `w ${Math.round(w0)}→${Math.round(g.boundary.w)}, ft/px ${row0.ft_per_px}→${Number(row1.ft_per_px).toFixed(3)}`);
  check("…the VISIBLE centre stayed put on screen", near(g.boundary.cx, c0.x, 4) && near(g.boundary.cy, c0.y, 4), JSON.stringify({ c0, c1: { x: g.boundary.cx, y: g.boundary.cy } }));
  check("…the crop is untouched in the saved row", JSON.stringify(row1.crop) === JSON.stringify(RECT), JSON.stringify(row1.crop));

  const c1 = { x: g.boundary.cx, y: g.boundary.cy };
  await drag({ x: g.rot.cx, y: g.rot.cy }, { x: c1.x + 140, y: c1.y - 10 });
  g = await geo(); const row2 = await overlayRow();
  check("rotate drag saved a real turn", Math.abs(row2.rotation_deg - row1.rotation_deg) > 20, `rotation ${row1.rotation_deg}→${Number(row2.rotation_deg).toFixed(1)}`);
  check("…the VISIBLE centre stayed put on screen", near(g.boundary.cx, c1.x, 4) && near(g.boundary.cy, c1.y, 4), JSON.stringify({ c1, c2: { x: g.boundary.cx, y: g.boundary.cy } }));
  check("…the crop is still untouched", JSON.stringify(row2.crop) === JSON.stringify(RECT));

  // KNOWN-GOOD ARM: clear the crop in the row, reload, re-arm → grips on the FULL image box
  await dbq(async (id) => { await window.pfSupabase.from("site_plan_overlays").update({ crop: null, rotation_deg: 0, ft_per_px: 1, center_lat: 29.78, center_lon: -95.82 }).eq("id", id); }, OID);
  await page.reload({ waitUntil: "load" }); await sleep(5000);
  await page.locator('input[placeholder^="Filter by name"]').fill("ZZ MapOv"); await sleep(1000);
  await page.getByText("ZZ MapOv Throwaway", { exact: false }).first().click({ timeout: 15000 }); await sleep(3500);
  await page.evaluate(() => { location.hash = "#/site-planner"; }); await sleep(3500);
  await page.locator('button[role="tab"][title^="Site record"]').first().click({ timeout: 15000 }); await sleep(3000);
  await page.getByRole("button", { name: /Move \/ resize/ }).first().click({ timeout: 15000 }); await sleep(2500);
  g = await geo();
  check("known-good: with NO crop the grips sit on the full image box", !!g.boundary && !!g.img && near(g.boundary.x, g.img.x, 4) && near(g.boundary.y, g.img.y, 4) && near(g.boundary.w, g.img.w, 5) && near(g.boundary.h, g.img.h, 5), JSON.stringify({ b: g.boundary && [g.boundary.x, g.boundary.y, g.boundary.w, g.boundary.h].map(Math.round), img: g.img && [g.img.x, g.img.y, g.img.w, g.img.h].map(Math.round) }));
} catch (e) {
  console.log("  ✗ run aborted:", String(e && e.message || e).slice(0, 300)); fail++;
} finally {
  await page.evaluate(() => { location.hash = "#/"; }).catch(() => {}); await sleep(4000); // leave the planner before deleting, so it cannot re-push the site row
  const clean = await cleanup();
  check("every throwaway row/raster this run created is deleted (verified)", clean);
  console.log(fail ? `\n${fail} check(s) FAILED` : "\nall checks passed");
  await s.close();
  process.exit(fail ? 1 : 0);
}
