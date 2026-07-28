/* NEW-2 / NEW-3 — wall-strip + side-parking drift, against the OWNER'S REAL PLAN.
 *
 * Tsakiris / Concept A (Supabase site smrjdgmlinea), Building 3 `e47duuwgj` with its two bottom-wall
 * corner bump-outs. Two defects the owner reported off the live plan:
 *
 *   NEW-2 — the end sidewalks should each span the extended side (building depth + the 60′ bump
 *     projection). They read 224 / 221 with one slid off centre, because a HOST RESIZE fell through
 *     to fitKid, which RESCALES the stored run (`alongDim = 2·alongHalf·ratio`) instead of
 *     recomputing it from the span rule. Building 2 (no such history) reads a clean 220 — the
 *     un-drifted baseline, so this is drift introduced by an operation, not a bad default.
 *   NEW-3 — the west side-parking field sat 5.32 ft out in bare ground while the east one was flush,
 *     because fitKid replays a `perpGap` captured at gesture start, stale the moment the sidewalk
 *     beside it is re-laid / added / deleted / widened.
 *
 * A clean synthetic building lays out correctly TODAY and would pass while the bug is still there,
 * so these run through the REAL fixture — the exact element set pulled from the owner's plan.
 *
 * The owner's amendment governs the split: the sidewalk span rule is ABSOLUTE, but a side-parking
 * field's ALONG-WALL position and run are user intent (he slid Building 3's east field himself to
 * get the curb return right where the fire lane ties in) and must survive untouched. Only the
 * perpendicular axis — the distance out from the wall — is derived. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createSiteModel } from "../src/workspaces/site-planner/lib/siteModel.js";
import { sidewalkSpanForBumps } from "../src/workspaces/site-planner/lib/dogEar.js";

const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/tsakiris-concept-a.json", import.meta.url), "utf8"));

const B3 = "e47duuwgj";                                  // Building 3, 445 × 150, rot 180
const BUMPS = ["e1454688yfsvff", "e1454689yfsvff"];      // both on the bottom wall, 55 × 60
const SW_EAST = "e48duuwgj", SW_WEST = "e50duuwgj";      // its two end sidewalks (5 ft thick)
const PK_EAST = "e52duuwgj", PK_WEST = "e59hzrjsn";      // its two side-parking fields (42 ft deep)
const B2 = "e36duuwgj", B2_SW = ["e43duuwgj", "e45duuwgj"]; // the un-drifted baseline building

const load = (els) => { const m = createSiteModel({ els }); return (id) => m.els.find((e) => e.id === id); };
const fresh = () => JSON.parse(JSON.stringify(FIXTURE.els));
const seed = () => load(fresh());

/* A wall-hugging child's run + its inner face, resolved on the host's local axes. Building 3 sits
 * at rot 180 and its parking rows at a quarter turn, so read the geometry the way the canvas does
 * rather than assuming w is the run. */
const onHost = (host, kid) => {
  const isVert = true;                                   // every child asserted here hugs an END wall
  const rel = ((((kid.rot || 0) - (host.rot || 0)) % 360) + 360) % 360;
  const cross = Math.min(Math.abs(rel - 90), Math.abs(rel - 270)) < 45;
  const depth = cross ? kid.h : kid.w, run = cross ? kid.w : kid.h;
  const r = ((-(host.rot || 0)) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = kid.cx - host.cx, dy = kid.cy - host.cy;
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  return { run, depth, alongShift: ly, perp: lx, innerFace: Math.abs(lx) - depth / 2, isVert };
};
/* The bare-ground (or overlap) distance between a side-parking field and the strip it should be
 * flush against — 0 is the only acceptable answer, on both ends. */
const gapBetween = (host, strip, park) => onHost(host, park).innerFace - (Math.abs(onHost(host, strip).perp) + onHost(host, strip).depth / 2);

describe("NEW-2 — the end sidewalks span exactly the extended side", () => {
  it("Building 2 (never drifted) is left EXACTLY as stored — the heal is idempotent", () => {
    const before = fresh(), by = load(before), b2 = by(B2);
    for (const id of B2_SW) {
      const stored = before.find((e) => e.id === id);
      // Not a byte-compare (ensureZ renormalises the stacking key) — the GEOMETRY must be untouched,
      // so a correct record can't churn a dirty flag / a cloud re-save on every load.
      expect({ ...by(id), z: 0 }).toEqual({ ...stored, z: 0 });
      expect(onHost(b2, by(id)).run).toBeCloseTo(b2.h, 6);  // 160 — the un-drifted baseline
    }
  });

  it("both of Building 3's end strips read building depth + the bump projection, centred on it", () => {
    const by = seed(), b = by(B3);
    const span = sidewalkSpanForBumps(b, "left", BUMPS.map((id) => ({ side: "bottom", sign: by(id).cx > b.cx ? -1 : 1, proj: 60 })));
    expect(span.run).toBe(b.h + 60);            // 150 + 60 = 210
    for (const id of [SW_EAST, SW_WEST]) {
      const g = onHost(b, by(id));
      expect(g.run).toBeCloseTo(b.h + 60, 6);
      expect(g.alongShift).toBeCloseTo(30, 6);  // both bumps are on the +Y end → the span shifts +30
      expect(g.innerFace).toBeCloseTo(b.w / 2, 6); // flush against the wall
    }
  });

  it("THE DRIFT: the stored record was off and the load heals it (east strip was 7.49 ft off centre)", () => {
    const stored = fresh().find((e) => e.id === SW_EAST);
    const by = seed(), healed = by(SW_EAST);
    expect(stored.cy).toBeCloseTo(338.19, 2);   // as saved — slid off the span centre
    expect(healed.cy).toBeCloseTo(330.7, 2);    // as the rule says
    expect(by(SW_WEST).cy).toBeCloseTo(healed.cy, 6); // and both ends agree with each other
  });

  it("deleting both bump-outs collapses the strips back to the bare building depth", () => {
    const by = load(fresh().filter((e) => !BUMPS.includes(e.id)));
    const b = by(B3);
    for (const id of [SW_EAST, SW_WEST]) {
      const g = onHost(b, by(id));
      expect(g.run).toBeCloseTo(b.h, 6);        // 150 — no phantom bump length left behind
      expect(g.alongShift).toBeCloseTo(0, 6);
    }
  });

  it("a bump resized to a non-default projection lengthens only ITS end wall", () => {
    const els = fresh();
    const deep = els.find((e) => e.id === BUMPS[0]);
    deep.h = 95; deep.dogEar = { ...deep.dogEar, along: 55, proj: 95 };  // east-end bump, 95 ft out
    const by = load(els), b = by(B3);
    expect(onHost(b, by(SW_EAST)).run).toBeCloseTo(b.h + 95, 6);
    expect(onHost(b, by(SW_WEST)).run).toBeCloseTo(b.h + 60, 6);
  });

  it("a host resize re-derives the run instead of scaling it (the missing branch)", () => {
    for (const h of [150, 200, 110]) {
      const els = fresh();
      els.find((e) => e.id === B3).h = h;
      const by = load(els), b = by(B3);
      for (const id of [SW_EAST, SW_WEST]) expect(onHost(b, by(id)).run).toBeCloseTo(h + 60, 6);
    }
  });

  it("holds through both quarter-turn rotations of the host", () => {
    for (const rot of [90, 270]) {
      const els = fresh();
      els.forEach((e) => { if (e.id === B3 || e.attachedTo === B3) e.rot = ((e.rot + (rot - 180)) % 360 + 360) % 360; });
      const by = load(els), b = by(B3);
      for (const id of [SW_EAST, SW_WEST]) {
        expect(onHost(b, by(id)).run).toBeCloseTo(b.h + 60, 6);
        expect(onHost(b, by(id)).innerFace).toBeCloseTo(b.w / 2, 6);
      }
    }
  });
});

describe("NEW-3 — side parking is flush perpendicular, untouched along the wall", () => {
  it("THE BUG: the west field's 5.32 ft of bare ground closes; the east one was already flush", () => {
    const stored = load2(fresh());
    expect(stored.west).toBeCloseTo(5.32, 2);      // as saved — a strip of dirt between the two
    expect(stored.east).toBeCloseTo(-0.48, 2);     // …while the other end overlapped its strip by 0.48
    expect(Math.abs(stored.west - stored.east)).toBeGreaterThan(5); // asymmetric → not a systematic offset
    const by = seed(), b = by(B3);
    expect(gapBetween(b, by(SW_WEST), by(PK_WEST))).toBeCloseTo(0, 6);
    expect(gapBetween(b, by(SW_EAST), by(PK_EAST))).toBeCloseTo(0, 6);
  });

  it("REGRESSION (owner amendment): the east field does not move ALONG the wall, ever", () => {
    const storedEast = fresh().find((e) => e.id === PK_EAST);
    const b0 = fresh().find((e) => e.id === B3);
    const want = onHost(b0, storedEast);           // its run + along-wall centre, as the owner left it
    // …through a host resize, a sidewalk width change, a sidewalk delete, and a bump-out delete.
    const cases = {
      "as stored": (els) => els,
      "host resized": (els) => { els.find((e) => e.id === B3).h = 210; return els; },
      "sidewalk widened": (els) => { els.find((e) => e.id === SW_EAST).w = 12; return els; },
      "sidewalk deleted": (els) => els.filter((e) => e.id !== SW_EAST),
      "bump-outs deleted": (els) => els.filter((e) => !BUMPS.includes(e.id)),
      "bump-out deepened": (els) => { const d = els.find((e) => e.id === BUMPS[0]); d.h = 95; d.dogEar = { ...d.dogEar, along: 55, proj: 95 }; return els; },
    };
    for (const [label, mutate] of Object.entries(cases)) {
      const by = load(mutate(fresh())), b = by(B3);
      const got = onHost(b, by(PK_EAST));
      expect(got.run, label).toBeCloseTo(want.run, 6);               // 150 — never re-lengthened
      expect(got.alongShift, label).toBeCloseTo(want.alongShift, 6); // never re-centred
      const strip = by(SW_EAST);
      expect(got.innerFace, label).toBeCloseTo(b.w / 2 + (strip ? onHost(b, strip).depth : 0), 6);
    }
  });

  it("a sidewalk DELETE pulls the parking back flush against the wall itself", () => {
    const by = load(fresh().filter((e) => e.id !== SW_WEST)), b = by(B3);
    expect(onHost(b, by(PK_WEST)).innerFace).toBeCloseTo(b.w / 2, 6);  // no 5 ft ghost of the old strip
  });

  it("a sidewalk WIDTH change re-flushes the parking against the new thickness", () => {
    for (const t of [5, 8, 14]) {
      const els = fresh();
      els.find((e) => e.id === SW_WEST).w = t;
      const by = load(els), b = by(B3);
      expect(gapBetween(b, by(SW_WEST), by(PK_WEST))).toBeCloseTo(0, 6);
      expect(onHost(b, by(PK_WEST)).innerFace).toBeCloseTo(b.w / 2 + t, 6);
    }
  });

  it("both ends stay flush at both quarter-turn rotations and through a host resize", () => {
    for (const rot of [90, 180, 270]) {
      for (const h of [150, 240]) {
        const els = fresh();
        els.forEach((e) => { if (e.id === B3 || e.attachedTo === B3) e.rot = ((e.rot + (rot - 180)) % 360 + 360) % 360; });
        els.find((e) => e.id === B3).h = h;
        const by = load(els), b = by(B3);
        expect(gapBetween(b, by(SW_WEST), by(PK_WEST))).toBeCloseTo(0, 6);
        expect(gapBetween(b, by(SW_EAST), by(PK_EAST))).toBeCloseTo(0, 6);
      }
    }
  });

  it("the heal is idempotent — a second load changes nothing", () => {
    const once = createSiteModel({ els: fresh() }).els;
    const twice = createSiteModel({ els: once }).els;
    for (let i = 0; i < once.length; i++) expect(twice[i]).toBe(once[i]);
  });
});

/* The stored (pre-heal) gap on each end, read straight off the fixture — what the owner sees today. */
function load2(els) {
  const b = els.find((e) => e.id === B3);
  const g = (swId, pkId) => gapBetween(b, els.find((e) => e.id === swId), els.find((e) => e.id === pkId));
  return { west: g(SW_WEST, PK_WEST), east: g(SW_EAST, PK_EAST) };
}
