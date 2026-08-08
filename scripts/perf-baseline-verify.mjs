#!/usr/bin/env node
/* perf-baseline-verify — B266085. Does a recorded baseline reproduce from its own commit?
 *
 * THE QUESTION THIS ANSWERS, AND WHY IT NEEDED AN INSTRUMENT. B1178 was filed on 2026-07-30
 * with a clean-clone build of `main` measuring +13.9 KB / +22.4 KB / +16.9 KB against the
 * numbers in `ui-audit/perf-budgets.json`, and the honest note that nobody yet knew whether
 * that was a build-environment problem or real unattributed bytes. Nine days later nobody
 * knew, because answering it meant checking out four commits by hand and building each one —
 * cheap, but only if somebody thinks to do it. Five branches shipped in the meantime, each
 * re-recording a slice of the drift as though it were its own cost.
 *
 * So the hand test is now a script. For every banded bundle metric it takes the LATEST
 * `ratchetLog` entry, checks that entry's own `commit` out into a throwaway worktree, builds
 * it, and asserts the recorded `to` value is exactly what that tree produces.
 *
 * IT COUNTS BYTES. Not a duration, not a ratio, not a heuristic: a recorded integer against a
 * measured integer, and it reports the difference in bytes. Deliberate — this repo has been
 * bitten four times in two days by guards that measured how long something took instead of
 * how many times it happened, and a byte count cannot be quietly reinterpreted.
 *
 * IT FAILS ON ITS OWN DEFECT. Three separate NOT-OBSERVING exits, because a verifier that
 * cannot see anything must never report success:
 *   • a metric whose latest entry carries NO `commit` cannot be checked → NOT OBSERVING.
 *     (All four entries predating B266083 are in exactly this state, and that is the point:
 *     the tool says so out loud rather than skipping them into a green run.)
 *   • a commit that is not in this clone, or does not build → NOT OBSERVING, never "pass".
 *   • zero metrics actually verified → exit 1 with NOT OBSERVING, so a run that checked
 *     nothing can never be mistaken for a run that checked everything and found it clean.
 *
 *   node scripts/perf-baseline-verify.mjs             # verify every banded metric
 *   node scripts/perf-baseline-verify.mjs --metric bundle.totalJsBytes
 *   node scripts/perf-baseline-verify.mjs --json
 *
 * NOT wired into the required `build` check, deliberately and with the reason stated: it costs
 * one full production build per distinct commit, which would multiply every PR's CI time for a
 * property that can only change when a baseline is written. It is a `workflow_dispatch` job and
 * a pre-ratchet sanity check. The CHEAP half of the same guarantee — that every new entry
 * carries a commit and a sourceHash at all — is asserted for free in
 * `test/perfBudgetPolicy.test.js`, which does run on every build.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadBuild, measureBundle, kb, ROOT } from "../ui-audit/lib/bundleMetrics.mjs";
import { isBanded, METRIC_KEYS } from "../ui-audit/lib/perfBudgetPolicy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUDGETS = join(HERE, "..", "ui-audit", "perf-budgets.json");
const argOf = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const JSON_OUT = process.argv.includes("--json");
const ONLY = argOf("--metric");

const git = (args, opts = {}) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();

const budgets = JSON.parse(readFileSync(BUDGETS, "utf8"));
const bundle = budgets.bundle;
const entries = bundle.ratchetLog?.entries || [];

/** The metric key a measured build reports, for each budget path. */
const readMetric = (measured, key) => ({
  siteRouteJsBytes: measured.routes.site?.bytes ?? null,
  notesRouteJsBytes: measured.routes.notes?.bytes ?? null,
  totalJsBytes: measured.totalJsBytes,
  largestChunkBytes: measured.largest?.bytes ?? null,
}[key] ?? null);

const targets = (ONLY ? [ONLY.replace(/^bundle\./, "")] : METRIC_KEYS(bundle))
  .filter((k) => isBanded(bundle[k]))
  .map((k) => {
    const path = `bundle.${k}`;
    const latest = [...entries].reverse().find((e) => e.metric === path) || null;
    return { key: k, path, spec: bundle[k], latest };
  });

if (!targets.length) {
  console.error("✗ no banded bundle metrics found in perf-budgets.json — nothing to verify.");
  process.exit(1);
}

/* Group by commit: four metrics recorded at one commit cost ONE build, not four. */
const byCommit = new Map();
const results = [];
for (const t of targets) {
  if (!t.latest) {
    results.push({ ...pick(t), verdict: "NOT-OBSERVING", why: "no ratchetLog entry for this metric — its baseline has no recorded provenance at all" });
    continue;
  }
  if (!t.latest.commit) {
    results.push({ ...pick(t), verdict: "NOT-OBSERVING", why: `its latest entry (${t.latest.item}, ${t.latest.date}) records no \`commit\` — written before B266083 made the ratchet record one, so there is no tree to rebuild` });
    continue;
  }
  if (!byCommit.has(t.latest.commit)) byCommit.set(t.latest.commit, []);
  byCommit.get(t.latest.commit).push(t);
}

function pick(t) {
  return { metric: t.path, recorded: t.spec.baseline, item: t.latest?.item ?? null, date: t.latest?.date ?? null, commit: t.latest?.commit ?? null };
}

for (const [commit, group] of byCommit) {
  let short = commit.slice(0, 8);
  let measured = null;
  let why = null;
  const work = mkdtempSync(join(tmpdir(), "planyr-baseline-"));
  const tree = join(work, "tree");
  try {
    try {
      git(["worktree", "add", "--detach", tree, commit]);
    } catch (e) {
      why = `commit ${short} is not in this clone (${e.message.split("\n")[0].slice(0, 120)}) — a shallow clone cannot verify a baseline`;
    }
    if (!why) {
      try { symlinkSync(join(ROOT, "node_modules"), join(tree, "node_modules"), "dir"); }
      catch (e) { why = `could not share node_modules with the ${short} worktree (${e.message.slice(0, 120)})`; }
    }
    if (!why) {
      const dist = join(tree, "dist-baseline-verify");
      try {
        execFileSync("npx", ["vite", "build", "--outDir", dist], { cwd: tree, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
      } catch (e) {
        why = `commit ${short} did not build (${String(e.stderr || e.message).split("\n").slice(-2).join(" ").slice(0, 200)})`;
      }
      if (!why) {
        const build = loadBuild(dist);
        if (!build) why = `the ${short} build produced no manifest`;
        else measured = measureBundle(build);
      }
    }
  } finally {
    try { git(["worktree", "remove", "--force", tree]); } catch { /* the temp dir goes either way */ }
    rmSync(work, { recursive: true, force: true });
  }

  for (const t of group) {
    if (why) { results.push({ ...pick(t), verdict: "NOT-OBSERVING", why }); continue; }
    const got = readMetric(measured, t.key);
    if (typeof got !== "number") {
      results.push({ ...pick(t), verdict: "NOT-OBSERVING", why: `commit ${short} built, but this metric could not be measured from it (a route may have been renamed since)` });
      continue;
    }
    const delta = got - t.spec.baseline;
    results.push({ ...pick(t), measured: got, delta, verdict: delta === 0 ? "REPRODUCES" : "DRIFTED" });
  }
}

const reproduces = results.filter((r) => r.verdict === "REPRODUCES");
const drifted = results.filter((r) => r.verdict === "DRIFTED");
const blind = results.filter((r) => r.verdict === "NOT-OBSERVING");

if (JSON_OUT) {
  console.log(JSON.stringify({ results, reproduces: reproduces.length, drifted: drifted.length, notObserving: blind.length }, null, 2));
} else {
  console.log("Baseline reproducibility (B266085) — does each recorded number rebuild from its own commit?\n");
  for (const r of results) {
    if (r.verdict === "REPRODUCES") {
      console.log(`  ✓ ${r.metric.padEnd(28)} @${r.commit.slice(0, 8)}  ${r.measured} = recorded ${r.recorded}  (exact)`);
    } else if (r.verdict === "DRIFTED") {
      console.log(`  ✗ ${r.metric.padEnd(28)} @${r.commit.slice(0, 8)}  ${r.measured} vs recorded ${r.recorded}  → ${r.delta > 0 ? "+" : ""}${r.delta} bytes (${kb(Math.abs(r.delta))})`);
      console.log("      The recorded baseline is not what its own commit builds. That is B1178's defect at its");
      console.log("      source: the number was measured from a dist/ that did not come from this tree. Do NOT");
      console.log("      re-record it to make this green — find out which tree it came from, and fix the recording.");
    } else {
      console.log(`  ⓘ ${r.metric.padEnd(28)} NOT OBSERVING — ${r.why}`);
    }
  }
  console.log();
  console.log(`  ${reproduces.length} reproduce · ${drifted.length} drifted · ${blind.length} not observable`);
  if (!reproduces.length && !drifted.length) {
    console.log("\n✗ NOT OBSERVING: this run verified nothing at all. A verifier that checked nothing must never");
    console.log("  report success — that is precisely how a guard rots green. Every metric's latest ratchetLog");
    console.log("  entry lacks a `commit`; the next `npm run perf:ratchet` records one (B266083).");
  } else if (drifted.length) {
    console.log(`\n✗ ${drifted.length} baseline(s) do not reproduce from their own commit.`);
  } else {
    console.log("\n✓ Every observable baseline reproduces from its own commit, to the byte.");
  }
}

process.exit(drifted.length || (!reproduces.length && !drifted.length) ? 1 : 0);
