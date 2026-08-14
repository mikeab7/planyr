/* ⛔ NEW-9 (B472049) — AREA CONSERVATION IS THE ACCEPTANCE TEST, AND IT IS MEASURED ACROSS THE SET
 * THAT IS ACTIVE **AND NOT DELETED**.
 *
 * The reported case, Bain / Concept A - Quiddity DIA (`smsqi16s9ej4`), 2026-08-13 18:59:46:
 *
 *     e1455071mkspvo  active=false  deleted_at=null                        105.122 ac  parent
 *     e1455075mkspvo  active=true   deleted_at=null                        104.475 ac  remainder
 *     e1455076mkspvo  active=TRUE   deleted_at=18:59:49.847+00               0.647 ac  the notch
 *
 * ⛔ THE COLUMN THAT DECIDES WHETHER THIS SUITE IS WORTH ANYTHING IS `deleted_at`. Read `active`
 * alone and the sum is 104.475 + 0.647 = 105.122 — balanced, green, and the piece has silently
 * vanished from the plan. Read `!deleted` alone and the superseded parent joins in and the sum
 * DOUBLES. The invariant is only true over both halves, and the first case below is written to
 * FAIL under either single-column reading.
 *
 * ⛔ WHAT THIS SUITE DOES NOT CLAIM. It does not say the tool deleted the piece. The 3.66 s gap
 * fits both "the tool dropped its own output" and "the user removed a sliver they did not want",
 * one account wrote both rows, and there is no operation id to separate them. That un-answerability
 * is the argument for the operation envelope, and it is asserted here as an explicit `unattributed`
 * verdict rather than papered over with a guess.
 */
import { describe, it, expect } from "vitest";
import {
  ringAreaSqft, ringAreaAcres, SQFT_PER_ACRE, isLiveActive, liveActive,
  splitConservation, overlappingPairs, splitOutputsSurvived, auditSplit,
  AREA_TOLERANCE_SQFT, SPLIT_SURVIVAL_WINDOW_MS,
} from "../src/workspaces/site-planner/lib/splitIntegrity.js";
import { splitPolygonByCut } from "../src/workspaces/site-planner/lib/polygonSplit.js";

/* A rectangle whose area is exactly the owner's parent, so the numbers below read as his do.
 * 105.122 ac = 4,579,114.32 sqft. A 2400 ft × 1908.0 ft rectangle is 4,579,200 — close enough that
 * the fixture's own arithmetic is exact and the acreages read at his scale. */
const W = 2400, H = 1908;
const RECT = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
const RECT_SQFT = W * H;

const pcl = (id, points, over = {}) => ({ id, points, active: true, ...over });

describe("NEW-9 · the live set is ACTIVE and NOT DELETED — both halves, always", () => {
  it("isLiveActive reads both columns", () => {
    expect(isLiveActive({ active: true })).toBe(true);
    expect(isLiveActive({ active: false })).toBe(false);
    expect(isLiveActive({ active: true, deletedAt: 12345 })).toBe(false);
    expect(isLiveActive({ active: true, deleted_at: "2026-08-13T18:59:49Z" })).toBe(false);
    expect(isLiveActive({})).toBe(true);          // absent `active` means active (the model default)
    expect(isLiveActive(null)).toBe(false);
  });

  /* ⛔ THE REPORTED CASE, AND THE ONE THAT PROVES THE SUITE CAN FAIL. */
  it("catches the 2026-08-13 notch split: 0.647 ac short", () => {
    // his three rows, at his acreages
    const parent = 105.122 * SQFT_PER_ACRE;
    const parentRing = [{ x: 0, y: 0 }, { x: parent / 1000, y: 0 }, { x: parent / 1000, y: 1000 }, { x: 0, y: 1000 }];
    const remainder = 104.475 / 105.122;   // fraction of the parent
    const notch = 0.647 / 105.122;
    const slice = (frac, over) => pcl(`p${frac}`, [
      { x: 0, y: 0 }, { x: (parent * frac) / 1000, y: 0 }, { x: (parent * frac) / 1000, y: 1000 }, { x: 0, y: 1000 },
    ], over);

    const resulting = [
      pcl("e1455071mkspvo", parentRing, { active: false }),                       // superseded parent
      slice(remainder, { id: "e1455075mkspvo" }),                                 // remainder, live
      slice(notch, { active: true, deleted_at: "2026-08-13T18:59:49.847Z" }),     // the notch, DELETED
    ];
    const v = splitConservation({ parentRing, resulting });
    expect(v.ok).toBe(false);
    expect(v.direction).toBe("shortfall");
    expect(Math.abs(v.residualAcres)).toBeCloseTo(0.647, 2);
    expect(v.message).toMatch(/lost 0\.6/);
  });

  it("⛔ MUTATION CHECK — reading `active` ALONE passes the same data, which is the bug", () => {
    const parentRing = RECT;
    const resulting = [
      pcl("parent", RECT, { active: false }),
      pcl("remainder", [{ x: 0, y: 0 }, { x: W * 0.99, y: 0 }, { x: W * 0.99, y: H }, { x: 0, y: H }]),
      pcl("piece", [{ x: W * 0.99, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: W * 0.99, y: H }],
        { deleted_at: "2026-08-13T18:59:49.847Z" }),
    ];
    // the WRONG rule (active only) balances…
    const activeOnly = resulting.filter((p) => p.active !== false)
      .reduce((s, p) => s + ringAreaSqft(p.points), 0);
    expect(Math.abs(activeOnly - RECT_SQFT)).toBeLessThanOrEqual(AREA_TOLERANCE_SQFT);
    // …and the SHIPPED rule catches it
    expect(splitConservation({ parentRing, resulting }).ok).toBe(false);
  });

  it("⛔ MUTATION CHECK — reading `!deleted` ALONE double-counts the superseded parent", () => {
    const resulting = [
      pcl("parent", RECT, { active: false }),
      pcl("a", [{ x: 0, y: 0 }, { x: W / 2, y: 0 }, { x: W / 2, y: H }, { x: 0, y: H }]),
      pcl("b", [{ x: W / 2, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: W / 2, y: H }]),
    ];
    const notDeletedOnly = resulting.filter((p) => !p.deleted_at)
      .reduce((s, p) => s + ringAreaSqft(p.points), 0);
    expect(notDeletedOnly).toBeCloseTo(RECT_SQFT * 2, 6);        // the wrong rule doubles
    expect(splitConservation({ parentRing: RECT, resulting }).ok).toBe(true);   // the shipped rule is fine
  });

  it("a clean two-piece split balances to zero residual", () => {
    const resulting = [
      pcl("parent", RECT, { active: false }),
      pcl("a", [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: H }, { x: 0, y: H }]),
      pcl("b", [{ x: 900, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 900, y: H }]),
    ];
    const v = splitConservation({ parentRing: RECT, resulting });
    expect(v.ok).toBe(true);
    expect(v.residualSqft).toBeCloseTo(0, 6);
    expect(v.direction).toBe("balanced");
    expect(v.liveCount).toBe(2);
  });
});

describe("NEW-9 · a split's own outputs must survive its operation", () => {
  const SPLIT_AT = Date.parse("2026-08-13T18:59:46.182Z");

  it("flags the reported 3.66-second casualty", () => {
    const v = splitOutputsSurvived({
      emittedIds: ["e1455075mkspvo", "e1455076mkspvo"],
      rows: [
        { id: "e1455075mkspvo", deleted_at: null },
        { id: "e1455076mkspvo", deleted_at: "2026-08-13T18:59:49.847Z" },
      ],
      splitAtMs: SPLIT_AT,
    });
    expect(v.ok).toBe(false);
    expect(v.casualties).toHaveLength(1);
    expect(v.casualties[0].id).toBe("e1455076mkspvo");
    expect(v.casualties[0].gapMs).toBeCloseTo(3665, -2);        // the reported 3.66 s
  });

  it("⛔ NAMES NO CULPRIT — the rows cannot say, and the message says so", () => {
    const v = splitOutputsSurvived({
      emittedIds: ["p1"], rows: [{ id: "p1", deleted_at: "2026-08-13T18:59:49.847Z" }], splitAtMs: SPLIT_AT,
    });
    expect(v.message).toMatch(/cannot be told from the rows/);
    expect(v.message).not.toMatch(/the tool deleted|the user deleted|Michael/);
  });

  it("a deletion well AFTER the window is an ordinary later edit, not this check's business", () => {
    const v = splitOutputsSurvived({
      emittedIds: ["p1"],
      rows: [{ id: "p1", deleted_at: new Date(SPLIT_AT + SPLIT_SURVIVAL_WINDOW_MS + 60_000).toISOString() }],
      splitAtMs: SPLIT_AT,
    });
    expect(v.ok).toBe(true);
  });

  it("a piece that never reached the database is a casualty too", () => {
    const v = splitOutputsSurvived({ emittedIds: ["p1", "p2"], rows: [{ id: "p1" }], splitAtMs: SPLIT_AT });
    expect(v.casualties.map((c) => c.reason)).toEqual(["never-persisted"]);
  });

  it("both surviving is the ordinary case", () => {
    expect(splitOutputsSurvived({
      emittedIds: ["a", "b"], rows: [{ id: "a" }, { id: "b" }], splitAtMs: SPLIT_AT,
    }).ok).toBe(true);
  });
});

describe("NEW-9 · overlap screen", () => {
  it("flags the near-identical pair the report describes", () => {
    const pairs = overlappingPairs([
      pcl("remainder", [{ x: 0, y: 0 }, { x: W * 0.994, y: 0 }, { x: W * 0.994, y: H }, { x: 0, y: H }]),
      pcl("parentCopy", RECT),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].fractionOfSmaller).toBeGreaterThan(0.9);
  });

  it("does not flag a clean edge-to-edge division", () => {
    expect(overlappingPairs([
      pcl("a", [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: H }, { x: 0, y: H }]),
      pcl("b", [{ x: 900, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 900, y: H }]),
    ])).toEqual([]);
  });

  it("ignores parcels that are not live — a superseded parent is not an overlap", () => {
    expect(overlappingPairs([
      pcl("parent", RECT, { active: false }),
      pcl("remainder", [{ x: 0, y: 0 }, { x: W * 0.994, y: 0 }, { x: W * 0.994, y: H }, { x: 0, y: H }]),
    ])).toEqual([]);
  });
});

/* ── The cut topologies, driven through the REAL engine ───────────────────────────────────────
 *
 * ⛔ THE NOTCH IS THE ONE IN PRODUCTION TODAY AND THE ONE WITH NO COVERAGE. The discriminator in
 * the report: the working split's cut chain enters on one edge and leaves a DIFFERENT edge (a
 * through-cut, two halves); the reported one enters and leaves the SAME edge (a notch). Every
 * topology below is asserted for area conservation over the pieces the engine actually returns. */
describe("NEW-9 · cut topologies, through the real engine", () => {
  const conserves = (ring, cut) => {
    const res = splitPolygonByCut(ring, cut);
    expect(res.ok, res.message || "engine refused the cut").toBe(true);
    const sum = res.pieces.reduce((s, p) => s + ringAreaSqft(p.ring), 0);
    const sliverSqft = res.slivers ? res.slivers.area : 0;
    // The engine may legitimately drop a scrap; it REPORTS it, so conservation is pieces + scraps.
    expect(Math.abs(sum + sliverSqft - ringAreaSqft(ring))).toBeLessThanOrEqual(Math.max(AREA_TOLERANCE_SQFT, ringAreaSqft(ring) * 1e-9));
    return res;
  };

  it("through-cut: edge A to edge B — two halves (the path that already works)", () => {
    const res = conserves(RECT, [{ x: 900, y: -50 }, { x: 900, y: H + 50 }]);
    expect(res.pieces).toHaveLength(2);
  });

  it("⛔ NOTCH: both endpoints on the SAME edge — the reported case", () => {
    // in and out through the western edge (x = 0), exactly the reported shape
    const res = conserves(RECT, [{ x: -50, y: 400 }, { x: 300, y: 500 }, { x: 300, y: 900 }, { x: -50, y: 1000 }]);
    expect(res.pieces).toHaveLength(2);
    const areas = res.pieces.map((p) => ringAreaSqft(p.ring)).sort((a, b) => a - b);
    expect(areas[0]).toBeGreaterThan(0);                 // the notch is real, not a scrap
    expect(areas[1]).toBeGreaterThan(areas[0]);          // …and much smaller than the remainder
  });

  it("corner clip: crosses two ADJACENT edges", () => {
    const res = conserves(RECT, [{ x: -50, y: 300 }, { x: 300, y: -50 }]);
    expect(res.pieces).toHaveLength(2);
  });

  it("multi-vertex curved chain", () => {
    const chain = [{ x: -50, y: 500 }];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      chain.push({ x: t * W, y: 500 + Math.sin(t * Math.PI) * 350 });
    }
    chain.push({ x: W + 50, y: 500 });
    const res = conserves(RECT, chain);
    expect(res.pieces.length).toBeGreaterThanOrEqual(2);
  });

  it("endpoints landing exactly ON existing vertices", () => {
    const res = conserves(RECT, [{ x: 0, y: 0 }, { x: W, y: H }]);
    expect(res.pieces).toHaveLength(2);
    const areas = res.pieces.map((p) => ringAreaSqft(p.ring));
    for (const a of areas) expect(a).toBeCloseTo(RECT_SQFT / 2, 3);   // the diagonal halves it
  });

  it("⛔ the notch's own pieces, carried through the LIVE-ACTIVE invariant, balance", () => {
    const res = splitPolygonByCut(RECT, [{ x: -50, y: 400 }, { x: 300, y: 500 }, { x: 300, y: 900 }, { x: -50, y: 1000 }]);
    const resulting = [
      pcl("parent", RECT, { active: false }),
      ...res.pieces.map((p, i) => pcl(`piece${i}`, p.ring)),
    ];
    expect(splitConservation({ parentRing: RECT, resulting }).ok).toBe(true);
    // …and if the smaller piece is soft-deleted, the invariant catches it — the reported outcome
    const smallest = resulting.slice(1).sort((a, b) => ringAreaSqft(a.points) - ringAreaSqft(b.points))[0];
    smallest.deleted_at = "2026-08-13T18:59:49.847Z";
    const v = splitConservation({ parentRing: RECT, resulting });
    expect(v.ok).toBe(false);
    expect(v.direction).toBe("shortfall");
  });
});

describe("NEW-9 · auditSplit ties the three together", () => {
  it("is ok on a clean split and names both faults on the reported one", () => {
    const clean = auditSplit({
      parentRing: RECT,
      resulting: [
        pcl("parent", RECT, { active: false }),
        pcl("a", [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: H }, { x: 0, y: H }]),
        pcl("b", [{ x: 900, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 900, y: H }]),
      ],
      emittedIds: ["a", "b"], rows: [{ id: "a" }, { id: "b" }], splitAtMs: 1,
    });
    expect(clean.ok).toBe(true);
    expect(clean.messages).toEqual([]);

    const bad = auditSplit({
      parentRing: RECT,
      resulting: [
        pcl("parent", RECT, { active: false }),
        pcl("a", [{ x: 0, y: 0 }, { x: W * 0.994, y: 0 }, { x: W * 0.994, y: H }, { x: 0, y: H }]),
        pcl("b", [{ x: W * 0.994, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: W * 0.994, y: H }],
          { deleted_at: new Date(3666).toISOString() }),
      ],
      emittedIds: ["a", "b"],
      rows: [{ id: "a" }, { id: "b", deleted_at: new Date(3666).toISOString() }],
      splitAtMs: 1,
    });
    expect(bad.ok).toBe(false);
    /* THREE faults, not two: conservation (land vanished), OUTLINE (the union no longer reproduces
     * the parent — the owner's own argument, now an assertion), and survival (a piece did not last
     * the operation). The outline check is the one that would catch a cut balancing its books while
     * leaving a gap, which area conservation alone cannot see. */
    expect(bad.messages).toHaveLength(3);
    expect(bad.conservation.ok).toBe(false);
    expect(bad.outline.ok).toBe(false);
    expect(bad.survival.ok).toBe(false);
  });
});
