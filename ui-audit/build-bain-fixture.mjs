#!/usr/bin/env node
/* build-bain-fixture — derive ui-audit/fixtures/bain-concept-a.json from the MEASURED CENSUS.
 *
 *   node ui-audit/build-bain-fixture.mjs          # write the fixture
 *   node ui-audit/build-bain-fixture.mjs --check  # fail if the committed file has drifted
 *
 * ⛔ READ THIS BEFORE QUOTING ANY BAIN NUMBER. THE PARAMETERS ARE MEASURED; THE GEOMETRY IS NOT.
 *
 * The owner read his real Bain plan — site `smr9olizi5ue`, "Concept A" — out of his live signed-in
 * browser session and reported its census. What he reported, and what this file reproduces EXACTLY
 * because these are what the cost depends on:
 *
 *   • 53 elements: building 12 · sidewalk 12 · parking 12 · road 8 · paving 6 · trailer 2 · pond 1
 *   • 5 parcels · 0 parcelDrawings · 0 markups · 0 measures · 0 callouts · no cross-sections
 *   • TWO LARGE RASTERS COMPOSITED OVER THE DRAWING, which is the thing nothing here has ever
 *     measured:
 *       – sheetOverlay  1728 × 2592 px  =  4.48 MP,  OPACITY 0.55,  locked, page 1, ftPerPx 2.7778,
 *         stored in IndexedDB by idbKey, ~10,188 KB as a base64 string
 *       – underlay      1800 × 1167 px  =  2.10 MP,  opacity 1.0,   fromMap
 *
 * WHAT IS SYNTHESISED, AND IT IS SAID HERE RATHER THAN BURIED. The owner offered the real 25,022-byte
 * plan JSON and it has not been taken yet, so this fixture's actual COORDINATES are invented — a
 * plausible industrial park laid out by pure arithmetic, no RNG, no Date. That is a real limitation
 * and it bounds exactly one class of claim: anything that depends on where his buildings happen to
 * sit. It does NOT bound the raster claims, which depend on dimensions, opacity, footprint and the
 * storage path — every one of which is measured and reproduced verbatim.
 *
 * THREE MORE STAND-INS, each held EQUAL TO THE GOOSE CREEK CONTROL on purpose, so that the
 * comparison isolates rasters instead of confounding them with four other differences:
 *   • `settings` — the census does not include them, so this fixture carries Goose Creek's own real
 *     30-key settings. A settings difference is therefore NOT under test.
 *   • `origin` / `county` — likewise Goose Creek's (Harris County). The real site is the Bain Tract
 *     at Willow Point; its coordinates were not in the census. Holding the origin equal also holds
 *     the basemap and every GIS endpoint equal between the two plans.
 *   • `layerOverrides` — empty, like Goose Creek's. Layers-on is B1447's axis, not this one.
 *
 * ⚠ SO THIS FIXTURE IS A FLOOR ON BAIN in the same sense Goose Creek was a floor on everything —
 * with one decisive difference: it is a floor that CONTAINS THE SUSPECT. Goose Creek structurally
 * could not show a raster cost, because it has no raster.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "fixtures", "bain-concept-a.json");
const CONTROL = JSON.parse(readFileSync(join(HERE, "fixtures", "goose-creek-plan1copy.json"), "utf8"));

/** Measured element census — the counts are the owner's, and they are asserted at the end. */
export const BAIN_CENSUS = { building: 12, sidewalk: 12, parking: 12, road: 8, paving: 6, trailer: 2, pond: 1 };
export const BAIN_PARCELS = 5;

/* ---- MEASURED RASTER PARAMETERS ---------------------------------------------------------------
 * ⛔ DO NOT "TIDY" THESE NUMBERS. Every one of them is a measurement off the owner's own plan, and
 * every one of them is a term in the cost being tested.
 *
 * The overlay's footprint follows from its own measured numbers: 1728 × 2.7778 = 4800 ft wide,
 * 2592 × 2.7778 = 7200 ft tall. The plan is laid out INSIDE that rectangle, which is what a placed
 * survey sheet actually looks like.
 *
 * ⚠ `ftPerPx` for the UNDERLAY was not in the census (a `fromMap` underlay's scale is whatever the
 * map was showing when it was captured). 1.3333 puts a 2400 × 1556 ft aerial over the drawn site,
 * which is the ordinary case. It is INFERRED, and it is marked as such in the fixture.
 */
const OVERLAY = {
  role: "sheetOverlay", id: "ovbain1",
  imgW: 1728, imgH: 2592, opacity: 0.55, ftPerPx: 2.7778,
  rotation: 0, locked: true, page: 1, visible: true,
  encodedBytes: 10188 * 1024, fromIdb: true,
};
const UNDERLAY = {
  role: "underlay", id: "underlay",
  imgW: 1800, imgH: 1167, opacity: 1, ftPerPx: 1.3333,
  rotation: 0, locked: false, visible: true,
  encodedBytes: 384 * 1024, fromIdb: true, fromMap: true,
};

/* ---- The synthesised layout -------------------------------------------------------------------
 * Pure arithmetic over fixed constants. A reader can check every number; nothing here is random and
 * nothing depends on the clock, so the committed file is byte-stable and `--check` is meaningful.
 */
const r2 = (n) => Math.round(n * 100) / 100;

/* Six building pads down the tract, each ~1,000 × 380 ft with a truck court, laid on a 1,200 ft
 * pitch — the shape of a real multi-building industrial park. Twelve buildings = six pads × two. */
const PADS = Array.from({ length: 6 }, (_, i) => ({
  cx: i % 2 === 0 ? -900 : 900,
  cy: -2600 + Math.floor(i / 2) * 1900,
}));

function buildElements() {
  const els = [];
  let z = 0;
  const push = (e) => { els.push({ z: (z += 1024), ...e }); };

  PADS.forEach((pad, i) => {
    const big = i % 2 === 0;
    const w = big ? 1040 : 620, h = big ? 380 : 300;
    const bId = `bain-b${i * 2 + 1}`;
    push({ id: bId, type: "building", cx: pad.cx, cy: pad.cy, w, h, rot: 0, dock: big ? "cross" : "single", dockSide: "bottom", fillOpacity: 1 });
    // A second, smaller building on the same pad — 6 pads × 2 = the measured 12.
    push({ id: `bain-b${i * 2 + 2}`, type: "building", cx: pad.cx, cy: pad.cy + h / 2 + 260, w: Math.round(w * 0.42), h: 190, rot: 0, dock: "none", dockSide: "top", fillOpacity: 1 });

    // 12 sidewalks and 12 parking fields — one of each per building, the measured ratio.
    push({ id: `bain-s${i * 2 + 1}`, type: "sidewalk", cx: pad.cx, cy: r2(pad.cy - h / 2 - 2.5), w, h: 5, rot: 0, attachedTo: bId, sidewalkSide: "top" });
    push({ id: `bain-s${i * 2 + 2}`, type: "sidewalk", cx: pad.cx, cy: r2(pad.cy + h / 2 + 2.5), w: Math.round(w * 0.42), h: 5, rot: 0, attachedTo: bId, sidewalkSide: "bottom" });
    push({ id: `bain-p${i * 2 + 1}`, type: "parking", cx: pad.cx, cy: r2(pad.cy - h / 2 - 35), w, h: 60, rot: 180, attachedTo: bId, sideParkSide: "top" });
    push({ id: `bain-p${i * 2 + 2}`, type: "parking", cx: r2(pad.cx - w / 2 - 31), cy: pad.cy, w: h, h: 62, rot: 90, attachedTo: bId, sideParkSide: "left" });
  });

  // 6 truck courts (paving) and 2 trailer storage zones — the measured counts, on the big pads.
  PADS.filter((_, i) => i % 2 === 0).concat(PADS.filter((_, i) => i % 2 === 1)).slice(0, 6).forEach((pad, i) => {
    push({ id: `bain-pv${i + 1}`, type: "paving", cx: pad.cx, cy: r2(pad.cy + 190 + 67.5), w: 1040, h: 135, zd: 135, rot: 0, attachedTo: `bain-b${i * 2 + 1}`, truckCourt: { side: "bottom" } });
  });
  [0, 2].forEach((padIdx, k) => {
    const pad = PADS[padIdx];
    push({
      id: `bain-tr${k + 1}`, type: "trailer", cx: pad.cx, cy: r2(pad.cy + 190 + 135 + 25), w: 1040, h: 50, zd: 50,
      cfg: { single: true, trailerL: 50, trailerW: 12, trailerAisle: 0 },
      rot: 0, noFit: true, forCourt: `bain-pv${padIdx + 1}`, attachedTo: `bain-b${padIdx * 2 + 1}`,
    });
  });

  /* 8 CENTRELINE ROADS with arc vertices — the class that drives roadNet / teeJunctionsOf /
   * dissolveRings, i.e. the most expensive geometry code in the app. A fixture without these
   * measures a scene with the work taken out; that was the exact defect perf-scenario.mjs was
   * rebuilt to fix, and repeating it here would repeat it. */
  /* ⚠ THE ROAD SCHEMA IS NOT OPTIONAL AND IT IS NOT FORGIVING. A road authored without `rot`, or
   * with a `vtx` radius that carries no `treatment`, makes the whole view resolve to NaN — the
   * canvas renders 117 nodes, zero elements, and `data-view-ppf` reads "NaN". It fails as a BLANK
   * PAGE, not as an error, which is exactly the shape of fixture bug that could have been measured
   * as "Bain is fast". Bisected against the real Goose Creek road records, whose shape this
   * mirrors: `rot` · `curb` · `travelW` · `roadClass` · `{ radius, treatment: "arc" }`. */
  const road = (id, w, pts, radius) => push({
    id, type: "road", w, h: 60, rot: 0, curb: true, travelW: w, roadClass: "local",
    cx: Math.round(pts.reduce((s, p) => s + p.x, 0) / pts.length),
    cy: Math.round(pts.reduce((s, p) => s + p.y, 0) / pts.length),
    pts,
    vtx: pts.map((_, k) => (k > 0 && k < pts.length - 1 ? { radius, treatment: "arc" } : {})),
  });
  [-1750, 0, 1750].forEach((x, i) => {
    road(`bain-rd${i + 1}`, 60,
      [{ x, y: -3000 }, { x: x + (i - 1) * 40, y: -1200 }, { x, y: 600 }, { x: x - (i - 1) * 30, y: 2600 }], 300);
  });
  [-2700, -1400, -100, 1200, 2400].forEach((y, i) => {
    road(`bain-rd${i + 4}`, 48,
      [{ x: -1750, y }, { x: -400, y: y + 30 }, { x: 700, y: y - 20 }, { x: 1750, y }], 220);
  });

  // The single detention pond, as a drawn polygon — the pondContours / detentionRules path.
  push({
    id: "bain-pond1", type: "pond", rot: 0,
    points: [
      { x: -2350, y: 900 }, { x: -1500, y: 860 }, { x: -1380, y: 1240 }, { x: -1420, y: 1780 },
      { x: -1760, y: 2080 }, { x: -2260, y: 2010 }, { x: -2420, y: 1560 },
    ],
  });

  return els;
}

/** 5 parcels tiling the tract — real plans are assembled from several accounts, and the parcel
 *  count drives the setback ring, the yield ledger and the parcel-dissolve path. */
function buildParcels() {
  const bands = [[-3100, -1800], [-1800, -600], [-600, 700], [700, 1900], [1900, 3000]];
  return bands.map(([y0, y1], i) => ({
    id: `bain-pc${i + 1}`, z: 0, locked: true, active: true,
    acct: `BAIN-${100 + i}`, addr: `BAIN TRACT ${i + 1}`,
    points: [
      { x: -2500, y: y0 }, { x: 2400 + (i % 2) * 40, y: y0 },
      { x: 2400 + (i % 2) * 40, y: y1 }, { x: -2500, y: y1 },
    ],
  }));
}

export function buildBainFixture() {
const els = buildElements();
const parcels = buildParcels();

/* ---- The counts are ASSERTED, not hoped for ----------------------------------------------------
 * The whole value of this fixture is that it matches the measured census. A generator that quietly
 * emitted 51 elements would produce numbers that look like Bain's and are not. */
const got = {};
for (const e of els) got[e.type] = (got[e.type] || 0) + 1;
for (const [t, n] of Object.entries(BAIN_CENSUS)) {
  if (got[t] !== n) throw new Error(`census mismatch: ${t} — measured ${n}, generated ${got[t] || 0}`);
}
for (const t of Object.keys(got)) if (!BAIN_CENSUS[t]) throw new Error(`census mismatch: generated an unmeasured type "${t}"`);
if (els.length !== 53) throw new Error(`census mismatch: 53 elements measured, ${els.length} generated`);
if (parcels.length !== BAIN_PARCELS) throw new Error(`census mismatch: ${BAIN_PARCELS} parcels measured, ${parcels.length} generated`);

const fixture = {
  _note: "SYNTHESISED GEOMETRY, MEASURED PARAMETERS. Derived by ui-audit/build-bain-fixture.mjs from the owner's reported census of his real Bain plan (site smr9olizi5ue, \"Concept A\") — 53 elements in the exact measured kind counts, 5 parcels, 1 pond, and BOTH RASTERS at their exact measured dimensions, opacities, ftPerPx and IndexedDB-string storage path. The COORDINATES are invented (the real plan JSON has been offered by the owner and not yet taken); settings/origin/county are held EQUAL TO THE GOOSE CREEK CONTROL so the comparison isolates rasters. Regenerate with `node ui-audit/build-bain-fixture.mjs`; `--check` fails CI on drift.",
  _redacted: ["no owner data is present in this file — the geometry is synthetic"],
  _standIns: {
    geometry: "synthesised — element COUNTS are measured, coordinates are not",
    settings: "Goose Creek's real 30-key settings (the census did not include Bain's)",
    origin: "Goose Creek's origin, held equal to the control so basemap + GIS are not a second variable",
    underlayFtPerPx: "INFERRED (1.3333 → a 2400 × 1556 ft aerial); a fromMap underlay's scale was not in the census",
  },
  schemaVersion: CONTROL.schemaVersion,
  origin: CONTROL.origin,
  county: CONTROL.county || null,
  parcels, parcelDrawings: [], els,
  markups: [], measures: [], callouts: [],
  elevation: { crossSections: [] },
  settings: CONTROL.settings,
  layerOverrides: {}, layerAbove: {},
  rasters: [
    { ...UNDERLAY, x: -1200, y: -778, ftPerPxY: undefined },
    { ...OVERLAY, x: -2400, y: -3600 },
  ].map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))),
};

return fixture;
}

/** The exact bytes the committed fixture must hold. Exported so a unit test can assert the file has
 *  not drifted from its generator without shelling out or writing anything. */
export const bainFixtureJson = () => JSON.stringify(buildBainFixture(), null, 1) + "\n";
export const BAIN_FIXTURE_PATH = OUT;

if (import.meta.url === `file://${process.argv[1]}`) {
const fixture = buildBainFixture();
const got = {};
for (const e of fixture.els) got[e.type] = (got[e.type] || 0) + 1;
const json = bainFixtureJson();
if (process.argv.includes("--check")) {
  const on = readFileSync(OUT, "utf8");
  if (on !== json) {
    console.error("bain fixture DRIFT — ui-audit/fixtures/bain-concept-a.json does not match its generator.\n  Regenerate: node ui-audit/build-bain-fixture.mjs");
    process.exit(1);
  }
  console.log("bain fixture OK — matches its generator.");
} else {
  writeFileSync(OUT, json);
  console.log(`wrote ${OUT} — ${fixture.els.length} elements (${Object.entries(got).map(([t, n]) => `${t} ${n}`).join(" · ")}), ${fixture.parcels.length} parcels, ${fixture.rasters.length} rasters`);
}
}
