/* cpuProfile — fold a CDP `Profiler.stop` profile into SELF TIME per function. (B227888)
 *
 * A V8 sampling profile is a call TREE plus a flat sample stream: `samples[i]` is the id of the
 * node that was on top of the stack at `timeDeltas[i]` microseconds after the previous sample. So
 * self time per node is just the sum of the deltas attributed to it — no tree walk needed, and no
 * double counting of a parent's children (which is what makes "total time" useless for finding
 * the function that is actually burning the CPU).
 *
 * Functions are keyed by `name @ file:line` rather than by node id, because the same function
 * appears as many nodes (one per distinct call path) and a per-node ranking scatters one hot
 * function across a dozen rows.
 *
 * Pure — no playwright, no DOM — so it unit-tests without a browser.
 */

const SHORT = (url) => String(url || "").replace(/^https?:\/\/[^/]+\//, "").replace(/\?.*$/, "");

export function selfTimeByFunction(profile) {
  const out = new Map();
  if (!profile || !Array.isArray(profile.nodes)) return out;
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const key = (n) => {
    const cf = n.callFrame || {};
    const name = cf.functionName || "(anonymous)";
    const at = cf.url ? `${SHORT(cf.url)}:${(cf.lineNumber ?? 0) + 1}` : "(native)";
    return `${name} @ ${at}`;
  };

  /* Prefer the flat sample stream (precise), fall back to each node's own `hitCount` scaled by
   * the profile's mean sample interval when a profile arrives without samples. */
  const samples = profile.samples || [];
  const deltas = profile.timeDeltas || [];
  if (samples.length && deltas.length === samples.length) {
    for (let i = 0; i < samples.length; i++) {
      const n = byId.get(samples[i]);
      if (!n) continue;
      const k = key(n);
      // timeDeltas[i] is the gap BEFORE sample i, i.e. the time the previous sample's frame ran.
      const us = Math.max(0, deltas[i] || 0);
      out.set(k, (out.get(k) || 0) + us / 1000);
    }
    return out;
  }
  const totalUs = Math.max(0, (profile.endTime || 0) - (profile.startTime || 0));
  const hits = profile.nodes.reduce((s, n) => s + (n.hitCount || 0), 0) || 1;
  for (const n of profile.nodes) {
    if (!n.hitCount) continue;
    const k = key(n);
    out.set(k, (out.get(k) || 0) + ((n.hitCount / hits) * totalUs) / 1000);
  }
  return out;
}

/* Median across reps, per function key. A mean would let one contaminated rep set the table, which
 * is the estimator defect `PERF-BAIN.md` §6 documents. */
const medianOf = (xs) => {
  const s = xs.slice().sort((p, q) => p - q);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function mergeReps(maps) {
  const keys = new Set();
  for (const m of maps) for (const k of m.keys()) keys.add(k);
  const out = new Map();
  for (const k of keys) out.set(k, medianOf(maps.map((m) => m.get(k) || 0)));
  return out;
}

/* The deliverable: functions ranked by how much MORE they cost in arm `a` than in arm `b`. A
 * ranking of arm `a` alone would put React's reconciler and the SVG attribute setters on top in
 * both arms and say nothing about what the rings are buying. */
export function diffProfiles(merged, armA, armB) {
  const A = mergeReps((merged.find((m) => m.arm === armA) || { self: [] }).self);
  const B = mergeReps((merged.find((m) => m.arm === armB) || { self: [] }).self);
  const keys = new Set([...A.keys(), ...B.keys()]);
  return [...keys]
    .map((name) => ({ name, a: A.get(name) || 0, b: B.get(name) || 0, delta: (A.get(name) || 0) - (B.get(name) || 0) }))
    .sort((p, q) => q.delta - p.delta);
}
