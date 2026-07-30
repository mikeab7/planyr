/* NEW-1 / NEW-2 / NEW-3 — the shared flood-zone reader.
 *
 * THE FIXTURES ARE REAL. Every subtype string asserted here was read off FEMA's own NFHL
 * MapServer on 2026-07-30 — layer 28's `drawingInfo.renderer.uniqueValueInfos` (which is FEMA
 * deciding what each subtype MEANS by deciding what colour to paint it) plus live counts from
 * the service. The two that matter most:
 *   "1 PCT DEPTH LESS THAN 1 FOOT"                → 30,981 polygons, painted SHADED X
 *   "1 PCT DRAINAGE AREA LESS THAN 1 SQUARE MILE" → 23,157 polygons, painted SHADED X
 * The app's previous /0\.2 pct/ test read both as "no flood hazard", which silently withheld the
 * 500-year fill/FFE trigger (COH Ch.19, Fort Bend Interim Atlas-14 §9, Waller Art. 5 §A(8)) on
 * every site in one. Do not narrow these back to a substring match.
 *
 * The owner's Colorado repro is asserted verbatim as its own case: FLD_ZONE "X", ZONE_SUBTY
 * "AREA OF MINIMAL FLOOD HAZARD", DFIRM_ID "08069C", FLD_AR_ID "08069C_2802" — the exact
 * attributes the live service returns at the Johnstown site.
 */
import { describe, it, expect } from "vitest";
import { resolveFloodZone as classifyFloodZone, isShadedXSubtype, isSfhaZone } from "../src/workspaces/site-planner/lib/floodZone.js";
import {
  describeFloodZone, undrawnReason, femaZoneVerdict,
  firmStudy, firmStudySpan, firmPanel, floodAbsence, COUNTY_FIPS, STATE_FIPS,
} from "../src/workspaces/site-planner/lib/floodZoneCopy.js";

/* The classifier and its words are two modules (a bundle split — see floodZoneCopy.js). Every
 * assertion below reads the DESCRIBED answer, which is what a surface renders; `classifyFloodZone`
 * is asserted directly only where the classification itself is the point. */
const resolveFloodZone = describeFloodZone;
import {
  floodReadout, gapMessage, stateMessage, createHoverIdentify, IDENTIFY_STATE,
} from "../src/workspaces/site-planner/lib/rasterIdentify.js";

/* A viewport for the identify controller — the request shape is covered elsewhere; these cases
 * are about which STATE a given answer produces. The layer configs are stubs rather than the real
 * registry because `layers.js` imports Leaflet, which needs a DOM this node-env suite does not
 * have; `test/layerConsolidation.test.js` asserts the registry ROW itself (`identifyGap: "flood"`),
 * so the wiring is still covered end to end. */
const FRAME = { west: -105, south: 40.3, east: -104.9, north: 40.4, width: 800, height: 600 };
const FEMA_CFG = { url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer", layers: [27, 28], identifyGap: "flood" };
const WETLAND_CFG = { url: "https://example.test/MapServer", layers: [1] };
import { classifyNfhlFeature } from "../src/workspaces/site-planner/lib/floodplainMitigation.js";


// The owner's site, exactly as the live identify returns it.
const JOHNSTOWN = {
  DFIRM_ID: "08069C", FLD_AR_ID: "08069C_2802", FLD_ZONE: "X",
  ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD", SFHA_TF: "F", STATIC_BFE: "-9999",
};

describe("NEW-1 · shaded vs unshaded Zone X are never collapsed", () => {
  it("unshaded X (the owner's site) resolves as the all-clear and as UNDRAWN", () => {
    const r = resolveFloodZone(JOHNSTOWN);
    expect(r.variant).toBe("unshaded-x");
    expect(r.headline).toBe("No mapped floodplain · FEMA Zone X (unshaded)");
    expect(r.label).toBe("Zone X (unshaded)");
    expect(r.shadedX).toBe(false);
    expect(r.sfha).toBe(false);
    expect(r.drawn).toBe(false);
    expect(r.short).toMatch(/outside the 100-year AND 500-year/i);
  });

  it("shaded X resolves as the 500-year band, and is DRAWN", () => {
    const r = resolveFloodZone({ FLD_ZONE: "X", ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" });
    expect(r.variant).toBe("shaded-x");
    expect(r.headline).toBe("500-year floodplain · FEMA Zone X (shaded)");
    expect(r.label).toBe("Zone X (shaded)");
    expect(r.shadedX).toBe(true);
    expect(r.drawn).toBe(true);
  });

  it("the two X variants produce DIFFERENT labels — the whole bug in one assertion", () => {
    const a = resolveFloodZone({ FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD" });
    const b = resolveFloodZone({ FLD_ZONE: "X", ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" });
    expect(a.zone).toBe(b.zone);            // FEMA gives both the same FLD_ZONE…
    expect(a.label).not.toBe(b.label);      // …and the app must never report them the same way
    expect(a.answer).not.toBe(b.answer);    // the ANSWERS must read as opposites at a glance
    expect(a.drawn).not.toBe(b.drawn);
  });

  /* Every FLD_ZONE = X subtype FEMA paints in its "0.2% Annual Chance Flood Hazard" class. */
  const SHADED = [
    "0.2 PCT ANNUAL CHANCE FLOOD HAZARD",
    "0.2 PCT ANNUAL CHANCE FLOOD HAZARD IN COASTAL ZONE",
    "0.2 PCT ANNUAL CHANCE FLOOD HAZARD IN COMBINED RIVERINE AND COASTAL ZONE",
    "0.2 PCT ANNUAL CHANCE FLOOD HAZARD CONTAINED IN CHANNEL",
    "0.2 PCT ANNUAL CHANCE FLOOD HAZARD CONTAINED IN STRUCTURE",
    "0.2 PERCENT ANNUAL CHANCE FLOOD HAZARD",
    "0.2 PERCENT ANNUAL CHANCE FLOOD HAZARD CONTAINED IN STRUCTURE",
    "0.2 PERCENT ANNUAL CHANCE FLOOD HAZARD CONTAINED IN CHANNEL",
    "0.2 PERCENT ANNUAL CHANCE FLOOD HAZARD IN COASTAL ZONE",
    "0.2 PERCENT ANNUAL CHANCE FLOOD HAZARD IN COMBINED RIVERINE AND COASTAL ZONE",
    "1 PCT DEPTH LESS THAN 1 FOOT",
    "1 PERCENT DEPTH LESS THAN 1 FOOT",
    "1 PCT DRAINAGE AREA LESS THAN 1 SQUARE MILE",
    "1 PERCENT DRAINAGE AREA LESS THAN 1 SQUARE MILE",
    "AREA WITH FLOOD HAZARD DUE TO NON-ACCREDITED LEVEE SYSTEM",
  ];
  for (const sub of SHADED) {
    it(`shaded X: "${sub}"`, () => {
      expect(isShadedXSubtype(sub)).toBe(true);
      expect(resolveFloodZone({ FLD_ZONE: "X", ZONE_SUBTY: sub }).variant).toBe("shaded-x");
    });
  }

  /* …and the X subtypes FEMA paints in a class of their OWN. Neither is the 0.2% band, and
   * neither may be silently folded into "no hazard" either. */
  it("future-conditions X is its own named state, not the 500-yr band and not an all-clear", () => {
    const r = resolveFloodZone({ FLD_ZONE: "X", ZONE_SUBTY: "1 PCT FUTURE CONDITIONS" });
    expect(r.variant).toBe("x-future");
    expect(r.shadedX).toBe(false);
    expect(r.drawn).toBe(true);
    expect(isShadedXSubtype("1 PCT FUTURE CONDITIONS")).toBe(false);
  });

  it("a future-conditions FLOODWAY is NOT the regulatory floodway", () => {
    expect(resolveFloodZone({ FLD_ZONE: "X", ZONE_SUBTY: "1 PCT FUTURE CONDITIONS, FLOODWAY" }).variant).toBe("x-future");
    expect(classifyNfhlFeature({ FLD_ZONE: "X", ZONE_SUBTY: "1 PCT FUTURE CONDITIONS, FLOODWAY" }).cls).not.toBe("floodway");
  });

  it("levee reduced-risk X is its own named state", () => {
    for (const sub of ["AREA WITH REDUCED FLOOD RISK DUE TO LEVEE",
      "AREA WITH REDUCED FLOOD HAZARD DUE TO ACCREDITED LEVEE SYSTEM",
      "AREA WITH REDUCED FLOOD HAZARD DUE TO PROVISIONALLY ACCREDITED LEVEE SYSTEM"]) {
      expect(resolveFloodZone({ FLD_ZONE: "X", ZONE_SUBTY: sub }).variant).toBe("x-levee");
      expect(isShadedXSubtype(sub)).toBe(false);
    }
  });

  it("X with no subtype at all is UNRESOLVED, never asserted as minimal risk", () => {
    const r = resolveFloodZone({ FLD_ZONE: "X" });
    expect(r.variant).toBe("x-unstated");
    expect(r.drawn).toBe(null);
    expect(r.short).toMatch(/cannot be told apart/i);
    expect(r.answer).toBe("Floodplain status unresolved");
  });

  it("SFHA and floodway still win over every X test", () => {
    expect(resolveFloodZone({ FLD_ZONE: "AE", SFHA_TF: "T" }).variant).toBe("sfha");
    expect(resolveFloodZone({ FLD_ZONE: "AE", SFHA_TF: "T", ZONE_SUBTY: "FLOODWAY" }).variant).toBe("floodway");
    expect(resolveFloodZone({ FLD_ZONE: "D" }).variant).toBe("d");
    for (const z of ["A", "AE", "AH", "AO", "AR", "A99", "V", "VE", "A12", "V30"]) expect(isSfhaZone(z)).toBe(true);
    for (const z of ["X", "D", "", null, "OPEN WATER"]) expect(isSfhaZone(z)).toBe(false);
  });
});

describe("NEW-1 · the 500-year-dependent rules consume the RESOLVED value", () => {
  it("the mitigation engine now classes the wider shaded-X vocabulary as 02pct", () => {
    // These two were "none" before — i.e. no 500-yr fill trigger on 54k polygons of real map.
    expect(classifyNfhlFeature({ FLD_ZONE: "X", ZONE_SUBTY: "1 PCT DEPTH LESS THAN 1 FOOT" }).cls).toBe("02pct");
    expect(classifyNfhlFeature({ FLD_ZONE: "X", ZONE_SUBTY: "1 PCT DRAINAGE AREA LESS THAN 1 SQUARE MILE" }).cls).toBe("02pct");
    expect(classifyNfhlFeature({ FLD_ZONE: "X", ZONE_SUBTY: "0.2 PERCENT ANNUAL CHANCE FLOOD HAZARD" }).cls).toBe("02pct");
  });

  it("the classes that were already right are unchanged (Texas stays put)", () => {
    expect(classifyNfhlFeature({ FLD_ZONE: "AE", SFHA_TF: "T", ZONE_SUBTY: "FLOODWAY" }).cls).toBe("floodway");
    expect(classifyNfhlFeature({ FLD_ZONE: "AE", SFHA_TF: "T" }).cls).toBe("1pct");
    expect(classifyNfhlFeature({ FLD_ZONE: "X", ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" }).cls).toBe("02pct");
    expect(classifyNfhlFeature({ FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD" }).cls).toBe("none");
    expect(classifyNfhlFeature({ FLD_ZONE: "D" }).cls).toBe("none");
    expect(classifyNfhlFeature({ FLD_ZONE: "A5" }).cls).toBe("1pct");
  });
});

describe("NEW-2 · the hover shows the ANSWER and nothing else", () => {
  it("the owner's exact tooltip attributes produce an answer, with every id gone", () => {
    const r = floodReadout(JOHNSTOWN);
    expect(r.title).toBe("No mapped floodplain · FEMA Zone X (unshaded)");
    // ⛔ The owner on the old headline: "I don't need that information. I don't know what that
    // means." NOTHING identifier-shaped may reach the hover — not the record id, not the DFIRM,
    // not the layer name.
    const all = JSON.stringify(r);
    expect(all).not.toMatch(/08069C_2802/i);
    expect(all).not.toMatch(/08069C/i);
    expect(all).not.toMatch(/Flood Hazard Zones/i);
    expect(r.rows.some((x) => x.label === "Study")).toBe(false);
    expect(Object.fromEntries(r.rows.map((x) => [x.label, x.text]))["Not drawn"]).toMatch(/empty map here is correct/i);
  });

  it("the headline leads with the ANSWER; FEMA's code follows as provenance", () => {
    expect(floodReadout(JOHNSTOWN).title.startsWith("No mapped floodplain")).toBe(true);
    expect(floodReadout({ FLD_ZONE: "X", ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" }).title)
      .toBe("500-year floodplain · FEMA Zone X (shaded)");
    expect(floodReadout({ FLD_ZONE: "AE", SFHA_TF: "T" }).title).toBe("100-year floodplain · FEMA Zone AE");
  });

  it("the word MAPPED is load-bearing — never 'No floodplain'", () => {
    // Unshaded X means FEMA did not MAP a hazard, not that the site cannot flood (local drainage,
    // unmapped tributaries, town master-plan drainageways all sit outside FEMA's studies).
    const r = resolveFloodZone(JOHNSTOWN);
    expect(r.answer).toBe("No mapped floodplain");
    expect(r.answer).not.toBe("No floodplain");
    expect(`${r.answer} ${r.short}`).toMatch(/not the same as the site being unable to flood/i);
    for (const v of ["unshaded-x", "x-levee"]) {
      const x = Object.values([resolveFloodZone(JOHNSTOWN), resolveFloodZone({ FLD_ZONE: "X", ZONE_SUBTY: "AREA WITH REDUCED FLOOD RISK DUE TO LEVEE" })]).find((y) => y.variant === v);
      expect(/\bno floodplain\b/i.test(`${x.answer} ${x.short}`), `${v} must not claim "no floodplain"`).toBe(false);
    }
  });

  it("a drawn zone gets no 'not drawn' row, and a real BFE rides along", () => {
    const r = floodReadout({ FLD_ZONE: "AE", SFHA_TF: "T", STATIC_BFE: 95, DFIRM_ID: "48201C" });
    expect(r.rows.some((x) => x.label === "Not drawn")).toBe(false);
    expect(r.rows.find((x) => x.label === "BFE").text).toBe("95′");
    expect(JSON.stringify(r)).not.toMatch(/48201C/); // still no study id on the hover
  });

  it("the -9999 BFE sentinel never reaches a readout", () => {
    expect(floodReadout(JOHNSTOWN).rows.some((x) => x.label === "BFE")).toBe(false);
  });

  it("non-flood attributes fall through to the generic path", () => {
    expect(floodReadout({ NAME: "Willow Fork" })).toBe(null);
  });

  it("undrawnReason speaks ONLY for a zone FEMA paints nothing for", () => {
    expect(undrawnReason(resolveFloodZone(JOHNSTOWN))).toMatch(/not a failed layer/i);
    expect(undrawnReason(resolveFloodZone({ FLD_ZONE: "AE", SFHA_TF: "T" }))).toBe(null);
    expect(undrawnReason(resolveFloodZone({ FLD_ZONE: "X" }))).toBe(null); // unresolved ≠ undrawn
  });

  it("the panel verdict distinguishes the two X variants and explains the blank map", () => {
    const un = femaZoneVerdict({ state: "loaded", zones: [{ zone: "X", subtype: "AREA OF MINIMAL FLOOD HAZARD", firm: "08069C" }] });
    expect(un.tone).toBe("ok");
    expect(un.text).toMatch(/^No mapped floodplain · FEMA Zone X \(unshaded\)/);
    expect(un.text).toMatch(/Nothing draws/);
    expect(un.text).toMatch(/Mapped by Larimer County/);
    expect(un.text).not.toMatch(/08069C/);   // the id lives on the basis hover, not the line

    const sh = femaZoneVerdict({ state: "loaded", zones: [{ zone: "X", subtype: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD", firm: "48201C" }] });
    expect(sh.tone).toBe("warn");                      // not a green all-clear
    expect(sh.text).toMatch(/^500-year floodplain · FEMA Zone X \(shaded\)/);
    expect(sh.text).not.toMatch(/Nothing draws/);
  });

  it("a shaded-X polygon behind an unshaded one still wins the verdict", () => {
    const v = femaZoneVerdict({ state: "loaded", zones: [
      { zone: "X", subtype: "AREA OF MINIMAL FLOOD HAZARD" },
      { zone: "X", subtype: "1 PCT DEPTH LESS THAN 1 FOOT" },
    ] });
    expect(v.text).toMatch(/Zone X \(shaded\)/);
    expect(v.tone).toBe("warn");
  });

  it("the SFHA and service-failure verdicts are unchanged", () => {
    expect(femaZoneVerdict({ state: "failed" }).tone).toBe("warn");
    const s = femaZoneVerdict({ state: "loaded", zones: [{ zone: "AE", subtype: "FLOODWAY" }] });
    expect(s.tone).toBe("alert");
    expect(s.text).toMatch(/^Regulatory floodway/);
    // NEW-7 — "loaded but no zones" is a COVERAGE GAP, so it warns; it is not the all-clear.
    expect(femaZoneVerdict({ state: "loaded", zones: [] }).tone).toBe("warn");
    expect(femaZoneVerdict(null)).toBe(null);
  });
});

describe("NEW-3 · which county's FIRM answered", () => {
  it("decodes a DFIRM_ID into its county and state", () => {
    expect(firmStudy("08069C")).toMatchObject({ county: "Larimer", state: "Colorado" });
    expect(firmStudy("08123C")).toMatchObject({ county: "Weld", state: "Colorado" });
    expect(firmStudy("48201C")).toMatchObject({ county: "Harris", state: "Texas" });
    expect(firmStudy("48157C").label).toBe("Fort Bend County, Texas (FIRM 48157C)");
  });

  it("an unlisted county degrades to the STATE and the id — never a bare id, never a guess", () => {
    const f = firmStudy("12086C"); // Miami-Dade, outside the counties this app carries
    expect(f.county).toBe(null);
    expect(f.state).toBe("Florida");
    expect(f.label).toBe("Florida (FIRM 12086C)");
    expect(f.name).toBe("Florida");
  });

  it("a non-FIPS-shaped study id still reports itself rather than vanishing", () => {
    expect(firmStudy("HAWAII_C").label).toBe("FIRM HAWAII_C");
    expect(firmStudy(null)).toBe(null);
  });

  it("flags a site whose extent spans TWO studies (the county-line case)", () => {
    const span = firmStudySpan([{ firm: "08069C" }, { firm: "08123C" }, { firm: "08069C" }]);
    expect(span.multiple).toBe(true);
    expect(span.studies).toHaveLength(2);
    expect(span.text).toMatch(/Two FIRM studies cover this site/);
    expect(span.text).toMatch(/Larimer County and Weld County/);
  });

  it("a single study is stated plainly, and no study at all says nothing", () => {
    expect(firmStudySpan([{ firm: "08069C" }]).multiple).toBe(false);
    // Glance level names WHO, never an id — the id rides the basis hover (firmPanel).
    expect(firmStudySpan([{ firm: "08069C" }]).text).toBe("Larimer County");
    expect(firmStudySpan([{ firm: "08069C" }]).text).not.toMatch(/08069C/);
    expect(firmStudySpan([{ zone: "X" }]).text).toBe(null);
    expect(firmStudySpan([]).text).toBe(null);
  });

  it("decodes a real FIRM PANEL — the thing FLD_AR_ID was never able to be", () => {
    // Live values at the owner's site (NFHL layer 3, 2026-07-30).
    const p = firmPanel({ DFIRM_ID: "08069C", FIRM_PAN: "08069C1405G", EFF_DATE: 1610668800000 });
    expect(p.label).toBe("Larimer County, Colorado FIRM panel 08069C1405G, effective Jan 15, 2021");
    expect(p.panel).toBe("08069C1405G");
    expect(p.effective).toBe("Jan 15, 2021");
  });

  it("a panel with no effective date says less rather than guessing one", () => {
    const p = firmPanel({ DFIRM_ID: "48201C", FIRM_PAN: "48201C0790M" });
    expect(p.label).toBe("Harris County, Texas FIRM panel 48201C0790M");
    expect(p.effective).toBe(null);
    expect(firmPanel(null)).toBe(null);
    expect(firmPanel({})).toBe(null);
  });

  it("the FIPS tables are well-formed (no duplicate county names within a state)", () => {
    for (const k of Object.keys(COUNTY_FIPS)) {
      expect(String(k)).toMatch(/^\d{5}$/);
      expect(STATE_FIPS[String(k).slice(0, 2)]).toBeTruthy();
    }
    const perState = {};
    for (const [k, v] of Object.entries(COUNTY_FIPS)) {
      const st = String(k).slice(0, 2);
      perState[st] = perState[st] || new Set();
      expect(perState[st].has(v), `${v} listed twice in state ${st}`).toBe(false);
      perState[st].add(v);
    }
    // Both states have an El Paso County — the reason firmStudy names the state too.
    expect(COUNTY_FIPS["08041"]).toBe("El Paso");
  });
});

/* -------------------------------------------------------------------------
 * NEW-7 — "no data" must never look like "no floodplain".
 *
 * The failure family this closes is the one this codebase has produced repeatedly: absence of
 * data silently wearing the costume of a good answer. "FEMA has nothing here" and "FEMA checked
 * and found no floodplain" are OPPOSITE risk positions, and every surface has to tell them apart.
 * ------------------------------------------------------------------------- */
describe("NEW-7 · the three states are distinct everywhere", () => {
  it("absence is REPRESENTABLE — a resolved answer, not a falsy zone", () => {
    const gap = floodAbsence("no-data");
    expect(gap.kind).toBe("no-data");
    expect(gap.answer).toBe("FEMA flood data not available here");
    expect(gap.short).toMatch(/NOT an all-clear/i);
    expect(gap.tone).toBe("warn");
    expect(gap.zone).toBe(null);           // no zone…
    expect(gap.headline).toBeTruthy();     // …but still a headline a surface can render
    expect(floodAbsence("unreachable").kind).toBe("unreachable");
    expect(floodAbsence("nonsense").kind).toBe("no-data"); // unknown kind degrades to the safe one
  });

  it("the panel's THREE answers are visually and semantically distinct", () => {
    const clear = femaZoneVerdict({ state: "loaded", zones: [{ zone: "X", subtype: "AREA OF MINIMAL FLOOD HAZARD" }] });
    const noData = femaZoneVerdict({ state: "empty", zones: [] });
    const failed = femaZoneVerdict({ state: "failed", zones: [] });

    // checked-and-clear vs we-do-not-know: different tone AND different words.
    expect(clear.tone).toBe("ok");
    expect(noData.tone).toBe("warn");
    expect(failed.tone).toBe("warn");
    expect(noData.text).not.toBe(clear.text);
    expect(noData.text).toMatch(/not available here/i);
    expect(noData.text).toMatch(/NOT an all-clear/i);
    expect(failed.text).toMatch(/didn't answer/i);
    expect(noData.kind).toBe("no-data");
    expect(failed.kind).toBe("unreachable");
    expect(clear.kind).toBe("zone");
    // …and neither absence state may borrow the all-clear's wording.
    for (const v of [noData, failed]) expect(v.text).not.toMatch(/No mapped floodplain/);
  });

  it("the hover says the same thing as the panel about a coverage gap (one source of truth)", () => {
    expect(gapMessage("flood")).toBe(floodAbsence("no-data").answer);
    expect(gapMessage("wetlands")).toBe(null);
    // A gap message REPLACES "Nothing here", which reads as the all-clear.
    expect(stateMessage({ kind: IDENTIFY_STATE.none, msg: gapMessage("flood") })).toBe("FEMA flood data not available here");
    expect(stateMessage({ kind: IDENTIFY_STATE.none })).toBe("Nothing here");
  });

  it("an EMPTY answer from the flood layer reads as a gap, not as empty ground", async () => {
    const states = [];
    const ctl = createHoverIdentify({
      fetchJson: async () => ({ results: [] }),          // the service answered: nothing here
      onState: (s) => states.push(s),
      debounceMs: 0,
      setTimer: (fn) => { fn(); return 1; },
      clearTimer: () => {},
      makeController: () => null,
      timeoutMs: 0,
    });
    ctl.hover({ lng: -104.96, lat: 40.343 }, FRAME, [{ id: "fema", cfg: FEMA_CFG }], { immediate: true });
    await new Promise((r) => setTimeout(r, 0));
    const last = states[states.length - 1];
    expect(last.kind).toBe(IDENTIFY_STATE.none);
    expect(stateMessage(last)).toBe("FEMA flood data not available here");
  });

  it("…while a layer with universal coverage still reads 'Nothing here'", async () => {
    const states = [];
    const ctl = createHoverIdentify({
      fetchJson: async () => ({ results: [] }),
      onState: (s) => states.push(s),
      debounceMs: 0,
      setTimer: (fn) => { fn(); return 1; },
      clearTimer: () => {},
      makeController: () => null,
      timeoutMs: 0,
    });
    ctl.hover({ lng: -95.4, lat: 29.7 }, FRAME, [{ id: "wetlands", cfg: WETLAND_CFG }], { immediate: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(stateMessage(states[states.length - 1])).toBe("Nothing here");
  });

  it("a FAILED fetch still outranks a gap — an outage is not a coverage answer", async () => {
    const states = [];
    const ctl = createHoverIdentify({
      fetchJson: async () => { const e = new Error("Failed to fetch"); throw e; },
      onState: (s) => states.push(s),
      debounceMs: 0,
      setTimer: (fn) => { fn(); return 1; },
      clearTimer: () => {},
      makeController: () => null,
      timeoutMs: 0,
    });
    ctl.hover({ lng: -104.96, lat: 40.343 }, FRAME, [{ id: "fema", cfg: FEMA_CFG }], { immediate: true });
    await new Promise((r) => setTimeout(r, 0));
    const last = states[states.length - 1];
    expect(last.kind).toBe(IDENTIFY_STATE.error);
    expect(stateMessage(last)).toMatch(/Couldn't reach the source/);
  });
});

describe("NEW-2 · a ring that straddles more than one zone", () => {
  it("reports the WORST zone but names every SFHA letter present", () => {
    const v = femaZoneVerdict({ state: "loaded", zones: [
      { zone: "X", subtype: "AREA OF MINIMAL FLOOD HAZARD" },
      { zone: "AE", staticBfeFt: 95 },
      { zone: "A" },
    ] });
    // "AE" and "A" carry different consequences — a published BFE versus an unstudied
    // approximate zone — so collapsing them to whichever came back first would hide one.
    expect(v.text).toMatch(/^100-year floodplain · FEMA Zones AE \+ A/);
    expect(v.tone).toBe("alert");
  });

  it("a floodway outranks the SFHA it sits in, and still names the zone", () => {
    const v = femaZoneVerdict({ state: "loaded", zones: [
      { zone: "AE", staticBfeFt: 95 },
      { zone: "AE", subtype: "FLOODWAY" },
    ] });
    expect(v.text).toMatch(/^Regulatory floodway · FEMA Zone AE/);
    expect(v.text).toMatch(/fill is a hard stop/);
  });
});
