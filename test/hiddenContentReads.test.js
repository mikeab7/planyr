/* NEW-1 — the CI-runnable half of the hidden-content audit.
 *
 * `ui-audit/audit-hidden-content-reads.mjs` is the enumerator; this is the gate that keeps its answer
 * true. It fails the build when a raw-collection read appears that nobody has judged, when a
 * must-filter read stops asking the visibility predicate, or when the declaration table names a
 * binding that no longer exists (a table that outlives its code rots green).
 *
 * ⛔ THE MUTATION CHECK IS THE POINT. This whole family of bugs is invisible to every visual test in
 * the repo, so a guard that has never been seen to fail is worth nothing. The last case below replays
 * the ACTUAL pre-B3296 `roadNet` body and requires the sweep to catch it.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sweep, reconcile, bindingsIn, rawReadsOf, asksPredicate, artefactsOf } from "../ui-audit/audit-hidden-content-reads.mjs";
import { DECLARATIONS, VERDICT } from "../src/workspaces/site-planner/lib/hiddenContentReads.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("every read of the raw element list is judged", () => {
  const found = sweep(ROOT);
  const { undeclared, unfiltered, stale } = reconcile(found);

  it("the sweep finds something at all (a search that scans nothing is a permanent green)", () => {
    expect(found.length).toBeGreaterThan(20);
  });

  it("no UNDECLARED read — every call site has a verdict and a reason", () => {
    expect(undeclared.map((u) => `${u.name} (${u.file}:${u.line})`)).toEqual([]);
  });

  it("every MUST-FILTER read asks the visibility predicate", () => {
    expect(unfiltered.map((u) => `${u.name} — ${u.why}`)).toEqual([]);
  });

  it("no declaration outlives its binding", () => {
    expect(stale).toEqual([]);
  });

  it("both verdicts are represented — a table that is all one answer has stopped discriminating", () => {
    const kinds = new Set(DECLARATIONS.map((d) => d.verdict));
    expect(kinds.has(VERDICT.MUST_FILTER)).toBe(true);
    expect(kinds.has(VERDICT.CORRECT_UNFILTERED)).toBe(true);
    expect(DECLARATIONS.filter((d) => d.verdict === VERDICT.CORRECT_UNFILTERED).length).toBeGreaterThan(10);
  });

  it("every declaration states a REASON — an unexplained verdict is not a judgement", () => {
    // 40 CHARACTERS, not 40 non-space ones — `\S{40,}` demanded a single unbroken run and every
    // real sentence has spaces in it. Caught by this suite's first run.
    for (const d of DECLARATIONS) expect(d.why.trim().length, d.name).toBeGreaterThan(40);
  });
});

describe("⛔ MUTATION CHECK — the sweep really does catch the defect it was built from", () => {
  it("the pre-B3296 roadNet body is reported as an unfiltered must-filter read", () => {
    /* The real thing, from the real tree, rather than a hand-written imitation: a paraphrase would
     * test the paraphrase. */
    const src = execFileSync("git", ["show", "b4ddcc78^:src/workspaces/site-planner/SitePlanner.jsx"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const roadNet = bindingsIn(src).find((b) => b.name === "roadNet");
    expect(roadNet, "no roadNet binding in the pre-fix tree").toBeTruthy();
    expect(rawReadsOf(roadNet.body)).toContain("els");
    expect(artefactsOf(roadNet.body).length, "roadNet must be recognised as producing an artefact").toBeGreaterThan(0);
    expect(asksPredicate(roadNet.body), "the pre-fix roadNet must NOT ask the predicate").toBe(false);
  });

  it("…and the CURRENT roadNet does ask it", () => {
    const now = bindingsIn(execFileSync("git", ["show", "HEAD:src/workspaces/site-planner/SitePlanner.jsx"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })).find((b) => b.name === "roadNet");
    expect(asksPredicate(now.body)).toBe(true);
  });

  it("the artefact narrowing does not swallow a picture-producer", () => {
    expect(artefactsOf("const d = regionPathD(region, f2p);")).toContain("merged");
    expect(artefactsOf("els.forEach((e) => pts.push(...e.points)); let minX = Infinity; minX = Math.min(minX, p.x);")).toContain("extent");
    expect(artefactsOf("const others = els.map(ortho); edgeSnapCenter(box, others, tol);")).toContain("snap");
    // …and a plain list read is correctly set aside rather than demanding a declaration.
    expect(artefactsOf("const found = els.find((e) => e.id === id);")).toEqual([]);
  });
});
