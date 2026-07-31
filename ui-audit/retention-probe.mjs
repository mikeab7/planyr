#!/usr/bin/env node
/* retention-probe — WHAT THE PLANNER ACTUALLY HOLDS ON TO (NEW-5).
 *
 * The owner sees ~278 MB on the Chrome tab. That number cannot be attributed from source, and it
 * cannot be measured the easy way either: `performance.measureUserAgentSpecificMemory()` needs
 * cross-origin isolation, which planyr.io does not set (see `peakHeapMB`'s note in
 * ui-audit/perf-budgets.json), and most of a map-heavy tab is decoded tile bitmaps plus GPU copies
 * that the JS-heap number cannot see at all. So the honest instrument for the TAB is a DevTools heap
 * snapshot with retainer paths, taken on a real signed-in session after a long editing run — that is
 * a live check, and it is logged as one.
 *
 * This probe answers the half that does NOT need a browser, and answers it exactly: **is the undo
 * stack duplicating payloads, or sharing them?** That question decides whether suspect (i) is
 * megabytes or kilobytes, and it is a property of how JavaScript holds the objects — measurable
 * here, deterministically, with no sampling noise and no tab-visibility trap.
 *
 * THE RULE THIS EXISTS TO ENFORCE: lowering the undo limit is a PRODUCT decision (how far back can
 * the owner undo), so nothing here may be used to justify lowering it on a guess. The probe reports
 * the number; a cap is a separate, owner-facing conversation.
 *
 *   node --expose-gc ui-audit/retention-probe.mjs
 *   node --expose-gc ui-audit/retention-probe.mjs --json
 *
 * Never exits non-zero on a measurement — it is an instrument, not a gate.
 */
import { createHistoryStack } from "../src/workspaces/site-planner/lib/history.js";

const JSON_OUT = process.argv.includes("--json");
const MB = (b) => +(b / 1048576).toFixed(2);
const KB = (b) => +(b / 1024).toFixed(1);

/* A forced-GC heap reading. Without --expose-gc the numbers still work but carry uncollected
 * garbage, so we say so rather than quietly reporting a worse figure as if it were retention. */
const canGc = typeof global.gc === "function";
const heap = () => {
  if (canGc) { global.gc(); global.gc(); }
  return process.memoryUsage().heapUsed;
};

/* ---- The model under test -------------------------------------------------------------------
 * Shaped like a real plan, with the two payload classes the item names as the suspects: a markup
 * carrying an image `src` and a sheet overlay carrying a deed raster. Both are big strings, because
 * that is what a data: URL is. `PAYLOAD_KB` is per payload; six of them, so a single generation's
 * payloads outweigh its geometry many times over — exactly the case where copy-vs-share matters. */
const PAYLOAD_KB = 512;
const bigString = (kb, seed) => `data:image/png;base64,${seed}`.padEnd(kb * 1024, "A");

function makeModel() {
  const els = Array.from({ length: 600 }, (_, i) => ({ id: `e${i}`, type: "building", cx: i * 30, cy: (i % 9) * 40, w: 300, h: 200, rot: 0, z: i * 1024 }));
  const parcels = [{ id: "p1", points: Array.from({ length: 40 }, (_, i) => ({ x: i * 55, y: (i % 5) * 90 })) }];
  const markups = Array.from({ length: 3 }, (_, i) => ({ id: `m${i}`, kind: "image", src: bigString(PAYLOAD_KB, `m${i}`), z: i * 1024 }));
  const sheetOverlays = Array.from({ length: 3 }, (_, i) => ({ id: `o${i}`, src: bigString(PAYLOAD_KB, `o${i}`), imgW: 3400, imgH: 2200, ftPerPx: 1.4 }));
  return { parcels, els, measures: [], callouts: [], markups, sheetOverlays, underlay: null, layerOverrides: {}, layerAbove: {} };
}

/* ONE ordinary edit, done exactly the way the planner does it: `setEls(a => a.map(...))`. React
 * state updates replace the ARRAY and the one changed element; every untouched element, and every
 * other collection, keeps its identity. Whether the payloads are copied across generations is
 * decided right here, and nowhere else. */
const editOne = (state, i) => ({
  ...state,
  els: state.els.map((e, k) => (k === i % state.els.length ? { ...e, cx: e.cx + 1 } : e)),
});

const LIMIT = 80;                       // lib/history.js's shipped default — the thing being sized
const keyOf = (s) => JSON.stringify({ p: s.parcels, e: s.els, m: s.measures, c: s.callouts, k: s.markups });

function measure() {
  const out = {};
  out.gcAvailable = canGc;
  out.undoLimit = LIMIT;
  out.payloadKbEach = PAYLOAD_KB;
  out.payloadCount = 6;

  let base = makeModel();
  out.oneModelBytes = (() => {
    const before = heap();
    const held = Array.from({ length: 8 }, () => makeModel());
    const after = heap();
    held.length = 0;
    return Math.round((after - before) / 8);
  })();

  // Fill the stack the way a long editing run does: LIMIT + 40 edits, so eviction has run.
  const before = heap();
  const stack = createHistoryStack({ keyOf, limit: LIMIT });
  let live = base;
  for (let i = 0; i < LIMIT + 40; i++) { stack.push(live); live = editOne(live, i); }
  const after = heap();
  out.stackRetainedBytes = after - before;
  out.perGenerationBytes = Math.round(out.stackRetainedBytes / LIMIT);

  // THE DECIDING COMPARISON: what a stack of LIMIT INDEPENDENT models costs. If snapshots copied
  // their payloads, the two figures would be the same order; if they share, the stack is a small
  // fraction of it.
  const before2 = heap();
  const independent = Array.from({ length: LIMIT }, () => makeModel());
  const after2 = heap();
  out.independentModelsBytes = after2 - before2;
  independent.length = 0;

  out.sharingRatio = +(out.stackRetainedBytes / Math.max(1, out.independentModelsBytes)).toFixed(4);
  out.payloadsAreShared = out.sharingRatio < 0.25;   // a copied stack lands at ~1.0, a sharing one far under
  base = null; live = null;
  return out;
}

const r = measure();

if (JSON_OUT) {
  console.log(JSON.stringify(r, null, 2));
} else {
  console.log("Planyr retention probe (NEW-5) — suspect (i): the undo stack\n");
  if (!r.gcAvailable) console.log("  ⚠ run with --expose-gc for retention figures rather than heap-with-garbage\n");
  console.log(`  undo limit (lib/history.js):        ${r.undoLimit} snapshots`);
  console.log(`  payloads in the model:              ${r.payloadCount} × ${r.payloadKbEach} KB (markup images + deed rasters)`);
  console.log(`  one model, measured:                ${MB(r.oneModelBytes)} MB`);
  console.log(`  ${r.undoLimit} INDEPENDENT models would cost:  ${MB(r.independentModelsBytes)} MB`);
  console.log(`  the FULL undo stack actually costs: ${MB(r.stackRetainedBytes)} MB  (${KB(r.perGenerationBytes)} KB per generation)`);
  console.log(`  ratio (stack ÷ independent):        ${r.sharingRatio}\n`);
  console.log(r.payloadsAreShared
    ? "  ✅ PAYLOADS ARE STRUCTURALLY SHARED. An edit replaces the array and the one changed\n     element; every untouched element, every other collection, and every image/raster STRING\n     keeps its identity across generations. So the undo stack costs KILOBYTES per generation,\n     not megabytes — it is NOT the 278 MB, and there is no memory case for lowering the limit.\n     Lowering it is a product decision about how far back undo reaches; leave it to the owner."
    : "  ⛔ PAYLOADS ARE BEING COPIED per generation. Something on the edit path is deep-copying\n     the model — find and remove that copy BEFORE touching the undo limit, which is a product\n     decision and the wrong lever for a defect.");
}
