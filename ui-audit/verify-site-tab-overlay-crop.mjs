/* NEW-1 (B1838704) — CROP ON THE SITE TAB OVERLAYS PANEL, driven end to end in a real browser,
 * logged out, no external GIS (ATTEMPT-BEFORE-YOU-PARK: every leg here is Claude-doable).
 *
 * The owner: "I cant see how to crop this overlay?" — on the Site tab's OVERLAYS panel, which had
 * only four faint edge-trim number fields. This proves the new visual Crop… (the shared ImageCropTool)
 * on THAT panel, and every neighbour it must compose with:
 *
 *   1. Crop… is on the panel and opens the rectangle/polygon tool.
 *   2. A POLYGON drawn vertex by vertex (closed on the first vertex) clips what draws — asserted in
 *      PIXELS (inside the triangle = the sheet's colour, outside = not), not just in the DOM.
 *   3. It is undoable (real Ctrl+Z) and redoable.
 *   4. Rotate: the clip stays WELDED to the sheet — pixel-checked at the rotated positions.
 *   5. Opacity and "Bring in front of the plan" keep the clip.
 *   6. LOCK: Crop…, Reset and the trim fields refuse; a forced click changes nothing.
 *   7. EXPORT PARITY: the exported sheet (buildExportSvg, the PDF/PNG/print source) is rasterized
 *      standalone and its sheet-coloured area has the SAME triangle fill fraction as the screen.
 *   8. Rect mode + Reset crop returns the full sheet.
 *   9. Persistence: a reload brings the polygon crop back.
 *  10. A DXF-derived overlay (dropped through the real file input) crops through the same tool.
 *  11. KNOWN-GOOD ARM (DRIVER-SCROLL §6): an UNCROPPED overlay reports NO clipPath and full colour at a
 *      corner — if this arm fails the run is VOID, the probe is wrong, not the app.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };

const imgW = 1000, imgH = 800;
const SHEET = [232, 168, 60]; // #e8a83c
const svg = (c) => `<svg xmlns='http://www.w3.org/2000/svg' width='${imgW}' height='${imgH}'><rect width='${imgW}' height='${imgH}' fill='${c}'/></svg>`;
const mk = (id, name, c) => ({ id, name, imgW, imgH, page: 1, pageCount: 1, ftPerPx: 1, rotation: 0, opacity: 1, locked: false,
  x: -imgW / 2, y: -imgH / 2, src: "data:image/svg+xml;utf8," + encodeURIComponent(svg(c)) });
const parcel = { id: "pc1", locked: false, points: [{ x: -600, y: -500 }, { x: 600, y: -500 }, { x: 600, y: 500 }, { x: -600, y: 500 }] };
const site = { id: "C1", groupId: "C1", site: "CropT", name: "Plan 1", origin: { lat: 29.78, lon: -95.82 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  sheetOverlays: [mk("ovA", "sheet-A.png", "#e8a83c")], parcelDrawings: [], status: "active", updatedAt: Date.now() };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(`(()=>{try{window.__PLANYR_E2E=true;if(!sessionStorage.getItem('seeded')){localStorage.setItem('planarfit:sites:v1',${JSON.stringify(JSON.stringify({ C1: site }))});sessionStorage.setItem('seeded','1');}}catch(e){}})();`);
const page = await ctx.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));
page.on("dialog", async (d) => { console.log("  [DIALOG — never allowed]", d.message().slice(0, 100)); fail++; await d.accept().catch(() => {}); });
await assertMeasurable(page, "verify-site-tab-overlay-crop");

const openPlan = async () => {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  if (!(await page.locator("text=Overlays").count())) {
    await page.locator('[data-testid="module-tab-site-planner"]').first().click();
    await page.waitForTimeout(1200);
    await page.locator("text=CropT").first().dblclick();
    await page.waitForTimeout(2200);
  }
  await page.locator("text=Overlays").first().click();
  await page.waitForTimeout(500);
  await page.locator('button[title^="Zoom to fit"]').first().click(); // the panel narrows the canvas — frame the sheet in what's left
  await page.waitForTimeout(700);
};
const expandRow = async (name) => { await page.locator("button", { hasText: name }).first().click(); await page.waitForTimeout(400); };
const stored = (id) => page.evaluate((id) => {
  const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const o = raw.C1 && raw.C1.sheetOverlays.find((x) => x.id === id);
  return o ? { crop: o.crop ?? null, locked: !!o.locked, rotation: o.rotation || 0, opacity: o.opacity } : null;
}, id);
const waitStored = async (id, pred, ms = 4000) => { const t = Date.now(); let s; while (Date.now() - t < ms) { s = await stored(id); if (pred(s)) return s; await page.waitForTimeout(150); } return s; };
const clipInfo = (id) => page.evaluate((id) => {
  const cp = document.querySelector(`clipPath[id="ov-crop-${id}"]`);
  const img = document.querySelector(`image[data-overlay-id="${id}"]`);
  const g = img && img.closest("g[data-feature]");
  return { hasClip: !!cp, shape: cp ? (cp.querySelector("polygon") ? "poly" : cp.querySelector("rect") ? "rect" : "?") : null,
    points: cp && cp.querySelector("polygon") ? cp.querySelector("polygon").getAttribute("points") : null,
    ref: img ? img.getAttribute("clip-path") : null, opacity: img ? img.getAttribute("opacity") : null,
    box: img ? { x: +img.getAttribute("x"), y: +img.getAttribute("y"), w: +img.getAttribute("width"), h: +img.getAttribute("height") } : null,
    transform: g ? g.getAttribute("transform") : null };
}, id);
// Screen (client) coords of an IMAGE-FRACTION point, honouring the overlay's rotation about its centre.
const toClient = async (id, fx, fy) => page.evaluate(({ id, fx, fy }) => {
  const img = document.querySelector(`image[data-overlay-id="${id}"]`);
  const svg = img.ownerSVGElement;
  const x = +img.getAttribute("x") + fx * +img.getAttribute("width"), y = +img.getAttribute("y") + fy * +img.getAttribute("height");
  const p = svg.createSVGPoint(); p.x = x; p.y = y;
  const m = img.getScreenCTM(); const q = p.matrixTransform(m);
  return { x: q.x, y: q.y };
}, { id, fx, fy });
const pixelAt = async (pt) => {
  const buf = await page.screenshot({ clip: { x: Math.round(pt.x) - 1, y: Math.round(pt.y) - 1, width: 3, height: 3 } });
  return page.evaluate(async (b64) => {
    const im = new Image(); im.src = "data:image/png;base64," + b64; await im.decode();
    const c = document.createElement("canvas"); c.width = 3; c.height = 3; const g = c.getContext("2d"); g.drawImage(im, 0, 0);
    return Array.from(g.getImageData(1, 1, 1, 1).data.slice(0, 3));
  }, buf.toString("base64"));
};
const isSheet = (px) => Math.abs(px[0] - SHEET[0]) < 22 && Math.abs(px[1] - SHEET[1]) < 22 && Math.abs(px[2] - SHEET[2]) < 22;
// Triangle in image fractions: (0.1,0.1) (0.9,0.1) (0.5,0.9). Inside/outside probe points:
const IN = [[0.5, 0.35], [0.5, 0.7], [0.3, 0.2]];
const OUTSIDE = [[0.1, 0.8], [0.9, 0.8], [0.05, 0.05]];

await openPlan();
await expandRow("sheet-A.png");

/* ---- 11. KNOWN-GOOD ARM ---------------------------------------------------------------------- */
{
  const ci = await clipInfo("ovA");
  const corner = await pixelAt(await toClient("ovA", 0.1, 0.8));
  await page.screenshot({ path: OUT + "site-crop-arm.png" });
  const armOk = !ci.hasClip && isSheet(corner);
  check("[known-good arm] uncropped overlay: no clipPath, and a corner reads the sheet colour", armOk, JSON.stringify({ ci: ci.hasClip, corner }));
  if (!armOk) { console.log("  ⛔ VOID — the probe cannot see a known answer; no score reported."); await browser.close(); process.exit(2); }
}

/* ---- 1. Crop… is on the panel ------------------------------------------------------------------ */
const cropBtn = page.locator('[data-testid="overlay-crop-open"]');
check("Crop… button is on the OVERLAYS panel row", (await cropBtn.count()) === 1 && (await cropBtn.isEnabled()));
await page.screenshot({ path: OUT + "site-crop-panel.png" });

/* ---- 2. Draw a polygon ------------------------------------------------------------------------ */
await cropBtn.click();
await page.waitForTimeout(600);
const dlg = page.locator('[data-testid="overlay-crop-dialog"]');
check("Crop… opens the crop tool dialog", (await dlg.count()) === 1);
await dlg.locator("button", { hasText: "Polygon" }).click();
await dlg.locator("button", { hasText: "Clear polygon" }).click();
await page.waitForTimeout(200);
const box = await dlg.locator("img").first().boundingBox();
const at = (fx, fy) => ({ x: box.x + fx * box.width, y: box.y + fy * box.height });
for (const [fx, fy] of [[0.1, 0.1], [0.9, 0.1], [0.5, 0.9]]) { const p = at(fx, fy); await page.mouse.click(p.x, p.y); await page.waitForTimeout(350); }
{ const p = at(0.1, 0.1); await page.mouse.click(p.x, p.y); await page.waitForTimeout(300); } // close on first vertex
await page.screenshot({ path: OUT + "site-crop-dialog-poly.png" });
await dlg.locator("button", { hasText: "Done" }).click();
await page.waitForTimeout(500);
check("dialog closes on Done", (await dlg.count()) === 0);
const sPoly = await waitStored("ovA", (s) => s && s.crop && s.crop.kind === "poly");
check("polygon crop persisted on the sheetOverlays entry (kind:'poly', 3 vertices, image px)", !!(sPoly && sPoly.crop && sPoly.crop.kind === "poly" && sPoly.crop.pts.length === 3
  && Math.abs(sPoly.crop.pts[1][0] - 900) < 6 && Math.abs(sPoly.crop.pts[2][1] - 720) < 6), JSON.stringify(sPoly && sPoly.crop));
let ci = await clipInfo("ovA");
check("<clipPath> with a <polygon> is rendered and referenced by the <image>", ci.shape === "poly" && ci.ref === "url(#ov-crop-ovA)", JSON.stringify(ci));
const pixCheck = async (label) => {
  const ins = [], outs = [];
  for (const [fx, fy] of IN) ins.push(await pixelAt(await toClient("ovA", fx, fy)));
  for (const [fx, fy] of OUTSIDE) outs.push(await pixelAt(await toClient("ovA", fx, fy)));
  check(`${label}: every point INSIDE the triangle shows the sheet`, ins.every(isSheet), JSON.stringify(ins));
  check(`${label}: every point OUTSIDE the triangle does NOT`, outs.every((p) => !isSheet(p)), JSON.stringify(outs));
};
await page.mouse.move(5, 450);
await pixCheck("pixels after poly crop");
await page.screenshot({ path: OUT + "site-crop-poly-canvas.png" });

/* ---- 3. Undo / redo (real key input) --------------------------------------------------------- */
check("Undo is armed after the crop (the history saw it as a real change)", !(await page.evaluate(() => document.querySelector('button[aria-label="Undo"]')?.disabled)));
await page.keyboard.press("Control+z");
const sUndo = await waitStored("ovA", (s) => s && !s.crop);
check("Ctrl+Z removes the crop (one undo frame)", !!(sUndo && !sUndo.crop), JSON.stringify(sUndo && sUndo.crop));
check("…and the clipPath is gone", !(await clipInfo("ovA")).hasClip);
await page.keyboard.press("Control+Shift+z");
const sRedo = await waitStored("ovA", (s) => s && s.crop && s.crop.kind === "poly");
check("Ctrl+Shift+Z brings the polygon crop back", !!(sRedo && sRedo.crop && sRedo.crop.kind === "poly"));

/* ---- 4. Rotate — the clip stays welded ------------------------------------------------------- */
{
  const inp = page.locator('[data-testid="overlay-rotation"]');
  await inp.fill("30"); await inp.press("Enter");
  await waitStored("ovA", (s) => s && s.rotation === 30);
  await page.waitForTimeout(400);
  const ci2 = await clipInfo("ovA");
  check("rotation lives on the parent <g>; the clip polygon's points are unchanged (not baked in)", /rotate\(30/.test(ci2.transform || "") && ci2.points === (await (async () => ci.points)()), JSON.stringify({ t: ci2.transform }));
  await page.mouse.move(5, 450);
  await pixCheck("pixels after Rotate 30°");
  await page.screenshot({ path: OUT + "site-crop-poly-rotated.png" });
  await inp.fill("0"); await inp.press("Enter");
  await waitStored("ovA", (s) => s && s.rotation === 0);
  await page.waitForTimeout(300);
}

/* ---- 5. Opacity + Bring in front of the plan -------------------------------------------------- */
{
  const pct = page.locator('[data-testid="overlay-opacity-pct"]');
  await pct.fill("50"); await pct.blur();
  await page.waitForTimeout(300);
  const c = await clipInfo("ovA");
  check("Opacity 50% applies AND the clip is kept", c.opacity === "0.5" && c.ref === "url(#ov-crop-ovA)", JSON.stringify(c));
  await pct.fill("100"); await pct.blur();
  await page.locator('[data-testid="reference-above-ovA"]').check();
  await page.waitForTimeout(400);
  const c2 = await clipInfo("ovA");
  check("\"Bring in front of the plan\" keeps the clip (same shape, still referenced)", c2.shape === "poly" && c2.ref === "url(#ov-crop-ovA)");
  await page.mouse.move(5, 450);
  await pixCheck("pixels in front of the plan");
  await page.locator('[data-testid="reference-above-ovA"]').uncheck();
  await page.waitForTimeout(300);
}

/* ---- 6. Lock refuses ------------------------------------------------------------------------- */
{
  const before = JSON.stringify((await stored("ovA")).crop);
  await page.locator('[data-testid="reference-row-ovA"] [title="Lock"]').click();
  await waitStored("ovA", (s) => s && s.locked);
  await page.waitForTimeout(300);
  check("locked: Crop… is disabled", await page.locator('[data-testid="overlay-crop-open"]').isDisabled());
  check("locked: Reset crop is disabled", await page.locator('[data-testid="overlay-crop-reset"]').isDisabled());
  await page.locator('[data-testid="overlay-crop-reset"]').click({ force: true }).catch(() => {});
  await page.locator('[data-testid="overlay-crop-open"]').click({ force: true }).catch(() => {});
  await page.waitForTimeout(400);
  check("locked: a forced click on Reset / Crop… changes nothing and opens nothing",
    JSON.stringify((await stored("ovA")).crop) === before && (await page.locator('[data-testid="overlay-crop-dialog"]').count()) === 0);
  await page.locator('[data-testid="reference-row-ovA"] [title="Unlock"]').click();
  await waitStored("ovA", (s) => s && !s.locked);
}

/* ---- 7. Export parity ------------------------------------------------------------------------ */
{
  const frac = await page.evaluate(async ({ SHEET }) => {
    const html = window.__plannerExportSvg ? await window.__plannerExportSvg() : null;
    if (!html) return { err: "no export hook / no sheet" };
    const hasClip = html.includes('id="ov-crop-ovA"') && /<polygon[^>]*points=/.test(html.slice(html.indexOf('id="ov-crop-ovA"')));
    const blob = new Blob([html.includes("xmlns=") ? html : html.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"')], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const im = new Image(); im.src = url; await im.decode();
    const W = 1200, H = Math.round(W * (im.naturalHeight / im.naturalWidth || 0.75));
    const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d"); g.drawImage(im, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    let n = 0, minX = W, minY = H, maxX = 0, maxY = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (Math.abs(d[i] - SHEET[0]) < 22 && Math.abs(d[i + 1] - SHEET[1]) < 22 && Math.abs(d[i + 2] - SHEET[2]) < 22) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    const bboxA = (maxX - minX + 1) * (maxY - minY + 1);
    return { hasClip, n, fill: n / bboxA, aspect: (maxX - minX + 1) / (maxY - minY + 1) };
  }, { SHEET });
  // Triangle (0.1,0.1)(0.9,0.1)(0.5,0.9) on a 1000×800 sheet: bbox 800×640 → aspect 1.25, fill 0.5.
  check("export: the cloned sheet carries the polygon <clipPath>", !!frac.hasClip, JSON.stringify(frac));
  check("export: the rasterized sheet shows a TRIANGLE of sheet colour (fill ≈ 0.5 of its box, aspect ≈ 1.25) — same as the screen",
    frac.n > 1000 && Math.abs(frac.fill - 0.5) < 0.06 && Math.abs(frac.aspect - 1.25) < 0.08, JSON.stringify(frac));
}

/* ---- 9. Persistence across reload -------------------------------------------------------------- */
await openPlan();
{
  const c = await clipInfo("ovA");
  check("after a reload the polygon crop is still applied", c.shape === "poly" && c.ref === "url(#ov-crop-ovA)", JSON.stringify(c));
  await expandRow("sheet-A.png");
  check("the row now offers Edit crop… and a polygon note instead of trim fields",
    (await page.locator('[data-testid="overlay-crop-open"]').textContent()).includes("Edit crop") && (await page.locator("text=Cropped to a polygon").count()) === 1);
}

/* ---- 8. Rect mode + Reset crop ---------------------------------------------------------------- */
{
  await page.locator('[data-testid="overlay-crop-open"]').click();
  await page.waitForTimeout(500);
  const d = page.locator('[data-testid="overlay-crop-dialog"]');
  const pts = await d.locator("circle").count();
  check("re-opening shows the existing polygon, editable (3 vertex handles)", pts === 3, `circles=${pts}`);
  await d.locator("button", { hasText: "Rectangle" }).click();
  await d.locator("button", { hasText: "Done" }).click();
  const sR = await waitStored("ovA", (s) => s && (s.crop === null || (s.crop && s.crop.kind !== "poly")));
  check("switching to Rectangle (full page) and Done commits no crop — full sheet", sR && sR.crop === null, JSON.stringify(sR && sR.crop));
  // A real rect via the trim fields, then Reset crop.
  const f = page.locator('input[aria-label="Crop Left edge"]');
  await f.fill("200");
  const sT = await waitStored("ovA", (s) => s && s.crop && s.crop.kind === "rect");
  check("trim field writes a kind-stamped rect crop", !!(sT && sT.crop && sT.crop.kind === "rect" && sT.crop.x === 200), JSON.stringify(sT && sT.crop));
  check("…drawn as a rect <clipPath>", (await clipInfo("ovA")).shape === "rect");
  await page.locator('[data-testid="overlay-crop-reset"]').click();
  const s0 = await waitStored("ovA", (s) => s && !s.crop);
  check("Reset crop returns the full sheet (crop cleared, no clipPath)", !!(s0 && !s0.crop) && !(await clipInfo("ovA")).hasClip);
}

/* ---- 10. DXF-derived overlay ------------------------------------------------------------------ */
{
  const dxf = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "2", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES",
    "0", "LINE", "8", "0", "10", "0", "20", "0", "30", "0", "11", "400", "21", "300", "31", "0",
    "0", "LINE", "8", "0", "10", "0", "20", "300", "30", "0", "11", "400", "21", "0", "31", "0",
    "0", "ENDSEC", "0", "EOF"].join("\n");
  const p = OUT + "tiny-crop.dxf"; writeFileSync(p, dxf);
  await page.locator('[data-testid="left-menu-panel"] input[type="file"][accept="application/pdf,image/*,.dxf,.dwg"]').setInputFiles(p);
  await page.waitForTimeout(4000);
  const dx = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const o = raw.C1.sheetOverlays.find((x) => x.kind === "dxf");
    return o ? { id: o.id, name: o.name } : null;
  });
  check("[precondition] the DXF overlay was placed through the real file input", !!dx, JSON.stringify(dx));
  if (dx) {
    const rows = page.locator("button", { hasText: dx.name });
    if (!(await page.locator(`[data-testid="overlay-crop-${dx.id}"]`).count())) await rows.first().click();
    await page.waitForTimeout(400);
    const btn = page.locator(`[data-testid="overlay-crop-${dx.id}"] [data-testid="overlay-crop-open"]`);
    check("DXF overlay offers Crop…, enabled", (await btn.count()) === 1 && (await btn.isEnabled()));
    await btn.click(); await page.waitForTimeout(500);
    const d = page.locator('[data-testid="overlay-crop-dialog"]');
    // drag the bottom-right corner handle halfway in
    await d.locator("img").first().evaluate((im) => im.decode().catch(() => {}));
    await page.waitForTimeout(400); // let the dialog settle before grabbing a grip
    const b = await d.locator("img").first().boundingBox();
    // The bottom-right grip, located by its own cursor, pressed at its CENTRE — which sits exactly on the
    // image corner; before NEW-1 the box clipped three quarters of it away and a centre press missed.
    const g = await page.evaluate(({ r, bt }) => {
      const hs = [...document.querySelectorAll('[data-testid="overlay-crop-dialog"] div')].filter((e) => e.style.cursor === "nwse-resize");
      const h = hs[hs.length - 1]; if (!h) return null;
      const q = h.getBoundingClientRect();
      const cx = (q.left + q.right) / 2, cy = (q.top + q.bottom) / 2;
      return { x: cx, y: cy, w: q.width, hit: document.elementFromPoint(cx, cy) === h, outside: cx > r && cy > bt };
    }, { r: b.x + b.width, bt: b.y + b.height });
    check("[precondition] the crop tool's corner grip is the element under the press point", !!(g && g.hit), JSON.stringify(g));
    await page.mouse.move(g.x, g.y); await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5, { steps: 6 }); await page.mouse.up();
    await page.screenshot({ path: OUT + "site-crop-dxf-dialog.png" });
    await d.locator("button", { hasText: "Done" }).click();
    const sd = await page.waitForFunction((id) => {
      const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const o = raw.C1.sheetOverlays.find((x) => x.id === id);
      return o && o.crop ? o.crop : null;
    }, dx.id, { timeout: 4000 }).then((h) => h.jsonValue()).catch(() => null);
    check("DXF overlay: a rect crop from the tool persists and clips", !!(sd && sd.kind === "rect") && (await clipInfo(dx.id)).shape === "rect", JSON.stringify(sd));
  }
}

/* ---- 12. PDF overlay + Knock out white paper -------------------------------------------------- */
{
  const pdf = new URL("../test/fixtures/site-plan-crop/e-size-title-block.pdf", import.meta.url).pathname;
  await page.locator('[data-testid="left-menu-panel"] input[type="file"][accept="application/pdf,image/*,.dxf,.dwg"]').setInputFiles(pdf);
  const pd = await page.waitForFunction(() => {
    const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const o = raw.C1.sheetOverlays.find((x) => /title-block/.test(x.name || ""));
    return o && o.imgW ? { id: o.id, name: o.name } : null;
  }, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
  check("[precondition] the PDF overlay was placed through the real file input", !!pd, JSON.stringify(pd));
  if (pd) {
    if (!(await page.locator(`[data-testid="overlay-crop-${pd.id}"]`).count())) await page.locator("button", { hasText: pd.name }).first().click();
    await page.waitForTimeout(400);
    const row = page.locator(`[data-testid="reference-row-${pd.id}"]`);
    await row.locator('input[aria-label="Crop Bottom edge"]').fill("40");
    const cropOf = () => page.evaluate((id) => { const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); const o = raw.C1.sheetOverlays.find((x) => x.id === id); return o ? { crop: o.crop || null, ko: o.knockout, srcLen: (o.src || "").length } : null; }, pd.id);
    const t0 = Date.now(); let c0; while (Date.now() - t0 < 4000) { c0 = await cropOf(); if (c0 && c0.crop) break; await page.waitForTimeout(150); }
    check("PDF overlay: a trim-field crop is stored", !!(c0 && c0.crop && c0.crop.kind === "rect"), JSON.stringify(c0 && c0.crop));
    const ko = row.locator("text=Knock out white paper");
    if (await ko.count()) {
      await ko.click();
      const t1 = Date.now(); let c1; while (Date.now() - t1 < 8000) { c1 = await cropOf(); if (c1 && c1.ko === false) break; await page.waitForTimeout(200); }
      check("Knock out white paper toggles (sheet re-rendered) and the crop survives it unchanged",
        !!(c1 && c1.ko === false && JSON.stringify(c1.crop) === JSON.stringify(c0.crop)) && (await clipInfo(pd.id)).shape === "rect", JSON.stringify({ ko: c1 && c1.ko, same: c1 && JSON.stringify(c1.crop) === JSON.stringify(c0.crop) }));
    } else check("Knock out white paper control is offered for the PDF overlay", false);
  }
}

check("no uncaught page errors", jsErrors.length === 0, jsErrors.slice(0, 3).join(" | "));
await browser.close();
console.log(fail ? `\n❌ ${fail} check(s) failed` : "\n✅ all checks passed");
process.exit(fail ? 1 : 0);
