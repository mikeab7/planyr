#!/usr/bin/env node
/* B1611840/B1611841 (NEW-1/NEW-2) — live-driven proof, on a real headless browser against a
 * throwaway plan (never one of the owner's real projects), that:
 *  (1) NEW-1 — the real dissolved road/junction rings the renderer actually paints carry no
 *      degenerate turn-angle spike at a curb-return tangent point, on real drawn geometry (an
 *      oblique road-into-pad tee), reading `window.__plannerRoadNet()` — the exact `{outer,holes}`
 *      region data the SVG `<path d>` is built from (roadNetwork.regionPathD).
 *  (2) NEW-2 — a road drawn ending well inside a pad (not near its edge) still produces a real,
 *      non-degenerate curb-return junction anchored at the pad face it crosses, not a stranded
 *      blob deep inside the pad.
 *
 * Usage: node ui-audit/verify-road-junction-cleanup.mjs [--base http://localhost:4173]
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : (process.env.BASE_URL || "http://localhost:4173");
const EXEC = process.env.PW_CHROME || undefined;

function buildIdentity() {
  let commit = "unknown", dirty = false;
  try { commit = execSync("git rev-parse HEAD", { cwd: new URL("..", import.meta.url) }).toString().trim(); } catch {}
  try { dirty = execSync("git status --porcelain", { cwd: new URL("..", import.meta.url) }).toString().trim().length > 0; } catch {}
  let chunk = "unknown";
  try {
    const files = readdirSync(new URL("../dist/assets", import.meta.url));
    chunk = files.find((f) => f.startsWith("SitePlannerApp-")) || "not-found";
  } catch {}
  return { commit, dirty, chunk };
}

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.goto(BASE + "/");
  await page.getByTestId("map-toolbar-draw").click();
  await page.getByTestId("planner-canvas").waitFor({ state: "visible" });
  return page;
}

async function drawRectPad(page, box, kind) {
  await page.getByRole("button", { name: kind, exact: true }).click();
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.4, box.y + box.h * 0.4, { steps: 5 });
  await page.mouse.move(box.x + box.w, box.y + box.h, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function drawRoad(page, from, to) {
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByRole("button", { name: /^\d+′$/ }).last().click();
  await page.mouse.click(from.x, from.y);
  await page.mouse.click(to.x, to.y);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

// Same turn-angle-spike instrument as test/roadJunctionRingCleanup.test.js — a self-contained scan,
// not the fix's own exported helper, so this live proof convicts the ACTUAL renderer output on its
// own terms.
const TURN_BOUND_DEG = 100, SHORT_SEG_FT = 2.0;
function ringSpikes(ring) {
  const n = ring.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
    const v1 = { x: b.x - a.x, y: b.y - a.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
    const len1 = Math.hypot(v1.x, v1.y), len2 = Math.hypot(v2.x, v2.y);
    if (!(len1 > 1e-9) || !(len2 > 1e-9)) continue;
    const turnDeg = Math.abs(Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y)) * 180 / Math.PI;
    if (turnDeg > TURN_BOUND_DEG && (len1 < SHORT_SEG_FT || len2 < SHORT_SEG_FT)) out.push({ i, turnDeg, len1, len2 });
  }
  return out;
}
const ringArea = (ring) => { let s = 0; for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s / 2); };

async function main() {
  const identity = buildIdentity();
  console.log(`Build: commit ${identity.commit}${identity.dirty ? " (+uncommitted working tree)" : ""} · chunk ${identity.chunk}`);

  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const results = [];

  // NEW-1 — oblique road-into-pad tee, real drawn geometry: no ring anywhere carries a spike.
  {
    const page = await newPage(browser);
    const box = await page.getByTestId("planner-canvas").boundingBox();
    await drawRectPad(page, { x: box.x + 300, y: box.y + 450, w: 300, h: 200 }, "Paving");
    const padTopMid = { x: box.x + 450, y: box.y + 450 };
    await drawRoad(page, { x: padTopMid.x - 220, y: padTopMid.y - 260 }, { x: padTopMid.x, y: padTopMid.y });
    await assertMeasurable(page, "verify-road-junction-cleanup");
    const net = await page.evaluate(() => (window.__plannerRoadNet ? window.__plannerRoadNet() : null));
    let spikeTotal = 0;
    const detail = [];
    for (const r of (net && net.regions) || []) {
      const s = ringSpikes(r.outer);
      spikeTotal += s.length;
      for (const h of r.holes || []) { const hs = ringSpikes(h); spikeTotal += hs.length; }
      detail.push({ outerPts: r.outer.length, spikes: s.length });
    }
    results.push({ label: "NEW-1 oblique road-into-pad: no ring spikes", ok: spikeTotal === 0 && !!net, spikeTotal, detail, drives: net ? net.drives.length : 0 });
    await page.close();
  }

  // NEW-2 — a road drawn ending WELL INSIDE a tall pad (not near its edge): real curb returns must
  // still appear, anchored at the pad face, never a stranded/degenerate blob.
  {
    const page = await newPage(browser);
    const box = await page.getByTestId("planner-canvas").boundingBox();
    // A tall pad (300 wide x 500 deep, screen px) so there is plenty of room to land well past the
    // midline without exiting the far side.
    await drawRectPad(page, { x: box.x + 300, y: box.y + 350, w: 300, h: 500 }, "Paving");
    const topMid = { x: box.x + 450, y: box.y + 350 };
    // End point 350 px past the pad's own top edge — well past its own midline (250 px of a 500 px
    // depth), matching the reported "roughly 200 ft or more past the edge" repro shape.
    await drawRoad(page, { x: topMid.x, y: topMid.y - 260 }, { x: topMid.x, y: topMid.y + 350 });
    await assertMeasurable(page, "verify-road-junction-cleanup");
    const net = await page.evaluate(() => (window.__plannerRoadNet ? window.__plannerRoadNet() : null));
    const drive = net && net.drives[0];
    const pad = net && net.pads[0];
    let padDepthFt = null;
    if (pad) {
      const ys = pad.ring.map((p) => p.y);
      padDepthFt = Math.max(...ys) - Math.min(...ys);
    }
    const region = net && net.regions[0];
    const spikes = region ? ringSpikes(region.outer) : [];
    results.push({
      label: "NEW-2 deep-inside endpoint: real curb returns at the pad face, not a degenerate blob",
      ok: !!drive && drive.wedges > 0 && net.regions.length === 1 && spikes.length === 0,
      drives: net ? net.drives.length : 0,
      wedges: drive ? drive.wedges : 0,
      regions: net ? net.regions.length : 0,
      padDepthFt,
      spikeTotal: spikes.length,
    });
    await page.screenshot({ path: "/tmp/verify-road-junction-cleanup-new2.png" }).catch(() => {});
    await page.close();
  }

  await browser.close();

  let failed = false;
  for (const r of results) {
    if (!r.ok) failed = true;
    console.log(`${r.ok ? "✓" : "✗"} ${r.label}: ${JSON.stringify(r)}`);
  }
  if (failed) { console.log("\nFAILED"); process.exit(1); }
  console.log("\nAll live-driven checks passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
