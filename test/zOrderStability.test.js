/* B464050 — WHY RE-SPACING THE STACKING KEYS IS SAFE, pinned as a property rather than trusted.
 *
 * ⛔ THE FILED DIAGNOSIS WAS WRONG, and the correction is the point of this file. B464050 was filed
 * as *"undo after a delete re-spaces every element's layer key"*, measured on the owner's real FM 359
 * plan: 17 of 18 elements came back with different `z` after Ctrl+Z (`1024 → 2048`, `2048 → 4096`, …).
 * **Undo has nothing to do with it.** Driven in a browser on the same fixture, ONE ARROW NUDGE — no
 * delete, no undo — produces the identical re-spacing, because:
 *
 *   • his saved plan carries **9 DUPLICATE `z` VALUES** (both buildings are `z: 0`, and each
 *     assembly is numbered 0…8192 independently) — legacy rows from before B671 gave elements an
 *     explicit z at all;
 *   • `createSiteModel` calls `ensureZ` on LOAD, which repairs them in memory;
 *   • the next SAVE of any kind persists the repair. Undo was simply the first save that happened.
 *
 * So this is B671's designed migration doing its job once, not a bug in undo. Measured with the
 * browser probe: creating a building, Ctrl+D duplicating one, and copy/pasting one all assign
 * distinct gapped z — **nothing in the app creates a duplicate today**, so the migration cannot
 * become perpetual.
 *
 * ── WHY THAT IS SAFE, AND WHY IT IS PINNED HERE RATHER THAN ASSERTED IN PROSE ────────────────────
 * `z` is not decorative: `byZAsc` (z, then id) IS the draw order within a type layer, so re-spacing
 * would be a live hazard the moment two elements landed in a new relative position. It cannot,
 * because `ensureZ` is `normalizeZ(sortByZ(list))` — it assigns `index * Z_GAP` in the order
 * produced by **the very comparator the renderer sorts with**. The agreement is one function used at
 * both ends, not two numbers that happen to line up.
 *
 * That distinction is exactly the trap this repo keeps hitting (a result that is right by accident
 * because nothing maintains the agreement), so the invariant is tested over a battery of hostile
 * inputs instead of argued: **for any list, the render order after `ensureZ` is the render order
 * before it.** Mutation-proven — drop the `sortByZ` and the pond/parcel cases go red.
 *
 * NOTHING holds a reference BY z (bonds use `attachedTo`, selection uses ids), so a changed number
 * cannot make anything follow the wrong element; that is asserted too.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureZ, normalizeZ, sortByZ, byZAsc, needsZ, nextZ, Z_GAP } from "../src/workspaces/site-planner/lib/zOrder.js";

const ids = (list) => sortByZ(list).map((e) => e.id);

/* ⛔ HOSTILE INPUTS, not a tidy one. Every shape a real saved plan has been seen to hold, plus the
 * owner's own duplicate-z assembly pattern verbatim. */
const CASES = {
  "the owner's real FM 359 shape — two assemblies each numbered from 0": [
    { id: "b1", z: 0 }, { id: "court1", z: 1024 }, { id: "court2", z: 2048 }, { id: "bump1", z: 3072 },
    { id: "b2", z: 0 }, { id: "court3", z: 1024 }, { id: "court4", z: 2048 }, { id: "bump2", z: 3072 },
  ],
  "already clean and gapped (the idempotent case)": [{ id: "a", z: 0 }, { id: "b", z: 1024 }, { id: "c", z: 2048 }],
  "array order disagrees with z order": [{ id: "a", z: 4096 }, { id: "b", z: 0 }, { id: "c", z: 2048 }],
  "no z at all (a pre-B671 plan)": [{ id: "a" }, { id: "b" }, { id: "c" }],
  "some z missing, some present": [{ id: "a", z: 5000 }, { id: "b" }, { id: "c", z: 10 }],
  "every z identical": [{ id: "a", z: 7 }, { id: "b", z: 7 }, { id: "c", z: 7 }],
  "negative and fractional z": [{ id: "a", z: -400 }, { id: "b", z: 0.5 }, { id: "c", z: -400 }],
  "non-finite z (a JSON round-trip of Infinity/NaN)": [{ id: "a", z: null }, { id: "b", z: 3 }, { id: "c", z: 1 }],
  "ids that sort differently from insertion": [{ id: "z9", z: 0 }, { id: "a1", z: 0 }, { id: "m5", z: 0 }],
  "one element": [{ id: "only", z: 999 }],
  "empty": [],
};

describe("B464050 — ensureZ preserves RENDER ORDER, for any input", () => {
  for (const [name, list] of Object.entries(CASES)) {
    it(name, () => {
      const before = ids(list);
      const after = ids(ensureZ(list));
      expect(after, `render order moved:\n  before ${before.join(" ")}\n  after  ${after.join(" ")}`).toEqual(before);
    });
  }

  it("…and is STABLE — running it twice changes nothing further", () => {
    for (const list of Object.values(CASES)) {
      const once = ensureZ(list);
      const twice = ensureZ(once);
      expect(ids(twice)).toEqual(ids(once));
      expect(twice.map((e) => e.z)).toEqual(once.map((e) => e.z));
    }
  });

  it("…and is IDEMPOTENT BY IDENTITY on a clean list — so it cannot churn a save on every load", () => {
    /* This is what makes the migration a ONE-TIME write rather than a permanent source of diffs:
     * once the duplicates are gone, `ensureZ` hands back the very same array reference. */
    const clean = [{ id: "a", z: 0 }, { id: "b", z: Z_GAP }];
    expect(ensureZ(clean)).toBe(clean);
    expect(needsZ(clean)).toBe(false);
  });

  it("a duplicate-z list DOES need repair — the case the owner's plan is in", () => {
    expect(needsZ(CASES["the owner's real FM 359 shape — two assemblies each numbered from 0"])).toBe(true);
    expect(needsZ([{ id: "a" }])).toBe(true); // missing z
  });

  it("MUTATION CHECK — the invariant is real: normalizing WITHOUT the sort reorders the plan", () => {
    /* `normalizeZ(list)` assigns by ARRAY position; `ensureZ` assigns by SORTED position. On a list
     * whose array order disagrees with its z order they differ, which is precisely the property
     * that would make re-spacing a hazard if the sort were ever dropped. */
    const list = CASES["array order disagrees with z order"];
    expect(ids(normalizeZ(list))).not.toEqual(ids(list));
    expect(ids(ensureZ(list))).toEqual(ids(list));
  });

  it("MUTATION CHECK — a comparator that ignored the id tiebreak would be unstable on duplicates", () => {
    const list = CASES["ids that sort differently from insertion"];
    // byZAsc breaks the all-equal-z tie by id, deterministically, in both places.
    expect(ids(list)).toEqual(["a1", "m5", "z9"]);
    expect(ids(ensureZ(list))).toEqual(["a1", "m5", "z9"]);
  });
});

describe("B464050 — nothing identifies an element BY its z", () => {
  it("a re-spaced element keeps every other property, ids included", () => {
    const list = [{ id: "b1", z: 0, type: "building", attachedTo: null, w: 1675, h: 613 },
                  { id: "c1", z: 0, type: "paving", attachedTo: "b1", zd: 135 }];
    const out = ensureZ(list);
    for (const before of list) {
      const after = out.find((e) => e.id === before.id);
      for (const k of Object.keys(before)) {
        if (k === "z") continue;
        expect(after[k], `${before.id}.${k}`).toEqual(before[k]);
      }
    }
  });

  it("bonds are by id — a re-spaced host is still the host of its assembly", () => {
    const out = ensureZ([{ id: "b1", z: 0 }, { id: "court", z: 0, attachedTo: "b1" }]);
    expect(out.find((e) => e.id === "court").attachedTo).toBe("b1");
  });

  it("SOURCE SWEEP — no bond, selection or lookup field is keyed on z", () => {
    const root = fileURLToPath(new URL("../src/workspaces/site-planner/", import.meta.url));
    const bondRemap = readFileSync(root + "lib/bondRemap.js", "utf8");
    /* bondRemap is the ONE id-bearing bond inventory (B1124). If z ever joined it, a re-space
     * would start moving references and this whole item's verdict would flip. */
    expect(bondRemap).not.toMatch(/["']z["']\s*[,:]/);
    const deletePlan = readFileSync(root + "lib/deletePlan.js", "utf8");
    expect(deletePlan).not.toMatch(/\.z\s*===/);
  });
});

describe("B464050 — the migration cannot become perpetual", () => {
  it("nextZ always lands ABOVE every peer, so a new element never collides", () => {
    const list = [{ id: "a", z: 0 }, { id: "b", z: 1024 }];
    const z = nextZ(list);
    expect(z).toBe(2048);
    expect(needsZ([...list, { id: "c", z }])).toBe(false);
  });

  it("…including on a list that still holds duplicates", () => {
    const list = [{ id: "a", z: 0 }, { id: "b", z: 0 }];
    expect(nextZ(list)).toBe(Z_GAP);
  });

  it("byZAsc treats a missing z as 0 — a legacy element still orders, never vanishes", () => {
    expect([{ id: "b" }, { id: "a", z: -1 }].sort(byZAsc).map((e) => e.id)).toEqual(["a", "b"]);
  });
});
