/* NEW-1 (Silvestri zoom freeze) — PERF GUARD: a planner zoom step must not get slower as the device holds more
 * saved plans.
 *
 * THE DEFECT. Measured on the owner's Silvestri plan (4× CPU throttle, dpr 2.125): per-zoom-step main-thread
 * block was ~300 ms with ONE plan on the device, ~1,060 ms with 47 and ~1,820 ms with 93 (worst single task
 * 409 → 652 ms); with a 4 MB store ~3,190 ms, worst task 1,263 ms. Cause: every layer-status report re-rendered
 * App → the hidden map finder → per-plan acreage (O(n²) overlap scan + clipper union) and per-render
 * `JSON.parse` of the whole plan store (names, groupForPlan). All three are cached/gated now; the cost is flat.
 *
 * THE GUARD. Runs ui-audit/diagnose-silvestri-zoom-step.mjs on the real Silvestri fixture padded to 0 and to
 * N MB with COPIES OF THE OTHER COMMITTED REAL PLANS (nothing synthesized), takes the better of two reps per arm
 * (noise only ever adds), and fails when
 *   (a) the padded store's mean block per step exceeds RATIO × the unpadded store's, or
 *   (b) the padded store's worst single task exceeds WORST_MS.
 * Mutation-checked against the unfixed build (d6107bb): ratio ≈ 6.4, worst ≈ 714 ms → both RED. On the fix:
 * ratio ≈ 1.1–1.4, worst ≈ 140–180 ms → green.
 *
 * Run:  npm run build && npx vite preview --port 4192   (separate shell)
 *       BASE_URL=http://localhost:4192/ node ui-audit/verify-zoom-store-scaling.mjs [--mb 2] [--ratio 2.0] [--worst 300]
 * ⛔ FOREGROUND-OR-VOID is enforced inside the harness it drives (assertMeasurable before any measurement).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const MB = +arg("--mb", 2), RATIO = +arg("--ratio", 2.0), WORST = +arg("--worst", 300), CPU = arg("--cpu", "4");
const HARNESS = fileURLToPath(new URL("./diagnose-silvestri-zoom-step.mjs", import.meta.url));

function run(storeMb) {
  const out = execFileSync("node", [HARNESS, "--cpu", CPU, "--store-mb", String(storeMb)], { encoding: "utf8", env: process.env, maxBuffer: 64 << 20 });
  const m = out.match(/SUMMARY steps_moved=(\d+)\/(\d+) mean_block_per_step_ms=(\d+) worst_task_ms=(\d+)/);
  if (!m) throw new Error("harness printed no SUMMARY line:\n" + out.slice(-800));
  if (+m[1] < +m[2]) throw new Error(`only ${m[1]}/${m[2]} zoom steps moved the view — the run is void`);
  return { mean: +m[3], worst: +m[4] };
}
const best = (mb) => { const a = [run(mb), run(mb)]; return { mean: Math.min(...a.map((x) => x.mean)), worst: Math.min(...a.map((x) => x.worst)) }; };

const lo = best(0), hi = best(MB);
const ratio = hi.mean / lo.mean;
console.log(`unpadded store : mean ${lo.mean} ms/step · worst task ${lo.worst} ms`);
console.log(`${MB} MB store     : mean ${hi.mean} ms/step · worst task ${hi.worst} ms`);
console.log(`scaling ratio  : ${ratio.toFixed(2)}× (budget ${RATIO}×) · worst-task budget ${WORST} ms`);
// known-good arm: the unpadded run is the control — a harness that cannot produce a plausible number there is void.
if (!(lo.mean > 20 && lo.mean < 5000)) { console.error(`VOID: unpadded control reads ${lo.mean} ms/step`); process.exit(2); }
let bad = 0;
if (ratio > RATIO) { console.error(`FAIL: a zoom step is ${ratio.toFixed(2)}× slower with ${MB} MB of saved plans (budget ${RATIO}×)`); bad++; }
if (hi.worst > WORST) { console.error(`FAIL: worst task ${hi.worst} ms with ${MB} MB of saved plans (budget ${WORST} ms)`); bad++; }
process.exit(bad ? 1 : 0);
