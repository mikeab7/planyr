/* A new drive-in ramp sits FLUSH against the corner bump-out, or the end of the building when there is none (owner 2026-11-24: "the ramp should default
 * against the bumpout or end of the building if theres no bumpout"). Before, the corner "+" snapped the door to the nearest dock-door module from the door
 * run's start, which left a gap between the ramp and the bump-out. Pure rules in lib/driveInRamp.js (`pickRampSpot`, `bumpSpansOnWall`, `flushRampAt`,
 * `flushEndOf`, `fitAlongTheWall`); bump-out boxes come from the REAL `dogEarGeom`, so "flush" is judged against the box the canvas draws. */
import { describe, it, expect } from "vitest";
import {
  newRampRecord, rampSpan, rampRing, rampBox, pickRampSpot, bumpSpansOnWall, wallFreeEnds, flushRampAt, flushEndOf, fitAlongTheWall, rampFlags, RAMP_FLAG,
  reseatRamps, refitRamps, wallFrame, ringsOverlapInset,
} from "../src/workspaces/site-planner/lib/driveInRamp.js";
import { dogEarGeom, DOGEAR_W } from "../src/workspaces/site-planner/lib/dogEar.js";
import { dockSidesFor } from "../src/workspaces/site-planner/lib/dockZones.js";
import { ringOf } from "../src/workspaces/site-planner/lib/siteGeometry.js";
import { plannerSource } from "./helpers/plannerSource.js";

const IN = 48;
const sidesOf = (h) => dockSidesFor(h).dockSides;
const bump = (host, side, sign, along) => ({ id: `de-${side}${sign}`, type: "dogEar", attachedTo: host.id, dogEar: { side, sign, ...(along ? { along } : {}) }, ...dogEarGeom(host, { side, sign, along }) });
const rampEl = (id, host, ramp) => ({ id, type: "driveInRamp", attachedTo: host.id, noLabel: true, ramp, ...rampBox(host, ramp, { dockHeightIn: IN }) });
// the "+" at one corner, exactly as SitePlanner planRampAt + addRamp do it
const plus = (els, host, side, where) => {
  const L = wallFrame(host, side).L;
  const at = pickRampSpot({ L, W: 16, where, taken: els.filter((x) => x.type === "driveInRamp" && x.attachedTo === host.id && x.ramp.side === side).map((r) => rampSpan(r.ramp, { dockHeightIn: IN })), bumps: bumpSpansOnWall(els, host, side) });
  return at == null ? null : newRampRecord(side, at);
};
const near = (a, b) => Math.abs(a - b) < 1e-6;

const HOSTS = [
  { id: "hx", type: "building", cx: 0, cy: 0, w: 600, h: 300, rot: 0, dock: "cross", dockAxis: "x" },          // docks top + bottom
  { id: "hy", type: "building", cx: 100, cy: -50, w: 300, h: 600, rot: 0, dock: "cross", dockAxis: "y" },      // docks left + right
  { id: "hr", type: "building", cx: 5000, cy: 3000, w: 400, h: 784, rot: 89, dock: "cross", dockAxis: "y" },   // the owner's rotated Building 4 shape
  { id: "h3", type: "building", cx: 0, cy: 0, w: 600, h: 300, rot: 315, dock: "cross", dockAxis: "x" },
];

describe("the corner '+' puts the ramp flush against the bump-out, or the building end when there is none", () => {
  for (const host of HOSTS) for (const side of sidesOf(host)) for (const where of ["start", "end"]) {
    const sign = where === "start" ? -1 : 1, L = wallFrame(host, side).L;
    it(`${host.id} (${host.rot}°) ${side} wall, ${where} corner`, () => {
      // no bump-out: the footprint's near edge IS the wall end
      const bare = plus([host], host, side, where), sp0 = rampSpan(bare, { dockHeightIn: IN });
      expect(where === "start" ? sp0.u0 : sp0.u1).toBeCloseTo(where === "start" ? 0 : L, 6);
      // with a bump-out at that corner (default and a resized one): flush against its inner edge, touching it but never overlapping it
      for (const along of [undefined, 40]) {
        const de = bump(host, side, sign, along), els = [host, de];
        const rec = plus(els, host, side, where), sp = rampSpan(rec, { dockHeightIn: IN }), a = along || DOGEAR_W;
        expect(where === "start" ? sp.u0 : sp.u1).toBeCloseTo(where === "start" ? a : L - a, 6);
        const ring = rampRing(host, rec, { dockHeightIn: IN });
        expect(ringsOverlapInset(ring, ringOf(de))).toBe(false);
        // the gap between the ramp and the bump-out is zero: a ramp corner lies on the bump-out's edge
        const deRing = ringOf(de);
        const onEdge = ring.some((p) => deRing.some((q, i) => { const r = deRing[(i + 1) % 4]; const cr = (r.x - q.x) * (p.y - q.y) - (r.y - q.y) * (p.x - q.x); return Math.abs(cr) / Math.hypot(r.x - q.x, r.y - q.y) < 1e-6; }));
        expect(onEdge).toBe(true);
        const flags = rampFlags(host, rec, { dockSides: sidesOf(host), dockHeightIn: IN, others: [{ name: "the corner bump-out", ring: deRing }] }).map((f) => f.code);
        expect(flags).not.toContain(RAMP_FLAG.CROSSES); expect(flags).not.toContain(RAMP_FLAG.OFF_WALL);
        expect(flushEndOf(rec, { L, bumps: bumpSpansOnWall(els, host, side), dockHeightIn: IN })).toBe(where);
      }
      // a bump-out at the OTHER corner does not move this end's ramp
      const other = [host, bump(host, side, -sign)];
      expect(plus(other, host, side, where).at).toBeCloseTo(bare.at, 6);
    });
  }
  it("bump-outs on BOTH ends: each corner's ramp sits against its own bump-out; a second press pushes flush against the first ramp", () => {
    const host = HOSTS[0], els = [host, bump(host, "bottom", -1), bump(host, "bottom", 1)];
    const s = plus(els, host, "bottom", "start"), e = plus(els, host, "bottom", "end");
    expect(rampSpan(s, { dockHeightIn: IN }).u0).toBeCloseTo(DOGEAR_W, 6);
    expect(rampSpan(e, { dockHeightIn: IN }).u1).toBeCloseTo(600 - DOGEAR_W, 6);
    const withOne = [...els, rampEl("r1", host, s)];
    const s2 = plus(withOne, host, "bottom", "start");
    expect(rampSpan(s2, { dockHeightIn: IN }).u0).toBeCloseTo(DOGEAR_W + 16, 6);
    expect(wallFreeEnds(600, bumpSpansOnWall(els, host, "bottom"))).toEqual({ e0: DOGEAR_W, e1: 600 - DOGEAR_W });
  });
});

describe("turning it along the wall and back keeps it flush; moving / resizing the building keeps it flush", () => {
  const host = HOSTS[0];
  for (const [where, sign] of [["start", -1], ["end", 1]]) for (const withBump of [false, true]) {
    it(`${where} corner, ${withBump ? "with" : "without"} a bump-out`, () => {
      const els = withBump ? [host, bump(host, "bottom", sign)] : [host];
      const bumps = bumpSpansOnWall(els, host, "bottom"), L = 600, edge = where === "start" ? (withBump ? DOGEAR_W : 0) : (withBump ? L - DOGEAR_W : L);
      const rec = plus(els, host, "bottom", where);
      const flushEnd = flushEndOf(rec, { L, bumps, dockHeightIn: IN });
      expect(flushEnd).toBe(where);
      // turn along (the inspector's exact call): the low end now touches the same obstacle, running toward it
      const fit = fitAlongTheWall({ ...rec, layout: "along" }, { L, stops: [], dockHeightIn: IN, bumps, flushEnd });
      const along = { ...rec, layout: "along", ...fit }, spA = rampSpan(along, { dockHeightIn: IN });
      expect(where === "start" ? spA.u0 : spA.u1).toBeCloseTo(edge, 6);
      expect(spA.u1 - spA.u0).toBeCloseTo(50, 6);
      // flip which way it runs: still flush at that end (the door end now touches it)
      const flip = fitAlongTheWall({ ...along, dir: -along.dir }, { L, dockHeightIn: IN, keepDir: -along.dir, bumps, flushEnd: flushEndOf(along, { L, bumps, dockHeightIn: IN }) });
      const spF = rampSpan({ ...along, ...flip }, { dockHeightIn: IN });
      expect(where === "start" ? spF.u0 : spF.u1).toBeCloseTo(edge, 6);
      // back to straight-in: flush again
      const back = { ...along, layout: "straight", at: flushRampAt({ ...along, layout: "straight" }, { L, bumps, where: flushEndOf(along, { L, bumps, dockHeightIn: IN }), dockHeightIn: IN }) };
      const spB = rampSpan(back, { dockHeightIn: IN });
      expect(where === "start" ? spB.u0 : spB.u1).toBeCloseTo(edge, 6);
      // the building moves, rotates and gets LONGER at its far end: the ramp follows its end and stays flush against the bump-out (which rides the corner)
      const r = rampEl("r", host, rec), base = [...els, r];
      for (const patch of [{ cx: 250, cy: -90 }, { rot: 30 }, { w: 720 }, { w: 520 }]) {
        const nextHost = { ...host, ...patch };
        const next = base.map((x) => (x.id === host.id ? nextHost : x.dogEar ? { ...x, ...dogEarGeom(nextHost, x.dogEar) } : x));
        const out = refitRamps(reseatRamps(base, base, next, { dockSidesOf: sidesOf, dockHeightIn: IN }), sidesOf, IN);
        const got = out.find((x) => x.id === "r"), nL = wallFrame(nextHost, "bottom").L;
        expect(flushEndOf(got.ramp, { L: nL, bumps: bumpSpansOnWall(out, nextHost, "bottom"), dockHeightIn: IN }), JSON.stringify(patch)).toBe(where);
      }
    });
  }
  it("a mid-wall ramp is NOT pulled to an end when turned (only a flush one stays flush)", () => {
    const rec = newRampRecord("bottom", 300);
    expect(flushEndOf(rec, { L: 600, dockHeightIn: IN })).toBeNull();
    const fit = fitAlongTheWall({ ...rec, layout: "along" }, { L: 600, stops: [], dockHeightIn: IN });
    expect(fit.at).toBe(300);
  });
  it("SitePlanner's '+' and the inspector read the flush rules (no door-module snap at the corner)", () => {
    const src = plannerSource();
    expect(src).toMatch(/pickRampSpot\(\{ L: wallFrame\(b, side\)\.L, W, where, taken, bumps: bumpSpansOnWall\(els, b, side\) \}\)/);
    expect(src).toMatch(/flushEndOf\(rec, \{ L, bumps, dockHeightIn: rampDockIn \}\)/);
  });
});
