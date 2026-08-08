/* B267536 — THE POND SPECS' CONTRACT WITH THE INSPECTOR, ASSERTED IN THE REQUIRED BUILD.
 *
 * WHAT HAPPENED. On 2026-07-21 the detention-pond inspector was reorganised (B934, 7ef3d3a5):
 * the flat list of fields became <Collapse> groups that start CLOSED, and "Top-of-bank elev.
 * (ft)" became the always-visible "Rim" row. Seven later commits renamed more of it. Twenty e2e
 * cases across the whole pond/detention programme went red the next morning and stayed red for
 * eighteen days — and NOT ONE of them was an engineering defect. Every one failed in its SETUP,
 * looking for a field that had moved, and never reached the assertion it exists to make.
 *
 * TWO THINGS MADE THAT POSSIBLE, and this file closes both:
 *
 *   (1) SIX specs each carried a PRIVATE COPY of the same helper block, so there was nothing to
 *       update once. One UI change took out a family. The copies now live in e2e/helpers.js, and
 *       §1 below fails if a spec grows its own again.
 *
 *   (2) The only thing that could notice was the nightly e2e workflow, which was ALREADY red and
 *       filing into one unread issue — a mute alarm (B266080). So the specs' dependency on the
 *       inspector's structure is asserted HERE, in `npm test`, which runs on every push and takes
 *       seconds. Rename a group and this goes red in the required build, with the spec that will
 *       break named, instead of in a nightly run nobody reads.
 *
 * This is a SOURCE guard, deliberately. It cannot tell you the pond math is right — that is
 * test/pondStorageGoldenMaster.test.js's job (78 exact-equality assertions) and the e2e specs'.
 * It tells you the specs can still REACH the math, which is the failure that actually happened.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const PLANNER = read("src/workspaces/site-planner/SitePlanner.jsx");
const HELPERS = read("e2e/helpers.js");

/* The specs that drive the pond inspector or the Yield panel through the shared helpers. */
const POND_SPECS = readdirSync(join(ROOT, "e2e"))
  .filter((f) => /^(pond-|yield-).*\.spec\.js$/.test(f))
  .map((f) => `e2e/${f}`);

describe("§1 — the pond specs share ONE helper block", () => {
  it("finds the pond/yield spec family (the guard must not be vacuously green)", () => {
    expect(POND_SPECS.length).toBeGreaterThanOrEqual(8);
  });

  /* The exact names the six duplicated copies used. A spec re-declaring one of them is a copy
   * coming back — which is how a single UI change took out twenty cases at once. */
  const FORKED = ["drawAndOpenPond", "drawAnchoredPond", "fillPondField", "openPondGroup", "setPondRim"];

  for (const spec of POND_SPECS) {
    it(`${spec} does not re-declare a shared pond helper`, () => {
      const src = read(spec);
      for (const name of FORKED) {
        const declares = new RegExp(`(?:async\\s+)?function\\s+${name}\\b|(?:const|let)\\s+${name}\\s*=`).test(src);
        expect(declares, `${spec} declares its own ${name}() — import it from ./helpers.js instead. Six private copies of this block is what kept twenty pond cases red for eighteen days.`).toBe(false);
      }
    });
  }

  it("the specs that anchor a pond do so through the shared helper", () => {
    const anchoring = POND_SPECS.filter((s) => /drawAnchoredPond|drawAndOpenPond/.test(read(s)));
    expect(anchoring.length).toBeGreaterThanOrEqual(6);
    for (const spec of anchoring) {
      expect(read(spec), `${spec} uses a pond helper but does not import from ./helpers.js`).toMatch(/from "\.\/helpers\.js"/);
    }
  });

  it("no spec still looks for the field B934 deleted", () => {
    for (const spec of POND_SPECS) {
      expect(read(spec), `${spec} still looks for "Top-of-bank elev. (ft)", removed by B934 (7ef3d3a5, 2026-07-21); the binding lives on the "Rim" row now`)
        .not.toContain("Top-of-bank elev.");
    }
  });
});

describe("§2 — the inspector still exposes what those helpers reach for", () => {
  /* Each entry: what the helpers depend on, and where it lives in the planner. Renaming any of
   * them without updating e2e/helpers.js re-creates the 2026-07-21 failure exactly. */
  const CONTRACT = [
    ["pond-rim-field-", 'the "Rim" row\'s id — the pond\'s top-of-bank anchor (det.tobElev)'],
    ["pond-release-field-", 'the "Allowable release (cfs)" field\'s id'],
    ['title="Engineering assumptions"', "the collapsed group holding drainage area / impervious % / allowable release"],
    ['title="Outlet & storms"', "the collapsed group holding the outlet stages and the routed per-storm table"],
    ["yield-landuse-", "the LAND USE legend rows, where B944 moved the pond's share of the site"],
    ['label="Drainage area (ac)"', "the tributary-area input every routing spec fills"],
    ['label="Impervious %"', "the impervious input the infeasible-pond case fills"],
  ];

  for (const [needle, why] of CONTRACT) {
    it(`SitePlanner.jsx still carries \`${needle}\` (${why})`, () => {
      expect(PLANNER.includes(needle), `${needle} is gone from SitePlanner.jsx. ${why}. Update e2e/helpers.js in the SAME commit — the pond e2e specs address the inspector through it, and a rename that skips it takes the whole family red silently.`).toBe(true);
    });
  }

  it("e2e/helpers.js names those same surfaces (both sides of the contract are here)", () => {
    for (const needle of ["pond-rim-field-", "pond-release-field-", "Engineering assumptions", "Outlet & storms"]) {
      expect(HELPERS, `e2e/helpers.js no longer references ${needle}`).toContain(needle);
    }
  });
});
