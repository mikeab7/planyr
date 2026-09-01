#!/usr/bin/env node
/* B842928 — the map finder's road-name labels layer (the "Reference/World_Transportation"
 * Esri overlay) rendered gigantic and blurry at every zoom, because it had NO `detectRetina`
 * while the aerial beneath it does. On a HiDPI display `detectRetina` makes the aerial fetch
 * tiles ONE native zoom level DEEPER than the map's rounded zoom (drawn at half CSS size to
 * keep the same geographic coverage), so the un-adjusted labels layer was always exactly one
 * native zoom level coarser than the aerial — road names came off a half-density tile. Under
 * real network latency that structural gap compounds (the labels layer's tiles are also the
 * heavier of the two, composited server-side): MEASURED live on the owner's account, the
 * labels layer stayed pinned at z9 while the aerial reached z15, unchanged across two further
 * zoom-ins.
 *
 * This harness drives the REAL layer in a real browser against a real ArcGIS tile service
 * (arcgisonline.com — reachable from this sandbox; see docs/REFERENCE.md) and asserts the two
 * layers' native tile zoom and rendered density stay in lockstep through a fast zoom-in burst,
 * the same gesture ("clicked zoom-in twice") that produced the reported symptom.
 *
 *   node ui-audit/verify-map-finder-labels-zoom.mjs [--url http://localhost:4319/]
 *
 * Run `npx vite preview --port 4319` (after `npm run build`) in another terminal first.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const URL = arg("--url", "http://localhost:4319/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

function tileZ(url, service) {
  const m = url.match(new RegExp(`/services/${service}/MapServer/tile/(\\d+)/(\\d+)/(\\d+)`));
  return m ? Number(m[1]) : null;
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  // A real HiDPI display is the precondition for this defect (detectRetina only diverges the
  // two layers when L.Browser.retina is true) — the owner's is measured ~2.13.
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2.15 });

  const imgZs = new Set();
  const refZs = new Set();
  page.on("request", (req) => {
    const url = req.url();
    const iz = tileZ(url, "World_Imagery");
    if (iz != null) { imgZs.add(iz); return; }
    const rz = tileZ(url, "Reference/World_Transportation");
    if (rz != null) refZs.add(rz);
  });

  await page.goto(`${URL.replace(/\/$/, "")}/#/map`, { waitUntil: "load", timeout: 60000 });
  await assertMeasurable(page, "verify-map-finder-labels-zoom");
  await page.waitForSelector(".leaflet-container", { timeout: 20000 });
  await pacedWait(page, 2000);

  const mapBox = await page.evaluate(() => {
    const el = document.querySelector(".leaflet-container");
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });

  // The reported gesture: a fast burst of zoom-ins (double-click, which Leaflet steps +1 per
  // click), not a slow deliberate wheel — that pace is what let the labels layer fall behind.
  for (let i = 0; i < 9; i++) {
    await page.mouse.dblclick(mapBox.x, mapBox.y);
    await pacedWait(page, 350);
  }
  // "re-measured after clicking zoom-in twice" — the owner's own repro step.
  await page.mouse.dblclick(mapBox.x, mapBox.y);
  await pacedWait(page, 300);
  await page.mouse.dblclick(mapBox.x, mapBox.y);
  await pacedWait(page, 3000);

  const maxImgZ = imgZs.size ? Math.max(...imgZs) : null;
  const maxRefZ = refZs.size ? Math.max(...refZs) : null;
  check("aerial (World_Imagery) tiles were requested", imgZs.size > 0, `${imgZs.size} distinct z levels`);
  check("labels (Reference/World_Transportation) tiles were requested", refZs.size > 0, `${refZs.size} distinct z levels`);
  check(
    "labels layer's deepest requested zoom matches the aerial's (no lag)",
    maxRefZ != null && maxImgZ != null && maxRefZ === maxImgZ,
    `aerial max z=${maxImgZ}, labels max z=${maxRefZ}`
  );

  // Rendered density parity: at rest, every on-screen labels tile must be the SAME CSS width as
  // an aerial tile (both retina-adjusted the same way) — this is the actual "oversized" symptom.
  const widths = await page.evaluate(() => {
    const widthsFor = (pred) => [...new Set(
      [...document.querySelectorAll("img.leaflet-tile")]
        .filter((img) => pred(img.src))
        .map((img) => img.clientWidth)
    )];
    return {
      img: widthsFor((s) => s.includes("/services/World_Imagery/")),
      ref: widthsFor((s) => s.includes("/services/Reference/World_Transportation/")),
    };
  });
  check(
    "labels tiles render at the same CSS width as aerial tiles (no half-density blur)",
    widths.ref.length > 0 && widths.img.length > 0 && widths.ref.every((w) => widths.img.includes(w)),
    `aerial widths=${JSON.stringify(widths.img)}, labels widths=${JSON.stringify(widths.ref)}`
  );

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
