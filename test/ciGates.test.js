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
import { execFileSync, spawnSync } from "node:child_process";
import { jobSteps } from "../ui-audit/lib/workflowContract.mjs";
import {
  KNOWN_DUMMY_SECRETS, KNOWN_INFRA_USES, secretRefName, isUnsupportedExpression,
  splitSteps, classifyInfra, resolveSecretEnv, resolveStepEnv,
  DOCS_ONLY_GATE_NAMES, selectDocsOnlyGates,
  LANE_NAMES, SETUP_GATE, laneOf, selectLane, shardRun, parseShard, browserWeightS,
} from "../ui-audit/lib/ciGates.mjs";

const REPO = process.cwd();
const BUILD_YML = join(REPO, ".github", "workflows", "build.yml");
const GATES_YML = join(REPO, ".github", "ci-gates.yml");
const readBuild = () => readFileSync(BUILD_YML, "utf8");
const readGates = () => readFileSync(GATES_YML, "utf8");

describe("jobSteps() against build.yml — the parallel lane jobs that call the script", () => {
  const laneSteps = (id) => { const r = jobSteps(readBuild(), id); expect(r.ok, `${id}: ${r.unparsed.join("; ")}`).toBe(true); return r.steps; };

  it("every lane job parses without refusing", () => {
    for (const id of LANE_NAMES) laneSteps(id);
  });

  it("each lane has exactly ONE run: step — the `npm run ci-parity -- --lane <id>` delegator — and its secrets", () => {
    for (const id of LANE_NAMES) {
      const runSteps = laneSteps(id).filter((s) => s.run != null);
      expect(runSteps.length, id).toBe(1);
      expect(runSteps[0].run, id).toMatch(new RegExp(`^npm run ci-parity -- --lane ${id}( --shard \\$\\{\\{ matrix\\.shard \\}\\}/\\d+)?$`));
      // Both secrets reach every lane's one call, so every gate that needs them sees the same values (B927104).
      expect(runSteps[0].env.VITE_SUPABASE_URL).toBe("${{ secrets.VITE_SUPABASE_URL }}");
      expect(runSteps[0].env.VITE_SUPABASE_ANON_KEY).toBe("${{ secrets.VITE_SUPABASE_ANON_KEY }}");
    }
  });

  it("the static lane (which also runs the whole docs-only subset) gets the docs-only signal; the heavy lanes are skipped by their job `if:` on a docs-only run", () => {
    const delegator = laneSteps("static").find((s) => s.run != null);
    expect(delegator.env.CI_DOCS_ONLY).toBe("${{ needs.detect.outputs.docs_only }}");
    const text = readBuild();
    for (const id of ["vitest", "build-app", "browser"]) {
      const block = text.slice(text.indexOf(`\n  ${id}:`));
      expect(block.slice(0, block.indexOf("steps:"))).toContain("if: needs.detect.outputs.docs_only != 'true'");
    }
  });

  it("only static takes a full-history checkout (the touch guard needs a merge base); every other lane is shallow", () => {
    const text = readBuild();
    expect(text.match(/fetch-depth: 0/g)?.length).toBe(1);
    const staticBlock = text.slice(text.indexOf("\n  static:"), text.indexOf("\n  vitest:"));
    expect(staticBlock).toContain("fetch-depth: 0");
  });

  it("reads the setup-node pin ci-parity.mjs checks itself against", () => {
    const setupNode = laneSteps("static").find((s) => s.name === "Setup Node");
    expect(setupNode.uses.startsWith("actions/setup-node@")).toBe(true);
    expect(setupNode.with["node-version"]).toBe("22");
  });

  it("the browser lanes download the exact dist/ build-app uploaded (hidden files included: dist/.vite/manifest.json)", () => {
    const text = readBuild();
    expect(text).toMatch(/uses: actions\/upload-artifact@v4\n\s+with:\n\s+name: dist\n\s+path: dist\/\n\s+include-hidden-files: true/);
    expect(laneSteps("browser").some((s) => s.uses?.startsWith("actions/download-artifact@"))).toBe(true);
  });

  it("main's runs never queue and PR runs still cancel superseded pushes", () => {
    const text = readBuild();
    expect(text).toContain("group: build-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}");
    expect(text).toContain("cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}");
  });

  it("the job named exactly `build` aggregates every lane, runs `if: always()`, and fails on any non-success lane", () => {
    const text = readBuild();
    const block = text.slice(text.indexOf("\n  build:\n"));
    expect(block).toContain("name: build");
    expect(block).toContain("needs: [detect, static, vitest, build-app, browser]");
    expect(block).toContain("if: always()");
    // The verdict logic itself, run for real against fabricated `needs` results.
    const m = /node -e '\n([\s\S]*?)\n\s+'\n/.exec(block);
    expect(m, "verdict script").not.toBeNull();
    const run = (needs, docsOnly = "false") => {
      try {
        execFileSync("node", ["-e", m[1]], { env: { ...process.env, NEEDS: JSON.stringify(needs), DOCS_ONLY: docsOnly }, stdio: "pipe" });
        return 0;
      } catch (e) { return e.status; }
    };
    const green = { detect: { result: "success" }, static: { result: "success" }, vitest: { result: "success" }, "build-app": { result: "success" }, browser: { result: "success" } };
    expect(run(green)).toBe(0);
    for (const lane of Object.keys(green)) {
      expect(run({ ...green, [lane]: { result: "failure" } }), `${lane} failure`).toBe(1);
      expect(run({ ...green, [lane]: { result: "cancelled" } }), `${lane} cancelled`).toBe(1);
      expect(run({ ...green, [lane]: { result: "skipped" } }), `${lane} skipped on a code PR`).toBe(1);
    }
    // docs-only: the three heavy lanes may be skipped — static and detect may not.
    const docs = { ...green, vitest: { result: "skipped" }, "build-app": { result: "skipped" }, browser: { result: "skipped" } };
    expect(run(docs, "true")).toBe(0);
    expect(run({ ...docs, static: { result: "failure" } }, "true")).toBe(1);
    expect(run({ ...docs, static: { result: "skipped" } }, "true")).toBe(1);
    // a lane missing from `needs` entirely can never read as green
    const { browser, ...noBrowser } = green;
    expect(run(noBrowser)).toBe(1);
  });
});

describe("jobSteps() against .github/ci-gates.yml — the actual gate list", () => {
  it("parses without refusing, and every step is a plain run: gate (no uses:)", () => {
    const res = jobSteps(readGates(), "build");
    expect(res.ok, res.unparsed.join("; ")).toBe(true);
    expect(res.steps.length).toBe(41);
    expect(res.steps.every((s) => s.run != null && s.uses == null)).toBe(true);
  });

  it("keeps the same order build.yml's gates ran in before the migration (npm ci → lint → … → visual regression → notes placement → notes table click → critical interaction lane — NEW-1/R2)", () => {
    const names = jobSteps(readGates(), "build").steps.map((s) => s.name);
    expect(names[0]).toBe("Generated-index touch guard (branches must never touch MAP.md / BACKLOG_OPEN.md / docs/UI-INVENTORY.md — NEW-1)");
    expect(names.at(-1)).toBe("Critical interaction lane (small deterministic contracts — B1857904/B1857905, R2)");
    const idx = (n) => names.findIndex((x) => x.startsWith(n));
    expect(idx("Lint")).toBeLessThan(idx("Mint gate"));
    expect(idx("Mint gate")).toBeLessThan(idx("Test ("));
    expect(idx("Build")).toBeLessThan(idx("Performance budget"));
    expect(idx("Wait for the preview server")).toBeLessThan(idx("Signature-budget gate"));
    expect(idx("Signature-budget gate")).toBeLessThan(idx("Visual regression baselines"));
    expect(idx("Visual regression baselines")).toBeGreaterThan(idx("Wait for the preview server"));
    // The new gate reuses the same preview server + Chromium install, so it must run AFTER both.
    expect(idx("Visual regression baselines")).toBeLessThan(idx("Notes placement surface"));
    // Same server/browser reuse reasoning for the table-click gate, and it belongs after the
    // placement gate it shares fixtures' conventions with.
    expect(idx("Notes placement surface")).toBeLessThan(idx("Notes table click"));
    // The critical interaction lane reuses the same server/browser too, so it belongs last —
    // after every other browser-driven gate has already had its chance to fail first.
    expect(idx("Notes table click")).toBeLessThan(idx("Critical interaction lane"));
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

  it("every gate's run: text is valid shell on its own (no fragments of the next step's comments left on the end of a block)", () => {
    for (const g of jobSteps(readGates(), "build").steps) {
      const r = spawnSync("bash", ["-n"], { input: `${g.run}\n`, encoding: "utf8" });
      expect(r.status, `${g.name}: ${r.stderr}`).toBe(0);
    }
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
  it("build.yml's browser lane splits into 1 run-step (the delegator) + 5 infra", () => {
    const { steps } = jobSteps(readBuild(), "browser");
    const { gates, infra } = splitSteps(steps);
    expect(gates.length).toBe(1);
    expect(infra.map((s) => s.uses.split("@")[0])).toEqual([
      "actions/checkout", "actions/setup-node", "actions/download-artifact", "actions/cache", "actions/upload-artifact",
    ]);
  });

  it("ci-gates.yml's real steps split into 41 gates + 0 infra (build.yml's lane jobs hold only runner plumbing)", () => {
    const { steps } = jobSteps(readGates(), "build");
    const { gates, infra } = splitSteps(steps);
    expect(gates.length).toBe(41);
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
  it("reports all 41 gates from ci-gates.yml, and the lane jobs' runner plumbing from build.yml", () => {
    const out = execFileSync("node", ["scripts/ci-parity.mjs", "--list"], { cwd: REPO, encoding: "utf8" });
    expect(out).toContain("Gates (41), in order, read from .github/ci-gates.yml:");
    expect(out).toContain("Checkout (actions/checkout)");
    expect(out).toContain("(actions/upload-artifact)");
    expect(out).toContain("Download the built app (actions/download-artifact)");
    // the delegator step itself must never be listed as a gate to run — that would recurse
    expect(out).not.toContain("Run CI gates (scripts/ci-parity.mjs");
  });

  it("--docs-only --list reports only the DOCS_ONLY_GATE_NAMES subset, and names the total it's drawn from", () => {
    const out = execFileSync("node", ["scripts/ci-parity.mjs", "--list", "--docs-only"], { cwd: REPO, encoding: "utf8" });
    expect(out).toContain(`Gates (${DOCS_ONLY_GATE_NAMES.length} of 41, docs-only mode)`);
    for (const name of DOCS_ONLY_GATE_NAMES) expect(out).toContain(name);
    // a full-build-only gate must NOT show up in the docs-only listing
    expect(out).not.toContain("Lint (fails the build");
    expect(out).not.toContain('"Build"');
  });

  it("CI_DOCS_ONLY=true has the same effect as --docs-only (build.yml sets the env, not the flag)", () => {
    const out = execFileSync("node", ["scripts/ci-parity.mjs", "--list"], {
      cwd: REPO, encoding: "utf8", env: { ...process.env, CI_DOCS_ONLY: "true" },
    });
    expect(out).toContain(`Gates (${DOCS_ONLY_GATE_NAMES.length} of 41, docs-only mode)`);
  });
});

describe("DOCS_ONLY_GATE_NAMES / selectDocsOnlyGates — the docs-only subset (2026-09-02 cost cut)", () => {
  it("every name in the allowlist matches a real gate in .github/ci-gates.yml", () => {
    const { steps: gates } = jobSteps(readGates(), "build");
    const sel = selectDocsOnlyGates(gates);
    expect(sel.ok, `missing: ${JSON.stringify(sel.missing)}`).toBe(true);
    expect(sel.selected.length).toBe(DOCS_ONLY_GATE_NAMES.length);
  });

  it("preserves the gates' original order, not the allowlist's declaration order", () => {
    const gates = [
      { name: "z" }, { name: DOCS_ONLY_GATE_NAMES[1] }, { name: "y" }, { name: DOCS_ONLY_GATE_NAMES[0] },
    ];
    const sel = selectDocsOnlyGates(gates, [DOCS_ONLY_GATE_NAMES[0], DOCS_ONLY_GATE_NAMES[1]]);
    expect(sel.ok).toBe(true);
    expect(sel.selected.map((g) => g.name)).toEqual([DOCS_ONLY_GATE_NAMES[1], DOCS_ONLY_GATE_NAMES[0]]);
  });

  it("REFUSES rather than silently running fewer gates when a name no longer matches (manifest/allowlist drift)", () => {
    const gates = [{ name: "some real gate" }];
    const sel = selectDocsOnlyGates(gates, ["a gate that got renamed"]);
    expect(sel.ok).toBe(false);
    expect(sel.missing).toEqual(["a gate that got renamed"]);
    expect(sel.selected).toEqual([]);
  });
});

describe("LANES — which parallel job runs which gate (Batch C, 2026-11-23)", () => {
  const gates = () => jobSteps(readGates(), "build").steps;
  const names = () => gates().map((g) => g.name);

  it("every gate is run by at least one lane, and each heavy gate sits in its named lane", () => {
    const byLane = Object.fromEntries(LANE_NAMES.map((l) => [l, selectLane(gates(), l).selected.map((g) => g.name)]));
    for (const g of names()) {
      if (g === SETUP_GATE) continue;
      expect(LANE_NAMES.filter((l) => byLane[l].includes(g)), g).toHaveLength(1);
    }
    const idx = (l, prefix) => byLane[l].some((n) => n.startsWith(prefix));
    expect(idx("vitest", "Test (")).toBe(true);
    for (const p of ["Build", "Base-ref bundle snapshot", "Performance budget"]) expect(idx("build-app", p), p).toBe(true);
    for (const p of ["Install Playwright chromium", "Serve the built app", "Wait for the preview server", "Signature-budget gate", "Visual regression baselines", "Notes placement surface", "Notes clipboard regression bank", "App-shell width sweep", "Parcels list layout", "Planner per-pointer-move rule", "Critical interaction lane"]) expect(idx("browser", p), p).toBe(true);
    for (const p of ["Lint", "Scheduler syntax guard", "Required-check contract guard", "Generated-index touch guard", "Doc pointer freshness guard"]) expect(idx("static", p), p).toBe(true);
  });

  it("`Install dependencies` runs in every lane (each lane is its own machine); a gate nobody names defaults to the cheap static lane", () => {
    for (const l of LANE_NAMES) expect(selectLane(gates(), l).selected.map((g) => g.name), l).toContain(SETUP_GATE);
    expect(laneOf("Some brand-new guard nobody classified")).toBe("static");
  });

  it("the Build gate is in build-app BEFORE the budget gate, and nothing in the browser lane builds", () => {
    const l = selectLane(gates(), "build-app").selected.map((g) => g.name);
    expect(l.findIndex((n) => n === "Build")).toBeLessThan(l.findIndex((n) => n.startsWith("Performance budget")));
    expect(selectLane(gates(), "browser").selected.some((g) => g.name === "Build")).toBe(false);
  });

  it("a sharded browser lane runs every gate in exactly one shard, setup gates in all, and the shards are balanced", () => {
    const total = 4;
    const all = selectLane(gates(), "browser").selected.map((g) => g.name);
    const shards = [1, 2, 3, 4].map((i) => selectLane(gates(), "browser", { index: i, total }));
    const setup = all.filter((n) => n === SETUP_GATE || /^(Install Playwright|Serve the built|Wait for the preview)/.test(n));
    for (const sh of shards) for (const n of setup) expect(sh.selected.map((g) => g.name)).toContain(n);
    for (const n of all.filter((x) => !setup.includes(x))) {
      expect(shards.filter((sh) => sh.selected.some((g) => g.name === n)).length, n).toBe(1);
    }
    const loads = shards.map((sh) => sh.selected.filter((g) => !setup.includes(g.name)).reduce((t, g) => t + browserWeightS(g.name), 0));
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(Math.max(...all.map(browserWeightS)));
    // order inside a shard is the manifest's order
    for (const sh of shards) {
      const order = sh.selected.map((g) => names().indexOf(g.name));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it("the shard split is deterministic (same input → same shards)", () => {
    const a = selectLane(gates(), "browser", { index: 2, total: 4 }).selected.map((g) => g.name);
    const b = selectLane(gates(), "browser", { index: 2, total: 4 }).selected.map((g) => g.name);
    expect(a).toEqual(b);
  });

  it("vitest shards hand `npm test` its own vitest --shard slice; other gates and lanes are untouched", () => {
    const test = gates().find((g) => g.name.startsWith("Test ("));
    expect(shardRun(test, "vitest", { index: 2, total: 3 })).toBe("npm test -- --shard=2/3");
    expect(shardRun(test, "vitest", null)).toBe("npm test");
    expect(shardRun(test, "static", { index: 2, total: 3 })).toBe("npm test");
    const lint = gates().find((g) => g.name.startsWith("Lint"));
    expect(shardRun(lint, "vitest", { index: 1, total: 3 })).toBe(lint.run);
  });

  it("parseShard accepts i/n (1-based) and rejects everything else", () => {
    expect(parseShard("2/4")).toEqual({ index: 2, total: 4 });
    for (const bad of ["0/4", "5/4", "2", "a/b", "", null, "2/0"]) expect(parseShard(bad), String(bad)).toBeNull();
  });

  it("an unknown lane is refused, never run as empty", () => {
    expect(selectLane(gates(), "nope").ok).toBe(false);
  });

  it("ci-parity --lane / --shard reads the same manifest: the lanes together cover all 41 gates", () => {
    const seen = new Set();
    for (const [lane, shards] of [["static", 1], ["vitest", 3], ["build-app", 1], ["browser", 4]]) {
      for (let i = 1; i <= shards; i++) {
        const args = ["scripts/ci-parity.mjs", "--list", "--lane", lane, ...(shards > 1 ? ["--shard", `${i}/${shards}`] : [])];
        const out = execFileSync("node", args, { cwd: REPO, encoding: "utf8" });
        for (const m of out.matchAll(/^\s+\d+\. (.+)$/gm)) seen.add(m[1]);
      }
    }
    expect(seen.size).toBe(41);
  });
});
