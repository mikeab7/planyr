/* NEW-1/NEW-2/NEW-3 (2026-10-22, work-laptop report) — ONE signed-in check on the owner's WORK-LAPTOP window (1913x641 @2.6775, Chromium),
 * against a deploy or a local preview. Arms:
 *   A  Help (?) → Help and → Report views stay fully on screen and Back is the topmost thing at its own centre   (NEW-2 — RED on ff7be38)
 *   B  hovering the header with a REAL mouse leaves it laid out, opaque, on top, and painted (pixels not a dark band)   (NEW-3 — positive control: never reproduced)
 *   C  5965 Miller Ln, Christiana TN (parcel 156-031.00-000): found, selected, "Plan this site" → the plan's lot outline is COMPLETE   (NEW-1 — positive control)
 *        (all 15 distinct vertices of the source's 16-point ring in the drawn polygon, and the painted outline's pixel extent covers the path's on-screen box)
 *   D  a Texas address still selects a Harris lot (known-good control for C)
 * Every row records /version.json IN THE SAME CALL (merged ≠ live). The throwaway plan C creates is deleted in `finally`. Exit 0 = all passed · 1 = a row failed · 2 = VOID.
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-work-laptop-live.mjs [https://planyr.io] [--out f.json] [--shots dir] */
import { writeFileSync, mkdirSync } from "node:fs";
import { openLaptop, LAPTOP } from "./lib/workLaptopRig.mjs";
import { cleanupLive } from "./lib/liveFixtures.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { decodePng } from "./lib/pngDiff.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const OUT = flag("--out") || "work-laptop-live.json";
const SHOTS = flag("--shots") || "ui-audit/screenshots/work-laptop";
mkdirSync(SHOTS, { recursive: true });

const s = await openLaptop({ base: BASE });
const page = s.page;
await assertMeasurable(page, "verify-work-laptop-live");
console.log(`signed in as ${s.proof.email} · window ${LAPTOP.width}x${LAPTOP.height} @${LAPTOP.deviceScaleFactor} · base ${BASE}`);
const sleep = (ms) => page.waitForTimeout(ms);
const stamp = () => page.evaluate(async () => { const v = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null); return v && v.build; });
const rows = [];
const record = async (r) => { const build = await stamp(); rows.push({ ...r, build }); console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name} · ${r.detail}  (build ${build})`); };
let planId = null, voided = false;

async function freshMap() {
  if (page.url().startsWith(BASE + "/?planyrDiag=1#/site")) await page.reload({ waitUntil: "domcontentloaded" });
  else await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="map-toolbar-select-parcels"]'), null, { timeout: 60000 });
  await sleep(1500);
}
const searchFor = async (text) => { const b = page.locator('input[role="combobox"]').first(); await b.click(); await b.fill(""); await b.fill(text); await sleep(1500); await b.press("Enter"); };
const held = () => page.evaluate(() => (window.__mapSelectedParcels ? window.__mapSelectedParcels() : null)).catch(() => null);
const waitFor = async (fn, ms = 40000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(300); } return v; };

try {
  await freshMap();

  /* A — Help */
  {
    const panel = () => page.evaluate(() => { const m = document.querySelector("[data-menu-layer]"); if (!m) return null; const r = m.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight, left: r.left, right: r.right, vw: innerWidth }; });
    const back = () => page.evaluate(() => {
      const el = [...document.querySelectorAll("[data-menu-layer] button")].find((b) => b.textContent.trim() === "Back"); if (!el) return { ok: false, why: "no Back button" };
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { ok: false, why: `Back centre (${Math.round(x)},${Math.round(y)}) is outside the window` };
      const t = document.elementFromPoint(x, y); return { ok: !!t && (t === el || el.contains(t)), why: "topmost at its centre: " + (t ? t.tagName : "nothing") };
    });
    const inside = (b) => !!b && b.top >= -0.5 && b.bottom <= b.vh + 0.5 && b.left >= -0.5 && b.right <= b.vw + 0.5;
    await page.locator('[data-testid="help-report-fab"]').click(); await sleep(400);
    const m0 = await panel();
    await page.getByRole("button", { name: "Help", exact: true }).click(); await sleep(500);
    const m1 = await panel(), b1 = await back();
    await page.screenshot({ path: `${SHOTS}/help-view.png` });
    await page.evaluate(() => [...document.querySelectorAll("[data-menu-layer] button")].find((b) => b.textContent.trim() === "Back").click()); await sleep(300);
    await page.getByRole("button", { name: "Report a problem", exact: true }).click(); await sleep(500);
    const m2 = await panel(), b2 = await back();
    await page.screenshot({ path: `${SHOTS}/report-view.png` });
    await page.keyboard.press("Escape"); await sleep(300);
    await record({ name: "A Help (?) menu / Help / Report views stay on screen, Back reachable", pass: inside(m0) && inside(m1) && inside(m2) && b1.ok && b2.ok,
      detail: `menu bottom ${m0 && Math.round(m0.bottom)} · Help bottom ${m1 && Math.round(m1.bottom)} · Report bottom ${m2 && Math.round(m2.bottom)} (window ${m0 && m0.vh}) · Help Back: ${b1.why} · Report Back: ${b2.why}` });
  }

  /* B — header hover (real mouse) */
  {
    const hdr = () => page.evaluate(() => { const h = [...document.querySelectorAll("header")].find((e) => e.getBoundingClientRect().width > 0); if (!h) return null; const r = h.getBoundingClientRect(), cs = getComputedStyle(h); const t = document.elementFromPoint(r.left + r.width / 2, r.top + 20); return { h: Math.round(r.height), op: cs.opacity, vis: cs.visibility, disp: cs.display, onTop: !!t && h.contains(t), fs: !!document.fullscreenElement }; });
    const band = async () => { const png = decodePng(await page.screenshot()); const k = png.width / LAPTOP.width, C = png.channels; let sum = 0, sum2 = 0, n = 0; for (let y = 0; y < Math.round(80 * k); y += 2) for (let x = 0; x < png.width; x += 2) { const i = (y * png.width + x) * C; const l = (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3; sum += l; sum2 += l * l; n++; } const mean = sum / n; return { mean, sd: Math.sqrt(sum2 / n - mean * mean) }; };
    const before = await hdr(), b0 = await band();
    const seen = [];
    for (const [x, y] of [[120, 20], [400, 20], [900, 20], [1300, 60], [1700, 20], [1880, 20], [300, 60]]) { await page.mouse.move(x, y, { steps: 12 }); await sleep(450); seen.push(await hdr()); }
    const b1 = await band();
    await page.screenshot({ path: `${SHOTS}/header-hovered.png`, clip: { x: 0, y: 0, width: LAPTOP.width, height: 110 } });
    const ok = seen.every((h) => h && h.h === before.h && h.op === "1" && h.vis === "visible" && h.disp !== "none" && h.onTop) && Math.abs(b1.mean - b0.mean) < 3 && b1.sd > b0.sd * 0.7;
    await record({ name: "B hovering the header leaves it laid out, opaque, on top and painted", control: true, pass: ok, detail: `header ${before.h} px tall; across 7 hover points height/opacity/visibility/on-top all held: ${seen.every((h) => h && h.h === before.h && h.op === "1" && h.onTop)}; painted band mean ${b0.mean.toFixed(1)}→${b1.mean.toFixed(1)}, spread ${b0.sd.toFixed(1)}→${b1.sd.toFixed(1)} (a dark band would collapse both)` });
  }

  /* D — Texas control FIRST (so a failure voids C) */
  await freshMap();
  await searchFor("1200 McKinney St, Houston, TX 77010");
  const hTx = await waitFor(async () => { const h = await held(); return h && h.length ? h : null; }, 40000);
  const okTx = !!(hTx && /harris/i.test(String(hTx[0].county)));
  await record({ name: "D a Texas address (1200 McKinney St, Houston) still selects a Harris lot", control: true, pass: okTx, detail: hTx ? `county ${hTx[0].county} · acct ${hTx[0].acct}` : "nothing selected" });
  if (!okTx) voided = true;

  /* C — Miller Ln */
  await freshMap();
  await searchFor("5965 Miller Ln, Christiana, TN");
  const hTn = await waitFor(async () => { const h = await held(); return h && h.length && h[0].attrs && Object.keys(h[0].attrs).length ? h : null; }, 45000);
  const idTn = hTn && hTn[0].attrs && (hTn[0].attrs.ParcelID || hTn[0].acct);
  await record({ name: "C1 5965 Miller Ln, Christiana TN is found and selected (156-031.00-000)", control: true, pass: !!hTn && /156-031\.00-000/.test(String(idTn)), detail: hTn ? `${idTn} · ${hTn[0].county}` : "nothing selected" });
  await sleep(2500);
  await page.locator('[data-testid="map-decide-verb-site"]').first().click({ timeout: 15000 });
  planId = await waitFor(async () => (page.url().match(/#\/project\/([^/]+)/) || [])[1] || null, 60000);
  await sleep(9000);
  const geom = await page.evaluate(() => {
    const g = [...document.querySelectorAll('[data-feature^="parcel:"]')].find((e) => e.querySelector("polygon")); if (!g) return null;
    // the lot's outline is a <polygon points="x,y x,y …"> (the green stroke one); the vertex count is what the model drew
    const poly = [...g.querySelectorAll("polygon")].find((p) => /^#?[0-9a-f]{3,8}$/i.test(p.getAttribute("stroke") || "") || (p.getAttribute("stroke") || "").startsWith("#")) || g.querySelector("polygon");
    const best = poly; const pts = (best.getAttribute("points") || "").trim().split(/\s+/).filter(Boolean).length;
    const r = best.getBoundingClientRect(); return { pts, x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const png = decodePng(await page.screenshot({ path: `${SHOTS}/miller-plan.png` }));
  const k = png.width / LAPTOP.width, C = png.channels;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, n = 0;
  if (geom) for (let y = Math.max(0, Math.floor((geom.y - 6) * k)); y < Math.min(png.height, Math.ceil((geom.y + geom.h + 6) * k)); y++) for (let x = Math.max(0, Math.floor((geom.x - 6) * k)); x < Math.min(png.width, Math.ceil((geom.x + geom.w + 6) * k)); x++) {
    const i = (y * png.width + x) * C; if (png.data[i + 1] > 170 && png.data[i] < 90 && png.data[i + 2] < 90) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  const cover = geom && n ? Math.min((maxX - minX) / k / Math.max(1, Math.min(geom.w, LAPTOP.width)), (maxY - minY) / k / Math.max(1, Math.min(geom.h, LAPTOP.height))) : 0;
  await record({ name: "C2 the plan's lot outline is complete (all 15 distinct vertices of the 16-point ring drawn, painted outline spans the whole lot)", control: true, pass: !!geom && geom.pts >= 15 && cover > 0.9,
    detail: geom ? `polygon carries ${geom.pts} vertices · lot box ${Math.round(geom.w)}x${Math.round(geom.h)} px on screen · outline ink covers ${(cover * 100).toFixed(0)}% of it in both directions (${n} outline pixels)` : "no parcel polygon found" });
} finally {
  if (planId) {
    const left = await cleanupLive(page, { planId }).catch((e) => ({ error: String(e) }));
    console.log("cleanup of the throwaway plan:", JSON.stringify(left));
    rows.push({ name: "cleanup", pass: !!left && !left.error && (!left.errors || !left.errors.length) && left.left && left.left.site === 0, detail: JSON.stringify(left) });
  }
  await s.close();
}
writeFileSync(OUT, JSON.stringify({ base: BASE, signedInAs: s.proof.email, window: LAPTOP, rows }, null, 2));
const failed = rows.filter((r) => !r.pass);
console.log(`\n${rows.length - failed.length}/${rows.length} rows passed · results → ${OUT}`);
if (voided) { console.log("VOID — the Texas control arm failed; nothing above can be trusted."); process.exit(2); }
process.exit(failed.length ? 1 : 0);
