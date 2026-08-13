/* longSession — does the SAME gesture get more expensive the longer you stay on a site? (B1357)
 *
 * The owner's question, verbatim: "does it make sense that zoom degrades the longer i stay on a
 * site". It makes sense MECHANICALLY — several caches in this app grow with use — but nobody had
 * ever measured whether it actually happens, or which growth is responsible. Every retention fix
 * shipped this week (B1121 tile caps · B1160 canvas backing stores · B1161 MapFinder's second map ·
 * B1162 the two GIS caches · B1331 the PDF proxies) was justified by "this is unbounded", which is
 * a fine reason to bound something and is NOT evidence that it caused anything. The one suspect
 * that WAS measured properly — the 80-deep undo stack, B1331 — came back innocent at 0.4 MB. This
 * is that standard, applied to the rest.
 *
 * THE SHAPE, and why each piece is there:
 *
 *   • CHECKPOINTS, not a before/after pair. Two points cannot tell a trend from a fluke; the
 *     protocol runs the identical reference gestures at t=0 and after each workload round, so the
 *     reader sees a line rather than a delta.
 *   • TWO ARMS, and this is the load-bearing control. The `hold` arm NEVER changes the plan — pan,
 *     zoom, visit fresh map area, open and close panels, select and deselect — so anything that
 *     moves is RETENTION. The `grow` arm additionally adds elements, so the cost of a bigger model
 *     is sized separately. "The plan got bigger" is load and is not a bug; "the same gesture on the
 *     same plan costs more" is the thing being reported.
 *   • ATTRIBUTION, not a yes/no. Every checkpoint records the counters that could explain a move —
 *     JS heap, canvas DOM nodes, retained tile <img> per layer, element count, and the DOM-commit
 *     count per pointermove — so a slowdown can be pinned to a counter. A degradation number with
 *     no correlated counter is a symptom, not a finding, and is reported as such.
 *   • A STATED NOISE FLOOR. Checkpoint 0 is measured `--reps` times before any workload runs; the
 *     spread of those repeats IS the floor, and no later move is called real unless it clears it.
 *     If nothing clears it the verdict is INCONCLUSIVE, which is a valid and useful result.
 *
 * ⚠ THE SUSPECT THIS HARNESS CANNOT EXERCISE, stated rather than routed around. Decoded basemap
 * imagery is arguably the largest single contributor to the owner's ~278 MB tab, and this sandbox
 * blocks every external tile host (perf-budgets.json records `firstAerialCoverageMs` as SKIPPED,
 * never silently passed). So the run below drives real map movement but NO tiles ever decode, and
 * the tile counters will read zero. That half cannot be settled here at all — it is V539 territory
 * (`measureUserAgentSpecificMemory()` after sustained panning on a signed-in production session)
 * and must stay open rather than be closed on a sandbox proxy. The harness reports this by name in
 * its own output; do not let a green run here be read as "map memory is fine".
 */

export const DEFAULT_ROUNDS = 4;
export const DEFAULT_REPS = 3;

/* The reference gestures. DELIBERATELY the same shapes ui-audit/perf-harness.mjs and
 * ui-audit/diagnose-zoom-cost.mjs drive — one wheel event per task through a MessageChannel pump in
 * bursts of five, and a pointer drag from a press point that is the canvas itself — so a number
 * here and a number there describe the same thing and can be compared. */
export const WHEEL_BURSTS = 8, WHEEL_BURST = 5, DRAG_MOVES = 30;

/* A press point that is UNAMBIGUOUSLY bare canvas: the hit must BE the <svg>. At the Goose Creek
 * scenario's canvas centre the top hit is a building's <rect>, and one rung out it is a parcel
 * ring — a press on either drags THAT and never pans, which samples a serene 60 fps and reports it
 * as a pan result (MEASUREMENT BLOCKER #5 in the harness, hit again here). */
export function pressPointScript() {
  return () => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      for (const fx of [0.25, 0.75, 0.12, 0.88, 0.5]) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        if (document.elementFromPoint(x, y) === svg) return { x, y };
      }
    }
    return null;
  };
}

/* Everything a checkpoint records BESIDES the frame medians. Each entry is a candidate explanation
 * for a move in the medians; a counter that never moves exonerates its suspect. */
export function counterScript() {
  return () => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    const tilesByLayer = {};
    for (const t of document.querySelectorAll("img.leaflet-tile")) {
      const key = t.parentElement?.className?.baseVal || t.parentElement?.className || "unknown";
      tilesByLayer[key] = (tilesByLayer[key] || 0) + 1;
    }
    return {
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      canvasNodes: svg ? svg.getElementsByTagName("*").length : 0,
      documentNodes: document.getElementsByTagName("*").length,
      ppf: svg ? +Number(svg.getAttribute("data-view-ppf")).toFixed(4) : null,
      tiles: Object.values(tilesByLayer).reduce((a, b) => a + b, 0),
      /* THE ONE THAT MATTERS FOR MEMORY. `img.leaflet-tile` counts the placeholders Leaflet
       * creates; `.leaflet-tile-loaded` counts the ones that actually DECODED. In this sandbox the
       * tile hosts are blocked, so the first number grows and the second stays at zero — and it is
       * the second that costs renderer memory. Reporting only the first would let a run look like
       * it exercised imagery when it exercised nothing of the kind. */
      tilesLoaded: document.querySelectorAll(".leaflet-tile-loaded").length,
      tilesByLayer,
      tileLayers: document.querySelectorAll(".leaflet-layer").length,
      // The DRAWN element count, not the model's — the canvas culls to the view (B1345's
      // `cullToView`), so this reads as "how much is on screen", which is what a frame pays for.
      // It is the arm control's evidence: in the `hold` arm it must not trend.
      /* ⛔ COUNTED ACROSS ALL FIVE DRAWN KINDS (NEW-2). `[data-el-id]` is ELEMENTS ONLY, so a
       * markup, measurement, callout or parcel appearing or leaving mid-session was invisible to
       * this control — the arm could trend hard and the control still read flat. Distinct
       * `data-feature` KEYS, never nodes: chrome (a pond label, a parcel's acreage badge) carries
       * its owner's key too, so a node count drifts with selection and hover. */
      featuresDrawn: svg ? new Set([...svg.querySelectorAll("[data-feature]")].map((n) => n.getAttribute("data-feature"))).size : 0,
      /* el-tier: the element slice of that, kept as detail beside the census. */
      elementsDrawn: svg ? svg.querySelectorAll("[data-el-id]").length : 0,
    };
  };
}

/* THE NOISE FLOOR, stated as a rule rather than eyeballed. The spread across checkpoint 0's own
 * repeats is what this container can resolve; anything inside it is not a finding. Reported as a
 * fraction of the median so it reads the same at any throttle. */
export const FRAME_QUANTUM_MS = 1000 / 60;
export function noiseFloor(reps) {
  const v = reps.filter((x) => typeof x === "number" && x > 0);
  if (v.length < 2) return { floorPct: null, why: "fewer than two clean repeats — no floor can be stated" };
  const s = [...v].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  const spread = s[s.length - 1] - s[0];
  /* ⛔ THE FLOOR MAY NEVER BE ZERO, and finding that out cost a false positive on the first run.
   * A frame median is a percentile of INTER-FRAME DELTAS, which the display clock quantises to
   * ~16.7 ms — so a fast, steady gesture reports the identical number every repeat, the measured
   * spread is 0, and a later 16.8 vs 16.7 reads as "SLOWER" against a ±0% floor. One frame quantum
   * is the smallest difference this instrument can express at all; anything under it is not a
   * measurement, whatever the repeats said. */
  const floorPct = Math.max((spread / med) * 100, (FRAME_QUANTUM_MS / med) * 100);
  return { floorPct: +floorPct.toFixed(1), measuredSpreadPct: +((spread / med) * 100).toFixed(1), median: med, min: s[0], max: s[s.length - 1], quantumFloored: spread < FRAME_QUANTUM_MS };
}

/* Did a checkpoint move, against the stated floor? Returns a verdict string, never a bare boolean —
 * "inconclusive" is a real answer here and must not collapse into "no". */
export function verdictFor(base, now, floorPct) {
  if (base == null || now == null) return { verdict: "unmeasured", changePct: null };
  const changePct = +(((now - base) / base) * 100).toFixed(1);
  if (floorPct == null) return { verdict: "inconclusive", changePct, why: "no noise floor could be stated" };
  if (Math.abs(changePct) <= floorPct) return { verdict: "within-noise", changePct };
  return { verdict: changePct > 0 ? "SLOWER" : "faster", changePct };
}

/* Which counter, if any, moved WITH the gesture cost. Correlation over a handful of checkpoints is
 * weak evidence and is labelled as such — the point is to name a suspect, never to prove one. */
export function correlate(series) {
  const out = [];
  const cost = series.map((c) => c.wheelMedianMs).filter((x) => typeof x === "number");
  if (cost.length < 3) return out;
  const keys = ["heapMB", "canvasNodes", "documentNodes", "tiles", "elements", "panCommitsPerMove"];
  for (const k of keys) {
    const v = series.map((c) => c.counters?.[k] ?? c[k]).filter((x) => typeof x === "number");
    if (v.length !== cost.length) continue;
    const r = pearson(cost, v);
    if (r == null) continue;
    out.push({ counter: k, r: +r.toFixed(2), from: v[0], to: v[v.length - 1] });
  }
  return out.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}

export function pearson(a, b) {
  const n = a.length;
  if (n < 2 || b.length !== n) return null;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  if (!da || !db) return null;
  return num / Math.sqrt(da * db);
}

/* ---- The protocol ---------------------------------------------------------------------------
 * Driven from ui-audit/perf-harness.mjs (--long-session), so it inherits that harness's context
 * exactly: the seeded Goose Creek scenario, the continuous rAF frame sampler, the CPU/DPR
 * emulation and the cross-origin route block. Nothing is re-derived here that already exists there.
 */
const pctOf = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function wheelGesture(page, cx, cy, view = null, before = null) {
  let moved = false;
  for (let b = 0; b < WHEEL_BURSTS; b++) {
    await page.evaluate(([n, dy, x, y]) => new Promise((done) => {
      const el = document.querySelector('[data-testid="planner-canvas"]');
      const ch = new MessageChannel();
      let i = 0;
      ch.port1.onmessage = () => {
        el.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, clientX: x, clientY: y, bubbles: true, cancelable: true }));
        if (++i < n) ch.port2.postMessage(0); else done();
      };
      ch.port2.postMessage(0);
    }), [WHEEL_BURST, b % 2 ? -120 : 120, cx, cy]);
    await page.waitForTimeout(40);
    if (b === 0 && view) moved = (await view()) !== before;
  }
  return moved;
}

async function dragGesture(page, px, py) {
  await page.mouse.move(px, py);
  await page.mouse.down();
  for (let i = 0; i < DRAG_MOVES; i++) await page.mouse.move(px + Math.sin(i / 5) * 260, py + Math.cos(i / 7) * 160, { steps: 2 });
  await page.mouse.up();
}

/* ONE checkpoint: the two reference gestures plus every counter, measured identically every time.
 * The frame sampler's own trust rules are applied here too — a starved or hidden sample is reported
 * as null with its reason, never as a median (the B1086 trap, which matters more in a trend than
 * anywhere else: one starved checkpoint invents a slope). */
async function checkpoint(page, { cx, cy, press: pressIn, visibility, minFps, faultFor }) {
  /* RE-RESOLVE THE PRESS POINT EVERY TIME. It was resolved once, at t=0, and the workload pans the
   * plan out from under it — so by round 1 the "bare canvas" spot held a building and the pan
   * checkpoint measured an element drag that never moved the view. A checkpoint that silently
   * changes what it measures is worse than no checkpoint. */
  const press = (await page.evaluate(pressPointScript())) || pressIn;
  const view = () => page.evaluate(() => {
    const s = document.querySelector('[data-testid="planner-canvas"]');
    return s ? `${s.getAttribute("data-view-offx")}|${s.getAttribute("data-view-offy")}|${s.getAttribute("data-view-ppf")}` : null;
  });

  await page.mouse.move(cx, cy);
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__frames.length = 0; });
  const wBefore = await view();
  const wT0 = Date.now();
  /* The bursts alternate direction so the view cannot run into the ppf clamp — which means an even
   * number of them lands the view EXACTLY back where it started, and an endpoint-only "did it
   * move?" check reports a perfectly good gesture as idle. Sample after the FIRST burst instead. */
  const wMid = await wheelGesture(page, cx, cy, view, wBefore);
  const wMs = Date.now() - wT0;
  await page.waitForTimeout(120);
  const wFrames = (await page.evaluate(() => window.__frames.map((f) => f.d ?? f))).slice(1);
  const wFault = faultFor({ visibility, samples: wFrames.length, gestureMs: wMs, minFps });

  /* The DOM-commit count per pointermove, the signal ui-audit/diagnose-pan-commits.mjs reports —
   * carried into the pan half so a slowdown can be told apart from "React is committing more". */
  await page.evaluate(() => {
    window.__batches = 0; window.__records = 0;
    window.__lsMo = new MutationObserver((recs) => { window.__batches++; window.__records += recs.length; });
    window.__lsMo.observe(document.body, { attributes: true, childList: true, characterData: true, subtree: true });
  });
  await page.evaluate(() => { window.__frames.length = 0; });
  const dBefore = await view();
  const dT0 = Date.now();
  await dragGesture(page, press.x, press.y);
  const dMs = Date.now() - dT0;
  await page.waitForTimeout(120);
  const dMoved = (await view()) !== dBefore;
  const dFrames = (await page.evaluate(() => window.__frames.map((f) => f.d ?? f))).slice(1);
  const dom = await page.evaluate(() => { window.__lsMo.disconnect(); return { batches: window.__batches, records: window.__records }; });
  const dFault = faultFor({ visibility, samples: dFrames.length, gestureMs: dMs, minFps });

  const counters = await page.evaluate(counterScript());
  return {
    wheelMedianMs: wFault ? null : (wFrames.length ? +pctOf(wFrames, 50).toFixed(1) : null),
    wheelP90Ms: wFault ? null : (wFrames.length ? +pctOf(wFrames, 90).toFixed(1) : null),
    wheelGestureMs: wMs,
    wheelMoved: wMid,
    wheelFault: wFault || null,
    panMedianMs: dFault ? null : (dFrames.length ? +pctOf(dFrames, 50).toFixed(1) : null),
    panP90Ms: dFault ? null : (dFrames.length ? +pctOf(dFrames, 90).toFixed(1) : null),
    panGestureMs: dMs,
    panMoved: dMoved,
    panFault: dFault || null,
    panCommitsPerMove: +(dom.batches / DRAG_MOVES).toFixed(2),
    panRecords: dom.records,
    counters,
  };
}

/* The between-checkpoint workload. `hold` never changes the plan; `grow` additionally adds
 * elements. Both visit map area the session has not seen, which is what makes a tile cache grow. */
async function workload(page, { cx, cy, press, arm, round }) {
  const added = [];
  for (let i = 0; i < 3; i++) {
    // Travel: pan to genuinely new ground, then zoom in and back out over it.
    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    for (let k = 0; k < 12; k++) await page.mouse.move(press.x + (i % 2 ? -1 : 1) * (60 + k * 22), press.y + ((round + i) % 2 ? 1 : -1) * (30 + k * 12), { steps: 2 });
    await page.mouse.up();
    await page.mouse.wheel(0, i % 2 ? -360 : 360);
    await page.waitForTimeout(120);
    // Panels: open and close one, so any per-open allocation is exercised.
    for (const tab of ["yield", "analysis"]) {
      const t = page.locator(`[data-rail-tab="${tab}"]`);
      if (await t.count()) { await t.first().click().catch(() => {}); await page.waitForTimeout(180); await t.first().click().catch(() => {}); await page.waitForTimeout(120); }
    }
    // Select and deselect, which is the cheapest state churn a real session produces constantly.
    /* el-tier: grabbing one thing to select — a targeted lookup, not a census. */
    const el = page.locator("[data-el-id]").first();
    if (await el.count()) { await el.click({ force: true }).catch(() => {}); await page.waitForTimeout(100); }
    await page.keyboard.press("Escape").catch(() => {});
  }
  if (arm === "grow") {
    /* Add elements THROUGH THE APP, never by writing state: a synthetic model injection would
     * measure a code path no user takes. The rectangle tool is the one gesture that adds an
     * element with no dialog. Undo is deliberately NOT used here — this arm is meant to grow. */
    /* The rail's draw buttons carry no test id, so they are addressed by their visible label —
     * the same handle a user has. If it cannot be found the arm reports `added: 0` and the caller
     * says so, rather than silently degenerating into a second copy of the `hold` arm (which is
     * exactly what the first run of this harness did, and it took a second run to notice). */
    const btn = page.locator("button.rbtn", { hasText: "Paving" }).first();
    for (let i = 0; i < 4; i++) {
      if (!(await btn.count())) break;
      await btn.click().catch(() => {});
      const x = press.x + (i % 2 ? 120 : -120), y = press.y + (i < 2 ? -90 : 90);
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + 90, y + 70, { steps: 4 });
      await page.mouse.up();
      await page.waitForTimeout(180);
      added.push(1);
    }
    await page.keyboard.press("Escape").catch(() => {});
  }
  return { added: added.length };
}

export async function runLongSession(page, opts) {
  const { cx, cy, visibility, minFps, faultFor, rounds = DEFAULT_ROUNDS, reps = DEFAULT_REPS, arm = "hold" } = opts;
  const press = (await page.evaluate(pressPointScript())) || { x: cx, y: cy };

  /* CHECKPOINT 0, measured `reps` times BEFORE any workload. Its own spread is the noise floor —
   * measured on this machine, in this run, rather than assumed from a previous one. */
  const zero = [];
  for (let i = 0; i < reps; i++) zero.push(await checkpoint(page, { cx, cy, press, visibility, minFps, faultFor }));
  const floor = noiseFloor(zero.map((c) => c.wheelMedianMs));
  const panFloor = noiseFloor(zero.map((c) => c.panMedianMs));
  const base = zero[zero.length - 1];

  const series = [{ round: 0, workMs: 0, added: 0, ...base }];
  for (let r = 1; r <= rounds; r++) {
    const t0 = Date.now();
    const w = await workload(page, { cx, cy, press, arm, round: r });
    const workMs = Date.now() - t0;
    const cp = await checkpoint(page, { cx, cy, press, visibility, minFps, faultFor });
    series.push({ round: r, workMs, added: w.added, ...cp });
  }

  const last = series[series.length - 1];
  return {
    arm, rounds, reps, press: { x: Math.round(press.x), y: Math.round(press.y) },
    noiseFloor: floor, panNoiseFloor: panFloor,
    zeroRepeats: zero.map((c) => ({ wheelMedianMs: c.wheelMedianMs, panMedianMs: c.panMedianMs, heapMB: c.counters.heapMB })),
    series,
    verdict: {
      wheel: sustainedVerdict(series.map((c) => c.wheelMedianMs), floor.floorPct),
      pan: sustainedVerdict(series.map((c) => c.panMedianMs), panFloor.floorPct),
      heapMB: { from: base.counters.heapMB, to: last.counters.heapMB },
      canvasNodes: { from: base.counters.canvasNodes, to: last.counters.canvasNodes },
      documentNodes: { from: base.counters.documentNodes, to: last.counters.documentNodes },
      tiles: { from: base.counters.tiles, to: last.counters.tiles },
      tilesLoaded: { from: base.counters.tilesLoaded, to: last.counters.tilesLoaded },
      featuresDrawn: { from: base.counters.featuresDrawn, to: last.counters.featuresDrawn },
      elementsDrawn: { from: base.counters.elementsDrawn, to: last.counters.elementsDrawn },
    },
    correlations: correlate(series),
    tileCaveat: !last.counters.tilesLoaded
      ? "NO BASEMAP TILES EVER DECODED IN THIS RUN — this sandbox blocks the external tile hosts, so decoded map imagery, the single largest suspect for the owner's tab memory, WAS NOT EXERCISED. Nothing here can clear or convict it. That half is V539: measureUserAgentSpecificMemory() after sustained panning on a signed-in production session."
      : null,
  };
}

/* A SINGLE endpoint above the floor is not a trend, and treating one as a trend produced a false
 * positive on the first real run of this harness: the same `hold` arm reported "within-noise
 * (+0.1%)" and "SLOWER (+14.3%)" on two consecutive runs, because checkpoint 0 itself varies more
 * between runs than the within-run floor can see. So a move is only called REAL when the last TWO
 * checkpoints both clear the floor in the same direction; one that clears it only at the end is
 * reported as `unsustained`, which is a different and more honest thing than either answer. */
export function sustainedVerdict(seriesValues, floorPct) {
  const v = seriesValues.filter((x) => typeof x === "number");
  if (v.length < 3 || v[0] == null) return { verdict: "unmeasured", changePct: null };
  const base = v[0];
  const at = (x) => +(((x - base) / base) * 100).toFixed(1);
  const changePct = at(v[v.length - 1]);
  if (floorPct == null) return { verdict: "inconclusive", changePct, why: "no noise floor could be stated" };
  const over = (x) => Math.abs(at(x)) > floorPct && Math.sign(at(x)) === Math.sign(changePct);
  if (Math.abs(changePct) <= floorPct) return { verdict: "within-noise", changePct, floorPct };
  if (!over(v[v.length - 2])) return { verdict: "unsustained", changePct, floorPct, why: "only the final checkpoint cleared the floor — one point is not a trend" };
  return { verdict: changePct > 0 ? "SLOWER" : "faster", changePct, floorPct };
}
