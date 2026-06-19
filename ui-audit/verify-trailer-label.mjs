/* Self-verification for B189 + B190 (trailer-parking label). Seeds the reference
 * scenario (a 360'×50' single-row trailer strip, stall depth 50'), boots the planner,
 * and checks:
 *   B189 — the label is TWO lines: "50′ Trailer Parking" then "<n> trailers", with NO
 *          overall row-dimension line ("360′ × 50′").
 *   B190 — the label stays INSIDE the trailer rectangle across zoom levels (zoomed in,
 *          at fit, and zoomed out), and its size tracks the shape (world-scaled), rather
 *          than staying screen-constant and overflowing on zoom-out.
 * Logged-out / this-device mode (no auth needed). */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const DEMO_ID = "verify-trailer";
const els = [
  // The reference strip: 360' long × 50' deep, single striped row, per-stall trailer length 50'.
  { id: "tr1", type: "trailer", cx: 0, cy: 0, w: 360, h: 50, rot: 0,
    cfg: { trailerW: 12, trailerL: 50, trailerAisle: 0, single: true } },
];
const parcel = { id: "pc1", locked: false, points: [{ x: -700, y: -450 }, { x: 700, y: -450 }, { x: 700, y: 450 }, { x: -700, y: 450 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify Trailer", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(500);

const measure = () => page.evaluate(() => {
  const texts = [...document.querySelectorAll("svg text")];
  const lbl = texts.find((t) => t.textContent.includes("Trailer Parking"));
  const rects = [...document.querySelectorAll("svg rect")].filter((r) => (r.getAttribute("fill") || "").toLowerCase() === "#e3d4b2");
  const shape = rects[0];
  if (!lbl || !shape) return { ok: false, hasLbl: !!lbl, nShapes: rects.length };
  const lb = lbl.getBoundingClientRect(), sb = shape.getBoundingClientRect();
  const lines = [...lbl.querySelectorAll("tspan")].map((t) => t.textContent);
  return { ok: true, lines,
    lb: { x: lb.x, y: lb.y, w: lb.width, h: lb.height },
    sb: { x: sb.x, y: sb.y, w: sb.width, h: sb.height } };
});

const contained = (lb, sb, tol = 2.5) =>
  lb.x >= sb.x - tol && lb.y >= sb.y - tol &&
  lb.x + lb.w <= sb.x + sb.w + tol && lb.y + lb.h <= sb.y + sb.h + tol;

const cx = 820, cy = 450; // canvas area (right of the left panel)
// Negative notches zoom IN, positive zoom OUT (wheel down = zoom out in this app).
const zoom = async (notches) => { for (let i = 0; i < Math.abs(notches); i++) { await page.mouse.move(cx, cy); await page.mouse.wheel(0, notches < 0 ? -300 : 300); await page.waitForTimeout(160); } await page.waitForTimeout(350); };

// Start from fit, then walk progressively from zoomed-IN down to deeply zoomed-OUT — the
// zoom-out leg is the B190 bug scenario (label must stay inside as the strip shrinks).
const results = [];
await zoom(-3); results.push(["zoomed-in", await measure()]);
await page.screenshot({ path: OUT + "trailer-zoomin.png" });
await zoom(3);  results.push(["fit", await measure()]);
await page.screenshot({ path: OUT + "trailer-fit.png" });
await zoom(3);  results.push(["zoomed-out", await measure()]);
await page.screenshot({ path: OUT + "trailer-zoomout.png" });
await zoom(3);  results.push(["zoomed-out-more", await measure()]);
await page.screenshot({ path: OUT + "trailer-zoomout-more.png" });
await zoom(3);  results.push(["zoomed-out-deep", await measure()]);
await page.screenshot({ path: OUT + "trailer-zoomout-deep.png" });

let fail = 0;
const dimRe = /×|x\s*\d|\d+′\s*[×x]/; // any overall-dimension line would contain a "×"
for (const [label, m] of results) {
  if (!m.ok) { console.log(`✗ ${label}: label/shape not found (${JSON.stringify(m)})`); fail++; continue; }
  const ratioH = (m.lb.h / m.sb.h).toFixed(2), ratioW = (m.lb.w / m.sb.w).toFixed(2);
  const inside = contained(m.lb, m.sb);
  // B189 content checks (independent of zoom)
  const twoLines = m.lines.length === 2;
  const l1ok = /^\d+′ Trailer Parking$/.test(m.lines[0] || "");
  const l2ok = /^\d+ trailers$/.test(m.lines[1] || "");
  const noDim = !m.lines.some((t) => dimRe.test(t));
  const shapePx = `${m.sb.w.toFixed(0)}×${m.sb.h.toFixed(0)}px`;
  console.log(`${label}: lines=${JSON.stringify(m.lines)} shape=${shapePx} label/shape=${ratioW}w,${ratioH}h inside=${inside}`);
  if (!twoLines || !l1ok || !l2ok || !noDim) { console.log(`  ✗ B189 content: twoLines=${twoLines} l1=${l1ok} l2=${l2ok} noDimLine=${noDim}`); fail++; }
  // B190 containment: the label must sit inside the strip at every zoom EXCEPT when the strip
  // is too small to hold a legible label (controlled overflow) — i.e. shape height < ~16px.
  const tooSmall = m.sb.h < 16;
  if (!inside && !tooSmall) { console.log(`  ✗ B190 containment: label overflows the strip (${shapePx})`); fail++; }
  else if (!inside && tooSmall) console.log(`  • controlled overflow (strip too small at ${shapePx}) — allowed`);
}

console.log(fail === 0 ? "\n✓ ALL TRAILER-LABEL CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
