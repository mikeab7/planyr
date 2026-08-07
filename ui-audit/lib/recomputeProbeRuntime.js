/* recomputeProbeRuntime — the in-page recorder the probe build talks to.
 *
 * ⛔ THIS FILE IS NEVER IN A PRODUCTION BUNDLE. It is imported into the entry module ONLY by
 * scripts/vite-plugin-recompute-probe.mjs, which is only added to the Vite plugin list when
 * `PLANYR_PROBE=1` is in the build's environment. `npm run build` produces a bundle in which this
 * file does not appear at all — asserted by test/recomputeProbe.test.js (the plugin is inert
 * without the flag) and visible to the bundle audit, which would see the bytes.
 *
 * WHAT IT RECORDS, and why it is this and not a CPU profile.
 * A sampling profiler answers "where did the milliseconds go". That is the wrong question here,
 * and it is why this defect class survived two accidental discoveries: a computation that
 * re-derives an IDENTICAL answer sixty times looks, in a profile, exactly like one doing sixty
 * different pieces of necessary work. The distinguishing evidence is the ANSWER — so this
 * records, per call: a fingerprint of the inputs · a fingerprint of the result · the wall time.
 * `viewIndependence.mjs` turns "same inputs, same answer, ran 60 times" into a verdict.
 *
 * IDENTITY IS ASSIGNED AT TRANSFORM TIME, not recovered from a stack trace. The plugin knows the
 * real `file:line:col` and the real symbol name while it is looking at the source, so the probe
 * carries them as a literal — exact, and free at runtime. (`ui-audit/lib/sourceMapIndex.mjs`
 * exists for the opposite problem — attributing frames in an UNinstrumented production profile —
 * and the harness still uses it for the cross-check that reports how much of a gesture the
 * instrumented sites actually account for.)
 *
 * OVERHEAD IS BOUNDED AND REPORTED, never hidden:
 *   • fingerprinting stops after FINGERPRINT_CAP calls per site per gesture (a hot leaf can run
 *     100k times; hashing all of them would cost more than the app does). The classifier is told
 *     how many it saw and refuses to accuse a site it only sampled.
 *   • TIMING stops after TIMING_CAP calls, after which the site is counted and nothing else. Two
 *     `performance.now()` calls on a geometry leaf that runs half a million times in one gesture
 *     is tens of milliseconds of instrument inside a measurement of tens of milliseconds of app —
 *     the classic case of the probe becoming the finding. `timedCalls` says how many calls the
 *     `ms` figure covers, so nobody reads a damped number as a total.
 *   • hashing happens OUTSIDE the timed region, so `ms` is the app's time, not the probe's.
 *   • the probe's own time is accumulated separately and printed, so a reader can see what
 *     fraction of the run is instrument.
 */
import { structuralHash, depsFingerprint } from "./recomputeHash.mjs";

const FINGERPRINT_CAP = 400;
const TIMING_CAP = 5000;

function makeProbe() {
  const sites = new Map();          // id → site record
  const stack = [];                 // open calls, for self-time attribution
  let recording = false;
  let label = "";
  let overheadMs = 0;

  const site = (id, kind, file, line, col, name) => {
    let s = sites.get(id);
    if (!s) {
      s = { id, kind, file, line, col, name, calls: 0, timedCalls: 0, renders: 0, ms: 0, childMs: 0, inputs: [], results: [], truncated: false };
      sites.set(id, s);
    }
    return s;
  };

  const reset = (name) => {
    label = name || "";
    overheadMs = 0;
    stack.length = 0;
    for (const s of sites.values()) {
      s.calls = 0; s.timedCalls = 0; s.renders = 0; s.ms = 0; s.childMs = 0;
      s.inputs.length = 0; s.results.length = 0; s.truncated = false;
    }
  };

  /* The one function every instrumented call site funnels through.
   * `inputs` is the dependency array for a memo, or the argument list for a wrapped function. */
  const run = (id, kind, file, line, col, name, fn, inputs, thisArg, args) => {
    if (!recording) return kind === "memo" ? fn() : fn.apply(thisArg, args);
    const s = site(id, kind, file, line, col, name);

    s.calls++;
    // Damped: past the cap this site is a counter and nothing more (see the header).
    if (s.calls > TIMING_CAP) { s.truncated = true; return kind === "memo" ? fn() : fn.apply(thisArg, args); }

    let inHash = null;
    if (s.inputs.length < FINGERPRINT_CAP) {
      const o0 = performance.now();
      const f = depsFingerprint(kind === "memo" ? inputs : Array.prototype.slice.call(args || []));
      inHash = f.hash;
      s.truncated = s.truncated || f.truncated;
      overheadMs += performance.now() - o0;
    } else {
      s.truncated = true;
    }

    stack.push(s);
    s.timedCalls++;
    /* ⛔ THE NESTED-OVERHEAD SUBTRACTION, without which the ranking is the instrument's own.
     * A wrapped function calls other wrapped functions, and each of those fingerprints its own
     * inputs and result INSIDE the caller's timed region. Left uncorrected, a parent's `ms` is
     * its app time plus every descendant's hashing — which on this app's hottest paths is the
     * larger of the two, and would sort the report by "who has the most instrumented children"
     * rather than by cost. `overheadMs` is monotonic, so the delta across the call is exactly the
     * probe time to remove. */
    const o0 = overheadMs;
    const t0 = performance.now();
    let out;
    try {
      out = kind === "memo" ? fn() : fn.apply(thisArg, args);
    } finally {
      const dt = Math.max(0, performance.now() - t0 - (overheadMs - o0));
      stack.pop();
      s.ms += dt;
      // Inclusive time charged to the caller as CHILD time, so `selfMs` below is honest for a
      // wrapper that mostly calls other wrapped functions.
      if (stack.length) stack[stack.length - 1].childMs += dt;
    }

    if (inHash != null) {
      const o1 = performance.now();
      const r = structuralHash(out);
      s.inputs.push(inHash);
      s.results.push(r.hash);
      s.truncated = s.truncated || r.truncated;
      overheadMs += performance.now() - o1;
    }
    return out;
  };

  return {
    version: 1,
    run,
    /** A render reached this memo site (the factory may or may not have run). `renders` vs
     *  `calls` is what separates "React re-rendered" from "the memo actually recomputed". */
    render(id, kind, file, line, col, name) { if (recording) site(id, kind, file, line, col, name).renders++; },
    begin(name) { reset(name); recording = true; },
    end() { recording = false; return this.report(); },
    report() {
      return {
        label,
        overheadMs: +overheadMs.toFixed(2),
        sites: [...sites.values()]
          .filter((s) => s.calls > 0 || s.renders > 0)
          .map((s) => ({
            id: s.id, kind: s.kind, file: s.file, line: s.line, col: s.col, name: s.name,
            calls: s.calls, timedCalls: s.timedCalls, renders: s.renders,
            ms: +s.ms.toFixed(3), selfMs: +Math.max(0, s.ms - s.childMs).toFixed(3),
            inputs: s.inputs.slice(), results: s.results.slice(), truncated: s.truncated,
          })),
      };
    },
  };
}

const g = typeof globalThis !== "undefined" ? globalThis : window;
if (!g.__VPROBE__) g.__VPROBE__ = makeProbe();

export default g.__VPROBE__;
