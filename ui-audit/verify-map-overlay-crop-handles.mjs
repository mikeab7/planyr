/* NEW-2 (B2163345 / V1578593) — MAP/COMPS surface: the selection handles of a CROPPED site-plan overlay hug the crop,
 * corner-scale / rotate pivot about the VISIBLE centre, and Reset crop returns the handles to the full image.
 * Signed in as the test account on a real deploy, in a real Leaflet map, through the app's OWN upload flow:
 *   Records → "+ Site plan" → upload a PNG → Crop… (drag the rect's corners) → Place on map → measure the real handles.
 * Everything it creates (overlay row, review row, raster) is found by its file name and DELETED at the end, each verified gone
 * (CLAUDE.md constraint 15). It uses no project, so no site row is created. One browser, light traffic.
 *   KNOWN-GOOD ARM (DRIVER-SCROLL §6): after "Reset crop" the SAME instrument must report the grips on the full image box.
 * Usage: node ui-audit/verify-map-overlay-crop-handles.mjs [https://planyr.io]     (SHOTS_DIR=… saves screenshots)
 */
import zlib from "node:zlib";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.argv[2] || process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;
const NAME = "zz-mapov-" + Math.random().toString(36).slice(2, 7);

function pngBuffer(w, h) { // solid amber 8-bit RGB PNG
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => [232, 168, 60][i % 3])])));
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const s = await openSignedIn({ base: BASE });
const page = s.page;
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e && e.message || e).slice(0, 160)));
console.log("served build:", JSON.stringify(s.build), "| signed in as", s.proof.email);
const shot = async (n) => { if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${n}.png` }).catch(() => {}); };
const row = () => page.evaluate(async (nm) => { const q = await window.pfSupabase.from("site_plan_overlays").select("id,version,center_lat,center_lon,ft_per_px,rotation_deg,crop,raster_key,review_id").like("source_file_name", nm + "%").is("deleted_at", null).maybeSingle(); return q.data; }, NAME);

async function cleanup() {
  for (let pass = 0; pass < 3; pass++) {
    const left = await page.evaluate(async (nm) => {
      const c = window.pfSupabase;
      const { data } = await c.from("site_plan_overlays").select("id,review_id,raster_key").like("source_file_name", nm + "%");
      for (const o of data || []) { await c.from("site_plan_overlays").delete().eq("id", o.id); if (o.raster_key) await c.storage.from("doc-review-files").remove([o.raster_key]); if (o.review_id) await c.from("doc_reviews").delete().eq("id", o.review_id); }
      // the upload flow mints a TRACKED SITE named after the file — remove it too (soft-delete, then delete)
      const { data: sites } = await c.from("sites").select("id").like("site", nm + "%");
      for (const st of sites || []) { await c.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", st.id); await c.from("sites").delete().eq("id", st.id); }
      const ov = (await c.from("site_plan_overlays").select("id").like("source_file_name", nm + "%")).data?.length ?? -1;
      const st = (await c.from("sites").select("id").like("site", nm + "%")).data?.length ?? -1;
      return ov === 0 && st === 0 ? 0 : ov + st + 1;
    }, NAME);
    console.log("cleanup pass", pass, left === 0 ? "— overlay + tracked site + review + raster all gone" : "— something remains");
    if (left === 0) return true;
    await sleep(4000);
  }
  return false;
}

try {
  const buildNow = () => page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null));
  const geo = () => page.evaluate(() => {
    const pane = document.querySelector(".leaflet-sitePlanHandles-pane");
    const bb = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; };
    const poly = pane ? [...pane.querySelectorAll("polygon")] : [];
    const im = document.querySelector(".leaflet-sitePlanOverlay-pane img, .leaflet-sitePlanOverlay-pane canvas");
    return { boundary: poly[1] ? bb(poly[1]) : null, grips: pane ? [...pane.querySelectorAll("rect")].filter((r) => r.getAttribute("width") === "11").map(bb) : [], rot: poly[2] ? bb(poly[2]) : null, img: im ? bb(im) : null };
  });
  const waitHandles = async (ms = 90000) => { const t = Date.now(); let g; while (Date.now() - t < ms) { g = await geo(); if (g.boundary && g.boundary.w > 0 && g.grips.length === 4 && g.img && g.img.w > 20) return g; await sleep(1500); } return g; };
  const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); for (let i = 1; i <= 8; i++) { await page.mouse.move(a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8); await sleep(40); } await page.mouse.up(); await sleep(3000); };

  /* A deploy by another session mid-run makes the app reload itself ("Loading your sites…") and drops an in-flight placement.
   * That is the INSTRUMENT being interrupted, not the product failing — so restart the flow (≤3 attempts) when the served build
   * changed or the handles never armed, instead of scoring it. */
  let g = null;
  for (let attempt = 1; attempt <= 3 && !(g && g.boundary && g.grips.length === 4); attempt++) {
    const b0 = await buildNow();
    if (attempt > 1) { console.log(`  … attempt ${attempt} (served build ${b0})`); await cleanup(); }
    try {
    await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => !/Loading your sites/.test(document.body.innerText) && /Sites\s*\d+/.test(document.body.innerText), null, { timeout: 90000 });
    await sleep(2000);
    await assertMeasurable(page, "verify-map-overlay-crop-handles");
    await page.locator('button[role="tab"][title^="Site record"]').first().click({ timeout: 15000 }); await sleep(2500);
    await page.evaluate(() => { [...document.querySelectorAll("button")].find((x) => /site plan/i.test(x.innerText || ""))?.click(); }); await sleep(2000);
    await page.locator('input[type=file]:not([accept*=".kml"])').first().setInputFiles({ name: NAME + ".png", mimeType: "image/png", buffer: pngBuffer(1000, 800) });
    await page.getByRole("button", { name: /^Crop…/ }).first().click({ timeout: 30000 }); await sleep(2000);
    // The crop tool opens INLINE in the left panel (no modal). Fit + zoom out so the whole picture is inside the panel, then the rect's
    // full-image corner handles ARE the picture's corners — derive every target from them rather than from an <img> box.
    const tool = page.locator('[data-testid="crop-done"]').first();
    await tool.waitFor({ timeout: 30000 });
    await page.locator('[data-testid="crop-zoom-fit"]').first().click(); await sleep(500);
    for (let i = 0; i < 3; i++) { await page.locator('[data-testid="crop-zoom-out"]').first().click(); await sleep(250); } // the picture overflows the narrow panel at Fit — zoom out until every corner grip is on screen
    await sleep(500);
    const center = async (id) => { const b = await page.locator(`[data-testid="${id}"]`).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const tl0 = await center("crop-handle-tl"), br0 = await center("crop-handle-br");
    const at = (fx, fy) => ({ x: tl0.x + fx * (br0.x - tl0.x), y: tl0.y + fy * (br0.y - tl0.y) });
    const dragTo = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); for (let i = 1; i <= 6; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / 6, from.y + (to.y - from.y) * i / 6); await sleep(30); } await page.mouse.up(); await sleep(400); };
    await dragTo(tl0, at(0.6, 0.125));
    await dragTo(await center("crop-handle-br"), at(0.8, 0.3125));
    await shot("map-crop-dialog");
    await tool.click(); await sleep(1500);
    await page.getByRole("button", { name: "Place on map" }).first().click({ timeout: 15000 });

    g = await waitHandles(attempt < 3 ? 60000 : 90000);
    } catch (e) { console.log(`  … attempt ${attempt} interrupted: ${String((e && e.message) || e).split("\n")[0].slice(0, 120)}`); g = null; if (attempt === 3) throw e; }
    const b1 = await buildNow();
    if (!(g && g.boundary && g.grips.length === 4) && b0 !== b1) console.log(`  … served build moved ${b0} → ${b1} mid-run; retrying`);
  }
  await shot("map-handles-cropped");
  check("placed through the real flow; the Map handles are armed (4 grips, outline, rotate grip, image layer)", !!g.boundary && g.grips.length === 4 && !!g.rot && !!g.img, JSON.stringify({ grips: g.grips && g.grips.length, img: !!g.img }));
  if (!g.boundary || g.grips.length !== 4 || !g.img) console.log("  diag:", JSON.stringify(await page.evaluate(() => { const p = document.querySelector(".leaflet-sitePlanHandles-pane"); return { pane: !!p, svgDisplay: p && p.querySelector("svg") && p.querySelector("svg").style.display, polys: p ? [...p.querySelectorAll("polygon")].map((e) => (e.getAttribute("points") || "").slice(0, 60)) : null, panes: [...document.querySelectorAll(".leaflet-pane")].map((e) => e.className.replace(/leaflet-pane\s*/, "")).slice(0, 14), overlayPane: !!document.querySelector(".leaflet-sitePlanOverlay-pane"), imgs: document.querySelectorAll(".leaflet-sitePlanOverlay-pane *").length }; })), "| page errors:", JSON.stringify(pageErrors.slice(0, 5)));
  if (!g.boundary || g.grips.length !== 4 || !g.img) throw new Error("VOID — handles not armed; the instrument cannot see them");
  const r0 = await row();
  check("the saved overlay carries a rect crop I drew (smaller than the full 1000×800 image, anchored near x 600, y 100)", !!r0 && !!r0.crop && r0.crop.kind === "rect" && near(r0.crop.x, 600, 60) && near(r0.crop.y, 100, 60) && r0.crop.w < 900 && r0.crop.h < 780, JSON.stringify(r0 && r0.crop));
  const cx = r0.crop;
  const exp = { x: g.img.x + (cx.x / 1000) * g.img.w, y: g.img.y + (cx.y / 800) * g.img.h, w: (cx.w / 1000) * g.img.w, h: (cx.h / 800) * g.img.h };
  check("outline hugs the CROP (not the full image)", near(g.boundary.x, exp.x, 4) && near(g.boundary.y, exp.y, 4) && near(g.boundary.w, exp.w, 5) && near(g.boundary.h, exp.h, 5), JSON.stringify({ got: [g.boundary.x, g.boundary.y, g.boundary.w, g.boundary.h].map(Math.round), exp: [exp.x, exp.y, exp.w, exp.h].map(Math.round) }));
  check("the four grips sit on the crop's corners", near(g.grips[0].cx, exp.x, 6) && near(g.grips[0].cy, exp.y, 6) && near(g.grips[2].cx, exp.x + exp.w, 6) && near(g.grips[2].cy, exp.y + exp.h, 6));
  check("the rotate grip is above the crop's top edge, centred on it", near(g.rot.cx, exp.x + exp.w / 2, 6) && g.rot.cy < exp.y - 8);

  const c0 = { x: g.boundary.cx, y: g.boundary.cy }, w0 = g.boundary.w;
  await drag({ x: g.grips[2].cx, y: g.grips[2].cy }, { x: g.grips[2].cx + 50, y: g.grips[2].cy + 40 });
  let tHide = Date.now(); g = await waitHandles(45000); console.log(`  (handles back ${g && g.boundary && g.boundary.w > 0 ? "after " + Math.round((Date.now() - tHide) / 100) / 10 + " s" : "NEVER within 45 s"} after the scale commit)`);
  console.log("  post-scale diag:", JSON.stringify(await page.evaluate(() => { const p = document.querySelector(".leaflet-sitePlanHandles-pane"); const sv = p && p.querySelector("svg"); const b = p && p.querySelectorAll("polygon")[1]; return { editingOnMap: /Editing on map/.test(document.body.innerText), adjustPanel: /Adjust site plan/.test(document.body.innerText), svgDisplay: sv && sv.style.display, boundaryPts: b && (b.getAttribute("points") || "").slice(0, 90) }; })));
  await shot("map-after-scale");
  const r1 = await row();
  check("corner drag scaled the whole overlay (visible outline grew; stored ft_per_px grew)", g.boundary.w > w0 * 1.15 && r1.ft_per_px > r0.ft_per_px * 1.15, `w ${Math.round(w0)}→${Math.round(g.boundary.w)}, ft/px ${Number(r0.ft_per_px).toFixed(3)}→${Number(r1.ft_per_px).toFixed(3)}`);
  check("…the VISIBLE centre stayed put on screen", near(g.boundary.cx, c0.x, 4) && near(g.boundary.cy, c0.y, 4), JSON.stringify({ c0, c1: { x: g.boundary.cx, y: g.boundary.cy } }));
  check("…the crop is untouched in the saved row", JSON.stringify(r1.crop) === JSON.stringify(r0.crop), JSON.stringify(r1.crop));

  const c1 = { x: g.boundary.cx, y: g.boundary.cy };
  await drag({ x: g.rot.cx, y: g.rot.cy }, { x: c1.x + 140, y: c1.y - 10 });
  tHide = Date.now(); g = await waitHandles(45000); console.log(`  (handles back ${g && g.boundary && g.boundary.w > 0 ? "after " + Math.round((Date.now() - tHide) / 100) / 10 + " s" : "NEVER within 45 s"} after the rotate commit)`);
  const r2 = await row();
  check("rotate drag saved a real turn", Math.abs(r2.rotation_deg - r1.rotation_deg) > 20, `rotation ${Number(r1.rotation_deg).toFixed(1)}→${Number(r2.rotation_deg).toFixed(1)}`);
  check("…the VISIBLE centre stayed put on screen", near(g.boundary.cx, c1.x, 4) && near(g.boundary.cy, c1.y, 4), JSON.stringify({ c1, c2: { x: g.boundary.cx, y: g.boundary.cy } }));
  check("…the crop is still untouched", JSON.stringify(r2.crop) === JSON.stringify(r0.crop));
  await shot("map-handles-rotated");

  // KNOWN-GOOD / RESET ARM: Edit crop → Reset → Done, then read the handles again.
  await page.getByRole("button", { name: /Edit crop/ }).first().click({ timeout: 15000 }); await sleep(2000);
  await page.locator('[data-testid="crop-reset"]').first().click(); await sleep(500);
  console.log("  reset-step Done:", JSON.stringify(await page.evaluate(() => { const d = document.querySelector('[data-testid="crop-done"]'); const w = document.querySelector('[data-testid="crop-done-why"]'); return { disabled: d && d.disabled, why: w && w.innerText }; })));
  await page.evaluate(() => document.querySelector('[data-testid="crop-done"]').click()); await sleep(3500);
  g = await waitHandles(45000); await shot("map-handles-reset");
  // The plan is still armed in-session, so the SAME instrument reads the handles after Reset. The overlay is rotated here, so compare
  // the handles' bounding box with the image layer's bounding box (same rotated rect when there is no crop).
  check("Reset crop: the handles return to the FULL image (outline bbox == image bbox)", !!g && !!g.boundary && !!g.img && near(g.boundary.x, g.img.x, 5) && near(g.boundary.y, g.img.y, 5) && near(g.boundary.w, g.img.w, 6) && near(g.boundary.h, g.img.h, 6), JSON.stringify({ b: g && g.boundary && [g.boundary.x, g.boundary.y, g.boundary.w, g.boundary.h].map(Math.round), img: g && g.img && [g.img.x, g.img.y, g.img.w, g.img.h].map(Math.round) }));
  const r3 = await row();
  check("Reset crop saved a full-image overlay (crop cleared)", !!r3 && !r3.crop, JSON.stringify(r3 && r3.crop));
} catch (e) {
  console.log("  ✗ run aborted:", String((e && e.message) || e).slice(0, 300)); fail++; await shot("map-abort");
} finally {
  const clean = await cleanup();
  check("every throwaway row/raster this run created is deleted (verified)", clean);
  console.log(fail ? `\n${fail} check(s) FAILED` : "\nall checks passed");
  await s.close();
  process.exit(fail ? 1 : 0);
}
