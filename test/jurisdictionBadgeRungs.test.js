import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  jurisdictionRungs, governingIdentity, jurisdictionSegments, abbreviateJurisdiction,
} from "../src/workspaces/site-planner/lib/jurisdictionBadgeFit.js";
import { formatJurisdictionBadge } from "../src/workspaces/site-planner/lib/jurisdiction.js";

/* ═══ B367298 — THE SHORTENING LADDER, AND THE DEFECT THAT MADE IT NECESSARY ═════════════════════
 *
 * B371361 shipped the right RULE — a shortened pill drops whole facts and never characters — and one
 * short form to implement it. On the owner's two longest labels that form is not short: a SPLIT
 * site's governing chain was built as ONE pre-joined slot, so `abbreviateJurisdiction` had nothing
 * to drop and returned nearly the whole line, and the pill fell back to a CSS ellipsis and cut it
 * MID-WORD. Measured in a real browser on Goose Creek and Tsakiris at 761 and 860 px; invisible to
 * the source-level guard, because the source is correct and the SHAPE of one label defeats it.
 *
 * Two fixes, and only the second is what makes a fragment impossible:
 *   1. a split contributes its two governing facts as two SLOTS (so there is something to drop),
 *   2. the shortener returns a LADDER ending in the bare governing identity and then in nothing. */

const badge = (over) => formatJurisdictionBadge({
  sources: [{ id: "city", state: "loaded" }, { id: "etj", state: "loaded" }, { id: "county", state: "loaded" }],
  ...over,
});
const GOOSE_CREEK = badge({
  city: ["Baytown"], cityAll: [], citySome: ["Baytown"], cityCentroid: ["Baytown"], etj: ["Baytown"],
  county: ["Harris"], cityCoverage: { inCity: 6, tested: 14 },
});
const IN_CITY = badge({ city: ["Houston"], cityAll: ["Houston"], cityCentroid: ["Houston"], etj: [], county: ["Harris"] });
const ETJ = badge({ city: [], cityAll: [], cityCentroid: [], etj: ["Houston"], county: ["Harris"] });

describe("B367298 — a split's governing chain is TWO slots, so there is something to drop", () => {
  it("splits the slot without changing one character of the label", () => {
    expect(GOOSE_CREEK.parts).toHaveLength(2);
    expect(GOOSE_CREEK.parts[1]).toBe("rest in its ETJ");
    // ⛔ The label itself is untouched — this is a FIT fix, not a wording change.
    expect(GOOSE_CREEK.text).toBe("Part in City of Baytown limits (full purpose, 6 of 14 lots) · rest in its ETJ · Harris County");
    expect(GOOSE_CREEK.jur).toBe(GOOSE_CREEK.parts.join(" · "));
  });

  it("…and the shortener can now count what it is hiding", () => {
    // Pre-fix this read "+1" — one opaque governing blob plus the county. It is three facts.
    expect(jurisdictionSegments(GOOSE_CREEK)).toHaveLength(3);
    expect(abbreviateJurisdiction(GOOSE_CREEK).hidden).toBe(2);
  });
});

describe("B367298 — every rung is a complete statement, and the last one is nothing", () => {
  it("descends by dropping whole facts, never characters", () => {
    expect(jurisdictionRungs(GOOSE_CREEK)).toEqual([
      "Part in City of Baytown limits (full purpose, 6 of 14 lots) · rest in its ETJ · Harris County",
      "Part in City of Baytown limits (full purpose, 6 of 14 lots) +2",
      "Part in City of Baytown limits +2",
      "Part in City of Baytown +2",
      "",
    ]);
  });

  it("is strictly shorter at every step — a ladder that does not descend is not a ladder", () => {
    for (const b of [GOOSE_CREEK, IN_CITY, ETJ]) {
      const rungs = jurisdictionRungs(b);
      for (let i = 1; i < rungs.length; i++) expect(rungs[i].length).toBeLessThan(rungs[i - 1].length);
    }
  });

  it("never repeats a rung, so a short label does not measure the same string twice", () => {
    const rungs = jurisdictionRungs(IN_CITY);
    expect(new Set(rungs).size).toBe(rungs.length);
  });

  it("ends in the empty string on every shape — the honest floor is always reachable", () => {
    for (const b of [GOOSE_CREEK, IN_CITY, ETJ, badge({ city: [], cityAll: [], cityCentroid: [], etj: [], county: ["Waller"] })])
      expect(jurisdictionRungs(b).at(-1)).toBe("");
  });

  it("survives a null and a bare badge", () => {
    expect(jurisdictionRungs(null)).toEqual([""]);
    expect(governingIdentity(null)).toBe(null);
  });
});

describe("B367298 — the deepest rung names WHO governs, and never reverses the answer", () => {
  /* ⛔ "Part in" is kept. Dropping it turns "part of this site is in Baytown" into "this site is in
   * Baytown", which is a different and wrong answer — shortening may drop facts, never invert one. */
  it("keeps the qualifier that carries the meaning", () => {
    expect(governingIdentity(GOOSE_CREEK)).toBe("Part in City of Baytown");
    expect(jurisdictionRungs(GOOSE_CREEK).at(-2)).toContain("Part in");
  });

  it("answers for every shape from the MODEL, never from the label", () => {
    expect(governingIdentity(IN_CITY)).toBe("City of Houston");
    expect(governingIdentity(ETJ)).toBe("City of Houston ETJ");
    expect(governingIdentity(badge({ city: [], cityAll: [], cityCentroid: [], etj: [], county: ["Waller"] }))).toBe("Unincorporated");
    expect(governingIdentity({ cityContainment: "unknown" })).toBe("Couldn't check city limits");
  });

  /* The NEW-2 coupling rule applies here as much as anywhere: a jurisdiction FACT may never be
   * recovered from the jurisdiction LABEL. This one is assembled from the structured fields. */
  it("is built from the structured fields — a badge with a label but no model says nothing", () => {
    expect(governingIdentity({ jur: "City of Houston ETJ", text: "City of Houston ETJ · Harris County" })).toBe(null);
    const src = readFileSync(new URL("../src/workspaces/site-planner/lib/jurisdictionBadgeFit.js", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export function governingIdentity"), src.indexOf("export function jurisdictionRungs"));
    expect(body).not.toMatch(/\.(jur|text)\b/);
  });
});
