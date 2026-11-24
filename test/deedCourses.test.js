import { describe, it, expect } from "vitest";
import { callsToPath, pathCloses } from "../src/workspaces/site-planner/lib/deedParse.js";
import { deedTrace } from "../src/workspaces/site-planner/lib/deedGap.js";
import {
  parseBearing, bearingText, courseParts, courseLabelText, courseEditable, drawnOffsetDeg, retraceWithEdit,
  deedClosureFacts, courseLabelLayout, nameAnchor, courseLabelPlaceOf, nameShown,
} from "../src/workspaces/site-planner/lib/deedCourses.js";

const deed = { callsToPath, pathCloses };
const call = (az, distFt) => ({ az, distFt, label: `${bearingText(az)}  ${distFt}′` });
const square = () => {
  const calls = [call(0, 100), call(90, 100), call(180, 100), call(270, 100)];
  const path = callsToPath(calls, { x: 50, y: 50 });
  return { id: "d", kind: "encumbrance", calls, centerline: path, pts: deedTrace({ centerline: path, pts: path }).ring };
};
const rotate = (m, deg) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), o = m.centerline[0];
  const f = (p) => ({ x: o.x + (p.x - o.x) * c - (p.y - o.y) * s, y: o.y + (p.x - o.x) * s + (p.y - o.y) * c });
  return { ...m, centerline: m.centerline.map(f), pts: m.pts.map(f) };
};

describe("bearings", () => {
  it("parses the common survey spellings", () => {
    expect(parseBearing("N 45°30'15\" E").az).toBeCloseTo(45.504166, 4);
    expect(parseBearing("S45-30-15W").az).toBeCloseTo(225.504166, 4);
    expect(parseBearing("n 10 w").az).toBeCloseTo(350, 6);
    expect(parseBearing("S 12.5 E").az).toBeCloseTo(167.5, 6);
  });
  it("refuses what is not a bearing, never guessing", () => {
    for (const bad of ["", "N 145 E", "N 45 60 E", "E 45 N", "45", "N 45"]) expect(parseBearing(bad), bad).toBeNull();
  });
  it("round-trips an azimuth through the deed's own text", () => {
    for (const az of [0, 1.5, 45.504166, 90, 135.25, 180, 269.999, 300.5]) expect(parseBearing(bearingText(az)).az).toBeCloseTo(az, 2);
    expect(bearingText(45)).toBe("N 45° E");
  });
});

describe("course labels", () => {
  it("splits a label into bearing and distance and hides either half per course", () => {
    const c = call(45, 150);
    expect(courseParts(c)).toEqual({ bearing: "N 45° E", dist: "150′" });
    expect(courseLabelText(c)).toBe("N 45° E  150′");
    expect(courseLabelText({ ...c, hideBearing: true })).toBe("150′");
    expect(courseLabelText({ ...c, hideDist: true })).toBe("N 45° E");
    expect(courseLabelText({ ...c, hideBearing: true, hideDist: true })).toBe("");
  });
  it("lays a label out above the line by default, upright and flat, and turns with the line when asked", () => {
    const c = call(0, 10), a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
    const flat = courseLabelLayout({}, c, a, b, 1);
    expect(flat).toMatchObject({ x: 50, y: 0, angle: 0, dy: -3, scale: 1 });
    expect(courseLabelLayout({ courseLabelAlong: true }, c, a, { x: 100, y: 100 }, 1).angle).toBeCloseTo(45, 6);
    expect(courseLabelLayout({ courseLabelAlong: true }, c, a, { x: -100, y: 0 }, 1).angle).toBeCloseTo(0, 6); // never upside down
    expect(courseLabelLayout({ courseLabelPlace: "below", courseLabelSize: 18 }, c, a, b, 1)).toMatchObject({ scale: 2 });
    expect(courseLabelLayout({}, { ...c, hideBearing: true, hideDist: true }, a, b, 1)).toBeNull();
    expect(courseLabelPlaceOf({ courseLabelPlace: "bogus" })).toBe("above");
  });
  it("the name defaults to shown and centred, and nudges only on request", () => {
    expect(nameShown({})).toBe(true); expect(nameShown({ showName: false })).toBe(false);
    const ring = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }, { x: 0, y: 30 }], ctr = { x: 5, y: 15 };
    expect(nameAnchor({}, ring, ctr)).toEqual(ctr);
    expect(nameAnchor({ nameAt: "top" }, ring, ctr)).toEqual({ x: 5, y: 5 });
    expect(nameAnchor({ nameAt: "bottom" }, ring, ctr)).toEqual({ x: 5, y: 25 });
  });
});

describe("editing a course re-traces the deed", () => {
  it("a longer last course opens a misclosure and the closing facts follow", () => {
    const m = square();
    expect(deedClosureFacts(m).gap).toBeNull();
    expect(deedClosureFacts(m).areaSf).toBeCloseTo(10000, 3);
    const r = retraceWithEdit(m, 3, { distFt: 110 }, deed);
    expect(r.ok).toBe(true);
    const next = { ...m, calls: r.calls, centerline: r.centerline, pts: r.pts };
    expect(deedClosureFacts(next).gap.ft).toBeCloseTo(10, 6);
    expect(r.calls[3].label).toBe("N 90° W  110′".replace("N 90° W", bearingText(270)));
    expect(r.calls[0]).toBe(m.calls[0]); // untouched courses are the same objects
  });
  it("keeps the turn the drawing already wears (a deed rotated by Align stays rotated)", () => {
    const m = rotate(square(), 17);
    expect(drawnOffsetDeg(m)).toBeCloseTo(17, 6);
    const r = retraceWithEdit(m, 1, { distFt: 120 }, deed);
    expect(r.ok).toBe(true);
    const next = { ...m, calls: r.calls, centerline: r.centerline, pts: r.pts };
    expect(drawnOffsetDeg(next)).toBeCloseTo(17, 6);
    expect(r.centerline[0]).toEqual(m.centerline[0]);          // still starts at the point of beginning
    expect(Math.hypot(r.centerline[2].x - r.centerline[1].x, r.centerline[2].y - r.centerline[1].y)).toBeCloseTo(120, 6);
  });
  it("retyping the first course's bearing turns the whole shape by that change, not by the drawn offset twice", () => {
    const m = rotate(square(), 17);
    const r = retraceWithEdit(m, 0, { bearingText: "N 10° E" }, deed);
    expect(r.ok).toBe(true);
    const c = r.centerline, drawn = (Math.atan2(c[1].x - c[0].x, -(c[1].y - c[0].y)) * 180) / Math.PI;
    expect(drawn).toBeCloseTo(27, 6);
  });
  it("refuses in plain words and changes nothing", () => {
    const m = square();
    expect(retraceWithEdit(m, 0, { bearingText: "nonsense" }, deed)).toMatchObject({ ok: false });
    expect(retraceWithEdit(m, 0, { distFt: 0 }, deed)).toMatchObject({ ok: false });
    expect(retraceWithEdit(m, 0, { distFt: 100 }, deed)).toMatchObject({ ok: false, unchanged: true });
    expect(retraceWithEdit(m, 9, { distFt: 5 }, deed).ok).toBe(false);
    expect(courseEditable({ curve: true, az: 1, distFt: 1 })).toBe(false);
    expect(retraceWithEdit({ ...m, calls: [{ ...m.calls[0], curve: true }, ...m.calls.slice(1)] }, 0, { distFt: 5 }, deed).ok).toBe(false);
  });
});
