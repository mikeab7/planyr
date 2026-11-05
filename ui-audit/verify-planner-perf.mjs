/* verify-planner-perf — the Site Planner speed round's GUARD (NEW-3, 2026-10-31). Runs ui-audit/profile-planner-perf.mjs (the owner's
 * Concept A on the real Chehaw ground, grading + contours + cut/fill + paper on, a production build) and judges it against
 * ui-audit/planner-perf-budget.json.
 *
 * TWO HALVES, because a shared CI runner cannot be trusted with a millisecond (ui-audit/perf-harness.mjs's header says why) but can
 * be trusted with a COUNT:
 *   --counts   (the required build check, .github/ci-gates.yml): unthrottled, one view, layout mode. Asserts the per-pointer-move
 *              rule as counts — a zoom step and a pan rebuild no surface and post no worker job, a pan commits React ≤ ~once per move,
 *              ten drag moves rebuild no surface and re-encode no picture (canvas toDataURL calls), a mode switch builds one surface.
 *   (default)  (`npm run perf:planner`, on demand, before shipping anything that touches render or grading): 4× CPU throttle, every
 *              view × both modes × all five phases. Asserts the timing budgets AND the counts, and reports the known-over budgets
 *              (open, longest task) against their ratchet.
 * VOID RULE (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): each half also runs the harness's KNOWN-SLOW arm (?perfMutant=1 — busy work on
 * every render during a pan or a drag + a picture re-encode per drag move). The mutant MUST fail this guard; if it passes, the
 * instrument cannot see per-pointer-move work and the run is VOID (exit 2), never green.
 *   node ui-audit/verify-planner-perf.mjs [--counts] [--json]          exit 0 pass · 1 fail · 2 void */
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, existsSync } from "node:fs";

const COUNTS_ONLY = process.argv.includes("--counts");
const B = JSON.parse(readFileSync(new URL("./planner-perf-budget.json", import.meta.url), "utf8"));
mkdirSync(".perf", { recursive: true });

function profile(extra, out) {
  const args = ["ui-audit/profile-planner-perf.mjs", `--out=${out}`, ...extra];
  const r = spawnSync(process.execPath, args, { stdio: ["ignore", "inherit", "inherit"], timeout: 30 * 60 * 1000 });
  if (!existsSync(out)) throw new Error(`profile-planner-perf produced no result (exit ${r.status})`);
  const res = JSON.parse(readFileSync(out, "utf8"));
  if (res.exitCode === 2) { console.error("VOID — the profiler's own known-good arm failed (see above)"); process.exit(2); }
  if (res.exitCode) throw new Error(`profile-planner-perf failed (exit ${res.exitCode})`);
  return res;
}

/* the verdict over one run's rows: [{ ok, name, detail }] */
export function judge(rows, { timing }) {
  const out = [];
  const add = (ok, name, detail) => out.push({ ok, name, detail });
  const C = B.counts;
  for (const r of rows) {
    const at = `${r.mode} ${r.view} ft ${r.phase}`;
    const jobs = Object.values(r.jobs || {}).reduce((a, b) => a + b, 0);
    if (r.phase === "zoom-in" || r.phase === "zoom-out") {
      add(r.surfaces <= C.zoom.surfaces && jobs <= C.zoom.jobs, `${at}: no surface rebuild, no worker job`, `surfaces ${r.surfaces}, jobs ${jobs}`);
      if (timing) add(r.wall != null && r.wall <= B.timing.zoomWallMs, `${at}: picture within ${B.timing.zoomWallMs} ms`, `${r.wall} ms`);
    }
    if (r.phase === "pan") {
      const cpm = r.commits / 20;
      add(r.surfaces <= C.pan.surfaces && jobs <= C.pan.jobs && r.dataUrls <= C.pan.dataUrls && cpm <= C.pan.commitsPerMove,
        `${at}: nothing rebuilt per move, ≤ ${C.pan.commitsPerMove} commit per move`, `surfaces ${r.surfaces}, jobs ${jobs}, picture re-encodes ${r.dataUrls}, ${cpm.toFixed(2)} commits/move`);
      if (timing) add(r.mainMs / 21 <= B.timing.panMainMsPerMove, `${at}: ≤ ${B.timing.panMainMsPerMove} ms of main-thread work per move`, `${(r.mainMs / 21).toFixed(1)} ms/move (${r.mainMs} ms over 20 moves + release)`);
    }
    if (r.phase === "move") {
      const d = r.duringMoves || {}, dj = Object.values(d.jobs || {}).reduce((a, b) => a + b, 0);
      add(d.surfaces <= C.moveDuring.surfaces && dj <= C.moveDuring.jobs && d.dataUrls <= C.moveDuring.dataUrls,
        `${at}: 10 drag moves rebuild nothing (before the release)`, `surfaces ${d.surfaces}, jobs ${dj}, picture re-encodes ${d.dataUrls}`);
    }
    if (r.phase === "mode") {
      add(r.surfaces <= C.mode.surfacesMax, `${at}: one surface build`, `surfaces ${r.surfaces}`);
      if (timing) add(r.wall != null && r.wall <= B.timing.modeWallMs, `${at}: picture within ${B.timing.modeWallMs} ms`, `${r.wall} ms`);
    }
    if (timing && r.phase === "open") {
      const k = B.knownOver.openWallMs;
      add(r.wall != null && r.wall <= k.ratchet, `${at}: open no worse than the ratchet (${k.ratchet} ms)`, `${r.wall} ms — KNOWN OVER the ${k.budget} ms budget by ${r.wall - k.budget} ms (${k.item})`);
    }
    if (timing) {
      const k = B.knownOver.longestTaskMs;
      add(r.longestTask <= k.ratchet, `${at}: longest task no worse than the ratchet (${k.ratchet} ms)`, `${r.longestTask} ms${r.longestTask > k.budget ? ` — KNOWN OVER the ${k.budget} ms budget (${k.item})` : ""}`);
    }
  }
  return out;
}

const print = (title, v) => { console.log(`\n${title}`); for (const x of v) console.log(`${x.ok ? "✓" : "✗"} ${x.name} — ${x.detail}`); };
try {
  const base = COUNTS_ONLY
    ? ["--throttle=1", "--views=125", "--modes=layout", "--phases=zoom,pan,move,mode"]
    : [`--throttle=${B.throttle}`];
  const real = profile(base, ".perf/planner-perf.json");
  const v = judge(real.rows, { timing: !COUNTS_ONLY });
  print(`PLANNER PERF (${COUNTS_ONLY ? "counts, unthrottled" : `${B.throttle}× CPU throttle`})`, v);
  // the known-slow arm must FAIL
  const mut = profile([...(COUNTS_ONLY ? ["--throttle=1"] : [`--throttle=${B.throttle}`]), "--views=125", "--modes=layout", "--phases=pan,move", "--mutant"], ".perf/planner-perf-mutant.json");
  const mv = judge(mut.rows, { timing: !COUNTS_ONLY });
  print("KNOWN-SLOW ARM (?perfMutant=1 — must FAIL)", mv);
  if (!mv.some((x) => !x.ok)) { console.error("\nVOID — the known-slow arm passed every check: this instrument cannot see per-pointer-move work"); process.exit(2); }
  const failed = v.filter((x) => !x.ok);
  if (failed.length) { console.error(`\n✗ ${failed.length} planner perf check(s) failed`); process.exit(1); }
  console.log(`\n✓ planner perf: ${v.length} checks pass; the known-slow arm failed ${mv.filter((x) => !x.ok).length} as it must`);
} catch (e) {
  console.error(e); process.exit(1);
}
