/* lastDoc — per-project "last document reviewed" memory for the Review workspace.
 * Each project must keep its own entry; the legacy global pointers stay the fallback so
 * existing devices resume on day one; corrupt storage boots clean (clear + empty). */
import { describe, it, expect, beforeEach } from "vitest";
import {
  readLastDocMap, writeLastDoc, readLastDoc, readLegacyPointers, resolveResume, resumeAllowedForRoute,
} from "../src/workspaces/doc-review/lib/lastDoc.js";

const KEY = "planyr:docreview:lastDoc:v1";

function makeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.delete(k); map.set(k, String(v)); },
    removeItem: (k) => map.delete(k),
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
  };
}

beforeEach(() => { globalThis.localStorage = makeStore(); });

describe("lastDoc — per-project map", () => {
  it("keeps one entry per project, isolated", () => {
    writeLastDoc("projA", { id: "rvA", mode: "review" });
    writeLastDoc("projB", { id: "rvB", mode: "stitch" });
    expect(readLastDoc("projA")).toEqual({ id: "rvA", mode: "review" });
    expect(readLastDoc("projB")).toEqual({ id: "rvB", mode: "stitch" });
    expect(readLastDoc("projC")).toBe(null);
  });

  it("null/empty projectId lands in the unfiled ('') bucket", () => {
    writeLastDoc(null, { id: "rvU", mode: "review" });
    expect(readLastDoc(null)).toEqual({ id: "rvU", mode: "review" });
    expect(readLastDoc("")).toEqual({ id: "rvU", mode: "review" });
    expect(readLastDocMap()[""]).toEqual({ id: "rvU", mode: "review" });
  });

  it("overwrites the same project's entry (last open wins)", () => {
    writeLastDoc("p", { id: "one", mode: "review" });
    writeLastDoc("p", { id: "two", mode: "review" });
    expect(readLastDoc("p")).toEqual({ id: "two", mode: "review" });
  });

  it("rejects entries without a real id; junk mode normalizes to review", () => {
    writeLastDoc("p", { id: "", mode: "review" });
    expect(readLastDoc("p")).toBe(null);
    writeLastDoc("p", { id: "x", mode: "bogus" });
    expect(readLastDoc("p")).toEqual({ id: "x", mode: "review" });
  });

  it("corrupt map reads empty AND clears the key", () => {
    localStorage.setItem(KEY, "{nope");
    expect(readLastDocMap()).toEqual({});
    expect(localStorage.getItem(KEY)).toBe(null);
    localStorage.setItem(KEY, JSON.stringify([1, 2]));
    expect(readLastDocMap()).toEqual({});
    expect(localStorage.getItem(KEY)).toBe(null);
  });

  it("malformed entries inside an otherwise-good map are dropped", () => {
    localStorage.setItem(KEY, JSON.stringify({ good: { id: "x", mode: "stitch" }, bad: { mode: "review" }, worse: 7 }));
    expect(readLastDocMap()).toEqual({ good: { id: "x", mode: "stitch" } });
  });
});

describe("lastDoc — legacy pointers", () => {
  it("reads the legacy trio with defaults", () => {
    expect(readLegacyPointers()).toEqual({ mode: "review", singleId: null, stitchId: null });
    localStorage.setItem("planyr:docreview:lastMode", "stitch");
    localStorage.setItem("planyr:docreview:lastSingleId", "s1");
    localStorage.setItem("planyr:docreview:lastStitchId", "t1");
    expect(readLegacyPointers()).toEqual({ mode: "stitch", singleId: "s1", stitchId: "t1" });
  });
});

describe("lastDoc — resolveResume precedence", () => {
  const legacy = { mode: "review", singleId: "leg-s", stitchId: "leg-t" };

  it("URL project: that project's map entry first, then legacy", () => {
    const map = { pA: { id: "docA", mode: "review" } };
    expect(resolveResume({ routeProjectId: "pA", map, legacy }))
      .toEqual([{ id: "docA", mode: "review" }, { id: "leg-s", mode: "review" }]);
  });

  it("URL project with no map entry falls back to legacy candidates", () => {
    expect(resolveResume({ routeProjectId: "pZ", map: {}, legacy }))
      .toEqual([{ id: "leg-s", mode: "review" }]);
  });

  it("no URL project: legacy first (today's semantics), then the unfiled bucket", () => {
    const map = { "": { id: "unfiled", mode: "review" } };
    expect(resolveResume({ routeProjectId: null, map, legacy }))
      .toEqual([{ id: "leg-s", mode: "review" }, { id: "unfiled", mode: "review" }]);
  });

  it("legacy stitch-mode rule preserved: stitch pointer tried first, then single", () => {
    const stitchLegacy = { mode: "stitch", singleId: "leg-s", stitchId: "leg-t" };
    expect(resolveResume({ routeProjectId: null, map: {}, legacy: stitchLegacy }))
      .toEqual([{ id: "leg-t", mode: "stitch" }, { id: "leg-s", mode: "review" }]);
  });

  it("legacy review-mode rule preserved: the stitch pointer is NOT a candidate", () => {
    expect(resolveResume({ routeProjectId: null, map: {}, legacy }))
      .toEqual([{ id: "leg-s", mode: "review" }]);
  });

  it("dedupes a map entry that matches a legacy pointer", () => {
    const map = { pA: { id: "leg-s", mode: "review" } };
    expect(resolveResume({ routeProjectId: "pA", map, legacy }))
      .toEqual([{ id: "leg-s", mode: "review" }]);
  });

  it("nothing anywhere → no candidates", () => {
    expect(resolveResume({ routeProjectId: null, map: {}, legacy: { mode: "review", singleId: null, stitchId: null } }))
      .toEqual([]);
  });
});

describe("resumeAllowedForRoute — the B914 cross-project leak guard", () => {
  it("no route project → resume anything (unfiled orphan included)", () => {
    expect(resumeAllowedForRoute(null, null)).toBe(true);
    expect(resumeAllowedForRoute(null, "pA")).toBe(true);
    expect(resumeAllowedForRoute("", "pA")).toBe(true);
  });

  it("named route resumes ONLY its own project's review (exact match)", () => {
    expect(resumeAllowedForRoute("pA", "pA")).toBe(true);
    expect(resumeAllowedForRoute("pA", "pB")).toBe(false);
  });

  it("named route BLOCKS an unfiled (projectId-less) legacy orphan — the leak fix", () => {
    // The exact bug: a loose "Open"-ed PDF (recProjectId null) used to leak onto every
    // project's Review tab via the legacy-global fallback. A named route must reject it.
    expect(resumeAllowedForRoute("pMesa", null)).toBe(false);
    expect(resumeAllowedForRoute("pZZ", null)).toBe(false);
    expect(resumeAllowedForRoute("pMesa", undefined)).toBe(false);
  });
});
