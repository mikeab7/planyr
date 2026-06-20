/* B220 verification — map-finder imagery over-zoom placeholder.
 *
 * The map finder (MapFinder.jsx) layers Esri World_Imagery with detectRetina:true.
 * On a retina/HiDPI display detectRetina fetches one zoom level HIGHER than the
 * display zoom, so a plain `maxNativeZoom: 19` lets deep zoom request z20 — which
 * arcgisonline answers with the gray "Map data not yet available" PLACEHOLDER as an
 * HTTP 200 (the error-tile fallback never fires; the canvas fills with gray while the
 * labels overlay keeps rendering on top). B182 fixed this on the PLANNER CANVAS only;
 * B220 brings the retina-offset clamp to the map finder + caps the labels overlay so
 * the two layers don't diverge.
 *
 * This drives the headless map finder at DPR 1 and DPR 2, zooms in DEEP over a Katy
 * parcel, and records the zoom of every World_Imagery (imagery) and World_Transportation
 * (labels) tile requested. PASS = at retina, NO imagery or labels tile is requested
 * beyond the z19 native ceiling, and no placeholder-sized responses come back.
 *
 * Run: `npm run build && (npx vite preview --port 4173 &)` then
 *      `node gis-verify/mapfinder-overzoom-verify.mjs`
 */
import { createRequire } from "module";
// playwright is a global CJS module in this environment; require it by absolute path
// (ESM named imports don't resolve from the CJS package, and NODE_PATH doesn't apply
// to ESM bare specifiers). See VERIFICATION.md → "🤖 Self-verification".
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_MODULE || "/opt/node22/lib/node_modules/playwright");

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const NATIVE_CEIL = 19; // Esri World Imagery + Esri Reference native ceiling

// Boot to the map finder over a known Katy/Houston parcel (imagery is native to z19+
// here). currentSite is NOT set, so the app stays on the finder map (not the planner).
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({
    a1: { id:"a1", groupId:"a1", site:"Katy Logistics Park", name:"Plan 1",
          origin:{ lat:29.786, lon:-95.83 }, county:"harris", parcels:[], els:[],
          measures:[], callouts:[], markups:[], settings:{}, underlay:null,
          updatedAt: Date.now(), data:{ status:"active" } }
  }));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch(e){} })();`;

const IMG_RE = /World_Imagery\/MapServer\/tile\/(\d+)\//;
const LBL_RE = /World_Transportation\/MapServer\/tile\/(\d+)\//;

async function run(dpr) {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  const img = [];    // imagery tile zooms
  const lbl = [];    // labels tile zooms
  let placeholder = 0;
  page.on("response", (resp) => {
    const u = resp.url();
    let m = IMG_RE.exec(u);
    if (m) {
      const z = Number(m[1]);
      img.push(z);
      // A request past native, or a tiny 200 body, is the gray placeholder tell.
      const len = Number(resp.headers()["content-length"] || 0);
      if (z > NATIVE_CEIL || (len > 0 && len < 1200)) placeholder++;
      return;
    }
    m = LBL_RE.exec(u);
    if (m) lbl.push(Number(m[1]));
  });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  // The faint labels overlay (World_Transportation) is ON by default in the finder, so
  // it's exercised through the deep zoom below without toggling anything.
  // Center + zoom over the saved Katy parcel.
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (_) {}
  await page.waitForTimeout(1500);
  // Now wheel in DEEP over the map (past the parcel-fit zoom) toward maxZoom 21 — this
  // is where the over-zoom placeholder used to appear on retina.
  const box = await page.locator(".leaflet-container").first().boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  for (let i = 0; i < 14; i++) { await page.mouse.move(cx, cy); await page.mouse.wheel(0, -300); await page.waitForTimeout(160); }
  await page.waitForTimeout(2000);
  await browser.close();
  const uniq = (a) => [...new Set(a)].sort((x, y) => x - y);
  return {
    dpr,
    imgZooms: uniq(img), imgTop: img.length ? Math.max(...img) : null, imgCount: img.length,
    lblZooms: uniq(lbl), lblTop: lbl.length ? Math.max(...lbl) : null, lblCount: lbl.length,
    placeholder,
  };
}

const r1 = await run(1);
const r2 = await run(2);
console.log("DPR 1 (standard):", JSON.stringify(r1));
console.log("DPR 2 (retina)  :", JSON.stringify(r2));

const reached = (r2.imgZooms || []).includes(NATIVE_CEIL) || (r1.imgZooms || []).includes(NATIVE_CEIL);
const imgOk = r2.imgTop != null && r2.imgTop <= NATIVE_CEIL && r1.imgTop != null && r1.imgTop <= NATIVE_CEIL;
const lblOk = (r2.lblTop == null || r2.lblTop <= NATIVE_CEIL) && (r1.lblTop == null || r1.lblTop <= NATIVE_CEIL);
const noPlaceholder = r2.placeholder === 0 && r1.placeholder === 0;

console.log("");
console.log(`deep zoom reached (z${NATIVE_CEIL} imagery requested): ${reached ? "yes" : "NO — test inconclusive, did not zoom deep enough"}`);
console.log(`imagery clamped to native ≤ z${NATIVE_CEIL} (both DPR): ${imgOk ? "PASS ✓" : "FAIL ✗ (requested past native = placeholder)"}`);
console.log(`labels clamped to native ≤ z${NATIVE_CEIL} (aligned):   ${lblOk ? "PASS ✓" : "FAIL ✗ (labels diverge past imagery ceiling)"}`);
console.log(`no placeholder-sized / past-native responses:        ${noPlaceholder ? "PASS ✓" : `FAIL ✗ (${r1.placeholder + r2.placeholder} hits)`}`);
const pass = reached && imgOk && lblOk && noPlaceholder;
console.log(`\nRESULT: ${pass ? "PASS ✓ — no over-zoom placeholder on the map finder at retina" : "FAIL ✗"}`);
process.exit(pass ? 0 : 1);
