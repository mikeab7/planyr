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
import { collectCases, compare, nextLedger } from "../scripts/lib/e2eDrift.mjs";

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
