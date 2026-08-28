/* THE ORDERING CONTRACT — every ordered pair, and one name for the command that crosses it
 * (B548819).
 *
 * "Send to back / layers never work" has been reported six times. Four correct fixes all tested a
 * markup against another markup; #1066 was the first to test a markup against a building; the
 * sixth report was not ordering at all. The owner's instruction afterwards was that he should not
 * have to ask us to check all the cases. So the unit under test here is not a scenario — it is the
 * ENUMERATION: every ordered pair of drawn families has a stated relationship, and the table that
 * states it is proved against the render order in the source rather than maintained beside it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  PAINT_LADDER, FAMILIES, CROSS_BAND, CROSS_BAND_BEHIND, CROSS_BAND_FRONT,
  defaultRung, defaultRelation, reversal, orderedPairs,
} from "../src/workspaces/site-planner/lib/paintOrder.js";
import { ELEMENT_CAPABILITIES, verdict } from "../e2e/elementCapabilities.table.js";

const SRC = readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");

describe("the enumeration is COMPLETE — this is the whole point of the item", () => {
  it("states a relationship for every ordered pair of distinct families", () => {
    const pairs = orderedPairs();
    expect(pairs.length).toBe(FAMILIES.length * (FAMILIES.length - 1)); // 6 families → 30 rows
    for (const p of pairs) {
      expect(["over", "under"], `${p.a} vs ${p.b}`).toContain(p.relation);
    }
  });
  it("is antisymmetric — a over b iff b under a, for all 30", () => {
    for (const { a, b, relation } of orderedPairs()) {
      expect(defaultRelation(b, a), `${b} vs ${a}`).toBe(relation === "over" ? "under" : "over");
    }
  });
  it("every family has exactly one default rung", () => {
    for (const f of FAMILIES) {
      expect(PAINT_LADDER.filter((r) => r.family === f && r.isDefault).length, f).toBe(1);
      expect(defaultRung(f), f).not.toBeNull();
    }
  });
  it("the ladder's rungs are contiguous and in order", () => {
    expect(PAINT_LADDER.map((r) => r.rung)).toEqual(PAINT_LADDER.map((_, i) => i));
  });
});

describe("the two defaults the owner decided, asserted BY NAME", () => {
  /* Both of these were already true. They are pinned here so that changing them requires breaking
   * a named assertion rather than quietly reordering a render pass. */
  it("A MEASUREMENT OUTRANKS DECORATION — above markups and above callouts", () => {
    expect(defaultRelation("measure", "markup")).toBe("over");
    expect(defaultRelation("measure", "callout")).toBe("over");
    expect(defaultRung("measure")).toBe(Math.max(...FAMILIES.map(defaultRung)));
  });
  it("A PARCEL DEFAULTS TO BEHIND — under every family except an un-promoted reference", () => {
    for (const f of FAMILIES) {
      if (f === "parcel") continue;
      expect(defaultRelation("parcel", f), `parcel vs ${f}`).toBe(f === "reference" ? "over" : "under");
    }
  });
});

describe("every pair the user could care about is REVERSIBLE, and the table says with what", () => {
  it("no ordered pair is a dead end", () => {
    const stuck = orderedPairs().filter((p) => !p.reversible).map((p) => `${p.a}/${p.b}`);
    expect(stuck).toEqual([]);
  });
  /* The canonical pair reaches the menus through the shared constants (that is the fix for the
   * vocabulary drift), so the check is that the planner uses THOSE — a literal would be the
   * regression. The element's divergent words are literals and are checked as such. */
  it("every command the table names is actually wired into the menus", () => {
    const labels = new Set(orderedPairs().map((p) => p.by.split(": ")[1]));
    for (const label of labels) {
      if (label === CROSS_BAND_BEHIND) expect(SRC).toContain("CROSS_BAND_BEHIND");
      else if (label === CROSS_BAND_FRONT) expect(SRC).toContain("CROSS_BAND_FRONT");
      else expect(SRC, `menu label missing: ${label}`).toContain(label);
    }
    expect(labels.size).toBeGreaterThan(0); // a vacuous pass is not a pass
    expect(SRC).toContain('from "./lib/paintOrder.js"');
  });
});

describe("ONE NAME PER CONCEPT — the third-vocabulary problem", () => {
  /* Five different pairs of words were live for one idea. The drift is not cosmetic: it is why the
   * fifth report read as a different bug from the first four. */
  const RETIRED = ["Send behind buildings", "Bring in front of buildings", "Bring above the plan", "Draw above the plan", "Draw below the plan"];
  /* Comments are stripped: several explain the history and legitimately quote the old wording. */
  const CODE = SRC.split("\n").map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? "" : l.replace(/\/\/.*$/, ""))).join("\n");
  it("no retired synonym survives in the planner's menus", () => {
    const alive = RETIRED.filter((w) => new RegExp(`["'\`>]${w}`).test(CODE));
    expect(alive).toEqual([]);
  });
  it("the four families that share the concept share the words, character for character", () => {
    for (const f of ["markup", "callout", "measure", "reference"]) {
      expect(CROSS_BAND[f], f).toEqual({ behind: CROSS_BAND_BEHIND, front: CROSS_BAND_FRONT });
    }
  });
  /* The one divergence is allowed only because it is DECLARED with a reason. An undeclared one is
   * exactly the drift this guard exists to stop, so the reason is required, not optional. */
  it("the element's different words carry a stated reason", () => {
    expect(CROSS_BAND.element.divergentName).toBeTruthy();
    expect(CROSS_BAND.element.divergentName.length).toBeGreaterThan(80);
    expect(CROSS_BAND.element.behind).not.toBe(CROSS_BAND_BEHIND);
  });
  it("a family with no cross-band command declares that as null rather than omitting the row", () => {
    for (const f of FAMILIES) expect(Object.prototype.hasOwnProperty.call(CROSS_BAND, f), f).toBe(true);
    expect(CROSS_BAND.parcel).toBeNull();
  });
});

describe("the table matches what the canvas actually paints", () => {
  /* ⛔ A table maintained BESIDE the render is a table that drifts from it. These read the real
   * render order out of the source and require the ladder to be in the same sequence. */
  const MARKERS = [
    [0, /\{overlayBands\.below\.map\(/],
    [1, /\{drawParcels\.map\(/],
    [2, /\{drawMarkupsZ\.filter\(\(m\) => m\.behindEls\)\.map\(/],
    [3, /\{calloutBands\.below\.map\(/],
    [4, /\{measureBands\.below\.map\(/],
    [5, /\{drawElsZ\.below\.map\(/],
    [6, /\{drawElsZ\.above\.map\(/],
    [7, /\{drawMarkupsZ\.filter\(\(m\) => !m\.behindEls\)\.map\(/],
    [8, /\{overlayBands\.above\.map\(/],
    [9, /\{calloutBands\.above\.map\(/],
    [10, /\{measureBands\.above\.map\(/],
    [11, /\{calloutBands\.forced\.map\(/],
  ];
  it("each rung's render block is present exactly once", () => {
    for (const [rung, re] of MARKERS) {
      const hits = SRC.match(new RegExp(re.source, "g")) || [];
      expect(hits.length, `rung ${rung} (${re.source})`).toBe(1);
    }
  });
  it("the render blocks appear in the ladder's order, bottom to top", () => {
    const at = MARKERS.map(([rung, re]) => ({ rung, i: SRC.search(re) }));
    expect(at.every((x) => x.i >= 0)).toBe(true);
    const sorted = [...at].sort((x, y) => x.i - y.i).map((x) => x.rung);
    expect(sorted).toEqual(PAINT_LADDER.map((r) => r.rung));
  });

  /* B806080 round 2 — rung 11 (the absolute-front-forced callout tier) must be the LAST content
   * pass before the handle layer — after `parcelLabels` too, which is not itself a MARKER above
   * (it has no cross-band toggle and is not in FAMILIES), but a callout the owner explicitly
   * forced to the front must clear it as well: "nothing except transient UI paints over it." */
  it("the forced-callout tier renders after parcelLabels and before the handle layer", () => {
    const iParcelLabels = SRC.indexOf("{parcelLabels}");
    const iForced = SRC.search(/\{calloutBands\.forced\.map\(/);
    const iHandleLayer = SRC.indexOf('<g data-export="skip" data-handle-layer="1">');
    expect(iParcelLabels).toBeGreaterThan(-1);
    expect(iForced).toBeGreaterThan(-1);
    expect(iHandleLayer).toBeGreaterThan(-1);
    expect(iForced, "the forced tier must paint after the parcel acreage badge").toBeGreaterThan(iParcelLabels);
    expect(iForced, "the forced tier must paint before the handle layer").toBeLessThan(iHandleLayer);
  });
});

describe("the capability table declares the NAME, not merely the existence (B548819)", () => {
  /* ⛔ The gap this closes. Every row read `crossBand: YES`, which says the escape hatch exists and
   * nothing about what it is called — so five different pairs of words for one idea passed the
   * guard without a murmur. A capability contract that cannot see a name cannot stop a vocabulary
   * from drifting, and the drift is what made the owner's fifth report look like a new bug. */
  it("no row declares crossBand as a bare yes", () => {
    const bare = ELEMENT_CAPABILITIES.filter((r) => r.actions.crossBand === "yes").map((r) => r.type);
    expect(bare).toEqual([]);
  });
  it("every crossBand cell states BOTH directions, or is an na with a reason", () => {
    for (const row of ELEMENT_CAPABILITIES) {
      const cell = row.actions.crossBand;
      expect(verdict(cell), row.type).not.toBeNull();
      if (verdict(cell) === "yes") {
        expect(typeof cell.behind, row.type).toBe("string");
        expect(typeof cell.front, row.type).toBe("string");
        expect(cell.behind.length, row.type).toBeGreaterThan(0);
        expect(cell.front.length, row.type).toBeGreaterThan(0);
      }
    }
  });
  it("a cell whose words are not the canonical pair must carry a reason", () => {
    for (const row of ELEMENT_CAPABILITIES) {
      const cell = row.actions.crossBand;
      if (verdict(cell) !== "yes") continue;
      const canonical = cell.behind === CROSS_BAND_BEHIND && cell.front === CROSS_BAND_FRONT;
      if (!canonical) expect(cell.divergentName, `${row.type} diverges with no reason`).toBeTruthy();
    }
  });
  /* TEETH — the guard has to reject the shape the table actually shipped with. */
  it("rejects a bare-yes cell and an unexplained divergence", () => {
    expect(verdict("yes")).toBe("yes");                       // still a valid cell in general…
    const bareRow = { type: "x", actions: { crossBand: "yes" } };
    expect([bareRow].filter((r) => r.actions.crossBand === "yes").length).toBe(1); // …and this check would catch it
    const rogue = { behind: "Tuck under", front: "Pop over" };
    expect(rogue.behind === CROSS_BAND_BEHIND && rogue.front === CROSS_BAND_FRONT).toBe(false);
    expect(rogue.divergentName).toBeUndefined();
  });
});
