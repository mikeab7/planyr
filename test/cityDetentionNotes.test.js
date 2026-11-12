// NEW-1 (Baytown Ch. 109 + Mont Belvieu "adopts the Chambers DCM") — a city's own detention POLICY rides the
// Stormwater readout as an ADDITIVE note with NO rate behind it (owner constraint #4: no number without its rule
// record). It must never change the reviewer, the flags, or a single computed number — least of all the HCFCD
// 0.65 ac-ft/ac record or the Goose Creek 276-ac gate.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  authorityForJurisdiction,
  computeRequiredDetention,
  ruleFor,
  CITY_NOTES,
  slimDrainageContext,
  hydrateDrainageContext,
} from "../src/workspaces/site-planner/lib/detentionRules.js";

const note = (a) => a.overlays.filter((o) => o.kind === "city-note");

describe("Mont Belvieu — adopts the Chambers County manual", () => {
  const jur = { city: ["Mont Belvieu"], county: ["Chambers"], etj: [], cityCentroid: ["Mont Belvieu"] };
  it("says so on the readout and cites the ordinance + the strictest-applies rule", () => {
    const a = authorityForJurisdiction(jur);
    const [n] = note(a);
    expect(n).toMatchObject({ kind: "city-note", id: "mont belvieu", name: "Mont Belvieu" });
    expect(n.short).toMatch(/adopts the Chambers County manual/);
    expect(n.short.length).toBeLessThanOrEqual(110);
    expect(n.detail).toMatch(/Ord\. 2022-020/);
    expect(n.detail).toMatch(/strictest applies/);
    expect(n.detail).toMatch(/Table 4-1/);
    expect(n.source.url).toBe("https://www.montbelvieu.net/DocumentCenter/View/1801");
  });
  it("leaves the Chambers reviewer, its flags and its band exactly as they were", () => {
    const withCity = authorityForJurisdiction(jur);
    const without = authorityForJurisdiction({ ...jur, city: [], cityCentroid: [] });
    expect(withCity.primary).toBe("chambers");
    expect(without.primary).toBe("chambers");
    const r = computeRequiredDetention({ acres: 40, impPct: 70, authorityId: withCity.primary });
    expect(r.kind).toBe("band");
    expect(r.rateBandAcFtPerAc).toEqual([0.5, 1.2]);
    expect(r.requiredAcFt).toBeNull();
    expect(ruleFor("chambers").params.noPublishedRate).toBe(true);
  });
});

describe("Baytown — detention per Chapter 109, no rate stated", () => {
  const harris = { city: ["Baytown"], county: ["Harris"], etj: [], cityCentroid: ["Baytown"] };
  const chambers = { city: ["Baytown"], county: ["Chambers"], etj: [], cityCentroid: ["Baytown"] };
  it("Harris side keeps HCFCD, Chambers side keeps the Chambers band — and both carry the Baytown line", () => {
    const h = authorityForJurisdiction(harris);
    const c = authorityForJurisdiction(chambers);
    expect(h.primary).toBe("hcfcd");
    expect(c.primary).toBe("chambers");
    for (const a of [h, c]) {
      const [n] = note(a);
      expect(n.short).toMatch(/Ch\. 109/);
      expect(n.short.length).toBeLessThanOrEqual(110);
      expect(n.detail).toMatch(/§109-102/);
      expect(n.detail).toMatch(/NO Baytown rate is applied/);
      // honest: the city's criteria are still not modeled, so the county-floor caveat flag stays
      expect(a.flags).toContain("city-criteria-unverified");
    }
  });
  it("states no ac-ft/ac figure of its own (RULES-AS-DATA)", () => {
    const { short, detail } = CITY_NOTES.baytown;
    expect(short).not.toMatch(/\d+(\.\d+)?\s*ac-ft/i);
    expect(detail).not.toMatch(/\d+(\.\d+)?\s*ac-ft/i);
  });
  it("never moves a number: HCFCD 0.65 baseline and the Goose Creek 276-ac tract price identically", () => {
    expect(ruleFor("hcfcd").params.rateAcFtPerAc).toBe(0.65);
    const goose = computeRequiredDetention({ acres: 276, impPct: 70, authorityId: authorityForJurisdiction(harris).primary, hcfcdMethod: "pcpm" });
    expect(goose.kind).toBe("point");
    expect(goose.rateAcFtPerAc).toBe(0.65);
    expect(goose.requiredAcFt).toBeCloseTo(0.65 * 276, 3);
  });
});

describe("the note's gates", () => {
  it("a frontage sliver (centroid tested, in no such city) says nothing", () => {
    const a = authorityForJurisdiction({ city: ["Baytown"], county: ["Harris"], etj: [], cityCentroid: [] });
    expect(note(a)).toHaveLength(0);
  });
  it("an outage / legacy check fails OPEN (the caveat never silently drops)", () => {
    expect(note(authorityForJurisdiction({ city: ["Baytown"], county: ["Harris"], etj: [], cityCentroid: null }))).toHaveLength(1);
    expect(note(authorityForJurisdiction({ city: ["Baytown"], county: ["Harris"], etj: [] }))).toHaveLength(1);
  });
  it("rides along a county straddle without resolving it", () => {
    const a = authorityForJurisdiction({ city: ["Baytown"], county: ["Harris", "Chambers"], etj: [], cityCentroid: ["Baytown"] });
    expect(a.primary).toBeNull();
    expect(a.ambiguous[0].kind).toBe("straddle");
    expect(note(a)).toHaveLength(1);
  });
  it("other cities (Houston, Katy) get no city note and no change", () => {
    expect(note(authorityForJurisdiction({ city: ["Houston"], county: ["Harris"], etj: [], cityCentroid: ["Houston"] }))).toHaveLength(0);
    expect(note(authorityForJurisdiction({ city: ["Katy"], county: ["Fort Bend"], etj: [], cityCentroid: ["Katy"] }))).toHaveLength(0);
  });
  it("the note carries NO `city` field (SitePlanner's flood-administrator edgeLabels reads `.city`)", () => {
    const [n] = note(authorityForJurisdiction({ city: ["Baytown"], county: ["Harris"], etj: [], cityCentroid: ["Baytown"] }));
    expect("city" in n).toBe(false);
  });
});

describe("a reloaded check shows the note once, not twice", () => {
  it("slim → JSON → hydrate re-derives it from the jurisdiction facts", () => {
    const jur = { city: ["Mont Belvieu"], county: ["Chambers"], etj: [], cityCentroid: ["Mont Belvieu"] };
    const a = authorityForJurisdiction(jur);
    const ctx = {
      authority: { primaryReviewer: { authorityId: a.primary }, channelAuthority: null, overlays: a.overlays, ambiguous: [], flags: a.flags, mud: { state: "loaded" }, jurisdiction: jur },
      flood: null, channel: null, watershed: null, groundElevFt: 10,
    };
    const h = hydrateDrainageContext(JSON.parse(JSON.stringify(slimDrainageContext(ctx))));
    expect(note(h.authority)).toHaveLength(1);
  });
});

describe("the readout draws it in place of the generic line", () => {
  const panels = readFileSync(new URL("../src/workspaces/site-planner/components/YieldDrainagePanels.jsx", import.meta.url), "utf8");
  it("renders cityNotes and suppresses the generic city-unv sentence when one exists", () => {
    expect(panels).toMatch(/for \(const cn of \(d\.cityNotes \|\| \[\]\)\) detR\.push\(warnNote\(cn\.short/);
    expect(panels).toMatch(/city-criteria-unverified"\) && !\(d\.cityNotes \|\| \[\]\)\.length/);
  });
  it("SitePlanner hands the notes down", () => {
    const sp = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    expect(sp).toMatch(/cityNotes: \(drainCtxData\?\.authority\?\.overlays \|\| \[\]\)\.filter\(\(o\) => o\.kind === "city-note"\)/);
  });
});
