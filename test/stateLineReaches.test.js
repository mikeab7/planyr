/* NEW-1 (state lines) — the real state boundary is authoritative EVERYWHERE except a short, documented list of river stretches.
 *
 * THE DEFECT (adversarial review on main e370ff91): `siteState` let a hand-drawn FL / GA / TX / TN outline overrule the real polygon within
 * ~1.3 km of ITS edge, by default. Only Tennessee was limited, on the wrong belief that "every other tuned outline is drawn to all of its lines".
 * Measured: Florida's north edge sat 2 km into Alabama (Florala AL, Flomaton AL read FL — 4,511 grid points), Georgia's west edge up to 3 km
 * (34.0, -85.42 read GA; 5,073 AL→GA points, 4,229 SC→GA along the Savannah), the Texas outline cuts the Red River in straight chords (1,895
 * Oklahoma + 506 Arkansas + 1,343 Louisiana + 243 New Mexico points read TX — an Oklahoma site lost all 32 Oklahoma rows), Tennessee's southern edge
 * claimed 1.1 km of Alabama and Mississippi. The fix (siteRegion.js): a tuned outline overrules only through `TUNED_REACHES`.
 *
 * THIS FILE'S INSTRUMENT, and why it is built this way:
 *   · the scan walks EVERY edge of the real polygon (all 50 states + DC) and probes both sides out to 0.016° — wider than the 0.012° error band,
 *     so any overrule that exists is inside the probe — and requires `siteState === realStateAt` except inside a named reach or the Hudson;
 *   · it carries a KNOWN-GOOD ARM that must report its known answer (a reach that flips Columbus GA) and a vacuity guard (a scan that probed
 *     nothing, or a reach that never fired, fails rather than printing a score);
 *   · THIRD REVIEW (main 3ba5c0c3): the reaches are now county-LAND polygons (scripts/build-state-reaches.mjs → stateReachData.js), not a tuned outline in a
 *     box + band. The old Perdido reach (coarse FL outline, band 0.07°) read Ono Island, Bear Point and the Perdido Bay north shore — all Alabama — as
 *     Florida (1,241 Alabama land points), and the old Georgia reach (three straight vertices) read Phenix City / Valley AL as Georgia. `GROUND`
 *     (fixtures/stateReachGroundTruth.json) is county-land samples for both banks of both reaches, so the claim is measured, not asserted;
 *   · the 0.003° grid scans the issue asked for run over the three strips it measured (AL|FL line, AL|GA line, the Red River) — same rule.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { siteState, realStateAt, realBoundaryRings, TUNED_REACHES, STATE_POLYGONS, TEXAS_OUTLINE } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { trustRegionOf } from "../src/workspaces/site-planner/lib/siteChecks.js";

const GROUND = JSON.parse(readFileSync(new URL("./fixtures/stateReachGroundTruth.json", import.meta.url), "utf8"));
const st = (lat, lng) => siteState({ lat, lng });
const inBox = (la, lo, [s, w, n, e]) => la >= s && la <= n && lo >= w && lo <= e;
/* A disagreement between the real polygon and `siteState` is allowed only if it is a documented reach, or the Hudson / Arthur Kill settlement. */
function allowed(real, ans, la, lo) {
  if ((real === "NJ" && ans === "NY") || (real === "NY" && ans === "NJ")) return true; // njnyStateAt settles the overlap on purpose (njnyJurisdiction)
  return TUNED_REACHES.some((r) => r.tuned === ans && r.real === real && inBox(la, lo, r.box));
}

/* ── the issue's landmarks ─────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
describe("landmarks the review measured", () => {
  const L = [
    ["Florala AL", 31.0046, -86.3283, "AL"], ["Flomaton AL", 31.003, -87.26, "AL"], ["Brewton AL", 31.1052, -87.0722, "AL"],
    ["Century FL (just south of the line)", 30.9779, -87.2619, "FL"], ["Bonifay FL", 30.7907, -85.6797, "FL"],
    ["Dothan AL", 31.2232, -85.3905, "AL"], ["Bainbridge GA", 30.9038, -84.5755, "GA"],
    ["AL side of the AL|GA line, 34.0 N", 34.0, -85.42, "AL"], ["GA side of the AL|GA line, 34.0 N", 34.0, -85.38, "GA"],
    ["Cave Spring GA", 34.1118, -85.3399, "GA"], ["Piedmont AL", 33.9246, -85.6127, "AL"], ["Heflin AL", 33.6493, -85.5919, "AL"],
    ["Carrollton GA", 33.5801, -85.0766, "GA"], ["Roanoke AL", 33.1503, -85.3722, "AL"],
    ["Augusta GA", 33.4735, -81.9748, "GA"], ["North Augusta SC", 33.5018, -81.9651, "SC"],
    ["Savannah GA", 32.0809, -81.0912, "GA"], ["Hardeeville SC", 32.2871, -81.079, "SC"], ["Bluffton SC", 32.2371, -80.8604, "SC"],
    ["Port Wentworth GA", 32.1488, -81.1626, "GA"],
    ["Denison TX", 33.7557, -96.5367, "TX"], ["Durant OK", 33.994, -96.3711, "OK"], ["Gainesville TX", 33.6259, -97.1334, "TX"],
    ["Thackerville OK", 33.7973, -97.1366, "OK"], ["Wichita Falls TX", 33.9137, -98.4934, "TX"], ["Terral OK", 33.8826, -97.9453, "OK"],
    ["Ringgold TX", 33.814, -97.9361, "TX"], ["Waurika OK", 34.1692, -98.0805, "OK"], ["Idabel OK", 33.8957, -94.8266, "OK"],
    ["Clarksville TX", 33.6165, -95.0533, "TX"], ["Hugo OK", 34.0112, -95.5103, "OK"], ["Paris TX", 33.6609, -95.5555, "TX"],
    ["Texarkana TX", 33.4251, -94.0477, "TX"], ["Texarkana AR", 33.4418, -94.0377, "AR"], ["Fulton AR", 33.6137, -93.8135, "AR"],
    ["Houston TX", 29.7604, -95.3698, "TX"], ["Tallahassee FL", 30.4383, -84.2807, "FL"], ["Atlanta GA", 33.749, -84.388, "GA"],
    ["Pensacola FL", 30.4213, -87.2169, "FL"], ["Orange Beach AL", 30.2943, -87.5736, "AL"], ["Foley AL", 30.4066, -87.6836, "AL"],
    // the third review's Perdido stretch: Alabama on the island and shore NORTH of the Key, Florida on the Key
    ["Ono Island AL (GNIS)", 30.2975, -87.479, "AL"], ["Ono Island AL (the review's point)", 30.2985, -87.485, "AL"],
    ["Ono Island east end AL", 30.296, -87.465, "AL"], ["Bear Point AL", 30.329, -87.515, "AL"],
    ["Perdido Bay north shore AL", 30.346, -87.525, "AL"], ["Perdido Bay AL shore", 30.35, -87.5, "AL"], ["Perdido Bay water, AL side", 30.34, -87.47, "AL"],
    ["Perdido Key FL, west end (NE says AL)", 30.292, -87.4785, "FL"], ["Perdido Key FL, at the Flora-Bama line", 30.2835, -87.515, "FL"],
    ["Perdido Key FL, east of Ono", 30.2995, -87.4465, "FL"],
    // the Chattahoochee, where the old Georgia outline overruled up to 2.9 km: Alabama towns beside the river read Alabama
    ["Phenix City AL", 32.4709, -85.0008, "AL"], ["Valley AL", 32.8057, -85.1713, "AL"], ["Lanett AL", 32.8668, -85.1913, "AL"],
    ["West Point GA", 32.877, -85.18, "GA"], ["Fort Benning GA", 32.35, -84.95, "GA"],
    ["Chattanooga TN", 35.0456, -85.3097, "TN"], ["Fort Oglethorpe GA", 34.9484, -85.2569, "GA"], ["Southaven MS", 34.9889, -90.0126, "MS"],
    ["Memphis TN", 35.1495, -90.049, "TN"], ["Huntsville AL", 34.7304, -86.5861, "AL"], ["Pulaski TN", 35.1998, -87.0309, "TN"],
    ["Corinth MS", 34.9343, -88.5223, "MS"], ["Savannah TN", 35.2251, -88.249, "TN"],
    ["Shreveport LA", 32.5252, -93.7502, "LA"], ["Lawton OK", 34.6036, -98.3959, "OK"], ["Roswell NM", 33.3943, -104.523, "NM"],
    ["El Paso TX", 31.7619, -106.485, "TX"], ["Denver CO", 39.7392, -104.9903, "CO"],
  ];
  for (const [name, lat, lng, want] of L) it(`${name} → ${want}`, () => expect(st(lat, lng)).toBe(want));

  it("the Red River scan samples the review named read the REAL state, not Texas", () => {
    // Points the review found reading TX that the real polygon holds in Oklahoma / Arkansas (the two chords it named: (-98.10,34.04)→(-97.40,33.80)
    // and (-94.50,33.67)→(-94.07,33.54)). Asserted against the real polygon on purpose: that IS the contract — siteState follows it off a reach.
    for (const [la, lo] of [[33.648, -94.498], [33.651, -94.45], [33.561, -94.381], [33.566, -94.33], [33.62, -97.0], [33.9, -97.5], [34.0, -98.0]]) {
      const real = realStateAt(la, lo);
      expect(st(la, lo)).toBe(real);
    }
    expect(st(33.648, -94.498)).toBe("OK");
    expect(st(33.561, -94.381)).toBe("AR");
  });
  it("an Oklahoma site on the Red River keeps its Oklahoma answer, and Texas verdicts are not trusted there", () => {
    expect(st(33.648, -94.498)).toBe("OK");
    expect(trustRegionOf(33.648, -94.498)).toBeNull(); // OK is not a trust region — no RRC "None" on Oklahoma ground
    expect(trustRegionOf(29.76, -95.37)).toBe("TX");   // the Texas golden answer is untouched
  });
});

/* ── the reaches ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
describe("every TUNED_REACHES entry is documented, bounded and live", () => {
  it("there are exactly the documented reaches, each with its reason and a landmark on each bank", () => {
    expect(TUNED_REACHES.map((r) => r.id).sort()).toEqual(["chattahoochee", "chattahoochee-al", "perdido-al", "perdido-key"]);
    for (const r of TUNED_REACHES) {
      expect(r.why.length).toBeGreaterThan(40);
      expect(r.box).toHaveLength(4);
      expect(inBox(r.tunedSide[1], r.tunedSide[2], r.box), `${r.id}: the tuned-side landmark sits in the box`).toBe(true);
      expect(st(r.tunedSide[1], r.tunedSide[2]), `${r.id}: ${r.tunedSide[0]}`).toBe(r.tuned);
      expect(realStateAt(r.tunedSide[1], r.tunedSide[2]), `${r.id}: ${r.tunedSide[0]} is a point the real polygon gets wrong`).toBe(r.real);
      expect(st(r.realSide[1], r.realSide[2]), `${r.id}: ${r.realSide[0]}`).toBe(r.real);
      // the landmark that was missing: a real-side point INSIDE the affected band (Eufaula / Orange Beach sit where the old reach changed nothing)
      expect(inBox(r.realSideInBand[1], r.realSideInBand[2], r.box), `${r.id}: ${r.realSideInBand[0]} sits in the box`).toBe(true);
      expect(st(r.realSideInBand[1], r.realSideInBand[2]), `${r.id}: ${r.realSideInBand[0]}`).toBe(r.real);
    }
  });
  it("PINNED: each reach's box and band are exactly the measured ones — widening one is a decision, not a drift", () => {
    // The scan below reads the boxes from TUNED_REACHES itself, so it cannot police them; this is the pin.
    expect(TUNED_REACHES.map((r) => [r.id, r.tuned, r.real, r.box])).toEqual([
      ["chattahoochee", "GA", "AL", [31.0, -85.3, 32.95, -84.85]],
      ["chattahoochee-al", "AL", "GA", [31.0, -85.3, 32.95, -84.85]],
      ["perdido-key", "FL", "AL", [30.2, -87.53, 30.56, -87.36]],
      ["perdido-al", "AL", "FL", [30.2, -87.53, 30.56, -87.36]],
    ]);
  });
  it("no reach for Tennessee, Texas or Colorado: their outlines never overrule", () => {
    for (const r of TUNED_REACHES) expect(["GA", "FL", "AL"]).toContain(r.tuned);
  });
  it("Alabama beside the Chattahoochee reads Alabama: Phenix City, Valley and a landmark inside the old overrule band (the third review's item 2)", () => {
    // These three used to read GA — the Georgia outline was three straight vertices, 1.0–2.9 km west of the river (capped by a 0.012° band). Fort Mitchell's
    // point is Russell County land per the county polygons; the old note listed (32.3357, -85.0) as an Alabama town, but that point is Chattahoochee County GA.
    for (const [la, lo] of [[32.4709, -85.0008], [32.3293, -85.0127], [32.8057, -85.1713]]) expect(st(la, lo), `${la},${lo}`).toBe("AL");
    for (const [la, lo] of [[32.8668, -85.1913], [31.8913, -85.1455], [31.2918, -85.1119]]) expect(st(la, lo), `${la},${lo}`).toBe("AL");
    for (const [la, lo] of [[32.461, -84.9877], [32.35, -84.95], [32.877, -85.18]]) expect(st(la, lo), `${la},${lo}`).toBe("GA");
  });
  it("GROUND TRUTH, Chattahoochee, BOTH WAYS: every sampled Georgia-county point reads GA and every sampled Alabama-county point reads AL", () => {
    const [ga, al] = [GROUND.chattahoochee.ga, GROUND.chattahoochee.al];
    expect(ga.length, "vacuous: no Georgia samples").toBeGreaterThan(150);
    expect(al.length, "vacuous: no Alabama samples").toBeGreaterThan(150);
    expect(ga.filter(([la, lo]) => st(la, lo) !== "GA")).toEqual([]);
    // The fixture sits >= ~55 m inside its own county, so the 0.0003° (~33 m) simplification cannot be what it measures. Before the Alabama-over-Georgia
    // half, ~1,000 Alabama cells (the Lake Eufaula shore, up to 1.6 km from the county line) read Georgia — Natural Earth's own error, which a GA-over-AL
    // reach cannot undo.
    expect(al.filter(([la, lo]) => st(la, lo) !== "AL")).toEqual([]);
  });
  it("the Lake Eufaula shore: Alabama ground that Natural Earth calls Georgia reads Alabama, and the same river's Georgia bank still reads Georgia", () => {
    for (const [la, lo] of [[31.942, -85.102], [31.944, -85.1], [31.81, -85.14], [32.83, -85.17]]) { expect(realStateAt(la, lo), `${la},${lo}`).toBe("GA"); expect(st(la, lo), `${la},${lo}`).toBe("AL"); }
    expect(st(32.3357, -85.0)).toBe("GA");
  });
  it("GROUND TRUTH, Perdido: every Escambia-county (Florida) point reads FL and every Baldwin-county (Alabama) point reads AL — including the Escambia land north of 30.36 that lies in no Natural Earth polygon", () => {
    const { al, fl } = GROUND.perdido;
    expect(al.length).toBeGreaterThan(100); expect(fl.length).toBeGreaterThan(100);
    expect(fl.filter(([la, lo]) => st(la, lo) !== "FL")).toEqual([]);
    expect(al.filter(([la, lo]) => st(la, lo) !== "AL")).toEqual([]);
    // the review's regression (291 Escambia cells at 30.362–30.399, -87.44…-87.406 read AL once the nearest-state rule came first): the fixture must reach there
    expect(fl.filter(([la]) => la > 30.36).length, "the fixture does not cover the reviewer's pocket").toBeGreaterThan(5);
    for (const [la, lo] of [[30.38, -87.42], [30.401, -87.425]]) expect(st(la, lo), `${la},${lo}`).toBe("FL"); // inside the 291-cell pocket: in no Natural Earth polygon
    expect(fl.filter(([la]) => la > 30.45).length, "the fixture does not cover the Perdido River stretch").toBeGreaterThan(5);
  });
  it("the Gulf off the Key: water east of the Alabama Point line reads Florida (it did before the nearest-state rule), water west of it is not claimed", () => {
    for (const [la, lo] of [[30.23, -87.5], [30.23, -87.45], [30.25, -87.42], [30.26, -87.48]]) expect(st(la, lo), `${la},${lo}`).toBe("FL");
    for (const [la, lo] of [[30.2985, -87.485], [30.296, -87.465], [30.329, -87.515]]) expect(st(la, lo), `${la},${lo}`).toBe("AL");
  });
  it("every point in the Perdido window that the review named reads Alabama, and the Key's western end still flips to Florida", () => {
    let flipped = 0;
    for (let la = 30.2; la <= 30.36; la += 0.001) for (let lo = -87.53; lo <= -87.4; lo += 0.001) {
      if (realStateAt(la, lo) === "AL" && st(la, lo) === "FL") flipped++;
    }
    expect(flipped, "the reach must still pull the Key's western end to Florida").toBeGreaterThan(100);
    for (const [la, lo] of [[30.2985, -87.485], [30.296, -87.465], [30.329, -87.515], [30.346, -87.525], [30.34, -87.47], [30.35, -87.5]]) expect(st(la, lo)).toBe("AL");
  });
  it("a point no real polygon holds answers the NEAREST real state before any tuned outline (Bear Point, the Perdido Bay north shore)", () => {
    // realStateAt is null for these — the old order answered from the coarse FL outline and said Florida.
    for (const [la, lo] of [[30.329, -87.515], [30.34, -87.47]]) { expect(realStateAt(la, lo)).toBeNull(); expect(st(la, lo)).toBe("AL"); }
  });
  it("KNOWN-GOOD ARM: the reaches still give Columbus GA and the Key their answers, and the real polygon alone would not", () => {
    expect(realStateAt(32.461, -84.9877)).toBe("AL");
    expect(st(32.461, -84.9877)).toBe("GA");
    expect(realStateAt(30.292, -87.4785)).toBe("AL");
    expect(st(30.292, -87.4785)).toBe("FL");
    expect(realStateAt(31.942, -85.102)).toBe("GA");
    expect(st(31.942, -85.102)).toBe("AL");
  });
  it("a reach's ring is a real polygon inside its own box and the committed data matches the reach definition", () => {
    for (const r of TUNED_REACHES) {
      expect(r.ring.length).toBeGreaterThan(0);
      const [s0, w, n, e] = r.box;
      for (const ring of r.ring) {
        expect(ring.length).toBeGreaterThanOrEqual(3);
        for (const [x, y] of ring) expect(y >= s0 - 1e-4 && y <= n + 1e-4 && x >= w - 1e-4 && x <= e + 1e-4, `${r.id}: vertex ${x},${y} outside box`).toBe(true);
      }
    }
  });
  it("a reach does not extend past its box: the straight AL|GA line north of West Point is the real polygon's", () => {
    expect(st(34.0, -85.42)).toBe("AL");
    expect(st(33.5, -85.34)).toBe(realStateAt(33.5, -85.34));
  });
});

/* ── outline corrections ─────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
describe("the outlines are drawn to the lines they claim", () => {
  it("Florida's north edge is the 31.000° Alabama line, and Georgia starts from the same vertex", () => {
    const fl = STATE_POLYGONS.FL, ga = STATE_POLYGONS.GA;
    expect(fl[0]).toEqual([-87.6, 31.0]);
    expect(fl[1]).toEqual([-85.0, 31.0]);
    expect(ga[ga.length - 4]).toEqual([-85.0, 31.0]);
  });
  it("Georgia's west corner is the Alabama–Georgia–Tennessee corner Tennessee's outline also starts at", () => {
    expect(STATE_POLYGONS.GA[0]).toEqual([-85.605, 34.985]);
    expect(STATE_POLYGONS.TN.some(([x, y]) => x === -85.605 && y === 34.985)).toBe(true);
  });
  it("TEXAS_OUTLINE is still exported for the RRC trust gate", () => {
    expect(TEXAS_OUTLINE.length).toBeGreaterThan(40);
  });
});

/* ── the scans ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
describe("siteState follows the real polygon on every state line except the documented reaches", () => {
  it("walks every edge of every state, both sides to 0.016°, and finds no undocumented disagreement", () => {
    const offs = [-0.016, -0.012, -0.008, -0.004, 0.004, 0.008, 0.012, 0.016];
    let probes = 0; const flips = new Map(); const undocumented = [];
    for (const { xy } of realBoundaryRings()) {
      for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) {
        const dx = xy[i] - xy[j], dy = xy[i + 1] - xy[j + 1], len = Math.hypot(dx, dy);
        if (!len) continue;
        const nx = -dy / len, ny = dx / len, n = Math.ceil(len / 0.006);
        for (let k = 0; k <= n; k++) {
          const px = xy[j] + (dx * k) / n, py = xy[j + 1] + (dy * k) / n;
          for (const o of offs) {
            const lo = px + nx * o, la = py + ny * o, real = realStateAt(la, lo);
            if (!real) continue;
            probes++;
            const ans = st(la, lo);
            if (ans === real) continue;
            flips.set(`${real}>${ans}`, (flips.get(`${real}>${ans}`) || 0) + 1);
            if (!allowed(real, ans, la, lo) && undocumented.length < 12) undocumented.push([real, ans, +la.toFixed(4), +lo.toFixed(4)]);
          }
        }
      }
    }
    expect(probes, "vacuous: the scan probed (almost) nothing").toBeGreaterThan(1_500_000);
    expect(undocumented).toEqual([]);
    // every documented reach actually fired, and nothing but the reaches and the Hudson did
    for (const r of TUNED_REACHES) expect(flips.get(`${r.real}>${r.tuned}`) || 0, `reach ${r.id} never fired — stale`).toBeGreaterThan(0);
    expect([...flips.keys()].sort()).toEqual(["AL>FL", "AL>GA", "FL>AL", "GA>AL", "NJ>NY", "NY>NJ"]);
  });

  /* The 0.003° grid the review used, over the three strips it measured. */
  function gridScan(box) {
    const [s, w, n, e] = box; let probes = 0; const bad = [];
    for (let la = s; la <= n; la += 0.003) for (let lo = w; lo <= e; lo += 0.003) {
      const real = realStateAt(la, lo);
      if (!real) continue;
      probes++;
      const ans = st(la, lo);
      if (ans !== real && !allowed(real, ans, la, lo) && bad.length < 8) bad.push([real, ans, +la.toFixed(4), +lo.toFixed(4)]);
    }
    return { probes, bad };
  }
  it("0.003° grid — the Alabama|Florida line strip (Florala, Flomaton)", () => {
    const { probes, bad } = gridScan([30.9, -87.7, 31.1, -85.0]);
    expect(probes).toBeGreaterThan(40_000);
    expect(bad).toEqual([]);
  });
  it("0.003° grid — the Alabama|Georgia|Carolina strip, north of West Point to the Tennessee corner and along the Savannah", () => {
    const a = gridScan([32.95, -85.7, 35.0, -85.1]);
    expect(a.probes).toBeGreaterThan(100_000);
    expect(a.bad).toEqual([]);
    const b = gridScan([31.9, -81.3, 33.6, -80.7]);
    expect(b.probes).toBeGreaterThan(50_000);
    expect(b.bad).toEqual([]);
  });
  it("0.003° grid — the Red River, Texas | Oklahoma | Arkansas", () => {
    const { probes, bad } = gridScan([33.5, -99.0, 34.6, -94.0]);
    expect(probes).toBeGreaterThan(300_000);
    expect(bad).toEqual([]);
  });
});
