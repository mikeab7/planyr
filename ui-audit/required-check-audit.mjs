#!/usr/bin/env node
/*
 * required-check-audit.mjs — fails the build if a REQUIRED status check could ever fail to REPORT.
 *
 * THE OUTAGE THIS GUARDS AGAINST (2026-08-06). Seven pull requests were open; none could merge.
 * Every one showed the same thing: `build — Expected — Waiting for status to be reported`, Required.
 * GitHub Actions was healthy and finishing builds in about a minute. Cloudflare Pages was green.
 * The ruleset named exactly one required context and named it correctly. Nothing was red anywhere,
 * because an unreported check produces silence, not failure — and GitHub offers NO merge control
 * while a required context is unreported, not even to an administrator. The repository could not
 * get itself out of it.
 *
 * A required check is therefore a load-bearing contract between two things that live in different
 * places and drift independently: the ruleset (on GitHub) and the workflows (in this repo). This
 * asserts the contract in the ordinary build, where a breach goes RED before it can wedge anything:
 *
 *   1. every context in `.github/required-checks.json` is PRODUCED by a job that runs on
 *      `pull_request` into main — a required context nobody produces can never report;
 *   2. every one of them still reports on a DOCS-ONLY pull request — the change class that caused
 *      the outage (a backlog renumber touches only BACKLOG.md / BACKLOG_OPEN.md / VERIFICATION.md /
 *      MAP.md) and the one a `paths:` filter silently excludes.
 *
 * Run:  node ui-audit/required-check-audit.mjs [--json]
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseWorkflow, contractVerdict, DOCS_ONLY_CHANGE } from "./lib/workflowContract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const WORKFLOW_DIR = join(REPO, ".github", "workflows");
const CONTRACT = join(REPO, ".github", "required-checks.json");

export function audit(repo = REPO) {
  const contractPath = join(repo, ".github", "required-checks.json");
  if (!existsSync(contractPath)) {
    return { ok: false, fatal: `${contractPath} is missing — the required-check contract is what makes this checkable.` };
  }
  let contract;
  try {
    contract = JSON.parse(readFileSync(contractPath, "utf8"));
  } catch (e) {
    return { ok: false, fatal: `.github/required-checks.json is not valid JSON — ${e.message}` };
  }
  const required = contract.requiredStatusChecks || [];
  if (!required.length) {
    return { ok: false, fatal: "`requiredStatusChecks` is empty. If protection was deliberately removed, say so here explicitly; an empty list is indistinguishable from a mistake." };
  }

  const dir = join(repo, ".github", "workflows");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)) : [];
  if (!files.length) return { ok: false, fatal: `no workflow files found in ${dir}` };

  const workflows = [];
  const unparsed = [];
  for (const f of files) {
    const wf = parseWorkflow(readFileSync(join(dir, f), "utf8"), f);
    // REFUSE on anything unreadable. A contract checker that skips the file it cannot parse reads
    // as a pass, which is the exact failure mode this whole guard exists to prevent.
    if (!wf.ok) unparsed.push(...wf.unparsed);
    workflows.push(wf);
  }
  if (unparsed.length) return { ok: false, fatal: `could not read a workflow:\n     ${unparsed.join("\n     ")}` };

  const verdict = contractVerdict({ required, workflows, branch: contract.branch || "main" });
  return { ...verdict, required, workflows: files, ruleset: contract.ruleset || "(unnamed)" };
}

function main(argv) {
  const res = audit();
  if (argv.includes("--json")) process.stdout.write(JSON.stringify(res) + "\n");

  if (res.fatal) {
    process.stderr.write(`\n⛔ REQUIRED-CHECK CONTRACT UNREADABLE: ${res.fatal}\n\n`);
    return 1;
  }
  if (res.ok) {
    process.stdout.write(
      `✓ Required-check contract OK — ${res.required.map((c) => `"${c}"`).join(", ")} ` +
        `(ruleset "${res.ruleset}") ${res.required.length > 1 ? "are" : "is"} produced on pull_request → main ` +
        `and still ${res.required.length > 1 ? "report" : "reports"} on a docs-only change.\n`,
    );
    return 0;
  }

  const lines = [`\n⛔ REQUIRED-CHECK CONTRACT BROKEN — a required status check could never report.\n`];
  lines.push(`   This is the 2026-08-06 outage class: seven PRs stuck at "Expected — Waiting for status\n`);
  lines.push(`   to be reported", nothing red anywhere, and NO merge control available to anyone.\n\n`);

  for (const ctx of res.missing) {
    lines.push(`   "${ctx}" is REQUIRED but no job produces it on pull_request → main.\n`);
    lines.push(`      Check names produced today: ${res.produced.map((p) => `"${p}"`).join(", ") || "(none)"}\n`);
    lines.push(`      → rename the job back, or update .github/required-checks.json AND the ruleset together.\n\n`);
  }
  for (const u of res.unreachable) {
    lines.push(`   "${u.context}" is REQUIRED but would NOT report on a docs-only pull request.\n`);
    lines.push(`      Producing workflow(s): ${u.workflows.join(", ")}\n`);
    lines.push(`      A change touching only ${DOCS_ONLY_CHANGE.slice(0, 3).join(" / ")} … produces no run,\n`);
    lines.push(`      so the required context stays "Expected" forever and the PR can never merge.\n`);
    lines.push(`      → keep the paths filter on the EXPENSIVE job, and add a companion job with the SAME\n`);
    lines.push(`        check name that runs when the filter excludes everything and reports success at once.\n`);
    lines.push(`        Do NOT drop the required check and do NOT remove the ruleset.\n\n`);
  }
  process.stderr.write(lines.join(""));
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}

export { WORKFLOW_DIR, CONTRACT };
