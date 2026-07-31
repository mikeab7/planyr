#!/usr/bin/env node
/* perf-ratchet — the ONE named step that is allowed to move a bundle baseline (NEW-1).
 *
 * WHY THIS EXISTS AS A SCRIPT RATHER THAN AS A RULE IN A MARKDOWN FILE. The standing rule
 * already said "ratchet the ceiling down toward the target as optimizations land — never up
 * to accommodate a regression", and it was still, repeatedly, a hand-edited number in a JSON
 * file with a paragraph of justification bolted onto a `note` string. Nothing stopped an
 * ordinary merge from nudging it, and nothing recorded WHY it moved in a form anything could
 * check. So:
 *
 *   • This script measures the value itself, from a fresh build. You cannot ratchet to a
 *     number you did not measure.
 *   • --reason and --item are MANDATORY, and short reasons are rejected. The reason lands in
 *     `bundle.ratchetLog.entries`, next to the from/to values and the date.
 *   • Lowering a baseline (the good direction) is the default. RAISING one additionally needs
 *     --allow-raise, because that is a product decision and should read like one on the diff.
 *   • test/perfBudgetPolicy.test.js asserts each baseline equals the `to` of its own latest
 *     log entry — so a baseline edited by hand, with no reason on the record, goes RED in CI.
 *     That is what turns "the ratchet is a named step" from an intention into a fact.
 *
 * Growth that stays INSIDE the headroom band needs no entry here at all: the audit annotates
 * it loudly and passes. The log is for deliberate moves of the recorded baseline, nothing else.
 *
 *   npm run build
 *   npm run perf:ratchet -- --metric bundle.largestChunkBytes --item B1064 \
 *     --reason "Lazy panel scaffold moved LayerPanel + SiteAnalysis off the planner chunk"
 *   npm run perf:ratchet -- --all --item B1064 --reason "..."     # every metric that improved
 *   npm run perf:ratchet -- --all --item B1064 --reason "..." --dry-run
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBuild, measureBundle, kb, ROOT } from "../ui-audit/lib/bundleMetrics.mjs";
import { isBanded, METRIC_KEYS } from "../ui-audit/lib/perfBudgetPolicy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUDGETS = join(HERE, "..", "ui-audit", "perf-budgets.json");
const MIN_REASON = 24;

const argv = process.argv.slice(2);
const argOf = (flag) => { const i = argv.indexOf(flag); return i > -1 ? argv[i + 1] : null; };
const has = (flag) => argv.includes(flag);

const metricArg = argOf("--metric");
const item = argOf("--item");
const reason = argOf("--reason");
const date = argOf("--date") || new Date().toISOString().slice(0, 10);
const ALL = has("--all");
const ALLOW_RAISE = has("--allow-raise");
const DRY = has("--dry-run");

function die(msg, extra = []) {
  console.error(`✗ ${msg}`);
  for (const line of extra) console.error(`  ${line}`);
  process.exit(2);
}

if (!metricArg && !ALL) die("name what you are ratcheting: --metric bundle.largestChunkBytes (or --all).");
if (!item) die("--item is required — the backlog item this ratchet belongs to (e.g. --item B1064).", [
  "A baseline move with no owning item is exactly the 'side effect of an ordinary merge' this step exists to prevent.",
]);
if (!reason || reason.trim().length < MIN_REASON) {
  die(`--reason is required and must be at least ${MIN_REASON} characters of real explanation.`, [
    "Say WHAT optimization landed, not that a number changed. This text is the permanent record;",
    "the audit points readers at it when a later run comes close to the ceiling.",
  ]);
}

/* ---- RUNTIME metrics (NEW-1, 2026-07-31) ----------------------------------------------------
 * The bundle half below measures its own value from dist/. A runtime metric cannot be measured
 * from a file — it needs a browser, a preview server and a gesture — so the equivalent guarantee
 * is: the value comes from an INSTRUMENT'S OWN OUTPUT (`perf-harness.mjs --json`), never from a
 * number typed on the command line. Same rule, same reason: you cannot seed what you did not run.
 *
 * The run itself is interrogated before a single byte is written, because the whole reason this
 * exists is that a frame budget was seeded three times from a run that could not support it:
 *   • it must not be EMULATED (--cpu-throttle / --dpr) — those ceilings describe a 1× machine;
 *   • the frame sampler must not have raised a fault (hidden tab, starved sample, idle gesture);
 *   • for a frame metric the scripted drag must actually have PANNED the view;
 *   • only a metric that carries `seededFrom` may be written — that field is what marks a spec as
 *     harness-seeded. peakHeapMB / aerialTileRequests carry PRODUCTION numbers, and a sandbox run
 *     must never be allowed to quietly overwrite one with a local floor.
 * A re-seed at an UNCHANGED value is still recorded: when the scenario changes, the provenance is
 * the thing that moved, and provenance is exactly what the log exists to hold.
 *
 *   node ui-audit/perf-harness.mjs --no-tiles --json > /tmp/run.json
 *   npm run perf:ratchet -- --metric runtime.frameMedianMs --from-harness /tmp/run.json \
 *     --item NEW-1 --reason "Re-seeded from the Goose Creek scenario; the old scene had no roads or ponds"
 */
if (metricArg && metricArg.startsWith("runtime.")) {
  const harnessPath = argOf("--from-harness");
  if (!harnessPath) die("a runtime metric is seeded from an instrument run, not from a typed number.", [
    "  node ui-audit/perf-harness.mjs --no-tiles --json > /tmp/run.json",
    "  npm run perf:ratchet -- --metric runtime.frameMedianMs --from-harness /tmp/run.json --item … --reason …",
  ]);
  let run;
  try { run = JSON.parse(readFileSync(harnessPath, "utf8")); }
  catch (e) { die(`could not read a harness --json run from ${harnessPath}: ${e.message}`); }

  const key = metricArg.slice("runtime.".length);
  const text0 = readFileSync(BUDGETS, "utf8");
  const budgets0 = JSON.parse(text0);
  const spec = budgets0.runtime?.[key];
  if (!spec) die(`unknown metric ${metricArg}.`);
  if (!spec.seededFrom) die(`${metricArg} carries no \`seededFrom\` — it is not a harness-seeded metric.`, [
    "Its `measured` is a PRODUCTION figure. A sandbox run must not overwrite one with a local floor;",
    "if that is genuinely what you mean to do, add `seededFrom` to the spec first, deliberately.",
  ]);
  if (!budgets0.runtime.ratchetLog?.runtimeRatchetEntries) die("perf-budgets.json has no runtime.ratchetLog.runtimeRatchetEntries array — refusing to invent one.");

  if (run.results?.cpuThrottle > 1 || run.results?.deviceScaleFactor !== 1) {
    die(`that run is EMULATED (cpu ${run.results?.cpuThrottle}×, dpr ${run.results?.deviceScaleFactor}).`, [
      "Emulated numbers are an A/B instrument, not a budget — the ceilings here were seeded at 1×.",
    ]);
  }
  if (run.frameSamplingFault) die("that run's frame sample was REFUSED by the sampling guard.", [run.frameSamplingFault]);
  if (/^frame/.test(key) && run.results?.dragPanned === false) {
    die("that run's scripted drag never moved the view — it measured an idle page.");
  }
  const value = run.results?.[key];
  if (typeof value !== "number") die(`${metricArg} is not present in that run (it was skipped or suppressed).`);

  const from = spec.measured;
  if (typeof from === "number" && value > from && !ALLOW_RAISE) {
    die(`${metricArg}: the measured ${value} is ABOVE the recorded ${from}.`, [
      "That is a RAISE, not a ratchet. If it is deliberate — a heavier reference scene, say —",
      "add --allow-raise and make the --reason state what changed and why the number is honest.",
    ]);
  }
  const seededFrom = `ui-audit/perf-harness.mjs, headless, ${run.scenario}, ${date}${run.results.frameSamples ? ` (${run.results.frameSamples} samples at ${run.results.frameObservedFps} fps, tab visible, view panned)` : ""}`;

  const replaceStr = (text, k, field, next) => {
    const re = new RegExp(`("${k}"\\s*:\\s*\\{[\\s\\S]*?"${field}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|[\\d.]+)`);
    if (!re.test(text)) die(`could not locate "${field}" inside the "${k}" block — refusing to guess.`);
    return text.replace(re, (_m, head) => `${head}${JSON.stringify(next)}`);
  };
  const appendTo = (text, arrayKey, entry) => {
    const at = text.indexOf(`"${arrayKey}"`);
    if (at < 0) die(`could not locate "${arrayKey}" — refusing to guess.`);
    let depth = 0, i = text.indexOf("[", at), close = -1;
    for (; i < text.length; i++) {
      if (text[i] === "[") depth++;
      else if (text[i] === "]") { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close < 0) die(`${arrayKey} is not a closed array — refusing to guess.`);
    const before = text.slice(0, close).replace(/\s*$/, "");
    const body = JSON.stringify(entry, null, 2).split("\n").map((l) => `        ${l}`).join("\n");
    return `${before}${/[}\]]$/.test(before) ? "," : ""}\n${body}\n      ${text.slice(close)}`;
  };

  const entry = {
    metric: metricArg, from: from ?? null, to: value,
    direction: from === value ? "reseed" : value > from ? "raise" : "ratchet",
    scenario: run.scenario, item, date, reason: reason.trim(),
  };
  if (!DRY) {
    let out = replaceStr(text0, key, "measured", value);
    out = replaceStr(out, key, "seededFrom", seededFrom);
    out = appendTo(out, "runtimeRatchetEntries", entry);
    JSON.parse(out); // never write a file we just broke
    writeFileSync(BUDGETS, out);
  }
  console.log(`${DRY ? "(dry run) " : ""}${entry.direction.toUpperCase()} ${metricArg}: ${from} → ${value} (${run.scenario})`);
  console.log(`  seededFrom: ${seededFrom}`);
  console.log(`\nReason recorded: ${reason.trim()}`);
  process.exit(0);
}

const build = loadBuild(join(ROOT, "dist"));
if (!build) die("no build found at dist/.vite/manifest.json — run `npm run build` first.", [
  "The ratchet measures the value itself; it will not write a number you typed in.",
]);

const measured = measureBundle(build);
const CURRENT = {
  "bundle.siteRouteJsBytes": measured.routes.site?.bytes ?? null,
  "bundle.notesRouteJsBytes": measured.routes.notes?.bytes ?? null,
  "bundle.totalJsBytes": measured.totalJsBytes,
  "bundle.largestChunkBytes": measured.largest.bytes,
};

const budgetsText = readFileSync(BUDGETS, "utf8");
const budgets = JSON.parse(budgetsText);
const bundle = budgets.bundle;
if (!bundle.ratchetLog?.entries) die("perf-budgets.json has no bundle.ratchetLog.entries array — refusing to invent one.");

const candidates = ALL
  ? METRIC_KEYS(bundle).filter((k) => isBanded(bundle[k])).map((k) => `bundle.${k}`)
  : [metricArg];

const applied = [];
const skipped = [];
for (const path of candidates) {
  const key = path.replace(/^bundle\./, "");
  const spec = bundle[key];
  if (!spec) die(`unknown metric ${path}. Known banded metrics: ${METRIC_KEYS(bundle).filter((k) => isBanded(bundle[k])).map((k) => `bundle.${k}`).join(", ")}`);
  if (!isBanded(spec)) die(`${path} has no baseline — it is a hard-ceiling metric (a chunk count) and does not ratchet.`);
  const value = CURRENT[path];
  if (typeof value !== "number") die(`${path} could not be measured from this build.`);

  const from = spec.baseline;
  if (value === from) { skipped.push({ path, why: "already at the measured value" }); continue; }
  const raising = value > from;
  if (raising && !ALLOW_RAISE) {
    if (ALL) { skipped.push({ path, why: `measured ${kb(value)} is ABOVE the ${kb(from)} baseline — a raise, which --all will not do implicitly` }); continue; }
    die(`${path}: the measured value ${kb(value)} is ABOVE the recorded baseline ${kb(from)}.`, [
      "That is a RAISE, not a ratchet. If the growth is deliberate and justified, say so explicitly:",
      "  add --allow-raise, and make the --reason state what shipped and what was optimized first.",
      "If it is not deliberate, the fix is the code, not this file.",
    ]);
  }

  /* A metric whose target EQUALS its baseline is asserting "no known gap" (totalJsBytes does
   * this deliberately). Ratcheting the baseline without the target would silently open a gap
   * that nobody decided to open, and the audit would start reporting an ABOVE TARGET it has no
   * owner for. So the target follows the baseline in that case, and only in that case: a target
   * that is genuinely lower than the baseline is an aspiration and is left exactly alone. */
  const targetTracked = spec.target === from;
  spec.baseline = value;
  if (targetTracked) spec.target = value;
  applied.push({ path, key, from, to: value, raising, targetTracked });
}

if (!applied.length) {
  console.log("Nothing to do — no baseline moved.");
  for (const s of skipped) console.log(`  · ${s.path}: ${s.why}`);
  process.exit(0);
}

/* Write SURGICALLY, not by re-serialising the whole document. perf-budgets.json is a file
 * people read: it carries multi-line $comment arrays, blank lines between sections, and long
 * provenance notes. A JSON.stringify round-trip would reformat all of it and bury a 1-line
 * baseline change in a 200-line diff — the opposite of what a file whose purpose is
 * reviewability needs. So: replace the one `"baseline": N` inside the named metric's block,
 * and append the log entry inside `entries: [ … ]`. */
function replaceField(text, key, field, next) {
  const re = new RegExp(`("${key}"\\s*:\\s*\\{[\\s\\S]*?"${field}"\\s*:\\s*)(\\d+)`);
  if (!re.test(text)) die(`could not locate "${field}" inside the "${key}" block in perf-budgets.json — refusing to guess.`);
  return text.replace(re, (_m, head) => `${head}${next}`);
}

function appendEntries(text, entries) {
  const at = text.indexOf('"entries": [');
  if (at < 0) die('could not locate "entries": [ in bundle.ratchetLog — refusing to guess.');
  let depth = 0, i = text.indexOf("[", at), close = -1;
  for (; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") { depth--; if (depth === 0) { close = i; break; } }
  }
  if (close < 0) die("bundle.ratchetLog.entries is not a closed array — refusing to guess.");
  const before = text.slice(0, close).replace(/\s*$/, "");
  const needsComma = /[}\]]$/.test(before);
  const body = entries.map((e) => JSON.stringify(e, null, 2).split("\n").map((l) => `        ${l}`).join("\n")).join(",\n");
  return `${before}${needsComma ? "," : ""}\n${body}\n      ${text.slice(close)}`;
}

const entries = applied.map((a) => ({
  metric: a.path, from: a.from, to: a.to,
  direction: a.raising ? "raise" : "ratchet",
  item, date, reason: reason.trim(),
}));

if (!DRY) {
  let out = budgetsText;
  for (const a of applied) {
    out = replaceField(out, a.key, "baseline", a.to);
    if (a.targetTracked) out = replaceField(out, a.key, "target", a.to);
  }
  out = appendEntries(out, entries);
  JSON.parse(out); // never write a file we just broke
  writeFileSync(BUDGETS, out);
}

console.log(`${DRY ? "(dry run) " : ""}Baselines moved — item ${item}:`);
for (const a of applied) {
  const arrow = a.raising ? "RAISED" : "ratcheted";
  console.log(`  ${arrow} ${a.path}: ${kb(a.from)} → ${kb(a.to)} (${a.to - a.from >= 0 ? "+" : "−"}${kb(Math.abs(a.to - a.from))})`);
}
for (const s of skipped) console.log(`  · skipped ${s.path}: ${s.why}`);
console.log(`\nReason recorded: ${reason.trim()}`);
if (!DRY) console.log("Commit ui-audit/perf-budgets.json with the change it describes — the log entry and the code belong in one commit.");
