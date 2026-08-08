/* B266080 — the e2e drift gate's verdict, unit-tested without a browser.
 *
 * WHAT IS BEING GUARDED, restated so a future reader knows what a failure here means. The
 * `E2E (Playwright)` workflow was red on 17 consecutive scheduled runs and nobody knew,
 * because a permanently-red suite emits the identical signal whether one case is broken or
 * thirty-one are. The gate restores the distinction by diffing the run against a committed
 * ledger. These tests pin BOTH halves of that diff — a new failure, and a stale entry —
 * because a gate that only checks one half is exactly the half-guard that rotted the first
 * time: it would let the ledger grow into a permanent amnesty.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { collectCases, compare, nextLedger, validateLedger } from "../scripts/lib/e2eDrift.mjs";

/** A minimal Playwright JSON report, shaped exactly as the real reporter emits it. */
const report = (specs) => ({
  suites: [{
    title: "",
    suites: [{
      title: "a describe block",
      specs: specs.map(([file, line, title, ok, opts = {}]) => ({
        file, line, title, ok,
        tests: [{ status: opts.flaky ? "flaky" : ok ? "expected" : "unexpected", results: opts.skipped ? [] : [{ status: ok ? "passed" : "failed" }] }],
      })),
    }],
  }],
});

const id = (file, line, title) => `${file}:${line} › a describe block › ${title}`;

describe("collectCases", () => {
  it("gives every spec a stable id of file:line › suite › title", () => {
    const cases = collectCases(report([["e2e/a.spec.js", 10, "does a thing", true]]));
    expect(cases).toEqual([{ id: id("e2e/a.spec.js", 10, "does a thing"), file: "e2e/a.spec.js", status: "passed" }]);
  });

  it("counts a case that passed on retry as FLAKY, not failed", () => {
    // A ledger that churns on flakes is a ledger people stop reading, so a flake must never
    // enter it — but it must not be silently invisible either, hence its own status.
    const cases = collectCases(report([["e2e/a.spec.js", 10, "sometimes", true, { flaky: true }]]));
    expect(cases[0].status).toBe("flaky");
  });

  it("distinguishes a skipped case from a failed one", () => {
    const cases = collectCases(report([["e2e/a.spec.js", 10, "gated on secrets", false, { skipped: true }]]));
    expect(cases[0].status).toBe("skipped");
  });

  it("returns nothing for an empty report rather than inventing a green run", () => {
    expect(collectCases({})).toEqual([]);
    expect(collectCases({ suites: [] })).toEqual([]);
  });
});

describe("compare — the gate's verdict", () => {
  const ledger = [
    { id: id("e2e/known.spec.js", 5, "long broken"), lane: "ci", item: "B266081" },
    { id: id("e2e/other.spec.js", 7, "broken locally"), lane: "local", item: "B266081" },
  ];

  it("passes when the only failures are the ones on the ledger", () => {
    const cases = collectCases(report([
      ["e2e/known.spec.js", 5, "long broken", false],
      ["e2e/fine.spec.js", 1, "works", true],
    ]));
    const v = compare({ cases, entries: ledger, lane: "ci" });
    expect(v.ok).toBe(true);
    expect(v.knownRed).toBe(1);
    expect(v.failed).toBe(1);
  });

  it("FAILS on a failure that is not on the ledger — the signal a red suite destroys", () => {
    const cases = collectCases(report([
      ["e2e/known.spec.js", 5, "long broken", false],
      ["e2e/fresh.spec.js", 9, "just regressed", false],
    ]));
    const v = compare({ cases, entries: ledger, lane: "ci" });
    expect(v.ok).toBe(false);
    expect(v.novel).toEqual([id("e2e/fresh.spec.js", 9, "just regressed")]);
  });

  it("FAILS on a ledger entry that PASSED — the amnesty must end when the failure does", () => {
    const cases = collectCases(report([["e2e/known.spec.js", 5, "long broken", true]]));
    const v = compare({ cases, entries: ledger, lane: "ci" });
    expect(v.ok).toBe(false);
    expect(v.stale.map((e) => e.id)).toEqual([id("e2e/known.spec.js", 5, "long broken")]);
  });

  it("treats a flaky ledger entry as fixed, so a flake cannot hold an amnesty open", () => {
    const cases = collectCases(report([["e2e/known.spec.js", 5, "long broken", true, { flaky: true }]]));
    expect(compare({ cases, entries: ledger, lane: "ci" }).stale).toHaveLength(1);
  });

  it("reports a ledger entry that did NOT run, and does not treat it as fixed", () => {
    // A rename must never launder a red case away by making its ledger row simply vanish.
    const cases = collectCases(report([["e2e/fine.spec.js", 1, "works", true]]));
    const v = compare({ cases, entries: ledger, lane: "ci" });
    expect(v.absent.map((e) => e.id)).toEqual([id("e2e/known.spec.js", 5, "long broken")]);
    expect(v.stale).toHaveLength(0);
    expect(v.ok).toBe(true); // reported, never fatal — it is ambiguous, not a regression
  });

  it("NEVER lets one lane's entry silence another lane's failure", () => {
    // Measured 2026-08-08, 13 of the two lanes' 38 distinct red cases were red in ONE lane only
    // (5 ci-only, 8 local-only), so neither lane is a substitute for the other and a ci amnesty
    // must never cover a local failure. That gap is how B1179's other two specs ended up with
    // no watcher anywhere.
    const cases = collectCases(report([["e2e/other.spec.js", 7, "broken locally", false]]));
    expect(compare({ cases, entries: ledger, lane: "ci" }).ok).toBe(false);   // not on the ci ledger
    expect(compare({ cases, entries: ledger, lane: "local" }).ok).toBe(true); // it is on the local one
  });
});

describe("nextLedger — the count is a debt that may only fall on its own", () => {
  const entries = [
    { id: "a", lane: "ci", item: "B1" },
    { id: "b", lane: "ci", item: "B1" },
    { id: "c", lane: "local", item: "B1" },
  ];

  it("drops entries whose case now passes", () => {
    const cases = [{ id: "a", status: "passed" }, { id: "b", status: "failed" }];
    const next = nextLedger({ entries, cases, lane: "ci", novel: [], today: "2026-08-08", item: null });
    expect(next.filter((e) => e.lane === "ci").map((e) => e.id)).toEqual(["b"]);
  });

  it("leaves the other lane completely alone", () => {
    const cases = [{ id: "a", status: "passed" }, { id: "b", status: "passed" }];
    const next = nextLedger({ entries, cases, lane: "ci", novel: [], today: "2026-08-08", item: null });
    expect(next.filter((e) => e.lane === "local")).toHaveLength(1);
  });

  it("stamps every added entry with the owning item, so no red case is unowned", () => {
    const cases = [{ id: "a", status: "failed" }, { id: "z", status: "failed" }];
    const next = nextLedger({ entries, cases, lane: "ci", novel: ["z"], today: "2026-08-08", item: "B999" });
    const added = next.find((e) => e.id === "z");
    expect(added).toMatchObject({ lane: "ci", item: "B999", firstSeen: "2026-08-08" });
  });
});

describe("the committed ledger itself", () => {
  const ledger = JSON.parse(readFileSync(new URL("../e2e/known-red.json", import.meta.url), "utf8"));

  it("gives every known-red case a lane, a first-seen date and an owning item", () => {
    // "A diagnosis without an owner" is the exact intake failure this repo has a standing rule
    // against. A row here with no item would be that failure wearing a machine-readable coat.
    for (const e of ledger.entries) {
      expect(e.lane, `${e.id} has no lane`).toMatch(/^(ci|local)$/);
      expect(e.item, `${e.id} has no owning backlog item`).toMatch(/^B\d+$/);
      expect(e.firstSeen, `${e.id} has no firstSeen date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("holds no duplicate id within a lane", () => {
    for (const lane of ["ci", "local"]) {
      const ids = ledger.entries.filter((e) => e.lane === lane).map((e) => e.id);
      expect(new Set(ids).size, `duplicate ids in the ${lane} lane`).toBe(ids.length);
    }
  });

  it("names a real spec file for every entry", () => {
    for (const e of ledger.entries) expect(e.id, `${e.id} is not shaped file.spec.js:line › …`).toMatch(/^e2e\/[\w.-]+\.spec\.js:\d+ › /);
  });
});

/* ---- B266086 — pinned against a REAL reporter fixture, not an invented one ----------------
 *
 * The `report()` helper above is hand-written, and the first cut of `collectCases()` was written
 * against it. It got TWO structural facts wrong and the tests passed anyway, because a fixture
 * you invented can only ever confirm what you already believed:
 *   1. `spec.file` is relative to `config.rootDir` (the testDir), not to the repo.
 *   2. The top-level suite of each file IS the file (`title === file`), so including it in the
 *      title chain prints the filename twice.
 * On its first real run every id would have missed the ledger — all 61 ledgered cases reported
 * as "did not run", all 33 failures reported as brand-new regressions. Loud, not false-green,
 * which is the one mercy; useless noise all the same.
 *
 * This fixture was CAPTURED from `npx playwright test --reporter=json` against this repo. Only
 * the bulky per-result payloads were dropped. It is the instrument's own output, so the guard
 * can no longer be wrong in the same direction as the thing it guards.
 */
describe("the REAL Playwright reporter shape (captured fixture)", () => {
  const real = JSON.parse(readFileSync(new URL("./fixtures/playwright-report.sample.json", import.meta.url), "utf8"));
  const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const cases = collectCases(real, { root: ROOT });

  it("re-prefixes spec.file back to repo-relative", () => {
    // Playwright says "pond-outlet-clear.spec.js"; every id in this repo says "e2e/…".
    expect(cases.every((c) => c.file.startsWith("e2e/")), cases.map((c) => c.file).join(", ")).toBe(true);
  });

  it("does not repeat the filename inside the title chain", () => {
    for (const c of cases) {
      const titles = c.id.split(" › ").slice(1);
      expect(titles, `filename repeated in: ${c.id}`).not.toContain("pond-outlet-clear.spec.js");
    }
  });

  it("produces exactly the id shape the committed ledger uses", () => {
    const failing = cases.filter((c) => c.status === "failed").map((c) => c.id);
    expect(failing).toEqual([
      "e2e/pond-outlet-clear.spec.js:63 › Pond outlet fields — clear + persistence (B901) › Allowable release (cfs) can be set, then fully CLEARED via select-all + delete",
      "e2e/pond-outlet-clear.spec.js:97 › Pond outlet fields — clear + persistence (B901) › proposing then removing an outlet, then reloading, shows NO outlet (local persistence)",
    ]);
  });

  it("those ids are ON the committed local-lane ledger — the end-to-end match", () => {
    // This is the assertion that would have caught the defect. It compares the instrument's own
    // output against the file the instrument is judged by, with nothing hand-written between.
    const ledger = JSON.parse(readFileSync(new URL("../e2e/known-red.json", import.meta.url), "utf8"));
    const local = new Set(ledger.entries.filter((e) => e.lane === "local").map((e) => e.id));
    for (const c of cases.filter((c) => c.status === "failed")) {
      expect(local.has(c.id), `real reporter id is not on the ledger:\n  ${c.id}`).toBe(true);
    }
  });

  it("a report with no rootDir still parses, leaving the file as reported", () => {
    // Never throw on a shape we did not expect — the gate's job is to fail with a reason.
    const noRoot = { suites: real.suites };
    expect(collectCases(noRoot).length).toBe(cases.length);
  });
});

/* ---- B266087 — the intermittent marker, and why it is not an amnesty ----------------------
 *
 * Measured on the gate's first two real runs: run #41 saw five cases fail after two retries
 * each, run #42 saw the same five pass. All reach an EXTERNAL GIS service, so they flip with
 * that service's availability rather than with the code. Under a plain "a passing ledger row is
 * fatal" rule the gate goes red on every wobble in somebody else's server — the noise machine
 * this whole item exists to dismantle, rebuilt by the fix for it.
 *
 * The marker is the one thing here that WEAKENS the gate, so it is the one thing that has to be
 * earned: two run numbers that actually observed both outcomes, or the ledger is refused.
 */
describe("intermittent rows: reported, never an amnesty", () => {
  const flip = { failedRun: 41, passedRun: 42, why: "external GIS service" };
  const ledger = [
    { id: "solid", lane: "ci", item: "B1", firstSeen: "2026-08-08" },
    { id: "flappy", lane: "ci", item: "B1", firstSeen: "2026-08-08", intermittent: flip },
  ];

  it("a passing intermittent row is reported and does NOT fail the gate", () => {
    const cases = [{ id: "solid", status: "failed" }, { id: "flappy", status: "passed" }];
    const v = compare({ cases, entries: ledger, lane: "ci" });
    expect(v.ok).toBe(true);
    expect(v.stale).toHaveLength(0);
    expect(v.staleIntermittent.map((e) => e.id)).toEqual(["flappy"]);
  });

  it("a passing ORDINARY row still fails the gate — the marker is not retroactive cover", () => {
    const cases = [{ id: "solid", status: "passed" }, { id: "flappy", status: "failed" }];
    expect(compare({ cases, entries: ledger, lane: "ci" }).ok).toBe(false);
  });

  it("an intermittent row still counts toward the debt", () => {
    const cases = [{ id: "solid", status: "failed" }, { id: "flappy", status: "passed" }];
    expect(compare({ cases, entries: ledger, lane: "ci" }).knownRed).toBe(2);
  });

  it("the marker CANNOT silence a case that is not on the ledger at all", () => {
    // The relief only ever applies to an already-recorded row. A brand-new failure is novel
    // whatever anyone claims about it, which is what stops "it's flaky" being a free pass.
    const cases = [{ id: "brand-new", status: "failed" }];
    expect(compare({ cases, entries: ledger, lane: "ci" }).novel).toEqual(["brand-new"]);
  });

  it("validateLedger REFUSES a marker with no evidence", () => {
    expect(validateLedger([{ id: "x", lane: "ci", item: "B1", firstSeen: "2026-08-08", intermittent: true }])[0])
      .toMatch(/needs evidence/);
    expect(validateLedger([{ id: "x", lane: "ci", item: "B1", firstSeen: "2026-08-08", intermittent: { passedRun: 42 } }])[0])
      .toMatch(/needs evidence/);
  });

  it("validateLedger REFUSES evidence that cites one run for both outcomes", () => {
    expect(validateLedger([{ id: "x", lane: "ci", item: "B1", firstSeen: "2026-08-08", intermittent: { passedRun: 42, failedRun: 42 } }])[0])
      .toMatch(/same run/);
  });

  it("the COMMITTED ledger is sound by those rules", () => {
    const led = JSON.parse(readFileSync(new URL("../e2e/known-red.json", import.meta.url), "utf8"));
    expect(validateLedger(led.entries)).toEqual([]);
  });
});
