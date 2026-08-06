import { describe, it, expect } from "vitest";
import { aggregateSnapshot, diffAggregates, perInteraction } from "../ui-audit/lib/heapSnapshot.mjs";

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
