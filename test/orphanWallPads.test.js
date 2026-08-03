/* NEW-1 … NEW-4 (2026-08-03) — "the Goose Creek plans are missing sidewalks."
 *
 * ONE root cause, four consequences. `splitParkingRows` (the parking field's Explode) built each
 * piece with only `cfg` and `attachedTo` copied off the source field, dropping every bond ROLE tag —
 * `sideParkSide` above all. The pieces stayed bonded to the building and kept rendering, but every
 * lookup and every heal keyed on that tag went blind to them:
 *
 *   · `empSidePark` answered "no parking on this wall" with a full 60 ft module sitting on it, so
 *     the "−" ladder (rows → remove parking → remove sidewalk) fell straight through to the last
 *     rung. ONE click deleted the sidewalk under live parking. Twice, on Goose Creek "Plan II":
 *     `e1454689dshobp` (2026-07-29) and `e1454744tcmstb` (2026-07-30), each a solo single-row
 *     delete with the host alive and untouched.
 *   · `normalizeWallKids` / `hostOf` admit a child only when it is a wall-strip type or carries
 *     `sideParkSide`, so the pieces never re-flushed when their host moved or was resized.
 *   · `sideParkingOn` would stack a DUPLICATE field on a wall that already had three pads, and
 *     `empSideAddTitle` reported "Add a parking row" on the same wall.
 *
 * Every fixture here is REAL PRODUCTION GEOMETRY (`test/fixtures/orphanWallPads.json`, pulled from
 * `site_elements` 2026-08-03). The defect IS the fixture — do not "fix" the numbers.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  normalizeBondedChildren, normalizeOrphanWallPads, orphanWallPads, RESTORED_STRIP_W_FT,
} from "../src/workspaces/site-planner/lib/siteModel.js";
import { assemblyIntegrity, orphanPayload } from "../src/workspaces/site-planner/lib/assemblyIntegrity.js";
import { HOST_ROLE_TAGS, carryHostRoleTags } from "../src/workspaces/site-planner/lib/bondRemap.js";
import { sideParkStack } from "../src/workspaces/site-planner/lib/dogEar.js";
import { createIdMinter } from "../src/shared/ids.js";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/orphanWallPads.json", import.meta.url), "utf8"));
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const SRC = read("../src/workspaces/site-planner/SitePlanner.jsx");

const clone = (els) => JSON.parse(JSON.stringify(els));
const minter = () => createIdMinter("zztest");
const heal = (els, onHeal) => normalizeBondedChildren(clone(els), onHeal || null, { mintId: minter() });
const byId = (list, id) => list.find((e) => e.id === id);
const stripsOn = (list, host) => list.filter((e) => e.attachedTo === host && (e.type === "sidewalk" || e.type === "landscape") && !e.noFit);
const box = (e) => ({ cx: e.cx, cy: e.cy, w: e.w, h: e.h, rot: e.rot });
const sameBox = (a, b, tol = 1e-6) => {
  expect(a.cx).toBeCloseTo(b.cx, 6); expect(a.cy).toBeCloseTo(b.cy, 6);
  expect(a.w).toBeCloseTo(b.w, 6); expect(a.h).toBeCloseTo(b.h, 6);
  expect(Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy)).toBeLessThanOrEqual(tol);
};

/* ------------------------------------------------------------------ NEW-1: the tag must survive */
describe("NEW-1 — exploding a parking field keeps every bond role tag", () => {
  it("`carryHostRoleTags` carries the whole HOST_ROLE_TAGS inventory, and only what is present", () => {
    const src = { id: "a", type: "parking", cx: 1, cy: 2, sideParkSide: "left", sideParkFit: { run: 500, alongShift: 3 }, noLabel: true };
    const out = carryHostRoleTags(src, { id: "b" });
    expect(out.sideParkSide).toBe("left");
    expect(out.sideParkFit).toEqual({ run: 500, alongShift: 3 });
    expect(out.noLabel).toBe(true);
    expect("truckCourt" in out).toBe(false);          // absent on the source → absent on the copy
    expect(out.cx).toBeUndefined();                    // geometry is the caller's business, not ours
  });

  it("the whole role family — the ones the Explode dropped — is in the inventory", () => {
    for (const tag of ["sideParkSide", "sideParkFit", "sideParkPiece", "truckCourt", "forCourt",
      "forTrailer", "oppSide", "prevZone", "noFit", "stackSide", "sidewalkSide"])
      expect(HOST_ROLE_TAGS).toContain(tag);
  });

  it("splitParkingRows routes every piece — stall rows AND aisle lanes — through the shared helper", () => {
    // Both branches spread ONE `bond` object, so a future edit cannot give the rows an identity the
    // aisles do not get (the aisle was previously written as bare `paving` with no role at all).
    expect(SRC).toMatch(/const bond = \{ \.\.\.carryHostRoleTags\(el\), .*sideParkPiece: newEls\.length \}/);
    const split = SRC.slice(SRC.indexOf("const splitParkingRows ="), SRC.indexOf("const splitParkingRows =") + 2200);
    expect(split).toMatch(/type: "paving",[^\n]*\.\.\.bond \}/);     // the drive aisle
    expect(split).toMatch(/type: "parking",[^\n]*\.\.\.bond \}/);    // the stall row
    // …and the old hand-picked subset is gone.
    expect(split).not.toMatch(/\.\.\.\(el\.attachedTo \? \{ attachedTo: el\.attachedTo \} : \{\}\) \}\);/);
  });

  it("`sideParkStack` lays an exploded set contiguously outward, and is identity for a lone field", () => {
    const host = { id: "h", type: "building", cx: 0, cy: 0, w: 400, h: 200, rot: 0 };
    const pad = (id, cy, h, piece) => ({ id, type: "parking", attachedTo: "h", cx: 0, cy, w: 400, h, rot: 0, sideParkSide: "bottom", ...(piece == null ? {} : { sideParkPiece: piece }) });
    // row 18 | aisle 24 | row 18, stacked from the wall face (100) past a 5 ft strip.
    const pads = [pad("c", 100 + 5 + 18 + 24 + 9, 18, 2), pad("a", 100 + 5 + 9, 18, 0), pad("b", 100 + 5 + 18 + 12, 24, 1)];
    expect(sideParkStack(host, "bottom", pads, 5).map((r) => [r.el.id, r.gap]))
      .toEqual([["a", 5], ["b", 23], ["c", 47]]);
    // No stamped index anywhere → order falls back to the pads' own perpendicular offsets, which is
    // what every plan already on disk needs.
    const bare = pads.map((p) => { const r = { ...p }; delete r.sideParkPiece; return r; });
    expect(sideParkStack(host, "bottom", bare, 5).map((r) => r.el.id)).toEqual(["a", "b", "c"]);
    // One un-exploded field → the bare strip thickness, exactly as before this model existed.
    expect(sideParkStack(host, "bottom", [pad("solo", 165, 60, null)], 5)).toEqual([{ el: expect.objectContaining({ id: "solo" }), depth: 60, gap: 5 }]);
  });
});

/* --------------------------------------------- NEW-2: the ladder can never reach the sidewalk */
describe("NEW-2 — 'what is on this wall' is answered by geometry, and the sidewalk rung is guarded", () => {
  it("side parking is found by GEOMETRY, with the tag only as a fast path", () => {
    // The forgiving test `empSideSidewalk` has always used — which is exactly why the sidewalk
    // stayed visible to the ladder while the parking beside it vanished.
    expect(SRC).toMatch(/const sideParkPadsOn = \(b, name\) => \{\s*\n\s*const pads = els\.filter\(\(x\) => isSideParkPad\(x, b\) && \(x\.sideParkSide \? x\.sideParkSide === name : sideOfKid\(b, x\) === name\)\);/);
    expect(SRC).toMatch(/const sideParkingOn = \(b, name\) => sideParkPadsOn\(b, name\)\[0\] \|\| null;/);
    // …and the strict tag test that went blind is gone from every one of them.
    expect(SRC).not.toMatch(/els\.find\(\(x\) => x\.attachedTo === b\.id && x\.sideParkSide === (name|side)\)/);
  });

  it("the removal ladder reaches the sidewalk ONLY when no pavement is bonded to that wall", () => {
    const ladder = SRC.slice(SRC.indexOf("const growEmployeeSide ="), SRC.indexOf("const empSideAddTitle ="));
    // Structural, not incidental: the sidewalk branch is the `else` of `pads.length`, so a future
    // tag-loss bug degrades to a rung that does nothing rather than one that destroys geometry.
    expect(ladder).toMatch(/\} else if \(pads\.length\) \{/);
    expect(ladder).toMatch(/\} else if \(sw\) removeFeature\(sw\.id\);/);
    expect(ladder).not.toMatch(/\} else if \(park\) \{/);           // the branch that fell through
    // The pads list the guard reads is the geometric one.
    expect(ladder).toMatch(/pads = sideParkPadsOn\(b, side\)/);
  });

  it("the tooltip and the duplicate-field guard read the same geometric answer", () => {
    expect(SRC).toMatch(/const empSideAddTitle = \(b, side\) => \{ const sw = empSideSidewalk\(b, side\), park = empSidePark\(b, side\);/);
    expect(SRC).toMatch(/const empSidePark = \(b, side\) => \{ const p = sideParkPadsOn\(b, side\); return p\[p\.length - 1\] \|\| null; \}/);
    expect(SRC).toMatch(/const addParkingRowSide = \(b, name\) => \{\s*\n\s*if \(sideParkingOn\(b, name\)\) return;/);
  });

  it("the canvas refit no longer needs the tag either (the 'parking separated from the building' class)", () => {
    expect(SRC).toMatch(/const ownedSidePark = \(x, b\) => isSideParkPad\(x, b\) && !!sideOfKid\(b, x\);/);
    expect(SRC).toMatch(/sideParkStack\(b, s, pads, sd\)\.forEach\(\(r\) => gapById\.set\(r\.el\.id, r\.gap\)\)/);
  });
});

/* -------------------------------------------------------- NEW-3: the one-time repair on disk */
describe("NEW-3 — the load-time repair, on the owner's real rows", () => {
  const GOOSE = FIX.gooseCreekPlanII.els;
  const HOSTS = ["e1454629danlgq", "e1454729ykduhm"];

  it("finds exactly the six untagged pads the survey found — three on each damaged host", () => {
    const found = orphanWallPads(GOOSE);
    expect(found.map((o) => o.id).sort()).toEqual([
      "e1454691dshobp", "e1454692dshobp", "e1454693dshobp",
      "e1454736ykduhm", "e1454737ykduhm", "e1454738ykduhm",
    ]);
    // Every one resolves to the LEFT wall — the wall whose sidewalk was deleted.
    expect(new Set(found.map((o) => o.side))).toEqual(new Set(["left"]));
    // The tagged fields, the truck courts, the trailers and the bump-outs are NOT orphans.
    expect(found.some((o) => ["e1454688dshobp", "e1454735ykduhm", "e1454700dshobp", "e1454701dshobp", "e1454630danlgq"].includes(o.id))).toBe(false);
  });

  it("both hosts come back to TWO sidewalks each, spanning the wall the survivor spans", () => {
    for (const h of HOSTS) expect(stripsOn(GOOSE, h)).toHaveLength(1);   // the defect, on disk
    const out = heal(GOOSE);
    for (const h of HOSTS) {
      const strips = stripsOn(out, h);
      expect(strips).toHaveLength(2);
      expect(new Set(strips.map((s) => s.sidewalkSide))).toEqual(new Set(["left", "right"]));
      const [left] = strips.filter((s) => s.sidewalkSide === "left");
      const [right] = strips.filter((s) => s.sidewalkSide === "right");
      expect(left.type).toBe("sidewalk");
      expect(left.attachedTo).toBe(h);
      // Same span rule as its intact twin (building depth + both corner bump-out projections),
      // and the same 5 ft thickness this app has always placed.
      expect(Math.max(left.w, left.h)).toBeCloseTo(Math.max(right.w, right.h), 6);
      expect(Math.min(left.w, left.h)).toBeCloseTo(RESTORED_STRIP_W_FT, 6);
      // Never a resurrected tombstone — the deleted rows would be stripped straight back out.
      expect(["e1454689dshobp", "e1454744tcmstb"]).not.toContain(left.id);
    }
  });

  it("the parking is EXACTLY where the owner left it, and it gets its identity back", () => {
    const out = heal(GOOSE);
    for (const id of ["e1454691dshobp", "e1454692dshobp", "e1454693dshobp",
      "e1454736ykduhm", "e1454737ykduhm", "e1454738ykduhm"]) {
      sameBox(box(byId(out, id)), box(byId(GOOSE, id)));
      expect(byId(out, id).sideParkSide).toBe("left");
      expect(Number.isFinite(byId(out, id).sideParkPiece)).toBe(true);
    }
    // …and the three pieces on each wall keep their stacking order, inner → outer.
    for (const ids of [["e1454691dshobp", "e1454692dshobp", "e1454693dshobp"],
      ["e1454736ykduhm", "e1454737ykduhm", "e1454738ykduhm"]])
      expect(ids.map((id) => byId(out, id).sideParkPiece)).toEqual([0, 1, 2]);
  });

  it("nothing else on the plan moves — courts, trailers, bump-outs, the intact walls", () => {
    const out = heal(GOOSE);
    const touched = new Set(["e1454691dshobp", "e1454692dshobp", "e1454693dshobp",
      "e1454736ykduhm", "e1454737ykduhm", "e1454738ykduhm"]);
    for (const e of GOOSE) {
      if (touched.has(e.id)) continue;
      const after = byId(out, e.id);
      expect(after, `${e.id} vanished`).toBeTruthy();
      sameBox(box(after), box(e));
    }
  });

  it("a second load changes NOTHING — no second sidewalk, no drift (the idempotency contract)", () => {
    const once = heal(GOOSE);
    const twice = normalizeBondedChildren(clone(once), null, { mintId: minter() });
    expect(twice).toHaveLength(once.length);
    for (const e of once) sameBox(box(byId(twice, e.id)), box(e));
    expect(orphanWallPads(once)).toEqual([]);
    // The repair pass itself is now a pure identity — it returns the same array reference.
    expect(normalizeOrphanWallPads(once, null, { mintId: minter() })).toBe(once);
  });

  it("every repair is LOUD — the restore and each re-tag report their own kind", () => {
    const seen = [];
    heal(GOOSE, (h) => seen.push(h));
    const restored = seen.filter((h) => h.kind === "orphan-pad-strip-restored");
    const retagged = seen.filter((h) => h.kind === "orphan-pad-retagged");
    expect(restored).toHaveLength(2);
    expect(retagged).toHaveLength(6);
    expect(restored.every((h) => Math.abs(h.voidFt - RESTORED_STRIP_W_FT) < 0.01)).toBe(true);
    expect(retagged.every((h) => h.side === "left" && h.to.sideParkSide === "left")).toBe(true);
  });

  it("Silvestri: nine hand-trimmed pads re-tag with ZERO geometry movement and no new sidewalk", () => {
    const els = FIX.silvestri.els;
    const HOST = "e1454678snowrs";
    const orphans = orphanWallPads(els);
    expect(orphans).toHaveLength(9);
    const before = stripsOn(els, HOST).length;
    const out = heal(els);
    expect(stripsOn(out, HOST)).toHaveLength(before);        // the wall's sidewalk is INTACT → no restore
    for (const o of orphans) {
      const after = byId(out, o.id);
      sameBox(box(after), box(byId(els, o.id)));
      expect(after.sideParkSide).toBe("bottom");
      // The taper (679 → 486 ft against a 1,886 ft wall) is the owner's own hand-trimming, so it is
      // RECORDED as intent rather than re-derived — without the stamp the B1340 span rule would
      // read every short run as staleness and stretch all nine back to the full wall.
      expect(after.sideParkFit).toEqual({ run: expect.any(Number), alongShift: expect.any(Number) });
      expect(after.sideParkFit.run).toBeCloseTo(byId(els, o.id).w, 6);
    }
    expect(orphanWallPads(out)).toEqual([]);
  });

  it("Hoffmeister: pads sitting INSIDE their own sidewalk are pulled clear of it — and say so", () => {
    // The one survey site where geometry legitimately moves. Seven pads overlapped their strips by
    // 4.44 ft; the across-wall axis has no user freedom, so re-joining the heal corrects it.
    const els = FIX.hoffmeister.els;
    const orphans = orphanWallPads(els);
    expect(orphans).toHaveLength(7);
    const seen = [];
    const out = heal(els, (h) => seen.push(h));
    expect(stripsOn(out, "e9007")).toHaveLength(3);          // all three sidewalks intact → no restore
    expect(seen.filter((h) => h.kind === "orphan-pad-strip-restored")).toHaveLength(0);
    const moved = orphans.filter((o) => Math.hypot(byId(out, o.id).cx - byId(els, o.id).cx, byId(out, o.id).cy - byId(els, o.id).cy) > 1);
    expect(moved.length).toBeGreaterThan(0);
    // ALONG the wall nothing is re-centred (their runs and centres are preserved as intent).
    for (const o of orphans) expect(byId(out, o.id).w).toBeCloseTo(byId(els, o.id).w, 6);
    expect(orphanWallPads(out)).toEqual([]);
  });

  it("a pad on a DOCK wall is left alone — the repair never guesses one into a wall-kid role", () => {
    const host = { id: "h", type: "building", cx: 0, cy: 0, w: 400, h: 200, rot: 0 };
    const court = { id: "tc", type: "paving", attachedTo: "h", truckCourt: { side: "bottom" }, zd: 135, cx: 0, cy: 167.5, w: 400, h: 135, rot: 0 };
    const stray = { id: "p", type: "paving", attachedTo: "h", cx: 0, cy: 260, w: 400, h: 50, rot: 0 };
    // The detector still SEES it (it is a role-less bonded pad), but the repair declines to name it:
    // a pad behind a truck court belongs to that chain's world, and a guess there would be worse
    // than the gap. Identity-preserving, so nothing on a dock wall churns on load.
    expect(orphanWallPads([host, court, stray]).map((o) => o.side)).toEqual(["bottom"]);
    const input = [host, court, stray];
    expect(normalizeOrphanWallPads(input, null, { mintId: minter() })).toBe(input);
  });

  it("a bare wall is never given a sidewalk it never had — only a strip-width void counts", () => {
    const host = { id: "h", type: "building", cx: 0, cy: 0, w: 400, h: 200, rot: 0 };
    const flush = { id: "p", type: "parking", attachedTo: "h", cx: 0, cy: 130, w: 400, h: 60, rot: 0 }; // gap 0
    const out = normalizeOrphanWallPads([host, flush], null, { mintId: minter() });
    expect(out.filter((e) => e.type === "sidewalk")).toHaveLength(0);
    expect(byId(out, "p").sideParkSide).toBe("bottom");
    // …nor for a gap that is not one strip wide (a genuine design offset, not a deleted strip).
    const wide = { ...flush, cy: 100 + 20 + 30 };                                        // a 20 ft gap
    expect(normalizeOrphanWallPads([host, wide], null, { mintId: minter() }).filter((e) => e.type === "sidewalk")).toHaveLength(0);
    // …and it DOES fire on a strip-width void, which is the physical evidence of the delete.
    const voided = { ...flush, cy: 100 + RESTORED_STRIP_W_FT + 30 };
    const fixed = normalizeOrphanWallPads([host, voided], null, { mintId: minter() });
    expect(fixed.filter((e) => e.type === "sidewalk")).toHaveLength(1);
    expect(fixed.find((e) => e.type === "sidewalk").sidewalkSide).toBe("bottom");
  });
});

/* ------------------------------------------- NEW-4: a bonded child with no role fails the harness */
describe("NEW-4 — assembly integrity fails loud on a bonded pad with no wall role", () => {
  it("reports the orphans even though NOTHING is in the wrong place", () => {
    // This is the whole point: three pads sitting exactly where side parking belongs are
    // geometrically indistinguishable from correct, so the geometry diff can never see them.
    const els = FIX.silvestri.els;
    const res = assemblyIntegrity(clone(els), { mintId: minter() });
    expect(res.orphans).toHaveLength(9);
    expect(res.tears).toEqual([]);                       // …and not one of them is a TEAR
    expect(res.orphans[0]).toEqual({ id: expect.any(String), host: "e1454678snowrs", type: expect.stringMatching(/parking|paving/), side: "bottom" });
  });

  it("is silent on a coherent plan, and the payload is bounded", () => {
    const healed = heal(FIX.gooseCreekPlanII.els);
    expect(assemblyIntegrity(healed, { mintId: minter() }).orphans).toEqual([]);
    const p = orphanPayload(Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, host: "h", type: "parking", side: "left" })));
    expect(p.count).toBe(50);
    expect(p.items).toHaveLength(20);
  });

  it("is wired into the SAME dev-time seam as the other assembly invariants", () => {
    const guard = SRC.slice(SRC.indexOf("const assemblyGuard ="), SRC.indexOf("const assemblyGuard =") + 1400);
    expect(guard).toMatch(/reportClientEvent\("assembly-orphan-pad"/);
    expect(guard).toMatch(/orphanPayload\(res\.orphans\)/);
    // A zero-geometry repair would otherwise be discarded here (this seam ignores sub-tolerance
    // churn on purpose), so the orphan case adopts the healed list explicitly.
    expect(guard).toMatch(/if \(!res\.tears\.length\) return \(res\.orphans && res\.orphans\.length\) \? res\.els : list;/);
  });
});
