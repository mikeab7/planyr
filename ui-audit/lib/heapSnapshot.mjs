/* heapSnapshot — read a V8 heap snapshot well enough to say WHAT is retained (NEW-2).
 *
 * WHY THIS EXISTS. The interaction probe measures retained heap after a forced GC and can say it
 * grows per gesture. It cannot say what the growth IS, and a growth rate with no named class is a
 * symptom, not a finding. Two questions in particular cannot be answered any other way:
 *
 *   • DETACHED DOM. The probe's `detachedApprox` is renderer-wide nodes minus attached nodes — an
 *     UPPER BOUND that also catches shadow trees and adopted documents, so a flat reading clears
 *     the suspect but a growing one convicts nothing. A heap snapshot carries V8's own
 *     `detachedness` flag PER NODE (0 unknown · 1 attached · 2 detached), which is the actual
 *     answer rather than a proxy for it.
 *   • WHAT CLASS. Aggregating self-size by constructor name turns "26 KB per gesture" into "26 KB
 *     per gesture of <named thing>", which is the difference between a fix and a guess.
 *
 * The format, for the reader who has not seen one: a `.heapsnapshot` is JSON with a flat `nodes`
 * array of fixed-width records, a `strings` table, and `snapshot.meta.node_fields` naming the
 * columns. Nothing here walks edges or computes retained sizes (that needs a dominator tree and is
 * a different order of work) — SELF size aggregated by class, plus the detachedness flag, is
 * enough to name a class, and claiming more than that from this parse would be dishonest.
 *
 * Pure — takes a parsed object, returns plain data — so it unit-tests without a browser.
 */

/* Aggregate a parsed snapshot by node class: count and total SELF bytes, plus the detached tally
 * that V8 itself computed. Tolerates a snapshot whose meta lacks `detachedness` (older Chrome) by
 * reporting `detachedKnown: false` rather than silently reporting zero detached bytes — a zero
 * that means "not measured" is exactly the kind of reassuring number that must never be printed. */
export function aggregateSnapshot(snap) {
  const meta = snap?.snapshot?.meta;
  const fields = meta?.node_fields;
  const types = meta?.node_types?.[0];
  const nodes = snap?.nodes;
  const strings = snap?.strings;
  if (!Array.isArray(fields) || !Array.isArray(nodes) || !Array.isArray(strings)) {
    return { ok: false, why: "not a heap snapshot — missing nodes / strings / meta.node_fields" };
  }
  const W = fields.length;
  const iType = fields.indexOf("type");
  const iName = fields.indexOf("name");
  const iSize = fields.indexOf("self_size");
  const iDet = fields.indexOf("detachedness");
  if (iName < 0 || iSize < 0) return { ok: false, why: "snapshot has no name/self_size columns" };

  const byClass = new Map();
  let totalBytes = 0, totalNodes = 0, detachedBytes = 0, detachedNodes = 0;
  for (let o = 0; o + W <= nodes.length; o += W) {
    const size = nodes[o + iSize] || 0;
    const name = strings[nodes[o + iName]] ?? "(unknown)";
    const type = iType >= 0 && Array.isArray(types) ? (types[nodes[o + iType]] ?? "") : "";
    const detached = iDet >= 0 && nodes[o + iDet] === 2;
    // Key on class name, and keep the node TYPE beside it: "Object" and "(object shape)" are very
    // different things to find at the top of a growth list.
    const key = type && type !== "object" ? `${name} [${type}]` : name;
    const rec = byClass.get(key) || { klass: key, nodes: 0, bytes: 0, detachedNodes: 0, detachedBytes: 0 };
    rec.nodes++; rec.bytes += size;
    if (detached) { rec.detachedNodes++; rec.detachedBytes += size; detachedNodes++; detachedBytes += size; }
    byClass.set(key, rec);
    totalBytes += size; totalNodes++;
  }
  return {
    ok: true, totalBytes, totalNodes, detachedBytes, detachedNodes,
    detachedKnown: iDet >= 0,
    byClass: [...byClass.values()].sort((a, b) => b.bytes - a.bytes),
  };
}

/* What grew between two snapshots, biggest byte growth first. `minBytes` drops the long tail of
 * ±few-hundred-byte classes that are just allocation noise between two GCs. */
export function diffAggregates(before, after, { minBytes = 4096, limit = 20 } = {}) {
  if (!before?.ok || !after?.ok) return { ok: false, why: before?.why || after?.why || "one side is not a snapshot" };
  const b = new Map(before.byClass.map((r) => [r.klass, r]));
  const rows = [];
  for (const a of after.byClass) {
    const prev = b.get(a.klass) || { nodes: 0, bytes: 0, detachedNodes: 0, detachedBytes: 0 };
    const dBytes = a.bytes - prev.bytes;
    if (Math.abs(dBytes) < minBytes) continue;
    rows.push({
      klass: a.klass,
      nodes: { from: prev.nodes, to: a.nodes, delta: a.nodes - prev.nodes },
      bytes: { from: prev.bytes, to: a.bytes, delta: dBytes },
      detachedNodes: { from: prev.detachedNodes, to: a.detachedNodes, delta: a.detachedNodes - prev.detachedNodes },
    });
  }
  rows.sort((x, y) => y.bytes.delta - x.bytes.delta);
  return {
    ok: true,
    totalBytesDelta: after.totalBytes - before.totalBytes,
    totalNodesDelta: after.totalNodes - before.totalNodes,
    detachedBytesDelta: after.detachedBytes - before.detachedBytes,
    detachedNodesDelta: after.detachedNodes - before.detachedNodes,
    detachedKnown: before.detachedKnown && after.detachedKnown,
    rows: rows.slice(0, limit),
  };
}

/* Per-interaction rate for a snapshot diff, so it reads in the same units as the growth table.
 * Returns null for a zero-span diff rather than dividing by zero. */
export function perInteraction(delta, interactions) {
  const n = Number(interactions);
  return Number.isFinite(n) && n > 0 && Number.isFinite(delta) ? +(delta / n).toFixed(1) : null;
}
