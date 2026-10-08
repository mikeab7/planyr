#!/usr/bin/env node
/* B1838705 / V1568288 — steps 1–4 and 6 against the DEPLOYED app, signed in as the test account.
 * Seeds ONE throwaway plan ("ZZ Overlay Engine Throwaway") with a legacy no-`kind` RECT-cropped overlay
 * (ovA) and a POLY-cropped, rotated overlay (ovB), saves it to the test account (the app refuses to open an
 * on-device-only site while signed in), then drives the real UI:
 *   1  rect crop still crops   2  poly crop still crops   3  move / corner-scale / rotate / Align-to-map keep
 *   the clip welded (crop ratios in image-pixel space unchanged) and Undo restores   4  File ▾ → Download PDF:
 *   the exported sheet's overlay nodes carry the SAME box / rotation / clip as the live canvas.
 * 6  cleanup: trash + permanently delete the throwaway row and prove it is gone (finally-block, always runs).
 * Reads /version.json in the SAME call as the assertions (CLAUDE.md live-measurement rule).
 *   E2E_LOGIN_KEY=… node ui-audit/verify-overlay-engine-live.mjs [--shots dir] */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const shotsIdx = process.argv.indexOf("--shots");
const SHOTS = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
const ID = "zz-overlay-engine-throwaway";
const imgW = 800, imgH = 600;
const art = (l, c) => `<svg xmlns='http://www.w3.org/2000/svg' width='${imgW}' height='${imgH}'><rect width='800' height='600' fill='${c}'/><circle cx='400' cy='300' r='200' fill='none' stroke='#222' stroke-width='12'/><text x='60' y='120' font-size='90' fill='#111'>${l}</text></svg>`;
const src = (l, c) => "data:image/svg+xml;utf8," + encodeURIComponent(art(l, c));
const ov = (id, x) => ({ id, name: id + ".png", imgW, imgH, page: 1, pageCount: 1, opacity: 0.8, locked: false, detectedScale: null, sheet: null, ...x });
const CROP_A = { x: 100, y: 80, w: 500, h: 380 };
const PTS_B = [[60, 60], [700, 120], [640, 520], [200, 560]];
const site = { id: ID, groupId: ID, site: "ZZ Overlay Engine Throwaway", name: "Plan 1", origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -440, y: -260 }, { x: 440, y: -260 }, { x: 440, y: 300 }, { x: -440, y: 300 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(), data: { status: "active" },
  sheetOverlays: [
    ov("ovA", { src: src("A", "#cfe8ff"), ftPerPx: 0.5, rotation: 17.5, x: -420, y: -200, crop: CROP_A }),
    ov("ovB", { src: src("B", "#ffe9c7"), ftPerPx: 0.4, rotation: 301, x: 40, y: -120, crop: { kind: "poly", pts: PTS_B } }),
  ] };

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

// Live geometry of one overlay: image box, group rotation, and the clip expressed as RATIOS of the image box
// (image-pixel-space invariant: a crop welded to the sheet keeps these constant through move/scale/rotate/align).
const measure = (page, id) => page.evaluate((id) => {
  const img = document.querySelector(`image[data-overlay-id="${id}"]`);
  if (!img) return null;
  const g = img.closest('g[data-feature^="reference"]');
  const x = +img.getAttribute("x"), y = +img.getAttribute("y"), w = +img.getAttribute("width"), h = +img.getAttribute("height");
  const clip = document.getElementById("ov-crop-" + id);
  const shape = clip && clip.firstElementChild;
  let ratios = null, kind = null;
  if (shape && shape.tagName.toLowerCase() === "rect") { kind = "rect"; ratios = [(+shape.getAttribute("x") - x) / w, (+shape.getAttribute("y") - y) / h, +shape.getAttribute("width") / w, +shape.getAttribute("height") / h]; }
  if (shape && shape.tagName.toLowerCase() === "polygon") { kind = "poly"; ratios = shape.getAttribute("points").trim().split(/\s+/).flatMap((p) => { const [px, py] = p.split(",").map(Number); return [(px - x) / w, (py - y) / h]; }); }
  const m = ((g && g.getAttribute("transform")) || "").match(/rotate\(([-\d.e]+)/);
  return { x, y, w, h, rot: m ? +m[1] : 0, kind, ratios, clipAttr: img.getAttribute("clip-path") };
}, id);
const ratiosEq = (a, b) => a && b && a.length === b.length && a.every((v, i) => near(v, b[i], 1e-6));
const boxEq = (a, b) => a && b && ["x", "y", "w", "h", "rot"].every((k) => near(a[k], b[k], 1e-6));

const s = await openSignedIn({ base: "https://planyr.io" });
const { page } = s;
let stage = "setup";
try {
  await assertMeasurable(page, "verify-overlay-engine-live");
  const served = await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build);
  console.log("served build:", served, "| signed in as", s.proof.email);
  // seed on-device, then Save to the account (the app refuses to open an on-device-only site when signed in)
  await page.evaluate(([site]) => { const k = "planarfit:sites:v1"; const cur = JSON.parse(localStorage.getItem(k) || "{}"); cur[site.id] = site; localStorage.setItem(k, JSON.stringify(cur)); localStorage.setItem("planarfit:currentSite:v1", site.id); }, [site]);
  await page.goto("https://planyr.io/#/site", { waitUntil: "load" }); await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: /Review each site/ }).click({ timeout: 10000 });
  await page.getByRole("button", { name: "Save", exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: /^Done$/ }).first().click({ timeout: 5000 });
  await page.getByText("ZZ Overlay Engine Throwaway").first().click({ timeout: 10000 });
  await page.waitForSelector("image[data-overlay-image]", { timeout: 25000 });
  await page.waitForTimeout(2500);
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 3000 }); } catch (_) {}
  await page.waitForTimeout(800);
  const shot = (n) => SHOTS ? page.screenshot({ path: `${SHOTS}/${n}.png` }) : null;
  await shot("1-open");

  // ---- STEP 1 / 2 ----
  stage = "steps 1-2";
  const A0 = await measure(page, "ovA"), B0 = await measure(page, "ovB");
  const wantA = [CROP_A.x / imgW, CROP_A.y / imgH, CROP_A.w / imgW, CROP_A.h / imgH];
  const wantB = PTS_B.flatMap(([px, py]) => [px / imgW, py / imgH]);
  log(!!A0 && A0.clipAttr === "url(#ov-crop-ovA)" && A0.kind === "rect", `1 · legacy no-kind rect crop → <image clip-path> + <rect> clip (served ${served})`);
  log(ratiosEq(A0 && A0.ratios, wantA), `1 · rect clip = the stored crop {100,80,500,380} of 800×600 exactly (ratios ${A0 && A0.ratios.map((v) => v.toFixed(4))})`);
  log(!!B0 && B0.clipAttr === "url(#ov-crop-ovB)" && B0.kind === "poly", "2 · poly crop → <image clip-path> + <polygon> clip");
  log(ratiosEq(B0 && B0.ratios, wantB), "2 · polygon clip = the stored 4 vertices exactly");

  // ---- STEP 3 (ovB via canvas handles; ovA via the panel fields) ----
  stage = "step 3";
  await page.getByRole("button", { name: /Overlays/ }).first().click(); await page.waitForTimeout(600);
  const center = async (id) => page.evaluate((id) => { const r = document.querySelector(`image[data-overlay-id="${id}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
  const c = await center("ovB");
  await page.mouse.click(c.x, c.y); await page.waitForTimeout(800);
  const handle = (kind, i = 0) => page.evaluate(([k, i]) => { const e = [...document.querySelectorAll(`[data-handle="${k}"]`)][i]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, [kind, i]);
  const drag = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8); await page.mouse.up(); await page.waitForTimeout(700); };
  const undo = async () => { await page.mouse.move(700, 700); await page.keyboard.press("Control+z"); await page.waitForTimeout(900); };
  const welded = (m, want, label) => log(m && ratiosEq(m.ratios, want), `3 · ${label}: clip still welded (crop ratios unchanged)`);

  let before = await measure(page, "ovB");
  await drag({ x: c.x, y: c.y }, { x: c.x + 60, y: c.y + 40 });
  let m = await measure(page, "ovB");
  log(m && (!near(m.x, before.x, 0.5) || !near(m.y, before.y, 0.5)) && near(m.w, before.w, 1e-6), "3 · move: the sheet moved, size unchanged"); welded(m, wantB, "move");
  await undo(); m = await measure(page, "ovB"); log(boxEq(m, before), "3 · move: Undo restores the exact box");

  before = await measure(page, "ovB");
  const sh = await handle("overlay-scale", 2);
  await drag(sh, { x: sh.x + 45, y: sh.y + 30 });
  m = await measure(page, "ovB");
  log(m && m.w > before.w * 1.02, `3 · corner-scale: the sheet grew (${before.w.toFixed(1)} → ${m && m.w.toFixed(1)})`); welded(m, wantB, "corner-scale");
  await undo(); m = await measure(page, "ovB"); log(boxEq(m, before), "3 · corner-scale: Undo restores the exact box");

  before = await measure(page, "ovB");
  const rh = await handle("overlay-rotate");
  const cc = await center("ovB");
  await drag(rh, { x: cc.x + (rh.x - cc.x) * 0.2 + 120, y: cc.y + (rh.y - cc.y) * 0.2 - 20 });
  m = await measure(page, "ovB");
  log(m && !near(m.rot, before.rot, 0.5), `3 · rotate handle: rotation changed (${before.rot.toFixed(1)}° → ${m && m.rot.toFixed(1)}°)`); welded(m, wantB, "rotate");
  await undo(); m = await measure(page, "ovB"); log(boxEq(m, before), "3 · rotate: Undo restores the exact box");

  before = await measure(page, "ovB");
  await page.getByRole("button", { name: "Match 2 points", exact: true }).click(); await page.waitForTimeout(500);
  const pt = async (id, fx, fy) => { const r = await page.evaluate((id) => { const b = document.querySelector(`image[data-overlay-id="${id}"]`).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, id); return { x: r.x + r.w * fx, y: r.y + r.h * fy }; };
  const d1 = await pt("ovB", 0.45, 0.5), d2 = await pt("ovB", 0.62, 0.5);
  for (const [dp, mp] of [[d1, { x: d1.x + 30, y: d1.y + 60 }], [d2, { x: d2.x + 90, y: d2.y + 70 }]]) { await page.mouse.click(dp.x, dp.y); await page.waitForTimeout(400); await page.mouse.click(mp.x, mp.y); await page.waitForTimeout(500); }
  await shot("3-align-pairs");
  await page.getByRole("button", { name: /^Apply/ }).first().click({ timeout: 6000 }); await page.waitForTimeout(1000);
  m = await measure(page, "ovB");
  log(m && !boxEq(m, before), `3 · Align to map (2 pairs → Apply): the sheet was re-placed (rot ${before.rot.toFixed(1)}° → ${m && m.rot.toFixed(1)}°, width ${before.w.toFixed(1)} → ${m && m.w.toFixed(1)})`); welded(m, wantB, "Align to map");
  await undo(); m = await measure(page, "ovB"); log(boxEq(m, before), "3 · Align to map: Undo restores the exact box");

  // ovA (legacy rect) through the panel's own fields
  await page.getByText("ovA.png", { exact: true }).first().click(); await page.waitForTimeout(700);
  before = await measure(page, "ovA");
  await page.getByText("Rotate", { exact: true }).first().locator("xpath=following::input[1]").fill("40"); await page.keyboard.press("Enter"); await page.waitForTimeout(800);
  m = await measure(page, "ovA");
  log(m && near(m.rot, 40, 0.01), `3 · rect overlay, Rotate field → 40° (live ${m && m.rot})`); welded(m, wantA, "rect overlay rotate");
  await page.getByText("Width", { exact: true }).first().locator("xpath=following::button[normalize-space()='＋'][1]").click(); await page.waitForTimeout(800);
  const m2 = await measure(page, "ovA");
  log(m2 && m2.w > m.w, `3 · rect overlay, Width + (${m.w.toFixed(1)} → ${m2 && m2.w.toFixed(1)})`); welded(m2, wantA, "rect overlay width +");
  await shot("3-after-compose");

  // ---- STEP 4: the real print → export flow; export nodes must equal the canvas ----
  stage = "step 4";
  const canvasA = await measure(page, "ovA"), canvasB = await measure(page, "ovB");
  await page.evaluate(() => { window.__svgBlobs = []; const orig = URL.createObjectURL.bind(URL); URL.createObjectURL = (o) => { try { if (o && o.type === "image/svg+xml") o.text().then((t) => window.__svgBlobs.push(t)).catch(() => {}); } catch (_) {} return orig(o); }; });
  await page.locator('button:has-text("File ▾")').first().click({ timeout: 8000 });
  await page.locator('button:has-text("Download PDF / pick frame")').first().click({ timeout: 8000 });
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /^Continue ➜$/ }).first().click({ timeout: 8000 });
  await page.waitForSelector('[data-testid="print-compose"]', { timeout: 20000 });
  await page.getByRole("button", { name: "Download PDF", exact: true }).click({ timeout: 8000 });
  let sheet = "";
  for (let i = 0; i < 160 && !sheet; i++) { await page.waitForTimeout(500); const b = await page.evaluate(() => window.__svgBlobs || []); sheet = b.find((t) => /data-overlay-id="ov[AB]"/.test(t)) || ""; }
  log(!!sheet, "4 · the print flow produced a composed sheet containing both overlays");
  if (sheet) {
    const doc = new DOMParser2(sheet);
    for (const [id, cv] of [["ovA", canvasA], ["ovB", canvasB]]) {
      const e = doc.overlay(id);
      log(!!e && boxEq({ x: e.x, y: e.y, w: e.w, h: e.h, rot: e.rot }, cv) && e.clip === cv.kind, `4 · export ${id}: same box, rotation (${cv.rot.toFixed(1)}°) and ${cv.kind} clip as the canvas`);
      log(!!e && ratiosEq(e.ratios, cv.ratios), `4 · export ${id}: clip welded to the picture (crop ratios identical to canvas)`);
    }
  }
} catch (e) {
  log(false, `aborted during ${stage}: ${String(e && e.message || e).split("\n")[0]}`);
} finally {
  // ---- STEP 6: cleanup, always ----
  // MEASURED TRAPS (three versions of this step each "passed" and the row came back):
  //  (a) deleting while the working browser still holds the plan does not stick — closing it re-uploads its copy;
  //  (b) even from a fresh session, a PERMANENT delete is re-created within ~2 s by another already-open client
  //      on the shared test account, because a hard delete leaves it no tombstone to see. Trashing first (the
  //      app's own order — the DB refuses a hard delete of a live site anyway) lets every open client learn the
  //      site is deleted; only then is the hard delete safe.
  // So: close the working session → fresh session trashes → wait 2 min → fresh session hard-deletes → wait →
  // a third fresh session proves absence.
  try { await s.close(); } catch (_) {}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = async (fn) => { const f = await openSignedIn({ base: "https://planyr.io" }); try { return await f.page.evaluate(fn, ID); } finally { await f.close(); } };
  try {
    await sleep(4000);
    const t = await step(async (id) => (await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id")).data || []);
    await sleep(120000);
    const d = await step(async (id) => { const r = await window.pfSupabase.from("sites").delete().eq("id", id).select("id"); return { n: (r.data || []).length, err: r.error && String(r.error.message) }; });
    await sleep(90000);
    const rows = await step(async (id) => (await window.pfSupabase.from("sites").select("id").eq("id", id)).data || []);
    log(rows.length === 0, `6 · cleanup: trashed ${t.length}, waited 2 min, deleted ${d.n}${d.err ? " (" + d.err + ")" : ""}; 90 s later a fresh signed-in session sees ${rows.length} rows for ${ID}`);
  } catch (e) { log(false, "6 · cleanup FAILED: " + String(e && e.message || e)); }
}
console.log(fail ? `\n${fail} check(s) FAILED ❌` : "\nALL CHECKS PASSED ✅");
process.exit(fail ? 1 : 0);

// Minimal parse of the exported SVG text (no DOM in node): finds an overlay's <image>, its parent group's rotate
// and its <clipPath> shape, and returns the same measurements `measure` takes on the canvas.
function DOMParser2(text) {
  return { overlay(id) {
    const im = text.match(new RegExp(`<image[^>]*data-overlay-id="${id}"[^>]*>`));
    if (!im) return null;
    const num = (a) => { const mm = im[0].match(new RegExp(`\\s${a}="([-\\d.e]+)"`)); return mm ? +mm[1] : NaN; };
    const x = num("x"), y = num("y"), w = num("width"), h = num("height");
    const gi = text.lastIndexOf("<g", text.indexOf(im[0]));
    const gm = text.slice(gi, text.indexOf(">", gi)).match(/rotate\(([-\d.e]+)/);
    const cm = text.match(new RegExp(`<clipPath id="ov-crop-${id}"[^>]*>\\s*<(rect|polygon)([^>]*)/?>`));
    let ratios = null, clip = null;
    if (cm) { clip = cm[1] === "rect" ? "rect" : "poly"; const at = (a) => +(cm[2].match(new RegExp(`\\s${a}="([-\\d.e]+)"`)) || [])[1];
      if (cm[1] === "rect") ratios = [(at("x") - x) / w, (at("y") - y) / h, at("width") / w, at("height") / h];
      else ratios = cm[2].match(/points="([^"]+)"/)[1].trim().split(/\s+/).flatMap((p) => { const [px, py] = p.split(",").map(Number); return [(px - x) / w, (py - y) / h]; }); }
    return { x, y, w, h, rot: gm ? +gm[1] : 0, clip, ratios };
  } };
}
