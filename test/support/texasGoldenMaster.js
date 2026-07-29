/* NEW-1 — the TEXAS GOLDEN-MASTER characterisation builder.
 *
 * WHY THIS EXISTS. The Colorado work (NEW-2…NEW-8) touches the projection frame, the county
 * registry, the drainage-authority resolver, the floodplain rules and the detention engine —
 * every one of which a Texas plan already depends on. The owner's hard constraint is that Texas
 * must be PROVABLY unchanged, not carefully changed. So before a line of that work landed, this
 * module froze what the Texas paths ACTUALLY produce today, across a representative matrix, and
 * `test/goldenMasterTexas.test.js` asserts the recomputed values are byte-identical to the
 * committed snapshot (`test/fixtures/texasGoldenMaster.json`).
 *
 * HOW TO READ A FAILURE. A diff here is NOT "update the snapshot". It means a Texas output moved.
 * The only legitimate reason to regenerate the fixture is a DELIBERATE, owner-approved change to a
 * Texas rule — and then the regeneration is its own commit, with the moved values named in the
 * message. Regenerate with:  node scripts/build-texas-golden-master.mjs
 *
 * WHAT IT COVERS (and what it cannot):
 *   ✓ pure, deterministic, network-free library outputs — projection + planner frame, county
 *     routing, jurisdiction→authority resolution, detention volumes across every modeled Texas
 *     authority, drawdown, floodplain-mitigation rule records, flood administrator + FFE,
 *     road/paving quantities and the cost takeoff, pond storage geometry.
 *   ✗ anything that needs a live GIS answer (identifyJurisdiction, resolveDrainageAuthority's
 *     fetch half, WSE samplers) — those are stubbed at the pure boundary (we feed the resolver's
 *     INPUTS and freeze its pure mapping), because a network fixture would freeze the county
 *     server's data, not our behaviour.
 *   ✗ React rendering and the export sheet — covered by their own suites; this harness is about
 *     the numbers those surfaces read.
 *
 * Deterministic by construction: every date is pinned (`ON_DATE`), no Date.now(), no randomness.
 */

import { projectToGrid, gridToProject, ftToAcres, metersToFeet } from "../../src/shared/coordinates/index.js";
import { lngLatToFeet, feetToLatLngPair, ppfToZoom, zoomToPpf, mercDeg, ftPerDeg } from "../../src/workspaces/site-planner/lib/mapLock.js";
import {
  COUNTIES, COUNTIES_MAP, STATEWIDE_KEYS, STATEWIDE_PARCEL_LAYER,
  candidateCountiesForPoint, countyKeyForName, statewideFallbackFor, FEET_WKID,
} from "../../src/workspaces/site-planner/lib/counties.js";
import {
  authorityForJurisdiction, computeRequiredDetention, ruleFor, rateFromImpervious,
  assessAnalysisTier, runoffCoefficient, designStorm24hrDepthIn, stormIntensity,
  pondAutoValues, COUNTY_AUTHORITY, AUTHORITY_SHORT, DETENTION_AUTHORITY_CHOICES,
} from "../../src/workspaces/site-planner/lib/detentionRules.js";
import { allowableReleaseCfs, assessDrawdown } from "../../src/workspaces/site-planner/lib/drawdownTime.js";
import { DEFAULT_FLOODPLAIN_RULES } from "../../src/workspaces/site-planner/lib/floodplainRules.js";
import { DEFAULT_BUILDABILITY_RULES, requiredFfe } from "../../src/workspaces/site-planner/lib/buildability.js";
import { assessAdministrator } from "../../src/workspaces/site-planner/lib/floodAdministrator.js";
import { roadQuantities, costRollup } from "../../src/workspaces/site-planner/lib/costTakeoff.js";
import { detentionStorage } from "../../src/workspaces/site-planner/lib/pondGeom.js";

/* Every rule lookup is date-versioned, so the harness pins ONE date. Without this the snapshot
 * would silently change the day a future-dated rule record takes effect. */
export const ON_DATE = "2026-07-20";

/* Representative Texas points: the four configured counties plus downtown Houston (the
 * jurisdiction calibration point) and a deliberately out-of-every-bbox point (the Panhandle),
 * which exercises `candidateCountiesForPoint`'s fallback branch — the one whose first element
 * other code reads. */
export const TX_POINTS = {
  houstonDowntown: { lat: 29.7604, lon: -95.3698 },
  harrisNW: { lat: 29.9800, lon: -95.6200 },
  fortBendSugarland: { lat: 29.5994, lon: -95.6142 },
  chambersAnahuac: { lat: 29.7355, lon: -94.6816 },
  wallerKaty: { lat: 29.9000, lon: -95.9000 },
  outsideEveryBbox: { lat: 35.2220, lon: -101.8313 }, // Amarillo
};

/* A small, fixed set of road elements for the takeoff — shaped exactly like the planner's. */
const ROAD_ELS = [
  { id: "r1", type: "road", curbType: "curb-gutter", w: 30, h: 400 },
  { id: "r2", type: "road", curbType: "barrier", w: 24, h: 250 },
  { id: "r3", type: "road", curbType: "none", w: 28, h: 180 },
];

const round = (n, dp = 10) => (n == null || !Number.isFinite(n) ? n : Number(n.toFixed(dp)));

/* Reduce a detention carrier to the fields a panel actually renders, so the snapshot pins the
 * ANSWER (volume, rate, basis text, flags, which rule record governed) rather than object identity. */
const slimDetention = (r) => ({
  kind: r.kind,
  requiredAcFt: r.requiredAcFt,
  bandAcFt: r.bandAcFt,
  rateAcFtPerAc: r.rateAcFtPerAc,
  rateBandAcFtPerAc: r.rateBandAcFtPerAc ?? null,
  rateBandLabel: r.rateBandLabel ?? null,
  basis: r.basis,
  ruleId: r.rule ? r.rule.id : null,
  ruleType: r.rule ? r.rule.ruleType : null,
  flags: [...(r.flags || [])].sort(),
  governing: r.governing ? { picked: r.governing.picked, reason: r.governing.reason } : null,
});

const slimFfe = (r) => ({
  requiredFfeFt: round(r.requiredFfeFt),
  basis: r.basis ?? null,
  plusFt: r.plusFt ?? null,
  governingBasis: r.governingBasis ? { basis: r.governingBasis.basis, plusFt: r.governingBasis.plusFt } : null,
  pendingBases: (r.pendingBases || []).map((b) => b.basis),
  losingBases: (r.losingBases || []).map((b) => b.basis),
  unknownReason: r.unknownReason ?? null,
});

/* ---------------------------------------------------------------------------
 * The builder. One pure function → one plain object. Key order is stable because
 * it is written literally; JSON.stringify of it is therefore reproducible.
 * ------------------------------------------------------------------------- */
export function buildTexasGoldenMaster() {
  const out = {};

  // ── 1. Projection + coordinate output ────────────────────────────────────
  // The EPSG:2278 project grid (the shared coordinate spine) at each Texas point, and the
  // round trip back. NEW-3 makes projection resolve PER SITE; these values must not move.
  out.projection = { crs: "EPSG:2278", feetWkid: FEET_WKID, points: {} };
  for (const [k, p] of Object.entries(TX_POINTS)) {
    const g = projectToGrid(p.lat, p.lon);
    const back = gridToProject(g);
    out.projection.points[k] = {
      lat: p.lat, lon: p.lon,
      x: round(g.x, 6), y: round(g.y, 6),
      backLat: round(back.lat, 10), backLon: round(back.lon, 10),
    };
  }
  out.projection.units = { ftToAcres_43560: ftToAcres(43560), metersToFeet_1000: round(metersToFeet(1000), 10) };

  // ── 2. The planner's own feet frame (mapLock) ────────────────────────────
  // The site-anchored scaled-Mercator frame. Nothing in the Colorado work may touch this,
  // and if a projection change leaked into it every drawn dimension would move.
  out.plannerFrame = { origins: {} };
  for (const [k, p] of Object.entries(TX_POINTS)) {
    const off = lngLatToFeet(p.lon + 0.01, p.lat + 0.01, p.lon, p.lat);
    const backPt = feetToLatLngPair({ x: 1000, y: 2000 }, p.lat, p.lon);
    out.plannerFrame.origins[k] = {
      ftPerDeg: round(ftPerDeg(p.lat), 8),
      mercDeg: round(mercDeg(p.lat), 10),
      offsetFt: { x: round(off.x, 8), y: round(off.y, 8) },
      backLatLng: [round(backPt[0], 10), round(backPt[1], 10)],
      zoomAt1ppf: round(ppfToZoom(1, p.lat), 10),
      ppfAtZoom18: round(zoomToPpf(18, p.lat), 10),
    };
  }

  // ── 3. County routing ────────────────────────────────────────────────────
  // NEW-5 adds Colorado rows to this same registry. `candidateCountiesForPoint` is the
  // click-routing spine and its first element is read by the Layers-panel jurisdiction
  // resolver — the single most breakable thing in an additive registry change.
  // The registry is expected to GROW (that is what NEW-5 does), so this pins the TEXAS SUBSET and
  // the Texas ANSWERS, not the total key count. `candidates` is the load-bearing one: it is the
  // click-routing spine, and its first element is what the Layers-panel jurisdiction resolver reads.
  // A Colorado row that perturbed any of these lists would be a Texas regression, additive or not.
  const TX_KEYS = ["harris", "fortbend", "chambers", "waller"];
  out.countyRouting = {
    texasKeysPresent: TX_KEYS.filter((k) => k in COUNTIES),
    texasMapKeysPresent: [...TX_KEYS, "txgio_statewide"].filter((k) => k in COUNTIES_MAP),
    txgioIsStatewide: STATEWIDE_KEYS.includes("txgio_statewide"),
    statewideParcelLayer: STATEWIDE_PARCEL_LAYER,
    layerUrls: Object.fromEntries(TX_KEYS.map((k) => [k, COUNTIES[k] ? COUNTIES[k].layerUrl : null])),
    mapLayerUrls: Object.fromEntries([...TX_KEYS, "txgio_statewide"].map((k) => [k, COUNTIES_MAP[k] ? COUNTIES_MAP[k].layerUrl : null])),
    bboxes: Object.fromEntries(TX_KEYS.map((k) => [k, COUNTIES_MAP[k] ? COUNTIES_MAP[k].bbox : null])),
    candidates: Object.fromEntries(Object.entries(TX_POINTS).map(([k, p]) => [k, candidateCountiesForPoint(p.lat, p.lon)])),
    countyKeyForName: Object.fromEntries(
      ["Harris", "Fort Bend", "Chambers County", "Waller", "Montgomery", "nonsense"]
        .map((n) => [n, countyKeyForName(n)]),
    ),
    statewideFallback: Object.fromEntries(TX_KEYS.map((k) => [k, statewideFallbackFor(k)])),
  };

  // ── 4. Jurisdiction → drainage-authority resolution (the pure half) ──────
  // resolveDrainageAuthority's network half is untestable offline; its DECISION is
  // authorityForJurisdiction, and that is what a Colorado branch could break.
  const jurCases = {
    unincorporatedHarris: { county: ["Harris"], city: [], etj: [], cityCentroid: [] },
    houstonCityLimits: { county: ["Harris"], city: ["Houston"], etj: [], cityCentroid: ["Houston"] },
    houstonEtjFortBend: { county: ["Fort Bend"], city: [], etj: ["Houston"], cityCentroid: [] },
    katySliverHoustonEtj: { county: ["Fort Bend"], city: ["Katy"], etj: ["Houston"], cityCentroid: [] },
    katyMateriallyInside: { county: ["Fort Bend"], city: ["Katy"], etj: [], cityCentroid: ["Katy"] },
    missouriCity: { county: ["Fort Bend"], city: ["Missouri City"], etj: [], cityCentroid: ["Missouri City"] },
    countyStraddle: { county: ["Harris", "Fort Bend"], city: [], etj: [], cityCentroid: [] },
    cityStraddle: { county: ["Harris"], city: ["Houston", "Pasadena"], etj: [], cityCentroid: ["Houston"] },
    unincorporatedWaller: { county: ["Waller"], city: [], etj: [], cityCentroid: [] },
    unincorporatedChambers: { county: ["Chambers"], city: [], etj: [], cityCentroid: [] },
    legacyNoCentroidField: { county: ["Fort Bend"], city: ["Katy"], etj: [] },
  };
  out.drainageAuthority = {
    countyAuthority: { ...COUNTY_AUTHORITY },
    authorityShort: { ...AUTHORITY_SHORT },
    authorityChoices: DETENTION_AUTHORITY_CHOICES.map((c) => ({ id: c.id, label: c.label })),
    cases: Object.fromEntries(Object.entries(jurCases).map(([k, sig]) => {
      const a = authorityForJurisdiction(sig);
      return [k, {
        primary: a.primary,
        channelAuthority: a.channelAuthority,
        flags: [...a.flags].sort(),
        overlayKinds: a.overlays.map((o) => `${o.kind}:${o.id || o.city || o.name || "?"}`).sort(),
        overlayShorts: a.overlays.map((o) => o.short || null),
        ambiguous: a.ambiguous.map((x) => ({ kind: x.kind, candidates: x.candidates, detail: x.detail })),
      }];
    })),
  };

  // ── 5. Detention — required volume across every modeled Texas authority ──
  // The headline number. NEW-8's Colorado guard must not perturb a single Texas cell.
  const authorities = ["hcfcd", "coh", "fortbend", "montgomery", "chambers", "waller", "bkdd", "missouricity", "magnolia"];
  const sizes = [
    { acres: 5, impPct: null },
    { acres: 5, impPct: 65 },
    { acres: 25, impPct: 70 },
    { acres: 80.34, impPct: 72 },   // the Bain / Concept A tract the drawdown example pins
    { acres: 300, impPct: 85 },
    { acres: 700, impPct: 60 },
  ];
  out.detention = { rules: {}, matrix: {} };
  for (const a of authorities) {
    const r = ruleFor(a, ON_DATE);
    out.detention.rules[a] = r ? { id: r.id, ruleType: r.ruleType, effectiveDate: r.effectiveDate, authorityLabel: r.authorityLabel } : null;
    for (const s of sizes) {
      const key = `${a}|${s.acres}ac|${s.impPct == null ? "impNA" : s.impPct + "%"}`;
      out.detention.matrix[key] = slimDetention(computeRequiredDetention({ ...s, authorityId: a, onDate: ON_DATE }));
    }
  }
  // The Harris outfall-type minimum + PCPM branches, and the B789 hcfcdApplicable gate.
  out.detention.harrisVariants = Object.fromEntries([
    ["stormSewer", { outfallType: "stormSewer" }],
    ["roadsideDitch", { outfallType: "roadsideDitch" }],
    ["unknownOutfall", { outfallType: "unknown" }],
    ["pcpmMethod", { hcfcdMethod: "pcpm" }],
    ["hcfcdNotApplicable", { hcfcdApplicable: false }],
    ["inCityLimits", { inCityLimits: true }],
  ].map(([k, extra]) => [k, slimDetention(computeRequiredDetention({ acres: 40, impPct: 70, authorityId: "hcfcd", onDate: ON_DATE, ...extra }))]));
  // The published rate curves themselves (Fort Bend Table 6-1, Montgomery Eq. 6-2).
  out.detention.rateFromImpervious = {};
  for (const a of ["fortbend", "montgomery", "hcfcd", "chambers"]) {
    const r = ruleFor(a, ON_DATE);
    for (const imp of [0, 25, 50, 65, 80, 95, 100]) {
      out.detention.rateFromImpervious[`${a}|${imp}`] = rateFromImpervious(r, imp, 20);
    }
  }
  // Storm/runoff primitives that feed the rate method.
  out.detention.storms = {
    runoffCoefficient: Object.fromEntries([0, 25, 50, 72, 100].map((i) => [i, runoffCoefficient(i)])),
    depth24hr: Object.fromEntries([2, 10, 25, 100].map((y) => [y, designStorm24hrDepthIn(y)])),
    intensity: Object.fromEntries([[100, 60], [100, 15], [25, 60], [2, 5]].map(([y, d]) => [`${y}yr|${d}min`, round(stormIntensity(y, d), 8)])),
  };
  // Analysis tier + pond auto-values (the criteria the pond inspector seeds from).
  out.detention.analysisTier = Object.fromEntries(
    [["hcfcd", 25], ["hcfcd", 800], ["fortbend", 60], ["chambers", 150], ["montgomery", 700]].map(([a, ac]) => {
      const t = assessAnalysisTier({ acres: ac, authorityId: a, floodZones: [{ zone: "AE" }], channel: { near: false } });
      return [`${a}|${ac}ac`, { tier: t.tier, triggerIds: (t.triggers || []).map((x) => x.id).sort(), unknownIds: (t.unknowns || []).map((x) => x.id).sort() }];
    }),
  );
  out.detention.pondAuto = Object.fromEntries(["hcfcd", "fortbend", "coh", "montgomery"].map((a) => {
    const v = pondAutoValues({ authorityId: a, onDate: ON_DATE, groundElevFt: 100 });
    return [a, JSON.parse(JSON.stringify(v))];
  }));

  // ── 6. Drawdown (the readout NEW-7 turns into a Colorado STATUTE) ────────
  // Texas presentation must stay exactly the informational readout it is today.
  const release = allowableReleaseCfs({ rateCfsPerAc: 0.125, acres: 80.34 });
  out.drawdown = {
    release: { cfs: round(release.cfs, 8), basis: release.basis, rateCfsPerAc: release.rateCfsPerAc, acres: release.acres },
    noRate: allowableReleaseCfs({ rateCfsPerAc: null, acres: 80.34 }),
    assessed: (() => {
      const a = assessDrawdown({
        ponds: [{ id: "p1", name: "Pond A", volumeCf: 150.9 * 43560 }, { id: "p2", name: "Pond B", volumeCf: 55.4 * 43560 }],
        siteVolumeCf: 206.3 * 43560,
        release,
      });
      return {
        known: a.known, releaseCfs: round(a.releaseCfs, 8), maxHr: a.maxHr, optimistic: a.optimistic,
        site: { hours: round(a.site.hours, 6), days: round(a.site.days, 6), tone: a.site.tone, label: a.site.label },
        ponds: a.ponds.map((p) => ({ id: p.id, hours: round(p.hours, 6), tone: p.tone, label: p.label })),
        worstTone: a.worstTone, note: a.note,
      };
    })(),
    unknown: (() => { const a = assessDrawdown({ ponds: [], siteVolumeCf: 100, release: null }); return { known: a.known, reason: a.reason }; })(),
  };

  // ── 7. Floodplain mitigation rule records ────────────────────────────────
  // NEW-7 adds Colorado records to this same registry; the Texas rows must not move.
  out.floodplainRules = Object.fromEntries(Object.entries(DEFAULT_FLOODPLAIN_RULES).map(([k, r]) => [k, {
    label: r.label, trigger: r.trigger, ratio: r.ratio, floodwayPolicy: r.floodwayPolicy,
    offsetScope: r.offsetScope, offsetElevBasis: r.offsetElevBasis ?? null,
    floodwayBufferFt: r.floodwayBufferFt ?? null, verified: r.verified === true,
    source: r.source, sourceDate: r.sourceDate ?? null,
  }]));

  // ── 8. FFE / flood administrator ─────────────────────────────────────────
  out.ffe = { rules: {}, required: {}, administrator: {} };
  for (const [k, r] of Object.entries(DEFAULT_BUILDABILITY_RULES)) {
    out.ffe.rules[k] = {
      label: r.label, verified: r.verified === true,
      ffeRule: r.ffeRule ? (Array.isArray(r.ffeRule.bases)
        ? { kind: "bases", bases: r.ffeRule.bases.map((b) => ({ basis: b.basis, plusFt: b.plusFt, when: b.when ?? null })) }
        : { kind: "single", basis: r.ffeRule.basis, plusFt: r.ffeRule.plusFt }) : null,
    };
  }
  const ffeInputs = { wse1pctFt: 140.2, wse02Ft: 142.8, atlas14Wse100Ft: 141.4, preAtlas100Ft: 139.9, zoneAEstBfeFt: null, siteBasisFt: 143.0, hagFt: 138.5 };
  for (const k of Object.keys(DEFAULT_BUILDABILITY_RULES)) {
    out.ffe.required[k] = slimFfe(requiredFfe(DEFAULT_BUILDABILITY_RULES[k], ffeInputs, {}));
    out.ffe.required[`${k}|noInputs`] = slimFfe(requiredFfe(DEFAULT_BUILDABILITY_RULES[k], {}, {}));
  }
  const adminCases = {
    bainFortBendHoustonEtj: { signals: { authorityId: "fortbend", county: "Fort Bend", cityLabel: null, etjLabel: "Houston", edgeLabels: ["City of Katy"], floodJurKey: "fortbend" }, ffeFt: 144.8 },
    unincorporatedHarris: { signals: { authorityId: "hcfcd", county: "Harris", floodJurKey: "harris" }, ffeFt: 60.0 },
    houstonCity: { signals: { authorityId: "coh", county: "Harris", cityLabel: "City of Houston", floodJurKey: "coh" }, ffeFt: 62.5 },
    wallerUnincorporated: { signals: { authorityId: "waller", county: "Waller", floodJurKey: "waller" }, ffeFt: 210.0 },
  };
  for (const [k, c] of Object.entries(adminCases)) {
    const a = assessAdministrator({ signals: c.signals, rules: DEFAULT_BUILDABILITY_RULES, ffeFt: c.ffeFt });
    out.ffe.administrator[k] = {
      governingKey: a.governing ? a.governing.key : null,
      governingLabel: a.governingLabel, governingRuleText: a.governingRuleText,
      governingVerified: a.governingVerified, ambiguous: a.ambiguous,
      selectionReason: a.selectionReason, spreadFt: round(a.spreadFt, 8),
      candidates: a.candidates.map((x) => `${x.kind}:${x.key}:${x.ruleModeled}`).sort(),
      impliedFloodElevFt: a.impliedFlood ? round(a.impliedFlood.impliedFloodElevFt, 6) : null,
    };
  }

  // ── 9. Road + paving quantities and the cost takeoff ─────────────────────
  out.roadTakeoff = {
    quantities: Object.fromEntries(ROAD_ELS.map((el) => [el.id, (() => {
      const q = roadQuantities(el, el.w, el.h);
      return { ...q, pavingSf: round(q.pavingSf, 8), pavingSy: round(q.pavingSy, 8), curbLf: round(q.curbLf, 8), pavingWidth: round(q.pavingWidth, 8) };
    })()])),
    rollup: (() => {
      const r = costRollup(ROAD_ELS, (el) => el.w, (el) => el.h, { pavingSy: 42.5, curbBarrierLf: 18, curbGutterLf: 26.75 });
      return JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === "number" ? round(v, 8) : v)));
    })(),
    unpriced: (() => {
      const r = costRollup(ROAD_ELS, (el) => el.w, (el) => el.h, {});
      return JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === "number" ? round(v, 8) : v)));
    })(),
  };

  // ── 10. Pond storage geometry ────────────────────────────────────────────
  const pondRing = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }];
  out.pondStorage = Object.fromEntries([[8, 1, 3], [10, 1, 4], [6, 2, 3]].map(([d, fb, sl]) => {
    const s = detentionStorage(pondRing, d, fb, sl);
    return [`d${d}|fb${fb}|s${sl}`, JSON.parse(JSON.stringify(s, (_k, v) => (typeof v === "number" ? round(v, 6) : v)))];
  }));

  return out;
}
