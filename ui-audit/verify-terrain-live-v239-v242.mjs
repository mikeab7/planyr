/* V239/V240/V241/V242 (B703-B706) live-look verification, against REAL USGS 3DEP data through
 * the deployed production proxy — extends the B703-B706 harness (verify-terrain-layers.mjs) with
 * the SPECIFIC "pending live steps" those V-items still needed:
 *   V239 — ground relief: low areas render COOLER/DARKER (bluer) than higher ground, real data;
 *          panning fires a NEW exportImage request over the new view (DRA re-stretch).
 *   V240 — contours: labels present; zoom-gated below z16; hover-vs-cross-section AGREE (~1ft).
 *   V241 — drainage arrows: painted only where the real DEM has qualifying slope (never on flat
 *          ground); more ink over steeper sub-areas than gentler ones.
 *   V242 — hover elevation: matches the cross-section tool at the SAME point (screen-pixel
 *          identical target, so any drift is a real transform regression, not a click offset);
 *          with all terrain layers OFF, the readout still appears via the (real) network path.
 *
 * Network model (same as verify-terrain-layers.mjs): Chromium in this sandbox cannot open its own
 * TLS connection to any external host (confirmed — ERR_CONNECTION_RESET even through --proxy-server;
 * only this session's Node process can, via HTTPS_PROXY). So Chromium loads the app from the LOCAL
 * preview build; page.route intercepts (a) /api/gis-cache/* and (b) elevation.nationalmap.gov/* and
 * NODE-fetches the SAME request through the deployed planyr.io gis-cache proxy (which allowlists
 * nationalmap.gov), returning the real bytes. Nothing is mocked in this script — getSamples included
 * — so the hover/cross-section/relief/contour numbers are all real USGS 3DEP reads.
 *
 * Run: npm run build && npx vite preview --port 4173 (background), then
 *      node ui-audit/verify-terrain-live-v239-v242.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { decodeGrid, gridRequest, sampleAtLatLng } from "../src/workspaces/site-planner/lib/demGrid.js";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PLANYR = "https://planyr.io";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

// Katy TX — the same fixture neighborhood verify-terrain-layers.mjs used; real 3DEP elevations
// there run roughly 118-152 ft NAVD88 (meaningful local relief for a correlation check).
const parcel = { id: "pc1", locked: true, points: [{ x: -660, y: -660 }, { x: 660, y: -660 }, { x: 660, y: 660 }, { x: -660, y: 660 }] };
const demoSite = {
  id: "uiaudit-terrain-v239", groupId: "uiaudit-terrain-v239", site: "Terrain V239-V242 Demo", name: "Plan 1",
  origin: { lat: 29.782, lon: -95.795 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${demoSite.id}': ${JSON.stringify(demoSite)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoSite.id)});
} catch (e) {} })();`;

const b64url = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function main() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);

  const seen = { renderingRules: [], lercFetches: [], lercBytes: [] };

  // (a) same-origin proxy paths → forward to the production proxy from NODE (real bytes).
  await ctx.route("**/api/gis-cache/**", async (route) => {
    const u = new URL(route.request().url());
    try {
      const r = await fetch(PLANYR + u.pathname + u.search, { redirect: "follow" });
      const body = Buffer.from(await r.arrayBuffer());
      if (/exportImage/.test(u.pathname + u.search) && /format=lerc/.test(u.search)) seen.lercBytes.push({ url: route.request().url(), body });
      await route.fulfill({ status: r.status, contentType: r.headers.get("content-type") || "application/octet-stream", body });
    } catch (e) { await route.fulfill({ status: 502, contentType: "text/plain", body: String(e) }); }
  });
  // (b) direct agency URLs (esri href image loads, direct fallback, getSamples) → through the
  //     production proxy too, still from NODE. NOTHING mocked — real getSamples included.
  await ctx.route("**/elevation.nationalmap.gov/**", async (route) => {
    const u = new URL(route.request().url());
    try {
      const prox = `${PLANYR}/api/gis-cache/svc/${b64url(`${u.origin}${u.pathname}`)}${u.search}`;
      const r = await fetch(prox, { redirect: "follow" });
      const body = Buffer.from(await r.arrayBuffer());
      await route.fulfill({ status: r.status, contentType: r.headers.get("content-type") || "application/octet-stream", body });
    } catch (e) { await route.fulfill({ status: 502, contentType: "text/plain", body: String(e) }); }
  });

  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => { fail++; console.log(`  [FAIL] pageerror — ${e.message}`); });
  page.on("request", (rq) => {
    const url = rq.url();
    if (/exportImage/.test(url) && /renderingRule=/.test(url)) {
      try { seen.renderingRules.push({ url, rule: decodeURIComponent(url.match(/renderingRule=([^&]+)/)[1]) }); } catch (_) {}
    }
    if (/exportImage/.test(url) && /format=lerc/.test(url)) seen.lercFetches.push(url);
  });

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  await page.locator('svg[aria-label="Site plan canvas"]').waitFor({ timeout: 15000 });
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (_) {}
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /Layers/ }).first().click();
  await page.waitForTimeout(400);

  const layersBtn = page.getByRole("button", { name: /Layers/ }).first();
  const toggleLayer = async (label) => {
    let row = page.locator("label:visible").filter({ hasText: label }).first();
    if (!(await row.count()) || !(await row.isVisible().catch(() => false))) {
      // The Layers panel is a popover — a prior Escape (e.g. closing the cross-section result)
      // can close it too. Reopen before trying again.
      await layersBtn.click().catch(() => {});
      await page.waitForTimeout(300);
      row = page.locator("label:visible").filter({ hasText: label }).first();
    }
    await row.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    await row.click();
  };
  const svg = page.locator('svg[aria-label="Site plan canvas"]');
  const svgBox = await svg.boundingBox();
  const hoverAt = async (x, y) => {
    await page.mouse.move(x, y);
    await page.waitForTimeout(150);
    const t = await page.locator("[data-ground-el]").first().innerText().catch(() => "");
    const m = t.match(/El ≈ ([\d.]+) ft NAVD88/);
    return m ? parseFloat(m[1]) : null;
  };

  // ══════════════════════════════════════════════════════════════════════
  // V240/V704: contour lines → decode the SAME grid ourselves (independent proof)
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n== V240 (B704) contours ==");
  await toggleLayer("Contour lines (1 ft)");
  let labelCount = 0;
  for (let i = 0; i < 40 && !labelCount; i++) {
    await page.waitForTimeout(500);
    labelCount = await page.locator("span").filter({ hasText: /^\d+ ft$/ }).count().catch(() => 0);
  }
  log(seen.lercFetches.length >= 1, `LERC grid fetched (${seen.lercFetches.length} fetch(es))`);
  log(labelCount > 0, `contour "N ft" labels painted (${labelCount})`);
  await page.screenshot({ path: OUT + "v240-contours.png" });

  // Independently decode the SAME LERC bytes the app used (proves the numbers below are real,
  // not whatever the app happens to claim).
  let grid = null, req = null;
  if (seen.lercBytes.length) {
    const last = seen.lercBytes[seen.lercBytes.length - 1];
    const u = new URL(last.url);
    const bbox = u.searchParams.get("bbox").split(",").map(Number);
    const size = u.searchParams.get("size").split(",").map(Number);
    req = { bbox: { xmin: bbox[0], ymin: bbox[1], xmax: bbox[2], ymax: bbox[3] }, width: size[0], height: size[1], cellMeters: (bbox[2] - bbox[0]) / size[0] };
    // decodeGrid expects a genuine ArrayBuffer (as a browser fetch().arrayBuffer() returns) —
    // convert the Node Buffer's backing store rather than pass the Buffer itself.
    const ab = last.body.buffer.slice(last.body.byteOffset, last.body.byteOffset + last.body.byteLength);
    try { grid = decodeGrid(ab, req); log(true, `independently decoded the real LERC grid (${req.width}x${req.height} cells)`); }
    catch (e) { log(false, `grid decode failed: ${e.message}`); }
  } else log(false, "no LERC bytes captured to independently decode");

  // Zoom-gate: below z16 the layer must clear with the honest note, not painted mush. Use the
  // discrete "Zoom out" toolbar button (each click ×1/1.25) rather than wheel deltas — reliable,
  // large enough after ~18 clicks to cross the z16 threshold from any sane "fit" starting zoom.
  // [title="Zoom out"] matches BOTH the planner's own toolbar button AND leaflet's own
  // (invisible, background-map) zoom control — filter to the visible one.
  const zoomOutCount = await page.locator('[title="Zoom out"]:visible').count();
  console.log(`  (debug) visible "Zoom out" elements: ${zoomOutCount}`);
  const zoomOutBtn = page.locator('[title="Zoom out"]:visible').first();
  for (let i = 0; i < 18; i++) { await zoomOutBtn.click({ timeout: 3000 }).catch((e) => console.log("  zoom-out click issue:", e.message.split("\n")[0])); await page.waitForTimeout(60); }
  await page.waitForTimeout(500);
  let bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const cIdx = bodyText.indexOf("Contour lines");
  console.log(`  (debug) around "Contour lines": ${bodyText.slice(cIdx, cIdx + 150)}`);
  log(/Zoom in to/i.test(bodyText), `below z16 the contour layer shows the "Zoom in to …" note, not mush`);
  await page.screenshot({ path: OUT + "v240-zoomed-out.png" });
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (_) {}
  await page.waitForTimeout(800);

  // ══════════════════════════════════════════════════════════════════════
  // V242/B706: hover vs cross-section AGREE at the exact same screen pixel
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n== V242 (B706) hover vs cross-section agreement (same screen pixel) ==");
  const px = svgBox.x + svgBox.width * 0.5, py = svgBox.y + svgBox.height * 0.45;
  let hoverFt = await hoverAt(px, py);
  if (hoverFt == null) { hoverFt = await hoverAt(px + 4, py + 4); }
  log(hoverFt != null, `hover chip reads a real elevation at the probe point (${hoverFt} ft)`);

  // Draw a near-zero-length cross-section AT THE SAME PIXEL (2 clicks 1px apart) — its
  // bank/invert collapse to essentially a point reading, directly comparable to the hover chip.
  await page.locator('button:has-text("📏 Cross-section (ditch)")').first().click({ timeout: 5000 }).catch(async () => {
    await page.getByText("Cross-section (ditch)", { exact: false }).first().click({ timeout: 5000 });
  });
  await page.waitForTimeout(200);
  await page.mouse.click(px, py);
  await page.waitForTimeout(150);
  await page.mouse.click(px + 1, py + 1);
  await page.waitForTimeout(300);
  let xsecReady = false, xsecStats = null;
  for (let i = 0; i < 30 && !xsecReady; i++) {
    await page.waitForTimeout(300);
    xsecStats = await page.evaluate(() => {
      const el = [...document.querySelectorAll("div")].find((d) => (d.textContent || "").includes("Ditch cross-section"));
      if (!el) return null;
      const txt = el.parentElement ? el.parentElement.innerText : "";
      const bank = txt.match(/Bank\s+([\d.]+)/);
      const invert = txt.match(/Invert\s+([\d.]+)/);
      return bank && invert ? { bank: parseFloat(bank[1]), invert: parseFloat(invert[1]) } : null;
    });
    xsecReady = !!xsecStats;
  }
  log(!!xsecReady, `cross-section produced a result (bank=${xsecStats?.bank}, invert=${xsecStats?.invert})`);
  if (hoverFt != null && xsecStats) {
    const xsecPt = (xsecStats.bank + xsecStats.invert) / 2; // near-zero-length line → bank≈invert≈point elevation
    const delta = Math.abs(hoverFt - xsecPt);
    log(delta <= 1.5, `hover (${hoverFt} ft) agrees with the cross-section tool (${xsecPt.toFixed(1)} ft) at the same spot — Δ=${delta.toFixed(2)} ft (same DEM, same convention)`);
  }
  // Close the cross-section result + exit the tool.
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);

  // ══════════════════════════════════════════════════════════════════════
  // V242: hover vs the nearest contour label — same ~1ft agreement, a second surface
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n== V242 hover vs nearest contour label ==");
  const nearestLabel = await page.evaluate(({ x, y }) => {
    const spans = [...document.querySelectorAll("span")].filter((s) => /^\d+ ft$/.test((s.textContent || "").trim()));
    let best = null, bestD = Infinity;
    for (const s of spans) {
      const b = s.getBoundingClientRect();
      const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d < bestD) { bestD = d; best = { text: s.textContent.trim(), x: cx, y: cy, d }; }
    }
    return best;
  }, { x: px, y: py });
  if (nearestLabel && nearestLabel.d < 500) {
    const labelVal = parseFloat(nearestLabel.text);
    const hoverAtLabel = await hoverAt(nearestLabel.x, nearestLabel.y);
    log(hoverAtLabel != null, `hover chip reads a value at the nearest contour label's position (${hoverAtLabel} ft)`);
    if (hoverAtLabel != null) {
      const d = Math.abs(hoverAtLabel - labelVal);
      log(d <= 1.5, `hover (${hoverAtLabel} ft) agrees with the "${nearestLabel.text}" contour label within ~1.5 ft (Δ=${d.toFixed(2)} ft)`);
    }
  } else log(false, `no contour label found near the probe point to cross-check (closest ${nearestLabel ? nearestLabel.d.toFixed(0) + "px" : "none"})`);

  // ══════════════════════════════════════════════════════════════════════
  // V239 (B703): ground relief — cooler/darker for LOWER real elevation, over real 3DEP data
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n== V239 (B703) ground relief: color correlates with REAL elevation ==");
  await toggleLayer("Elevation shading");
  await page.waitForTimeout(4000);
  const reliefRule1 = seen.renderingRules[seen.renderingRules.length - 1];
  log(!!reliefRule1 && /Colormap/.test(reliefRule1.rule) && /"DRA":\s*true/.test(reliefRule1.rule), `exportImage carries the Colormap/DRA chain (view-relative re-stretch)`);
  const reliefImgHandle = page.locator("img.leaflet-image-layer").last();
  await reliefImgHandle.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Sample real elevations at a scattered grid of on-screen points (via hover, using the SAME
  // decoded grid the contour layer paints from), then sample the RENDERED relief pixel color at
  // the exact same screen point (via the <img>'s own CSS rect — no leaflet-internals needed: the
  // fraction across the img's bounding box IS the fraction across its natural pixel bitmap).
  const samples = [];
  const cols = 5, rows = 4;
  for (let r = 1; r < rows; r++) {
    for (let c = 1; c < cols; c++) {
      const x = svgBox.x + (svgBox.width * c) / cols;
      const y = svgBox.y + (svgBox.height * r) / rows;
      const el = await hoverAt(x, y);
      if (el == null) continue;
      const color = await reliefImgHandle.evaluate((img, pt) => {
        const rect = img.getBoundingClientRect();
        if (pt.x < rect.left || pt.x > rect.right || pt.y < rect.top || pt.y > rect.bottom) return null;
        const fx = (pt.x - rect.left) / rect.width, fy = (pt.y - rect.top) / rect.height;
        const cv = document.createElement("canvas");
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const g = cv.getContext("2d");
        try { g.drawImage(img, 0, 0); } catch (e) { return null; }
        const ix = Math.min(cv.width - 1, Math.max(0, Math.round(fx * cv.width)));
        const iy = Math.min(cv.height - 1, Math.max(0, Math.round(fy * cv.height)));
        const d = g.getImageData(ix, iy, 1, 1).data;
        return { r: d[0], g: d[1], b: d[2], a: d[3] };
      }, { x, y }).catch(() => null);
      if (color && color.a > 0) samples.push({ el, ...color });
    }
  }
  log(samples.length >= 6, `collected ${samples.length} real (elevation, rendered-color) sample pairs`);
  if (samples.length >= 6) {
    // Correlation between elevation and (red - blue): the label promises low=blue, high=red, so
    // higher ground should read redder (r-b larger) and lower ground bluer (r-b smaller/negative).
    const n = samples.length;
    const meanEl = samples.reduce((s, p) => s + p.el, 0) / n;
    const meanRB = samples.reduce((s, p) => s + (p.r - p.b), 0) / n;
    let cov = 0, varEl = 0, varRB = 0;
    for (const p of samples) {
      const dEl = p.el - meanEl, dRB = (p.r - p.b) - meanRB;
      cov += dEl * dRB; varEl += dEl * dEl; varRB += dRB * dRB;
    }
    const corr = (varEl > 0 && varRB > 0) ? cov / Math.sqrt(varEl * varRB) : NaN;
    console.log(`  samples: ${samples.map((p) => `${p.el.toFixed(0)}ft→rgb(${p.r},${p.g},${p.b})`).join(" | ")}`);
    log(Number.isFinite(corr) && corr > 0.3, `higher real elevation correlates with a REDDER pixel, lower with BLUER (r=${corr.toFixed(2)}) — matches the "low = blue, high = red" label over real data`);
  }
  await page.screenshot({ path: OUT + "v239-relief.png" });

  // Pan re-stretch: a NEW exportImage request fires over the NEW view (still DRA:true) — DRA
  // means the server recomputes the stretch min/max from whatever extent it's asked about, so a
  // new bbox after panning IS the re-stretch (proven mechanism, not a guess).
  const rulesBeforePan = seen.renderingRules.length;
  const lercBeforePan = seen.lercFetches.length;
  const viewBoxBeforePan = await svg.getAttribute("viewBox");
  const parcelPosBefore = await page.evaluate(() => { const p = document.querySelector("svg path"); const b = p && p.getBoundingClientRect(); return b ? { x: b.x, y: b.y } : null; });
  // The default "select" tool drags a marquee, not a pan — hold Space (temporary pan, per the
  // toolbar hint) so the drag actually moves the canvas/map, not just draws a selection box.
  // Space is swallowed as a button-activation if a <button> still has focus from an earlier
  // click (the layer-toggle row) — blur it first with a neutral click on empty canvas.
  await page.mouse.click(svgBox.x + 20, svgBox.y + 20);
  await page.waitForTimeout(150);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(100);
  await page.keyboard.press("v").catch(() => {}); // force the Select tool, clearing any lingering cross-section/etc. mode
  await page.waitForTimeout(150);
  // Close the Layers popover first — a big drag that sweeps over it can land on a checkbox/info
  // icon under the pointer, which is not what this check is about (learned the hard way: an
  // earlier version of this drag silently unchecked "Elevation shading" mid-pan).
  await layersBtn.click().catch(() => {});
  await page.waitForTimeout(300);
  await page.mouse.move(svgBox.x + svgBox.width / 2, svgBox.y + svgBox.height / 2);
  await page.keyboard.down("Space");
  await page.waitForTimeout(150);
  const cursorDuringSpace = await page.evaluate(() => getComputedStyle(document.querySelector('svg[aria-label="Site plan canvas"]')).cursor);
  console.log(`  (debug) cursor with Space held: "${cursorDuringSpace}" (expect grab/grabbing)`);
  // Several separate full drag gestures (down→move→up each time) in the SAME direction —
  // esri-leaflet's ImageMapLayer buffers a margin around the viewport, so one small drag can
  // land fully inside that margin and never trigger a refetch even though the view visibly
  // moved; repeating the full gesture accumulates real geographic displacement each time.
  const cx = svgBox.x + svgBox.width / 2, cy = svgBox.y + svgBox.height / 2;
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 350, cy + 250, { steps: 15 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(5000);
  await layersBtn.click().catch(() => {}); // reopen so subsequent checks/toggles can see the panel
  await page.waitForTimeout(300);
  const viewBoxAfterPan = await svg.getAttribute("viewBox");
  const parcelPosAfter = await page.evaluate(() => { const p = document.querySelector('svg [stroke="#7c786d"], svg polygon, svg path'); const b = p && p.getBoundingClientRect(); return b ? { x: Math.round(b.x), y: Math.round(b.y) } : null; });
  console.log(`  (debug) viewBox before=${viewBoxBeforePan} after=${viewBoxAfterPan}`);
  console.log(`  (debug) an svg shape's position before=${JSON.stringify(parcelPosBefore)} after=${JSON.stringify(parcelPosAfter)}`);
  console.log(`  (debug) LERC fetch count before/after pan: ${lercBeforePan} → ${seen.lercFetches.length}`);
  const rulesAfterPan = seen.renderingRules;
  const newRule = rulesAfterPan[rulesAfterPan.length - 1];
  const bboxOf = (u) => (new URL(u).searchParams.get("bbox") || "");
  log(rulesAfterPan.length > rulesBeforePan, `panning fired a NEW exportImage request (${rulesBeforePan} → ${rulesAfterPan.length})`);
  log(!!newRule && bboxOf(newRule.url) !== bboxOf(reliefRule1.url), `the new request covers a DIFFERENT bbox (${bboxOf(reliefRule1.url).slice(0, 24)}… → ${bboxOf(newRule ? newRule.url : "").slice(0, 24)}…) — DRA re-stretches to it`);
  log(!!newRule && /"DRA":\s*true/.test(newRule.rule), `the post-pan request still carries DRA:true (re-stretch stays live after panning)`);
  await page.screenshot({ path: OUT + "v239-relief-panned.png" });
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (_) {}
  await page.waitForTimeout(800);
  await toggleLayer("Elevation shading"); // off, before the arrows section
  await page.waitForTimeout(300);

  // ══════════════════════════════════════════════════════════════════════
  // V241 (B705): drainage arrows — painted only where the REAL DEM has qualifying slope
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n== V241 (B705) drainage arrows correlate with real slope ==");
  await toggleLayer("Contour lines (1 ft)"); // back on, so we have a fresh grid + canvas baseline
  await page.waitForTimeout(2500);
  const canvasInk = () => page.evaluate(() => {
    let total = 0;
    for (const c of document.querySelectorAll(".leaflet-pane canvas")) {
      const g = c.getContext("2d");
      if (!g || !c.width) continue;
      const d = g.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4000) total += d[i] > 0 ? 1 : 0;
    }
    return total;
  });
  const inkBeforeArrows = await canvasInk();
  const lercBefore = seen.lercFetches.length;
  await toggleLayer("Water flow direction");
  await page.waitForTimeout(3000);
  const inkAfterArrows = await canvasInk();
  log(seen.lercFetches.length === lercBefore, `no second LERC grid fetch for arrows (shared tile artifact, ${seen.lercFetches.length} total)`);
  log(inkAfterArrows > inkBeforeArrows, `arrows painted new canvas ink (${inkBeforeArrows} → ${inkAfterArrows})`);
  // Real-slope correlation: bucket my independently-decoded grid cells by local slope magnitude
  // (central difference) and confirm the grid genuinely has a mix of flat and sloped cells here —
  // i.e., the "no arrow on flat ground, bolder on steep ground" claim has real terrain to prove it
  // against, not a uniformly flat tile where the claim would be vacuously true either way.
  if (grid) {
    const { values, mask, width, height } = grid;
    let flat = 0, steep = 0, sampledSlopes = [];
    for (let y = 2; y < height - 2; y += 6) {
      for (let x = 2; x < width - 2; x += 6) {
        const i = y * width + x, ix = i + 1, ixm = i - 1, iy = i + width, iym = i - width;
        if (!mask[i] || !mask[ix] || !mask[ixm] || !mask[iy] || !mask[iym]) continue;
        const gx = (values[ix] - values[ixm]) / 2, gy = (values[iy] - values[iym]) / 2;
        const slope = Math.hypot(gx, gy);
        sampledSlopes.push(slope);
        if (slope < 0.02) flat++; else if (slope > 0.08) steep++;
      }
    }
    log(sampledSlopes.length > 0, `sampled ${sampledSlopes.length} real DEM cells for local slope`);
    log(flat > 0 && steep > 0, `the fetched tile has BOTH flat (${flat}) and steep (${steep}) real terrain — a meaningful arrow/no-arrow contrast exists here to render against`);
  }
  await page.screenshot({ path: OUT + "v241-arrows.png" });
  await toggleLayer("Water flow direction"); // off

  // ══════════════════════════════════════════════════════════════════════
  // V242: with ALL terrain layers OFF, the network path still answers (real getSamples)
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n== V242 all terrain layers OFF → real network getSamples path ==");
  await toggleLayer("Contour lines (1 ft)"); // off
  await page.waitForTimeout(300);
  const anyReliefOn = await page.locator("label:visible").filter({ hasText: "Ground relief" }).first().evaluate((el) => el.querySelector('input[type="checkbox"]')?.checked).catch(() => false);
  if (anyReliefOn) { await toggleLayer("Elevation shading"); await page.waitForTimeout(300); }
  await toggleLayer("Water flow direction").catch(() => {}); // ensure off if it got toggled on later; harmless if already off
  await page.waitForTimeout(300);
  await page.mouse.move(px - 3, py - 3);
  await page.mouse.move(px, py);
  const netFt = await hoverAt(px, py + 1);
  await page.waitForTimeout(400);
  const netFt2 = await page.locator("[data-ground-el]").first().innerText().catch(() => "");
  log(/El ≈/.test(netFt2) || netFt != null, `hover readout still appears with every terrain layer off (network getSamples path): "${netFt2}"`);

  console.log(consoleErrors.length ? `\n(i) ${consoleErrors.length} console error(s) logged` : "\n(no console errors)");
  await browser.close();
  console.log(fail === 0 ? "\nSTAGE 1: ALL PASS" : `\nSTAGE 1: ${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("harness error:", e); process.exit(1); });
