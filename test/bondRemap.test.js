/* NEW-2 (B1124) — duplicating a building did not remap `forCourt`, so the copy's trailer bonded to
 * the ORIGINAL building's court.
 *
 * LIVE EVIDENCE these tests are written against (Goose Creek "Plan 1 (copy)", site sms69x8rb2qk —
 * re-queried against `site_elements` while writing them, values verbatim):
 *   building e1454729ykduhm  w 822 h 500 rot 178.543241069641
 *     court   e1454739ykduhm  side top     w 712 h 135   ← the copy's own courts…
 *     court   e1454741ykduhm  side bottom  w 712 h 135
 *     trailer e1454740ykduhm  attachedTo e1454729ykduhm  forCourt/prevZone e1454700dshobp  alongLen 708
 *     trailer e1454742ykduhm  attachedTo e1454729ykduhm  forCourt/prevZone e1454702dshobp  alongLen 707
 *   building e1454629danlgq  w 495 h 419 rot 269
 *     court   e1454700dshobp / e1454702dshobp  ← …but the trailers point HERE, at another building
 *     trailer e1454701dshobp / e1454703dshobp  correctly reference those same courts
 *
 * WHY IT DETACHES (the mechanism, not just the symptom): `relayoutSide` builds each side's chain by
 * walking OUTWARD from the court — `prevZone` first, falling back to `forCourt`. Neither bond on the
 * ykduhm trailers names a ykduhm court, so each chain is just `[court]` and the trailer is never laid
 * out at all. It is `attachedTo` the building, so it also isn't a wall kid; nothing positions it on a
 * host resize either. That is the owner's "trailer parking just hovering by itself".
 */
import { describe, it, expect } from "vitest";
import { ID_BOND_TAGS, HOST_ROLE_TAGS, remapBondRefs } from "../src/workspaces/site-planner/lib/bondRemap.js";
import { collectClipboard, pasteClipboard } from "../src/workspaces/site-planner/lib/planClipboard.js";
import { normalizeCrossHostBonds, normalizeBondedChildren } from "../src/workspaces/site-planner/lib/siteModel.js";
import { layoutZoneByKind, zoneAlongExtent } from "../src/workspaces/site-planner/lib/dockZones.js";

/* The assertion these tests are really about: does `els` still hold a bond pointing at an element
 * OUTSIDE the given id set? It lives HERE rather than in the shipped module — it is a test guard, and
 * the site route is on a byte budget (`ui-audit/perf-bundle-audit.mjs`), so nothing that only tests
 * ever calls belongs in the bundle. */
const danglingBonds = (els, ids) => {
  const set = ids instanceof Set ? ids : new Set(ids || []);
  const out = [];
  for (const e of els || []) {
    if (!e) continue;
    for (const tag of ID_BOND_TAGS) {
      const ref = e[tag];
      if (typeof ref === "string" && ref && !set.has(ref)) out.push({ id: e.id, tag, ref });
    }
  }
  return out;
};

/* A building with a FULL dock stack on both sides: court → trailer → buffer, bonded exactly the way
 * `buildNextZone` bonds them (legacy forCourt/forTrailer AND the generic prevZone chain). */
function stackedBuilding(id, { cx = 0, cy = 0, w = 822, h = 500, rot = 0, along = null } = {}) {
  const host = { id, type: "building", cx, cy, w, h, rot };
  const els = [host];
  const depths = [135, 50, 15];
  const kinds = ["strip", "trailer", "strip"];
  // `along` models the B492 clear span between corner bump-outs (the live plan's 822 ft wall carries
  // four 55 ft bumps, so its courts are 712) — the number the outward chain tracks.
  const span = along || w;
  for (const side of ["top", "bottom"]) {
    const s = side[0];
    const court = { id: `${id}-c${s}`, type: "paving", attachedTo: id, truckCourt: { side }, zd: 135, noFit: true,
      ...layoutZoneByKind(host, side, 0, depths, kinds, { along: span, alongShift: 0 }) };
    const trailer = { id: `${id}-t${s}`, type: "trailer", attachedTo: id, forCourt: court.id, prevZone: court.id, zd: 50, noFit: true,
      ...layoutZoneByKind(host, side, 1, depths, kinds, { along: span, alongShift: 0 }) };
    const buffer = { id: `${id}-b${s}`, type: "landscape", attachedTo: id, forTrailer: trailer.id, prevZone: trailer.id, buffer: true, zd: 15, noFit: true,
      ...layoutZoneByKind(host, side, 2, depths, kinds, { along: span, alongShift: 0 }) };
    els.push(court, trailer, buffer);
  }
  return els;
}

describe("bondRemap — the id-bearing bond inventory", () => {
  it("covers every tag that stores another ELEMENT's id, and nothing else", () => {
    expect(ID_BOND_TAGS).toEqual(["attachedTo", "forCourt", "forTrailer", "prevZone"]);
  });
  it("includes prevZone in the host-role set, so a lone child can't keep a chain link (B495 gap)", () => {
    expect(HOST_ROLE_TAGS).toContain("prevZone");
    expect(HOST_ROLE_TAGS).toContain("forCourt");
    expect(HOST_ROLE_TAGS).toContain("forTrailer");
  });
  it("remaps an in-copy reference and DROPS an out-of-copy one", () => {
    const src = { id: "t", attachedTo: "b", forCourt: "c", prevZone: "c", forTrailer: "gone" };
    const map = new Map([["b", "B"], ["c", "C"], ["t", "T"]]);
    const out = remapBondRefs({ ...src, id: "T" }, src, map);
    expect(out.attachedTo).toBe("B");
    expect(out.forCourt).toBe("C");
    expect(out.prevZone).toBe("C");
    expect("forTrailer" in out).toBe(false);      // dropped, never dangling to a foreign element
  });
  it("strips the host-role tags when the HOST itself is outside the copy (the lone-child case)", () => {
    const src = { id: "t", attachedTo: "b", forCourt: "c", truckCourt: { side: "top" }, sidewalkSide: "left", noFit: true };
    const out = remapBondRefs({ ...src, id: "T" }, src, new Map([["t", "T"]]));
    for (const tag of [...ID_BOND_TAGS, ...HOST_ROLE_TAGS]) expect(tag in out).toBe(false);
  });
  it("leaves an INERT legacy flag alone — `forTrailer: true` names nothing, so it can't dangle", () => {
    const src = { id: "t", attachedTo: "b", forTrailer: true };
    const out = remapBondRefs({ ...src, id: "T" }, src, new Map([["b", "B"], ["t", "T"]]));
    expect(out.forTrailer).toBe(true);
    expect(out.attachedTo).toBe("B");
    expect(danglingBonds([out], new Set(["B", "T"]))).toEqual([]);
    // The load-time repair reads the same rule, so it can't strip the flag either.
    const els = [{ id: "b", type: "building", cx: 0, cy: 0, w: 400, h: 200, rot: 0 }, { ...src, cx: 0, cy: 150, w: 400, h: 40, rot: 0 }];
    expect(normalizeCrossHostBonds(els, () => {})).toBe(els);
  });
  it("danglingBonds names every escaped reference (the guard the copy paths assert on)", () => {
    const els = [{ id: "a" }, { id: "b", attachedTo: "a", forCourt: "zzz" }];
    expect(danglingBonds(els, ["a", "b"])).toEqual([{ id: "b", tag: "forCourt", ref: "zzz" }]);
    expect(danglingBonds([{ id: "b", attachedTo: "a" }], ["a", "b"])).toEqual([]);
  });
});

describe("copy paths — EVERY back-reference lands inside the copy", () => {
  const mint = (() => { let n = 0; return () => `new${++n}`; })();
  const translate = {
    el: (e, dx, dy) => ({ ...e, cx: e.cx + dx, cy: e.cy + dy }),
    markup: (m, dx, dy) => ({ ...m, dx, dy }),
    measure: (m) => ({ ...m }),
  };

  it("pasteClipboard: a building with court + trailer + buffer on BOTH sides copies self-contained", () => {
    const els = stackedBuilding("b1", { rot: 178.543241069641 });
    const { items } = collectClipboard([{ kind: "el", id: "b1" }], { els });
    expect(items).toHaveLength(7); // host + 3 zones × 2 sides
    const out = pasteClipboard(items, { mint, translate, dx: 10, dy: 10 });
    const newIds = new Set(out.els.map((e) => e.id));
    // No bond escapes the copy…
    expect(danglingBonds(out.els, newIds)).toEqual([]);
    // …and specifically none still names an ORIGINAL id (the actual regression).
    const originals = new Set(els.map((e) => e.id));
    for (const e of out.els) for (const tag of ID_BOND_TAGS) expect(originals.has(e[tag])).toBe(false);
    // The chain is intact INSIDE the copy: each trailer's forCourt/prevZone is the copy's own court.
    const copyHost = out.els.find((e) => e.type === "building");
    const trailers = out.els.filter((e) => e.type === "trailer");
    expect(trailers).toHaveLength(2);
    for (const t of trailers) {
      expect(t.attachedTo).toBe(copyHost.id);
      const court = out.els.find((e) => e.id === t.forCourt);
      expect(court).toBeTruthy();
      expect(court.truckCourt).toBeTruthy();
      expect(court.attachedTo).toBe(copyHost.id);
      expect(t.prevZone).toBe(court.id);
      const buf = out.els.find((e) => e.forTrailer === t.id);
      expect(buf).toBeTruthy();
      expect(buf.prevZone).toBe(t.id);
    }
  });

  it("pasteClipboard: a LONE trailer (host left behind) pastes standalone, not half-bonded", () => {
    const els = stackedBuilding("b1");
    // Copy just the trailer, bypassing the assembly expansion, to force the out-of-copy case.
    const items = [{ kind: "el", obj: els.find((e) => e.id === "b1-tt") }];
    const out = pasteClipboard(items, { mint, translate, dx: 5, dy: 5 });
    const c = out.els[0];
    for (const tag of ID_BOND_TAGS) expect(tag in c).toBe(false);
    expect(danglingBonds(out.els, new Set(out.els.map((e) => e.id)))).toEqual([]);
  });

  it("duplicateGroup's clone rule (the same remap) keeps a whole group's bonds inside the copy", () => {
    // Mirrors SitePlanner's `cloneEl`: fresh ids for the member set + its attached children.
    const els = stackedBuilding("b1").map((e) => (e.id === "b1" ? { ...e, groupId: "g1" } : e));
    const memElIds = new Set(["b1"]);
    const all = els.filter((e) => memElIds.has(e.id) || memElIds.has(e.attachedTo));
    const idMap = new Map(all.map((e, i) => [e.id, `d${i}`]));
    const copies = all.map((e) => {
      const c = { ...e, id: idMap.get(e.id) };
      remapBondRefs(c, e, idMap);
      if (memElIds.has(e.id)) c.groupId = "g2"; else delete c.groupId;
      return c;
    });
    expect(danglingBonds(copies, new Set(copies.map((e) => e.id)))).toEqual([]);
    const originals = new Set(els.map((e) => e.id));
    for (const e of copies) for (const tag of ID_BOND_TAGS) expect(originals.has(e[tag])).toBe(false);
  });
});

/* The load-time repair, seeded with EXACTLY the live cross-linked shape. Every plan already
 * duplicated carries the cross-link, so the write-path fix alone rescues nobody. */
describe("normalizeCrossHostBonds — heals the live cross-linked plan", () => {
  // Two buildings, the second's trailers pointing at the FIRST's courts (the ykduhm/dshobp shape).
  const seedLive = () => {
    const orig = stackedBuilding("orig", { cx: 0, cy: 0, w: 495, h: 419, rot: 269, along: 385 });
    const copy = stackedBuilding("copy", { cx: 4000, cy: 0, w: 822, h: 500, rot: 178.543241069641, along: 712 });
    // The bug: the copy's trailers/buffers kept the ORIGINAL's ids on every bond but attachedTo.
    const broken = copy.map((e) => {
      if (e.type === "trailer") return { ...e, forCourt: `orig-c${e.id.endsWith("tt") ? "t" : "b"}`, prevZone: `orig-c${e.id.endsWith("tt") ? "t" : "b"}`, alongLen: e.id.endsWith("tt") ? 708 : 707 };
      if (e.type === "landscape") return { ...e, forTrailer: `orig-t${e.id.endsWith("bt") ? "t" : "b"}`, prevZone: `orig-t${e.id.endsWith("bt") ? "t" : "b"}` };
      return e;
    });
    return [...orig, ...broken];
  };

  it("re-points a trailer at the SAME-SIDE court on its OWN host, and logs it", () => {
    const healed = [];
    const out = normalizeCrossHostBonds(seedLive(), (h) => healed.push(h));
    const byId = new Map(out.map((e) => [e.id, e]));
    for (const side of ["t", "b"]) {
      const t = byId.get(`copy-t${side}`);
      const court = byId.get(t.forCourt);
      expect(court.attachedTo).toBe("copy");                    // its OWN host, not the original's
      expect(court.truckCourt.side).toBe(side === "t" ? "top" : "bottom"); // matched by SIDE
      expect(t.prevZone).toBe(court.id);
      const buf = byId.get(`copy-b${side}`);
      expect(byId.get(buf.forTrailer).attachedTo).toBe("copy");
    }
    // The ORIGINAL's own stack is untouched (its bonds were already correct).
    expect(byId.get("orig-tt").forCourt).toBe("orig-ct");
    expect(healed.every((h) => h.kind === "cross-host-bond")).toBe(true);
    expect(healed.length).toBeGreaterThan(0);
  });

  /* ⛔ SUPERSEDED BY NEW-3, and this replaces the assertion rather than relaxing it.
   *
   * This pass used to drop ANY reference it could not resolve, on the reasoning that "a bond nobody
   * can walk is strictly better than a bond that walks somewhere impossible". That is true of the
   * case it was written for — a duplicate's bond pointing at ANOTHER building's court — and false
   * of a bond pointing at NOTHING, which is a different fact wearing the same shape: a sibling that
   * was deleted. Dropping it there destroys the only record of what belonged in the assembly, and
   * the stranded-zone pass downstream then reads the orphan as the head of its own chain and lays
   * it flat against the dock wall. On the owner's plan `smsdrvzr9gzx` that moved a trailer row
   * 135 ft — exactly the depth of the deleted truck court — and logged a successful heal.
   *
   * So the two cases are now separated by whether the referent EXISTS, and only the resolvable one
   * is repaired. Coverage for the missing-sibling half lives in test/assemblyMissingSibling.test.js.
   */
  it("KEEPS a reference that names a DELETED element — it is the record of the missing sibling", () => {
    const els = [...stackedBuilding("only")].map((e) => (e.type === "trailer" ? { ...e, forCourt: "ghost", prevZone: "ghost" } : e));
    const out = normalizeCrossHostBonds(els.filter((e) => !e.truckCourt), () => {}); // no court to re-bond to
    const t = out.find((e) => e.type === "trailer");
    expect(t.forCourt).toBe("ghost");
    expect(t.prevZone).toBe("ghost");
  });

  it("…but still DROPS a reference to a real element on a FOREIGN host when this host has no counterpart", () => {
    // The B1124 case with nothing to re-point at: the referent EXISTS, so this is a cross-host
    // bond, and leaving it pointing at another building's court is the thing that must not stand.
    const other = stackedBuilding("other");
    const mine = stackedBuilding("only").filter((e) => !e.truckCourt);
    const foreignCourt = other.find((e) => e.truckCourt);
    const els = [...other, ...mine.map((e) => (e.type === "trailer" ? { ...e, forCourt: foreignCourt.id, prevZone: foreignCourt.id } : e))];
    const out = normalizeCrossHostBonds(els, () => {});
    const t = out.find((e) => e.id.startsWith("only") && e.type === "trailer");
    expect("forCourt" in t).toBe(false);
    expect("prevZone" in t).toBe(false);
    expect(danglingBonds(out, new Set(out.map((e) => e.id)))).toEqual([]);
  });

  it("is a no-op on a correct plan — returned BY IDENTITY (the B499 churn contract)", () => {
    const els = stackedBuilding("b1", { rot: 178.543241069641 });
    expect(normalizeCrossHostBonds(els, () => {})).toBe(els);
  });

  it("END TO END: the repaired chain then sheds the spurious alongLen and tracks the court again", () => {
    // Both heals run in ONE pass (normalizeBondedChildren) and the ORDER is what makes it work: the
    // bond repair must land first, or the length pass has no chain to compare the pin against.
    const out = normalizeBondedChildren(seedLive(), () => {});
    const byId = new Map(out.map((e) => [e.id, e]));
    for (const side of ["t", "b"]) {
      const t = byId.get(`copy-t${side}`);
      const court = byId.get(t.forCourt);
      expect(court.attachedTo).toBe("copy");
      expect(t.alongLen).toBeUndefined();                        // the 708 / 707 pin is gone…
      const wall = side === "t" ? "top" : "bottom";
      // …and the trailer is back on the court's own span (712 — the clear face between the bumps).
      expect(zoneAlongExtent(t, 178.543241069641, wall)).toBeCloseTo(zoneAlongExtent(court, 178.543241069641, wall), 3);
    }
  });
});
