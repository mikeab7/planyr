/* NEW-1 — TEXAS GOLDEN-MASTER REGRESSION GATE.
 *
 * The Colorado work (NEW-2…NEW-8) reaches into the projection frame, the county registry, the
 * drainage-authority resolver, the floodplain rules and the detention engine. The owner's binding
 * constraint is that Texas comes out PROVABLY unchanged — so this suite recomputes the full Texas
 * matrix and asserts it is byte-identical to the snapshot taken before any of that work landed.
 *
 * ⛔ IF THIS FAILS, DO NOT REGENERATE THE FIXTURE. A diff is the harness doing its job: a Texas
 * number moved. Find what moved it and put it back. The fixture is regenerated only for a
 * deliberate, owner-approved Texas rule change, in its own commit
 * (`node scripts/build-texas-golden-master.mjs`), with the moved values named.
 *
 * The failure message deliberately prints the first differing PATH, not a wall of JSON — a
 * 68 KB diff tells you nothing; "detention.matrix.hcfcd|80.34ac|72%.bandAcFt" tells you everything.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTexasGoldenMaster, ON_DATE, TX_POINTS } from "./support/texasGoldenMaster.js";

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(resolve(here, "fixtures/texasGoldenMaster.json"), "utf8"));

/* Walk two plain objects and collect every leaf path whose value differs. */
function diffPaths(a, b, path = "", out = []) {
  if (out.length >= 25) return out;
  const isObj = (v) => v !== null && typeof v === "object";
  if (!isObj(a) || !isObj(b)) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${path}: expected ${JSON.stringify(a)} → got ${JSON.stringify(b)}`);
    return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(`${path}: array/object shape changed`); return out; }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!(k in a)) { out.push(`${path}.${k}: ADDED (${JSON.stringify(b[k])?.slice(0, 90)})`); continue; }
    if (!(k in b)) { out.push(`${path}.${k}: REMOVED`); continue; }
    diffPaths(a[k], b[k], `${path}.${k}`, out);
  }
  return out;
}

describe("NEW-1 · Texas golden master (characterisation)", () => {
  const current = buildTexasGoldenMaster();

  it("every Texas output is byte-identical to the pre-Colorado snapshot", () => {
    const diffs = diffPaths(golden, current, "");
    expect(
      diffs.length === 0,
      diffs.length
        ? `TEXAS OUTPUT MOVED (${diffs.length}${diffs.length >= 25 ? "+" : ""} differing paths). Do NOT regenerate the fixture — put the value back.\n  ` + diffs.join("\n  ")
        : "",
    ).toBe(true);
  });

  // Per-section assertions so a failure names the SUBSYSTEM in the test title, not just a path.
  for (const section of Object.keys(golden)) {
    it(`${section} is unchanged`, () => {
      expect(diffPaths(golden[section], current[section], section).join("\n")).toBe("");
    });
  }

  it("the snapshot is pinned to a fixed rule date (no wall-clock leakage)", () => {
    expect(ON_DATE).toBe("2026-07-20");
    // A second build in the same process must be identical — proves no Date.now()/random leaked in.
    expect(JSON.stringify(buildTexasGoldenMaster())).toBe(JSON.stringify(current));
  });

  it("covers the Texas surfaces the Colorado work touches", () => {
    // A guard on the harness itself: silently dropping a section would make this suite pass while
    // covering nothing. Each key here is a capability the Colorado items reach into.
    for (const k of ["projection", "plannerFrame", "countyRouting", "drainageAuthority", "detention", "drawdown", "floodplainRules", "ffe", "roadTakeoff", "pondStorage"]) {
      expect(Object.keys(golden), `golden master lost its ${k} section`).toContain(k);
    }
    expect(Object.keys(golden.detention.matrix).length).toBeGreaterThanOrEqual(54);
    expect(Object.keys(TX_POINTS).length).toBeGreaterThanOrEqual(6);
  });
});
