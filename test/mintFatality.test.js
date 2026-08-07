/* THE INVARIANT THIS FILE ENFORCES, in one sentence, because this is the only place it is enforced
 * rather than merely described:
 *
 *     A fatal mint verdict may only ever name an id that is HELD RIGHT NOW — present on
 *     origin/main or on a live peer branch — and never an id judged against an AGGREGATE of peer
 *     state such as a maximum, a mean, or a high-water mark.
 *
 * WHAT IT IS PROTECTING (NEW-2). On 2026-08-06 this repository could not merge anything for hours,
 * and nothing anywhere was red. The cause was a SHAPE, not a line: a check that is REQUIRED, whose
 * verdict depends on ANOTHER UNMERGED BRANCH, and whose ONLY REMEDY WORSENS THE CONDITION FOR EVERY
 * PEER. Stack those three and you get a livelock with no fixed point and no merge control offered
 * to anyone — see `docs/CI-REQUIRED-CHECK.md`.
 *
 * The offending predicate (`BELOW`: "your id is at or under `claimedMax`, so the next merge will
 * probably take it") is gone from `scripts/check-mint.mjs` and `scripts/idBlocks.mjs`. Nothing
 * forbade it coming back, and it is easy to re-derive because it sounds so reasonable. So the
 * lesson is a property CI re-proves, not a paragraph someone has to remember to read.
 *
 * Every property here is MUTATION-CHECKED, the way `test/requiredChecks.test.js` does for the
 * ruleset contract: the real repo passes, and a deliberately reintroduced `claimedMax`-style
 * predicate goes red. A guard never shown to fail is indistinguishable from one that cannot.
 *
 * Pure — no git, no network, no clock — except the one case that reads this repo's own committed
 * `check-mint.mjs`, which is therefore deterministic. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fatalityVerdict, fatalGuardVerdict, extractDecisionLoop, probeCases,
  FATALITY_INVARIANT, AGGREGATE_IDENTIFIERS,
} from "../ui-audit/lib/mintFatality.mjs";
import { mintVerdict } from "../scripts/check-mint.mjs";

const GATE_SOURCE = readFileSync(join(process.cwd(), "scripts", "check-mint.mjs"), "utf8");

/* ---- the mutants ------------------------------------------------------------------------
 * Each is the shape the guard exists to reject, written as it would plausibly be re-derived. */

/** The exact predicate that took the repo down, reinstated. */
const belowMarkMutant = ({ letter, added, claimedMax, peerOwners = new Map(), mainIds = new Set(), block = null }) => {
  const offenders = [];
  for (const n of added) {
    if (mainIds.has(n)) offenders.push({ id: `${letter}${n}`, kind: "taken", where: "origin/main" });
    else if (n <= claimedMax) offenders.push({ id: `${letter}${n}`, kind: "below", where: `claimed high-water mark ${letter}${claimedMax}` });
  }
  return { ok: offenders.length === 0, letter, offenders, advisories: [], claimedMax, block };
};

/** The same defect wearing a different aggregate — a mean rather than a maximum. */
const meanOfPeersMutant = ({ letter, added, peerOwners = new Map(), mainIds = new Set() }) => {
  const ids = [...peerOwners.keys()];
  const mean = ids.length ? ids.reduce((a, b) => a + b, 0) / ids.length : 0;
  const offenders = [];
  for (const n of added) {
    if (mainIds.has(n) || n < mean) offenders.push({ id: `${letter}${n}`, kind: "taken", where: "below the peer mean" });
  }
  return { ok: offenders.length === 0, letter, offenders, advisories: [] };
};

/** Out-of-block made fatal. No aggregate in sight — and still a prediction, not a collision. */
const outsideBlockMutant = ({ letter, added, mainIds = new Set(), block = null }) => {
  const offenders = [];
  for (const n of added) {
    if (mainIds.has(n)) offenders.push({ id: `${letter}${n}`, kind: "taken", where: "origin/main" });
    else if (block && (n < block.lo || n > block.hi)) offenders.push({ id: `${letter}${n}`, kind: "outside", where: "this branch's block" });
  }
  return { ok: offenders.length === 0, letter, offenders, advisories: [] };
};

/** The rot case: a gate that has quietly stopped failing on anything. */
const neverFatalMutant = ({ letter }) => ({ ok: true, letter, offenders: [], advisories: [] });

describe("the invariant is stated, and the battery is real", () => {
  it("names both halves of the property in one sentence", () => {
    expect(FATALITY_INVARIANT).toMatch(/HELD RIGHT NOW/);
    expect(FATALITY_INVARIANT).toMatch(/never .* AGGREGATE/i);
  });

  it("probes both directions of every aggregate — an aggregate rule cannot satisfy them all", () => {
    const cases = probeCases();
    expect(cases.length).toBeGreaterThanOrEqual(15);
    const peerMaxes = cases.map((c) => Math.max(0, ...c.input.peerOwners.keys()));
    const ids = cases.flatMap((c) => c.input.added);
    // Some unheld id sits far below the largest peer maximum, and some sits far above the smallest.
    expect(Math.max(...peerMaxes)).toBeGreaterThan(Math.max(...ids));
    expect(Math.max(...ids)).toBeGreaterThan(Math.min(...peerMaxes.filter((n) => n > 0)));
  });
});

describe("the real gate, behaviourally", () => {
  it("passes the whole battery today", () => {
    const res = fatalityVerdict(mintVerdict);
    expect(res.ok, JSON.stringify(res.violations, null, 2)).toBe(true);
    expect(res.probes).toBeGreaterThanOrEqual(15);
  });

  it("still fails on a real collision — B3005's neighbour taken on main is fatal, B3005 is not", () => {
    const v = mintVerdict({
      letter: "B", added: [3005, 1449], claimedMax: 209509,
      mainIds: new Set([1449]), peerOwners: new Map([[25005, "peer"]]),
      block: { lo: 226400, hi: 226415 },
    });
    expect(v.ok).toBe(false);
    expect(v.offenders.map((o) => o.id)).toEqual(["B1449"]);
  });

  it("an id a PEER holds is named, not failed (B36051 — only main can actually take one)", () => {
    const v = mintVerdict({
      letter: "B", added: [227475], claimedMax: 227475,
      mainIds: new Set([225984]), peerOwners: new Map([[227475, "planyr-peers/claude/other"]]),
      block: { lo: 226400, hi: 226415 },
    });
    expect(v.ok).toBe(true);
    expect(v.advisories[0]).toMatchObject({ id: "B227475", kind: "peer-held" });
  });
});

describe("MUTATION — each rejected shape goes red, and names why", () => {
  it("RED on the reinstated `claimedMax` predicate, naming B3005 as unfounded", () => {
    const res = fatalityVerdict(belowMarkMutant);
    expect(res.ok).toBe(false);
    const unfounded = res.violations.filter((v) => v.kind === "unfounded-fatal");
    expect(unfounded.length).toBeGreaterThan(0);
    expect(unfounded.map((v) => v.id)).toContain("B3005");
  });

  it("RED on a MEAN of peer state — the guard tests the property, not the spelling", () => {
    const res = fatalityVerdict(meanOfPeersMutant);
    expect(res.ok).toBe(false);
    expect(res.violations.some((v) => v.kind === "unfounded-fatal")).toBe(true);
  });

  it("RED when out-of-block is made fatal — no aggregate, still a prediction", () => {
    const res = fatalityVerdict(outsideBlockMutant);
    expect(res.ok).toBe(false);
    expect(res.violations.map((v) => v.id)).toContain("B42");
  });

  it("RED when the gate stops failing on anything at all (the rot case)", () => {
    const res = fatalityVerdict(neverFatalMutant);
    expect(res.ok).toBe(false);
    expect(res.violations.every((v) => v.kind === "missed-collision")).toBe(true);
    expect(res.violations.map((v) => v.id)).toContain("B1449");
  });

  it("RED when `ok` disagrees with the offender list a caller would read", () => {
    const res = fatalityVerdict(({ letter }) => ({ ok: true, letter, offenders: [{ id: `${letter}3005` }] }));
    expect(res.violations.some((v) => v.kind === "ok-disagrees")).toBe(true);
  });

  it("REFUSES a verdict function that throws rather than counting it as a pass", () => {
    const res = fatalityVerdict(() => { throw new Error("boom"); });
    expect(res.ok).toBe(false);
    expect(res.violations.every((v) => v.kind === "threw")).toBe(true);
  });
});

describe("the structural half — a dormant predicate the probes cannot reach", () => {
  it("this repo's committed check-mint.mjs has no aggregate in either decision loop", () => {
    const res = fatalGuardVerdict(GATE_SOURCE);
    expect(res.ok, JSON.stringify(res.violations, null, 2)).toBe(true);
    expect(res.scanned.map((s) => s.fn).sort()).toEqual(["announceVerdict", "mintVerdict"]);
  });

  it("RED when `claimedMax` is reintroduced into the decision loop, even guarded behind a flag", () => {
    // Dormant on every probe — the behavioural half by construction cannot see this one.
    const mutated = GATE_SOURCE.replace(
      "else if (peerOwners.has(n)) advisories.push(",
      "else if (process.env.STRICT_MINT && n <= claimedMax) offenders.push({ id: `${letter}${n}`, kind: \"below\" });\n    else if (peerOwners.has(n)) advisories.push(",
    );
    expect(mutated).not.toBe(GATE_SOURCE); // the anchor still exists — the mutation actually applied
    const res = fatalGuardVerdict(mutated);
    expect(res.ok).toBe(false);
    expect(res.violations[0]).toMatchObject({ kind: "aggregate-in-decision", fn: "mintVerdict", id: "claimedMax" });
  });

  it("RED on any other aggregate name, one at a time", () => {
    for (const id of ["peerMax", "highWater", "mean", "max"]) {
      const mutated = GATE_SOURCE.replace(
        "if (mainIds.has(n))",
        `if (${id} > 0) offenders.push({ id: \`\${letter}\${n}\` });\n    else if (mainIds.has(n))`,
      );
      const res = fatalGuardVerdict(mutated);
      expect(res.ok, `\`${id}\` slipped through`).toBe(false);
    }
  });

  it("does NOT fire on the prose explaining why the rule was removed", () => {
    // `check-mint.mjs` discusses `claimedMax` at length precisely because it is gone. A guard that
    // went red on its own explanation would be uninstallable.
    expect(GATE_SOURCE).toMatch(/claimedMax/);
    expect(fatalGuardVerdict(GATE_SOURCE).ok).toBe(true);
    const withComment = GATE_SOURCE.replace(
      "if (mainIds.has(n))",
      "/* the old rule compared n against claimedMax here */\n    if (mainIds.has(n))",
    );
    expect(fatalGuardVerdict(withComment).ok).toBe(true);
  });

  it("REFUSES source it cannot read rather than reporting a pass (LOUD-FAILURE)", () => {
    const res = fatalGuardVerdict("export const nothing = 1;");
    expect(res.ok).toBe(false);
    expect(res.violations.every((v) => v.kind === "unreadable")).toBe(true);
    expect(extractDecisionLoop("function mintVerdict() { return 1; }", "mintVerdict").ok).toBe(false);
  });

  it("extracts the real loop body, nested comparator parens and all", () => {
    const loop = extractDecisionLoop(GATE_SOURCE, "mintVerdict");
    expect(loop.ok).toBe(true);
    expect(loop.body).toMatch(/mainIds\.has\(n\)/);
    expect(loop.body).toMatch(/offenders\.push/);
    expect(AGGREGATE_IDENTIFIERS).toContain("claimedMax");
  });
});
