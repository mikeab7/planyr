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
 * hand-written one. A fixture you invented can only ever confirm what you already believed. */
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
      const status = spec.ok
        ? ((spec.tests || []).some((t) => t.status === "flaky") ? "flaky" : "passed")
        : ran.length ? "failed" : "skipped";
      const file = withPrefix(spec.file);
      out.push({ id: `${file}:${spec.line} › ${[...here, spec.title].filter(Boolean).join(" › ")}`, file, status });
    }
    for (const s of suite.suites || []) walk(s, here);
  };
  for (const s of report?.suites || []) walk(s, []);
  return out;
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

  return {
    lane, ran: cases.length, failed: failed.size, knownRed: known.size,
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
