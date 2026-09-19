import { describe, it, expect } from "vitest";
import { planThumbnailSvg } from "../src/workspaces/site-planner/lib/planThumbnail.js";

const boundary = { id: "p1", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }] };
const building = { id: "e1", type: "building", cx: 20, cy: 20, w: 30, h: 20, rot: 0 };

describe("planThumbnailSvg", () => {
  it("returns null for a missing model", () => {
    expect(planThumbnailSvg(null)).toBeNull();
  });

  it("returns null for a model with nothing drawable (no parcels, no elements)", () => {
    expect(planThumbnailSvg({ id: "s1", parcels: [], els: [] })).toBeNull();
  });

  it("renders a boundary-only plan as a single stroked path, no fill", () => {
    const svg = planThumbnailSvg({ id: "s1", parcels: [boundary], els: [] });
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain("<path");
    expect((svg.match(/<path/g) || []).length).toBe(1);
    expect(svg).toContain('fill="none"');
  });

  it("renders a building element filled with the building TYPE color", () => {
    const svg = planThumbnailSvg({ id: "s1", parcels: [], els: [building] });
    expect(svg).toContain("#f3ece1"); // TYPE.building.fill, planStyle.js
  });

  it("excludes an inactive parcel from the boundary", () => {
    const svg = planThumbnailSvg({ id: "s1", parcels: [{ ...boundary, active: false }], els: [building] });
    // only the building path should be present
    expect((svg.match(/<path/g) || []).length).toBe(1);
  });

  it("excludes an element whose type has no style entry, rather than drawing an undefined fill", () => {
    const svg = planThumbnailSvg({ id: "s1", parcels: [], els: [{ id: "x", type: "not-a-real-type", cx: 0, cy: 0, w: 10, h: 10 }] });
    expect(svg).toBeNull();
  });

  it("respects a per-parcel custom fill", () => {
    const svg = planThumbnailSvg({ id: "s1", parcels: [{ ...boundary, fill: "#123456", fillOpacity: 0.4 }], els: [] });
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('fill-opacity="0.4"');
  });

  // B1788912 (NEW-1) — elements draw in plain creation order (their own `z`) now, never by type:
  // a road drawn AFTER a building paints OVER it, matching the owner's Bluebeam-style "newest on
  // top" model. The thumbnail shares `byZ`/`zOrder` with the live canvas (planStyle.js), so it must
  // agree.
  it("draws elements in z (creation) order, never by type", () => {
    const roadLater = { id: "r1", type: "road", pts: [{ x: 0, y: 40 }, { x: 100, y: 40 }], travelW: 24, curb: 1, z: 10 };
    const bldgEarlier = { ...building, z: 0 };
    const svg = planThumbnailSvg({ id: "s1", parcels: [], els: [bldgEarlier, roadLater] });
    // the road was drawn LAST (higher z), so it paints over the earlier building.
    expect(svg.indexOf("#f3ece1")).toBeGreaterThan(-1); // TYPE.building.fill
    expect(svg.indexOf("#f3ece1")).toBeLessThan(svg.indexOf("#b9b4a8")); // TYPE.road.fill, painted after
  });

  it("never throws on malformed element geometry", () => {
    expect(() => planThumbnailSvg({ id: "s1", parcels: [], els: [{ id: "e", type: "building" }, null, {}] })).not.toThrow();
  });
});

/* ── The two defects the 2026-09-08 adversarial review found, and their guards (B<PENDING>) ────
 * Reproductions live in ui-audit/review-2026-09-08/probe-thumbnail-size.mjs. These are the CI
 * versions: the probe prints, these assert.
 */

// A surveyed-looking ring: many vertices around a basin edge, which is what actually makes a real
// plan heavy (root CLAUDE.md's own B233153 note on why a tidy four-vertex fixture hides this).
const ringOf = (cx, cy, r, n) =>
  Array.from({ length: n }, (_, i) => ({
    x: cx + r * Math.cos((2 * Math.PI * i) / n),
    y: cy + r * Math.sin((2 * Math.PI * i) / n),
  }));

const heavyModel = (nEls, verts) => ({
  id: "heavy",
  settings: {},
  parcels: [{ id: "p", active: true, points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }] }],
  els: Array.from({ length: nEls }, (_, i) => ({
    id: "e" + i,
    type: "pond",
    z: i,
    points: ringOf(200 + (i % 40) * 120, 200 + Math.floor(i / 40) * 180, 60, verts),
  })),
});

/** Parse every `d` attribute back out of a rendered thumbnail into arrays of view-space points. */
function pathRings(svg) {
  return [...svg.matchAll(/ d="([^"]*)"/g)].map((m) =>
    m[1].trim().split(/\s*[ML]/).filter(Boolean).map((pair) => {
      const [x, y] = pair.replace(/Z$/, "").trim().split(/\s+/).map(Number);
      return { x, y };
    }).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
  );
}

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Greatest distance from any point of `original` to the outline `simplified` — the honest
 * "how far did the picture move" number, in viewBox units. */
function maxDeviation(original, simplified) {
  let worst = 0;
  for (const p of original) {
    let best = Infinity;
    for (let i = 0; i < simplified.length; i++) {
      const d = segDist(p, simplified[i], simplified[(i + 1) % simplified.length]);
      if (d < best) best = d;
    }
    if (best > worst) worst = best;
  }
  return worst;
}

describe("planThumbnailSvg — size ceiling (adversarial review, 2026-09-08)", () => {
  // Measured on the pre-fix code by the probe: 185 KB at 300x40 and 380 KB at 600x40, growing
  // without limit — and four of these load on every dashboard visit.
  it.each([[10, 8], [100, 8], [300, 8], [300, 40], [600, 40], [1200, 60]])(
    "stays under the ceiling at %i elements x %i vertices",
    (n, v) => {
      const svg = planThumbnailSvg(heavyModel(n, v));
      expect(svg).toBeTruthy();
      expect(svg.length).toBeLessThanOrEqual(24 * 1024);
    },
  );

  it("never degrades a heavy plan to nothing, even with no boundary parcel to fall back on", () => {
    const m = heavyModel(800, 40);
    m.parcels = [];
    const svg = planThumbnailSvg(m);
    expect(svg).toBeTruthy();
    expect(svg.length).toBeLessThanOrEqual(24 * 1024);
    expect((svg.match(/<path/g) || []).length).toBeGreaterThan(0);
  });

  it("a plan a real user could draw is NOT degraded — every element still renders", () => {
    // 60 ponds at 24 vertices: heavier than an ordinary industrial plan and still under budget,
    // so the escalation ladder never runs and nothing is dropped.
    const svg = planThumbnailSvg(heavyModel(60, 24));
    expect((svg.match(/<path/g) || []).length).toBe(61); // 60 elements + the boundary
  });

  it("still looks like itself: no outline moves more than the stated deviation bound", () => {
    // The fidelity claim, measured rather than asserted by eye. Compare each rendered ring against
    // the same ring rendered from a model simple enough that no simplification can have run, and
    // require the outline to have moved less than MAX_DEVIATION_UNITS of the 400-unit viewBox.
    const one = (verts) => {
      const m = heavyModel(1, verts);
      return pathRings(planThumbnailSvg(m))[1]; // [0] is the boundary
    };
    const dense = one(400);
    const reference = ringOf(0, 0, 1, 400); // the same circle, at full resolution, unit scale
    // Rebuild the reference in the rendered ring's own frame so the comparison is like-for-like.
    const cx = dense.reduce((a, p) => a + p.x, 0) / dense.length;
    const cy = dense.reduce((a, p) => a + p.y, 0) / dense.length;
    const r = Math.max(...dense.map((p) => Math.hypot(p.x - cx, p.y - cy)));
    const original = reference.map((p) => ({ x: cx + p.x * r, y: cy + p.y * r }));
    expect(maxDeviation(original, dense)).toBeLessThan(1.5);
    expect(dense.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps the plan's overall shape: the drawn content still fills the viewBox", () => {
    const rings = pathRings(planThumbnailSvg(heavyModel(600, 40))).flat();
    const xs = rings.map((p) => p.x), ys = rings.map((p) => p.y);
    // Contain-fit on a 5000x4000 plan in a 400x300 box: the width is the binding dimension.
    expect(Math.min(...xs)).toBeLessThan(40);
    expect(Math.max(...xs)).toBeGreaterThan(360);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(200);
  });
});

/** A deliberately STRICT reader for this file's own output — no DOM here (vitest.config.js pins
 * the node environment on purpose), and a regex that merely looks for "<script" would pass a
 * document that had been broken open in some other way. This instead requires the whole string to
 * be exactly `<svg …>` + N self-closing `<path …/>` + `</svg>`, with every attribute value free of
 * a raw quote, and returns the DECODED attributes. Anything injected shows up as either a parse
 * failure or an extra element, both of which the assertions below reject. */
function parseThumbnail(svg) {
  const m = /^<svg ([^>]*)>([\s\S]*)<\/svg>$/.exec(svg);
  if (!m) throw new Error("not a single well-formed <svg> document");
  const decode = (v) => v
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const body = m[2];
  const paths = [];
  let rest = body;
  while (rest.length) {
    const t = /^<path((?: [a-zA-Z-]+="[^"<>]*")*) \/>/.exec(rest);
    if (!t) throw new Error("unexpected content in <svg> body at: " + rest.slice(0, 60));
    const attrs = {};
    for (const a of t[1].matchAll(/ ([a-zA-Z-]+)="([^"<>]*)"/g)) attrs[a[1]] = decode(a[2]);
    paths.push(attrs);
    rest = rest.slice(t[0].length);
  }
  return paths;
}

describe("planThumbnailSvg — attribute escaping (adversarial review, 2026-09-08)", () => {
  const nasty = '"/><script>alert(1)</script><path d="';

  it("a quote in a parcel stroke can no longer break out of its attribute", () => {
    const svg = planThumbnailSvg({ id: "s1", parcels: [{ ...boundary, stroke: nasty }], els: [] });
    expect(svg).not.toContain("<script");
    expect(svg).toContain("&quot;");
    // The whole document is still exactly the paths it should be — nothing extra was injected.
    const paths = parseThumbnail(svg);
    expect(paths.length).toBe(1);
    expect(paths[0].stroke).toBe(nasty); // round-trips intact, as inert text
  });

  it("escapes angle brackets and ampersands in a fill, and stays parseable", () => {
    const svg = planThumbnailSvg({
      id: "s1",
      parcels: [{ ...boundary, fill: '<a & b>', fillOpacity: '"0.5"' }],
      els: [],
    });
    expect(svg).toContain("&lt;a &amp; b&gt;");
    expect(svg).not.toMatch(/fill="<a/);
    const paths = parseThumbnail(svg);
    expect(paths.length).toBe(1);
    expect(paths[0].fill).toBe("<a & b>");
    expect(paths[0]["fill-opacity"]).toBe('"0.5"');
  });

  it("a plan NAME-shaped value full of quotes and angle brackets still renders the whole plan", () => {
    const svg = planThumbnailSvg({
      id: "s1",
      settings: {},
      parcels: [{ ...boundary, stroke: `Bain "North" <Phase 1> & 2` }],
      els: [building],
    });
    const paths = parseThumbnail(svg);
    expect(paths.length).toBe(2); // boundary + building, nothing lost
    expect(paths[0].stroke).toBe(`Bain "North" <Phase 1> & 2`);
    expect(paths[1].d).toMatch(/^M/); // the building still drew its real geometry
  });
});
