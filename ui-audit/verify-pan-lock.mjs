#!/usr/bin/env node
/* NEW-2 — MEASURE THE TRANSIENT: does drawn geometry stay locked to the aerial DURING a drag?
 *
 * The owner's instruction, followed exactly: a start/end comparison reads ZERO and misses this
 * entirely (that is why B1043's out-and-back excursion passed while the complaint is real). So this
 * samples every frame WHILE the pointer is down.
 *
 * WHAT IT COMPARES, and why this works without imagery. The sandbox's Chromium cannot reach any
 * external host, so aerial tiles never paint here and a drawn-vertex-vs-aerial-FEATURE comparison is
 * impossible. But the mechanism under test does not need pixels: hypothesis (B) from the 2026-07-21
 * filing is that the debounced commit re-centres on a STALE centre versus the LIVE CSS transform.
 * Both of those are readable from Leaflet + the DOM directly:
 *   • where the map pane actually IS   → the CSS translate on `.leaflet-map-pane`
 *   • where the drawn SVG layer thinks it is → the planner's own view transform
 *   • where Leaflet thinks the centre is → `map.getCenter()` projected at the live zoom
 * A lock failure shows up as those disagreeing mid-gesture and re-agreeing at rest — which is
 * precisely the reported symptom and precisely what a before/after probe cannot see.
 *
 * Probes are anchored BY GEOMETRY SIGNATURE (the `d`/`points` attribute), never by a held DOM
 * reference, because B1047 culling removes and RE-CREATES off-screen elements mid-excursion and a
 * held reference goes stale.
 *
 * USAGE  node ui-audit/verify-pan-lock.mjs [--url=http://localhost:4173] [--eps=1.5] [--json]
 * Exit 0 = the worst mid-gesture disagreement stayed within `--eps` device pixels on every leg.
 */
import { chromium } from "playwright";

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const URL_ = arg("url", "http://localhost:4173");
const EPS = Number(arg("eps", "1.5"));
const asJson = process.argv.includes("--json");
const EXEC = process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const out = { url: URL_, eps: EPS, legs: [], ok: false };

try {
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  // Visibility is asserted, not assumed — a hidden tab starves rAF and every sample reads zero
  // (the B1086 trap). Bail loudly rather than emit a clean-looking pass.
  const vis = await page.evaluate(() => document.visibilityState);
  if (vis !== "visible") throw new Error(`document.visibilityState is "${vis}" — samples would be meaningless`);

  await page.getByRole("button", { name: /Site/i }).first().click().catch(() => {});
  await page.getByRole("button", { name: /Start blank/i }).first().click();
  const svg = page.getByTestId("planner-canvas");
  await svg.waitFor({ state: "visible", timeout: 20000 });

  // Draw a building so there is real geometry to probe, then remember it by SIGNATURE.
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  const box = await svg.boundingBox();
  const x0 = box.x + box.width * 0.35, y0 = box.y + box.height * 0.4;
  const x1 = box.x + box.width * 0.62, y1 = box.y + box.height * 0.58;
  await page.mouse.move(x0, y0); await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(500);

  // The sampler. Reads the three quantities described above, resolving the probe by signature.
  await page.evaluate(() => {
    window.__panLock = { samples: [], sig: null };
    const el = [...document.querySelectorAll("[data-testid='planner-canvas'] rect, [data-testid='planner-canvas'] path")]
      .map((n) => ({ n, sig: n.getAttribute("d") || n.getAttribute("x") + "," + n.getAttribute("y") }))
      .filter((o) => o.sig)[0];
    window.__panLock.sig = el ? el.sig : null;
    window.__panLock.read = () => {
      const pane = document.querySelector(".leaflet-map-pane");
      const m = pane && /translate3?d?\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(pane.style.transform || "");
      const paneX = m ? parseFloat(m[1]) : null, paneY = m ? parseFloat(m[2]) : null;
      // Re-resolve the probe by SIGNATURE every sample (B1047 re-creates culled nodes).
      const node = [...document.querySelectorAll("[data-testid='planner-canvas'] rect, [data-testid='planner-canvas'] path")]
        .find((n) => (n.getAttribute("d") || n.getAttribute("x") + "," + n.getAttribute("y")) === window.__panLock.sig);
      const r = node ? node.getBoundingClientRect() : null;
      const map = window.__geoMap;
      let centerPx = null;
      try { if (map) { const c = map.getCenter(); const p = map.project(c, map.getZoom()); centerPx = { x: p.x, y: p.y }; } } catch (_) {}
      return { t: performance.now(), paneX, paneY, drawnX: r ? r.x : null, drawnY: r ? r.y : null, centerPx };
    };
  });

  const legs = [
    { name: "slow E-W", dx: -240, dy: 0, steps: 24 },
    { name: "fast flick E-W", dx: -320, dy: 0, steps: 3 },
    { name: "slow N-S", dx: 0, dy: -220, steps: 24 },
    { name: "diagonal", dx: -180, dy: -160, steps: 18 },
  ];
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  for (const leg of legs) {
    // Pan the MAP (space-drag / middle-drag equivalent): grab empty canvas away from the building.
    const sx = box.x + box.width * 0.85, sy = box.y + box.height * 0.85;
    await page.mouse.move(sx, sy);
    await page.evaluate(() => { window.__panLock.samples = []; });
    await page.mouse.down({ button: "middle" }).catch(async () => { await page.mouse.down(); });
    for (let i = 1; i <= leg.steps; i++) {
      await page.mouse.move(sx + (leg.dx * i) / leg.steps, sy + (leg.dy * i) / leg.steps);
      await page.evaluate(() => { window.__panLock.samples.push(window.__panLock.read()); });
    }
    await page.mouse.up({ button: "middle" }).catch(async () => { await page.mouse.up(); });
    await page.waitForTimeout(900); // let the debounced commit settle
    await page.evaluate(() => { window.__panLock.samples.push({ ...window.__panLock.read(), settled: true }); });

    const s = await page.evaluate(() => window.__panLock.samples);
    // The lock invariant: the drawn layer and the map pane must move by the SAME delta, frame for
    // frame. Any per-frame divergence is the transient the owner is reporting.
    const first = s.find((x) => x.paneX != null && x.drawnX != null);
    // A leg only counts if BOTH surfaces actually TRAVELLED. Without this a leg where the map never
    // panned reports 0px divergence and reads as a clean pass — a guard that cannot fail. The
    // measurement must be able to say "did not run".
    let paneTravel = 0, drawnTravel = 0;
    if (first) {
      for (const x of s) {
        if (x.paneX == null || x.drawnX == null) continue;
        paneTravel = Math.max(paneTravel, Math.hypot(x.paneX - first.paneX, x.paneY - first.paneY));
        drawnTravel = Math.max(drawnTravel, Math.hypot(x.drawnX - first.drawnX, x.drawnY - first.drawnY));
      }
    }
    const moved = paneTravel > 20 && drawnTravel > 20;
    let worst = 0, worstAt = null;
    if (first) {
      for (const x of s) {
        if (x.paneX == null || x.drawnX == null) continue;
        const dPane = Math.hypot(x.paneX - first.paneX, x.paneY - first.paneY);
        const dDrawn = Math.hypot(x.drawnX - first.drawnX, x.drawnY - first.drawnY);
        const div = Math.abs(dPane - dDrawn);
        if (div > worst) { worst = div; worstAt = x.t - first.t; }
      }
    }
    out.legs.push({ ...leg, samples: s.length, usable: !!first && moved, paneTravelPx: +paneTravel.toFixed(1), drawnTravelPx: +drawnTravel.toFixed(1), worstDivergencePx: +worst.toFixed(3), worstAtMs: worstAt });
    void cx; void cy;
  }

  const usable = out.legs.filter((l) => l.usable);
  out.usableLegs = usable.length;
  out.worst = usable.length ? Math.max(...usable.map((l) => l.worstDivergencePx)) : null;
  out.ok = usable.length > 0 && out.worst <= EPS;
  if (!usable.length) out.error = "NO LEG ACTUALLY PANNED BOTH SURFACES — the measurement did NOT run. A 0px result here is vacuous, not a pass. Most likely the aerial map is absent (this sandbox's Chromium cannot reach the tile host) so there is no map pane to move, or middle-drag is not the pan gesture on this surface.";
} catch (e) {
  out.error = (e && e.message) || String(e);
} finally {
  await browser.close();
}

if (asJson) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`pan-lock transient · ${out.url} · eps ${EPS}px`);
  for (const l of out.legs) {
    console.log(`   ${l.usable ? "•" : "✗"} ${l.name.padEnd(16)} ${String(l.samples).padStart(3)} samples  pane ${String(l.paneTravelPx).padStart(6)}px  drawn ${String(l.drawnTravelPx).padStart(6)}px  worst div ${l.usable ? l.worstDivergencePx + "px" : "— NOT MEASURED"}`);
  }
  if (out.error) console.log(`\n✗ ${out.error}`);
  else console.log(out.ok ? `\n✓ locked — worst mid-gesture divergence ${out.worst}px ≤ ${EPS}px`
                          : `\n✗ UNLOCKED — worst mid-gesture divergence ${out.worst}px > ${EPS}px`);
}
process.exit(out.ok ? 0 : 1);
