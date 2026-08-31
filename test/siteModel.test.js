import { describe, it, expect } from "vitest";
import {
  createSiteModel, migrate, SITE_MODEL_VERSION, STATUSES,
  statusOf, parcelsOf, activeParcelsOf, utilitiesOf, annotationsOf,
  constraintsOf, setbacksOf, developableArea, parcelDrawingsOf,
  buildingNumbers, isBuilding, roadTravelWidth,
  parcelChildrenMap, parcelDescendants, parcelAncestors, lineageConflicts,
  parcelDisplayInfo, parcelOutline, parcelSplitNames,
} from "../src/workspaces/site-planner/lib/siteModel.js";

describe("Site Model — schema, lifecycle status, selectors", () => {
  it("createSiteModel stamps the current version and safe empty defaults", () => {
    const m = createSiteModel();
    expect(m.schemaVersion).toBe(SITE_MODEL_VERSION);
    expect(m.parcels).toEqual([]);
    expect(m.els).toEqual([]);
    expect(m.markups).toEqual([]);
    expect(m.elevation).toEqual({ crossSections: [] });
    expect(m.constraints).toEqual({ liveLayers: [] });
  });

  it("accepts the legacy `elements` field as `els` (lossless back-compat + additive v12 z)", () => {
    // The element is carried over verbatim; createSiteModel additively assigns the v12 `z` (B671).
    expect(createSiteModel({ elements: [{ id: "a" }] }).els).toEqual([{ id: "a", z: 0 }]);
  });

  // B67 parcel-attached drawings: additive field, coerced + filterable by parcel.
  it("parcelDrawings: defaults to [], is coerced from non-arrays, and parcelDrawingsOf filters by parcel", () => {
    expect(createSiteModel().parcelDrawings).toEqual([]);
    expect(createSiteModel({ parcelDrawings: "bad" }).parcelDrawings).toEqual([]); // type-confusion guard
    const m = createSiteModel({ parcelDrawings: [{ id: "d1", parcelId: "p1" }, { id: "d2", parcelId: "p2" }] });
    expect(parcelDrawingsOf(m).length).toBe(2);
    expect(parcelDrawingsOf(m, "p1").map((d) => d.id)).toEqual(["d1"]);
  });

  // schema v9 — cross-module schedule link hint (additive, mirror of the schedule record).
  it("scheduleProjectId/Name: defaults to null and survives a create→migrate round-trip", () => {
    const fresh = createSiteModel();
    expect(fresh.scheduleProjectId).toBeNull();
    expect(fresh.scheduleProjectName).toBeNull();
    const linked = createSiteModel({ id: "p1", scheduleProjectId: 7, scheduleProjectName: "Pappadoupolos" });
    expect(linked.scheduleProjectId).toBe(7);
    expect(linked.scheduleProjectName).toBe("Pappadoupolos");
    // migrate is idempotent + lossless: the hint isn't dropped on re-normalize
    const round = migrate(linked);
    expect(round.scheduleProjectId).toBe(7);
    expect(round.scheduleProjectName).toBe("Pappadoupolos");
  });

  // B7/B8 lifecycle status defaulting — single source of truth, easy to regress.
  it("status: a brand-new record => pursuit; a pre-feature (older version) record => active", () => {
    expect(createSiteModel().status).toBe("pursuit");
    expect(createSiteModel({ schemaVersion: 1 }).status).toBe("active");
  });

  it("status: an explicit valid status is honored; a bogus value falls back", () => {
    expect(STATUSES).toContain("complete");
    expect(createSiteModel({ status: "complete" }).status).toBe("complete");
    expect(createSiteModel({ status: "nonsense" }).status).toBe("pursuit");
  });

  it("migrate is idempotent (normalize twice == once, ignoring the timestamp)", () => {
    const once = migrate({ id: "s1", parcels: [{ id: "p" }], status: "onhold" });
    const twice = migrate(once);
    const strip = (o) => ({ ...o, updatedAt: 0 });
    expect(strip(twice)).toEqual(strip(once));
  });

  it("selectors classify the flat markups array by meaning", () => {
    const m = createSiteModel({
      parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], setbacks: { front: 25 } }],
      markups: [
        { kind: "encumbrance", id: "e1" }, // title easement => constraint
        { kind: "utilRoute", id: "u1" },   // service route => utility
        { kind: "rect", id: "a1" },        // neutral annotation
      ],
      measures: [{ id: "m1" }],
      callouts: [{ id: "c1" }],
    });
    expect(statusOf(m)).toBe("pursuit");
    expect(parcelsOf(m)).toHaveLength(1);
    expect(utilitiesOf(m).map((x) => x.id)).toEqual(["u1"]);
    expect(constraintsOf(m).easements.map((x) => x.id)).toEqual(["e1"]);
    expect(annotationsOf(m).markups.map((x) => x.id)).toEqual(["a1"]);
    expect(annotationsOf(m).measures).toHaveLength(1);
    expect(annotationsOf(m).callouts).toHaveLength(1);
    expect(setbacksOf(m)).toEqual([{ id: "p1", setbacks: { front: 25 } }]);
  });

  it("developableArea is still the reserved stub (returns null, not a fabricated number)", () => {
    expect(developableArea(createSiteModel()).available).toBeNull();
  });

  // B100: only ACTIVE parcels drive the calcs; a missing `active` means active (back-compat),
  // so existing sites count every parcel until one is explicitly toggled off.
  it("activeParcelsOf excludes only explicitly-inactive parcels", () => {
    const tri = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]; // parcels are geometry — the funnel drops points-less ones
    const m = createSiteModel({ parcels: [{ id: "a", points: tri }, { id: "b", points: tri, active: true }, { id: "c", points: tri, active: false }] });
    expect(parcelsOf(m).map((p) => p.id)).toEqual(["a", "b", "c"]); // all retained on the model
    expect(activeParcelsOf(m).map((p) => p.id)).toEqual(["a", "b"]); // c (active:false) excluded
  });

  // Type-confusion guard: a tampered/legacy/bad-sync record with a non-array collection must NOT
  // survive into the model (it would throw on .reduce/.map downstream and blank the whole app).
  it("coerces non-array collection fields to [] instead of keeping garbage", () => {
    const m = createSiteModel({ parcels: "oops", els: 42, markups: { bad: 1 }, measures: null, callouts: undefined, settings: "x" });
    expect(m.parcels).toEqual([]);
    expect(m.els).toEqual([]);
    expect(m.markups).toEqual([]);
    expect(m.measures).toEqual([]);
    expect(m.callouts).toEqual([]);
    expect(m.settings).toEqual({});
    // and the downstream that crashed (siteSqft = parcels.reduce(...)) is now safe:
    expect(() => m.parcels.reduce((s) => s, 0)).not.toThrow();
  });

  // B122 — buildings carry a sequential display number by placement order, derived from
  // list position (never stored). Deleting one renumbers the rest 1…N while every stable
  // id is untouched; dog-ear / bump-out pieces (type "building" + `dogEar`) are excluded.
  it("buildingNumbers: contiguous 1…N by placement order, excludes dog-ears, renumbers on delete", () => {
    const els = [
      { id: "e1", type: "building" },
      { id: "e2", type: "parking" },
      { id: "e3", type: "building" },
      { id: "e9", type: "building", dogEar: { side: "n", sign: 1 }, attachedTo: "e1" }, // bump-out, not a building
      { id: "e4", type: "building" },
    ];
    expect(isBuilding(els[0])).toBe(true);
    expect(isBuilding(els[3])).toBe(false); // dog-ear / bump-out is not a standalone building
    const n = buildingNumbers(els);
    expect(n.get("e1")).toBe(1);
    expect(n.get("e3")).toBe(2);
    expect(n.get("e4")).toBe(3);
    expect(n.has("e2")).toBe(false); // non-building element
    expect(n.has("e9")).toBe(false); // dog-ear excluded from numbering
    // delete the FIRST building (e1) → the rest renumber contiguously; ids never change
    const after = buildingNumbers(els.filter((e) => e.id !== "e1"));
    expect(after.get("e3")).toBe(1);
    expect(after.get("e4")).toBe(2);
    // a single building is still "Building 1"; bad input yields an empty map
    expect(buildingNumbers([{ id: "x", type: "building" }]).get("x")).toBe(1);
    expect(buildingNumbers(null).size).toBe(0);
  });

  // A road's dimension is derived from live geometry (cross − 2 curbs), so it tracks a resize
  // instead of showing a frozen value. Orientation-independent and never negative.
  it("roadTravelWidth derives travel width from current geometry", () => {
    expect(roadTravelWidth(60, 25, 0.5)).toBe(24); // cross 25 − 2×0.5 curb
    expect(roadTravelWidth(25, 60, 0.5)).toBe(24); // min(w,h), orientation-independent
    expect(roadTravelWidth(60, 40, 0.5)).toBe(39); // a wider road reads wider (tracks the resize)
    expect(roadTravelWidth(10, 1, 0.5)).toBe(0);   // clamped ≥ 0
  });
});

import { rectRoadEndpoints, roadStripBBox } from "../src/workspaces/site-planner/lib/siteModel.js";

describe("Centerline road migration (B596 / NEW-1)", () => {
  // A legacy axis-aligned road: 200′ long (w), 25′ cross (h) = 24′ travel + 0.5′ curb each side.
  const legacy = { id: "r1", type: "road", cx: 100, cy: 50, w: 200, h: 25, rot: 0, travelW: 24, curb: 0.5 };

  it("converts a legacy rect road to a 2-point centerline, preserving travel/curb", () => {
    const m = createSiteModel({ els: [legacy] });
    const r = m.els[0];
    expect(r.pts).toHaveLength(2);
    expect(r.vtx).toEqual([]);
    expect(r.travelW).toBe(24);
    expect(r.curb).toBe(0.5);
    expect(r.roadClass).toBe("aisle"); // DEFAULT_ROAD_CLASS
    // endpoints lie on the centerline (cy), 200′ apart, centred on cx
    expect(r.pts[0]).toEqual({ x: 0, y: 50 });
    expect(r.pts[1]).toEqual({ x: 200, y: 50 });
  });

  it("derives endpoints along the LONG axis for a rotated road", () => {
    const rot90 = { id: "r2", type: "road", cx: 0, cy: 0, w: 300, h: 25, rot: 90, travelW: 24, curb: 0.5 };
    const [a, b] = rectRoadEndpoints(rot90);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(300, 6); // length = w (the long axis)
  });

  it("is idempotent — a road that already has pts is left untouched", () => {
    const cl = { id: "r3", type: "road", pts: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }],
      vtx: [{}, { treatment: "arc" }, {}], travelW: 26, curb: 0.5, roadClass: "truck" };
    const once = createSiteModel({ els: [cl] }).els[0];
    expect(once.pts).toEqual(cl.pts);
    expect(once.roadClass).toBe("truck");
    const twice = createSiteModel({ els: [once] }).els[0];
    expect(twice.pts).toEqual(cl.pts);
  });

  it("leaves a BONDED dock-layer road (attachedTo) as a rect — relayout still owns it", () => {
    const bonded = { id: "r4", type: "road", attachedTo: "b1", cx: 10, cy: 10, w: 100, h: 25, rot: 0, travelW: 24, curb: 0.5 };
    const r = createSiteModel({ els: [bonded] }).els[0];
    expect(r.pts).toBeUndefined();
  });

  it("roadStripBBox returns a containing AABB (rot:0) around the strip", () => {
    const bb = roadStripBBox([{ x: 0, y: 0 }, { x: 100, y: 0 }], [], 24, 0.5);
    expect(bb.rot).toBe(0);
    expect(bb.w).toBeCloseTo(100, 6);     // length
    expect(bb.h).toBeCloseTo(25, 6);      // travel + 2 curbs
    expect(bb.cx).toBeCloseTo(50, 6);
  });
});

import { mergeSiteContent, toMs } from "../src/workspaces/site-planner/lib/siteModel.js";

describe("toMs + mergeSiteContent newer-wins is timestamp-type-safe (B559)", () => {
  it("toMs coerces an ISO string and a ms number to comparable ms", () => {
    expect(toMs(1718447000000)).toBe(1718447000000);
    expect(toMs("2025-06-15T10:30:00.000Z")).toBe(Date.parse("2025-06-15T10:30:00.000Z"));
    expect(toMs(null)).toBe(0);
    expect(toMs(undefined)).toBe(0);
    expect(toMs("not-a-date")).toBe(0);
  });

  it("picks the genuinely-newer copy even when one updatedAt is an ISO string and the other a number", () => {
    // Newer copy carries an ISO string; older carries a smaller ms number. Naive `string >= number`
    // is always false → would WRONGLY pick the older (number) copy and drop the newer's building.
    const older = { id: "s1", updatedAt: 1000, els: [{ id: "a", type: "building" }] };
    const newerIso = { id: "s1", updatedAt: "2025-06-15T10:30:00.000Z",
      els: [{ id: "a", type: "building" }, { id: "b", type: "building" }] };
    const merged = mergeSiteContent(older, newerIso);
    // Union keeps both buildings regardless; the point is `newer` resolves to the ISO copy for
    // scalar/meta — assert the merge ran without the type bug and kept all drawn work.
    expect(merged.els.map((e) => e.id).sort()).toEqual(["a", "b"]);
    expect(toMs(newerIso.updatedAt)).toBeGreaterThan(toMs(older.updatedAt));
  });
});

// B651 — parcel split lineage: `parentId` on children, derived superseded/naming, and the
// ancestor/descendant conflict set that the Active-toggle mutual-exclusion guard consumes.
describe("Parcel split lineage (B651)", () => {
  // Parcel 3 (id p3) split into 3A/3B; 3A split again into 3A1/3A2.
  const parcels = [
    { id: "p1", points: [] },
    { id: "p2", points: [] },
    { id: "p3", active: false, points: [] },     // superseded parent, kept inactive
    { id: "a", parentId: "p3", points: [] },     // 3A (also superseded — split again)
    { id: "a1", parentId: "a", points: [] },     // 3A1
    { id: "a2", parentId: "a", points: [] },     // 3A2
    { id: "b", parentId: "p3", points: [] },     // 3B
  ];

  it("parcelChildrenMap maps a present parent to its children in array order", () => {
    const kids = parcelChildrenMap(parcels);
    expect(kids.get("p3")).toEqual(["a", "b"]);
    expect(kids.get("a")).toEqual(["a1", "a2"]);
    expect(kids.has("b")).toBe(false);
    // an orphaned parentId (parent not present) is ignored
    expect(parcelChildrenMap([{ id: "x", parentId: "missing" }]).size).toBe(0);
  });

  it("descendants and ancestors walk the full lineage tree", () => {
    expect(parcelDescendants(parcels, "p3")).toEqual(new Set(["a", "a1", "a2", "b"]));
    expect(parcelDescendants(parcels, "a")).toEqual(new Set(["a1", "a2"]));
    expect(parcelAncestors(parcels, "a1")).toEqual(new Set(["a", "p3"]));
    expect(parcelAncestors(parcels, "p1")).toEqual(new Set());
  });

  it("lineageConflicts = ancestors ∪ descendants, excluding self and siblings", () => {
    // Activating 3A must deactivate its ancestor (p3) and its descendants (3A1, 3A2) — NOT sibling 3B.
    expect(lineageConflicts(parcels, "a")).toEqual(new Set(["p3", "a1", "a2"]));
    // Activating 3A1 conflicts with its whole ancestor chain, not its sibling 3A2.
    expect(lineageConflicts(parcels, "a1")).toEqual(new Set(["a", "p3"]));
    // Siblings never conflict.
    expect(lineageConflicts(parcels, "b")).toEqual(new Set(["p3"]));
  });

  it("cycle-guarded: a corrupt parentId cycle can't hang ancestor/descendant walks", () => {
    const bad = [{ id: "x", parentId: "y" }, { id: "y", parentId: "x" }];
    expect(() => parcelAncestors(bad, "x")).not.toThrow();
    expect(() => parcelDescendants(bad, "x")).not.toThrow();
    expect(parcelAncestors(bad, "x").has("y")).toBe(true);
  });

  it("parcelDisplayInfo derives lineage names (3 → 3A/3B → 3A1/3A2) and the superseded flag", () => {
    const info = parcelDisplayInfo(parcels);
    expect(info.get("p1").name).toBe("Parcel 1");
    expect(info.get("p3").name).toBe("Parcel 3");
    expect(info.get("p3").superseded).toBe(true);
    expect(info.get("a").name).toBe("Parcel 3A");   // depth 1 → letter
    expect(info.get("b").name).toBe("Parcel 3B");
    expect(info.get("a").superseded).toBe(true);
    expect(info.get("a1").name).toBe("Parcel 3A1"); // depth 2 → digit
    expect(info.get("a2").name).toBe("Parcel 3A2");
    expect(info.get("b").superseded).toBe(false);
  });

  it("a street address overrides the derived Parcel-N name ON A ROOT", () => {
    const info = parcelDisplayInfo([{ id: "p1", addr: "123 Main St", points: [] }]);
    expect(info.get("p1").name).toBe("123 Main St");
  });

  /* ⛔ B520560 — HOW A SPLIT'S PIECES ARE NAMED. Owner decision, verbatim: "number them off the
   * original — a cut on Parcel 1 yields Parcel 1A, 1B, 1C", with the lineage staying visible.
   * The alternating letter/digit chain (1 → 1A → 1A1) and the spreadsheet carry past Z already
   * existed; the two defects below did not, and each is proven against the rule it replaced. */
  describe("split-piece names (B520560)", () => {
    const kid = (id, parentId) => ({ id, parentId, points: [] });

    it("a cut on Parcel 1 yields Parcel 1A / 1B / 1C", () => {
      const info = parcelDisplayInfo([
        { id: "p1", points: [] }, kid("a", "p1"), kid("b", "p1"), kid("c", "p1"),
      ]);
      expect(info.get("p1").name).toBe("Parcel 1");
      expect(["a", "b", "c"].map((k) => info.get(k).name)).toEqual(["Parcel 1A", "Parcel 1B", "Parcel 1C"]);
    });

    it("splitting a piece again alternates: 1A → 1A1 / 1A2, and 1A1 → 1A1A", () => {
      const info = parcelDisplayInfo([
        { id: "p1", points: [] }, kid("a", "p1"), kid("a1", "a"), kid("a2", "a"), kid("a1a", "a1"),
      ]);
      expect(info.get("a1").name).toBe("Parcel 1A1");
      expect(info.get("a2").name).toBe("Parcel 1A2");
      expect(info.get("a1a").name).toBe("Parcel 1A1A");
    });

    it("past Z the letters carry (…Z, AA, AB) — nothing wraps onto a name already in use", () => {
      const parcels = [{ id: "p1", points: [] }];
      for (let i = 0; i < 28; i++) parcels.push(kid(`k${i}`, "p1"));
      const info = parcelDisplayInfo(parcels);
      expect(info.get("k25").name).toBe("Parcel 1Z");
      expect(info.get("k26").name).toBe("Parcel 1AA");
      expect(info.get("k27").name).toBe("Parcel 1AB");
      const names = parcels.map((p) => info.get(p.id).name);
      expect(new Set(names).size).toBe(names.length);          // every name distinct
      expect(names.every((n) => !info.get(parcels[names.indexOf(n)].id).nameCollision)).toBe(true);
    });

    it("DEFECT 1 (RED pre-fix): an inherited situs address must not name every piece the same", () => {
      /* A split COPIES the parent's `addr` onto each piece, and the pre-fix rule was
       * `label || addr || "Parcel <tag>"` at every depth — so three pieces of an addressed tract
       * all displayed "9204 Bay Area Blvd". This is the collision the owner asked about. */
      const parcels = [
        { id: "p1", addr: "9204 Bay Area Blvd", points: [] },
        { ...kid("a", "p1"), addr: "9204 Bay Area Blvd" },
        { ...kid("b", "p1"), addr: "9204 Bay Area Blvd" },
      ];
      const preFix = (p) => p.label || p.addr || null;         // the rule this replaced
      expect(preFix(parcels[1])).toBe(preFix(parcels[2]));     // …produced identical names
      const info = parcelDisplayInfo(parcels);
      expect(info.get("p1").name).toBe("9204 Bay Area Blvd");  // the ROOT keeps its address
      expect(info.get("a").name).toBe("9204 Bay Area Blvd A"); // the pieces do not
      expect(info.get("b").name).toBe("9204 Bay Area Blvd B");
      expect(info.get("a").name).not.toBe(info.get("b").name);
      expect(info.get("a").nameCollision).toBe(false);
    });

    it("DEFECT 2 (RED pre-fix): the letters extend the name he GAVE it, not the positional tag", () => {
      // Pre-fix, a parent labelled "Creek Tract" had children named "Parcel 1A" — the lineage
      // restarted off the tag and the name he typed vanished from its own pieces.
      const parcels = [{ id: "p1", label: "Creek Tract", points: [] }, kid("a", "p1"), kid("a1", "a")];
      const info = parcelDisplayInfo(parcels);
      expect(info.get("a").name).toBe("Creek Tract A");   // space: the base does not end in a digit
      expect(info.get("a1").name).toBe("Creek Tract A1"); // no space: the base ends in a suffix
      expect(info.get("a").name).not.toMatch(/^Parcel /);
    });

    it("a name the user TYPED on a piece still wins at any depth", () => {
      const parcels = [{ id: "p1", points: [] }, { ...kid("a", "p1"), label: "The Wooded Half" }, kid("a1", "a")];
      const info = parcelDisplayInfo(parcels);
      expect(info.get("a").name).toBe("The Wooded Half");
      expect(info.get("a1").name).toBe("The Wooded Half 1"); // and the chain continues off it
    });

    /* ⛔ THE SPLIT DELETES ITS PARENT (B472048, merged after B455360), so a piece is an ORPHAN and
     * there is no lineage left to walk. Both halves of the name must therefore be STAMPED at the
     * cut — the name AND the depth — and the depth is the one that is easy to forget. */
    describe("the name survives the parent being deleted", () => {
      const RING = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
      // The real sequence: name the pieces, then REMOVE the parent, exactly as performSplit does.
      const cut = (plan, pid, n) => {
        const born = parcelSplitNames(plan, pid, n);
        return [...plan.filter((p) => p.id !== pid),
          ...born.map((b, i) => ({ id: `${pid}_${i}`, parentId: pid, splitName: b.name, splitDepth: b.depth, points: RING }))];
      };
      const names = (plan) => plan.map((p) => parcelDisplayInfo(plan).get(p.id).name);

      it("pieces keep 1A / 1B / 1C with the parent gone", () => {
        const plan = cut([{ id: "p1", points: RING }], "p1", 3);
        expect(names(plan).sort()).toEqual(["Parcel 1A", "Parcel 1B", "Parcel 1C"]);
      });

      it("RED without the stamped DEPTH: re-splitting 1A gives 1A1 / 1A2, never 1AA / 1AB", () => {
        /* The defect this pins: with only the NAME stamped, the orphan's walked depth is 0, so the
         * next cut appended a LETTER — and `1AA` is ALSO the 27th sibling of Parcel 1 under the
         * past-Z carry. Two different lots, one name, on one plan. */
        let plan = cut([{ id: "p1", points: RING }], "p1", 2);
        plan = cut(plan, "p1_0", 2);
        expect(names(plan).sort()).toEqual(["Parcel 1A1", "Parcel 1A2", "Parcel 1B"]);
        plan = cut(plan, "p1_0_0", 2);           // and it keeps alternating
        expect(names(plan)).toContain("Parcel 1A1A");
      });

      it("the 27th sibling and a re-split can never draw the same name", () => {
        const wide = cut([{ id: "w", points: RING }], "w", 28);
        const twentySeventh = parcelDisplayInfo(wide).get("w_26").name;
        expect(twentySeventh).toBe("Parcel 1AA");
        let deep = cut([{ id: "w", points: RING }], "w", 1);
        deep = cut(deep, "w_0", 2);
        expect(parcelDisplayInfo(deep).get("w_0_0").name).toBe("Parcel 1A1");
        expect(parcelDisplayInfo(deep).get("w_0_0").name).not.toBe(twentySeventh);
      });

      it("a stamped name never equals a name already live on the plan", () => {
        let plan = cut([{ id: "p1", points: RING }], "p1", 4);
        for (const pid of ["p1_0", "p1_1"]) plan = cut(plan, pid, 3);
        const all = names(plan);
        expect(new Set(all).size).toBe(all.length);
        expect(plan.every((p) => parcelDisplayInfo(plan).get(p.id).nameCollision === false)).toBe(true);
      });

      it("a typed name still wins over the stamp, and the chain continues off it", () => {
        let plan = cut([{ id: "p1", points: RING }], "p1", 2);
        plan = plan.map((p) => (p.id === "p1_0" ? { ...p, label: "The Wooded Half" } : p));
        expect(parcelDisplayInfo(plan).get("p1_0").name).toBe("The Wooded Half");
        plan = cut(plan, "p1_0", 2);
        expect(names(plan)).toContain("The Wooded Half 1");
      });
    });

    it("LOUD-FAILURE: two parcels the user named the same are flagged, never silently renamed", () => {
      const info = parcelDisplayInfo([
        { id: "p1", label: "Creek Tract", points: [] },
        { id: "p2", label: "Creek Tract", points: [] },
        { id: "p3", points: [] },
      ]);
      expect(info.get("p1").nameCollision).toBe(true);
      expect(info.get("p2").nameCollision).toBe(true);
      expect(info.get("p1").name).toBe("Creek Tract");    // reported, not rewritten
      expect(info.get("p3").nameCollision).toBe(false);
    });
  });

  it("parcelOutline nests each parcel's descendants right after it, with depth for indentation", () => {
    const order = parcelOutline(parcels);
    expect(order.map((o) => o.pc.id)).toEqual(["p1", "p2", "p3", "a", "a1", "a2", "b"]);
    const depth = Object.fromEntries(order.map((o) => [o.pc.id, o.depth]));
    expect(depth).toEqual({ p1: 0, p2: 0, p3: 0, a: 1, a1: 2, a2: 2, b: 1 });
  });

  /* ⛔ B966625 — RED PRE-FIX: an orphaned piece (its tombstoned parent is B472049-removed from
   * `parcels` entirely, the normal case for any split under the current code) must indent as the
   * ROOT it now is, never by its stamped lineage depth. Reproduces the owner's Bain report
   * verbatim: a piece born 5 cuts deep (`splitDepth: 5`, matching real production rows
   * e1455089gmiinz/e1455090gmiinz) with no live parent in the list read `depth: 5` and indented
   * 80px under an unrelated sibling — while `lineageDepth` must still carry the stamped value, so
   * a re-split of this same orphan keeps alternating letters/digits (parcelSplitNames). */
  it("an orphaned split piece (tombstoned parent absent) indents as a root, but keeps its lineageDepth for naming", () => {
    const RING = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const orphaned = [
      { id: "unrelated", points: RING },
      { id: "child_a", parentId: "gone", splitName: "Parcel 2A1A1A", splitDepth: 5, points: RING },
      { id: "child_b", parentId: "gone", splitName: "Parcel 2A1A1B", splitDepth: 5, points: RING },
    ];
    const info = parcelDisplayInfo(orphaned);
    expect(info.get("child_a").depth).toBe(0);          // display/indent depth: a resolvable root
    expect(info.get("child_b").depth).toBe(0);
    expect(info.get("child_a").lineageDepth).toBe(5);    // naming depth: the stamp survives
    expect(info.get("child_b").lineageDepth).toBe(5);
    const order = parcelOutline(orphaned);
    const depthOf = Object.fromEntries(order.map((o) => [o.pc.id, o.depth]));
    expect(depthOf).toEqual({ unrelated: 0, child_a: 0, child_b: 0 });
    // And the naming alternation still uses the stamped lineage depth, not the reset display
    // depth: lineageDepth 5 is odd (child_a's own name ends in a letter), so the NEXT cut is at
    // depth 6 (even) → digits, exactly continuing "Parcel 2A1A1A" → "…A1" / "…A2".
    const born = parcelSplitNames(orphaned, "child_a", 2);
    expect(born.map((b) => b.name)).toEqual(["Parcel 2A1A1A1", "Parcel 2A1A1A2"]);
  });
});

// B682 — id-less parcels (map-finder hand-off / legacy saves) get a stable, geometry-derived id at
// the createSiteModel funnel, so a dragged acreage-label offset can no longer spawn phantom copies
// through the cross-copy union merge.
describe("Stable parcel ids heal the acreage-label duplication (B682)", () => {
  const RING = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

  it("createSiteModel backfills a stable id for an id-less parcel, deterministically", () => {
    const a = createSiteModel({ parcels: [{ points: RING, locked: true }] }).parcels[0];
    const b = createSiteModel({ parcels: [{ points: RING, locked: true }] }).parcels[0];
    expect(a.id).toBeTruthy();
    expect(a.id).toBe(b.id); // same geometry → same id, run to run
    expect(a.locked).toBe(true); // other fields preserved
  });

  it("the id is derived from GEOMETRY only — a labelOffset edit does NOT change it", () => {
    const before = createSiteModel({ parcels: [{ points: RING }] }).parcels[0];
    const after = createSiteModel({ parcels: [{ points: RING, labelOffset: { x: 9, y: 9 } }] }).parcels[0];
    expect(after.id).toBe(before.id); // label-drag can't fork the identity anymore
  });

  it("genuinely-distinct parcels get distinct ids", () => {
    const shifted = RING.map((p) => ({ x: p.x + 500, y: p.y }));
    const m = createSiteModel({ parcels: [{ points: RING }, { points: shifted }] });
    expect(m.parcels[0].id).not.toBe(m.parcels[1].id);
  });

  it("an existing id is never rewritten (in-planner parcels carry a uid())", () => {
    const m = createSiteModel({ parcels: [{ id: "p_keepme", points: RING }] });
    expect(m.parcels[0].id).toBe("p_keepme");
  });

  it("REPRO: dragging an id-less parcel's label no longer duplicates it on merge", () => {
    const stored = { id: "s1", updatedAt: 1000, parcels: [{ points: RING, locked: true }] };
    const live = { id: "s1", updatedAt: 2000, parcels: [{ points: RING, locked: true, labelOffset: { x: 5, y: 5 } }] };
    const merged = mergeSiteContent(live, stored);
    expect(merged.parcels).toHaveLength(1);            // was 2 before the fix (the phantom copy)
    expect(merged.parcels[0].labelOffset).toEqual({ x: 5, y: 5 }); // the dragged position wins
  });

  it("exact-geometry id-less duplicates already persisted are collapsed to one (self-heal)", () => {
    // What the bug wrote to a record: the same parcel twice, one with the dragged offset.
    const m = createSiteModel({ parcels: [
      { points: RING, labelOffset: { x: 5, y: 5 } },
      { points: RING },
    ] });
    expect(m.parcels).toHaveLength(1);
    expect(m.parcels[0].labelOffset).toEqual({ x: 5, y: 5 }); // keeps the first (the edited one)
  });
});

/* NEW-3 — the load migration dedupes near-duplicate control-point clutter left on stored roads by earlier
 * connect attempts (the B1005/B1006 root cause). Driven against the OWNER'S REAL element set (pulled from
 * the production Tsakiris / Concept A site record) so the fix is proven on the actual data, not a mock. */
import { readFileSync } from "node:fs";
const CONCEPT_A = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/tsakiris-concept-a.json", import.meta.url), "utf8"));

describe("Road near-duplicate vertex cleanup on load (NEW-3)", () => {
  const nearDupRuns = (pts, tol = 1.5) => {
    let n = 0;
    for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) <= tol) n++;
    return n;
  };

  it("the owner's real through road e38duuwgj carries near-dup clutter BEFORE migration", () => {
    const raw = CONCEPT_A.els.find((e) => e.id === "e38duuwgj");
    expect(raw).toBeTruthy();
    expect(nearDupRuns(raw.pts)).toBeGreaterThan(0); // the clutter that starved the reach clamp
  });

  it("createSiteModel collapses that clutter and keeps pts/vtx index-aligned", () => {
    const m = createSiteModel({ els: CONCEPT_A.els });
    const road = m.els.find((e) => e.id === "e38duuwgj");
    expect(nearDupRuns(road.pts)).toBe(0);                 // no consecutive sub-1.5 ft gap survives
    expect(road.vtx).toHaveLength(road.pts.length);        // arrays stay length-matched
    expect(road.pts.length).toBeLessThan(CONCEPT_A.els.find((e) => e.id === "e38duuwgj").pts.length); // clutter removed
    // Endpoints are preserved (they anchor welds + other roads' tees).
    const raw = CONCEPT_A.els.find((e) => e.id === "e38duuwgj");
    expect(road.pts[0]).toEqual({ x: raw.pts[0].x, y: raw.pts[0].y });
    expect(road.pts[road.pts.length - 1]).toEqual({ x: raw.pts[raw.pts.length - 1].x, y: raw.pts[raw.pts.length - 1].y });
  });

  it("is idempotent — a second migrate pass changes nothing further", () => {
    const once = createSiteModel({ els: CONCEPT_A.els });
    const twice = createSiteModel({ els: once.els });
    const a = once.els.find((e) => e.id === "e38duuwgj");
    const b = twice.els.find((e) => e.id === "e38duuwgj");
    expect(b.pts).toEqual(a.pts);
    expect(b.vtx).toEqual(a.vtx);
  });
});
