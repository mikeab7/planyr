/* scripts/ci-parity.mjs — the "run what CI runs" tool (B927104 / B1026272 / PR #1323, 2026-09-02).
 *
 * WHAT THIS PROTECTS. Three real CI failures in one week all came from someone approximating the
 * required `build` check by hand instead of running it, and failing on the gap between the two.
 * ci-parity.mjs closes that gap by reading `.github/ci-gates.yml` (the gate list) and
 * `.github/workflows/build.yml` (the CI-only plumbing that calls it) at run time — via `jobSteps()`
 * (ui-audit/lib/workflowContract.mjs) — rather than holding a second, hand-maintained copy of
 * either that can silently drift from the real thing. This file tests the two PURE halves (the
 * step parser's `jobSteps()` export, and `ui-audit/lib/ciGates.mjs`'s classification /
 * secret-resolution logic — the part that must never SILENTLY measure something different from CI
 * when a secret is absent, CLAUDE.md's item on this exact tool) plus one thin integration check
 * that the two files actually wire together the way scripts/ci-parity.mjs assumes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { jobSteps } from "../ui-audit/lib/workflowContract.mjs";
import {
  KNOWN_DUMMY_SECRETS, KNOWN_INFRA_USES, secretRefName, isUnsupportedExpression,
  splitSteps, classifyInfra, resolveSecretEnv, resolveStepEnv,
} from "../ui-audit/lib/ciGates.mjs";

const REPO = process.cwd();
const BUILD_YML = join(REPO, ".github", "workflows", "build.yml");
const GATES_YML = join(REPO, ".github", "ci-gates.yml");
const readBuild = () => readFileSync(BUILD_YML, "utf8");
const readGates = () => readFileSync(GATES_YML, "utf8");

describe("jobSteps() against build.yml — the CI-only plumbing that calls the script", () => {
  it("parses without refusing", () => {
    const res = jobSteps(readBuild(), "build");
    expect(res.ok, res.unparsed.join("; ")).toBe(true);
  });

  it("keeps exactly the steps that can't move into the script, in order", () => {
    const { steps } = jobSteps(readBuild(), "build");
    expect(steps.map((s) => s.name)).toEqual([
      "Checkout", "Setup Node", "Cache Playwright browsers",
      "Run CI gates (scripts/ci-parity.mjs — the single source of truth for what this build checks)",
      "Upload visual regression diffs",
    ]);
  });

  it("the one run: step delegates to the script and nothing else", () => {
    const { steps } = jobSteps(readBuild(), "build");
    const runSteps = steps.filter((s) => s.run != null);
    expect(runSteps.length).toBe(1);
    expect(runSteps[0].run).toBe("npm run ci-parity");
    // Both secrets flow into that one call, so every gate that needs them sees the same values —
    // the B927104 property, enforced structurally: there's nowhere left for them to disagree.
    expect(runSteps[0].env).toEqual({
      VITE_SUPABASE_URL: "${{ secrets.VITE_SUPABASE_URL }}",
      VITE_SUPABASE_ANON_KEY: "${{ secrets.VITE_SUPABASE_ANON_KEY }}",
    });
  });

  it("reads the setup-node pin ci-parity.mjs checks itself against", () => {
    const { steps } = jobSteps(readBuild(), "build");
    const setupNode = steps.find((s) => s.name === "Setup Node");
    expect(setupNode.uses.startsWith("actions/setup-node@")).toBe(true);
    expect(setupNode.with["node-version"]).toBe("22");
  });

  it("REFUSES junk rather than reporting an empty (silently-wrong) step list", () => {
    const res = jobSteps("not: a\nworkflow: at all\n", "build");
    expect(res.ok).toBe(false);
    expect(res.steps).toEqual([]);
  });

  it("REFUSES a step with neither uses: nor run: — an unrecognized step shape", () => {
    const text = ["jobs:", "  build:", "    steps:", "      - name: Mystery step", "        id: mystery"].join("\n");
    const res = jobSteps(text, "build");
    expect(res.ok).toBe(false);
    expect(res.unparsed[0]).toMatch(/Mystery step/);
  });

  it("REFUSES a step with no name:", () => {
    const text = ["jobs:", "  build:", "    steps:", "      - run: echo hi"].join("\n");
    expect(jobSteps(text, "build").ok).toBe(false);
  });
});

describe("jobSteps() against .github/ci-gates.yml — the actual gate list", () => {
  it("parses without refusing, and every step is a plain run: gate (no uses:)", () => {
    const res = jobSteps(readGates(), "build");
    expect(res.ok, res.unparsed.join("; ")).toBe(true);
    expect(res.steps.length).toBe(20);
    expect(res.steps.every((s) => s.run != null && s.uses == null)).toBe(true);
  });

  it("keeps the same order build.yml's gates ran in before the migration (npm ci → lint → … → visual regression)", () => {
    const names = jobSteps(readGates(), "build").steps.map((s) => s.name);
    expect(names[0]).toBe("Install dependencies");
    expect(names.at(-1)).toBe("Visual regression baselines (pixel diff against approved baselines — NEW-1)");
    const idx = (n) => names.findIndex((x) => x.startsWith(n));
    expect(idx("Lint")).toBeLessThan(idx("Mint gate"));
    expect(idx("Mint gate")).toBeLessThan(idx("Test ("));
    expect(idx("Build")).toBeLessThan(idx("Performance budget"));
    expect(idx("Wait for the preview server")).toBeLessThan(idx("Signature-budget gate"));
    expect(idx("Signature-budget gate")).toBeLessThan(idx("Visual regression baselines"));
    expect(idx("Visual regression baselines")).toBeGreaterThan(idx("Wait for the preview server"));
  });

  it("reads a plain inline run: verbatim", () => {
    const lint = jobSteps(readGates(), "build").steps.find((s) => s.name.startsWith("Lint"));
    expect(lint.run).toBe("npm run lint");
  });

  it("reads a multi-line block-scalar run: with its shell structure intact", () => {
    const wait = jobSteps(readGates(), "build").steps.find((s) => s.name === "Wait for the preview server");
    expect(wait.run).toMatch(/^for i in \$\(seq 1 30\); do/);
    expect(wait.run).toContain("curl -sSf http://localhost:4173/");
    expect(wait.run).toContain('echo "preview server never came up');
    expect(wait.run.split("\n").length).toBeGreaterThanOrEqual(5);
  });

  it("reads env: as a mapping, secrets refs included verbatim", () => {
    const steps = jobSteps(readGates(), "build").steps;
    expect(steps.find((s) => s.name === "Build").env).toEqual({
      VITE_SUPABASE_URL: "${{ secrets.VITE_SUPABASE_URL }}",
      VITE_SUPABASE_ANON_KEY: "${{ secrets.VITE_SUPABASE_ANON_KEY }}",
    });
    expect(steps.find((s) => s.name.startsWith("Visual regression")).env).toEqual({ BASE_URL: "http://localhost:4173/" });
  });
});

describe("splitSteps / classifyInfra — gates vs CI-only plumbing", () => {
  it("build.yml's real steps split into 1 run-step (the delegator) + 4 infra", () => {
    const { steps } = jobSteps(readBuild(), "build");
    const { gates, infra } = splitSteps(steps);
    expect(gates.length).toBe(1);
    expect(infra.map((s) => s.uses.split("@")[0])).toEqual([
      "actions/checkout", "actions/setup-node", "actions/cache", "actions/upload-artifact",
    ]);
  });

  it("ci-gates.yml's real steps split into 20 gates + 0 infra", () => {
    const { steps } = jobSteps(readGates(), "build");
    const { gates, infra } = splitSteps(steps);
    expect(gates.length).toBe(20);
    expect(infra.length).toBe(0);
  });

  it("names a reason for every KNOWN infra action — never a silent pass-through", () => {
    for (const action of Object.keys(KNOWN_INFRA_USES)) {
      const c = classifyInfra({ name: "x", uses: `${action}@v1` });
      expect(c.known).toBe(true);
      expect(c.reason.length).toBeGreaterThan(10);
    }
  });

  it("flags an action it has never seen as UNKNOWN rather than silently skipping it", () => {
    const c = classifyInfra({ name: "Mystery", uses: "some-org/some-action@v1" });
    expect(c.known).toBe(false);
    expect(c.reason).toMatch(/unrecognized/i);
    expect(c.reason).toMatch(/Mystery/);
  });
});

describe("secret expression parsing", () => {
  it("recognizes ${{ secrets.NAME }} in any spacing", () => {
    expect(secretRefName("${{ secrets.VITE_SUPABASE_URL }}")).toBe("VITE_SUPABASE_URL");
    expect(secretRefName("${{secrets.FOO}}")).toBe("FOO");
    expect(secretRefName("${{  secrets.FOO_BAR  }}")).toBe("FOO_BAR");
  });

  it("is not fooled by a literal string or an unrelated expression", () => {
    expect(secretRefName("http://localhost:4173/")).toBeNull();
    expect(secretRefName("${{ github.sha }}")).toBeNull();
    expect(secretRefName("")).toBeNull();
  });

  it("flags any ${{ }} expression that is not a secrets ref as unsupported", () => {
    expect(isUnsupportedExpression("${{ github.sha }}")).toBe(true);
    expect(isUnsupportedExpression("${{ secrets.FOO }}")).toBe(false);
    expect(isUnsupportedExpression("plain literal")).toBe(false);
  });
});

describe("resolveSecretEnv — the loud-degradation contract (CLAUDE.md item #5)", () => {
  const gates = [
    { name: "Build", env: { VITE_SUPABASE_URL: "${{ secrets.VITE_SUPABASE_URL }}", VITE_SUPABASE_ANON_KEY: "${{ secrets.VITE_SUPABASE_ANON_KEY }}" } },
    { name: "Visual regression", env: { BASE_URL: "http://localhost:4173/" } },
  ];

  it("uses the REAL secret when present — no degradation, byte-identical to CI", () => {
    const { resolved, degraded } = resolveSecretEnv(gates, { VITE_SUPABASE_URL: "https://real.supabase.co", VITE_SUPABASE_ANON_KEY: "realkey" });
    expect(resolved.get("VITE_SUPABASE_URL")).toBe("https://real.supabase.co");
    expect(resolved.get("VITE_SUPABASE_ANON_KEY")).toBe("realkey");
    expect(degraded).toEqual([]);
  });

  it("substitutes the documented dummy AND reports it, never silently, when a secret is absent", () => {
    const { resolved, degraded } = resolveSecretEnv(gates, {});
    expect(resolved.get("VITE_SUPABASE_URL")).toBe(KNOWN_DUMMY_SECRETS.VITE_SUPABASE_URL);
    expect(resolved.get("VITE_SUPABASE_ANON_KEY")).toBe(KNOWN_DUMMY_SECRETS.VITE_SUPABASE_ANON_KEY);
    expect(degraded.map((d) => d.name).sort()).toEqual(["VITE_SUPABASE_ANON_KEY", "VITE_SUPABASE_URL"]);
    for (const d of degraded) expect(d.dummy).not.toBeNull();
  });

  it("a literal env value (no secrets ref) never shows up as a secret to resolve", () => {
    const { resolved } = resolveSecretEnv(gates, {});
    expect(resolved.has("BASE_URL")).toBe(false);
  });

  it("an unknown secret with no documented dummy still degrades to a value, but says it doesn't know a safe one", () => {
    const { resolved, degraded } = resolveSecretEnv([{ name: "x", env: { X: "${{ secrets.SOME_NEW_SECRET }}" } }], {}, KNOWN_DUMMY_SECRETS);
    expect(resolved.get("SOME_NEW_SECRET")).toBe("");
    expect(degraded[0].dummy).toBeNull();
    expect(degraded[0].note).toMatch(/no known-safe dummy/);
  });

  it("collects secret names in first-seen order, deduplicated across gates", () => {
    const dup = [
      { name: "a", env: { A: "${{ secrets.SHARED }}" } },
      { name: "b", env: { B: "${{ secrets.SHARED }}", C: "${{ secrets.OTHER }}" } },
    ];
    const { resolved } = resolveSecretEnv(dup, {});
    expect([...resolved.keys()]).toEqual(["SHARED", "OTHER"]);
  });
});

describe("resolveStepEnv — one gate's env:, given the global secret resolution", () => {
  it("resolves a secrets ref from the shared map, passes a literal through unchanged", () => {
    const secretMap = new Map([["VITE_SUPABASE_URL", "https://dummy.example"]]);
    const step = { env: { VITE_SUPABASE_URL: "${{ secrets.VITE_SUPABASE_URL }}", BASE_URL: "http://localhost:4173/" } };
    const { env, unsupported } = resolveStepEnv(step, secretMap);
    expect(env).toEqual({ VITE_SUPABASE_URL: "https://dummy.example", BASE_URL: "http://localhost:4173/" });
    expect(unsupported).toEqual([]);
  });

  it("a step with no env: resolves to an empty object, not a crash", () => {
    expect(resolveStepEnv({ env: null }, new Map())).toEqual({ env: {}, unsupported: [] });
  });

  it("REFUSES (reports, never guesses at) an unsupported ${{ }} expression", () => {
    const step = { env: { SHA: "${{ github.sha }}" } };
    const { env, unsupported } = resolveStepEnv(step, new Map());
    expect(env.SHA).toBeUndefined();
    expect(unsupported).toEqual([{ key: "SHA", value: "${{ github.sha }}" }]);
  });
});

describe("scripts/ci-parity.mjs --list — the two files actually wire together (integration, no gates run)", () => {
  it("reports 20 gates from ci-gates.yml and 4 infra steps from build.yml", () => {
    const out = execFileSync("node", ["scripts/ci-parity.mjs", "--list"], { cwd: REPO, encoding: "utf8" });
    expect(out).toContain("Gates (20), in order, read from .github/ci-gates.yml:");
    expect(out).toContain("Infra steps NOT covered (4)");
    expect(out).toContain("Checkout (actions/checkout)");
    expect(out).toContain("Upload visual regression diffs (actions/upload-artifact)");
    // the delegator step itself must never be listed as a gate to run — that would recurse
    expect(out).not.toContain("Run CI gates (scripts/ci-parity.mjs");
  });
});
