import { describe, it, expect } from "vitest";
import {
  DOCK_ZONES, MAX_DOCK_ZONES, ZONE_CATALOG, zoneDepthDefaults, zoneDepthDefault, catalogDepthDefault,
  layoutZone, layoutZoneByKind, layoutStack,
  usableCourtSpan, dockSidesFor, footprintDepth, footprintLength, footprintAxes, strandedZoneIds, pruneStrandedZones,
} from "../src/workspaces/site-planner/lib/dockZones.js";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

describe("DOCK_ZONES — fixed outward order (B228)", () => {
  it("is court → trailer parking → buffer, outward from the dock face", () => {
    expect(DOCK_ZONES.map((z) => z.key)).toEqual(["court", "trailer", "buffer"]);
    expect(MAX_DOCK_ZONES).toBe(3);
  });
  it("maps each zone to its drawn element type (buffer = sage landscape strip)", () => {
    expect(DOCK_ZONES.map((z) => z.type)).toEqual(["paving", "trailer", "landscape"]);
  });
});

describe("zoneDepthDefaults — user-configurable, not hardcoded", () => {
  it("falls back to 135 / 50 / 15 when settings are empty", () => {
    expect(zoneDepthDefaults({})).toEqual([135, 50, 15]);
    expect(zoneDepthDefaults()).toEqual([135, 50, 15]);
  });
  it("honours per-plan overrides (Michael's buffer default is 15)", () => {
    expect(zoneDepthDefaults({ truckCourtD: 140, trailerParkD: 60, bufferD: 20 })).toEqual([140, 60, 20]);
    expect(zoneDepthDefault(2, { bufferD: 25 })).toBe(25);
  });
  it("ignores non-positive / non-numeric overrides", () => {
    expect(zoneDepthDefaults({ truckCourtD: 0, trailerParkD: -5, bufferD: "x" })).toEqual([135, 50, 15]);
  });
});

describe("usableCourtSpan — court trims to the clear face between bump-outs (B492/B504 premise)", () => {
  it("with no bumps the court keeps the full wall length, no shift", () => {
    expect(usableCourtSpan(600, 0, 0)).toEqual({ along: 600, shift: 0 });
  });
  it("two corner bumps shorten the span by their combined projection (court excludes the bump)", () => {
    // This is exactly why the yield loop must NOT also subtract the bump footprint (B504):
    // the court's along-span is already trimmed past the bumps, so its area excludes them.
    expect(usableCourtSpan(600, 55, 55)).toEqual({ along: 490, shift: 0 });
  });
  it("an asymmetric bump shifts the court centre toward the clear side", () => {
    const { along, shift } = usableCourtSpan(300, 60, 0);
    expect(along).toBe(240);
    expect(shift).toBe(30);   // (60 - 0) / 2
  });
  it("never collapses below 1 ft even if bumps exceed the wall", () => {
    expect(usableCourtSpan(100, 80, 80).along).toBe(1);
  });
});

describe("layoutZone — flush-outward stacking on each side", () => {
  // 300' x 600' building at the origin, no rotation. Long sides are top/bottom.
  const b = { cx: 0, cy: 0, w: 600, h: 300, rot: 0 };
  const depths = [135, 50, 15];

  it("court (i=0) hugs the building face, full wall length", () => {
    const g = layoutZone(b, "bottom", 0, depths);
    expect(g.w).toBe(600);              // full wall length
    expect(g.h).toBe(135);              // its depth
    expect(near(g.cy, 150 + 135 / 2)).toBe(true);  // half-height + half-depth outward (+y = bottom)
    expect(near(g.cx, 0)).toBe(true);
    expect(g.rot).toBe(0);
  });

  it("trailer (i=1) sits flush beyond the court, rotated to run along the wall", () => {
    const g = layoutZone(b, "bottom", 1, depths);
    expect(g.w).toBe(600);              // wall length
    expect(g.h).toBe(50);               // trailer depth
    // beyond the court: half-height + court depth + half its own depth
    expect(near(g.cy, 150 + 135 + 50 / 2)).toBe(true);
    expect(g.rot).toBe(0);              // bottom wall → no extra rotation
  });

  it("buffer (i=2) sits flush beyond the trailer", () => {
    const g = layoutZone(b, "bottom", 2, depths);
    expect(g.h).toBe(15);
    expect(near(g.cy, 150 + 135 + 50 + 15 / 2)).toBe(true);
  });

  it("the three zones never overlap and are gap-free (court out → buffer out)", () => {
    const [c, t, bf] = [0, 1, 2].map((i) => layoutZone(b, "bottom", i, depths));
    const farFace = (g) => g.cy + g.h / 2, nearFace = (g) => g.cy - g.h / 2;
    expect(near(nearFace(c), 150)).toBe(true);          // court near face = building face
    expect(near(nearFace(t), farFace(c))).toBe(true);   // trailer near face = court far face
    expect(near(nearFace(bf), farFace(t))).toBe(true);  // buffer near face = trailer far face
  });

  it("on a vertical (left/right) dock side the trailer is rotated 90° but still depth-correct", () => {
    const tall = { cx: 0, cy: 0, w: 300, h: 600, rot: 0 }; // long sides now left/right
    const g = layoutZone(tall, "right", 1, depths);
    expect(g.w).toBe(600);              // along the wall (the tall axis)
    expect(g.h).toBe(50);               // depth
    expect(g.rot).toBe(90);             // rotated so stalls stripe along the wall
    expect(near(g.cx, 150 + 135 + 50 / 2)).toBe(true); // +x = right, beyond the court
  });

  it("respects building rotation (zones extend along the rotated normal)", () => {
    const rb = { cx: 0, cy: 0, w: 600, h: 300, rot: 90 };
    const g = layoutZone(rb, "bottom", 0, depths);
    // bottom normal (0,1) rotated 90° → (-1, 0); centre at distance 150+67.5 along it
    expect(near(g.cx, -(150 + 135 / 2))).toBe(true);
    expect(near(g.cy, 0)).toBe(true);
  });
});

describe("usableCourtSpan — truck court pulls in between corner bump-outs (B492)", () => {
  it("with no bumps the court keeps the full wall, no shift", () => {
    expect(usableCourtSpan(600, 0, 0)).toEqual({ along: 600, shift: 0 });
  });
  it("subtracts both corner bump spans and re-centres toward the smaller bump", () => {
    // 55′ bump at the −end, 35′ at the +end → 600−55−35 = 510, shift = (55−35)/2 = +10
    expect(usableCourtSpan(600, 55, 35)).toEqual({ along: 510, shift: 10 });
  });
  it("never collapses below 1′ even if bumps exceed the wall", () => {
    expect(usableCourtSpan(100, 80, 80).along).toBe(1);
  });
});

describe("layoutZone opts — only the court (zone 0) pulls in (B492)", () => {
  const b = { cx: 0, cy: 0, w: 600, h: 300, rot: 0 }; // docks top/bottom
  const depths = [135, 50, 15];

  it("court honours opts.along + opts.alongShift; full wall when omitted (back-compat)", () => {
    expect(layoutZone(b, "bottom", 0, depths).w).toBe(600);            // 4-arg → unchanged
    const g = layoutZone(b, "bottom", 0, depths, { along: 510, alongShift: 10 });
    expect(g.w).toBe(510);                                             // pulled in
    expect(g.cx).toBeCloseTo(10, 6);                                   // shifted +X along the wall
    expect(g.cy).toBeCloseTo(150 + 135 / 2, 6);                        // depth/position unchanged
  });

  it("trailer (zone 1) and buffer (zone 2) IGNORE the override — they keep the full wall", () => {
    expect(layoutZone(b, "bottom", 1, depths, { along: 510, alongShift: 10 }).w).toBe(600);
    expect(layoutZone(b, "bottom", 2, depths, { along: 510, alongShift: 10 }).w).toBe(600);
  });

  it("on a vertical dock side the court pulls in along Y", () => {
    const tall = { cx: 0, cy: 0, w: 300, h: 600, rot: 0 }; // docks left/right
    const g = layoutZone(tall, "right", 0, depths, { along: 520, alongShift: -10 });
    expect(g.h).toBe(520);                 // along the tall axis
    expect(g.cy).toBeCloseTo(-10, 6);      // shifted −Y
  });
});

describe("ZONE_CATALOG — the appendable-layer catalog (B495)", () => {
  it("has the four owner-requested layer types plus the dock-sequence members", () => {
    for (const k of ["court", "trailer", "buffer", "sidewalk", "parking", "road"]) expect(ZONE_CATALOG[k]).toBeTruthy();
  });
  it("a road is TERMINAL (nothing stacks behind it); trailer/court are dock-only", () => {
    expect(ZONE_CATALOG.road.terminal).toBe(true);
    expect(ZONE_CATALOG.buffer.terminal).toBe(false);
    expect(ZONE_CATALOG.trailer.sides).toBe("dock");
    expect(ZONE_CATALOG.court.sides).toBe("dock");
    expect(ZONE_CATALOG.parking.sides).toBe("nondock");
    expect(ZONE_CATALOG.buffer.sides).toBe("any");
    expect(ZONE_CATALOG.road.sides).toBe("any");
  });
  it("a landscape buffer is the SAME element type tagged buffer (one concept, not two)", () => {
    expect(ZONE_CATALOG.buffer.elType).toBe("landscape");
    expect(ZONE_CATALOG.buffer.tag).toEqual({ buffer: true });
  });
  it("catalogDepthDefault honours a per-plan override, else the built-in fallback", () => {
    expect(catalogDepthDefault("buffer", {})).toBe(15);
    expect(catalogDepthDefault("buffer", { bufferD: 30 })).toBe(30);
    expect(catalogDepthDefault("road", {})).toBe(24);      // a road's default is its TRAVEL width
    expect(catalogDepthDefault("sidewalk", {})).toBe(5);
  });
});

describe("layoutZoneByKind — generalized chain layout (B495)", () => {
  const b = { cx: 0, cy: 0, w: 600, h: 300, rot: 0 }; // docks top/bottom
  const near = (a, c, eps = 1e-6) => Math.abs(a - c) < eps;

  it("is byte-identical to layoutZone for the default [strip,trailer,strip] dock sequence", () => {
    const depths = [135, 50, 15];
    const kinds = ["strip", "trailer", "strip"];
    for (const i of [0, 1, 2]) {
      expect(layoutZoneByKind(b, "bottom", i, depths, kinds)).toEqual(layoutZone(b, "bottom", i, depths));
      expect(layoutZoneByKind(b, "left", i, depths, kinds)).toEqual(layoutZone(b, "left", i, depths));
    }
  });

  it("lays a heterogeneous chain court→trailer→buffer→road flush + gap-free on a horizontal wall", () => {
    const depths = [135, 50, 15, 25];                    // road depth = 24 travel + 2×0.5 curb
    const kinds = ["strip", "trailer", "strip", "strip"];
    const g = [0, 1, 2, 3].map((i) => layoutZoneByKind(b, "bottom", i, depths, kinds));
    expect(g.map((z) => z.w)).toEqual([600, 600, 600, 600]); // every layer spans the full wall
    expect(g.map((z) => z.h)).toEqual([135, 50, 15, 25]);
    const far = (z) => z.cy + z.h / 2, near0 = (z) => z.cy - z.h / 2;
    expect(near(near0(g[0]), 150)).toBe(true);            // court hugs the wall face
    expect(near(near0(g[1]), far(g[0]))).toBe(true);      // each sits flush beyond the prior
    expect(near(near0(g[2]), far(g[1]))).toBe(true);
    expect(near(near0(g[3]), far(g[2]))).toBe(true);      // the road sits flush beyond the buffer
    expect(g[3].rot).toBe(0);
  });

  it("on a vertical wall the trailer rotates 90° and the road runs along the wall", () => {
    const tall = { cx: 0, cy: 0, w: 300, h: 600, rot: 0 }; // docks left/right
    const depths = [135, 50, 15, 25];
    const kinds = ["strip", "trailer", "strip", "strip"];
    const road = layoutZoneByKind(tall, "right", 3, depths, kinds);
    expect(road.h).toBe(600);   // full wall length along the tall axis
    expect(road.w).toBe(25);    // its depth out from the wall
    expect(road.rot).toBe(0);
    expect(near(road.cx, 150 + 135 + 50 + 15 + 25 / 2)).toBe(true); // flush beyond court+trailer+buffer
  });
});

describe("strandedZoneIds — cascades onto prevZone-appended layers (B495)", () => {
  it("a stranded court drags its appended road off the wrong side", () => {
    // built wide (docks top/bottom) with a court+road appended on top, then reshaped tall
    const tall = { id: "b1", type: "building", w: 580, h: 664, dock: "cross" }; // docks now left/right
    const els = [
      tall,
      { id: "c", type: "paving", attachedTo: "b1", truckCourt: { side: "top" }, zd: 135 },
      { id: "r", type: "road", attachedTo: "b1", prevZone: "c", stackSide: "top", zd: 25 },
    ];
    expect(strandedZoneIds(els, tall).sort()).toEqual(["c", "r"]);
  });
});

describe("layoutStack — positions every present zone at once", () => {
  const b = { cx: 10, cy: 20, w: 400, h: 200, rot: 0 };
  it("returns one entry per depth, indexed and gap-free", () => {
    const out = layoutStack(b, "top", [135, 50, 15]);
    expect(out.map((z) => z.i)).toEqual([0, 1, 2]);
    // top side: outward is -y; near faces chain outward
    const nearFace = (g) => g.cy + g.h / 2; // toward the building (since outward is -y)
    expect(near(nearFace(out[0].geom), b.cy - 100)).toBe(true);
  });
});

// ---- B416 / B417 helpers ----
// A full dock-zone stack (court → trailer → buffer) bonded onto `bId`, on `side`.
const stackOn = (bId, side, i = 0) => {
  const cId = `c${side}${i}`, tId = `t${side}${i}`, fId = `f${side}${i}`;
  return [
    { id: cId, type: "paving", attachedTo: bId, truckCourt: { side }, zd: 135 },
    { id: tId, type: "trailer", attachedTo: bId, forCourt: cId, zd: 50 },
    { id: fId, type: "landscape", attachedTo: bId, forTrailer: tId, buffer: true, zd: 15 },
  ];
};

describe("dockSidesFor — the single source for which sides are dock sides (B416)", () => {
  it("cross-dock uses BOTH long sides; square tie-breaks to top/bottom", () => {
    expect(dockSidesFor({ w: 600, h: 300, dock: "cross" }).dockSides).toEqual(["top", "bottom"]);
    expect(dockSidesFor({ w: 300, h: 600, dock: "cross" }).dockSides).toEqual(["left", "right"]);
    expect(dockSidesFor({ w: 580, h: 580, dock: "cross" }).dockSides).toEqual(["top", "bottom"]);
  });
  it("single-load uses ONE long side (its dockSide, else the default long side)", () => {
    expect(dockSidesFor({ w: 600, h: 300, dock: "single", dockSide: "top" }).dockSides).toEqual(["top"]);
    // a dockSide that isn't a current long side falls back to the canonical long side
    expect(dockSidesFor({ w: 300, h: 600, dock: "single", dockSide: "top" }).dockSides).toEqual(["right"]);
  });
  it("none → no dock sides; a missing dock field defaults to cross", () => {
    expect(dockSidesFor({ w: 600, h: 300, dock: "none" }).dockSides).toEqual([]);
    expect(dockSidesFor({ w: 600, h: 300 }).dockSides).toEqual(["top", "bottom"]);
  });
});

describe("footprintDepth — building depth is the dock-normal span, never the frontage (B417)", () => {
  it("is the footprint extent perpendicular to the dock face for both orientations", () => {
    // 580 (w) × 664 (h): h>w → docks ride left/right → depth is the horizontal span = w = 580
    expect(footprintDepth({ w: 580, h: 664, dock: "cross" })).toBe(580);
    // 664 (w) × 580 (h): w>h → docks ride top/bottom → depth is the vertical span = h = 580
    expect(footprintDepth({ w: 664, h: 580, dock: "cross" })).toBe(580);
    expect(footprintDepth({ w: 580, h: 580, dock: "cross" })).toBe(580);
  });
  it("single-load reads depth dock-wall→rear-wall, never the frontage", () => {
    // docks on the bottom (a long side) → depth is the perpendicular (vertical) span = h
    expect(footprintDepth({ w: 664, h: 580, dock: "single", dockSide: "bottom" })).toBe(580);
    expect(footprintDepth({ w: 664, h: 580, dock: "single", dockSide: "bottom" })).not.toBe(664); // not the frontage
  });
  it("equals the footprint, never an attached truck-court's 135′ depth (the reported bug)", () => {
    const b = { id: "b1", type: "building", w: 580, h: 664, dock: "cross" };
    const els = [b, ...stackOn("b1", "left"), ...stackOn("b1", "right")];
    // even with 135′ courts bonded on, the building's depth is its own 580′ footprint span
    expect(footprintDepth(els.find((e) => e.id === "b1"))).toBe(580);
  });
});

describe("footprintAxes / footprintLength — the dock-parallel counterpart of depth (B544)", () => {
  it("resolves depth and length to the two perpendicular footprint axes, dock-relative", () => {
    // The EXACT reported case — el.w 328 × el.h 1159: h>w → docks ride left/right → depth is the
    // horizontal (w) span = 328, length the vertical (h) span = 1159. The panel must read
    // Length 1159 / Depth 328, never the old transposed Depth 1159.
    const tall = { w: 328, h: 1159, dock: "single" };
    expect(footprintAxes(tall)).toEqual({ depth: "w", length: "h" });
    expect(footprintDepth(tall)).toBe(328);
    expect(footprintLength(tall)).toBe(1159);
    // Same footprint laid the other way — el.w 1159 × el.h 328: w>h → docks ride top/bottom →
    // depth is the vertical (h) span = 328, length the horizontal (w) span = 1159.
    const wide = { w: 1159, h: 328, dock: "single" };
    expect(footprintAxes(wide)).toEqual({ depth: "h", length: "w" });
    expect(footprintDepth(wide)).toBe(328);
    expect(footprintLength(wide)).toBe(1159);
  });
  it("length is the dock-parallel (long) wall in both cross-dock orientations", () => {
    expect(footprintLength({ w: 580, h: 664, dock: "cross" })).toBe(664);
    expect(footprintLength({ w: 664, h: 580, dock: "cross" })).toBe(664);
  });
  it("depth and length are exactly the element's two axes — no value invented, area preserved", () => {
    const b = { w: 328, h: 1159, dock: "cross" };
    expect(footprintDepth(b) * footprintLength(b)).toBe(328 * 1159);
  });
  it("single-load: length runs along the dock wall, depth dock-wall→rear", () => {
    const b = { w: 664, h: 580, dock: "single", dockSide: "bottom" }; // docks on the bottom (long, horizontal) wall
    expect(footprintLength(b)).toBe(664); // the frontage the doors array along
    expect(footprintDepth(b)).toBe(580);  // dock-wall → rear-wall
  });
});

describe("strandedZoneIds — a dock-zone stack on a non-dock side (B416)", () => {
  it("flags the whole court→trailer→buffer chain stranded after a reshape flips the axis", () => {
    // built WIDE (docks top/bottom) with a stack on top, then reshaped TALL (docks now left/right)
    const tall = { id: "b1", type: "building", w: 580, h: 664, dock: "cross" };
    const els = [tall, ...stackOn("b1", "top")];
    expect(strandedZoneIds(els, tall).sort()).toEqual(["ctop0", "ftop0", "ttop0"]);
  });
  it("does NOT flag a stack that sits on a current dock side", () => {
    const tall = { id: "b1", type: "building", w: 580, h: 664, dock: "cross" }; // docks left/right
    const els = [tall, ...stackOn("b1", "left"), ...stackOn("b1", "right")];
    expect(strandedZoneIds(els, tall)).toEqual([]);
  });
  it("cross→single strands the dropped side; cross→none strands both", () => {
    const wide = { id: "b1", type: "building", w: 664, h: 580 }; // docks top/bottom
    const both = [wide, ...stackOn("b1", "top"), ...stackOn("b1", "bottom")];
    // single-load keeping the bottom → the top stack is now stranded
    const single = strandedZoneIds(both, { ...wide, dock: "single", dockSide: "bottom" });
    expect(single.sort()).toEqual(["ctop0", "ftop0", "ttop0"]);
    // no docks → every stack is stranded
    expect(strandedZoneIds(both, { ...wide, dock: "none" }).length).toBe(6);
  });
});

describe("pruneStrandedZones — trailer parking is dock-side-only (B416, requested test)", () => {
  // The side a stack member lives on, resolved through its bond chain (court | trailer | buffer).
  const sideOfZone = (els, z) => {
    if (z.truckCourt) return z.truckCourt.side;
    if (z.forCourt) return els.find((x) => x.id === z.forCourt)?.truckCourt?.side;
    if (z.forTrailer) { const t = els.find((x) => x.id === z.forTrailer); return els.find((x) => x.id === t?.forCourt)?.truckCourt?.side; }
    return null;
  };
  const trailerSidesIn = (els, b) =>
    els.filter((x) => x.type === "trailer" && x.attachedTo === b.id).map((t) => sideOfZone(els, t));

  it("removes a stack stranded on a non-dock side but keeps the dock-side stacks", () => {
    const tall = { id: "b1", type: "building", w: 580, h: 664, dock: "cross" }; // docks left/right
    const els = [tall, ...stackOn("b1", "top"), ...stackOn("b1", "left"), ...stackOn("b1", "right")];
    const out = pruneStrandedZones(els);
    expect(out.find((x) => x.id === "ctop0")).toBeUndefined();   // stranded top court gone
    expect(out.find((x) => x.id === "ttop0")).toBeUndefined();   // its trailer gone
    expect(out.find((x) => x.id === "cleft0")).toBeTruthy();     // dock-side stacks survive
    expect(out.find((x) => x.id === "cright0")).toBeTruthy();
  });

  it("CROSS-dock: zero trailer elements land on a non-dock side", () => {
    const b = { id: "b1", type: "building", w: 580, h: 664, dock: "cross" }; // docks left/right
    const els = [b, ...stackOn("b1", "top"), ...stackOn("b1", "bottom"), ...stackOn("b1", "left"), ...stackOn("b1", "right")];
    const out = pruneStrandedZones(els);
    const dock = new Set(dockSidesFor(b).dockSides);
    for (const side of trailerSidesIn(out, b)) expect(dock.has(side)).toBe(true);
    expect(trailerSidesIn(out, b).length).toBe(2); // exactly the two dock sides remain
  });

  it("SINGLE-load: zero trailer elements land on a non-dock side", () => {
    const b = { id: "b1", type: "building", w: 664, h: 580, dock: "single", dockSide: "bottom" }; // dock = bottom only
    const els = [b, ...stackOn("b1", "top"), ...stackOn("b1", "bottom"), ...stackOn("b1", "left"), ...stackOn("b1", "right")];
    const out = pruneStrandedZones(els);
    const dock = new Set(dockSidesFor(b).dockSides);
    for (const side of trailerSidesIn(out, b)) expect(dock.has(side)).toBe(true);
    expect(trailerSidesIn(out, b)).toEqual(["bottom"]); // only the single dock side remains
  });
});
