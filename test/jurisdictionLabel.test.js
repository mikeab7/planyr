import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  formatJurisdictionLabel, jurisdictionShapeOf, governingCityOf,
  JURISDICTION_SHAPES, SLOT_SEP, PEER_SEP, TOUCH_SEP,
} from "../src/workspaces/site-planner/lib/jurisdictionLabel.js";
import { formatJurisdictionBadge } from "../src/workspaces/site-planner/lib/jurisdiction.js";

/* ═══ NEW-1 (B367296) — THE CANONICAL FORMATTER ══════════════════════════════════════════════════
 *
 * The owner's report, on Clay & Porter: the header read "Unincorporated / City of Houston ETJ" and
 * his words were *"it would be just City of Houston ETJ… like, it's either Unincorporated or it's
 * COH ETJ."*
 *
 * ⛔ THE REASON HE GAVE IS NOT THE REASON THE CODE ENCODES, and that distinction is the whole point
 * of this suite. The two are NOT mutually exclusive: a Texas ETJ is by definition the unincorporated
 * band outside a city's corporate limits, so ETJ land is NECESSARILY unincorporated. The label was
 * REDUNDANT, not wrong — and the tests below assert that the MODEL still reports both facts while
 * the LABEL prints only the governing one. Making them exclusive in the model would be a real
 * regression (it would drop the county from the picture on 16 of his 28 sites).
 *
 * THE ACTUAL DEFECT is the overloaded separator: " / " joined "Houston governs platting here" and
 * "Katy is merely next door" identically, and a reader could not tell those apart. */

const M = (over = {}) => ({
  governingCities: [], partialCities: [], etjCities: [], counties: [], isds: [],
  adjacentCities: [], unclassifiedCities: [], ...over,
});

describe("NEW-1 — the four shapes, and no others", () => {
  it("1 · in city limits", () => {
    const l = formatJurisdictionLabel(M({ governingCities: ["Houston"], counties: ["Harris"] }));
    expect(l.text).toBe("City of Houston · Harris County");
    expect(l.shape).toBe("in-city");
  });

  it("2 · in city limits AND inside another city's ETJ", () => {
    const l = formatJurisdictionLabel(M({ governingCities: ["Humble"], etjCities: ["Houston"], counties: ["Harris"] }));
    expect(l.text).toBe("City of Humble · Houston ETJ · Harris County");
    expect(l.shape).toBe("in-city-etj");
  });

  it("3 · unincorporated, inside an ETJ — the ETJ leads and 'Unincorporated' is NOT printed", () => {
    const l = formatJurisdictionLabel(M({ etjCities: ["Houston"], counties: ["Harris"] }));
    expect(l.text).toBe("City of Houston ETJ · Harris County");
    expect(l.shape).toBe("etj");
    expect(l.text).not.toContain("Unincorporated");
  });

  it("4 · unincorporated, no ETJ — and any adjacent city is DEMOTED, never joined to the answer", () => {
    const bare = formatJurisdictionLabel(M({ counties: ["Harris"] }));
    expect(bare.text).toBe("Unincorporated · Harris County");
    expect(bare.shape).toBe("unincorporated");

    const touched = formatJurisdictionLabel(M({ counties: ["Harris"], adjacentCities: ["Katy"] }));
    expect(touched.text).toBe("Unincorporated · Harris County — touches City of Katy");
    // ⛔ THE ITEM, as one assertion: the adjacent city is NOT reachable through the governing chain.
    expect(touched.jur).not.toContain("Katy");
    expect(touched.tail).toBe("touches City of Katy");
  });

  it("the shape is decided from the MODEL, before any string exists", () => {
    expect(jurisdictionShapeOf(M({ governingCities: ["Houston"] }))).toBe("in-city");
    expect(jurisdictionShapeOf(M({ governingCities: ["Humble"], etjCities: ["Houston"] }))).toBe("in-city-etj");
    expect(jurisdictionShapeOf(M({ etjCities: ["Houston"] }))).toBe("etj");
    expect(jurisdictionShapeOf(M())).toBe("unincorporated");
    expect(jurisdictionShapeOf(M({ partialCities: ["Baytown"] }))).toBe("split");
    expect(jurisdictionShapeOf(M({ cityUnresolved: true }))).toBe("unknown");
    for (const m of [M(), M({ governingCities: ["A"] }), M({ etjCities: ["A"] }), M({ partialCities: ["A"] }), M({ cityUnresolved: true })])
      expect(JURISDICTION_SHAPES).toContain(jurisdictionShapeOf(m));
  });
});

describe("NEW-1 — one separator, one meaning", () => {
  it("`·` joins GOVERNING slots only", () => {
    const l = formatJurisdictionLabel(M({ governingCities: ["Humble"], etjCities: ["Houston"], counties: ["Harris"], isds: ["Humble ISD"] }));
    expect(l.text.split(SLOT_SEP)).toEqual(["City of Humble", "Houston ETJ", "Harris County", "Humble ISD"]);
  });

  it("`+` joins CO-EQUAL PEERS inside one slot — two cities, two counties, two districts", () => {
    expect(formatJurisdictionLabel(M({ governingCities: ["Houston", "Katy"], counties: ["Harris"] })).jur)
      .toBe(`City of Houston${PEER_SEP}City of Katy`);
    expect(formatJurisdictionLabel(M({ counties: ["Harris", "Fort Bend"] })).county)
      .toBe(`Harris County${PEER_SEP}Fort Bend County`);
    expect(formatJurisdictionLabel(M({ isds: ["Houston ISD", "Aldine ISD"] })).isd)
      .toBe(`Houston ISD${PEER_SEP}Aldine ISD`);
  });

  it("`—` introduces the tail, and NOTHING after it governs", () => {
    const l = formatJurisdictionLabel(M({ etjCities: ["Houston"], counties: ["Fort Bend"], adjacentCities: ["Katy", "Brookshire"] }));
    const [chain, tail] = l.text.split(TOUCH_SEP);
    expect(chain).toBe("City of Houston ETJ · Fort Bend County");
    expect(tail).toBe("touches City of Katy, City of Brookshire");
  });

  /* ⛔ THE STRUCTURAL FORM OF THE OWNER'S COMPLAINT, asserted as a property rather than as a pair of
   * example strings: a governing fact and a merely-adjacent one may never be reachable by splitting
   * on the same mark. Pre-fix, splitting the Bain label on " / " yielded ["Unincorporated",
   * "City of Houston · ETJ", "City of Katy · edge only"] — three parts, two of them governing and
   * one of them not, and nothing in the string to tell which was which. */
  it("no split of the governing chain can ever surface a non-governing city", () => {
    for (const m of [
      M({ etjCities: ["Houston"], counties: ["Fort Bend"], adjacentCities: ["Katy"] }),
      M({ governingCities: ["Houston"], counties: ["Harris"], adjacentCities: ["Bellaire"] }),
      M({ counties: ["Waller"], adjacentCities: ["Brookshire"] }),
      M({ cityUnresolved: true, counties: ["Harris"], unclassifiedCities: ["Baytown"] }),
    ]) {
      const l = formatJurisdictionLabel(m);
      const governingParts = [l.jur, l.county, l.isd].filter(Boolean).join(SLOT_SEP).split(SLOT_SEP);
      for (const city of [...m.adjacentCities, ...m.unclassifiedCities])
        expect(governingParts.join(" ")).not.toContain(city);
    }
  });
});

describe("NEW-1 — the two states that are not shapes stay honest", () => {
  it("SPLIT: both halves govern, so both are slots — the count and the measured remainder survive", () => {
    const l = formatJurisdictionLabel(M({
      partialCities: ["Baytown"], splitNote: " (6 of 14 lots)", remainderLabel: "rest in its ETJ", counties: ["Harris"],
    }));
    // NEW-1 — the noun is "City of X limits", because "City of X" alone is the phrase reserved for
    // full-purpose limits and this line has to read differently from a limited-purpose annexation.
    expect(l.text).toBe("Part in City of Baytown limits (6 of 14 lots) · rest in its ETJ · Harris County");
    expect(l.shape).toBe("split");
  });

  /* NEW-1/NEW-2 — the two wordings that must never be confusable, side by side. */
  it("SPLIT states the class and an AREA share, not a lot count, when the area pass answered", () => {
    const l = formatJurisdictionLabel(M({
      partialCities: ["Baytown"], splitClass: "full", splitNote: " 31% by area",
      remainderLabel: "rest in its ETJ", counties: ["Harris"],
    }));
    expect(l.text).toBe("Part in City of Baytown limits (full purpose, 31% by area) · rest in its ETJ · Harris County");
  });

  it("a LIMITED-PURPOSE annexation is its own slot and never reads as 'City of X'", () => {
    const l = formatJurisdictionLabel(M({
      etjCities: ["Baytown"], counties: ["Chambers"],
      limitedAreas: [{ name: "Baytown", class: "limited", share: 0.991 }],
    }));
    expect(l.text).toBe("City of Baytown ETJ · Baytown limited-purpose annexation (99% by area) · Chambers County");
    expect(l.text).not.toContain("City of Baytown ·");
    expect(l.shape).toBe("etj");
  });

  it("a strip annexation says so, and a site with none gains no characters", () => {
    const strip = formatJurisdictionLabel(M({ counties: ["Harris"], limitedAreas: [{ name: "Baytown", class: "strip", share: 0.02 }] }));
    expect(strip.text).toBe("Unincorporated · Baytown strip annexation (2% by area) · Harris County");
    const none = formatJurisdictionLabel(M({ counties: ["Harris"], limitedAreas: [] }));
    expect(none.text).toBe("Unincorporated · Harris County");
  });

  it("UNKNOWN: a failed containment lookup never lets a city lead", () => {
    const l = formatJurisdictionLabel(M({ cityUnresolved: true, unclassifiedCities: ["Houston"], counties: ["Harris"] }));
    expect(l.jur.startsWith("Couldn't check city limits")).toBe(true);
    expect(l.text).toBe("Couldn't check city limits · Harris County — touches City of Houston, containment unchecked");
  });

  it("a failed ETJ lookup is a NAMED slot, and 'Unincorporated' returns because nothing implies it", () => {
    const l = formatJurisdictionLabel(M({ etjUnresolved: true, counties: ["Fort Bend"] }));
    expect(l.text).toBe("Unincorporated · Couldn't check ETJ · Fort Bend County");
  });

  it("an ETJ that IS the lead is never printed a second time in its own slot", () => {
    const l = formatJurisdictionLabel(M({ etjCities: ["Houston"], counties: ["Harris"] }));
    expect(l.text.match(/Houston/g)).toHaveLength(1);
    expect(l.text.match(/ETJ/g)).toHaveLength(1);
  });

  /* ⛔ NO FAILURE STRING MAY CARRY A GOVERNING SEPARATOR INSIDE IT. "ETJ · couldn't check" read as
   * two slots — an ETJ named "ETJ", then an authority called "couldn't check" — which is the same
   * class of ambiguity this whole item is about, in miniature. */
  it("no slot's own wording contains the slot separator", () => {
    for (const m of [
      M({ cityUnresolved: true }), M({ etjUnresolved: true }), M({ countyUnresolved: true }),
      M({ partialCities: ["Katy"], remainderLabel: "rest outside it (no ETJ published for City of Katy)" }),
    ]) {
      const l = formatJurisdictionLabel(m);
      for (const slot of [...l.jur.split(SLOT_SEP), l.county, l.isd].filter(Boolean)) {
        expect(slot.trim()).not.toBe("");
        expect(slot).not.toContain(TOUCH_SEP.trim());
      }
    }
  });
});

describe("NEW-1 — the MODEL is untouched; only the words changed", () => {
  /* This is the guard against "fixing" the owner's report the way he described it. If ETJ and
   * unincorporated ever become mutually exclusive in the model, an ETJ site loses `unincorporated`
   * and the county's role in the picture goes with it. */
  it("an ETJ site is STILL unincorporated everywhere but the label", () => {
    const b = formatJurisdictionBadge({ city: [], cityCentroid: [], cityAll: [], etj: ["Houston"], county: ["Harris"], sources: [] });
    expect(b.text).toBe("City of Houston ETJ · Harris County");
    expect(b.cityContainment).toBe("none");     // in no city's LIMITS
    expect(b.etjLabels).toEqual(["Houston"]);   // …and inside Houston's ETJ. Both true at once.
  });

  it("the identify's own `unincorporated` flag is not computed from the label", () => {
    const src = readFileSync(new URL("../src/workspaces/site-planner/lib/jurisdiction.js", import.meta.url), "utf8");
    // `unincorporated` is a containment fact, decided long before any string is built.
    expect(src).toContain('out.unincorporated = out.cityContainment === "none"');
  });
});

describe("NEW-2 — governingCityOf reads the model, not the label", () => {
  it("answers on every shape, including the one the old string parse broke", () => {
    const badge = (j) => formatJurisdictionBadge({ sources: [], ...j });
    const inCity = badge({ city: ["Houston"], cityCentroid: ["Houston"], cityAll: ["Houston"], etj: [], county: ["Harris"] });
    const inCityEtj = badge({ city: ["Humble"], cityCentroid: ["Humble"], cityAll: ["Humble"], etj: ["Houston"], county: ["Harris"] });
    const etjOnly = badge({ city: [], cityCentroid: [], cityAll: [], etj: ["Houston"], county: ["Harris"] });
    const uninc = badge({ city: [], cityCentroid: [], cityAll: [], etj: [], county: ["Harris"] });

    expect(governingCityOf(inCity)).toBe("Houston");
    expect(governingCityOf(inCityEtj)).toBe("Humble");
    expect(governingCityOf(etjOnly)).toBe(null);   // an ETJ is not city limits — it rides `etjLabels`
    expect(governingCityOf(uninc)).toBe(null);
    expect(governingCityOf(null)).toBe(null);

    /* ⛔ THE RED PROOF, kept as executable evidence rather than a claim in a commit message. This is
     * `SitePlanner.jsx`'s pre-fix derivation, verbatim. Under the new grammar it returns
     * "Humble · Houston ETJ" — a string matching no rule record, so `administratorCandidates` raises
     * no city candidate and the site falls to the county's floodplain rule, 1–2 ft lower. */
    const preFix = (b) => (b.cityContainment === "in" ? (b.jur || "").split(" / ")[0].replace(/^City of\s+/, "") || null : null);
    expect(preFix(inCity)).toBe("Houston");                    // shape 1 hid the coupling…
    expect(preFix(inCityEtj)).toBe("Humble · Houston ETJ");    // …shape 2 exposes it.
    expect(preFix(inCityEtj)).not.toBe(governingCityOf(inCityEtj));
  });

  it("a city holding PART of the site is still a candidate (the stricter rule can only raise the floor)", () => {
    expect(governingCityOf({ governingCities: [], partialCities: ["Baytown"] })).toBe("Baytown");
  });
});
