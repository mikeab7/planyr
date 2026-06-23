import { describe, it, expect } from "vitest";
import {
  DOCK_ZONES, MAX_DOCK_ZONES, zoneDepthDefaults, zoneDepthDefault, layoutZone, layoutStack,
  dockSidesFor, footprintDepth, strandedZoneIds, pruneStrandedZones,
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
