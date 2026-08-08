/* B217539 — the label COLLISION pass resolves ONCE per distinct question, and its answer is
 * byte-for-byte what the un-memoised pass returned.
 *
 * TWO INDEPENDENT PROPERTIES, and both are needed. A memo that is fast and subtly wrong is worse
 * than the bug it replaced: a nudged label is visible on the owner's plans, and no counter would
 * ever notice.
 *
 *   1. THE COUNTER — N identical renders solve ONCE. This is the CI-runnable twin of the browser
 *      gate (`ui-audit/verify-view-independent.mjs`), which drives a real pan against an
 *      instrumented build and measured this pass at 372 calls / 88.6 ms for THREE distinct answers.
 *      No visual test can see a redundant re-solve — the picture is identical when broken — so a
 *      counter is the only instrument that can.
 *
 *   2. THE OUTPUT — memoised === un-memoised, key for key, field for field, ORDER for order,
 *      driven over the owner's own geometry. `layoutLabelsSolve` is exported precisely so this
 *      file can compare against the un-memoised path rather than against a recorded expectation
 *      (a golden master would freeze today's placements, which is a different and weaker claim).
 *
 * Mutation-proven: disabling the cache turns the counter cases red; keying the ring by anything
 * that cannot distinguish two rings turns the staleness cases red.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { layoutLabels, layoutLabelsSolve, __labelLayoutProbe } from "../src/workspaces/site-planner/lib/labelLayout.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ---- fixtures ------------------------------------------------------------------------------- */

const item = (over = {}) => ({
  id: "a", cx: 400, cy: 300, lines: ["Building A", "166,240 sf"], lh: 13, charW: 7,
  halfW: 120, halfH: 60, importance: 10, ...over,
});

/* A reflow spec, so the stacked/abbrev rungs are exercised rather than only the inline one. */
const reflowItem = (over = {}) => item({
  id: "r",
  lines: ["Detention Pond", { parts: ["Holds 17.4 ac-ft usable", "12.2 below flood"], sep: " · ", keep: 1, stack: true }],
  ...over,
});

/** A crowded scene: labels that genuinely contest space, so the greedy order matters and any
 *  change in the pass would show as a different winner rather than a different pixel. */
const crowded = () => Array.from({ length: 12 }, (_, i) => item({
  id: `e${i}`,
  cx: 200 + (i % 4) * 90, cy: 200 + Math.floor(i / 4) * 40,
  lines: [`Element ${i}`, `${(i + 1) * 1000} sf`, "300' × 120'"],
  importance: 20 - i,
}));

const OPTS = { pad: 2, gap: 4, obstacles: [{ x: 250, y: 250, w: 80, h: 30 }] };

/** The owner's real pond rings — the geometry this pass actually runs against in production. */
function realRings() {
  const out = [];
  for (const f of ["goose-creek-plan1copy.json", "sylvestri-concept-d.json"]) {
    let raw;
    try { raw = JSON.parse(readFileSync(join(ROOT, "ui-audit/fixtures", f), "utf8")); } catch { continue; }
    const els = raw?.elements || raw?.data?.elements || raw?.els || [];
    for (const el of els) {
      const pts = el?.points;
      if (Array.isArray(pts) && pts.length >= 4 && pts.every((p) => p && typeof p.x === "number")) {
        out.push({ id: el.id || `p${out.length}`, ring: pts });
      }
    }
  }
  return out.slice(0, 8);
}

/** Deep, order-sensitive comparison of two placement Maps. Map iteration order IS the commit
 *  order, and a pass that placed the same labels in a different order is a different pass. */
const dump = (m) => [...m.entries()].map(([k, v]) => [k, {
  lines: v.lines, x: v.x, y: v.y, rot: v.rot, rung: v.rung,
  leader: v.leader ? { x: v.leader.x, y: v.leader.y } : null,
  box: { x: v.box.x, y: v.box.y, w: v.box.w, h: v.box.h },
}]);

beforeEach(() => __labelLayoutProbe.reset());

/* ---- 1. the counter ------------------------------------------------------------------------- */

describe("B217539 — a pan asks the same question 372 times and must solve it once", () => {
  it("60 identical renders solve exactly ONCE", () => {
    const items = crowded();
    for (let i = 0; i < 60; i++) layoutLabels(items, OPTS);
    expect(__labelLayoutProbe.calls).toBe(60);
    expect(__labelLayoutProbe.solves).toBe(1);
  });

  it("a FRESH array of equal items still hits — the key is a value signature, not identity", () => {
    // This is the whole reason the memo is not a `useMemo`: the planner rebuilds `labelCands` every
    // render, so `Object.is` reports "changed" on 100% of renders and a dep array would never hit.
    for (let i = 0; i < 30; i++) layoutLabels(crowded(), { ...OPTS, obstacles: [{ x: 250, y: 250, w: 80, h: 30 }] });
    expect(__labelLayoutProbe.solves).toBe(1);
  });

  it("the two call sites (measure chips + element labels) do not evict each other", () => {
    const chips = [item({ id: "chip", noLeader: true })];
    const labels = crowded();
    for (let i = 0; i < 40; i++) { layoutLabels(chips, OPTS); layoutLabels(labels, OPTS); }
    expect(__labelLayoutProbe.solves).toBe(2);
  });

  it("returns the SAME Map instance on a hit — a fresh equal object invalidates every memo downstream", () => {
    const items = crowded();
    expect(layoutLabels(items, OPTS)).toBe(layoutLabels(items, OPTS));
  });
});

/* ---- 2. every input that changes the answer must change the key ------------------------------ */

describe("⛔ a changed input re-solves — the key IS the inputs, so a stale placement is impossible", () => {
  const cases = {
    "moved (cx)": { cx: 401 },
    "moved (cy)": { cy: 301 },
    "a sub-pixel move": { cx: 400.5 },
    "different text": { lines: ["Building B", "166,240 sf"] },
    "an added line": { lines: ["Building A", "166,240 sf", "300' × 120'"] },
    "line height": { lh: 14 },
    "char width": { charW: 7.5 },
    "half width": { halfW: 121 },
    "half height": { halfH: 61 },
    "maxH (the halfH fallback)": { halfH: undefined, maxH: 90 },
    rotation: { rot: 90 },
    noLeader: { noLeader: true },
    mustLabel: { mustLabel: true },
    importance: { importance: 11 },
    id: { id: "b" },
  };
  for (const [name, over] of Object.entries(cases)) {
    it(`${name} re-solves`, () => {
      layoutLabels([item()], OPTS);
      layoutLabels([item(over)], OPTS);
      expect(__labelLayoutProbe.solves).toBe(2);
    });
  }

  it("a changed obstacle re-solves", () => {
    layoutLabels([item()], OPTS);
    layoutLabels([item()], { ...OPTS, obstacles: [{ x: 251, y: 250, w: 80, h: 30 }] });
    expect(__labelLayoutProbe.solves).toBe(2);
  });

  it("changed pad / gap re-solve", () => {
    layoutLabels([item()], OPTS);
    layoutLabels([item()], { ...OPTS, pad: 3 });
    layoutLabels([item()], { ...OPTS, gap: 5 });
    expect(__labelLayoutProbe.solves).toBe(3);
  });

  it("a reflow spec is keyed by its PARTS, not by the string it inlines to", () => {
    // Two specs can inline to identical text and still have different rungs available, which
    // changes the placement. Keying the joined string would serve one the other's answer.
    const a = reflowItem();
    const b = reflowItem({ lines: ["Detention Pond", { parts: ["Holds 17.4 ac-ft usable", "12.2 below flood"], sep: " · ", keep: 2, stack: true }] });
    layoutLabels([a], OPTS);
    layoutLabels([b], OPTS);
    expect(__labelLayoutProbe.solves).toBe(2);
  });

  it("⛔ an EDITED RING re-solves even though the screen anchor did not move", () => {
    // The exact staleness the item warned about: `ring` is a model array reference, so it is keyed
    // by identity. The planner replaces `points` wholesale on edit, so an edited pond arrives as a
    // NEW array and cannot be served its old placement.
    const ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }];
    const edited = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }];
    const mk = (r) => [item({ id: "pond", ring: r, ringOrigin: { x: 0, y: 0 }, ringPpf: 1, mustLabel: true })];
    layoutLabels(mk(ring), OPTS);
    layoutLabels(mk(edited), OPTS);
    expect(__labelLayoutProbe.solves).toBe(2);
  });

  it("the SAME ring array hits — identity is stable across a pan", () => {
    const ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }];
    const mk = () => [item({ id: "pond", ring, ringOrigin: { x: 0, y: 0 }, ringPpf: 1, mustLabel: true })];
    for (let i = 0; i < 20; i++) layoutLabels(mk(), OPTS);
    expect(__labelLayoutProbe.solves).toBe(1);
  });

  it("a changed ringPpf / ringOrigin re-solves (a ZOOM legitimately moves the answer)", () => {
    const ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }];
    const mk = (o) => [item({ id: "pond", ring, ringOrigin: { x: 0, y: 0 }, ringPpf: 1, mustLabel: true, ...o })];
    layoutLabels(mk(), OPTS);
    layoutLabels(mk({ ringPpf: 2 }), OPTS);
    layoutLabels(mk({ ringOrigin: { x: 1, y: 0 } }), OPTS);
    expect(__labelLayoutProbe.solves).toBe(3);
  });
});

/* ---- 3. the output is byte-for-byte the un-memoised answer ----------------------------------- */

describe("⛔ memoised === un-memoised — placement for placement, order for order", () => {
  const scenes = [
    ["a single label", [item()], OPTS],
    ["a crowded scene", crowded(), OPTS],
    ["a crowded scene with no obstacles", crowded(), { pad: 2, gap: 4 }],
    ["reflow specs", [reflowItem(), reflowItem({ id: "r2", cx: 430 })], OPTS],
    ["rotated labels", [item({ rot: 90 }), item({ id: "b", cx: 420, rot: 90 })], OPTS],
    ["noLeader overflow", [item({ noLeader: true, halfW: 5, halfH: 5 })], OPTS],
    ["mustLabel forced outside", [item({ mustLabel: true, halfW: 2, halfH: 2 }), item({ id: "wall", cx: 400, cy: 300, halfW: 300, halfH: 300, importance: 1e6 })], OPTS],
    ["empty", [], OPTS],
    ["null items", null, OPTS],
    ["ties on importance (the stable id tiebreak)", [item({ id: "b", importance: 5 }), item({ id: "a", importance: 5, cx: 405 })], OPTS],
  ];
  for (const [name, items, opts] of scenes) {
    it(name, () => {
      expect(dump(layoutLabels(items, opts))).toEqual(dump(layoutLabelsSolve(items, opts)));
    });
  }

  it("the owner's real pond rings — every ring, at several zooms", () => {
    const rings = realRings();
    expect(rings.length, "expected real ring fixtures to be readable").toBeGreaterThan(0);
    for (const { id, ring } of rings) {
      for (const ppf of [0.02, 0.1031, 0.35, 0.523]) {
        const items = [{
          id, cx: 500, cy: 400, lines: ["Detention Pond", { parts: ["Holds 17.4 ac-ft usable", "9' rim to floor"], sep: " · ", keep: 1, stack: true }],
          lh: 13, charW: 7, halfW: Infinity, halfH: Infinity, importance: 10,
          ring, ringOrigin: ring[0], ringPpf: ppf, mustLabel: true,
        }];
        expect(dump(layoutLabels(items, OPTS)), `${id} @ ppf ${ppf}`).toEqual(dump(layoutLabelsSolve(items, OPTS)));
      }
    }
  });

  it("a repeated call returns the same content as a fresh solve (the cache cannot drift)", () => {
    const items = crowded();
    const first = dump(layoutLabels(items, OPTS));
    for (let i = 0; i < 50; i++) layoutLabels(items, OPTS);
    expect(dump(layoutLabels(items, OPTS))).toEqual(first);
    expect(first).toEqual(dump(layoutLabelsSolve(items, OPTS)));
  });
});

/* ---- 4. source guards ------------------------------------------------------------------------ */

describe("the wiring cannot be undone silently", () => {
  const src = readFileSync(join(ROOT, "src/workspaces/site-planner/lib/labelLayout.js"), "utf8");

  it("layoutLabels routes through the cache rather than calling the solver directly", () => {
    expect(src).toMatch(/layoutCache\.get\(key\)/);
    expect(src).toMatch(/layoutCache\.set\(key, layoutLabelsSolve\(items, opts\)\)/);
  });

  it("the ring is keyed by IDENTITY, never by its contents", () => {
    // Hashing thousands of vertices per frame would cost more than the scan it saves — and would
    // reintroduce the per-frame work this item exists to remove.
    expect(src).toContain("new WeakMap()");
    expect(src).toMatch(/ringTokens\.set\(ring, t\)/);
  });

  it("both planner call sites still go through layoutLabels, not the solver", () => {
    const sp = readFileSync(join(ROOT, "src/workspaces/site-planner/SitePlanner.jsx"), "utf8");
    expect(sp).not.toContain("layoutLabelsSolve");
    expect((sp.match(/= layoutLabels\(/g) || []).length).toBe(2);
  });
});
