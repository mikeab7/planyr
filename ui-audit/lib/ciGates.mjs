/*
 * ciGates.mjs — the PURE half of scripts/ci-parity.mjs (B927104 / B1026272 / PR #1323, 2026-09-02).
 *
 * WHY THIS EXISTS. Three CI failures in one week shared one shape: someone approximated what the
 * required `build` check does — by hand, from memory, or from a prior PR's test-plan — instead of
 * running what it actually does, and the failure was in the GAP between the approximation and the
 * real thing (a build-time env var set on one side of a comparison and not the other; a bundle
 * measured against the wrong base ref; a Chromium revision that was "a" Chromium, not THE one CI
 * pins). scripts/ci-parity.mjs is the fix: it reads `.github/workflows/build.yml` — the actual
 * source of truth for what the required check runs — via `jobSteps()` and executes exactly that,
 * in that order, rather than a hand-maintained copy that can silently drift from it.
 *
 * This module holds the parts of that job that don't touch the filesystem or spawn anything, so
 * they can be unit-tested without a checkout, a browser, or a git remote:
 *   - splitting build.yml's parsed steps into GATES (a `run:`) and INFRA (a bare `uses:`, which is
 *     either GitHub-Actions-only plumbing — checkout, setup-node, actions/cache, upload-artifact —
 *     or, if this ever grows a `uses:` this module doesn't recognize, an honest "not covered" note
 *     rather than a silent skip);
 *   - finding every `${{ secrets.NAME }}` a gate's `env:` references, and resolving each NAME
 *     against a real environment — with a LOUD, named degradation (never a silent substitution)
 *     when the real secret is absent and this module has to fall back to a dummy value;
 *   - resolving one step's `env:` block (secrets ref → resolved secret; anything else → literal)
 *     given that global resolution, refusing (never guessing) at a `${{ }}` expression that is
 *     neither `secrets.*` nor a literal — LOUD-FAILURE, the same contract `parseWorkflow` keeps.
 */

/*
 * The two dummy values below are not invented here — they are copied byte-for-byte from
 * ui-audit/visual-regression.mjs's own USAGE block, which is where B1026272 (2026-09-01) recorded
 * them after measuring that CI's real build ALWAYS carries a truthy VITE_SUPABASE_URL /
 * VITE_SUPABASE_ANON_KEY (the repo secrets are configured; "safe to be absent" was true of the
 * APP, never of a build meant to visually match CI's). `supabaseConfigured()` is a pure
 * truthy-string check with no live network call, so the exact VALUE doesn't matter — only that it
 * is non-empty and that BOTH sides of any comparison (base-ref vs head, this dummy vs CI's real
 * secret) share the same truthy-ness. Using the SAME dummy string every session, rather than a
 * freshly invented one, is what keeps a local run's visual baselines byte-comparable across
 * sessions and machines.
 */
export const KNOWN_DUMMY_SECRETS = {
  VITE_SUPABASE_URL: "https://visual-regression.supabase.co",
  VITE_SUPABASE_ANON_KEY: "visual-regression-dummy-key",
};

/** GitHub Actions marketplace actions this repo's `build` job uses that are pure CI-runner
 *  plumbing — no secret, no gate, nothing a local script can meaningfully re-run — with the one
 *  line of reasoning for each, surfaced verbatim in the "not covered" report. */
export const KNOWN_INFRA_USES = {
  "actions/checkout": "you already have a checkout — this script instead fetches origin/main so the gates that need it (the generated-doc touch guard, the base-ref bundle snapshot) can resolve a merge base.",
  "actions/setup-node": "installs a pinned Node runtime on the runner; this script checks your Node version against the same pin and warns (never silently substitutes a different Node) rather than installing one.",
  "actions/cache": "restores/saves the Playwright browser cache between CI runs — a speed optimization with no correctness effect and no local equivalent (your machine keeps its own browsers on disk).",
  "actions/upload-artifact": "uploads .perf/visual-regression/ as a downloadable CI artifact on failure — the same files are already on your disk, so there's nothing to upload to.",
  "actions/download-artifact": "restores the dist/ the build-app lane uploaded, so the browser lanes test the exact bytes that were measured, without building again. Locally you already have your own dist/ from the Build gate.",
  "actions/cache/save": "saves the base-ref bundle stats under the commit's sha so a later pull request can reuse them instead of building the base ref a second time (a CI-only speed optimization; the budget gate still runs unchanged).",
  "actions/cache/restore": "restores those saved base-ref bundle stats (see actions/cache/save); on a miss the Base-ref bundle snapshot gate builds the base itself, exactly as before.",
  "actions/github-script": "backfills the required \"build\" commit status for a PR that build-check-sweep.yml re-dispatched (NEW-3) — it calls the live GitHub API against a real PR number and run id, which only exist inside an actual Actions run; inert (its `if:` is false) on an ordinary run, and there's nothing for a local script to re-execute either way.",
};

/** `${{ secrets.NAME }}` (or `${{secrets.NAME}}`, any spacing) → "NAME"; else null. */
export function secretRefName(value) {
  const m = /^\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}$/.exec(String(value ?? "").trim());
  return m ? m[1] : null;
}

/** Is this a GitHub Actions expression this module does NOT know how to resolve (not a secrets
 *  ref, but still `${{ ... }}`)? Used to REFUSE rather than guess — LOUD-FAILURE. */
export function isUnsupportedExpression(value) {
  const v = String(value ?? "").trim();
  return /^\$\{\{.*\}\}$/.test(v) && secretRefName(v) == null;
}

/**
 * The gate NAMES (must match `.github/ci-gates.yml`'s `name:` fields verbatim) that still have
 * something to check when a pull request changes ONLY Markdown (`.github/workflows/build.yml`'s
 * "Detect docs-only change" step — 2026-09-02, the GitHub Actions cost cut: the repo went private
 * on 2026-08-31, Actions minutes started being metered, and ~100 runs/day at ~8.35 min each were
 * mostly full builds answering a docs-only push that has no code to lint, test, or build).
 *
 * Deliberately narrow, and each entry earns its place by reading content a docs-only change can
 * actually touch: whether the PR touches a GENERATED doc it never should (NEW-1, B1358128,
 * 2026-09-08 — a touch to any of MAP.md/BACKLOG_OPEN.md/docs/UI-INVENTORY.md is exactly the kind
 * of change this fast path would otherwise wave through, since they're all Markdown-extension
 * files), the BACKLOG.md tag-legend rule, the per-folder CLAUDE.md pointers, and the required-check contract itself — which is also the guard that would catch THIS
 * list ever drifting into unreachability (see ui-audit/required-check-audit.mjs). Every one of the
 * three runs on nothing but Node built-ins and the `git` CLI — no `npm ci` needed — which is why the
 * docs-only path in scripts/ci-parity.mjs skips dependency install entirely rather than merely
 * skipping the heavy gates.
 *
 * Deliberately EXCLUDED: lint / the scheduler syntax guard / the GIS source registry guard / the
 * e2e + landing-coverage fixture guards / `npm test` / the Vite build / the performance budget /
 * Playwright + visual regression — none of them can find anything wrong in a change that touches
 * no source file, and they are the entire cost this fast path exists to avoid paying twice.
 */
export const DOCS_ONLY_GATE_NAMES = [
  "Generated-index touch guard (branches must never touch MAP.md / BACKLOG_OPEN.md / docs/UI-INVENTORY.md — NEW-1)",
  "Required-check contract guard (a required check must always be able to report — NEW-2)",
  "Doc pointer freshness guard (per-folder CLAUDE.md references — ui-audit/doc-pointer-audit.mjs)",
];

/**
 * Filter parsed `gates` (from `splitSteps`) down to the docs-only subset, preserving their
 * original order. REFUSES (never silently runs zero) if a name in `DOCS_ONLY_GATE_NAMES` doesn't
 * match any real gate — that means the manifest and this allowlist drifted apart, which is exactly
 * the class of silent gap this repo's LOUD-FAILURE convention exists to catch.
 */
export function selectDocsOnlyGates(gates, names = DOCS_ONLY_GATE_NAMES) {
  const present = new Set(gates.map((g) => g.name));
  const missing = names.filter((n) => !present.has(n));
  if (missing.length) return { ok: false, missing, selected: [] };
  const wanted = new Set(names);
  return { ok: true, missing: [], selected: gates.filter((g) => wanted.has(g.name)) };
}

/*
 * LANES (2026-11-23, Batch C). The required `build` check used to be ONE serial job (~42 min). It is now an aggregator
 * (`build`, needs: every lane) over parallel LANE jobs, and every lane runs `npm run ci-parity -- --lane <name>` — so
 * `.github/ci-gates.yml` is STILL the one list of gates; this table only says which lane runs which gate.
 *
 *   static     — lint + the cheap guards (no browser, no build)            → 1 job
 *   vitest     — `npm test`, split with `--shard i/n`                       → n jobs
 *   build-app  — the Vite build, the base-ref snapshot, the bundle budget; uploads dist/  → 1 job
 *   browser    — every gate that drives Chromium against the built app (downloads dist/) → n jobs, gates split by weight
 *
 * A gate NOT named here lands in `static` (the cheap default), so adding a guard to ci-gates.yml never needs a second
 * edit; a gate that needs a browser, a build or the test suite must be named, and test/ciGates.test.js pins every
 * heavy gate to its lane. "Install dependencies" runs in every lane (each lane is its own machine).
 */
export const LANE_NAMES = ["static", "vitest", "build-app", "browser"];
/** Lanes that run OUTSIDE the required `build` check (their own workflow, .github/workflows/notes-gates.yml). */
export const EXTRA_LANE_NAMES = ["notes-extra"];
export const SETUP_GATE = "Install dependencies";
/** Gate-name PREFIXES per non-static lane (a prefix keeps the long trailing "— NEW-1, B…" tags out of this table). */
export const LANE_PREFIXES = {
  // Notes browser harnesses OWNER-MOVED OFF THE REQUIRED CHECK (2026-11-23, audit decision 2): 13 of the 18 verify-notes-* gates run
  // in the nightly / Notes-paths workflow instead. They are listed FIRST so they win over the browser lane's "Notes " prefix; the
  // five that stay required are named in REQUIRED_NOTES_GATES below. A local `npm run ci-parity` still runs all 18.
  "notes-extra": [
    "Notes table click",
    "Notes table copy / cut / paste",
    "Notes paste options (",
    "Notes Word/OneNote outline paste",
    "Notes paste-options menu",
    "Notes paste-option live preview",
    "Notes undo history survives",
    "Notes caret snap-back recorder",
    "Notes engine contract",
    "Notes Enter after a pasted bullet",
    "Notes header row on any row",
    "Notes drag pans from anywhere",
    "Notes box border move handle",
  ],
  vitest: ["Test ("],
  "build-app": ["Build", "Base-ref bundle snapshot", "Performance budget"],
  browser: [
    "Install Playwright chromium",
    "Serve the built app",
    "Wait for the preview server",
    "Signature-budget gate",
    "Visual regression baselines",
    "Notes ",
    "App-shell width sweep",
    "Parcels list layout",
    "Planner per-pointer-move rule",
    "Critical interaction lane",
  ],
};
/** Browser-lane gates that must run in EVERY shard (they bring up the server the others use). */
export const BROWSER_SETUP_PREFIXES = ["Install Playwright chromium", "Serve the built app", "Wait for the preview server"];
/** The five Notes gates that STAY in the required check: the placement surface (the original PR #1805 regression), the clipboard
 *  regression bank, and the gates behind constraints #57 (overlap), #58 (box copy vs text copy) and #59 (Ctrl+A scope). */
export const REQUIRED_NOTES_GATES = [
  "Notes placement surface",
  "Notes clipboard regression bank",
  "Notes box copy vs text copy",
  "Notes overlap rule",
  "Notes Ctrl+A scope",
];
/** The extra lane also builds the app first (it has no build-app lane in front of it), so `Build` is part of its setup. */
export const EXTRA_SETUP_PREFIXES = [...BROWSER_SETUP_PREFIXES, "Build"];
/** Rough seconds per browser gate (main run #44539206677, 19 Nov; unlisted = DEFAULT). Only used to balance shards — a wrong
 *  weight makes a shard slower, never a gate skipped, and test/ciGates.test.js proves every gate runs in exactly one shard. */
export const BROWSER_WEIGHTS_S = [
  ["Parcels list layout", 166],
  ["Signature-budget gate", 120],
  ["Critical interaction lane", 120],
  ["Visual regression baselines", 86],
  ["App-shell width sweep", 60],
  ["Planner per-pointer-move rule", 30],
  ["Notes ", 85],
];
export const BROWSER_WEIGHT_DEFAULT_S = 90;

const startsWithAny = (name, prefixes) => prefixes.some((p) => name.startsWith(p));

/** Which lane runs this gate? (`Install dependencies` is special — it runs in all of them; see `selectLane`.) */
export function laneOf(name) {
  for (const lane of ["notes-extra", ...LANE_NAMES]) if (LANE_PREFIXES[lane] && startsWithAny(name, LANE_PREFIXES[lane])) return lane;
  return "static";
}

export function browserWeightS(name) {
  const hit = BROWSER_WEIGHTS_S.find(([p]) => name.startsWith(p));
  return hit ? hit[1] : BROWSER_WEIGHT_DEFAULT_S;
}

/** Parse "i/n" (1-based) → { index, total }, or null if it is not a valid shard spec. */
export function parseShard(spec) {
  const m = /^(\d+)\/(\d+)$/.exec(String(spec ?? "").trim());
  if (!m) return null;
  const index = Number(m[1]), total = Number(m[2]);
  return index >= 1 && total >= 1 && index <= total ? { index, total } : null;
}

/**
 * The gates one lane job runs, in manifest order. `shard` ({index,total}) splits the lane's WORK across n jobs:
 *   - browser: the setup gates run in every shard; the rest are dealt out largest-weight-first to the lightest shard
 *     (deterministic — ties go to the lower shard number), so every gate runs in exactly one shard;
 *   - vitest: the one `npm test` gate runs in every shard and `shardArgs()` hands it its slice;
 *   - static / build-app: not shardable (a shard spec is ignored, loudly, by the caller).
 */
export function selectLane(gates, lane, shard = null) {
  if (!LANE_NAMES.includes(lane) && !EXTRA_LANE_NAMES.includes(lane)) return { ok: false, error: `unknown lane "${lane}" (expected ${[...LANE_NAMES, ...EXTRA_LANE_NAMES].join(" | ")})`, selected: [] };
  const extraSetup = (g) => lane === "notes-extra" && startsWithAny(g.name, EXTRA_SETUP_PREFIXES);
  const inLane = gates.filter((g) => g.name === SETUP_GATE || laneOf(g.name) === lane || extraSetup(g));
  const shardable = lane === "browser" || lane === "notes-extra";
  if (!shardable || !shard || shard.total === 1) return { ok: true, selected: inLane };

  const setupPrefixes = lane === "notes-extra" ? EXTRA_SETUP_PREFIXES : BROWSER_SETUP_PREFIXES;
  const setup = (g) => g.name === SETUP_GATE || startsWithAny(g.name, setupPrefixes);
  const work = inLane.filter((g) => !setup(g));
  const load = Array.from({ length: shard.total }, () => 0);
  const owner = new Map();
  for (const g of [...work].sort((a, b) => browserWeightS(b.name) - browserWeightS(a.name) || gates.indexOf(a) - gates.indexOf(b))) {
    let best = 0;
    for (let i = 1; i < load.length; i++) if (load[i] < load[best]) best = i;
    owner.set(g.name, best + 1);
    load[best] += browserWeightS(g.name);
  }
  return { ok: true, selected: inLane.filter((g) => setup(g) || owner.get(g.name) === shard.index), load };
}

/** Extra CLI args a sharded gate needs (only `npm test` takes any: vitest's own `--shard i/n`). */
export function shardRun(gate, lane, shard) {
  if (lane === "vitest" && shard && shard.total > 1 && gate.run.trim() === "npm test") return `npm test -- --shard=${shard.index}/${shard.total}`;
  return gate.run;
}

/** Split build.yml's parsed `build`-job steps into gates (have a `run:`) and infra (`uses:` only,
 *  no `run:`). `jobSteps()` already refuses any step shape that is neither. */
export function splitSteps(steps) {
  const gates = steps.filter((s) => s.run != null);
  const infra = steps.filter((s) => s.uses != null);
  return { gates, infra };
}

/** Classify one infra (`uses:`-only) step: a known, harmless piece of CI plumbing, or something
 *  this module has never seen and must say so about rather than silently doing nothing. */
export function classifyInfra(step) {
  const action = String(step.uses || "").split("@")[0];
  const reason = KNOWN_INFRA_USES[action];
  if (reason) return { action, known: true, reason };
  return {
    action,
    known: false,
    reason: `unrecognized action — build.yml grew a step this script doesn't know about. ` +
      `It is NOT covered by this run; read the step ("${step.name}") and decide by hand whether it matters.`,
  };
}

/**
 * Every secret NAME referenced by any gate's `env:`, in first-seen order, resolved against `env`
 * (normally `process.env`). Returns `{ resolved: Map(name -> value), degraded: [{name, dummy, note}] }`.
 * `dummy` is the value actually substituted when the real secret was absent — `null` if this module
 * has no known-safe dummy for that name (still substituted as `""`, but flagged more strongly).
 */
export function resolveSecretEnv(gates, env, dummies = KNOWN_DUMMY_SECRETS) {
  const names = [];
  for (const g of gates) {
    for (const v of Object.values(g.env || {})) {
      const name = secretRefName(v);
      if (name && !names.includes(name)) names.push(name);
    }
  }
  const resolved = new Map();
  const degraded = [];
  for (const name of names) {
    const real = env[name];
    if (real) { resolved.set(name, real); continue; }
    const dummy = Object.prototype.hasOwnProperty.call(dummies, name) ? dummies[name] : null;
    resolved.set(name, dummy ?? "");
    degraded.push({
      name,
      dummy,
      note: dummy != null
        ? `${name} not set — substituting the dummy value visual-regression.mjs's header documents ` +
          `(matches CI's SHAPE — truthy env — never its real value).`
        : `${name} not set and no known-safe dummy exists for it — proceeding with an EMPTY value. ` +
          `This gate may measure something CI does not; treat any result touching it as unverified.`,
    });
  }
  return { resolved, degraded };
}

/**
 * Resolve one gate's `env:` block against the global secret resolution. Returns
 * `{ env: {KEY: value}, unsupported: [{key, value}] }` — `unsupported` is populated (never guessed
 * at) for any `${{ }}` expression that isn't a secrets ref, per `isUnsupportedExpression`.
 */
export function resolveStepEnv(step, secretMap) {
  const env = {};
  const unsupported = [];
  for (const [key, value] of Object.entries(step.env || {})) {
    const name = secretRefName(value);
    if (name) { env[key] = secretMap.get(name) ?? ""; continue; }
    if (isUnsupportedExpression(value)) { unsupported.push({ key, value }); continue; }
    env[key] = value;
  }
  return { env, unsupported };
}
