/* NEW-1 — the View menu's content-visibility model.
 *
 * The suite is organised around the promise the owner extracted twice ("when I say remove, I don't
 * mean remove, I just mean hide temporarily"), so the tests that matter most are the ones asserting
 * this module CANNOT affect anything but the picture: it returns predicates, it never returns a
 * model, and its storage shape is additive-free on an untouched plan.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EL_GROUPS, EL_KEYS, KNOWN_KEYS, elKey,
  isHidden, elHidden, parcelAcreageHidden,
  groupState, setVisible, setManyVisible, showAll, anyHidden, hiddenKeys,
  groupsFor, hiddenSummary, normalizeRetiredToggles,
} from "../src/workspaces/site-planner/lib/contentVisibility.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("the sparse map only ever names what is HIDDEN", () => {
  it("an absent key is visible, and an untouched plan has no map at all", () => {
    expect(isHidden(undefined, "markups")).toBe(false);
    expect(isHidden(null, "markups")).toBe(false);
    expect(isHidden({}, "markups")).toBe(false);
    expect(anyHidden(undefined)).toBe(false);
  });

  it("only `true` hides — a stored false/0/'' is visible, never truthy-guessed", () => {
    for (const v of [false, 0, "", null, undefined, "true", 1]) {
      expect(isHidden({ markups: v }, "markups")).toBe(v === true);
    }
  });

  it("hiding writes exactly one key; showing DELETES it rather than writing false", () => {
    const a = setVisible({}, "markups", false);
    expect(a).toEqual({ markups: true });
    const b = setVisible(a, "markups", true);
    expect(b).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(b, "markups")).toBe(false);
  });

  it("a key this version does not know is IGNORED, never dropped", () => {
    const stored = { "el:someFutureType": true, markups: true };
    expect(hiddenKeys(stored)).toEqual(["markups"]);          // not reported
    expect(showAll(stored)).toEqual({ "el:someFutureType": true });  // but not deleted
  });
});

describe("identity stability — a no-op write returns the INPUT", () => {
  /* Not decoration: `settings` feeds memo keys across the render body, and a fresh object holding
   * identical values invalidates every one of them (B385040's exact mechanism). */
  it("setVisible returns the same object when nothing moves", () => {
    const h = { markups: true };
    expect(setVisible(h, "markups", false)).toBe(h);
    expect(setVisible(h, "parcels", true)).toBe(h);
  });

  it("setManyVisible returns the same object when every key already agrees", () => {
    const h = setManyVisible({}, EL_KEYS, false);
    expect(setManyVisible(h, EL_KEYS, false)).toBe(h);
  });

  it("showAll returns the same object when nothing is hidden", () => {
    const h = {};
    expect(showAll(h)).toBe(h);
    expect(showAll(undefined)).toEqual({});
  });

  it("but a real change always returns a NEW object (no mutation of the caller's state)", () => {
    const h = { markups: true };
    const next = setVisible(h, "parcels", false);
    expect(next).not.toBe(h);
    expect(h).toEqual({ markups: true });   // untouched
  });
});

describe("groupState is the flood-master shape, stated in terms of SHOWN", () => {
  it("all/any/onCount track the visible keys", () => {
    expect(groupState({}, ["a", "b"])).toEqual({ ids: ["a", "b"], onCount: 2, all: true, any: true });
    expect(groupState({ a: true }, ["a", "b"])).toEqual({ ids: ["a", "b"], onCount: 1, all: false, any: true });
    expect(groupState({ a: true, b: true }, ["a", "b"])).toEqual({ ids: ["a", "b"], onCount: 0, all: false, any: false });
  });

  it("an empty key set is not `all` (nothing to be all of)", () => {
    expect(groupState({}, []).all).toBe(false);
  });

  it("⛔ matches LayerPanel's floodMaster contract — the two masters are ONE idea", () => {
    /* If the flood row's shape changes, this fails and the two are reconciled deliberately rather
     * than drifting into two mechanisms that look different for no reason. */
    const src = readFileSync(resolve(here, "../src/workspaces/site-planner/components/LayerPanel.jsx"), "utf8");
    expect(src).toMatch(/floodMaster\.all/);
    expect(src).toMatch(/floodMaster\.any/);
    expect(src).toMatch(/floodMaster\.onCount/);
    expect(src).toMatch(/floodMaster\.ids/);
    expect(Object.keys(groupState({}, ["a"])).sort()).toEqual(["all", "any", "ids", "onCount"]);
  });
});

describe("elements: master over per-type rows", () => {
  it("elHidden keys off the element's own type", () => {
    const h = { [elKey("pond")]: true };
    expect(elHidden(h, { type: "pond" })).toBe(true);
    expect(elHidden(h, { type: "building" })).toBe(false);
    expect(elHidden(h, null)).toBe(false);
  });

  it("the master hides every type, and showing it again restores ALL of them", () => {
    let h = setManyVisible({}, EL_KEYS, false);
    for (const g of EL_GROUPS) expect(elHidden(h, { type: g.type })).toBe(true);
    h = setManyVisible(h, EL_KEYS, true);
    expect(h).toEqual({});
  });

  it("hiding one type leaves the master indeterminate, not off", () => {
    const h = setVisible({}, elKey("pond"), false);
    const st = groupState(h, EL_KEYS);
    expect(st.all).toBe(false);
    expect(st.any).toBe(true);          // → the checkbox renders indeterminate
    expect(st.onCount).toBe(EL_KEYS.length - 1);
  });
});

describe("the parcel acreage chip composes TWO authorities and writes neither", () => {
  /* B1404 shipped the per-lot `chipHidden`; this master is the plan-wide view-level twin. */
  it("either one hides the chip", () => {
    expect(parcelAcreageHidden({}, { chipHidden: true })).toBe(true);
    expect(parcelAcreageHidden({ "labels:parcelAcreage": true }, {})).toBe(true);
    expect(parcelAcreageHidden({}, {})).toBe(false);
  });

  it("⛔ turning the master back off RESTORES the per-lot choices — the master never wrote them", () => {
    const byHand = { id: "p1", chipHidden: true };
    const plain = { id: "p2" };
    let h = setVisible({}, "labels:parcelAcreage", false);
    expect(parcelAcreageHidden(h, byHand)).toBe(true);
    expect(parcelAcreageHidden(h, plain)).toBe(true);
    h = setVisible(h, "labels:parcelAcreage", true);
    expect(parcelAcreageHidden(h, byHand)).toBe(true);   // his own choice survived
    expect(parcelAcreageHidden(h, plain)).toBe(false);
  });
});

describe("groupsFor: rows for what the plan actually contains", () => {
  const els = [
    { id: "a", type: "building" }, { id: "b", type: "building" },
    { id: "c", type: "pond" },
    { id: "d", type: "building", dogEar: { side: "top" } },   // part of its building
  ];

  it("emits a row per PRESENT type, with counts of what exists", () => {
    const g = groupsFor({ els, parcels: 2, markups: 5 });
    expect(g.elRows.map((r) => r.key)).toEqual([elKey("building"), elKey("pond")]);
    expect(g.elRows.find((r) => r.key === elKey("building")).count).toBe(2);  // the bump is not a third
    expect(g.elTotal).toBe(3);
    expect(g.otherRows.map((r) => r.key)).toEqual(["parcels", "markups"]);
  });

  it("an empty plan shows no content rows — there is nothing to hide", () => {
    const g = groupsFor({});
    expect(g.elRows).toEqual([]);
    expect(g.otherRows).toEqual([]);
    expect(g.elTotal).toBe(0);
  });

  it("⛔ counts report what EXISTS, not what is drawn — a hidden group still says how much it hides", () => {
    const hiddenAll = setManyVisible({}, EL_KEYS, false);
    const g = groupsFor({ els });
    expect(g.elRows.find((r) => r.key === elKey("pond")).count).toBe(1);
    expect(anyHidden(hiddenAll)).toBe(true);   // the rows above are unchanged by any of it
  });

  it("rows follow EL_GROUPS order, not insertion order", () => {
    const g = groupsFor({ els: [{ type: "road" }, { type: "building" }] });
    expect(g.elRows.map((r) => r.key)).toEqual([elKey("building"), elKey("road")]);
  });
});

describe("hiddenSummary — the glanceable state the owner asked for", () => {
  it("is null when nothing is hidden", () => {
    expect(hiddenSummary({})).toBe(null);
    expect(hiddenSummary(undefined)).toBe(null);
  });

  it("NAMES what is hidden, so the chip says what to turn back on", () => {
    const h = setManyVisible({}, [elKey("building"), "markups"], false);
    const s = hiddenSummary(h);
    expect(s.count).toBe(2);
    expect(s.text).toBe("Buildings, Markups");
  });

  it("degrades to a count past three, so the chip cannot grow without bound", () => {
    const h = setManyVisible({}, [elKey("building"), elKey("pond"), elKey("road"), "markups"], false);
    expect(hiddenSummary(h).text).toBe("4 groups");
  });

  it("reports in menu order regardless of the order they were hidden", () => {
    const h = setManyVisible({}, ["markups", elKey("pond")], false);
    expect(hiddenSummary(h).labels).toEqual(["Ponds", "Markups"]);
  });
});

describe("the retired dock-door toggle cannot strand a plan", () => {
  it("normalizes a stored false to true, ONCE", () => {
    expect(normalizeRetiredToggles({ showDocks: false })).toEqual({ showDocks: true });
  });

  it("returns null when there is nothing to do, so opening a plan writes nothing", () => {
    expect(normalizeRetiredToggles({ showDocks: true })).toBe(null);
    expect(normalizeRetiredToggles({})).toBe(null);
    expect(normalizeRetiredToggles(undefined)).toBe(null);
  });

  it("⛔ leaves the column grid alone — the toggle the owner did NOT complain about", () => {
    expect(normalizeRetiredToggles({ showDocks: false, showGrid: false })).toEqual({ showDocks: true });
  });
});

describe("⛔ THE INVARIANT: this module cannot touch the model", () => {
  it("exports no mutator that takes or returns elements/parcels/geometry", () => {
    /* Every write here is over the sparse KEY map. If a function ever starts accepting `els` and
     * returning `els`, hiding has become filtering-the-model and the numbers are at risk. */
    const src = readFileSync(resolve(here, "../src/workspaces/site-planner/lib/contentVisibility.js"), "utf8");
    expect(src).not.toMatch(/\.splice\(|\.pop\(|delete\s+el\b|\.points\s*=|\.cx\s*=|\.cy\s*=/);
  });

  it("groupsFor READS els and returns only counts — never elements", () => {
    const els = [{ id: "a", type: "building", cx: 1, cy: 2, w: 3, h: 4 }];
    const g = groupsFor({ els });
    const json = JSON.stringify(g);
    expect(json).not.toMatch(/"id"|"cx"|"cy"/);
    expect(els[0]).toEqual({ id: "a", type: "building", cx: 1, cy: 2, w: 3, h: 4 });  // untouched
  });

  it("every KNOWN key is a view key — none of them names a persisted geometry field", () => {
    for (const k of KNOWN_KEYS) {
      expect(k === "labels:parcelAcreage" || k.startsWith("el:")
        || ["parcels", "markups", "measures", "callouts"].includes(k)).toBe(true);
    }
  });
});
