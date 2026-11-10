/* NEW-1 (2026-11-10) — dragging a road's control point / end and DROPPING it must keep it where it was dropped.
 *
 * Owner report (Concept B – Quiddity DIA): a 30 ft drive aisle runs from the main road down to the truck court. Its far end carries the drive record
 * (`driveTee` → the court). He drags its top control point so it meets the main road square; it shows there during the drag, then on release SNAPS BACK to
 * the old skewed spot. A few-foot nudge is refused the same way.
 *
 * THE CAUSE (lib/driveFollow.js `followDrives`): it recomputes a drive from the gesture's BASE (the elements as the drag began) so a field drag is
 * reversible. Its only guard against overwriting the road the owner is dragging was `prev.pts === next.pts` for THIS write — true for every write that is not
 * the vertex move itself (the release's junction weld rewrites the same points, the host road gets its tee, the flush, a heal). On such a write the base
 * geometry was written back over the owner's drop. The rule below: a road any of whose control points sits at neither its base spot nor its follow spot was
 * moved by the gesture, so follow leaves it alone for the rest of the gesture.
 * Pure rule — the planner seam (`setEls`) is untouched. */
import { describe, it, expect } from "vitest";
import { followDrives } from "../src/workspaces/site-planner/lib/driveFollow.js";

const COURT = { id: "court", type: "paving", truckCourt: true, cx: 0, cy: 300, w: 240, h: 100, rot: 0 };       // top face at y = 250
const MAIN = { id: "main", type: "road", pts: [{ x: -400, y: 0 }, { x: 400, y: 0 }], vtx: [], travelW: 40, cx: 0, cy: 0, w: 800, h: 40, rot: 0 };
// the 184 ft drive aisle: top end skewed on the main road (x = 120), bottom end on the court's north face
const DRIVE = { id: "drive", type: "road", pts: [{ x: 120, y: 0 }, { x: 0, y: 250 }], vtx: [], travelW: 30, cx: 60, cy: 125, w: 277, h: 30, rot: 0,
  driveTee: { targetId: "court", kind: "paving", returnR: 25, flare: 0 } };
const plan = (over = {}) => [{ ...COURT }, { ...MAIN }, { ...DRIVE, ...over }];
const drive = (s) => s.find((e) => e.id === "drive");
const main = (s) => s.find((e) => e.id === "main");

/** the planner's drag: every pointer move writes the dragged vertex; `base` is what the gesture began from. Returns the state after each write. */
function dragVertex(base, idx, to, { release = [] } = {}) {
  let prev = base;
  const write = (next) => { prev = followDrives(base, prev, next); return prev; };
  // several pointer moves on the way there, then the final one
  const from = drive(base).pts[idx];
  for (const t of [0.3, 0.7, 1]) {
    write(prev.map((e) => (e.id === "drive" ? { ...e, pts: e.pts.map((p, i) => (i === idx ? { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t } : p)) } : e)));
  }
  for (const w of release) write(w(prev));
  return prev;
}
// the writes a release can make that do NOT change the dragged road's points
const releaseWrites = {
  welds: (to) => (s) => s.map((e) => (e.id === "drive" ? { ...e, pts: e.pts.map((p) => ({ ...p })) } : e)),                       // applyRoadConnectPlan re-writes the moving road (same points, new objects)
  hostTee: (to) => (s) => s.map((e) => (e.id === "main" ? { ...e, pts: [{ x: -400, y: 0 }, { x: to.x, y: 0 }, { x: 400, y: 0 }] } : e)), // …and splices the tee into the host road
  unrelated: () => (s) => s.map((e) => (e.id === "court" ? { ...e } : e)),                                                          // any other write: a flush, a heal, a panel edit
};

describe("a dropped road control point STAYS where it was dropped", () => {
  const cases = [
    ["square to the main road (the owner's perpendicular case)", { x: 0, y: 0 }],
    ["a few feet along the main road", { x: 123, y: 0 }],
    ["a couple of feet off", { x: 121.5, y: 1 }],
    ["far from where it started", { x: -200, y: 0 }],
  ];
  for (const [name, to] of cases) {
    it(`${name}: the end stays after the release writes the junction`, () => {
      const s = dragVertex(plan(), 0, to, { release: [releaseWrites.welds(to), releaseWrites.hostTee(to)] });
      expect(drive(s).pts[0]).toEqual(to);
      expect(drive(s).pts[1]).toEqual(DRIVE.pts[1]);          // the far end still sits on the court
      expect(drive(s).driveTee).toEqual(DRIVE.driveTee);      // …and the connection to it is kept
    });
    it(`${name}: and after any other write that does not touch the road`, () => {
      const s = dragVertex(plan(), 0, to, { release: [releaseWrites.unrelated(to), releaseWrites.unrelated(to)] });
      expect(drive(s).pts[0]).toEqual(to);
    });
  }
  it("the host road keeps the tee the release gave it (follow never touches the road the owner did not drive)", () => {
    const to = { x: 0, y: 0 };
    const s = dragVertex(plan(), 0, to, { release: [releaseWrites.hostTee(to)] });
    expect(main(s).pts).toHaveLength(3);
  });
  it("a MIDDLE control point dropped on a multi-point drive stays too", () => {
    const base = plan({ pts: [{ x: 120, y: 0 }, { x: 60, y: 120 }, { x: 0, y: 250 }] });
    const to = { x: 30, y: 125 };
    const s = dragVertex(base, 1, to, { release: [releaseWrites.welds(to)] });
    expect(drive(s).pts[1]).toEqual(to);
  });
  it("the connected END (the one on the court) dropped somewhere stays where the owner put it", () => {
    const to = { x: 40, y: 250 };
    const s = dragVertex(plan(), 1, to, { release: [releaseWrites.welds(to), releaseWrites.unrelated(to)] });
    expect(drive(s).pts[1]).toEqual(to);
  });
  it("dragging the vertex back to where it started is a no-op", () => {
    const s = dragVertex(plan(), 0, { x: 120, y: 0 }, { release: [releaseWrites.welds()] });
    expect(drive(s).pts).toEqual(DRIVE.pts);
    expect(drive(s).driveTee).toEqual(DRIVE.driveTee);
  });
});

describe("the 2026-10-29 follow rule still holds (small move follows, big move lets go)", () => {
  const moveCourt = (s, dx) => s.map((e) => (e.id === "court" ? { ...e, cx: e.cx + dx } : e));
  it("moving the court 40 ft: the connected end follows, the top end (on the main road) does not move", () => {
    const s0 = plan(), s = followDrives(s0, s0, moveCourt(s0, 40));
    expect(drive(s).pts[1]).toMatchObject({ x: 40, y: 250 });
    expect(drive(s).pts[0]).toEqual(DRIVE.pts[0]);
    expect(drive(s).driveTee).toBeTruthy();
  });
  it("moving the court 200 ft: the road lets go and stays as drawn", () => {
    const s0 = plan(), s = followDrives(s0, s0, moveCourt(s0, 200));
    expect(drive(s).pts).toEqual(DRIVE.pts);
    expect(drive(s).driveTee).toBeUndefined();
  });
  it("a field drag in frames: follows, lets go past the threshold, re-follows on the way back (reversible from the base)", () => {
    const base = plan();
    let prev = base;
    for (const dx of [20, 60, 140, 60]) prev = followDrives(base, prev, moveCourt(base, dx));
    expect(drive(prev).pts[1]).toMatchObject({ x: 60, y: 250 });
    expect(drive(prev).driveTee).toBeTruthy();
  });
  it("the follow of a field drag is not mistaken for the owner moving the road (a write that leaves the road alone mid-drag)", () => {
    const base = plan();
    let prev = followDrives(base, base, moveCourt(base, 40));           // road followed
    prev = followDrives(base, prev, prev.map((e) => (e.id === "main" ? { ...e } : e)));   // an unrelated write mid-gesture
    expect(drive(prev).pts[1]).toMatchObject({ x: 40, y: 250 });
    prev = followDrives(base, prev, moveCourt(prev, 110));              // …and the threshold still applies from the base (40 + 110 = 150 ft)
    expect(drive(prev).driveTee).toBeUndefined();
    expect(drive(prev).pts).toEqual(DRIVE.pts);
  });
});
