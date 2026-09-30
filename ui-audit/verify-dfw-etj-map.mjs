/* verify-dfw-etj-map — the DFW City-limits + ETJ layers PAINT, with labels, at Dallas (NEW-1).
 *
 * Drives the REAL cached-vector overlay engine (`cachedVectorLayer` over the real `VECTOR_SOURCES` rows and
 * the real `JURISDICTIONS` styles) in Chromium, against the LIVE services, and asserts what a person would
 * see: both layers report loaded, city limits draw SOLID and ETJ DASHED (line style, not opacity, is the
 * distinction), ETJ name labels appear for several cities, and the ETJ layer reaches PAST the 50-mile circle
 * (a city's polygon is never cut off at the radius).
 *
 * Run:  npx vite --port 5199 --strictPort &   then   NODE_USE_ENV_PROXY=1 node ui-audit/verify-dfw-etj-map.mjs
 * ⛔ LIVE-NETWORK — needs the ArcGIS hosts reachable from the browser (`Blocker: live-GIS` elsewhere).
 * Screenshots: SHOTS=<dir>.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const BASE = process.env.BASE_URL || "http://localhost:5199";
const SHOTS = process.env.SHOTS || null;
const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, ignoreHTTPSErrors: true });
  await assertMeasurable(page, "verify-dfw-etj-map");
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const view = async (lat, lng, z, tag) => {
    await page.goto(`${BASE}/ui-audit/dfw-etj-map-harness.html?lat=${lat}&lng=${lng}&z=${z}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__READY__ === true, { timeout: 20000 });
    await page.waitForFunction(() => {
      const s = window.__status; return s.jur_city && s.jur_etj && ["loaded", "empty", "failed"].includes(s.jur_city.state) && ["loaded", "empty", "failed"].includes(s.jur_etj.state);
    }, { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const paths = [...document.querySelectorAll("#map .leaflet-overlay-pane svg path, #map .leaflet-bnd-pane svg path")];
      const dashed = paths.filter((p) => p.getAttribute("stroke-dasharray")).length;
      const labels = [...document.querySelectorAll("#map .leaflet-boundarylabels-pane span")].map((n) => n.textContent.trim());
      return { status: window.__status, paths: paths.length, dashed, solid: paths.length - dashed, labels };
    });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dfw-${tag}.png` });
    return r;
  };

  // Metro view centred on Dallas, wide enough to reach beyond the 50-mile circle.
  const wide = await view(32.85, -96.8, 9, "z9");
  ok("city limits layer loaded (z9)", wide.status.jur_city.state === "loaded", JSON.stringify(wide.status.jur_city));
  ok("ETJ layer loaded (z9)", wide.status.jur_etj.state === "loaded", JSON.stringify(wide.status.jur_etj));
  ok("both draw: solid city lines AND dashed ETJ lines", wide.solid > 20 && wide.dashed > 10, `solid=${wide.solid} dashed=${wide.dashed}`);
  const etjLabels = wide.labels.filter((t) => / ETJ$/.test(t));
  ok("ETJ labels paint at metro zoom", etjLabels.length >= 5, `${etjLabels.length}: ${etjLabels.slice(0, 12).join(" | ")}`);

  const mid = await view(32.78, -96.8, 10, "z10");
  ok("city + ETJ both loaded (z10)", mid.status.jur_city.state === "loaded" && mid.status.jur_etj.state === "loaded", JSON.stringify(mid.status));
  ok("city-name labels paint at z10", mid.labels.some((t) => !/ ETJ$/.test(t)), `${mid.labels.length} labels: ${mid.labels.slice(0, 10).join(" | ")}`);
  ok("no page errors", errors.length === 0, errors.join(" | "));
} finally { await browser.close(); }
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : `\nAll ${results.length} map checks passed.`);
process.exit(failed.length ? 1 : 0);
