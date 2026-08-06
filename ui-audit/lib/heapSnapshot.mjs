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

/* ---- RETAINING PATHS (B1439, second attempt, 2026-08-06) ----------------------------------------
 *
 * WHY THIS WAS ADDED, and what the first attempt could not do. B1439 is a REPRODUCIBLE SIGNATURE
 * WITH NO MECHANISM: A→B→A leaves `rendererNodes` +93.9 / +97.1 / +96.6 / +95.2% across four runs
 * while `documentNodes` and `canvasNodes` return exactly. Aggregating a snapshot by class (above)
 * can say a class GREW; it cannot say WHO IS HOLDING IT, and B1434's standing rule is that a fix
 * shipped against a signal nobody can explain is not a fix. Naming the holder needs the EDGES.
 *
 * WHAT A PATH COSTS, stated because it is the reason this was not built the first time. The edge
 * table is the big half of a snapshot (1–3 edges per node) and a retaining path is a search
 * BACKWARDS along it, which the format does not index. `retainerIndex` builds that reverse index
 * once, in typed arrays, and every path query then runs against it.
 *
 * ⛔ WHAT A PATH IS AND IS NOT. This walks the shortest edge chain from a GC root to the node, which
 * is what DevTools shows and is USUALLY the holder. It is not a dominator tree: a node held by two
 * independent chains has two honest answers and this returns one of them. Where that matters the
 * caller is told how many distinct retainers the node has, so "one holder" is never inferred from
 * "one path".
 */

/** Parse the parts of a snapshot needed to walk edges. Returns typed arrays, or `{ok:false, why}`. */
export function edgeIndex(snap) {
  const meta = snap?.snapshot?.meta;
  const nf = meta?.node_fields, ef = meta?.edge_fields;
  const nodes = snap?.nodes, edges = snap?.edges, strings = snap?.strings;
  if (!Array.isArray(nf) || !Array.isArray(ef) || !Array.isArray(nodes) || !Array.isArray(edges) || !Array.isArray(strings)) {
    return { ok: false, why: "not a heap snapshot — missing nodes / edges / strings / meta" };
  }
  const NW = nf.length, EW = ef.length;
  const iEdgeCount = nf.indexOf("edge_count");
  const iToNode = ef.indexOf("to_node"), iEType = ef.indexOf("type"), iEName = ef.indexOf("name_or_index");
  if (iEdgeCount < 0 || iToNode < 0) return { ok: false, why: "snapshot has no edge_count / to_node columns" };
  const nodeCount = Math.floor(nodes.length / NW);
  // Outgoing edges are stored in NODE ORDER, contiguously — so a prefix sum of edge_count is the
  // whole index of "where do node i's edges start".
  const firstEdge = new Uint32Array(nodeCount + 1);
  let acc = 0;
  for (let i = 0; i < nodeCount; i++) { firstEdge[i] = acc; acc += nodes[i * NW + iEdgeCount] || 0; }
  firstEdge[nodeCount] = acc;
  return {
    ok: true, NW, EW, nodeCount, edgeCount: acc, firstEdge, nodes, edges, strings,
    nf, ef, iToNode, iEType, iEName,
    iName: nf.indexOf("name"), iType: nf.indexOf("type"), iSize: nf.indexOf("self_size"),
    iDet: nf.indexOf("detachedness"), iId: nf.indexOf("id"),
    nodeTypes: meta.node_types?.[0] || [], edgeTypes: meta.edge_types?.[0] || [],
  };
}

/** Reverse the edge table: for each node, EVERY node that points at it, in CSR form.
 *
 * ⛔ ALL retainers, not the first one — and this was wrong on the first attempt in a way that
 * produced a confident, readable, useless answer. Keeping only the first retainer in node order
 * always selects V8's own handle tables ("Traced handles" / "Global handles"), because every DOM
 * wrapper is in one and those synthetic nodes sit at the very start of the node array. So every
 * path came back three steps long and named the same table, which is true of literally every DOM
 * node in the heap and therefore says nothing about who is leaking one.
 */
export function retainerIndex(ix) {
  if (!ix?.ok) return ix;
  const { nodeCount, firstEdge, edges, EW, iToNode, NW } = ix;
  const total = firstEdge[nodeCount];
  const counts = new Uint32Array(nodeCount);
  for (let e = 0; e < total; e++) {
    const to = Math.floor((edges[e * EW + iToNode] || 0) / NW);
    if (to >= 0 && to < nodeCount) counts[to]++;
  }
  const start = new Uint32Array(nodeCount + 1);
  for (let n = 0; n < nodeCount; n++) start[n + 1] = start[n] + counts[n];
  const cursor = start.slice(0, nodeCount);
  const fromNode = new Int32Array(start[nodeCount]);
  const viaEdge = new Int32Array(start[nodeCount]);
  for (let n = 0; n < nodeCount; n++) {
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) {
      const to = Math.floor((edges[e * EW + iToNode] || 0) / NW);
      if (to < 0 || to >= nodeCount) continue;
      const slot = cursor[to]++;
      fromNode[slot] = n; viaEdge[slot] = e;
    }
  }
  return { ...ix, retStart: start, retFrom: fromNode, retVia: viaEdge, retainerCount: counts };
}

const nodeType = (ix, n) => ix.nodeTypes[ix.nodes[n * ix.NW + ix.iType]] ?? "";
const isSynthetic = (ix, n) => nodeType(ix, n) === "synthetic";
const isDetached = (ix, n) => ix.iDet >= 0 && ix.nodes[n * ix.NW + ix.iDet] === 2;
/* ⛔ A `native` NODE IS NOT A HOLDER, and this cost a second wrong answer before it was written down.
 * Blink hangs satellite objects off every element — `SVGAnimatedLength`, `CSSStyleDeclaration`,
 * `Text`, `InternalNode` — and those satellites are NOT themselves flagged detached even when their
 * owner is. So "the first non-detached retainer" happily returned `SVGAnimatedLength → the detached
 * <rect>`, which is the element's own width attribute: perfectly true, and it names the leaked node
 * as its own holder. A holder has to be something OUR code could be keeping: a JS object, closure,
 * array or hidden class. Native retainers are traversed THROUGH, never reported AS the holder. */
const isNative = (ix, n) => nodeType(ix, n) === "native";

const nodeLabel = (ix, n) => {
  const name = ix.strings[ix.nodes[n * ix.NW + ix.iName]] ?? "(unknown)";
  const type = ix.nodeTypes[ix.nodes[n * ix.NW + ix.iType]] ?? "";
  return type && type !== "object" ? `${name} [${type}]` : name;
};

const edgeLabel = (ix, e) => {
  const t = ix.edgeTypes[ix.edges[e * ix.EW + ix.iEType]] ?? "";
  const raw = ix.edges[e * ix.EW + ix.iEName];
  // For `element` and `hidden` edges the field is an ARRAY INDEX, not a string-table offset.
  // Reading it as a string index there is how a retainer path starts naming random source text.
  const name = t === "element" || t === "hidden" ? `[${raw}]` : (ix.strings[raw] ?? `#${raw}`);
  return `${t}:${name}`;
};

/**
 * WHO IS HOLDING THIS DETACHED NODE?
 *
 * ⛔ THE QUESTION IS NOT "what is the shortest chain from a root", and confusing the two is what
 * made the first attempt useless. Every DOM wrapper is one edge from V8's handle table, so the
 * shortest chain to ANY node — leaked or not — is `(GC roots) → (Traced handles) → the node`. That
 * answer is always available, always true, and never distinguishes a leak from a live element.
 *
 * The useful question is: **walking backwards out of the detached subtree, what is the first thing
 * holding it that is NOT itself detached?** That node is the holder. A breadth-first search over
 * the reverse graph answers it, with two rules:
 *   • SYNTHETIC nodes (the handle tables, the root set) are never traversed THROUGH — they are the
 *     trivial answer. If the only retainers anywhere are synthetic, that is itself the finding and
 *     it is reported as such: the reference is on the BLINK side (an event listener, an observer,
 *     an animation), not at the end of a JS chain, and no heap path can name it.
 *   • The search stops at the first non-detached, non-synthetic node — the holder — and the whole
 *     chain from it down to the target is returned with every edge named.
 */
export function holderOf(rix, target, { maxNodes = 200000, maxDepth = 25 } = {}) {
  if (!rix?.ok) return { ok: false, why: rix?.why || "no index" };
  const prev = new Map([[target, null]]);
  let frontier = [target], depth = 0, visited = 1;
  while (frontier.length && depth++ < maxDepth && visited < maxNodes) {
    const next = [];
    for (const n of frontier) {
      for (let s = rix.retStart[n]; s < rix.retStart[n + 1]; s++) {
        const p = rix.retFrom[s];
        if (prev.has(p) || isSynthetic(rix, p)) continue;
        prev.set(p, { child: n, edge: rix.retVia[s] });
        visited++;
        if (!isDetached(rix, p) && !isNative(rix, p)) {
          // Found the holder. Unwind from it down to the target.
          const chain = [];
          let cur = p, step = prev.get(p);
          chain.push({ node: nodeLabel(rix, cur), retainers: rix.retainerCount[cur], via: null, detached: false });
          while (step) {
            chain.push({ node: nodeLabel(rix, step.child), retainers: rix.retainerCount[step.child], via: edgeLabel(rix, step.edge), detached: isDetached(rix, step.child) });
            const nx = prev.get(step.child);
            step = nx && nx.child != null ? nx : null;
            if (chain.length > maxDepth + 2) break;
          }
          return { ok: true, held: true, depth, chain };
        }
        next.push(p);
      }
    }
    frontier = next;
  }
  return {
    ok: true, held: false, depth, chain: [{ node: nodeLabel(rix, target), retainers: rix.retainerCount[target], via: null, detached: true }],
    why: visited >= maxNodes || depth >= maxDepth
      ? `no non-detached holder found within ${depth} steps / ${visited} nodes — the subtree is larger than the search`
      : "NO JS HOLDER EXISTS. Every retainer of this node is another detached node, one of Blink's own satellite objects (an attribute wrapper, a style declaration), or one of V8's handle tables — so the reference keeping it alive is on the BLINK side: an event listener still registered, an observer still observing, or a running animation. A heap snapshot cannot name which; the listener census can.",
  };
}

/**
 * Shortest retaining chain from a GC root down to `target`, as readable steps. Kept because it is
 * the right answer for a NON-detached object (what is holding this big array?), and is explicitly
 * the WRONG tool for a detached DOM node — see `holderOf`.
 */
export function retainingPath(rix, target, { maxDepth = 40 } = {}) {
  if (!rix?.ok) return { ok: false, why: rix?.why || "no index" };
  const steps = [];
  let n = target, guard = 0;
  const seen = new Set();
  while (n >= 0 && guard++ < maxDepth && !seen.has(n)) {
    seen.add(n);
    const s = rix.retStart[n];
    const has = s < rix.retStart[n + 1];
    steps.push({ node: nodeLabel(rix, n), retainers: rix.retainerCount[n], via: has ? edgeLabel(rix, rix.retVia[s]) : null });
    if (!has) break;
    n = rix.retFrom[s];
  }
  return { ok: true, truncated: guard >= maxDepth, path: steps.reverse() };
}

/**
 * Every node V8 itself flagged DETACHED (detachedness === 2), heaviest first.
 * `detachedKnown:false` means the column is absent and the answer is UNKNOWN — never zero.
 */
export function detachedNodes(ix, { limit = 40 } = {}) {
  if (!ix?.ok) return { ok: false, why: ix?.why };
  if (ix.iDet < 0) return { ok: true, detachedKnown: false, nodes: [], why: "this Chrome's snapshot has no detachedness column — the answer is UNKNOWN, not zero" };
  const out = [];
  for (let n = 0; n < ix.nodeCount; n++) {
    if (ix.nodes[n * ix.NW + ix.iDet] !== 2) continue;
    out.push({ idx: n, klass: nodeLabel(ix, n), bytes: ix.nodes[n * ix.NW + ix.iSize] || 0 });
  }
  out.sort((a, b) => b.bytes - a.bytes);
  return { ok: true, detachedKnown: true, total: out.length, totalBytes: out.reduce((a, b) => a + b.bytes, 0), nodes: out.slice(0, limit) };
}

/** Roll a list of detached nodes up by class, so a path is chased once per class, not once per node. */
export function detachedByClass(det, { limit = 12 } = {}) {
  if (!det?.ok || !det.detachedKnown) return [];
  const m = new Map();
  for (const n of det.nodes) {
    const r = m.get(n.klass) || { klass: n.klass, nodes: 0, bytes: 0, sample: n.idx };
    r.nodes++; r.bytes += n.bytes;
    m.set(n.klass, r);
  }
  return [...m.values()].sort((a, b) => b.bytes - a.bytes).slice(0, limit);
}
