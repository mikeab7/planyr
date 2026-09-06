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
  "actions/checkout": "you already have a checkout — this script instead fetches origin/main so the gates that need it (the mint gate, the base-ref bundle snapshot) can resolve a merge base.",
  "actions/setup-node": "installs a pinned Node runtime on the runner; this script checks your Node version against the same pin and warns (never silently substitutes a different Node) rather than installing one.",
  "actions/cache": "restores/saves the Playwright browser cache between CI runs — a speed optimization with no correctness effect and no local equivalent (your machine keeps its own browsers on disk).",
  "actions/upload-artifact": "uploads .perf/visual-regression/ as a downloadable CI artifact on failure — the same files are already on your disk, so there's nothing to upload to.",
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
 * actually touch: the two generated indexes (MAP.md, BACKLOG_OPEN.md), the per-folder CLAUDE.md
 * pointers, the backlog/verification id space (a docs-only push is exactly how a BACKLOG.md/
 * VERIFICATION.md hand-edit ships), and the required-check contract itself — which is also the
 * guard that would catch THIS list ever drifting into unreachability (see
 * ui-audit/required-check-audit.mjs). Every one of the six runs on nothing but Node built-ins and
 * the `git` CLI — no `npm ci` needed — which is why the docs-only path in scripts/ci-parity.mjs
 * skips dependency install entirely rather than merely skipping the heavy gates.
 *
 * Deliberately EXCLUDED: lint / the scheduler syntax guard / the GIS source registry guard / the
 * e2e + landing-coverage fixture guards / `npm test` / the Vite build / the performance budget /
 * Playwright + visual regression — none of them can find anything wrong in a change that touches
 * no source file, and they are the entire cost this fast path exists to avoid paying twice.
 */
export const DOCS_ONLY_GATE_NAMES = [
  "Required-check contract guard (a required check must always be able to report — NEW-2)",
  "MAP.md drift guard (regenerate with `node scripts/build-map.mjs` — B637)",
  "BACKLOG_OPEN.md drift + tag-legend guard (regenerate with `node scripts/build-backlog-index.mjs` — B638)",
  "Doc pointer freshness guard (per-folder CLAUDE.md references — ui-audit/doc-pointer-audit.mjs)",
  "Verification-queue ceiling guard (no-Blocker / stale V# items — B825233)",
  "Mint gate (new B#/V# unclaimed on main and on in-flight branches — B779)",
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
