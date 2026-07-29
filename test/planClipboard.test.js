/* NEW-2 + NEW-6 — the general Site Planner clipboard.
 *
 * NEW-2 (containment): copying a building brings the elements bonded to it (`attachedTo`) and
 * paste rebuilds the whole assembly with fresh ids and the bonds remapped INSIDE the copy.
 * NEW-6 (coverage): every drawn kind copies — el · markup · measure · callout · parcel — including
 * a mixed selection, with relative geometry preserved and a pasted parcel deliberately inactive.
 */
import { describe, it, expect } from "vitest";
import {
  CLIP_KINDS, collectClipboard, clipboardBBox, pasteClipboard,
  translateCalloutBy, translateParcelBy, clipCalloutTips,
} from "../src/workspaces/site-planner/lib/planClipboard.js";

// Minimal stand-ins for the component's own translators (rect = cx/cy, ring = points).
const shiftEl = (el, dx, dy) => (el.points
  ? { ...el, points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
  : { ...el, cx: el.cx + dx, cy: el.cy + dy });
const shiftMk = (m, dx, dy) => ({ ...m, pts: (m.pts || []).map((p) => ({ x: p.x + dx, y: p.y + dy })) });
const shiftMe = (m, dx, dy) => ({ ...m, pts: (m.pts || []).map((p) => ({ x: p.x + dx, y: p.y + dy })) });
const translate = { el: shiftEl, markup: shiftMk, measure: shiftMe };

let n = 0;
const mint = () => `n${++n}`;
const freshMint = () => { n = 0; return mint; };

const bboxOf = (o) => {
  let pts = null;
  if (o.points) pts = o.points;
  else if (o.pts) pts = o.pts;
  else if (o.w != null) { const hw = o.w / 2, hh = o.h / 2; pts = [{ x: o.cx - hw, y: o.cy - hh }, { x: o.cx + hw, y: o.cy + hh }]; }
  if (!pts || !pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  pts.forEach((p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
  return { x0, y0, x1, y1 };
};

// A building with a truck court, a trailer-parking apron and a dog-ear bump-out bonded to it —
// the exact shape of the owner's repro ("the elements it carries are left behind").
const site = () => ({
  els: [
    { id: "b1", type: "building", cx: 100, cy: 100, w: 200, h: 100, rot: 0 },
    { id: "c1", type: "paving", cx: 100, cy: 200, w: 200, h: 60, rot: 0, attachedTo: "b1", truckCourt: { side: "S" } },
    { id: "t1", type: "trailer", cx: 100, cy: 260, w: 200, h: 40, rot: 0, attachedTo: "b1", forTrailer: true },
    { id: "d1", type: "building", cx: 10, cy: 60, w: 20, h: 20, rot: 0, attachedTo: "b1", dogEar: { side: "N", sign: 1 }, noFit: true },
    { id: "b2", type: "building", cx: 600, cy: 600, w: 50, h: 50, rot: 0 },
  ],
  markups: [{ id: "m1", kind: "line", pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }],
  measures: [{ id: "s1", mode: "line", pts: [{ x: 0, y: 0 }, { x: 20, y: 0 }] }],
  callouts: [{ id: "k1", box: { x: 50, y: 50 }, tips: [{ x: 30, y: 30 }, { x: 70, y: 20 }], text: "note" }],
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], locked: true, active: true, gisKey: "county:123" }],
});

describe("CLIP_KINDS", () => {
  it("covers every drawn kind — no silently un-copyable type (NEW-6)", () => {
    expect(CLIP_KINDS).toEqual(["el", "markup", "measure", "callout", "parcel"]);
  });
});

describe("collectClipboard — containment (NEW-2)", () => {
  it("a selected building pulls in every element bonded to it", () => {
    const { items, counts } = collectClipboard([{ kind: "el", id: "b1" }], site());
    expect(items.map((i) => i.obj.id).sort()).toEqual(["b1", "c1", "d1", "t1"]);
    expect(counts.el).toBe(4);
  });
  it("selecting a bonded CHILD still copies the whole assembly from its host root", () => {
    const { items } = collectClipboard([{ kind: "el", id: "c1" }], site());
    expect(items.map((i) => i.obj.id).sort()).toEqual(["b1", "c1", "d1", "t1"]);
  });
  it("an unrelated building copies alone", () => {
    const { items } = collectClipboard([{ kind: "el", id: "b2" }], site());
    expect(items.map((i) => i.obj.id)).toEqual(["b2"]);
  });
  it("dedupes when the host AND a child are both selected", () => {
    const { items } = collectClipboard([{ kind: "el", id: "b1" }, { kind: "el", id: "t1" }], site());
    expect(items.length).toBe(4);
  });
});

describe("collectClipboard — coverage (NEW-6)", () => {
  it("copies a callout, a parcel, a markup and a measurement", () => {
    const s = site();
    for (const [kind, id] of [["callout", "k1"], ["parcel", "p1"], ["markup", "m1"], ["measure", "s1"]]) {
      const { items } = collectClipboard([{ kind, id }], s);
      expect(items).toEqual([{ kind, obj: expect.objectContaining({ id }) }]);
    }
  });
  it("accepts an index-keyed measure ref (the shape `sel` uses)", () => {
    const { items } = collectClipboard([{ kind: "measure", i: 0 }], site());
    expect(items[0].obj.id).toBe("s1");
  });
  it("carries a mixed selection in one payload", () => {
    const { counts } = collectClipboard(
      [{ kind: "el", id: "b2" }, { kind: "callout", id: "k1" }, { kind: "parcel", id: "p1" }], site());
    expect(counts).toEqual({ el: 1, callout: 1, parcel: 1 });
  });
  it("ignores a ref whose object is gone (a stale selection never crashes paste)", () => {
    expect(collectClipboard([{ kind: "callout", id: "nope" }], site()).items).toEqual([]);
  });
});

describe("pasteClipboard — assembly rebuild (NEW-2)", () => {
  it("mints fresh ids and remaps the host bond INSIDE the copy", () => {
    const s = site();
    const { items } = collectClipboard([{ kind: "el", id: "b1" }], s);
    const made = pasteClipboard(items, { mint: freshMint(), translate, dx: 500, dy: 0 });
    expect(made.els.length).toBe(4);
    const host = made.els.find((e) => e.attachedTo == null);
    const kids = made.els.filter((e) => e.attachedTo != null);
    expect(kids.length).toBe(3);
    kids.forEach((k) => expect(k.attachedTo).toBe(host.id));            // bonded to the COPY…
    made.els.forEach((e) => expect(["b1", "c1", "d1", "t1"]).not.toContain(e.id)); // …with fresh ids
  });
  it("keeps the role tags that make a child mean something (court side, dog-ear corner)", () => {
    const s = site();
    const { items } = collectClipboard([{ kind: "el", id: "b1" }], s);
    const made = pasteClipboard(items, { mint: freshMint(), translate, dx: 0, dy: 0 });
    expect(made.els.some((e) => e.truckCourt?.side === "S")).toBe(true);
    expect(made.els.some((e) => e.dogEar?.side === "N")).toBe(true);
    expect(made.els.some((e) => e.forTrailer === true)).toBe(true);
  });
  it("preserves relative geometry — every member moves by the SAME delta", () => {
    const s = site();
    const { items } = collectClipboard([{ kind: "el", id: "b1" }], s);
    const made = pasteClipboard(items, { mint: freshMint(), translate, dx: 500, dy: -25 });
    const byShape = (el) => `${el.w}x${el.h}`;
    const src = new Map(s.els.map((e) => [byShape(e), e]));
    made.els.forEach((e) => {
      const o = src.get(byShape(e));
      expect(e.cx - o.cx).toBe(500);
      expect(e.cy - o.cy).toBe(-25);
    });
  });
  it("selects the host, NOT its bonded parts (one thing pasted, not eight)", () => {
    const { items } = collectClipboard([{ kind: "el", id: "b1" }], site());
    const made = pasteClipboard(items, { mint: freshMint(), translate, dx: 1, dy: 1 });
    expect(made.refs.length).toBe(1);
    expect(made.refs[0].kind).toBe("el");
  });
  it("a lone child copied without its host pastes standalone (no bond back to the ORIGINAL)", () => {
    // Hand-built payload: the collect step would have pulled the host in, so this exercises the
    // defensive branch that stops a copy re-bonding to the live original and being refitted away.
    const child = site().els.find((e) => e.id === "c1");
    const made = pasteClipboard([{ kind: "el", obj: child }], { mint: freshMint(), translate, dx: 0, dy: 0 });
    expect(made.els[0].attachedTo).toBeUndefined();
    expect(made.els[0].truckCourt).toBeUndefined();
    expect(made.refs.length).toBe(1);
  });
});

describe("pasteClipboard — coverage + the parcel decision (NEW-6)", () => {
  it("a pasted parcel is INACTIVE and drops its county key, so site area can't double-count", () => {
    const { items } = collectClipboard([{ kind: "parcel", id: "p1" }], site());
    const made = pasteClipboard(items, { mint: freshMint(), translate, dx: 10, dy: 10 });
    expect(made.parcels[0].active).toBe(false);
    expect(made.parcels[0].gisKey).toBeUndefined();
    expect(made.parcels[0].points[0]).toEqual({ x: 10, y: 10 });
    expect(made.parcels[0].id).not.toBe("p1");
  });
  it("a pasted callout moves its box AND every leader tip together", () => {
    const { items } = collectClipboard([{ kind: "callout", id: "k1" }], site());
    const made = pasteClipboard(items, { mint: freshMint(), translate, dx: 5, dy: -5 });
    const c = made.callouts[0];
    expect(c.box).toEqual({ x: 55, y: 45 });
    expect(c.tips).toEqual([{ x: 35, y: 25 }, { x: 75, y: 15 }]);
    expect(c.text).toBe("note");
  });
  it("a mixed paste returns one ref per pasted item, all with fresh ids", () => {
    const s = site();
    const { items } = collectClipboard(
      [{ kind: "el", id: "b2" }, { kind: "markup", id: "m1" }, { kind: "measure", id: "s1" }, { kind: "callout", id: "k1" }, { kind: "parcel", id: "p1" }], s);
    const made = pasteClipboard(items, { mint: freshMint(), translate, dx: 1, dy: 2 });
    expect(made.refs.map((r) => r.kind)).toEqual(["el", "markup", "measure", "callout", "parcel"]);
    const ids = made.refs.map((r) => r.id);
    expect(new Set(ids).size).toBe(5);
    ["b2", "m1", "s1", "k1", "p1"].forEach((old) => expect(ids).not.toContain(old));
  });
  it("keeps copied group-mates grouped together, under a NEW group id", () => {
    const s = site();
    s.els[0].groupId = "gA"; s.els[4].groupId = "gA";
    const { items } = collectClipboard([{ kind: "el", id: "b1" }, { kind: "el", id: "b2" }], s);
    const made = pasteClipboard(items, { mint: freshMint(), translate, dx: 0, dy: 0 });
    const gids = new Set(made.els.filter((e) => e.groupId).map((e) => e.groupId));
    expect(gids.size).toBe(1);
    expect([...gids][0]).not.toBe("gA");
  });
  it("a member copied WITHOUT its group-mates arrives ungrouped", () => {
    const s = site();
    s.els[0].groupId = "gA"; s.els[4].groupId = "gA";
    const { items } = collectClipboard([{ kind: "el", id: "b2" }], s);
    const made = pasteClipboard(items, { mint: freshMint(), translate, dx: 0, dy: 0 });
    expect(made.els[0].groupId).toBeUndefined();
  });
  it("an easement follows the copied parcel when both ride along", () => {
    const s = site();
    s.markups.push({ id: "e1", kind: "easement", pts: [{ x: 1, y: 1 }], parcelId: "p1" });
    const { items } = collectClipboard([{ kind: "parcel", id: "p1" }, { kind: "markup", id: "e1" }], s);
    const made = pasteClipboard(items, { mint: freshMint(), translate, dx: 0, dy: 0 });
    expect(made.markups[0].parcelId).toBe(made.parcels[0].id);
  });
});

describe("clipboardBBox", () => {
  it("spans the WHOLE set so paste centers the group, not each piece", () => {
    const s = site();
    const { items } = collectClipboard([{ kind: "el", id: "b1" }, { kind: "el", id: "b2" }], s);
    const bb = clipboardBBox(items, bboxOf);
    expect(bb.x0).toBe(0);      // b1's left edge (cx 100, w 200)
    expect(bb.x1).toBe(625);    // b2's right edge (cx 600, w 50)
  });
  it("includes a callout's leader tips, not just its text box", () => {
    const bb = clipboardBBox([{ kind: "callout", obj: site().callouts[0] }], bboxOf);
    expect(bb).toEqual({ x0: 30, y0: 20, x1: 70, y1: 50 });
  });
  it("is null for an empty payload", () => {
    expect(clipboardBBox([], bboxOf)).toBe(null);
  });
});

describe("pure translate helpers", () => {
  it("translateCalloutBy handles the legacy single-`tip` shape", () => {
    const out = translateCalloutBy({ id: "x", box: { x: 0, y: 0 }, tip: { x: 4, y: 4 } }, 2, 3);
    expect(out.tip).toEqual({ x: 6, y: 7 });
    expect(out.tips).toBeUndefined();
  });
  it("translateCalloutBy leaves a box-only text label with no leader", () => {
    const out = translateCalloutBy({ id: "x", box: { x: 1, y: 1 }, noLeader: true }, 1, 1);
    expect(out.box).toEqual({ x: 2, y: 2 });
    expect(clipCalloutTips(out)).toEqual([]);
  });
  it("translateParcelBy moves the whole ring", () => {
    expect(translateParcelBy({ id: "p", points: [{ x: 0, y: 0 }, { x: 2, y: 0 }] }, 1, 1).points)
      .toEqual([{ x: 1, y: 1 }, { x: 3, y: 1 }]);
  });
});
