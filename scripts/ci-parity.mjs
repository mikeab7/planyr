#!/usr/bin/env node
/*
 * ci-parity.mjs — ONE command that runs every gate the required `build` status check runs, in the
 * same order, in an environment that matches CI closely enough to trust the verdict (owner-approved
 * 2026-09-02, after the third failure of this exact class in a week).
 *
 * THE PROBLEM THIS FIXES, stated as the pattern rather than the three instances that forced it:
 * every recent CI failure came from someone APPROXIMATING what CI does instead of RUNNING what CI
 * does, and then failing on the gap between the two rather than on anything real.
 *   - B927104 — build.yml set VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY on the head Build step only,
 *     so the base-ref snapshot built without them while the head build carried them (Vite inlines
 *     both as string literals). Every local build had the identical shape of difference, silently.
 *   - The 2026-08-31 bundle night — a local run measured 689.9 KB and called it green while CI
 *     measured over, because the local run built a differently-configured artifact AND compared it
 *     against the wrong base ref. PRs #1262 and #1263 were reverted.
 *   - PR #1323 — its own test plan needed roughly FIFTEEN hand-run commands, several only correct
 *     once re-measured against the exact pinned CI Chromium revision and a Supabase-configured
 *     build, to prove one change safe. Nobody reproduces fifteen commands reliably by hand, so
 *     everybody approximates, so this keeps happening.
 *
 * THE FIX. This script does not hold a second, hand-maintained copy of the gate list — it READS
 * `.github/ci-gates.yml` at run time (via `ui-audit/lib/workflowContract.mjs`'s `jobSteps()` — the
 * same parser used on `build.yml` itself) and runs exactly the steps that file declares, in that
 * order, with that file's own `env:` blocks. `.github/workflows/build.yml` in turn calls THIS
 * script for every gate (see that file's own header for why the gates live in a sibling file
 * rather than in build.yml itself — GitHub can't dynamically expand a step list from another file,
 * so the only way for "build.yml calls the script" and "one list, unable to drift" to both be true
 * is for the list to live somewhere ONLY the script reads). Either file changing shape into
 * something this parser doesn't understand makes the script REFUSE rather than run a stale or
 * guessed list (LOUD-FAILURE) — see `ui-audit/lib/workflowContract.mjs`'s `jobSteps()`.
 *
 * ⛔ THE MOST IMPORTANT PART: SECRETS. Two gates carry `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
 * from repo secrets that are normally absent on a laptop. Running the build un-configured is NOT
 * the same measurement as CI's — see ui-audit/visual-regression.mjs's header (B1026272) and
 * ui-audit/lib/ciGates.mjs's own header. So when a real secret is missing, this script substitutes
 * the exact dummy values visual-regression.mjs's USAGE block already documents (matching CI's
 * SHAPE — truthy env — never its real value) and prints a named, LOUD banner about it before
 * running anything and again in the final summary. It never substitutes silently.
 *
 * USAGE:
 *   npm run ci-parity                     run every gate, in order, stop at the first failure
 *   npm run ci-parity -- --list           print the parsed gate/infra list and exit; runs nothing
 *   npm run ci-parity -- --skip-install   skip `npm ci` — LOUD warning, deliberately deviates from CI
 *   npm run ci-parity -- --json           print the final summary as JSON (in addition to the human report)
 *   npm run ci-parity -- --docs-only      run only ui-audit/lib/ciGates.mjs's DOCS_ONLY_GATE_NAMES subset
 *                                         — what build.yml runs for a pull request that changes only
 *                                         Markdown (its "Detect docs-only change" step sets CI_DOCS_ONLY=true,
 *                                         which this flag mirrors locally). Skips `npm ci` too: every gate
 *                                         in that subset runs on Node built-ins + `git` alone.
 *
 * WHAT THIS DOES NOT COVER, AND WHY (all four are `uses:`-only steps in build.yml — see
 * `ui-audit/lib/ciGates.mjs`'s `KNOWN_INFRA_USES`): actions/checkout (you already have a checkout —
 * this script fetches origin/main instead, which is the part the gates actually need),
 * actions/setup-node (installs a pinned Node — this script checks your version against the same pin
 * and warns rather than silently running on a different one), actions/cache (a CI-only speed
 * optimization for the Playwright browser download, no correctness effect), actions/upload-artifact
 * (uploads .perf/visual-regression/ as a CI artifact on failure — the files are already on your disk).
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { jobSteps } from "../ui-audit/lib/workflowContract.mjs";
import { splitSteps, classifyInfra, resolveSecretEnv, resolveStepEnv, selectDocsOnlyGates } from "../ui-audit/lib/ciGates.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const WORKFLOW = join(REPO, ".github", "workflows", "build.yml");
const GATES_MANIFEST = join(REPO, ".github", "ci-gates.yml");
const JOB_ID = "build";
const GATE_TIMEOUT_MS = 20 * 60 * 1000; // safety net only — no gate this repo runs is expected to near it

// build.yml's "Detect docs-only change" step is a second `run:` step alongside the "npm run
// ci-parity" delegator — necessary because the decision needs GitHub Actions' own event context
// (github.event_name, the PR's base/head SHAs), which has no local equivalent for this script to
// re-run. It sets CI_DOCS_ONLY as an env on the delegator step rather than baking a conditional
// into that step's `run:` text, specifically so the delegator stays the exact literal string
// "npm run ci-parity" that loadPlan()'s stray-step check (below) and test/ciGates.test.js both
// assert on. Named here, once, so that check can allow it without also blinding itself to a
// genuinely new stray step.
const KNOWN_NON_GATE_RUN_STEPS = new Set(["Detect docs-only change (a pull_request whose diff is Markdown only)"]);

const argv = process.argv.slice(2);
const FLAGS = {
  list: argv.includes("--list"),
  json: argv.includes("--json"),
  skipInstall: argv.includes("--skip-install"),
  docsOnly: argv.includes("--docs-only") || process.env.CI_DOCS_ONLY === "true",
};

const say = (s = "") => process.stdout.write(s + "\n");
const warn = (s) => process.stderr.write(`⚠ ${s}\n`);

function preflightNode(infra) {
  const setupNode = infra.find((s) => classifyInfra(s).action === "actions/setup-node");
  const pinned = setupNode?.with?.["node-version"];
  if (!pinned) return { ok: true, note: "no node-version pin found in build.yml — nothing to compare against." };
  const major = String(pinned).split(".")[0];
  const runningMajor = process.versions.node.split(".")[0];
  if (major === runningMajor) return { ok: true, note: `Node ${process.versions.node} matches CI's pin (${pinned}).` };
  return {
    ok: false,
    note: `⚠ RUNNING Node ${process.versions.node}, CI pins ${pinned}. Not stopping — but a result that ` +
      `depends on Node's own behavior (rare in this codebase) is not proven by this run. Install Node ${major} ` +
      `to close this gap; this script does not do it for you.`,
  };
}

function preflightGit() {
  const notes = [];
  try {
    const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: REPO, encoding: "utf8" }).trim();
    if (shallow === "true") notes.push("this checkout is SHALLOW — attempting `git fetch --unshallow` (best effort).");
    if (shallow === "true") {
      const r = spawnSync("git", ["fetch", "--unshallow", "origin"], { cwd: REPO, stdio: "pipe" });
      notes.push(r.status === 0 ? "unshallow fetch succeeded." : "unshallow fetch failed — the mint gate / base-ref snapshot will report their own \"unavailable\" honestly rather than guess.");
    }
  } catch (e) { notes.push(`could not check shallow-ness (${e.message}).`); }
  try {
    const r = spawnSync("git", ["fetch", "--no-tags", "--quiet", "origin", "main"], { cwd: REPO, stdio: "pipe" });
    notes.push(r.status === 0 ? "origin/main fetched — the mint gate and the base-ref bundle snapshot can resolve a merge base exactly as CI's checkout (fetch-depth: 0) lets them." : `\`git fetch origin main\` failed (exit ${r.status}) — those two gates will report their own honest "unavailable" rather than a guessed base.`);
  } catch (e) { notes.push(`could not fetch origin/main (${e.message}).`); }
  return notes;
}

function runGate(step, env, tmpDir, index, total) {
  const label = `[${index}/${total}] ${step.name}`;
  say(`\n▶ ${label}`);
  const file = join(tmpDir, `gate-${index}.sh`);
  writeFileSync(file, step.run + "\n");
  const started = Date.now();
  // Same invocation shape GitHub Actions uses for a bash `run:` step: a script FILE (not a `-c`
  // string, which would mis-quote a script that itself uses single quotes), `--noprofile --norc`
  // (no personal shell config bleeding in) and `-eo pipefail` (stop on the first failing command,
  // including inside a pipeline).
  const res = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", file], {
    cwd: REPO, env, stdio: "inherit", timeout: GATE_TIMEOUT_MS,
  });
  const ms = Date.now() - started;
  if (res.error) return { name: step.name, status: "fail", ms, note: res.error.message };
  if (res.signal === "SIGTERM" && res.status == null) return { name: step.name, status: "fail", ms, note: `timed out after ${GATE_TIMEOUT_MS / 1000}s` };
  return { name: step.name, status: res.status === 0 ? "pass" : "fail", ms, code: res.status };
}

function stopPreviewServer() {
  // Best-effort — CI just throws the runner away; a dev machine needs the background `vite
  // preview` this script's own gates started (via build.yml's own `&`-backgrounded step) cleaned up.
  try { spawnSync("pkill", ["-f", "vite preview --port 4173 --strictPort"], { stdio: "ignore" }); } catch { /* best effort */ }
}

/** Read+parse both files, or REFUSE (LOUD-FAILURE) — never run a stale/guessed list. */
function loadPlan() {
  const refuse = (file, unparsed) => {
    process.stderr.write(
      `\n⛔ ci-parity REFUSES TO RUN — ${file} doesn't parse the way this script understands it:\n` +
        `   ${unparsed.join("\n   ")}\n\n` +
        `This is deliberate (LOUD-FAILURE): running a stale or guessed gate list on a shape change ` +
        `would be exactly the bug this tool exists to prevent. Update ` +
        `ui-audit/lib/workflowContract.mjs's jobSteps() to understand the new shape.\n\n`,
    );
    return null;
  };

  const workflow = jobSteps(readFileSync(WORKFLOW, "utf8"), JOB_ID);
  if (!workflow.ok) return refuse(".github/workflows/build.yml", workflow.unparsed);
  // build.yml keeps only the steps that genuinely can't live in the script (`uses:` — CI-runner
  // plumbing) plus exactly ONE step that calls this script. Any OTHER `run:` step in build.yml
  // would mean a gate snuck back in there instead of into the manifest — the exact drift this tool
  // exists to prevent — so that's a loud warning, not a silent extra gate to run (running it would
  // also risk recursing into `npm run ci-parity` itself for the delegator step).
  const { gates: workflowRunSteps, infra } = splitSteps(workflow.steps);
  const strayRunSteps = workflowRunSteps.filter(
    (s) => s.run.trim() !== "npm run ci-parity" && !KNOWN_NON_GATE_RUN_STEPS.has(s.name),
  );
  if (strayRunSteps.length) {
    warn(`build.yml has ${strayRunSteps.length} run: step(s) besides the "npm run ci-parity" delegator — ` +
      `${strayRunSteps.map((s) => `"${s.name}"`).join(", ")}. These are NOT being run by this script ` +
      `(they'd belong in .github/ci-gates.yml instead) — build.yml and the gate list may have drifted apart.`);
  }

  const manifest = jobSteps(readFileSync(GATES_MANIFEST, "utf8"), JOB_ID);
  if (!manifest.ok) return refuse(".github/ci-gates.yml", manifest.unparsed);
  const { gates, infra: manifestInfra } = splitSteps(manifest.steps);
  if (manifestInfra.length) {
    return refuse(".github/ci-gates.yml", [
      `contains a uses: step (${manifestInfra.map((s) => s.name).join(", ")}) — GitHub never reads ` +
      `this file, so a marketplace action here can never run. Put it in build.yml instead.`,
    ]);
  }

  return { gates, infra };
}

function main() {
  const plan = loadPlan();
  if (!plan) { process.exitCode = 2; return; }
  let { gates, infra } = plan;
  const totalGateCount = gates.length;

  if (FLAGS.docsOnly) {
    const sel = selectDocsOnlyGates(gates);
    if (!sel.ok) {
      process.stderr.write(
        `\n⛔ ci-parity REFUSES --docs-only — ui-audit/lib/ciGates.mjs's DOCS_ONLY_GATE_NAMES names ` +
          `${sel.missing.length} gate(s) .github/ci-gates.yml no longer has:\n` +
          `   ${sel.missing.map((n) => `"${n}"`).join("\n   ")}\n` +
          `   A gate was renamed or removed in the manifest without updating the docs-only allowlist ` +
          `to match — fix DOCS_ONLY_GATE_NAMES rather than skip this.\n\n`,
      );
      process.exitCode = 2;
      return;
    }
    gates = sel.selected;
  }

  if (FLAGS.list) {
    say(`Gates (${gates.length}${FLAGS.docsOnly ? ` of ${totalGateCount}, docs-only mode` : ""}), in order, read from .github/ci-gates.yml:`);
    gates.forEach((g, i) => say(`  ${i + 1}. ${g.name}`));
    say(`\nInfra steps NOT covered (${infra.length}) — why: see the header of this file / ui-audit/lib/ciGates.mjs`);
    for (const s of infra) { const c = classifyInfra(s); say(`  - ${s.name} (${c.action}): ${c.reason}`); }
    return;
  }

  if (FLAGS.docsOnly) {
    say(`ci-parity — DOCS-ONLY MODE: running ${gates.length} of ${totalGateCount} gates (the ` +
      `ui-audit/lib/ciGates.mjs DOCS_ONLY_GATE_NAMES subset). No node_modules needed — "Install ` +
      `dependencies" isn't in that subset, so npm ci never runs.\n`);
  } else {
    say(`ci-parity — running the ${gates.length} gates .github/ci-gates.yml declares, in order.\n`);
  }

  // ---- preflight, all reported before a single gate runs -------------------------------------
  const nodeCheck = preflightNode(infra);
  say(`Node: ${nodeCheck.note}`);
  const gitNotes = preflightGit();
  for (const n of gitNotes) say(`Git: ${n}`);

  const { resolved: secretMap, degraded } = resolveSecretEnv(gates, process.env);
  if (degraded.length) {
    warn("SECRETS DEGRADED — this run is NOT identical to CI's for the gate(s) below:");
    for (const d of degraded) warn(`  ${d.name}: ${d.note}`);
  } else if (secretMap.size) {
    say(`Secrets: ${[...secretMap.keys()].join(", ")} present in the environment — using the real values, same as CI.`);
  }

  const infraNotes = infra.map((s) => { const c = classifyInfra(s); return `${s.name}: ${c.reason}${c.known ? "" : "  ⚠ UNRECOGNIZED"}`; });
  say(`\nNot covered (CI-runner plumbing, not a gate — ${infra.length}):`);
  for (const n of infraNotes) say(`  - ${n}`);

  // ---- run the gates ---------------------------------------------------------------------------
  const tmpDir = mkdtempSync(join(tmpdir(), "planyr-ci-parity-"));
  const results = [];
  let stoppedEarly = false;
  try {
    for (let i = 0; i < gates.length; i++) {
      const step = gates[i];
      if (FLAGS.skipInstall && step.run.trim() === "npm ci") {
        warn(`SKIPPING "${step.name}" (--skip-install). DEVIATES FROM CI: node_modules may not match package-lock.json.`);
        results.push({ name: step.name, status: "skipped", ms: 0, note: "--skip-install" });
        continue;
      }
      const { env: stepEnv, unsupported } = resolveStepEnv(step, secretMap);
      if (unsupported.length) {
        process.stderr.write(
          `\n⛔ ci-parity REFUSES "${step.name}" — its env: carries an expression this script doesn't ` +
            `know how to resolve: ${unsupported.map((u) => `${u.key}: ${u.value}`).join(", ")}\n` +
            `   (Only \${{ secrets.NAME }} is understood. Teach ui-audit/lib/ciGates.mjs the new shape ` +
            `rather than skipping this gate.)\n\n`,
        );
        results.push({ name: step.name, status: "fail", ms: 0, note: "unsupported env expression" });
        stoppedEarly = true;
        break;
      }
      const env = { ...process.env, ...stepEnv };
      const r = runGate(step, env, tmpDir, i + 1, gates.length);
      results.push(r);
      if (r.status === "fail") { stoppedEarly = true; break; }
    }
  } finally {
    stopPreviewServer();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  // ---- summary -----------------------------------------------------------------------------
  say("\n" + "─".repeat(72));
  say("ci-parity summary");
  say("─".repeat(72));
  for (const r of results) {
    const icon = r.status === "pass" ? "✓" : r.status === "skipped" ? "⏭" : "✗";
    const time = r.ms ? ` (${(r.ms / 1000).toFixed(1)}s)` : "";
    say(`  ${icon} ${r.name}${time}${r.note ? ` — ${r.note}` : ""}`);
  }
  if (stoppedEarly) say(`\n  ${gates.length - results.length} gate(s) never ran — stopped at the first failure, same as a required-check job would.`);
  if (degraded.length) say(`\n  ⚠ DEGRADED: ${degraded.map((d) => d.name).join(", ")} ran on dummy secrets, not CI's real ones.`);
  if (!nodeCheck.ok) say(`  ⚠ ${nodeCheck.note}`);

  const failed = results.some((r) => r.status === "fail");
  say(`\nVerdict: ${failed ? "✗ FAIL" : "✓ PASS"}${degraded.length && !failed ? " (with degraded secrets — see above)" : ""}`);

  if (FLAGS.json) {
    process.stdout.write(JSON.stringify({ ok: !failed, results, degraded, node: nodeCheck, infra: infraNotes }) + "\n");
  }

  process.exitCode = failed ? 1 : 0;
}

main();
