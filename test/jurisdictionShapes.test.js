import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { identifyJurisdiction, formatJurisdictionBadge, parcelProbePoints } from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { feetToLatLngPair } from "../src/workspaces/site-planner/lib/mapLock.js";
import { representativeRing, ringCentroid } from "../src/workspaces/site-planner/lib/siteAnalysis.js";
import { replay, freshCache } from "../ui-audit/lib/shapeReplay.js";

/* ═══ NEW-3 — ONE REGRESSION FIXTURE PER JURISDICTION SHAPE, FROM THE OWNER'S REAL SITES ═════════
 *
 * The owner, verbatim: "The four shapes below are the entire problem space and the suite covers
 * none of them… A fixture that cannot fail on a mislabel is not a fixture — the existing suite
 * passed through both confirmed mislabels."
 *
 * He was right about the second part, and the reason is worth stating because it is a trap that
 * will recur. Every jurisdiction test in `test/jurisdiction.test.js` hands `formatJurisdictionBadge`
 * a HAND-WRITTEN object — `{city:["Katy"], cityCentroid:[], …}` — so it tests the FORMATTER against
 * a state somebody imagined. Both real mislabels were produced UPSTREAM of the formatter, by
 * `identifyJurisdiction` deciding what to ask the agency and how to read the answer: one lot's
 * centroid standing in for a nine-lot site, and a ring whose query URL was too long to survive.
 * A formatter test cannot see either. So these four drive the WHOLE chain — real parcel geometry,
 * through the real query builder, against RECORDED real agency responses — and assert the full
 * badge string.
 *
 * The four shapes, and their real sites (all four coordinates are the owner's own production rows):
 *   in-city                                  → Gessner       (Houston)
 *   in-city PLUS an ETJ                      → Will Clayton  (Humble limits, Houston ETJ)
 *   unincorporated INSIDE an ETJ             → Bain          (Houston ETJ, Katy on the edge)
 *   unincorporated, city within 1 km         → Goose Creek   (Baytown)
 *
 * ⚠ GOOSE CREEK WAS RE-STATED 2026-08-09 AFTER THE OWNER CORRECTED IT, and the correction is worth
 * reading before the case below. It was filed — and verified by me — as "unincorporated, NO ETJ,
 * city within 1 km". His words: "For goose creek part of the site is in city limits and part is in
 * ETJ, so it should clarify." He is right, and BOTH earlier readings were wrong for the same
 * reason: they reasoned from ONE point (the site origin), which cannot see a straddle by
 * construction. Per parcel, live: 6 of 14 tested lots inside Baytown's city limits, the other 8
 * inside Baytown's ETJ, none unincorporated. A fifth shape (Kennedy Greens) was added separately
 * because the four named could not fail on the ETJ-dedupe defect.
 * Responses recorded live by `ui-audit/record-jurisdiction-shapes.mjs` (2026-08-08, Baytown ETJ
 * added 2026-08-09). */

const FIX = JSON.parse(fs.readFileSync(path.join(process.cwd(), "test/fixtures/jurisdictionShapes.json"), "utf8"));
const shape = (name) => FIX.shapes.find((s) => s.site === name);

/* NEW-1a — TWO ETJ sources are routed in the Baytown area, because H-GAC's regional mosaic does not
 * carry Baytown. They are recorded separately and replayed separately; the Baytown layer holds a
 * single jurisdiction and therefore has no name column, so its recording is a bare presence marker
 * and the constant comes from the source row, exactly as the real connector does it.
 *
 * ⛔ NEW-1 (B367296) — THE REPLAY ITSELF NOW LIVES IN `ui-audit/lib/shapeReplay.js`, shared with the
 * BROWSER harness that renders these same five shapes through the real component. The badge is a
 * rendering surface, so it needs both checks; a second copy of the replay would be a second thing to
 * keep in step with the recorder, and the day they drift the browser check is exercising a fixture
 * this suite has never seen. */

async function badgeFor(name, opts = {}) {
  const rec = shape(name);
  const rings = rec.rings
    ? rec.rings.map((r) => r.map(([x, y]) => { const [lat, lng] = feetToLatLngPair({ x, y }, rec.lat, rec.lon); return [lng, lat]; }))
    : null;
  const use = rings || [];
  const rep = representativeRing(use);
  const c = ringCentroid(rep);
  const j = await identifyJurisdiction(c.lng, c.lat, {
    ring: rep, rings: use, roles: ["county", "city", "etj"],
    cache: freshCache(), fetchJson: replay(rec, opts),
  });
  return { j, b: formatJurisdictionBadge(j) };
}

// The fixture stores rings only in the portfolio file; pull them in so the shapes are self-driving.
const PORTFOLIO = JSON.parse(fs.readFileSync(path.join(process.cwd(), "ui-audit/fixtures/jurisdiction-portfolio.json"), "utf8"));
for (const s of FIX.shapes) s.rings = PORTFOLIO.sites.find((p) => p.site === s.site).rings;

describe("NEW-3 — a regression fixture per jurisdiction SHAPE, from the owner's real sites", () => {
  it("in-city — Gessner reads the City of Houston and never 'Unincorporated'", async () => {
    const { b, j } = await badgeFor("Gessner");
    expect(b.text).toBe("City of Houston · Harris County");
    expect(j.cityContainment).toBe("in");
    expect(b.straddle).toBe(false);
  });

  it("in-city PLUS an ETJ — Will Clayton names Humble's limits AND the Houston ETJ", async () => {
    const { b, j } = await badgeFor("Will Clayton");
    // SHAPE 2 — the governing city leads, the other city's ETJ is the qualifier beside it.
    expect(b.text).toBe("City of Humble · Houston ETJ · Harris County");
    expect(b.shape).toBe("in-city-etj");
    expect(j.cityContainment).toBe("in");
    // The ETJ must survive the dedupe: it is a DIFFERENT city from the one whose limits hold the
    // site, and dropping it loses the Ch. 19 floodplain rule.
    expect(b.etjLabels).toEqual(["Houston"]);
  });

  /* SHAPE 3, RE-STATED BY NEW-1 (B367296) after the owner's Clay & Porter report. It read
   * "Unincorporated / City of Houston ETJ" and his words were *"it would be just City of Houston
   * ETJ."* An ETJ is by definition the unincorporated band OUTSIDE a city's limits, so the pair was
   * redundant, not contradictory — and, worse, the same " / " also joined the Katy sliver, which
   * governs nothing here. The ETJ now leads alone and Katy sits behind the em dash. */
  it("unincorporated INSIDE an ETJ — Bain leads with the governing ETJ and demotes the Katy sliver", async () => {
    const { b, j } = await badgeFor("Bain");
    expect(b.text).toBe("City of Houston ETJ · Fort Bend County — touches City of Katy");
    expect(b.shape).toBe("etj");
    // ⛔ The MODEL is untouched: the land IS unincorporated, the label simply stopped saying so twice.
    expect(j.cityContainment).toBe("none");
    expect(j.unincorporated).toBe(true);
    expect(b.text).not.toContain("Unincorporated");
    expect(b.edgeOnlyCities).toEqual(["Katy"]);
    // The regression that started this family: the sliver must never occupy the lead slot — and it
    // may no longer share a separator with the governing answer either.
    expect(b.jur).not.toContain("Katy");
    expect(b.tail).toBe("touches City of Katy");
  });

  /* ⛔ CORRECTED 2026-08-09 BY THE OWNER, and the correction is the more important finding.
   *
   * Filed as "unincorporated, no ETJ, city within 1 km". His words: "For goose creek part of the
   * site is in city limits and part is in ETJ, so it should clarify." Confirmed live, per parcel:
   * **6 of the 14 tested lots are inside Baytown's city limits and the other 8 are inside Baytown's
   * ETJ. Not one is plain unincorporated.** Both the original filing and my first pass reasoned
   * from a single origin point, which cannot see a straddle by construction.
   *
   * Two separate defects were hiding behind that one label. The site is SPLIT — so neither "City of
   * Baytown" nor "Unincorporated" is true of the whole of it — and the H-GAC ETJ layer the app asks
   * does not carry Baytown at all, so the ETJ half was invisible no matter how the split was
   * resolved. This case pins both. */
  it("SPLIT city limits + ETJ — Goose Creek states which part, and how much", async () => {
    const { b, j } = await badgeFor("Goose Creek");
    // NEW-1 — both halves GOVERN part of the site, so they are slots in the governing chain ("·").
    // Only a non-governing city gets demoted behind the em dash, and there is none here.
    expect(b.text).toBe("Part in City of Baytown limits (full purpose, 6 of 14 lots) · rest in its ETJ · Harris County");
    expect(b.shape).toBe("split");
    expect(b.tail).toBe(null);
    expect(j.cityContainment).toBe("partial");
    // The share is the whole point of the correction: "part in" alone is not actionable.
    expect(b.cityCoverage.inCity).toBe(6);
    expect(b.cityCoverage.tested).toBe(14);
    // The remainder is Baytown's ETJ, NOT unincorporated — asserting the exact wrong answer the
    // first pass produced, so it cannot come back.
    expect(b.text).not.toContain("unincorporated");
    // And the original report's string stays dead.
    expect(b.text).not.toBe("City of Baytown · Harris County");
    expect(b.jur.startsWith("City of Baytown")).toBe(false);
    expect(b.straddle).toBe(true);
  });

  it("Baytown's ETJ is only visible because it has its own source — H-GAC does not carry it", async () => {
    const rec = shape("Goose Creek");
    // The regression this guards: H-GAC answers, successfully, with nothing.
    expect(rec.answers.etj.ring).toEqual([]);
    expect(rec.answers.etj.points.every((p) => p.length === 0)).toBe(true);
    // Baytown's own layer holds every tested lot.
    expect(rec.answers.etj_baytown.points.every((p) => p.length > 0)).toBe(true);
  });

  /* A FIFTH shape the brief did not name. The portfolio sweep found a defect that none of the four
   * above can see: unincorporated land inside a city's ETJ where THAT SAME CITY also clips the
   * parcel edge. The ETJ was deduped against every city the boundary TOUCHED, so the sliver
   * suppressed its own ETJ and the pill read "City of Houston · edge only" — a jurisdiction the
   * tooltip itself calls "unlikely to govern" shown INSTEAD of the Ch. 19 authority that sets the
   * finished floor. Four of the owner's sites are this shape: Kennedy Greens, JFK, Katz, Pinnacle. */
  it("ETJ city ALSO clipping the edge — Kennedy Greens names the ETJ, not the sliver", async () => {
    const { b, j } = await badgeFor("Kennedy Greens");
    expect(b.text).toBe("City of Houston ETJ · Harris County");
    expect(b.shape).toBe("etj");
    expect(j.cityContainment).toBe("none");
    expect(b.etjLabels).toEqual(["Houston"]);
    // The regression: an edge sliver may not stand in for the ETJ, and once the ETJ is named the
    // sliver is not a second slot — nor a tail, since it is the very same city.
    expect(b.tail).toBe(null);
  });

  it("the site centroid alone is NOT enough — Goose Creek's biggest lot is outside Baytown", async () => {
    /* The mechanism, pinned so it cannot come back: the representative ring's boundary query returns
     * NO city at all, so anything that reasoned from that one lot would call the whole site
     * unincorporated and never discover that six of the sixteen parcels are inside Baytown. */
    const rec = shape("Goose Creek");
    expect(rec.answers.city.ring).toEqual([]);
    expect(rec.answers.city.points.filter((p) => p.length).length).toBeGreaterThan(0);
    expect(rec.answers.city.points.filter((p) => !p.length).length).toBeGreaterThan(0);
  });

  it("every shape's containment is asked of the whole assemblage, not one lot", () => {
    for (const s of FIX.shapes) {
      const rings = s.rings.map((r) => r.map(([x, y]) => { const [lat, lng] = feetToLatLngPair({ x, y }, s.lat, s.lon); return [lng, lat]; }));
      const probe = parcelProbePoints(rings);
      expect(probe.points.length).toBeGreaterThan(0);
      // A multi-parcel site must probe more than the single representative lot.
      if (rings.length > 1) expect(probe.points.length).toBeGreaterThan(1);
    }
  });
});

describe("NEW-2 — an unresolved role is first-class on every shape, and never fails open", () => {
  it("a failed ETJ lookup on Bain SAYS so instead of reading as 'no ETJ here'", async () => {
    const { b } = await badgeFor("Bain", { fail: ["etj"] });
    expect(b.jur).toContain("Couldn't check ETJ");
    // …and with the ETJ unknown there is no ETJ to imply it, so "Unincorporated" is printed again.
    expect(b.jur.startsWith("Unincorporated")).toBe(true);
    expect(b.unresolved).toBe(true);
    expect(b.unresolvedRoles).toContain("etj");
    // The stake: with the Houston ETJ missing, the floodplain rule falls back to the county's, which
    // in flat Fort Bend commonly sits 1–2 ft lower. It may not present as settled.
    expect(b.jur).not.toMatch(/City of Houston · ETJ/);
  });

  it("a failed CITY lookup never renders as a positive containment answer", async () => {
    const { b } = await badgeFor("Goose Creek", { fail: ["city"] });
    expect(b.cityContainment).toBe("unknown");
    expect(b.unresolvedRoles).toContain("city");
    expect(b.jur).toContain("Couldn't check city limits");
    expect(b.jur.startsWith("City of ")).toBe(false);
  });

  it("a failed COUNTY lookup is named, not omitted", async () => {
    const { b } = await badgeFor("Gessner", { fail: ["county"] });
    expect(b.county).toBe("Couldn't check county");
    expect(b.unresolvedRoles).toContain("county");
  });
});
