#!/usr/bin/env node
/* perf-base-stats — build the BASE ref and emit its bundle-attribution snapshot (NEW-3).
 *
 * WHY. Until now a failing budget run printed one sentence — "2286.3 KB exceeds 2265.6 KB by
 * 20.7 KB" — and stopped. A 20 KB feature and a 20 KB dependency bump produce the identical
 * line, so every red run cost somebody a local checkout, a local build and a manual diff
 * before they could even decide whether to optimize or to ratchet. The head build alone can
 * never answer that: "which modules grew" is a comparison, and a comparison needs two builds.
 *
 * WHAT IT DOES. Resolves the base ref (the PR's base branch, or HEAD^ on a push to main),
 * checks it out into a throwaway git worktree, symlinks node_modules so nothing is
 * re-installed, builds it, and writes the same snapshot shape the head build emits. The audit
 * then diffs the two with --compare.
 *
 * DELIBERATELY NEVER FATAL. This is diagnosis, not a gate. A shallow clone with no base
 * commit, a base that predates the stats plugin, a base that does not build — each prints its
 * reason and exits 0, and the budget check itself is completely unaffected. A diagnostic that
 * can turn a build red is a diagnostic people delete.
 *
 *   node scripts/perf-base-stats.mjs --out .perf/base-stats.json [--ref origin/main]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, symlinkSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { loadBuild, measureBundle, attributeBytes, statsSnapshot, ROOT } from "../ui-audit/lib/bundleMetrics.mjs";
// The Univer spike (B2557488) made the production build need ~3.5 GB of heap; Node's default limit is ~2 GB. `npm run build` raises it
// in package.json — every script that runs `vite build` itself must do the same or it dies with "heap out of memory".
const BUILD_ENV = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --max-old-space-size=4096`.trim() };

const argOf = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const OUT = argOf("--out") || join(ROOT, ".perf", "base-stats.json");

const git = (args, opts = {}) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const bail = (why) => { console.log(`ⓘ base-ref comparison unavailable: ${why}`); console.log("  (The performance budget gate itself is unaffected — this only affects the diagnosis.)"); process.exit(0); };

// Batch C (2026-11-23): in CI the checkout is shallow, so the base ref comes in one of two cheaper ways instead of a full clone —
//  - PERF_BASE_STATS_HIT=true: build.yml restored the stats main saved under that base commit's sha (the head-stats main's own
//    build wrote), so there is nothing to build; the file is already at --out.
//  - PERF_BASE_SHA=<sha>: a cache miss; build.yml fetched just that one commit (depth 1) and names it here.
// Neither is set locally or in the old full-history checkout, so the merge-base path below is unchanged.
const CACHED = join(ROOT, ".perf", "cached-stats.json");
if (process.env.PERF_BASE_STATS_HIT === "true" && existsSync(CACHED)) {
  mkdirSync(dirname(OUT), { recursive: true });
  copyFileSync(CACHED, OUT);
  console.log(`✓ base stats restored from the cache (saved by main's own build of that commit) → ${OUT}`);
  process.exit(0);
}

let baseSha;
try {
  const wanted = /^[0-9a-f]{7,40}$/i.test(process.env.PERF_BASE_SHA || "") && !/^0+$/.test(process.env.PERF_BASE_SHA) ? process.env.PERF_BASE_SHA : null;
  if (wanted) {
    // A shallow checkout does not hold the base commit — fetch exactly that one (depth 1), never the history.
    try { git(["rev-parse", "--verify", `${wanted}^{commit}`]); } catch {
      try { git(["fetch", "--no-tags", "--depth=1", "origin", wanted]); } catch (e) { bail(`could not fetch the base commit ${wanted.slice(0, 8)} (${String(e.message).split("\n")[0]})`); }
    }
    baseSha = git(["rev-parse", "--verify", `${wanted}^{commit}`]);
  } else {
  const explicit = argOf("--ref");
  const baseRef = explicit || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main");
  const head = git(["rev-parse", "HEAD"]);
  let candidate;
  try {
    candidate = git(["merge-base", baseRef, "HEAD"]);
  } catch {
    bail(`could not resolve a merge base with ${baseRef} (a shallow clone with fetch-depth 1 has no history to compare against)`);
  }
  // A push to main: HEAD is its own merge base, so the honest comparison is the commit before it.
  baseSha = candidate === head ? git(["rev-parse", "HEAD^"]) : candidate;
  }
} catch (e) {
  bail(`git could not resolve the base ref (${e.message})`);
}

const work = mkdtempSync(join(tmpdir(), "planyr-base-"));
const tree = join(work, "tree");
let ok = false;
try {
  try {
    git(["worktree", "add", "--detach", tree, baseSha]);
  } catch (e) {
    bail(`could not create a worktree at ${baseSha.slice(0, 8)} (${e.message.split("\n")[0]})`);
  }

  // Share the installed dependencies rather than re-installing them. Vite resolves plugins
  // from the build cwd, and a symlinked node_modules is resolvable exactly like a real one.
  try {
    // A worktree of a commit that TRACKS a node_modules entry (it happened once: a stray symlink merged to main)
    // already holds one — clear it first or the symlink below fails EEXIST and the whole comparison is lost.
    rmSync(join(tree, "node_modules"), { recursive: true, force: true });
    symlinkSync(join(ROOT, "node_modules"), join(tree, "node_modules"), "dir");
  } catch (e) {
    bail(`could not share node_modules with the base worktree (${e.message})`);
  }

  const dist = join(tree, "dist-base");
  try {
    execFileSync("npx", ["vite", "build", "--outDir", dist], { cwd: tree, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", env: BUILD_ENV });
  } catch (e) {
    bail(`the base ref ${baseSha.slice(0, 8)} did not build (${String(e.stderr || e.message).split("\n").slice(-3).join(" ").slice(0, 240)})`);
  }

  const build = loadBuild(dist);
  if (!build) bail(`the base build produced no manifest (base ${baseSha.slice(0, 8)} may predate build.manifest)`);
  const measured = measureBundle(build);
  const attribution = attributeBytes(measured);
  const snapshot = statsSnapshot(measured, attribution, { ref: baseSha });

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(snapshot, null, 2));
  ok = true;
  console.log(`✓ base stats written for ${baseSha.slice(0, 8)} → ${OUT}`);
  if (!attribution) {
    console.log("  ⓘ that base predates the chunk-module stats plugin, so the diff will compare");
    console.log("    headline metrics only — no per-module attribution against it.");
  }
} finally {
  try { git(["worktree", "remove", "--force", tree]); } catch { /* best effort */ }
  try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
  if (!ok && existsSync(OUT)) { try { rmSync(OUT); } catch { /* best effort */ } }
}
