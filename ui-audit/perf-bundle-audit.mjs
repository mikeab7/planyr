#!/usr/bin/env node
/* perf-bundle-audit — the CI-gated half of the standing performance budget (NEW-8).
 *
 * WHAT IT CHECKS, and why this half is the one that gates a merge:
 * bundle weight is the only performance metric that is fully DETERMINISTIC. It falls out
 * of the build with no browser, no network, and no CPU-contention noise, so a breach is
 * unambiguously attributable to the pull request that caused it. The runtime half (frame
 * time, heap, tiles — ui-audit/perf-harness.mjs) is measured in a real browser and is too
 * sensitive to CI-runner load to gate a merge on; see docs/PERF-BUDGETS.md.
 *
 * The measurement itself lives in ui-audit/lib/bundleMetrics.mjs (shared with the ratchet
 * step); the pass/fail policy lives in ui-audit/lib/perfBudgetPolicy.mjs.
 *
 * HOW A NUMBER IS JUDGED (NEW-1). Byte metrics carry a `baseline` — the last deliberately
 * recorded measurement — and their ceiling is DERIVED as baseline + max(2%, 32 KB). Growth
 * inside that band prints a loud ABOVE BASELINE line and PASSES; growth beyond it fails.
 * This is the fix for three consecutive pull requests failing on 0.8–0.9% breaches of
 * ceilings pinned to within 0.06% of measured — a headroom problem, not a regression.
 *
 * WHY A BREACH NAMES ITS CAUSE (NEW-3). A bare "2286.3 KB exceeds 2265.6 KB by 20.7 KB"
 * reads identically for a 20 KB feature and a 20 KB dependency bump, and cost a local build
 * to diagnose every time. Each route total is now broken into vendor / app-shared /
 * app-route buckets from dist/.vite/chunk-modules.json, and `--compare` diffs against a base
 * ref's stats file to name WHICH modules and packages moved, and by how much.
 *
 *   node ui-audit/perf-bundle-audit.mjs                 # human report; exit 1 on a breach
 *   node ui-audit/perf-bundle-audit.mjs --json          # machine-readable
 *   node ui-audit/perf-bundle-audit.mjs --emit-stats f  # write the attribution snapshot
 *   node ui-audit/perf-bundle-audit.mjs --compare f     # diff against a base snapshot
 *
 * Run it after `npm run build`. Requires dist/.vite/manifest.json.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBuild, measureBundle, attributeBytes, statsSnapshot, diffSnapshots, kb, ROOT } from "./lib/bundleMetrics.mjs";
import { classify, ceilingFor, headroomFor, attribute, METRIC_KEYS, DEFAULT_HEADROOM } from "./lib/perfBudgetPolicy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUDGETS = join(HERE, "perf-budgets.json");

const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : null; };
const JSON_OUT = process.argv.includes("--json");
const EMIT_STATS = argOf("--emit-stats");
const COMPARE = argOf("--compare");

const build = loadBuild(join(ROOT, "dist"));
if (!build) {
  console.error(`✗ dist/.vite/manifest.json not found — run \`npm run build\` first.`);
  console.error("  (If the manifest is missing from a fresh build, check that build.manifest is still true in vite.config.js.)");
  process.exit(2);
}

const budgets = JSON.parse(readFileSync(BUDGETS, "utf8"));
const b = budgets.bundle;
const headroom = b.headroom || DEFAULT_HEADROOM;

const measured = measureBundle(build);
const attribution = attributeBytes(measured);
const { routes, missingRoutes, allJs, totalJsBytes, largest } = measured;

/* ---- Evaluate against the committed budgets ------------------------------------------- */
const fmt = (v, unit) => (unit === "bytes" ? kb(v) : `${v}${unit === "chunks" ? "" : ` ${unit}`}`);

const failures = [];    // ceiling breaches — these fail the build
const aboveBand = [];   // over the recorded baseline but inside the headroom band — LOUD, passes
const aboveTarget = []; // knowingly out of budget — reported loudly, never silently passed
const passes = [];
const inherited = [];   // B266084 — over the ceiling, but the overage was already on main

/* B266084 — the BASE REF's own measurement, read before anything is judged.
 *
 * `--compare` already pointed at this file; it was only ever used to name which modules moved.
 * Reading its headline metrics here is what lets a breach be attributed instead of blamed.
 *
 * ATTRIBUTION RELIEF APPLIES TO A PULL REQUEST ONLY. `GITHUB_BASE_REF` is set by GitHub for a
 * `pull_request` event and for nothing else, so a push to main — where the base is merely
 * HEAD^ — keeps the absolute verdict. That asymmetry IS the design: a branch is judged on what
 * it added, main is judged on what it IS, and drift therefore surfaces on main, where a
 * deliberate ratchet with a stated reason is the correct answer. `--as-pr` / `--as-main`
 * override it so the behaviour is drivable from a test rather than only from CI. */
const AS_PR = process.argv.includes("--as-pr")
  || (!process.argv.includes("--as-main") && !!process.env.GITHUB_BASE_REF);
let baseMetrics = null;
if (COMPARE && existsSync(COMPARE)) {
  try { baseMetrics = JSON.parse(readFileSync(COMPARE, "utf8"))?.metrics || null; } catch { baseMetrics = null; }
}

function check(path, value, spec) {
  const r = classify(value, spec, headroom);
  const key = path.replace(/^bundle\./, "");
  const attr = attribute(value, baseMetrics?.[key], spec, headroom);
  const row = { metric: path, ...r, attr, owner: budgets.targetOwner?.[path] || null };
  // A ceiling breach whose overage this branch did not create is reported LOUDLY and passes —
  // but only on a pull request, and only when the branch's own growth still fits the band.
  if (r.status === "breach" && AS_PR && attr && attr.charged === "base") inherited.push(row);
  else if (r.status === "breach") failures.push(row);
  else if (r.status === "aboveBaseline") aboveBand.push(row);
  else if (r.status === "aboveTarget") aboveTarget.push(row);
  else passes.push(row);
}

/* A route we can't find at all is a HARD failure. It used to be a silent `continue`, which
 * meant a renamed/re-keyed chunk quietly took the siteRouteJsBytes + siteRouteChunks +
 * allowlist guards offline while the audit still printed "✓ all budgets within ceiling"
 * (B1042 hit exactly this). Never again: no route, no pass. */
for (const r of missingRoutes) {
  failures.push({
    metric: `bundle.route.${r.name}`,
    value: "NOT FOUND in the build",
    ceiling: `${r.src} (or a chunk named ${r.stem})`,
    delta: 0,
    unit: "chunks",
    missingRoute: r,
  });
}

const site = routes.site;
if (site) {
  check("bundle.siteRouteJsBytes", site.bytes, b.siteRouteJsBytes);
  check("bundle.siteRouteChunks", site.chunks.length, { ...b.siteRouteChunks, unit: "chunks" });
}
/* The Notes route's own budget. Its point is the LAZY EDITOR BOUNDARY: this number covers
 * the notebook tree and its chrome, never the ~464 KB rich-text engine, which rides its own
 * on-demand chunk. A rise here means something crossed back onto the static path. */
if (routes.notes) check("bundle.notesRouteJsBytes", routes.notes.bytes, b.notesRouteJsBytes);
/* The /food route's own budget (B568400) — measured separately forever, per the owner's
 * explicit ask that this module never share a metric with (or draw headroom from) the routes
 * the actual product depends on. */
if (routes.food) check("bundle.foodRouteJsBytes", routes.food.bytes, b.foodRouteJsBytes);
check("bundle.totalJsBytes", totalJsBytes, b.totalJsBytes);
check("bundle.largestChunkBytes", largest.bytes, b.largestChunkBytes);

/* The allowlist is a separate, named check: an unexpected chunk on the Site route is
 * reported BY NAME, because "which chunk came back" is the whole diagnosis. */
const allow = new Set(b.siteRouteAllowlist?.allow || []);
const intruders = site ? site.chunks.filter((c) => !allow.has(c.stem)) : [];
if (intruders.length) {
  failures.push({
    metric: "bundle.siteRouteAllowlist",
    value: intruders.map((c) => c.stem).join(", "),
    ceiling: [...allow].join(", "),
    delta: intruders.reduce((a, c) => a + c.bytes, 0),
    unit: "bytes",
    named: intruders,
  });
}

/* ---- NEW-3: attribution + base-ref diff -------------------------------------------------- */
const snapshot = statsSnapshot(measured, attribution, { ref: process.env.GITHUB_SHA || null });
if (EMIT_STATS) {
  mkdirSync(dirname(EMIT_STATS), { recursive: true });
  writeFileSync(EMIT_STATS, JSON.stringify(snapshot, null, 2));
}
let comparison = null;
let compareNote = null;
if (COMPARE) {
  if (!existsSync(COMPARE)) {
    compareNote = `base stats not available at ${COMPARE} — the head/base diff was SKIPPED (the gate above is unaffected).`;
  } else {
    try {
      comparison = diffSnapshots(JSON.parse(readFileSync(COMPARE, "utf8")), snapshot);
    } catch (e) {
      compareNote = `base stats at ${COMPARE} could not be read (${e.message}) — the head/base diff was SKIPPED.`;
    }
  }
}

/* ---- Report ---------------------------------------------------------------------------- */
const signed = (n) => `${n >= 0 ? "+" : "−"}${kb(Math.abs(n))}`;

function printAttribution() {
  if (!attribution) {
    console.log("  (byte attribution unavailable — dist/.vite/chunk-modules.json is missing. It is written");
    console.log("   by the chunk-module-stats plugin in vite.config.js; rebuild to get the vendor/app split.)\n");
    return;
  }
  console.log("  Where a route's bytes come from (NEW-3 — scaled so the buckets sum to the real chunk sizes):");
  for (const [name, r] of Object.entries(attribution.byRoute)) {
    const bk = r.buckets;
    console.log(`    ${name.padEnd(10)} vendor ${kb(bk.vendor).padStart(9)} · app-shared ${kb(bk["app-shared"]).padStart(9)} · app-route ${kb(bk["app-route"]).padStart(9)}${bk.misc ? ` · misc ${kb(bk.misc)}` : ""}`);
  }
  const top = Object.entries(attribution.packages).sort((a, c) => c[1] - a[1]).slice(0, 6);
  if (top.length) console.log(`    heaviest dependencies: ${top.map(([p, v]) => `${p} ${kb(v)}`).join(" · ")}`);
  console.log();
}

function printComparison() {
  if (compareNote) { console.log(`  ⓘ ${compareNote}\n`); return; }
  if (!comparison) return;
  console.log("  Versus the base ref (NEW-3 — this is the answer to \"optimize this, or ratchet a dependency?\"):");
  for (const [k, m] of Object.entries(comparison.metrics)) {
    if (m.delta == null) { console.log(`    ${k.padEnd(20)} (no base value)`); continue; }
    if (m.unit !== "bytes") {
      console.log(`    ${k.padEnd(20)} ${(m.delta >= 0 ? `+${m.delta}` : String(m.delta)).padStart(12)}${m.delta === 0 ? "  (unchanged)" : ` ${m.unit}`}`);
      continue;
    }
    const flat = Math.abs(m.delta) < 256;
    console.log(`    ${k.padEnd(20)} ${signed(m.delta).padStart(12)}${flat ? "  (unchanged within noise)" : ""}`);
  }
  if (!comparison.attributionComparable) {
    console.log("    Per-module attribution against this base is UNAVAILABLE (the base build carries no");
    console.log("    chunk-module stats), so only the headline metrics above are comparable. Withheld");
    console.log("    deliberately: diffing against an absent base would label every module in the build");
    console.log("    as new in this PR.\n");
    return;
  }
  for (const [route, bk] of Object.entries(comparison.bucketDelta)) {
    const parts = Object.entries(bk).filter(([, v]) => Math.abs(v) >= 256).map(([k, v]) => `${k} ${signed(v)}`);
    if (parts.length) console.log(`    route ${route.padEnd(10)} ${parts.join(" · ")}`);
  }
  if (comparison.packages.length) {
    console.log("    dependencies that moved:");
    for (const p of comparison.packages) console.log(`      ${signed(p.delta).padStart(11)}  ${p.id}`);
  }
  if (comparison.modules.length) {
    console.log("    modules that moved:");
    for (const m of comparison.modules) console.log(`      ${signed(m.delta).padStart(11)}  ${m.id}`);
  }
  if (!comparison.packages.length && !comparison.modules.length) {
    console.log("    no module moved by more than a rounding error.");
  }
  console.log();
}

/* B266084 — main's OWN drift above its own recorded baseline, printed on EVERY run whether
 * anything breaches or not. This is the number that was invisible for nine days while five
 * separate branches were each made to re-record a slice of it as though it were their own
 * feature's cost. A guard nobody can see is a guard that rots; this one is unmissable. */
function printInheritedDrift() {
  const rows = [...passes, ...aboveTarget, ...aboveBand, ...inherited, ...failures]
    .filter((r) => r.attr && r.unit === "bytes");
  if (!rows.length) return;
  const drifting = rows.filter((r) => r.attr.inherited > 256);
  console.log("  Whose bytes are these? (B266084 — base ref vs this branch):");
  for (const r of rows) {
    const a = r.attr;
    console.log(`    ${r.metric.replace(/^bundle\./, "").padEnd(20)} base ${signed(a.inherited).padStart(11)} vs its baseline · this branch ${signed(a.branch).padStart(11)}`);
  }
  if (drifting.length) {
    console.log(`    ${drifting.length} metric(s) arrive ABOVE BASELINE before this branch adds a line — that drift belongs to`);
    console.log("    main, not to this pull request, and this branch is not charged for it. It is bounded: a push");
    console.log("    to main is judged absolutely, so main cannot drift past its own band without going red there.");
  }
  console.log();
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    routes, totalJsBytes, largest, failures, aboveBand, aboveTarget, passes, inherited,
    asPullRequest: AS_PR, headroom, attribution, comparison, compareNote,
    derivedCeilings: Object.fromEntries(METRIC_KEYS(b).map((k) => [k, ceilingFor(b[k], headroom)])),
  }, null, 2));
} else {
  console.log("Planyr bundle budget audit (NEW-8)\n");
  for (const [name, r] of Object.entries(routes)) {
    console.log(`  route ${name.padEnd(10)} ${kb(r.bytes).padStart(10)}  across ${r.chunks.length} chunk(s): ${r.chunks.map((c) => c.stem).join(", ")}`);
  }
  console.log(`\n  all JS         ${kb(totalJsBytes).padStart(10)}  across ${allJs.length} chunk(s)`);
  console.log(`  largest chunk  ${kb(largest.bytes).padStart(10)}  ${largest.stem}\n`);

  printAttribution();
  printComparison();

  console.log(`  Headroom band (NEW-1): baseline + max(${(headroom.pctOfBaseline * 100).toFixed(0)}%, ${kb(headroom.minBytes)}). Growth inside the band is reported, not failed.\n`);

  printInheritedDrift();

  for (const p of passes) {
    const ceil = typeof p.ceiling === "number" ? fmt(p.ceiling, p.unit) : p.ceiling;
    console.log(`  ✓ ${p.metric} — ${fmt(p.value, p.unit)} (ceiling ${ceil})`);
  }
  for (const a of aboveTarget) {
    console.log(`  ⚠ ${a.metric} — ${fmt(a.value, a.unit)} is within its ${fmt(a.ceiling, a.unit)} ceiling but ABOVE the ${fmt(a.target, a.unit)} target (gap ${fmt(a.gap, a.unit)})`);
    if (a.owner) console.log(`      tracked by: ${a.owner}`);
  }
  for (const a of aboveBand) {
    console.log(`  ⚠ ${a.metric} — ABOVE BASELINE: ${fmt(a.value, a.unit)} vs the recorded ${fmt(a.baseline, a.unit)} (+${fmt(a.overBaseline, a.unit)}).`);
    console.log(`      Inside the ${fmt(a.band, a.unit)} headroom band, so this PASSES — ${fmt(a.bandLeft, a.unit)} of band left before the ${fmt(a.ceiling, a.unit)} ceiling.`);
    console.log("      This is a real, attributable growth. Pay it back with an optimization, or say on the item why it stays.");
    if (a.owner) console.log(`      tracked by: ${a.owner}`);
  }
  for (const i of inherited) {
    const a = i.attr;
    console.log(`  ⚠ ${i.metric} — OVER CEILING, BUT NOT BY THIS BRANCH: ${fmt(i.value, i.unit)} vs a ${fmt(i.ceiling, i.unit)} ceiling.`);
    console.log(`      The base ref already measured ${fmt(a.base, i.unit)} — ${fmt(a.inherited, i.unit)} above the recorded baseline`);
    console.log(`      before this branch existed. This branch adds ${signed(a.branch)}, which fits the ${fmt(a.band, i.unit)} band.`);
    console.log("      So this PASSES (B266084). Do NOT raise the baseline here to make it green — that would");
    console.log("      launder main's drift into the record under this branch's name, which is exactly what");
    console.log("      B1401, B1405, B1414, B209502 and B255200 each had to do before this rule existed.");
    console.log("      The drift is main's to answer for, and a push to main is judged absolutely.");
  }
  for (const f of failures) {
    if (f.missingRoute) {
      console.log(`\n  ✗ ${f.metric} — the ${f.missingRoute.name} route's chunk is NOT in this build`);
      console.log(`      looked for: ${f.ceiling}`);
      console.log("      Its per-route budgets (bytes / chunk count / allowlist) could not be evaluated, so");
      console.log("      this run proves nothing about that route. Either the workspace was renamed (update");
      console.log("      ROUTE_KEYS in ui-audit/lib/bundleMetrics.mjs, both `src` and `stem`) or the build lost it.");
    } else if (f.named) {
      console.log(`\n  ✗ ${f.metric} — UNEXPECTED CHUNK(S) ON THE SITE ROUTE: ${f.value}`);
      for (const c of f.named) console.log(`      ${c.stem} (+${kb(c.bytes)})`);
      console.log(`      allowed: ${f.ceiling}`);
      console.log("      A route-irrelevant chunk is being pulled on a plain Site load. The usual cause is");
      console.log("      something warming another workspace at boot (the NEW-9 regression), or a new STATIC");
      console.log("      import into the planner of a module that should be behind a dynamic import().");
    } else {
      console.log(`\n  ✗ ${f.metric} — ${fmt(f.value, f.unit)} exceeds the ${fmt(f.ceiling, f.unit)} ceiling by ${fmt(f.delta, f.unit)} (+${f.pct.toFixed(1)}%)`);
      if (f.attr) {
        console.log(`      Attributed (B266084): the base ref carried ${signed(f.attr.inherited)} above baseline; THIS BRANCH adds ${signed(f.attr.branch)}.`);
        if (f.attr.charged === "branch" && f.attr.branchOverBand > 0) {
          console.log(`      This branch's own growth alone is ${fmt(f.attr.branch, f.unit)} against a ${fmt(f.attr.band, f.unit)} band — the breach is yours.`);
        }
      }
      if (f.baseline != null) {
        console.log(`      That ceiling is DERIVED: baseline ${fmt(f.baseline, f.unit)} + a ${fmt(f.band, f.unit)} headroom band.`);
        console.log("      So this is past the point where growth is absorbed silently. Either optimize it back");
        console.log("      inside the band, or — if the growth is deliberate and justified — record it:");
        console.log(`        npm run perf:ratchet -- --metric ${f.metric} --item B### --allow-raise --reason "..."`);
        console.log("      Never edit the baseline by hand: test/perfBudgetPolicy.test.js fails an unlogged edit.");
      }
    }
  }
  console.log();
  if (failures.length) {
    console.log(`✗ ${failures.length} performance budget breach(es). See docs/PERF-BUDGETS.md.`);
    console.log("  A feature that breaches a budget ships with a matching optimization, or does not ship.");
    console.log("  Raising a baseline to make this pass requires the same justification as any other product decision.");
  } else {
    const notes = [];
    if (aboveBand.length) notes.push(`${aboveBand.length} above baseline, inside the band`);
    if (aboveTarget.length) notes.push(`${aboveTarget.length} above target — tracked`);
    if (inherited.length) notes.push(`${inherited.length} over ceiling on drift this branch did not add (B266084)`);
    console.log(`✓ All bundle budgets within ceiling${notes.length ? ` (${notes.join("; ")})` : ""}.`);
  }
}

process.exit(failures.length ? 1 : 0);
