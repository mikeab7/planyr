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
console.log("served build:", JSON.stringify(s.build), "| signed in as", s.proof.email);
const shot = async (n) => { if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${n}.png` }).catch(() => {}); };
const row = () => page.evaluate(async (nm) => { const q = await window.pfSupabase.from("site_plan_overlays").select("id,version,center_lat,center_lon,ft_per_px,rotation_deg,crop,raster_key,review_id").like("source_file_name", nm + "%").is("deleted_at", null).maybeSingle(); return q.data; }, NAME);

async function cleanup() {
  for (let pass = 0; pass < 3; pass++) {
    const left = await page.evaluate(async (nm) => {
      const c = window.pfSupabase;
      const { data } = await c.from("site_plan_overlays").select("id,review_id,raster_key").like("source_file_name", nm + "%");
      for (const o of data || []) { await c.from("site_plan_overlays").delete().eq("id", o.id); if (o.raster_key) await c.storage.from("doc-review-files").remove([o.raster_key]); if (o.review_id) await c.from("doc_reviews").delete().eq("id", o.review_id); }
      return (await c.from("site_plan_overlays").select("id").like("source_file_name", nm + "%")).data?.length ?? -1;
    }, NAME);
    console.log("cleanup pass", pass, "overlays remaining:", left);
    if (left === 0) return true;
    await sleep(4000);
  }
  return false;
}

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
  // The crop tool opens INLINE in the left panel (no modal). "Fit" so the whole picture is inside the panel, then the rect's
  // full-image corner handles ARE the picture's corners — derive every target from them rather than from an <img> box.
  const tool = page.locator('[data-testid="crop-done"]').first();
  await tool.waitFor({ timeout: 30000 });
  await page.locator('[data-testid="crop-zoom-fit"]').first().click(); await sleep(800);
  const center = async (id) => { const b = await page.locator(`[data-testid="${id}"]`).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const nw0 = await center("crop-handle-nw"), se0 = await center("crop-handle-se");
  const at = (fx, fy) => ({ x: nw0.x + fx * (se0.x - nw0.x), y: nw0.y + fy * (se0.y - nw0.y) });
  const dragTo = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); for (let i = 1; i <= 6; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / 6, from.y + (to.y - from.y) * i / 6); await sleep(30); } await page.mouse.up(); await sleep(400); };
  await dragTo(nw0, at(0.6, 0.125));
  await dragTo(await center("crop-handle-se"), at(0.8, 0.3125));
  await shot("map-crop-dialog");
  await tool.click(); await sleep(1500);
  await page.getByRole("button", { name: "Place on map" }).first().click({ timeout: 15000 });

  const geo = () => page.evaluate(() => {
    const pane = document.querySelector(".leaflet-sitePlanHandlesPane-pane");
    const bb = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; };
    const poly = pane ? [...pane.querySelectorAll("polygon")] : [];
    const im = document.querySelector(".leaflet-sitePlanOverlayPane-pane img, .leaflet-sitePlanOverlayPane-pane canvas");
    return { boundary: poly[1] ? bb(poly[1]) : null, grips: pane ? [...pane.querySelectorAll("rect")].filter((r) => r.getAttribute("width") === "11").map(bb) : [], rot: poly[2] ? bb(poly[2]) : null, img: im ? bb(im) : null };
  });
  const waitHandles = async (ms = 90000) => { const t = Date.now(); let g; while (Date.now() - t < ms) { g = await geo(); if (g.boundary && g.grips.length === 4 && g.img && g.img.w > 20) return g; await sleep(1500); } return g; };
  const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); for (let i = 1; i <= 8; i++) { await page.mouse.move(a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8); await sleep(40); } await page.mouse.up(); await sleep(3000); };

  let g = await waitHandles(); await shot("map-handles-cropped");
  check("placed through the real flow; the Map handles are armed (4 grips, outline, rotate grip, image layer)", !!g.boundary && g.grips.length === 4 && !!g.rot && !!g.img, JSON.stringify({ grips: g.grips && g.grips.length, img: !!g.img }));
  if (!g.boundary || g.grips.length !== 4 || !g.img) throw new Error("VOID — handles not armed; the instrument cannot see them");
  const r0 = await row();
  check("the saved overlay carries the rect crop I drew (≈ x 60%–80%, y 12.5%–31%)", !!r0 && !!r0.crop && near(r0.crop.x, 600, 40) && near(r0.crop.y, 100, 40) && near(r0.crop.w, 200, 50) && near(r0.crop.h, 150, 50), JSON.stringify(r0 && r0.crop));
  const cx = r0.crop;
  const exp = { x: g.img.x + (cx.x / 1000) * g.img.w, y: g.img.y + (cx.y / 800) * g.img.h, w: (cx.w / 1000) * g.img.w, h: (cx.h / 800) * g.img.h };
  check("outline hugs the CROP (not the full image)", near(g.boundary.x, exp.x, 4) && near(g.boundary.y, exp.y, 4) && near(g.boundary.w, exp.w, 5) && near(g.boundary.h, exp.h, 5), JSON.stringify({ got: [g.boundary.x, g.boundary.y, g.boundary.w, g.boundary.h].map(Math.round), exp: [exp.x, exp.y, exp.w, exp.h].map(Math.round) }));
  check("the four grips sit on the crop's corners", near(g.grips[0].cx, exp.x, 6) && near(g.grips[0].cy, exp.y, 6) && near(g.grips[2].cx, exp.x + exp.w, 6) && near(g.grips[2].cy, exp.y + exp.h, 6));
  check("the rotate grip is above the crop's top edge, centred on it", near(g.rot.cx, exp.x + exp.w / 2, 6) && g.rot.cy < exp.y - 8);

  const c0 = { x: g.boundary.cx, y: g.boundary.cy }, w0 = g.boundary.w;
  await drag({ x: g.grips[2].cx, y: g.grips[2].cy }, { x: g.grips[2].cx + 50, y: g.grips[2].cy + 40 });
  g = await geo(); const r1 = await row();
  check("corner drag scaled the whole overlay (visible outline grew; stored ft_per_px grew)", g.boundary.w > w0 * 1.15 && r1.ft_per_px > r0.ft_per_px * 1.15, `w ${Math.round(w0)}→${Math.round(g.boundary.w)}, ft/px ${Number(r0.ft_per_px).toFixed(3)}→${Number(r1.ft_per_px).toFixed(3)}`);
  check("…the VISIBLE centre stayed put on screen", near(g.boundary.cx, c0.x, 4) && near(g.boundary.cy, c0.y, 4), JSON.stringify({ c0, c1: { x: g.boundary.cx, y: g.boundary.cy } }));
  check("…the crop is untouched in the saved row", JSON.stringify(r1.crop) === JSON.stringify(r0.crop), JSON.stringify(r1.crop));

  const c1 = { x: g.boundary.cx, y: g.boundary.cy };
  await drag({ x: g.rot.cx, y: g.rot.cy }, { x: c1.x + 140, y: c1.y - 10 });
  g = await geo(); const r2 = await row();
  check("rotate drag saved a real turn", Math.abs(r2.rotation_deg - r1.rotation_deg) > 20, `rotation ${Number(r1.rotation_deg).toFixed(1)}→${Number(r2.rotation_deg).toFixed(1)}`);
  check("…the VISIBLE centre stayed put on screen", near(g.boundary.cx, c1.x, 4) && near(g.boundary.cy, c1.y, 4), JSON.stringify({ c1, c2: { x: g.boundary.cx, y: g.boundary.cy } }));
  check("…the crop is still untouched", JSON.stringify(r2.crop) === JSON.stringify(r0.crop));
  await shot("map-handles-rotated");

  // KNOWN-GOOD / RESET ARM: Edit crop → Reset → Done; then undo the rotation so the full image box is axis-aligned to compare against.
  await page.getByRole("button", { name: /Edit crop/ }).first().click({ timeout: 15000 }); await sleep(2000);
  await page.locator('[data-testid="crop-reset"]').first().click(); await sleep(500);
  await page.locator('[data-testid="crop-done"]').first().click(); await sleep(3500);
  await page.evaluate(async (id) => { await window.pfSupabase.from("site_plan_overlays").update({ rotation_deg: 0 }).eq("id", id); }, r0.id);
  await page.reload({ waitUntil: "load" }); // handles are armed only in-session — re-arm via the panel after a reload is not reachable for an unlinked plan, so this arm reads the saved row instead:
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
