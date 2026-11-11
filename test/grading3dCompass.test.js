// B2671226 (NEW-1, 2026-11-11) — the 3D viewer's cardinal directions: the compass heading, the four letters, and where the ground "N" stands.
// Pure: lib/grading3d/compass.js (no three.js). The heading is checked against KNOWN camera azimuths AND against an independent oracle — a real camera
// basis built from orbit.cameraPosition, looking straight down — so the test does not merely restate the formula under test.
import { describe, it, expect } from "vitest";
import { northHeadingDeg, cardinalHeadings, headingToOffset, northMarkerSpec, markerFramingFactor, MARKER_SIZE_K } from "../src/workspaces/site-planner/lib/grading3d/compass.js";
import { cameraPosition, frame, boundsOf, DEFAULT_AZ, DEFAULT_EL } from "../src/workspaces/site-planner/lib/grading3d/orbit.js";

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const deg = (r) => (r * 180) / Math.PI;

/* The oracle: a camera at cameraPosition(state) looking at the target, projected onto the screen with the standard right/up basis; north is world −Z.
 * `el` is pushed to straight down so the ground projects without foreshortening — the same top-down reading a flat compass makes. */
function screenHeadingOfNorth(az) {
  const s = { az, el: Math.PI / 2 - 1e-6, dist: 1000, tx: 0, ty: 0, tz: 0 };
  const p = cameraPosition(s);
  const f = [-p.x, -p.y, -p.z]; const fl = Math.hypot(...f); f.forEach((_, i) => { f[i] /= fl; });
  const up = [0, 1, 0];
  const r = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];       // right = f × up
  const rl = Math.hypot(...r); r.forEach((_, i) => { r[i] /= rl; });
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];             // camera-up = right × f
  const n = [0, 0, -1];
  const x = n[0] * r[0] + n[1] * r[1] + n[2] * r[2], y = n[0] * u[0] + n[1] * u[1] + n[2] * u[2];
  const h = deg(Math.atan2(x, y));
  return (h + 360) % 360;
}

describe("northHeadingDeg — known camera azimuths", () => {
  it("az 0 (standing south of the site, looking north): north is straight up", () => {
    expect(northHeadingDeg(0)).toBe(0);
  });
  it("az +90° (camera swung east, looking west): north is on the RIGHT of the screen", () => {
    expect(near(northHeadingDeg(Math.PI / 2), 90)).toBe(true);
  });
  it("az 180° (camera north of the site, looking south): north points toward the viewer — straight DOWN the screen", () => {
    expect(near(northHeadingDeg(Math.PI), 180)).toBe(true);
  });
  it("az 270° / −90° (camera west, looking east): north is on the LEFT", () => {
    expect(near(northHeadingDeg((3 * Math.PI) / 2), 270)).toBe(true);
    expect(near(northHeadingDeg(-Math.PI / 2), 270)).toBe(true);
  });
  it("wraps: a full turn and several turns land in [0, 360); a non-number reads as 0 (never NaN)", () => {
    expect(near(northHeadingDeg(2 * Math.PI), 0, 1e-7) || near(northHeadingDeg(2 * Math.PI), 360, 1e-7)).toBe(true);
    for (const az of [-7.3, -0.001, 0.001, 6.2, 13.9, 100]) { const h = northHeadingDeg(az); expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThan(360); }
    expect(northHeadingDeg(NaN)).toBe(0); expect(northHeadingDeg(undefined)).toBe(0);
  });
  it("AGREES WITH AN INDEPENDENT CAMERA BASIS at every azimuth (the oracle is orbit.cameraPosition looking straight down, not this formula)", () => {
    for (let az = -3.1; az < 6.3; az += 0.37) {
      const want = screenHeadingOfNorth(az), got = northHeadingDeg(az);
      const d = Math.min(Math.abs(want - got), 360 - Math.abs(want - got));
      expect(d).toBeLessThan(1e-3);
    }
  });
  it("the opening view: the compass reads the camera's DEFAULT azimuth, so Reset view and the compass cannot disagree", () => {
    const home = frame(boundsOf({ minX: 0, maxX: 2000, minY: 0, maxY: 100, minZ: 0, maxZ: 3000 }, 3), 1.6);
    expect(home.az).toBe(DEFAULT_AZ); expect(home.el).toBe(DEFAULT_EL);
    expect(near(northHeadingDeg(home.az), deg(DEFAULT_AZ))).toBe(true);
  });
});

describe("cardinalHeadings / headingToOffset — the four letters round the rose", () => {
  it("at az 0: N up, E right, S down, W left", () => {
    const h = cardinalHeadings(0);
    expect([h.N, h.E, h.S, h.W]).toEqual([0, 90, 180, 270]);
    const pos = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, headingToOffset(v, 10)]));
    expect(near(pos.N.x, 0) && near(pos.N.y, -10)).toBe(true);          // y grows downward on screen: up is negative
    expect(near(pos.E.x, 10) && near(pos.E.y, 0)).toBe(true);
    expect(near(pos.S.x, 0) && near(pos.S.y, 10)).toBe(true);
    expect(near(pos.W.x, -10) && near(pos.W.y, 0)).toBe(true);
  });
  it("the letters always stay a quarter turn apart, clockwise N → E → S → W, at any azimuth", () => {
    for (const az of [0.42, 1.1, 2.9, 4.4, -1.7]) {
      const h = cardinalHeadings(az);
      expect(near((h.E - h.N + 360) % 360, 90)).toBe(true);
      expect(near((h.S - h.E + 360) % 360, 90)).toBe(true);
      expect(near((h.W - h.S + 360) % 360, 90)).toBe(true);
      expect(near(h.N, northHeadingDeg(az))).toBe(true);
    }
  });
  it("a known orbit: at az 90° (looking west) the N letter sits on the right and E is at the bottom", () => {
    const h = cardinalHeadings(Math.PI / 2);
    const n = headingToOffset(h.N, 10), e = headingToOffset(h.E, 10);
    expect(near(n.x, 10) && near(n.y, 0, 1e-9)).toBe(true);
    expect(near(e.x, 0, 1e-9) && near(e.y, 10)).toBe(true);
  });
});

describe("northMarkerSpec — the ground 'N' stands just off the north edge, the same size at every height stretch", () => {
  const box = { minX: 100, maxX: 2100, minY: 700, maxY: 800, minZ: 400, maxZ: 3400 };
  it("is centred east-west, beyond the north edge (smaller Z), at the model's top level, and the arrow points north (tip furthest north)", () => {
    const b = boundsOf(box, 3), m = northMarkerSpec(b);
    expect(m.sprite.x).toBe(b.cx);
    expect(m.sprite.z).toBeLessThan(b.minZ);
    expect(m.arrow.tip.z).toBeLessThan(m.arrow.left.z);
    expect(m.arrow.tip.z).toBeLessThan(b.minZ); expect(m.arrow.left.z).toBeLessThan(b.minZ); expect(m.arrow.right.z).toBeLessThan(b.minZ);   // none of it overlaps the model
    expect(m.arrow.tip.y).toBe(b.maxY);                 // the model's TOP level, not the base plane: at the base the block hides it / the sign paints over the cut and fill
    expect(m.sprite.y).toBeGreaterThan(b.maxY);
    expect(m.arrow.tip.x).toBe(b.cx);
  });
  it("its size follows the model (not the Height stretch's vertical inflation of the box): legible at 1× and 5×", () => {
    const sizes = [1, 2, 3, 5].map((k) => northMarkerSpec(boundsOf(box, k)).size);
    for (const z of sizes) { expect(z).toBeGreaterThan(30); }
    // radius grows a little with the stretch (the box is taller) but the sign stays within a hair of the same legible size
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeLessThan(1.15);
    const b = boundsOf(box, 3); expect(near(northMarkerSpec(b).size, b.radius * MARKER_SIZE_K)).toBe(true);
  });
  it("a tiny model still gets a readable sign (floor)", () => {
    const tiny = boundsOf({ minX: 0, maxX: 10, minY: 0, maxY: 1, minZ: 0, maxZ: 10 }, 1);
    expect(northMarkerSpec(tiny).size).toBeGreaterThanOrEqual(8);
    const m = northMarkerSpec(boundsOf(box, 3));
    expect(m.reach).toBeGreaterThan(m.size);                     // the reach holds the whole sign, not just its gap
  });
  it("FRAMING: the camera backs off only as far as the sign needs (never in), by an amount that follows from the sign's own far point; a sign inside the fitted sphere changes nothing", () => {
    const b = boundsOf(box, 3), spec = northMarkerSpec(b);
    const need = Math.hypot(spec.size * 0.5, b.maxY + spec.reachUp - b.cy, b.cz - (b.minZ - spec.reach));
    const k = markerFramingFactor(b, spec);
    expect(k).toBeGreaterThanOrEqual(1);
    expect(near(k, Math.max(1, need / b.radius))).toBe(true);
    expect(k).toBeLessThan(1.5);                                                // a modest back-off, never a different picture
    expect(markerFramingFactor(b, { ...spec, reach: 0, reachUp: 0, size: 1 })).toBe(1);            // a sign inside the sphere: unchanged
    expect(markerFramingFactor(b, { ...spec, reach: b.radius * 3 })).toBeGreaterThan(1.5);           // one far outside it: pulled well back
  });
});
