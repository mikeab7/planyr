import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/* NEW-1 — THE ORDINARY-HOUR DRIVER, PINNED SO IT CANNOT ROT GREEN.
 *
 * `ui-audit/session-group-cas.mjs` drives an hour of ordinary editing through the REAL write engine
 * with group CAS forced on, and reports how often the check refused a save, how many retries that
 * cost, and whether any refusal was SPURIOUS. It is the evidence the rollout decision rests on, so
 * the thing that actually needs guarding is not the quiet run — it is that a quiet run MEANS
 * something. A driver nobody has watched fail is a driver that passes on any build.
 *
 * So this asserts three results, not one: the shipped build is quiet, and each of the two known
 * digest-disagreement defects, re-introduced on the server side, is caught. They are different
 * causes with one symptom, and each needs its own shape planted in the fixture or the check is
 * vacuous — `order` needs a PREFIX PAIR (`b1` ⊂ `b1x`), `membership` needs a kind collision
 * (`markup:b2` against building `b2`). Neither shape occurs in the other's assembly, which is why
 * the two mutants must fail on DIFFERENT assemblies and that is asserted below.
 */
const DRIVER = fileURLToPath(new URL("../ui-audit/session-group-cas.mjs", import.meta.url));
// The driver exits non-zero on a FAILED verdict — which is the whole point of the mutant runs — so
// its report is read off the thrown error's stdout rather than treating the exit code as the answer.
const run = (...args) => {
  const opts = { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };
  try { return JSON.parse(execFileSync(process.execPath, [DRIVER, "--json", ...args], opts)); }
  catch (e) {
    if (typeof e.stdout !== "string" || !e.stdout.trim()) throw e;
    return JSON.parse(e.stdout);
  }
};

describe("an ordinary hour with group CAS on", () => {
  /* ⛔ TWO SEEDS, AND THE SECOND ONE IS NOT PADDING. Each of the three client defects this driver
   * found shows up on a different hour: the canvas-membership one is on nearly every seed, the
   * unknown-bond deadlock appeared on seed 14 alone out of twenty. A one-seed gate would have
   * shipped that third fix with nothing watching it. */
  it.each([20260813, 14])("is QUIET on the shipped build (seed %i) — no spurious refusal, nothing stuck, nothing lost", (seed) => {
    const r = run("--seed", String(seed));
    expect(r.mutation).toBe("none");
    expect(r.spuriousRefusals).toBe(0);
    expect(r.nonConvergingRefusals).toBe(0);
    expect(r.canvasNeverStored).toBe(0);
    expect(r.divergentGeometry).toBe(0);
    expect(r.verdict).toBe("QUIET");
    // …and it really exercised the feature, rather than being quiet by never betting on anything.
    expect(r.assembliesBet).toBeGreaterThan(50);
    expect(r.refusals).toBeGreaterThan(0);      // genuine conflicts DO happen and DO converge
    expect(r.retries).toBe(r.refusals);
    // ⛔ …and it really staked a bet on the PREFIX-PAIR assemblies, rather than happening to miss
    // the case the ordering defect lives in. `e2e-bldg-1` ⊂ `e2e-bldg-11` are the owner's own ids.
    expect(r.prefixPairAssembliesBetOn).toEqual(["b1", "e2e-bldg-1"]);
  }, 60_000);

  it("⛔ goes RED on the ORDERING defect NEW-1 found — a prefix pair the two sides sort differently", () => {
    const r = run("--mutate", "order", "--seed", "20260813");
    expect(r.verdict).toBe("FAILED");
    expect(r.spuriousRefusals).toBeGreaterThan(0);
    expect(r.canvasNeverStored).toBeGreaterThan(0);   // it really costs saves, not just retries
    expect(r.spuriousDetail[0].assembly).toBe("b1");  // the assembly holding `b1` ⊂ `b1x`
  }, 60_000);

  it("⛔ goes RED on the MEMBERSHIP defect B447472 found — a markup sharing the assembly key", () => {
    const r = run("--mutate", "membership", "--seed", "20260813");
    expect(r.verdict).toBe("FAILED");
    expect(r.spuriousRefusals).toBeGreaterThan(0);
    expect(r.canvasNeverStored).toBeGreaterThan(0);
    expect(r.spuriousDetail[0].assembly).toBe("b2");  // the assembly colliding with `markup:b2`
  }, 60_000);
});
