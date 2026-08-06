/* The VIEW-INDEPENDENT-ONCE detector's pure core (NEW-1/NEW-3).
 *
 * The detector's whole value is that its verdict is a MEASUREMENT rather than a judgement call, so
 * the two things it rests on — the structural fingerprint and the rule that turns fingerprints
 * into a verdict — are unit-tested here. If either drifts, the enumeration in
 * `ui-audit/detect-view-recompute.mjs` and the standing guard in
 * `ui-audit/verify-view-independent.mjs` both quietly change meaning.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { structuralHash, depsFingerprint, hashStep, HASH_SEED } from "../ui-audit/lib/recomputeHash.mjs";
import {
  classifySite, classifyGesture, scaleSlope, rankViolations, inverseFindings, guardVerdict, isViolation,
} from "../ui-audit/lib/viewIndependence.mjs";

describe("structuralHash — the comparison that reference equality cannot make", () => {
  it("two FRESHLY BUILT objects holding the same answer hash the same", () => {
    // This is the entire reason the class hid: every instance of the bug returns a new object with
    // an identical answer, so `Object.is` — which is all React's memo does — says "changed".
    const a = { rung: "inline", lines: ["Detention Pond", "6.58 ac"], box: { x: 1.5, y: 2.5 } };
    const b = { rung: "inline", lines: ["Detention Pond", "6.58 ac"], box: { x: 1.5, y: 2.5 } };
    expect(a).not.toBe(b);
    expect(structuralHash(a).hash).toBe(structuralHash(b).hash);
  });

  it("a real difference changes the hash", () => {
    const a = { lines: ["Detention Pond", "6.58 ac"] };
    const b = { lines: ["Detention Pond", "6.59 ac"] };
    expect(structuralHash(a).hash).not.toBe(structuralHash(b).hash);
  });

  it("key ORDER does not change the hash — object key order is not deterministic", () => {
    expect(structuralHash({ a: 1, b: 2 }).hash).toBe(structuralHash({ b: 2, a: 1 }).hash);
  });

  it("array ORDER does — a reordered draw list is a different answer", () => {
    expect(structuralHash([1, 2, 3]).hash).not.toBe(structuralHash([3, 2, 1]).hash);
  });

  it("distinguishes null / undefined / 0 / '' / false, which a loose compare would merge", () => {
    const hs = [null, undefined, 0, "", false, NaN].map((v) => structuralHash(v).hash);
    expect(new Set(hs).size).toBe(6);
  });

  it("survives a cycle instead of blowing the stack (React elements carry one via _owner)", () => {
    const a = { name: "loop" };
    a.self = a;
    expect(() => structuralHash(a)).not.toThrow();
    expect(structuralHash(a).hash).toHaveLength(8);
  });

  it("skips React's own bookkeeping keys, so two equal elements agree", () => {
    const el = (owner) => ({ type: "g", key: "k1", props: { x: 1 }, _owner: owner, _store: {} });
    expect(structuralHash(el({ fiber: 1 })).hash).toBe(structuralHash(el({ fiber: 2 })).hash);
  });

  it("reports truncation rather than silently claiming equality", () => {
    const deep = (n) => (n ? { child: deep(n - 1) } : 1);
    expect(structuralHash(deep(30), { maxDepth: 4 }).truncated).toBe(true);
    expect(structuralHash({ a: 1 }).truncated).toBe(false);
  });

  it("hashes functions by NAME, not identity — a fresh closure is not new information", () => {
    const mk = () => function onSelect() {};
    expect(structuralHash(mk()).hash).toBe(structuralHash(mk()).hash);
  });

  it("is stable across runs (no Math.random, no Date, no insertion order)", () => {
    const v = { a: [1, { b: "x" }], m: new Map([["k", 1]]), s: new Set([1, 2]) };
    expect(structuralHash(v).hash).toBe(structuralHash(v).hash);
  });

  it("hashStep is a pure fold over the seed", () => {
    expect(hashStep(HASH_SEED, "ab")).toBe(hashStep(hashStep(HASH_SEED, "a"), "b"));
  });
});

describe("depsFingerprint — per-dependency, so a report can name which one moved", () => {
  it("returns one hash per dep plus a combined one", () => {
    const f = depsFingerprint([1, "a", { x: 1 }]);
    expect(f.per).toHaveLength(3);
    expect(f.hash).toHaveLength(8);
  });
  it("a non-array (a useMemo with no dep list) is its own bucket", () => {
    expect(depsFingerprint(undefined).hash).toBe("nodeps");
  });
  it("a changed dep changes the combined hash", () => {
    expect(depsFingerprint([1, 2]).hash).not.toBe(depsFingerprint([1, 3]).hash);
  });
});

const site = (over) => ({ id: "x", kind: "memo", file: "f.js", line: 1, name: "n", ms: 10, renders: 0, ...over });

describe("classifySite — the rule, stated once", () => {
  it("ran once → `once`, and is not a violation", () => {
    const c = classifySite(site({ calls: 1, inputs: ["a"], results: ["r"] }));
    expect(c.verdict).toBe("once");
    expect(c.violation).toBe(false);
  });

  it("SAME inputs, SAME result, many calls → `redundant` (a missing memo)", () => {
    const c = classifySite(site({ calls: 3, inputs: ["a", "a", "a"], results: ["r", "r", "r"] }));
    expect(c.verdict).toBe("redundant");
    expect(c.violation).toBe(true);
  });

  it("inputs MOVED, result did NOT → `view-churned` — the class the owner named", () => {
    // Both known instances are this shape: a view term is in the key, the answer does not use it.
    const c = classifySite(site({ calls: 60, inputs: Array.from({ length: 60 }, (_, i) => `in${i}`), results: Array(60).fill("r") }));
    expect(c.verdict).toBe("view-churned");
    expect(c.violation).toBe(true);
    expect(c.distinctInputs).toBe(60);
    expect(c.distinctResults).toBe(1);
  });

  it("the answer genuinely moved → `productive`, and is NOT reported (the cull rect, the scale bar)", () => {
    const c = classifySite(site({ calls: 3, inputs: ["a", "b", "c"], results: ["1", "2", "3"] }));
    expect(c.verdict).toBe("productive");
    expect(c.violation).toBe(false);
  });

  it("refuses to accuse a site it only counted — a damped hot leaf is not evidence", () => {
    expect(classifySite(site({ calls: 90000, inputs: [], results: [] })).verdict).toBe("productive");
  });

  it("`wasteMs` is everything after the first call, so a once-per-gesture site shows no saving", () => {
    expect(classifySite(site({ calls: 1, ms: 10, inputs: ["a"], results: ["r"] })).wasteMs).toBe(0);
    expect(classifySite(site({ calls: 2, ms: 10, inputs: ["a", "a"], results: ["r", "r"] })).wasteMs).toBe(5);
  });

  it("classifyGesture maps the whole set", () => {
    expect(classifyGesture([site({ calls: 1, inputs: ["a"], results: ["r"] })])[0].verdict).toBe("once");
  });

  it("isViolation names exactly the two violating verdicts", () => {
    expect(["view-churned", "redundant"].every(isViolation)).toBe(true);
    expect(["productive", "once"].some(isViolation)).toBe(false);
  });
});

describe("scaleSlope — does it get worse as the owner draws more?", () => {
  it("a flat ladder is flat", () => {
    expect(scaleSlope([{ n: 60, ms: 10 }, { n: 180, ms: 10.2 }]).shape).toBe("flat");
  });
  it("a growing ladder is named and its per-element cost reported", () => {
    const s = scaleSlope([{ n: 60, ms: 10 }, { n: 180, ms: 40 }]);
    expect(s.shape).toBe("scales-with-plan");
    expect(s.slope).toBeCloseTo(0.25, 5);
  });
  it("one rung cannot be a slope, and says so rather than guessing zero", () => {
    expect(scaleSlope([{ n: 60, ms: 10 }]).shape).toBe("unmeasured");
  });
});

describe("rankViolations — the order NEW-2 fixes downward in", () => {
  it("ranks by cost × scaling, and never lists a non-violation", () => {
    const sites = classifyGesture([
      site({ id: "cheap-but-scaling", calls: 10, ms: 5, inputs: Array(10).fill("a"), results: Array(10).fill("r") }),
      site({ id: "expensive-flat", calls: 10, ms: 40, inputs: Array(10).fill("a"), results: Array(10).fill("r") }),
      site({ id: "fine", calls: 1, ms: 100, inputs: ["a"], results: ["r"] }),
    ]);
    const ranked = rankViolations(sites, {
      ladders: { "cheap-but-scaling": [{ n: 60, ms: 5 }, { n: 180, ms: 65 }], "expensive-flat": [{ n: 60, ms: 40 }, { n: 180, ms: 40 }] },
      planSpan: 180,
    });
    expect(ranked.map((r) => r.id)).toEqual(["cheap-but-scaling", "expensive-flat"]);
  });
});

describe("inverseFindings — over-memoisation, reported and never 'fixed'", () => {
  it("a declared view-derived value that never moved under a zoom is reported", () => {
    const zoom = classifyGesture([site({ file: "S.jsx", name: "labelFrame", calls: 12, inputs: Array.from({ length: 12 }, (_, i) => `i${i}`), results: Array(12).fill("r") })]);
    expect(inverseFindings(zoom, ["S.jsx:labelFrame"])[0].finding).toBe("frozen-through-zoom");
  });

  it("is keyed on file:NAME like the guard registry, never on the probe's line-bearing id", () => {
    // A `file:line:col#memo` key would go stale on the next unrelated edit above the memo, and the
    // finding would silently become "never-ran" — a false alarm that reads like a real one.
    const zoom = classifyGesture([site({ id: "S.jsx:99999:4#memo", file: "S.jsx", name: "labelFrame", calls: 3, inputs: ["a", "b", "c"], results: ["1", "2", "3"] })]);
    expect(inverseFindings(zoom, ["S.jsx:labelFrame"])).toEqual([]);
  });
  it("one that never executed is reported too, not silently passed", () => {
    expect(inverseFindings([], ["nope"])[0].finding).toBe("never-ran");
  });
  it("a value that tracked the zoom produces no finding", () => {
    const zoom = classifyGesture([site({ file: "S.jsx", name: "renderView", calls: 3, inputs: ["a", "b", "c"], results: ["1", "2", "3"] })]);
    expect(inverseFindings(zoom, ["S.jsx:renderView"])).toEqual([]);
  });
});

describe("guardVerdict — the standing counter-based guard (NEW-3)", () => {
  const registry = [{ file: "S.jsx", name: "drawEls", why: "the visible element set" }];

  it("passes when the registered computation ran at most once", () => {
    const v = guardVerdict(classifyGesture([site({ file: "S.jsx", name: "drawEls", calls: 1, inputs: ["a"], results: ["r"] })]), registry);
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(1);
  });

  it("FAILS when it ran twice during a pure pan, and names the count", () => {
    const v = guardVerdict(classifyGesture([site({ file: "S.jsx", name: "drawEls", calls: 60, inputs: Array.from({ length: 60 }, (_, i) => `i${i}`), results: Array(60).fill("r") })]), registry);
    expect(v.ok).toBe(false);
    expect(v.failures[0].calls).toBe(60);
    expect(v.failures[0].why).toContain("ran 60×");
  });

  it("⛔ FAILS when a registered computation was never OBSERVED — the way a guard rots", () => {
    // A renamed or deleted memo makes the probe record nothing. A guard that only checks what it
    // happens to see would report green forever; this is what stops that.
    const v = guardVerdict([], registry);
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(["S.jsx:drawEls"]);
  });

  it("is keyed on file:NAME, never file:line — a line number moves on every unrelated edit", () => {
    const moved = classifyGesture([site({ file: "S.jsx", line: 99999, name: "drawEls", calls: 1, inputs: ["a"], results: ["r"] })]);
    expect(guardVerdict(moved, registry).ok).toBe(true);
  });
});

describe("the probe never reaches a production bundle", () => {
  it("the Vite plugin is inert without PLANYR_PROBE=1", async () => {
    const { default: probe } = await import("../scripts/vite-plugin-recompute-probe.mjs");
    const off = probe({ enabled: false });
    expect(off.name).toContain("off");
    expect(off.transform).toBeUndefined();
    expect(probe({ enabled: true }).transform).toBeTypeOf("function");
  });

  it("vite.config.js calls it with NO forced-on flag, so only the environment can arm it", () => {
    const cfg = readFileSync(new URL("../vite.config.js", import.meta.url), "utf8");
    expect(cfg).toContain("recomputeProbe()");
    expect(cfg).not.toContain("recomputeProbe({ enabled: true");
  });
});
