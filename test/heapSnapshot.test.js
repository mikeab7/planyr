import { describe, it, expect } from "vitest";
import {
  aggregateSnapshot, diffAggregates, perInteraction,
  edgeIndex, retainerIndex, retainingPath, holderOf, detachedNodes, detachedByClass, liveEntryPoints,
} from "../ui-audit/lib/heapSnapshot.mjs";

/* NEW-2 — reading a V8 heap snapshot well enough to NAME what is retained.
 *
 * The probe's `detachedApprox` counter (renderer-wide nodes minus attached nodes) is an UPPER
 * BOUND: it also catches shadow trees and adopted documents, so a flat reading clears the suspect
 * but a growing one convicts nothing. A heap snapshot carries V8's OWN per-node detachedness flag,
 * which is the actual answer. These tests pin the two rules that make that answer trustworthy:
 * the parser must read the real (flat, meta-described) record layout rather than a guessed one,
 * and it must refuse to quote a detached figure from a snapshot that has no detachedness column —
 * a zero that means "not measured" is exactly the reassuring number that must never be printed. */

/* A minimal but REAL-SHAPED snapshot: `nodes` is one flat array of fixed-width records whose
 * columns are named by `meta.node_fields`, and names are indices into `strings`. */
const snap = (records, { withDetachedness = true } = {}) => {
  const node_fields = ["type", "name", "id", "self_size", "edge_count"].concat(withDetachedness ? ["detachedness"] : []);
  const node_types = [["hidden", "array", "string", "object", "code", "native"], "string", "number", "number", "number"];
  const strings = [];
  const sid = (s) => { const i = strings.indexOf(s); return i >= 0 ? i : strings.push(s) - 1; };
  const nodes = [];
  records.forEach((r, i) => {
    nodes.push(node_types[0].indexOf(r.type ?? "object"), sid(r.name), i + 1, r.size, 0);
    if (withDetachedness) nodes.push(r.detached ? 2 : 1);
  });
  return { snapshot: { meta: { node_fields, node_types } }, nodes, strings };
};

describe("aggregateSnapshot", () => {
  it("aggregates self size and object count per class", () => {
    const a = aggregateSnapshot(snap([
      { name: "HTMLImageElement", type: "native", size: 100 },
      { name: "HTMLImageElement", type: "native", size: 140 },
      { name: "Object", type: "object", size: 40 },
    ]));
    expect(a.ok).toBe(true);
    expect(a.totalBytes).toBe(280);
    expect(a.totalNodes).toBe(3);
    const img = a.byClass.find((r) => r.klass.startsWith("HTMLImageElement"));
    expect(img.nodes).toBe(2);
    expect(img.bytes).toBe(240);
    expect(a.byClass[0].klass).toBe(img.klass); // sorted biggest-first
  });

  it("keeps the node TYPE beside the name — \"Object\" and a [code] blob are different findings", () => {
    const a = aggregateSnapshot(snap([{ name: "(compiled code)", type: "code", size: 500 }]));
    expect(a.byClass[0].klass).toBe("(compiled code) [code]");
  });

  it("reports DETACHED bytes from V8's own flag, not from a proxy", () => {
    const a = aggregateSnapshot(snap([
      { name: "HTMLDivElement", type: "native", size: 200, detached: true },
      { name: "HTMLDivElement", type: "native", size: 200 },
    ]));
    expect(a.detachedNodes).toBe(1);
    expect(a.detachedBytes).toBe(200);
    expect(a.detachedKnown).toBe(true);
  });

  it("REFUSES to imply zero detached when the snapshot has no detachedness column", () => {
    const a = aggregateSnapshot(snap([{ name: "HTMLDivElement", type: "native", size: 200 }], { withDetachedness: false }));
    expect(a.ok).toBe(true);
    expect(a.detachedKnown).toBe(false); // the caller must print "NOT MEASURED", never "0 detached"
  });

  it("rejects anything that is not a heap snapshot instead of returning empty totals", () => {
    expect(aggregateSnapshot({}).ok).toBe(false);
    expect(aggregateSnapshot(null).why).toMatch(/not a heap snapshot/);
    expect(aggregateSnapshot({ snapshot: { meta: { node_fields: ["type", "id"] } }, nodes: [], strings: [] }).why).toMatch(/name\/self_size/);
  });
});

describe("diffAggregates", () => {
  const before = aggregateSnapshot(snap([
    { name: "Tile", type: "native", size: 10000 },
    { name: "Steady", type: "object", size: 50000 },
  ]));
  const after = aggregateSnapshot(snap([
    { name: "Tile", type: "native", size: 10000 },
    { name: "Tile", type: "native", size: 90000, detached: true },
    { name: "Steady", type: "object", size: 50000 },
    { name: "Noise", type: "object", size: 12 },
  ]));

  it("ranks classes by byte growth and drops the sub-threshold tail", () => {
    const d = diffAggregates(before, after);
    expect(d.ok).toBe(true);
    expect(d.rows[0].klass).toBe("Tile [native]");
    expect(d.rows[0].bytes.delta).toBe(90000);
    expect(d.rows[0].nodes.delta).toBe(1);
    expect(d.rows.map((r) => r.klass)).not.toContain("Noise"); // 12 bytes is allocation noise
    expect(d.rows.map((r) => r.klass)).not.toContain("Steady"); // unchanged ⇒ not a row
  });

  it("carries the detached delta through, so the headline can be stated from V8's flag", () => {
    const d = diffAggregates(before, after);
    expect(d.detachedNodesDelta).toBe(1);
    expect(d.detachedBytesDelta).toBe(90000);
    expect(d.detachedKnown).toBe(true);
  });

  it("propagates the reason when either side failed to parse", () => {
    expect(diffAggregates(before, { ok: false, why: "boom" }).why).toBe("boom");
  });
});

describe("perInteraction", () => {
  it("expresses a delta in the same per-gesture units as the growth table", () => {
    expect(perInteraction(1000, 100)).toBe(10);
  });
  it("returns null rather than dividing by zero, so a degenerate run reads as unmeasured", () => {
    expect(perInteraction(1000, 0)).toBeNull();
    expect(perInteraction(NaN, 100)).toBeNull();
  });
});

/* ---- RETAINING PATHS (B1439, second attempt) ---------------------------------------------------
 *
 * The path walker is the part of B1439's second attempt that can silently lie: a reverse index
 * built with the wrong stride, or an edge name read out of the string table when the format says it
 * is an ARRAY INDEX, produces a path that is well-formed, readable, and about the wrong objects.
 * Three properties are pinned here, and each is a mistake this format invites:
 *   1. `to_node` is a BYTE OFFSET into the flat nodes array, not a node index. Off by the node
 *      width and every retainer names its neighbour.
 *   2. An `element` / `hidden` edge's `name_or_index` is a NUMBER; every other edge type's is a
 *      string-table index. Reading the number as a string index is how a path starts quoting
 *      unrelated source text as if it were a property name.
 *   3. A node with several retainers must SAY SO, because the shortest path is one holder and not
 *      necessarily the holder.
 */
const graph = ({ nodesIn, edgesIn, withDetachedness = true }) => {
  const node_fields = ["type", "name", "id", "self_size", "edge_count"].concat(withDetachedness ? ["detachedness"] : []);
  const node_types = [["hidden", "array", "string", "object", "code", "native", "synthetic"], "string", "number", "number", "number"];
  const edge_fields = ["type", "name_or_index", "to_node"];
  const edge_types = [["context", "element", "property", "internal", "hidden", "shortcut", "weak"], "string_or_number", "node"];
  const strings = [];
  const sid = (s) => { const i = strings.indexOf(s); return i >= 0 ? i : strings.push(s) - 1; };
  // Edges must be grouped by SOURCE NODE, in node order — that is the format's own invariant.
  const grouped = nodesIn.map((_, i) => edgesIn.filter((e) => e.from === i));
  const NW = node_fields.length;
  const nodes = [];
  nodesIn.forEach((r, i) => {
    nodes.push(node_types[0].indexOf(r.type ?? "object"), sid(r.name), i + 1, r.size ?? 0, grouped[i].length);
    if (withDetachedness) nodes.push(r.detached ? 2 : 1);
  });
  const edges = [];
  for (const g of grouped) {
    for (const e of g) edges.push(edge_types[0].indexOf(e.type), e.type === "element" || e.type === "hidden" ? e.name : sid(String(e.name)), e.to * NW);
  }
  return { snapshot: { meta: { node_fields, node_types, edge_fields, edge_types } }, nodes, edges, strings };
};

describe("edgeIndex / retainerIndex / retainingPath (B1439)", () => {
  //  0 (GC roots) ──element:[1]──> 1 Holder ──property:cache──> 2 <div> (detached)
  //                                3 Other  ──property:also──> 2
  const g = graph({
    nodesIn: [
      { name: "(GC roots)", type: "synthetic" },
      { name: "Holder", size: 40 },
      { name: "<div>", type: "native", size: 120, detached: true },
      { name: "Other", size: 30 },
    ],
    edgesIn: [
      { from: 0, to: 1, type: "element", name: 1 },
      { from: 0, to: 3, type: "element", name: 2 },
      { from: 1, to: 2, type: "property", name: "cache" },
      { from: 3, to: 2, type: "property", name: "also" },
    ],
  });

  it("indexes the flat edge table with the right stride", () => {
    const ix = edgeIndex(g);
    expect(ix.ok).toBe(true);
    expect(ix.nodeCount).toBe(4);
    expect(ix.edgeCount).toBe(4);
    expect([...ix.firstEdge]).toEqual([0, 2, 3, 3, 4]);
  });

  it("walks a retaining path back to a GC root, naming each edge", () => {
    const rix = retainerIndex(edgeIndex(g));
    const p = retainingPath(rix, 2);
    expect(p.ok).toBe(true);
    expect(p.path.map((s) => s.node)).toEqual(["(GC roots) [synthetic]", "Holder", "<div> [native]"]);
    expect(p.path[2].via).toBe("property:cache");
  });

  it("reads an element edge's name as an INDEX, never as a string-table offset", () => {
    const rix = retainerIndex(edgeIndex(g));
    expect(retainingPath(rix, 1).path[1].via).toBe("element:[1]");
  });

  it("reports how many retainers a node really has, so one path is never read as the only holder", () => {
    const rix = retainerIndex(edgeIndex(g));
    expect(retainingPath(rix, 2).path[2].retainers).toBe(2);
  });

  it("finds exactly the nodes V8 flagged detached, heaviest first", () => {
    const d = detachedNodes(edgeIndex(g));
    expect(d.detachedKnown).toBe(true);
    expect(d.total).toBe(1);
    expect(d.nodes[0].klass).toBe("<div> [native]");
    expect(detachedByClass(d)[0]).toMatchObject({ klass: "<div> [native]", nodes: 1, bytes: 120 });
  });

  it("says UNKNOWN — never zero — when the snapshot has no detachedness column", () => {
    const noDet = graph({ nodesIn: [{ name: "a" }], edgesIn: [], withDetachedness: false });
    const d = detachedNodes(edgeIndex(noDet));
    expect(d.detachedKnown).toBe(false);
    expect(d.why).toMatch(/UNKNOWN, not zero/);
  });

  it("refuses to index something that is not a snapshot", () => {
    expect(edgeIndex({ nodes: [1, 2] }).ok).toBe(false);
    expect(retainingPath({ ok: false, why: "nope" }, 0).ok).toBe(false);
  });

  it("terminates on a retainer cycle instead of looping forever", () => {
    const cyc = graph({
      nodesIn: [{ name: "A" }, { name: "B" }],
      edgesIn: [{ from: 0, to: 1, type: "property", name: "b" }, { from: 1, to: 0, type: "property", name: "a" }],
    });
    const p = retainingPath(retainerIndex(edgeIndex(cyc)), 0);
    expect(p.ok).toBe(true);
    expect(p.path.length).toBeLessThanOrEqual(3);
  });
});

describe("holderOf — the question a detached node actually poses (B1439)", () => {
  /* ⛔ THE TRAP THIS PINS. Every DOM wrapper is one edge from V8's handle table, so the SHORTEST
   * chain from a root to any node — leaked or not — is `(GC roots) → (Traced handles) → node`.
   * That answer is always available and never distinguishes a leak from a live element. `holderOf`
   * must walk OUT of the detached subtree and name the first non-detached, non-synthetic holder. */
  const scene = ({ holderDetached = false } = {}) => graph({
    nodesIn: [
      { name: "(GC roots)", type: "synthetic" },
      { name: "(Traced handles)", type: "synthetic" },
      { name: "PlanCache", detached: holderDetached },   // 2 — the holder
      { name: "<g>", type: "native", size: 200, detached: true },   // 3 — detached parent
      { name: "<rect>", type: "native", size: 180, detached: true }, // 4 — the target
    ],
    edgesIn: [
      { from: 0, to: 1, type: "element", name: 25 },
      { from: 0, to: 2, type: "element", name: 1 },
      { from: 1, to: 3, type: "weak", name: "w1" },   // the trivial handle-table edge
      { from: 1, to: 4, type: "weak", name: "w2" },   // the trivial handle-table edge
      { from: 2, to: 3, type: "property", name: "lastPlanRoot" },
      { from: 3, to: 4, type: "element", name: 0 },
    ],
  });

  it("names the first NON-DETACHED holder, not V8's handle table", () => {
    const h = holderOf(retainerIndex(edgeIndex(scene())), 4);
    expect(h.ok).toBe(true);
    expect(h.held).toBe(true);
    expect(h.chain[0].node).toBe("PlanCache");
    expect(h.chain.map((s) => s.via)).toEqual([null, "property:lastPlanRoot", "element:[0]"]);
    expect(h.chain[1].detached).toBe(true);
    expect(h.chain[2].detached).toBe(true);
  });

  it("REFUSES to invent a holder when every retainer is detached or synthetic, and says why", () => {
    const h = holderOf(retainerIndex(edgeIndex(scene({ holderDetached: true }))), 4);
    expect(h.held).toBe(false);
    expect(h.why).toMatch(/NO JS HOLDER EXISTS/);
    expect(h.why).toMatch(/BLINK side/);
  });

  it("retainerIndex records EVERY retainer, not just the first in node order", () => {
    const rix = retainerIndex(edgeIndex(scene()));
    expect(rix.retainerCount[4]).toBe(2);        // the handle table AND the detached <g>
    expect(rix.retainerCount[3]).toBe(2);        // the handle table AND PlanCache
  });
});

/* ---- THE LIVE BOUNDARY (B1439, third attempt — NEW-3) -----------------------------------------
 *
 * ⛔ THE PROPERTY THAT MAKES THIS INSTRUMENT WORTH HAVING, and the failure it exists to correct.
 *
 * `holderOf` walks BACKWARDS out of the detached island and stops at the first retainer that is not
 * FLAGGED detached. That rule is only sound if "not flagged detached" implies "alive" — and it does
 * not: **V8 sets `detachedness` on DOM WRAPPERS ONLY.** A closure, a bound function, a plain object
 * or an array is never flagged, however dead it is. So a closure that is itself garbage — reachable
 * only from inside the same dead island — satisfies `holderOf`'s stopping rule and is reported as
 * the holder. B1439's second attempt named exactly such an object and it was believed.
 *
 * `liveEntryPoints` asks the complementary question and cannot make that mistake: walk FORWARD from
 * the roots, never through a detached node, and report the edges that cross into the island. Every
 * holder it names is reachable from a root through live nodes only, so it is alive by construction.
 *
 * The scenes below are built so that a naive implementation gets each one WRONG in a different way.
 */
describe("liveEntryPoints — who ALIVE points into the detached island (B1439, third attempt)", () => {
  /*  0 (GC roots) ─> 1 (Traced handles) [synthetic] ─weak─> 4 <div> (detached)
   *  0 ────────────> 2 LiveCache ─property:stale──────────> 4
   *  4 ─element:[0]─> 5 <span> (detached, INSIDE the island)
   *  0 ────────────> 3 DeadIsh   (NOT flagged — nothing flags a plain object) is reachable ONLY
   *                              from the island, so it must never be reported as a holder.
   */
  const scene = ({ liveCacheHolds = true } = {}) => graph({
    nodesIn: [
      { name: "(GC roots)", type: "synthetic" },
      { name: "(Traced handles)", type: "synthetic" },
      { name: "LiveCache", size: 40 },
      { name: "DeadClosure", size: 24 },
      { name: "<div class=leaflet-container>", type: "native", size: 300, detached: true },
      { name: "<span>", type: "native", size: 90, detached: true },
    ],
    edgesIn: [
      { from: 0, to: 1, type: "element", name: 0 },
      { from: 0, to: 2, type: "element", name: 1 },
      { from: 1, to: 4, type: "weak", name: "handle" },
      ...(liveCacheHolds ? [{ from: 2, to: 4, type: "property", name: "stale" }] : []),
      { from: 4, to: 5, type: "element", name: 0 },
      { from: 5, to: 3, type: "property", name: "onEvent" },   // the closure lives INSIDE the island
      { from: 3, to: 4, type: "property", name: "el" },        // …and points back at it (the cycle)
    ],
  });

  it("names the LIVE holder and the edge it holds by", () => {
    const r = liveEntryPoints(retainerIndex(edgeIndex(scene())));
    expect(r.ok).toBe(true);
    expect(r.known).toBe(true);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].holder).toBe("LiveCache");
    expect(r.entries[0].via).toBe("property:stale");
    expect(r.entries[0].held).toMatch(/leaflet-container/);
  });

  it("NEVER reports a JS object that is only reachable from inside the island — the mistake holderOf makes", () => {
    /* With no live reference in, the island is pure garbage: the ONLY non-detached retainer
     * anywhere is `DeadClosure`, which is inside the island and is not flagged because V8 flags
     * only DOM wrappers. `holderOf` therefore names it as the holder — confidently and wrongly,
     * which is precisely what happened to B1439's second attempt. */
    const dead = scene({ liveCacheHolds: false });
    const h = holderOf(retainerIndex(edgeIndex(dead)), 5);
    expect(h.held).toBe(true);
    expect(h.chain[0].node).toBe("DeadClosure");
    // The forward walk never reaches it, because the only way in is through the island itself.
    const r = liveEntryPoints(retainerIndex(edgeIndex(dead)));
    expect(r.entries.map((e) => e.holder)).not.toContain("DeadClosure");
    expect(r.entries).toHaveLength(0);
  });

  it("does NOT traverse the handle tables — every DOM wrapper is in one, so they name nothing", () => {
    // With LiveCache's reference removed the ONLY path in is the traced-handle table, which is
    // exactly the always-true/never-useful answer. The right result is an explicit NOTHING.
    const r = liveEntryPoints(retainerIndex(edgeIndex(scene({ liveCacheHolds: false }))));
    expect(r.entries).toHaveLength(0);
    expect(r.why).toMatch(/NOTHING ALIVE POINTS INTO THE DETACHED ISLAND/);
    expect(r.why).toMatch(/Blink side/);
  });

  it("reports the island's BOUNDARY, not its interior — a nested detached node is not a second crossing", () => {
    const r = liveEntryPoints(retainerIndex(edgeIndex(scene())));
    // <span> is detached too, but it is reached only THROUGH <div>, which the walk refuses to expand.
    expect(r.entries.map((e) => e.held).join(" ")).not.toMatch(/span/);
    expect(r.crossings).toBe(1);
  });

  it("refuses to answer at all when the snapshot has no detachedness column — UNKNOWN, never zero", () => {
    const g2 = graph({
      nodesIn: [{ name: "(GC roots)", type: "synthetic" }, { name: "X" }],
      edgesIn: [{ from: 0, to: 1, type: "element", name: 0 }],
      withDetachedness: false,
    });
    const r = liveEntryPoints(retainerIndex(edgeIndex(g2)));
    expect(r.known).toBe(false);
    expect(r.entries).toEqual([]);
    expect(r.why).toMatch(/UNKNOWN, not zero/);
  });
});
