/* NEW-1 (road → employee parking) — the OWNER'S REAL PLAN: Tsakiris / Concept A (site smrjdgmlinea), read-only from production 2026-10-29
 * (ui-audit/fixtures/tsakiris-concept-a-2026-10-29.json). It carries the entrance he called out in B1009 — "the employee-parking entrance just doesn't look right…
 * you would never shape it like that": a 24 ft fire-lane drive (e1454682splyoj) tee'd into the END of the bonded 220×42 employee field e52duuwgj.
 *
 * What the real data has that every synthetic fixture lacks, and what each test below is for:
 *   • the field is BONDED to a building (attachedTo) — the geometric fallback used to refuse it;
 *   • it is ONE stall row (18) plus a 24 ft lane, not a whole module — `carStalls` reports no aisle for it (the lane is leftover depth);
 *   • the drive lands 7.6 ft OFF the lane's centreline, so its 24 ft pavement hangs 7.6 ft past the field's side — the lopsided entrance. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { measure, netOf, SETTINGS } from "./helpers/driveMatrix.js";
import { driveJunctionsOf } from "../src/workspaces/site-planner/lib/roadJunctions.js";
import { rectFrame, snapToAisle, aisleSnapFor, stallLayoutOf, aislesOf } from "../src/workspaces/site-planner/lib/parkingApproach.js";
import { roadStripRing } from "../src/workspaces/site-planner/lib/siteGeometry.js";
import { createSiteModel } from "../src/workspaces/site-planner/lib/siteModel.js";

const D = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/tsakiris-concept-a-2026-10-29.json", import.meta.url), "utf8"));
const els = D.els;
const FIELD = els.find((e) => e.id === "e52duuwgj"), ROAD = els.find((e) => e.id === "e1454682splyoj");

/* ⛔ WHAT THE APP SHOWS IS NOT WHAT THE ROWS SAY. `createSiteModel` runs the bonded-child heal on open: every field bonded to a building is re-seated against its wall, which on this
 * plan moves e52duuwgj (and five siblings) 5 ft west of where its stored `cx` puts it. The stored drive was welded to the field where it USED to be; after the heal the drive's
 * last leg (3° off the field's east edge) runs ALONGSIDE that edge and ends 19 ft inside the footprint. Measured through the real app (page `__plannerRoadNet`) and through the
 * same function here — the two agree; the raw-rows tests below describe the stored geometry, the "as the app opens it" block describes what the owner actually sees. */
const OPENED = createSiteModel({ id: "x", els, settings: {} }).els;
describe("Tsakiris / Concept A — AS THE APP OPENS IT (bonded fields healed against their buildings)", () => {
  const f = OPENED.find((e) => e.id === "e52duuwgj");
  it("the heal moves the bonded field 5 ft off the stored rows", () => {
    expect(f.cx).toBeCloseTo(-235.73, 2);
  });
  it("the drive still connects to the bonded field (stored tee AND geometric), as a SKIM: it lies alongside the east edge, so no curb return is built", () => {
    const j = driveJunctionsOf(OPENED, SETTINGS).find((x) => x.sideId === ROAD.id && x.targetId === f.id);
    expect(j).toBeTruthy();
    expect(j.geom.skim).toBe(true);
    expect(j.geom.wedges.length).toBe(0);
    const stale = OPENED.map((e) => (e.id === ROAD.id ? { ...e, driveTee: undefined } : e));
    expect(driveJunctionsOf(stale, SETTINGS).some((x) => x.sideId === ROAD.id && x.targetId === f.id)).toBe(true);
  });
  it("…and nothing it builds runs away from the junction (B1756546), nor is the outline ruled across the stretch where the pavement lies against the field", async () => {
    const m = await measure(OPENED, { roadId: ROAD.id, fieldId: f.id, expectWedges: null, entryFace: "bottom" });
    expect(m.fails).toEqual([]);
    const j = driveJunctionsOf(OPENED, SETTINGS).find((x) => x.sideId === ROAD.id && x.targetId === f.id);
    const far = Math.max(0, ...j.geom.throughTangents.map((p) => Math.hypot(p.x - j.junctionPt.x, p.y - j.junctionPt.y)));
    expect(far).toBeLessThan(110);
  });
});

describe("Tsakiris / Concept A — the employee-parking entrance, AS STORED (the rows, before the heal)", () => {
  it("the fixture really is the owner's case (a bonded field, a stored tee, a 24 ft drive)", () => {
    expect(FIELD.attachedTo).toBeTruthy();
    expect(ROAD.driveTee.targetId).toBe("e52duuwgj");
    expect(ROAD.travelW).toBe(24);
  });
  it("the junction exists — with the stored tee AND with it stale (the bonded field is still a target)", () => {
    expect(driveJunctionsOf(els, SETTINGS).some((j) => j.sideId === ROAD.id && j.targetId === FIELD.id && j.kind === "parking")).toBe(true);
    const stale = els.map((e) => (e.id === ROAD.id ? { ...e, driveTee: { ...e.driveTee, targetId: "gone" } } : e));
    expect(driveJunctionsOf(stale, SETTINGS).some((j) => j.sideId === ROAD.id && j.targetId === FIELD.id)).toBe(true);
    const bare = els.map((e) => (e.id === ROAD.id ? { ...e, driveTee: undefined } : e));
    expect(driveJunctionsOf(bare, SETTINGS).some((j) => j.sideId === ROAD.id && j.targetId === FIELD.id)).toBe(true);
  });
  it("the field is a row + a lane: the lane is its aisle (carStalls reports none)", () => {
    const L = stallLayoutOf(FIELD, SETTINGS);
    expect(L.aisles.length).toBe(0);
    expect(aislesOf(L, FIELD.h)).toEqual([{ y0: 18, y1: 42 }]);
    expect(L.count).toBe(24);
  });
  it("as drawn, the drive lands 7.6 ft off the lane's centre and the snap would centre it on the 24 ft lane (no overhang)", () => {
    const F = rectFrame(FIELD);
    const j = driveJunctionsOf(els, SETTINGS).find((x) => x.sideId === ROAD.id && x.targetId === FIELD.id);
    const l = F.toLocal(j.junctionPt);
    expect(l.x).toBeCloseTo(0, 3);
    expect(l.y).toBeCloseTo(37.64, 1);
    const sn = snapToAisle(FIELD, SETTINGS, j.junctionPt);
    expect(sn.movedFt).toBeCloseTo(7.64, 1);
    expect(F.toLocal(sn.pt).y).toBeCloseTo(30, 6);
    // the gesture moves the road's welded END onto the snapped point; the drive's last leg is then a 24 ft strip exactly the lane's width
    const moved = { ...ROAD, pts: ROAD.pts.map((p, i) => (i === ROAD.pts.length - 1 ? { x: sn.pt.x, y: sn.pt.y } : p)) };
    const els2 = els.map((e) => (e.id === ROAD.id ? moved : e));
    const j2 = driveJunctionsOf(els2, SETTINGS).find((x) => x.sideId === ROAD.id && x.targetId === FIELD.id);
    expect(j2.geom.wedges.length).toBe(2);
    const strip = roadStripRing(moved, SETTINGS, undefined, undefined).map((p) => F.toLocal(p));
    const near = strip.filter((p) => p.x > -2 && p.x < 30);
    expect(near.length).toBeGreaterThan(0);
    expect(Math.min(...near.map((p) => p.y))).toBeGreaterThan(16); expect(Math.max(...near.map((p) => p.y))).toBeLessThan(44);   // curb included, and the leg is 6° off square: ≤ 2 ft past the lane, against 7.6 before
  });
  it("the connect gesture REFUSES to re-aim this short final leg (11.6° > 8°) but snaps a straight approach — never bend a road to centre it", () => {
    const j = driveJunctionsOf(els, SETTINGS).find((x) => x.sideId === ROAD.id && x.targetId === FIELD.id);
    const behind = ROAD.pts[ROAD.pts.length - 2];
    expect(aisleSnapFor(FIELD, SETTINGS, j.junctionPt, behind)).toBeNull();
    const F = rectFrame(FIELD), far = F.toWorld({ x: -140, y: 37.64 });
    expect(aisleSnapFor(FIELD, SETTINGS, j.junctionPt, far)).toBeTruthy();         // 140 ft back: 3° — fine
    expect(aisleSnapFor(FIELD, SETTINGS, j.junctionPt, null)).toBeTruthy();        // a road STARTED on the field has no leg to bend
  });
  it("the finished junction is clean as drawn AND after the snap (the matrix measure on the real data)", async () => {
    const asDrawn = await measure(els, { roadId: ROAD.id, fieldId: FIELD.id, expectWedges: null });
    expect(asDrawn.fails).toEqual([]);
    const F = rectFrame(FIELD), j = driveJunctionsOf(els, SETTINGS).find((x) => x.sideId === ROAD.id && x.targetId === FIELD.id);
    const sn = snapToAisle(FIELD, SETTINGS, j.junctionPt);
    const moved = { ...ROAD, pts: ROAD.pts.map((p, i) => (i === ROAD.pts.length - 1 ? { x: sn.pt.x, y: sn.pt.y } : p)) };
    const snapped = await measure(els.map((e) => (e.id === ROAD.id ? moved : e)), { roadId: ROAD.id, fieldId: FIELD.id, expectWedges: null });
    expect(snapped.fails).toEqual([]);
    void F;
  });
  it("a drive into the lane's END removes no stalls — the field keeps all 24", async () => {
    const { net } = await netOf(els);
    const clip = net.stallClips.get(FIELD.id);
    expect(clip ? clip.removed.length : 0).toBe(0);
  });
  it("the plan's other drive junctions (the truck courts) are unchanged", () => {
    const js = driveJunctionsOf(els, SETTINGS).map((j) => `${j.sideId}->${j.targetId}`).sort();
    expect(js).toEqual(["e1454682splyoj->e52duuwgj", "e38duuwgj->e26duuwgj", "e54duuwgj->e26duuwgj"]);
  });
});
