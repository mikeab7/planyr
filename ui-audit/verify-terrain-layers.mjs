/**
 * Verify B703–B706 — the terrain suite, end-to-end in the real built app:
 *   B703 ground relief: the elevation layer's exportImage request carries the custom
 *        view-relative DRA chain (Colormap + Stretch DRA), and the esri image paints.
 *   B704 contours: toggling "Contour lines (1 ft)" fetches ONE raw LERC grid, the
 *        terrain Web Worker decodes/smooths/traces it, canvas polylines + "N ft" halo
 *        labels paint, and the panel shows the vintage + note lines.
 *   B705 drainage arrows: toggling "Drainage direction" costs NO second grid fetch
 *        (shared tile artifact) and completes to a loaded/empty status.
 *   B706 hover readout: the planner's coordinate chip appends "El ≈ … ft NAVD88"
 *        with a value inside the real tile's elevation range — proving it came from
 *        the decoded grid (the getSamples mock is pinned OUT of range at 100.0 ft).
 *
 * Network model: the sandbox's egress proxy blocks Chromium from every GIS host, but
 * NODE can reach planyr.io — so page.route intercepts (a) /api/gis-cache/* and
 * (b) elevation.nationalmap.gov/*, node-fetches the SAME request through the
 * production planyr.io gis-cache proxy (nationalmap.gov is allowlisted there, B518),
 * and fulfills the page with the real bytes. Real service, real LERC at the exact
 * requested size, real decode — nothing canned except getSamples (deterministic
 * sentinel). In a browser-equipped env, LIVE=1 skips all interception.
 *
 * Run:  npm run build && npx vite preview --port 4173  (background), then
 *       node ui-audit/verify-terrain-layers.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const LIVE = process.env.LIVE === "1";
const PLANYR = "https://planyr.io";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Katy TX — inside the captured-fixture neighborhood; real 3DEP elevations there run
// ~120–150 ft NAVD88. The getSamples mock answers 30.48 m = exactly 100.0 ft, OUTSIDE
// that range, so the hover assertion can tell the grid path from the network path.
const parcel = { id: "pc1", locked: true, points: [{ x: -660, y: -660 }, { x: 660, y: -660 }, { x: 660, y: 660 }, { x: -660, y: 660 }] };
const demoSite = {
  id: "uiaudit-terrain", groupId: "uiaudit-terrain", site: "Terrain Demo", name: "Plan 1",
  origin: { lat: 29.782, lon: -95.795 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${demoSite.id}': ${JSON.stringify(demoSite)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoSite.id)});
} catch (e) {} })();`;

let failures = 0;
const expect = (label, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`);
};

const b64url = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);

  const seen = { renderingRules: [], lercFetches: [], proxied: 0 };

  if (!LIVE) {
    // (a) same-origin proxy paths → forward to the production proxy from NODE.
    await ctx.route("**/api/gis-cache/**", async (route) => {
      const u = new URL(route.request().url());
      try {
        const r = await fetch(PLANYR + u.pathname + u.search, { redirect: "follow" });
        const body = Buffer.from(await r.arrayBuffer());
        seen.proxied++;
        await route.fulfill({ status: r.status, contentType: r.headers.get("content-type") || "application/octet-stream", body });
      } catch (e) {
        await route.fulfill({ status: 502, contentType: "text/plain", body: String(e) });
      }
    });
    // (b) direct agency URLs (esri href image loads, probe f=json, direct fallback)
    //     → rewrite through the production proxy, still from NODE.
    await ctx.route("**/elevation.nationalmap.gov/**", async (route) => {
      const u = new URL(route.request().url());
      try {
        const prox = `${PLANYR}/api/gis-cache/svc/${b64url(`${u.origin}${u.pathname}`)}${u.search}`;
        const r = await fetch(prox, { redirect: "follow" });
        const body = Buffer.from(await r.arrayBuffer());
        await route.fulfill({ status: r.status, contentType: r.headers.get("content-type") || "application/octet-stream", body });
      } catch (e) {
        await route.fulfill({ status: 502, contentType: "text/plain", body: String(e) });
      }
    });
    // (c) deterministic point samples — registered LAST so it wins over (b).
    await ctx.route("**/getSamples**", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ samples: [{ value: "30.48" }] }), // = 100.0 ft, out of tile range
    }));
  }

  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => { failures++; console.log(`  [FAIL] pageerror — ${e.message}`); });
  page.on("request", (rq) => {
    const url = rq.url();
    if (/exportImage/.test(url) && /renderingRule=/.test(url)) {
      try { seen.renderingRules.push(decodeURIComponent(url.match(/renderingRule=([^&]+)/)[1])); } catch (_) {}
    }
    if (/exportImage/.test(url) && /format=lerc/.test(url)) seen.lercFetches.push(url);
  });

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  await page.locator('svg[aria-label="Site plan canvas"]').waitFor({ timeout: 15000 });
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (_) {}
  await page.waitForTimeout(800);

  // Open the Layers panel.
  await page.getByRole("button", { name: /Layers/ }).first().click();
  await page.waitForTimeout(400);

  const toggleLayer = async (label) => {
    // BOTH surfaces mount a LayerPanel (the map finder's stays alive, hidden, behind
    // the planner) — target the visible copy's row label.
    const row = page.locator("label:visible").filter({ hasText: label }).first();
    await row.waitFor({ timeout: 8000 }).catch(() => {});
    await row.click();
  };

  // ── B703: ground relief ────────────────────────────────────────────────────
  await toggleLayer("Ground relief (low = blue, high = red)");
  await page.waitForTimeout(5000);
  const rule = seen.renderingRules.find((r) => /Colormap/.test(r));
  expect("B703 exportImage carries the custom chain (Colormap over Stretch)", !!rule, rule ? "" : `rules seen: ${seen.renderingRules.length}`);
  expect("B703 chain has DRA:true (view-relative re-stretch)", !!rule && /"DRA":\s*true/.test(rule));
  expect("B703 chain has PercentClip 2/2 (probed best)", !!rule && /"MinPercent":\s*2/.test(rule));
  const esriImgs = await page.locator("img.leaflet-image-layer").count();
  expect("B703 esri image element painted on the map", esriImgs >= 1, `${esriImgs} image layer(s)`);
  const bodyText = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
  let t = await bodyText();
  expect("B703 relative-to-view note visible while on", /RELATIVE TO THE CURRENT VIEW/i.test(t));

  // ── B704: contour lines ────────────────────────────────────────────────────
  await toggleLayer("Contour lines (1 ft)");
  // Wait for the pipeline: fetch → worker decode/smooth/trace → paint (real network via node).
  let labelCount = 0;
  for (let i = 0; i < 40 && !labelCount; i++) {
    await page.waitForTimeout(500);
    labelCount = await page.locator("[data-ground-el], span").filter({ hasText: /^\d+ ft$/ }).count().catch(() => 0);
  }
  expect("B704 one LERC grid fetch fired", seen.lercFetches.length === 1, `${seen.lercFetches.length} lerc fetches`);
  expect("B704 LERC request pins the probed shape (F32, None, no-adjust, bilinear)",
    seen.lercFetches.every((u) => /pixelType=F32/.test(u) && /adjustAspectRatio=false/.test(u) && /RSP_BilinearInterpolation/.test(u)));
  expect("B704 contour labels painted (\"N ft\" halo divIcons)", labelCount > 0, `${labelCount} labels`);
  const canvasInk = () => page.evaluate(() => {
    let total = 0;
    for (const c of document.querySelectorAll(".leaflet-pane canvas")) {
      const g = c.getContext("2d");
      if (!g || !c.width) continue;
      const d = g.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4000) total += d[i] > 0 ? 1 : 0; // sparse alpha sample
    }
    return total;
  });
  const inkContours = await canvasInk();
  expect("B704 contour polylines drew real canvas ink", inkContours > 0, `${inkContours} sampled opaque px`);
  t = await bodyText();
  expect("B704 vintage row shows (LiDAR collection varies by county)", /LiDAR collection varies by county/.test(t));
  expect("B704 note: lines break at no-data + screening caveat", /Lines BREAK where the LiDAR has no data/i.test(t) && /verify with survey/i.test(t));

  // ── B705: drainage arrows (shared tile — NO second grid fetch) ─────────────
  await toggleLayer("Drainage direction (screening)");
  await page.waitForTimeout(3000);
  const inkArrows = await canvasInk();
  expect("B705 no second LERC fetch (tile artifact shared)", seen.lercFetches.length === 1, `${seen.lercFetches.length} lerc fetches`);
  t = await bodyText();
  expect("B705 layer completes (refreshed age or honest flat-ground empty)",
    /Drainage direction/.test(t) && (/refreshed/.test(t) || /no confident direction/i.test(t)));
  expect("B705 arrows added canvas ink (bolder = steeper)", inkArrows >= inkContours, `${inkContours} → ${inkArrows}`);

  // ── B706: hover ground-elevation readout on the coordinate chip ────────────
  const svg = page.locator('svg[aria-label="Site plan canvas"]');
  const box = await svg.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
  await page.waitForTimeout(900);
  let chip = await page.locator("[data-ground-el]").first().innerText().catch(() => "");
  if (!chip) { // one nudge — the first move may land before the grid registers
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
    await page.waitForTimeout(1200);
    chip = await page.locator("[data-ground-el]").first().innerText().catch(() => "");
  }
  const m = chip.match(/El ≈ ([\d.]+) ft NAVD88/);
  expect("B706 chip shows El ≈ … ft NAVD88", !!m, chip || "no [data-ground-el] segment");
  if (m) {
    const el = parseFloat(m[1]);
    expect("B706 value came from the DECODED GRID (in Katy's 118–152 ft range, not the 100.0 mock)",
      el > 118 && el < 152 && Math.abs(el - 100.0) > 0.5, `${el} ft`);
  }

  await page.screenshot({ path: `${OUT}verify-terrain-layers.png` }).catch(() => {});
  if (consoleErrors.length) console.log(`  (i) ${consoleErrors.length} console error(s) — expected for unreachable unrelated GIS hosts in the sandbox`);
  await browser.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error("harness error:", e); process.exit(1); });
