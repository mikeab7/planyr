#!/usr/bin/env node
/* e2e-drift-gate — B266080. A red suite must still be able to catch a NEW regression.
 *
 * THE FAILURE THIS EXISTS TO END, with the measurement that found it. On 2026-08-08 the
 * `E2E (Playwright)` workflow had failed on 17 CONSECUTIVE scheduled runs — every weekday
 * since 2026-07-22, last green 2026-07-21 — reporting 30 failing cases against production.
 * It filed correctly every time. It is idempotent by design, so all 17 reports landed as
 * comments on ONE issue (#762), which nobody answered for 17 days. The tracker was never
 * "full of noise"; the alarm was MUTE. And for those 17 days the suite provided ZERO
 * protection: every run was red, so a brand-new regression would have changed nothing about
 * the signal anyone saw. That is the same class as the swallowing telemetry sink and the
 * sustain window that fired least when the lag was worst — a guard that has already failed,
 * where nobody can tell.
 *
 * THE FIX IS NOT "GO FIX 30 TESTS" (that is real work, tracked separately and honestly). The
 * fix is that a red suite must still be ABLE to go redder in a way anyone can see. So:
 *
 *   • `e2e/known-red.json` is a COMMITTED LEDGER of the cases that are known to fail, each
 *     with the lane it fails in, the date it was first seen, and the backlog item that owns
 *     it. It lives in the repo, in a code review, in a diff — not in a muted issue thread.
 *   • This gate compares the run's ACTUAL failures against that ledger and fails on either
 *     side of the comparison:
 *       – a failure NOT in the ledger  → a NEW regression. This is the signal that was lost.
 *       – a ledger entry that PASSED   → the ledger is STALE and must shrink.
 *     The second half is what stops the ledger becoming a permanent amnesty: you cannot fix
 *     something and leave it listed, and you cannot list something speculatively.
 *   • The ledger COUNTS. It is a set, its size is printed on every run, and `--update` refuses
 *     to grow it without `--allow-grow`. Deliberately a count and a set membership, never a
 *     duration or a rate: this repo has been bitten four times in two days by guards that
 *     measured how long something took instead of how many times it happened.
 *
 * LANES, because the two configurations do NOT see the same thing. `ci` is the scheduled run:
 * signed in, against production planyr.io. `local` is `npm run e2e` with no BASE_URL — logged
 * out, against a local build of the working tree — and nothing in this repository had ever run
 * it. Measured head-to-head on 2026-08-08 (ci run #41, 30 red · a full local sweep, 33 red):
 *
 *     25 red in BOTH   ·   5 red only in ci   ·   8 red only in local
 *
 * Two things follow, and they pull in opposite directions, which is why the lanes are separate
 * rather than merged. The 25 overlap means the standing failures are NOT production or auth
 * noise: they reproduce on a plain local build with no account, so they are real and they are
 * fixable by anyone. And the 13 that differ mean neither lane is a substitute for the other —
 * a case red in one is no evidence at all about the other, so the ledger never lets one lane's
 * entry silence the other lane's failure.
 *
 *   node scripts/e2e-drift-gate.mjs --report playwright-report.json --lane ci
 *   node scripts/e2e-drift-gate.mjs --report playwright-report.json --lane ci --update
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collectCases, compare, nextLedger, validateLedger } from "./lib/e2eDrift.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const LEDGER = join(ROOT, "e2e", "known-red.json");

const argOf = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const has = (f) => process.argv.includes(f);
const REPORT = argOf("--report");
const LANE = argOf("--lane") || "ci";
const UPDATE = has("--update");
const ALLOW_GROW = has("--allow-grow");
const ITEM = argOf("--item") || null;

const die = (msg, extra = []) => { console.error(`✗ ${msg}`); for (const l of extra) console.error(`  ${l}`); process.exit(2); };

if (!["ci", "local"].includes(LANE)) die(`unknown lane "${LANE}" — expected ci or local.`);
if (!REPORT) die("--report <playwright json report> is required.", [
  "Produce one with:  npx playwright test --reporter=json > report.json",
  "A gate with no report to read must never pass by default.",
]);
if (!existsSync(REPORT)) die(`no report at ${REPORT} — NOT OBSERVING.`, [
  "The suite did not produce a machine-readable result, so this run proves nothing about it.",
  "Failing rather than passing is the whole point: a gate that green-lights a missing input is",
  "the exact shape of the alarm this script was written to replace.",
]);

/* ---- Read the run --------------------------------------------------------------------- */
let cases;
try {
  cases = collectCases(JSON.parse(readFileSync(REPORT, "utf8")), { root: ROOT });
} catch (e) {
  die(`could not read ${REPORT} as a Playwright JSON report (${e.message}) — NOT OBSERVING.`);
}
if (!cases.length) die(`${REPORT} contains no test cases at all — NOT OBSERVING.`, [
  "An empty run is not a green run. Something stopped the suite before it executed anything.",
]);

/* ---- Read the ledger ------------------------------------------------------------------ */
const ledger = existsSync(LEDGER)
  ? JSON.parse(readFileSync(LEDGER, "utf8"))
  : { $comment: [], entries: [] };

const bad = validateLedger(ledger.entries);
if (bad.length) die(`e2e/known-red.json is malformed — refusing to judge a run against a ledger that is not sound.`, bad.slice(0, 10));

const { novel, stale, staleIntermittent, absent, failed, knownRed, ran } = compare({ cases, entries: ledger.entries, lane: LANE });

/* ---- --update: the ledger may SHRINK freely and GROW only deliberately ----------------- */
if (UPDATE) {
  if (novel.length && !ALLOW_GROW) {
    die(`${novel.length} failing case(s) are not in the ledger, and --update will not add them implicitly.`, [
      "Growing the known-red list is an admission that something new is broken and is NOT being",
      "fixed right now. Say so on purpose: add --allow-grow --item B###.",
      ...novel.slice(0, 10).map((id) => `  + ${id}`),
    ]);
  }
  if (novel.length && !ITEM) die("--allow-grow also requires --item B### — a red case with no owner is how this rotted the first time.");
  ledger.entries = nextLedger({
    entries: ledger.entries, cases, lane: LANE, novel,
    today: new Date().toISOString().slice(0, 10), item: ITEM,
  });
  writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`Ledger updated: ${stale.length} removed (now passing), ${novel.length} added. Lane "${LANE}" now holds ${ledger.entries.filter((e) => e.lane === LANE).length}.`);
  process.exit(0);
}

/* ---- Report --------------------------------------------------------------------------- */
console.log(`e2e drift gate (B266080) — lane "${LANE}"\n`);
console.log(`  ${ran} case(s) ran · ${failed} failed · ${knownRed} on the known-red ledger\n`);

for (const id of novel) console.log(`  ✗ NEW FAILURE (not on the ledger): ${id}`);
for (const e of stale) console.log(`  ✗ STALE LEDGER ENTRY (this case PASSED): ${e.id}${e.item ? `  [${e.item}]` : ""}`);
for (const e of staleIntermittent) console.log(`  ⓘ known-INTERMITTENT entry passed this run (runs ${e.intermittent.failedRun} failed / ${e.intermittent.passedRun} passed) — not fatal, still on the ledger: ${e.id}`);
for (const e of absent) console.log(`  ⓘ ledger entry did not run (renamed or filtered?): ${e.id}`);

if (!novel.length && !stale.length) {
  console.log(`  ✓ no new failures, and every ledger entry is still genuinely red.`);
  if (knownRed) {
    console.log(`\n  ${knownRed} case(s) remain KNOWN-RED in this lane. That number is the debt, it is visible`);
    console.log("  in the repo rather than in an issue thread, and it may only go down without a deliberate");
    console.log("  --allow-grow --item. See e2e/known-red.json for who owns each one.");
  }
  process.exit(0);
}

console.log();
if (novel.length) {
  console.log(`✗ ${novel.length} NEW failing case(s). This is the signal a permanently-red suite destroys:`);
  console.log("  these were not failing when the ledger was written, so something regressed. Fix them, or —");
  console.log("  if they genuinely cannot be fixed now — record them on purpose:");
  console.log(`    node scripts/e2e-drift-gate.mjs --report <report> --lane ${LANE} --update --allow-grow --item B###`);
}
if (stale.length) {
  console.log(`✗ ${stale.length} ledger entry(ies) PASSED. The ledger is stale and must shrink — a known-red list`);
  console.log("  that outlives the failures it describes is an amnesty, and an amnesty is how a guard rots.");
  console.log(`    node scripts/e2e-drift-gate.mjs --report <report> --lane ${LANE} --update`);
}
process.exit(1);
