/* recomputeHash — a CHEAP, BOUNDED, STRUCTURAL fingerprint of an arbitrary JavaScript value.
 *
 * WHY THIS EXISTS (NEW-1, the view-independent-work detector).
 * The detector's whole question is "did this computation run again and produce THE SAME ANSWER?".
 * Answering it needs a comparison that is
 *   • STRUCTURAL, not identity-based — the defect class is precisely a function returning a FRESH
 *     object holding an IDENTICAL answer, so `===` and `Object.is` say "different" on every single
 *     instance of the bug. A reference compare would report zero violations forever.
 *   • BOUNDED — the values being hashed include React element trees (thousands of nodes, cyclic
 *     through `_owner`), DOM nodes, and 60-vertex geometry arrays. An unbounded deep walk would
 *     dominate the very measurement it is taking.
 *   • DETERMINISTIC — object key order is not, so keys are sorted. Two runs of the same program
 *     must agree or the instrument invents violations.
 *
 * Deliberately dependency-free and PURE, so it is unit-tested (test/recomputeProbe.test.js) and
 * cannot drift from what the harness claims it does. It runs in the BROWSER (imported by
 * recomputeProbeRuntime.js under the probe build) and in NODE (the tests), so: no node built-ins,
 * no DOM built-ins referenced without a typeof guard.
 *
 * ⚠ WHAT THIS HASH DELIBERATELY CANNOT TELL APART, stated so a report is read correctly:
 *   • Two DIFFERENT functions with the same `.name` (or two anonymous ones) hash the same. Closures
 *     are the common case in a dependency array — `[onSelect]` where `onSelect` is a fresh arrow
 *     each render — and hashing them by identity would make EVERY dep array look changed, which is
 *     the opposite of informative. The consequence is stated on the report: a site whose only
 *     changing dep is a closure reads as "inputs unchanged", which is the honest reading of the
 *     situation anyway (a fresh closure with the same body is not new information).
 *   • Numbers are hashed by their decimal string, so 0.1+0.2 and 0.30000000000000004 differ. That
 *     is correct: a recomputation that lands on a different float IS a different answer.
 *   • Beyond `maxDepth` / `maxNodes` the walk stops and says so (`truncated`). A truncated hash can
 *     produce a FALSE "identical" — never a false "changed" — so the detector treats a truncated
 *     comparison as evidence that needs the ms/scaling column to corroborate it, and prints the
 *     flag rather than hiding it.
 */

/** FNV-1a, 32-bit, streaming. Chosen for being four lines and having no dependencies; this is a
 *  change-detector, not a security primitive. */
export const HASH_SEED = 2166136261;

export function hashStep(hash, str) {
  let h = hash >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* React attaches `_owner` (a Fiber — cyclic, enormous, and different for the same element) and
 * `_store`/`_self`/`_source` (dev bookkeeping) to every element it creates. Walking them measures
 * React's internals rather than the app's answer, so they are skipped by name. */
const SKIP_KEYS = new Set(["_owner", "_store", "_self", "_source", "__self", "__source"]);

const isDomNode = (v) => typeof Node !== "undefined" && v instanceof Node;

/**
 * Fingerprint `value`.
 * @returns {{hash:string, nodes:number, truncated:boolean}} — `hash` is an 8-char hex string.
 */
export function structuralHash(value, { maxDepth = 8, maxNodes = 4000, maxString = 512 } = {}) {
  let h = HASH_SEED;
  let nodes = 0;
  let truncated = false;
  const seen = new Set();

  const emit = (tok) => { h = hashStep(h, tok); };

  const walk = (v, depth) => {
    if (nodes >= maxNodes) { truncated = true; return; }
    nodes++;

    const t = typeof v;
    if (v === null) return emit("n");
    if (v === undefined) return emit("u");
    if (t === "boolean") return emit(v ? "b1" : "b0");
    if (t === "number") return emit(Number.isFinite(v) ? `d${v}` : `d${String(v)}`);
    if (t === "bigint") return emit(`g${v}`);
    if (t === "symbol") return emit(`y${String(v.description ?? "")}`);
    if (t === "string") {
      // Long strings are hashed by their ends plus their length: a change in the middle of a
      // 100 KB string is not a case this detector needs to see, and full hashing of one would
      // cost more than the computation being measured.
      if (v.length <= maxString) return emit(`s${v.length}:${v}`);
      truncated = true;
      return emit(`s${v.length}:${v.slice(0, maxString / 2)}…${v.slice(-maxString / 2)}`);
    }
    if (t === "function") return emit(`f${v.name || ""}/${v.length}`);

    // Objects from here down.
    if (isDomNode(v)) return emit(`N${v.nodeName}#${v.id || ""}`);
    if (seen.has(v)) return emit("↺");
    if (depth >= maxDepth) { truncated = true; return emit("…"); }
    seen.add(v);

    if (Array.isArray(v)) {
      emit(`A${v.length}`);
      for (let i = 0; i < v.length; i++) {
        if (nodes >= maxNodes) { truncated = true; break; }
        walk(v[i], depth + 1);
      }
      seen.delete(v);
      return;
    }
    if (v instanceof Date) { seen.delete(v); return emit(`D${v.getTime()}`); }
    if (typeof Map !== "undefined" && v instanceof Map) {
      emit(`M${v.size}`);
      // Insertion order is part of a Map's identity and is stable for the same program, so it is
      // hashed as-is rather than sorted (sorting arbitrary keys is not well defined).
      for (const [k, val] of v) { if (nodes >= maxNodes) { truncated = true; break; } walk(k, depth + 1); walk(val, depth + 1); }
      seen.delete(v);
      return;
    }
    if (typeof Set !== "undefined" && v instanceof Set) {
      emit(`S${v.size}`);
      for (const val of v) { if (nodes >= maxNodes) { truncated = true; break; } walk(val, depth + 1); }
      seen.delete(v);
      return;
    }
    if (ArrayBuffer.isView(v)) {
      emit(`T${v.constructor?.name || ""}${v.length}`);
      const step = Math.max(1, Math.floor(v.length / 64));      // sample, never walk a raster
      for (let i = 0; i < v.length; i += step) emit(`d${v[i]}`);
      if (step > 1) truncated = true;
      seen.delete(v);
      return;
    }

    const keys = [];
    for (const k of Object.keys(v)) if (!SKIP_KEYS.has(k)) keys.push(k);
    keys.sort();
    emit(`O${keys.length}`);
    for (const k of keys) {
      if (nodes >= maxNodes) { truncated = true; break; }
      emit(`k${k}`);
      walk(v[k], depth + 1);
    }
    seen.delete(v);
  };

  try {
    walk(value, 0);
  } catch {
    // A getter that throws, a revoked Proxy, a cross-origin object. Never let the instrument
    // take the app down — record it as its own bucket instead.
    emit("!throw");
  }
  return { hash: (h >>> 0).toString(16).padStart(8, "0"), nodes, truncated };
}

/** The dependency-array case: hash each entry separately so a report can name WHICH dep moved. */
export function depsFingerprint(deps, opts) {
  if (!Array.isArray(deps)) return { hash: "nodeps", per: [], truncated: false };
  let h = HASH_SEED;
  let truncated = false;
  const per = [];
  for (const d of deps) {
    const r = structuralHash(d, opts);
    per.push(r.hash);
    truncated = truncated || r.truncated;
    h = hashStep(h, r.hash);
  }
  return { hash: (h >>> 0).toString(16).padStart(8, "0"), per, truncated };
}
