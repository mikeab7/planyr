/* The required-check contract guard (NEW-2) — `ui-audit/lib/workflowContract.mjs`.
 *
 * WHAT IT IS PROTECTING. On 2026-08-06 seven pull requests became permanently unmergeable: the
 * required context `build` sat at "Expected — Waiting for status to be reported" on every one of
 * them. Actions was healthy, Cloudflare was green, the ruleset named the right context, and nothing
 * was red — an unreported required check produces silence, not failure. GitHub offers no merge
 * control in that state, so the repository cannot recover on its own. The guard therefore has to
 * fire BEFORE the breach merges, which is what these tests pin.
 *
 * A guard is only worth the line it occupies if it can be shown to go RED, so every property here
 * is mutation-checked: the real repo passes, and a deliberately broken copy of it fails.
 *
 * Pure — no git, no network, no clock — except the two cases that read this repo's own workflow
 * files, which are committed and therefore deterministic. */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  parseWorkflow, pullRequestCheckNames, pathMatches, triggerFires,
  contractVerdict, DOCS_ONLY_CHANGE,
} from "../ui-audit/lib/workflowContract.mjs";
import { audit } from "../ui-audit/required-check-audit.mjs";

const WORKFLOWS = join(process.cwd(), ".github", "workflows");
const readWf = (f) => parseWorkflow(readFileSync(join(WORKFLOWS, f), "utf8"), f);

describe("the workflow reader understands this repo's real files", () => {
  it("parses every committed workflow without refusing", () => {
    const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const wf = readWf(f);
      expect(wf.ok, `${f}: ${wf.unparsed.join("; ")}`).toBe(true);
    }
  });

  it("reads build.yml's triggers and its single `build` job", () => {
    const wf = readWf("build.yml");
    expect(Object.keys(wf.on).sort()).toEqual(["pull_request", "push", "workflow_dispatch"]);
    expect(wf.on.pull_request.branches).toEqual(["main"]);
    expect(wf.jobs.build.checkName).toBe("build");
    expect(pullRequestCheckNames(wf)).toEqual(["build"]);
  });

  it("REFUSES a file it cannot read rather than reporting a pass", () => {
    // The failure mode this guard exists to prevent, applied to the guard itself.
    const wf = parseWorkflow("this is not a workflow", "junk.yml");
    expect(wf.ok).toBe(false);
    expect(wf.unparsed.join(" ")).toMatch(/no `on:` trigger block/);
  });

  it("a workflow with no pull_request trigger produces no PR check names", () => {
    const wf = readWf("e2e.yml"); // schedule + workflow_dispatch only
    expect(pullRequestCheckNames(wf)).toEqual([]);
  });
});

describe("path filters — the trap the owner's leading hypothesis named", () => {
  it("matches the `**`, `*` and `?` forms GitHub uses", () => {
    expect(pathMatches("src/**", "src/a/b.js")).toBe(true);
    expect(pathMatches("src/**", "docs/a.md")).toBe(false);
    expect(pathMatches("**.md", "BACKLOG.md")).toBe(true);
    expect(pathMatches("*.md", "BACKLOG.md")).toBe(true);
    expect(pathMatches("*.md", "docs/BACKLOG.md")).toBe(false);
    expect(pathMatches("**/*.md", "docs/a/b.md")).toBe(true);
  });

  it("a `paths:` filter excluding docs means a docs-only PR produces NO run", () => {
    expect(triggerFires({ paths: ["src/**"] }, DOCS_ONLY_CHANGE)).toBe(false);
    expect(triggerFires({ paths: ["src/**"] }, ["src/app.js"])).toBe(true);
  });

  it("a `paths-ignore:` filter listing the docs does the same thing", () => {
    expect(triggerFires({ pathsIgnore: ["**.md"] }, DOCS_ONLY_CHANGE)).toBe(false);
    expect(triggerFires({ pathsIgnore: ["**.md"] }, ["src/app.js", "BACKLOG.md"])).toBe(true);
  });

  it("no filter at all always fires — which is why build.yml survived this outage", () => {
    expect(triggerFires({}, DOCS_ONLY_CHANGE)).toBe(true);
    expect(triggerFires(readWf("build.yml").on.pull_request, DOCS_ONLY_CHANGE)).toBe(true);
  });
});

describe("the contract verdict", () => {
  const buildWf = { file: "build.yml", on: { pull_request: { branches: ["main"] } }, jobs: { build: { checkName: "build" } } };

  it("GREEN when the required context is produced and reachable", () => {
    const v = contractVerdict({ required: ["build"], workflows: [buildWf] });
    expect(v.ok).toBe(true);
    expect(v.missing).toEqual([]);
    expect(v.unreachable).toEqual([]);
  });

  it("RED when a job RENAME orphans the required context (the name-drift trap)", () => {
    const renamed = { ...buildWf, jobs: { build: { checkName: "Build & Test" } } };
    const v = contractVerdict({ required: ["build"], workflows: [renamed] });
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(["build"]);
    expect(v.produced).toEqual(["Build & Test"]);
  });

  it("RED when a paths filter makes the required context unreachable on a docs-only change", () => {
    const filtered = { ...buildWf, on: { pull_request: { branches: ["main"], paths: ["src/**"] } } };
    const v = contractVerdict({ required: ["build"], workflows: [filtered] });
    expect(v.ok).toBe(false);
    expect(v.unreachable[0]).toMatchObject({ context: "build" });
    expect(v.missing).toEqual([]); // it IS produced — just not on the change that matters
  });

  it("GREEN again once a companion job with the SAME check name covers the excluded case", () => {
    // The sanctioned pattern, and the one the failure message tells you to use: keep the filter on
    // the expensive job, add a cheap job with the same check name for everything it excludes.
    const expensive = { file: "build.yml", on: { pull_request: { branches: ["main"], paths: ["src/**"] } }, jobs: { build: { checkName: "build" } } };
    const companion = { file: "build-docs.yml", on: { pull_request: { branches: ["main"] } }, jobs: { build: { checkName: "build" } } };
    const v = contractVerdict({ required: ["build"], workflows: [expensive, companion] });
    expect(v.ok).toBe(true);
  });

  it("RED when the workflow only runs on push, so nothing binds to the PR", () => {
    const pushOnly = { file: "build.yml", on: { push: { branches: ["main"] } }, jobs: { build: { checkName: "build" } } };
    const v = contractVerdict({ required: ["build"], workflows: [pushOnly] });
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(["build"]);
  });

  it("RED when the pull_request trigger targets a different base branch", () => {
    const otherBase = { ...buildWf, on: { pull_request: { branches: ["develop"] } } };
    expect(contractVerdict({ required: ["build"], workflows: [otherBase] }).ok).toBe(false);
  });
});

describe("the guard, end to end, against this repository as it stands", () => {
  it("passes today — 'build' is produced on pull_request → main and survives a docs-only change", () => {
    const res = audit();
    expect(res.fatal).toBeUndefined();
    expect(res.ok, JSON.stringify({ missing: res.missing, unreachable: res.unreachable })).toBe(true);
    expect(res.required).toEqual(["build"]);
  });

  it("the committed contract matches the ruleset the owner verified on GitHub", () => {
    // settings/rules/17661176 — "Protect Main", whose "Status checks that are required" list held
    // exactly one entry, "build", provider GitHub Actions. Pinned so a change to one side of the
    // contract without the other goes red here instead of silently wedging every open PR.
    const contract = JSON.parse(readFileSync(join(process.cwd(), ".github", "required-checks.json"), "utf8"));
    expect(contract.requiredStatusChecks).toEqual(["build"]);
    expect(contract.branch).toBe("main");
  });
});
