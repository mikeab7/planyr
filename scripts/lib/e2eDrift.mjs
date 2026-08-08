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
  const stale = mine.filter((e) => passed.has(e.id));
  const absent = mine.filter((e) => !passed.has(e.id) && !failed.has(e.id));

  return {
    lane, ran: cases.length, failed: failed.size, knownRed: known.size,
    novel, stale, absent,
    ok: novel.length === 0 && stale.length === 0,
  };
}

/** The ledger after an --update: listed-and-still-failing kept, passing dropped, novel added. */
export function nextLedger({ entries, cases, lane, novel, today, item }) {
  const passed = new Set(cases.filter((c) => c.status === "passed" || c.status === "flaky").map((c) => c.id));
  const kept = (entries || []).filter((e) => e.lane !== lane || !passed.has(e.id));
  const added = novel.map((id) => ({ id, lane, firstSeen: today, item: item ?? null }));
  return [...kept, ...added].sort((a, b) => `${a.lane}${a.id}`.localeCompare(`${b.lane}${b.id}`));
}
