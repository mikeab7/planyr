/* The owner's real Georgia Test Site › Concept A rows (site smvbezp3dx3d, read 2026-10-19, read-only): a 1204×529
 * cross-dock (636,916 SF), long axis north–south, two 135 ft truck courts each with a 50 ft trailer row, end parking
 * and walks — the geometry problem report 6cea9895 froze on. Shared by the Node bench and the browser harness. */
export const OWNER_ORIGIN = Object.freeze({ lat: 33.2458963792457, lon: -84.16362918465775 });
export const CHEHAW_CROSS_DOCK_ROWS = [
  { h: 529, w: 1204, cx: -33.95, cy: -335.02, id: "e331olvzwe", rot: 270, dock: "cross", type: "building", dockAxis: "x", dockSide: "bottom" },
  { h: 529, w: 5, cx: -33.95, cy: 269.48, id: "e332olvzwe", rot: 270, type: "sidewalk", attachedTo: "e331olvzwe" },
  { h: 60, w: 529, cx: -33.95, cy: 301.98, id: "e333olvzwe", rot: 0, type: "parking", attachedTo: "e331olvzwe" },
  { h: 135, w: 1204, cx: 298.05, cy: -335.02, id: "e336olvzwe", rot: 270, type: "paving", attachedTo: "e331olvzwe", truckCourt: { side: "bottom" } },
  { h: 50, w: 1204, cx: 390.55, cy: -335.02, id: "e338olvzwe", rot: 270, type: "trailer", forCourt: "e336olvzwe", attachedTo: "e331olvzwe" },
  { h: 135, w: 1204, cx: -365.95, cy: -335.02, id: "e339olvzwe", rot: 270, type: "paving", attachedTo: "e331olvzwe", truckCourt: { side: "top" } },
  { h: 50, w: 1204, cx: -458.45, cy: -335.02, id: "e340olvzwe", rot: 270, type: "trailer", forCourt: "e339olvzwe", attachedTo: "e331olvzwe" },
  { h: 529, w: 5, cx: -33.95, cy: -939.52, id: "e341olvzwe", rot: 270, type: "sidewalk", attachedTo: "e331olvzwe" },
  { h: 102, w: 529, cx: -33.95, cy: -993.02, id: "e342olvzwe", rot: 180, type: "parking", attachedTo: "e331olvzwe" },
  { h: 15, w: 1204, cx: 423.05, cy: -335.02, id: "e1455142tpdols", rot: 270, type: "landscape", buffer: true, attachedTo: "e331olvzwe" },
];

/* A row's footprint ring in plan feet (rotation about its centre; 90/270 swap the extents). */
export function rowRing(e) {
  const t = (e.rot || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const hw = e.w / 2, hh = e.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: e.cx + x * c - y * s, y: e.cy + x * s + y * c }));
}

// The owner's Concept A as it stood on 2026-10-30 (B2500224 ×2 — the "To the boundary" recurrence): the same cross-dock,
// enlarged to 1429 × 650 and turned to 259°, with a 15 ft landscape buffer behind the east trailer row. Read-only copy of
// the plan's rows (same origin as above); the plan's setback is a uniform 25 ft. Used by `?owner=2` in the grading harness
// and by repo-root test/gradingRound9.test.js.
export const CHEHAW_CONCEPT_A_ROWS = [
  { h: 650, w: 1429, cx: 107.0459214375833, cy: -244.82803302345678, id: "e331olvzwe", rot: 259, dock: "cross", type: "building", dockAxis: "x", dockSide: "bottom" },
  { h: 650, w: 5, cx: -29.764128247399782, cy: -948.6547235554317, id: "e341olvzwe", rot: 259, type: "sidewalk", attachedTo: "e331olvzwe" },
  { h: 650, w: 5, cx: 243.85597112256642, cy: 458.99865750851825, id: "e332olvzwe", rot: 259, type: "sidewalk", attachedTo: "e331olvzwe" },
  { h: 60, w: 650, cx: 250.05726347230413, cy: 490.90154097056734, id: "e333olvzwe", rot: 349, type: "parking", attachedTo: "e331olvzwe" },
  { h: 135, w: 1429, cx: 492.3345909407914, cy: -319.7205637087509, id: "e336olvzwe", rot: 259, type: "paving", attachedTo: "e331olvzwe", truckCourt: { side: "bottom" } },
  { h: 50, w: 1429, cx: 583.1351054097003, cy: -337.37039578108136, id: "e338olvzwe", rot: 259, type: "trailer", forCourt: "e336olvzwe", attachedTo: "e331olvzwe" },
  { h: 135, w: 1429, cx: -278.2427480656247, cy: -169.93550233816268, id: "e339olvzwe", rot: 259, type: "paving", attachedTo: "e331olvzwe", truckCourt: { side: "top" } },
  { h: 50, w: 1429, cx: -369.0432625345337, cy: -152.2856702658322, id: "e340olvzwe", rot: 259, type: "trailer", forCourt: "e339olvzwe", attachedTo: "e331olvzwe" },
  { h: 60, w: 650, cx: -35.965420597137516, cy: -980.5576070174808, id: "e342olvzwe", rot: 169, type: "parking", attachedTo: "e331olvzwe" },
  { h: 15, w: 1429, cx: 615.0379888717493, cy: -343.5716881308191, id: "e1455142tpdols", rot: 259, type: "landscape", attachedTo: "e331olvzwe" },
];
