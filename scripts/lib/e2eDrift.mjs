/* e2eDrift — the pure decisions behind scripts/e2e-drift-gate.mjs (B266080).
 *
 * Split out so the verdict can be unit-tested without a Playwright run, a browser or a
 * filesystem. The script above is I/O and wording; everything that decides pass/fail is here.
 */

/** Flatten a Playwright JSON report into one row per spec, with a settled status.
 *
 * `ok` is Playwright's own post-retry verdict. A case that failed once and passed on a retry is
 * FLAKY, not red — counting flakes as failures would churn the ledger on noise, and a ledger
 * that churns is a ledger people stop reading.
 *
 * ⚠ TWO SHAPE FACTS ABOUT THE REAL REPORTER, both learned the hard way (B266086), because the
 * first cut of this function was written against a FABRICATED fixture and got both wrong. Every
 * id it produced missed the ledger, so on its first real run the gate would have reported all 61
 * ledgered cases as "did not run" and all 33 failures as brand-new regressions. It fails LOUD
 * rather than false-green, which is the one mercy — but it would have been useless noise.
 *
 *   1. `spec.file` is relative to `config.rootDir` (the testDir — here `<repo>/e2e`), so it reads
 *      `pond-outlet-clear.spec.js`. Every human-facing id in this repo — the list reporter's
 *      output, the CI report, `e2e/known-red.json` — is REPO-relative. Re-prefix it.
 *   2. The TOP-LEVEL suite of each file is the FILE, with `title === file`. Including it in the
 *      title chain duplicates the filename: `pond-outlet-clear.spec.js:63 ›
 *      pond-outlet-clear.spec.js › Pond outlet fields …`. Skip a suite that names its own file.
 *
 * `test/e2eDriftGate.test.js` now pins both against a fixture captured from a REAL run, not a
 * hand-written one. A fixture you invented can only ever confirm what you already believed.
 *
 * ⛔ A THIRD SHAPE FACT, B1857904 — `spec.ok` DOES NOT ESTABLISH THAT A TEST RAN. Playwright never
 * counts a skip as a failure, so a genuinely SKIPPED case (e.g. `e2e/auth.setup.js`'s "authenticate
 * once" step, skipped whenever E2E_EMAIL/E2E_PASSWORD are absent — see playwright.config.js) reports
 * `spec.ok: true` with `tests[0].status: "skipped"`, exactly like a real pass. The code below used to
 * branch on `spec.ok` and "flaky" only, so it silently classified that skip as "passed" — proven
 * against the REAL committed fixture (`test/fixtures/playwright-report.sample.json`'s own
 * "authenticate once" row) and independently against a fresh capture from the locked
 * @playwright/test 1.61.1, both before this fix landed. The cost is not cosmetic: `nextLedger`'s
 * `--update` drops a ledger row the instant its case reads "passed", so a required case that merely
 * failed to RUN (a missing secret, a filtered project) could have silently discharged a real
 * known-red row with no case ever having executed. `tests[].status` is the reporter's own explicit
 * verdict per attempt and is checked FIRST, before the `spec.ok` fallback, so a skip can never be
 * mistaken for a pass again. */
export function collectCases(report, { root = null } = {}) {
  const rootDir = report?.config?.rootDir || "";
  // The testDir's path relative to the repo, e.g. "e2e". With no repo root to measure against,
  // the last segment of rootDir is the best available answer and is right for a flat testDir.
  let prefix = "";
  if (rootDir) {
    const norm = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "");
    const r = norm(rootDir);
    const base = root ? norm(root) : null;
    prefix = base && r.startsWith(`${base}/`) ? r.slice(base.length + 1) : r.split("/").pop();
  }
  const withPrefix = (file) => (prefix && !String(file).includes("/") ? `${prefix}/${file}` : file);

  const out = [];
  const walk = (suite, trail) => {
    // Skip the per-file suite level; keep every describe block.
    const isFileSuite = suite.title && suite.file && suite.title === suite.file;
    const here = suite.title && !isFileSuite ? [...trail, suite.title] : trail;
    for (const spec of suite.specs || []) {
      const ran = (spec.tests || []).flatMap((t) => t.results || []);
      const testStatuses = (spec.tests || []).map((t) => t.status);
      // A spec is genuinely skipped only when EVERY test entry says so — a mixed multi-project
      // result (skipped on one project, run on another) falls through to the ok/flaky/failed
      // logic below exactly as it always has; this collector does not track project identity.
      const status = testStatuses.length && testStatuses.every((s) => s === "skipped")
        ? "skipped"
        : spec.ok
          ? (testStatuses.some((s) => s === "flaky") ? "flaky" : "passed")
          : ran.length ? "failed" : "skipped";
      const file = withPrefix(spec.file);
      out.push({ id: `${file}:${spec.line} › ${[...here, spec.title].filter(Boolean).join(" › ")}`, file, status });
    }
    for (const s of suite.suites || []) walk(s, here);
  };
  for (const s of report?.suites || []) walk(s, []);
  return out;
}

/** Whether a report reflects a FULL run, never a filtered/diagnostic one silently wearing a
 * release-complete report's clothes (B1857904, reliability programme R1 — see
 * docs/RELIABILITY-PROGRAMME.md). Neither the pass/fail diff nor a raw case count can tell a
 * genuinely full suite from one narrowed by `--grep`, `--project` or `--shard`: fewer cases run,
 * but nothing about WHICH ones is visibly wrong from the diff alone.
 *
 * Two signals, both real fields on a Playwright JSON report and both measured directly against
 * the locked @playwright/test 1.61.1 before this was written:
 *   - `config.shard` is `null` unless `--shard` narrowed the run, in which case it is the
 *     structured `{ current, total }` Playwright itself resolved.
 *   - `config.argv` is the LITERAL command line Playwright ran, so a `--grep` / `--grep-invert` /
 *     `--project` flag shows up verbatim. `config.grep` / `config.grepInvert` do NOT work for this:
 *     Playwright serializes the parsed RegExp to `{}` in the JSON report REGARDLESS of whether a
 *     filter was passed — confirmed by running the same suite with and without `--grep` and diffing
 *     the two reports; both read `"grep": {}`. Only `argv` carries the fact.
 *
 * Deliberately narrow: this reports the signal, it does not itself fail a run. `e2e-drift-gate.mjs`
 * decides whether that matters for the lane it was asked about — today's `ci`/`local` lanes are
 * genuinely never filtered, so wiring this in as fatal-by-default would change no existing verdict,
 * but that wiring is left for the critical-interaction lane (R2) rather than assumed here. */
export function assessCompleteness(report) {
  const cfg = report?.config || {};
  const reasons = [];

  const shard = cfg.shard;
  if (shard && Number.isInteger(shard.total) && shard.total > 1) {
    reasons.push(`sharded (${shard.current}/${shard.total}) — only one slice of the suite ran`);
  }

  const argv = Array.isArray(cfg.argv) ? cfg.argv.join(" ") : "";
  if (/(^|\s)(--grep(-invert)?(=|\s)|-g\s)/.test(argv)) {
    reasons.push(`invoked with a --grep filter: ${argv}`);
  }
  if (/(^|\s)--project(=|\s)/.test(argv)) {
    reasons.push(`invoked with a --project filter: ${argv}`);
  }

  return { full: reasons.length === 0, reasons };
}

/**
 * Compare a run against the ledger for one lane. Fails on BOTH sides of the comparison:
 *   novel — a failing case that is not on the ledger. The NEW regression a permanently-red
 *           suite would otherwise hide completely.
 *   stale — a ledger case that PASSED. The amnesty outlived the failure; it must shrink.
 * `absent` (listed, but did not run — renamed or filtered) is reported and is NOT fatal, but it
 * is also NOT treated as a fix: dropping it silently would let a rename launder a red case away.
 */
export function compare({ cases, entries, lane }) {
  const mine = (entries || []).filter((e) => e.lane === lane);
  const known = new Set(mine.map((e) => e.id));
  const failed = new Set(cases.filter((c) => c.status === "failed").map((c) => c.id));
  const passed = new Set(cases.filter((c) => c.status === "passed" || c.status === "flaky").map((c) => c.id));

  const novel = [...failed].filter((id) => !known.has(id));
  const passing = mine.filter((e) => passed.has(e.id));
  /* B266087 — a row PROVEN to flip between runs is not evidence of a fix when it passes.
   *
   * Measured on the first two real runs of this gate: run #41 saw five cases fail after two
   * retries each; run #42 saw the same five pass. They all reach an EXTERNAL GIS service, so
   * they flip with that service's availability, not with the code. Under a plain
   * "a passing ledger row is fatal" rule the gate goes red on every wobble in somebody else's
   * server — and I wrote the warning myself before I had the data: *a ledger that churns is a
   * ledger people stop reading.* Shipping that would have rebuilt the noise machine this whole
   * item exists to dismantle.
   *
   * So an `intermittent` row's PASS is reported and not fatal. It is not an amnesty and cannot
   * be used as one: the row still counts toward the debt, it still fails the gate when it is
   * the FIRST time a case appears, and the marker demands EVIDENCE — `{ passedRun, failedRun }`,
   * two run numbers that actually observed both outcomes. `validateLedger()` rejects a marker
   * without them, so "this one is flaky" can never be asserted to silence something. */
  const stale = passing.filter((e) => !e.intermittent);
  const staleIntermittent = passing.filter((e) => e.intermittent);
  const absent = mine.filter((e) => !passed.has(e.id) && !failed.has(e.id));
  // B1857904 — visible, never fatal here. A genuinely skipped required case used to be
  // misreported as "passed" (see collectCases' header); now that it reads "skipped" it must not
  // become INVISIBLE instead. Surfacing the count is the narrow fix for THIS lane; whether a skip
  // should fail a lane is a release-contract question left to the critical-interaction lane (R2).
  const skipped = cases.filter((c) => c.status === "skipped").length;

  return {
    lane, ran: cases.length, failed: failed.size, knownRed: known.size, skipped,
    novel, stale, staleIntermittent, absent,
    ok: novel.length === 0 && stale.length === 0,
  };
}

/** Structural rules a committed ledger must satisfy. Returns a list of problems (empty = fine). */
export function validateLedger(entries) {
  const bad = [];
  for (const e of entries || []) {
    if (!/^(ci|local)$/.test(e.lane || "")) bad.push(`${e.id}: lane must be ci or local`);
    if (!/^B\d+$/.test(e.item || "")) bad.push(`${e.id}: no owning backlog item`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.firstSeen || "")) bad.push(`${e.id}: no firstSeen date`);
    if (e.intermittent) {
      const m = e.intermittent;
      // The marker is the one thing here that WEAKENS the gate, so it is the one thing that has
      // to be earned. Two run numbers that actually saw both outcomes, or it is not admissible.
      if (!Number.isInteger(m.passedRun) || !Number.isInteger(m.failedRun)) {
        bad.push(`${e.id}: intermittent needs evidence — { passedRun, failedRun } run numbers that observed both outcomes`);
      } else if (m.passedRun === m.failedRun) {
        bad.push(`${e.id}: intermittent evidence cites the same run (${m.passedRun}) for both outcomes`);
      }
    }
  }
  return bad;
}

/** The ledger after an --update: listed-and-still-failing kept, passing dropped, novel added. */
export function nextLedger({ entries, cases, lane, novel, today, item }) {
  const passed = new Set(cases.filter((c) => c.status === "passed" || c.status === "flaky").map((c) => c.id));
  const kept = (entries || []).filter((e) => e.lane !== lane || !passed.has(e.id));
  const added = novel.map((id) => ({ id, lane, firstSeen: today, item: item ?? null }));
  return [...kept, ...added].sort((a, b) => `${a.lane}${a.id}`.localeCompare(`${b.lane}${b.id}`));
}
