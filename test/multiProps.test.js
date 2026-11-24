import { describe, it, expect } from "vitest";
import { selectionKinds, readShared, fieldsFor, applyBulk } from "../src/workspaces/site-planner/lib/multiProps.js";

const bldg = (id, over = {}) => ({ id, type: "building", cx: 0, cy: 0, w: 200, h: 100, rot: 0, ...over });
const park = (id, over = {}) => ({ id, type: "parking", cx: 0, cy: 0, w: 100, h: 60, rot: 0, ...over });
const ctx = { cfgOf: (el) => ({ stallDepth: 18, aisle: 24, trailerL: 55, trailerW: 10, trailerAisle: 60, ...(el.cfg || {}) }), roadTravel: (el) => el.travelW || 0 };
const field = (type, id) => fieldsFor(type).find((f) => f.id === id);
const refs = (...ids) => ids.map((id) => ({ kind: "el", id }));

describe("selectionKinds", () => {
  it("one type → type + members; bump-outs are not members; several types → type null", () => {
    const els = [bldg("a"), bldg("b"), bldg("bump", { dogEar: true }), park("p")];
    expect(selectionKinds(refs("a", "b", "bump"), els).type).toBe("building");
    expect(selectionKinds(refs("a", "b", "bump"), els).members.map((m) => m.id)).toEqual(["a", "b"]);
    const mixed = selectionKinds(refs("a", "p"), els);
    expect(mixed.type).toBeNull();
    expect(mixed.mixedTypes).toBe(true);
  });
  it("markups in the set are noted but not counted as element members", () => {
    const k = selectionKinds([...refs("a"), { kind: "markup", id: "m" }], [bldg("a")]);
    expect(k.onlyEls).toBe(false);
    expect(k.members).toHaveLength(1);
  });
});

describe("readShared — value vs Mixed", () => {
  it("agreeing members show the value, disagreeing ones are mixed", () => {
    const f = field("building", "length");
    expect(readShared([bldg("a"), bldg("b")], f, ctx)).toMatchObject({ mixed: false, value: 200, n: 2 });
    expect(readShared([bldg("a"), bldg("b", { w: 300 })], f, ctx).mixed).toBe(true);
  });
  it("an unset override (auto) on every member is uniform-and-empty, one set among unset is mixed", () => {
    const f = field("building", "clearHeight");
    expect(readShared([bldg("a"), bldg("b")], f, ctx)).toMatchObject({ mixed: false, value: undefined });
    expect(readShared([bldg("a"), bldg("b", { clearHeightOverride: 36 })], f, ctx).mixed).toBe(true);
  });
  it("irregular (points) footprints are skipped for size fields; none applicable → n 0", () => {
    const f = field("building", "length");
    expect(readShared([bldg("a", { points: [] })], f, ctx).n).toBe(0);
  });
  it("stall spec reads through cfgOf (own cfg overrides the plan value)", () => {
    const f = field("parking", "stallDepth");
    expect(readShared([park("a"), park("b", { cfg: { stallDepth: 20 } })], f, ctx).mixed).toBe(true);
    expect(readShared([park("a"), park("b")], f, ctx).value).toBe(18);
  });
});

describe("applyBulk — every unlocked member, same writers as the single panel", () => {
  const log = () => { const calls = []; return { calls, ops: {
    resizeTo: (el, ax, v) => calls.push(["resize", el.id, ax, v]), rotateTo: (el, v) => calls.push(["rot", el.id, v]),
    patch: (el, p) => calls.push(["patch", el.id, p]), setRoadTravel: (el, v) => calls.push(["road", el.id, v]),
    setParkCfg: (el, p) => calls.push(["park", el.id, p]), setTrailerSpec: (id, k, v) => calls.push(["trailer", id, k, v]),
    toggleLabel: (id) => calls.push(["label", id]) } }; };
  it("a typed building length goes through resize on the length axis of EACH building", () => {
    const { calls, ops } = log();
    const r = applyBulk([bldg("a"), bldg("b", { rot: 90 })], field("building", "length"), 400, ops);
    expect(r.done).toBe(2);
    expect(calls.map((c) => c[0])).toEqual(["resize", "resize"]);
    expect(calls.every((c) => c[3] === 400)).toBe(true);
  });
  it("locked members are left alone and counted", () => {
    const { calls, ops } = log();
    const r = applyBulk([bldg("a"), bldg("b", { locked: true })], field("building", "rotation"), 45, ops);
    expect(r).toEqual({ done: 1, skippedLocked: 1 });
    expect(calls).toEqual([["rot", "a", 45]]);
  });
  it("parking stall depth and trailer spec route to their own writers; label toggle only flips members that differ", () => {
    const { calls, ops } = log();
    applyBulk([park("p")], field("parking", "stallDepth"), 19, ops);
    applyBulk([{ id: "t", type: "trailer" }], field("trailer", "trailerW"), 12, ops);
    expect(calls).toEqual([["park", "p", { stallDepth: 19 }], ["trailer", "t", "trailerW", 12]]);
    const l = log();
    applyBulk([{ id: "t1", type: "trailer" }, { id: "t2", type: "trailer", labelHidden: true }], field("trailer", "labelShown"), false, l.ops);
    expect(l.calls).toEqual([["label", "t1"]]);
  });
  it("mixed-type selection offers only Rotation", () => {
    expect(fieldsFor(null).map((f) => f.id)).toEqual(["rotation"]);
    expect(fieldsFor("pond")).toEqual([]);
  });
});
