/* NEW-2 — the reference (site-plan overlay) draw-order model.
 *
 * The owner's report: a coloured land-plan exhibit placed on the map had no way to be brought
 * forward at all — "I don't even have the option to bring it to the front". Within-stack ordering
 * existed (B461/B654); crossing the PLAN did not. These lock the two-band model that adds it.
 */
import { describe, it, expect } from "vitest";
import {
  OVERLAY_BAND_ABOVE, OVERLAY_BAND_BELOW, overlayBand, overlayBandsGrouped, overlayDrawOrder,
  overlayPanelOrder, overlayOrderFlags, reorderOverlays, setOverlayBand, isPinnedMapReference,
  splitOverlayBands,
} from "../src/workspaces/site-planner/lib/overlayOrder.js";

const o = (id, extra = {}) => ({ id, name: id, ...extra });
const ids = (l) => l.map((x) => x.id);

describe("overlayBand — the default is unchanged, and only an explicit true promotes", () => {
  it("a legacy record with no aboveParcel field draws BELOW the plan", () => {
    expect(overlayBand(o("a"))).toBe(OVERLAY_BAND_BELOW);
    expect(overlayBand({})).toBe(OVERLAY_BAND_BELOW);
    expect(overlayBand(null)).toBe(OVERLAY_BAND_BELOW);
  });
  it("only a literal true promotes — a truthy string / 1 does not (a stray value can't silently reorder a plan)", () => {
    expect(overlayBand(o("a", { aboveParcel: true }))).toBe(OVERLAY_BAND_ABOVE);
    for (const v of [false, 0, 1, "true", "yes", null, undefined]) {
      expect(overlayBand(o("a", { aboveParcel: v })), String(v)).toBe(OVERLAY_BAND_BELOW);
    }
  });
});

describe("the array IS the draw order, bottom → top, and it stays band-grouped", () => {
  const mixed = [o("a"), o("b", { aboveParcel: true }), o("c"), o("d", { aboveParcel: true })];

  it("splits into two bands, each keeping its own relative order", () => {
    const { below, above } = { below: overlayDrawOrder(mixed).filter((x) => overlayBand(x) === "below"), above: overlayDrawOrder(mixed).filter((x) => overlayBand(x) === "above") };
    expect(ids(below)).toEqual(["a", "c"]);
    expect(ids(above)).toEqual(["b", "d"]);
  });
  it("draw order puts every below-band reference before every above-band one", () => {
    expect(ids(overlayDrawOrder(mixed))).toEqual(["a", "c", "b", "d"]);
    expect(overlayBandsGrouped(overlayDrawOrder(mixed))).toBe(true);
  });
  it("an already-grouped list comes back BY IDENTITY (no churn on a plan that's already correct)", () => {
    const grouped = [o("a"), o("c"), o("b", { aboveParcel: true })];
    expect(overlayDrawOrder(grouped)).toBe(grouped);
  });
  it("a legacy plan — no aboveParcel anywhere — is trivially grouped and untouched", () => {
    const legacy = [o("a"), o("b"), o("c")];
    expect(overlayBandsGrouped(legacy)).toBe(true);
    expect(overlayDrawOrder(legacy)).toBe(legacy);
  });
  it("the panel lists FRONT-most first, which is the reverse of the draw order", () => {
    expect(ids(overlayPanelOrder(mixed))).toEqual(["d", "b", "c", "a"]);
  });
  it("empty / non-array input never throws", () => {
    expect(overlayDrawOrder(null)).toEqual([]);
    expect(overlayPanelOrder(undefined)).toEqual([]);
    expect(overlayOrderFlags(null, "x").found).toBe(false);
  });
});

describe("overlayOrderFlags — front/back are reported WITHIN the record's own band", () => {
  const l = [o("a"), o("c"), o("b", { aboveParcel: true }), o("d", { aboveParcel: true })];
  it("the last below-band record is atFront even though above-band records draw over it", () => {
    expect(overlayOrderFlags(l, "c")).toMatchObject({ band: OVERLAY_BAND_BELOW, index: 1, count: 2, atFront: true, atBack: false });
  });
  it("the first below-band record is atBack", () => {
    expect(overlayOrderFlags(l, "a")).toMatchObject({ band: OVERLAY_BAND_BELOW, atBack: true, atFront: false });
  });
  it("the above band is measured on its own, not against the whole list", () => {
    expect(overlayOrderFlags(l, "b")).toMatchObject({ band: OVERLAY_BAND_ABOVE, index: 0, count: 2, atBack: true, atFront: false });
    expect(overlayOrderFlags(l, "d")).toMatchObject({ band: OVERLAY_BAND_ABOVE, atFront: true });
  });
  it("a lone reference in its band is at BOTH ends (so both ops grey out)", () => {
    expect(overlayOrderFlags([o("a")], "a")).toMatchObject({ atFront: true, atBack: true, count: 1 });
  });
});

describe("reorderOverlays — moves within the band; never across the plan", () => {
  const l = [o("a"), o("b"), o("c"), o("x", { aboveParcel: true }), o("y", { aboveParcel: true })];

  it("bring to front puts the record last in ITS band — still under the promoted ones", () => {
    expect(ids(reorderOverlays(l, "a", "front"))).toEqual(["b", "c", "a", "x", "y"]);
  });
  it("send to back puts it first in its band", () => {
    expect(ids(reorderOverlays(l, "c", "back"))).toEqual(["c", "a", "b", "x", "y"]);
  });
  it("an above-band record reorders only against the other above-band records", () => {
    expect(ids(reorderOverlays(l, "x", "front"))).toEqual(["a", "b", "c", "y", "x"]);
  });
  it("a no-op returns the SAME array reference, so the caller can skip its undo frame", () => {
    expect(reorderOverlays(l, "c", "front")).toBe(l);   // already front of the below band
    expect(reorderOverlays(l, "a", "back")).toBe(l);    // already back of it
    expect(reorderOverlays(l, "nope", "front")).toBe(l);
    expect(reorderOverlays(l, "a", "sideways")).toBe(l);
  });
  it("an interleaved (pre-grouping) list is normalised even when the move itself is a no-op", () => {
    const interleaved = [o("x", { aboveParcel: true }), o("a")];
    expect(ids(reorderOverlays(interleaved, "a", "front"))).toEqual(["a", "x"]);
  });
  it("never invents, drops or duplicates a record", () => {
    const out = reorderOverlays(l, "b", "front");
    expect(out).toHaveLength(l.length);
    expect(new Set(ids(out))).toEqual(new Set(ids(l)));
  });
});

describe("setOverlayBand — the cross-plan promotion the owner asked for", () => {
  const l = [o("a"), o("b"), o("c")];

  it("promoting lifts one reference over the plan and leaves the rest alone", () => {
    const out = setOverlayBand(l, "b", true);
    expect(ids(out)).toEqual(["a", "c", "b"]);
    expect(out.find((x) => x.id === "b").aboveParcel).toBe(true);
    expect(out.find((x) => x.id === "a").aboveParcel).toBeUndefined();
  });
  it("the promoted reference lands at the FRONT of its new band (you promoted it to see it)", () => {
    const seeded = [o("a"), o("x", { aboveParcel: true })];
    expect(ids(setOverlayBand(seeded, "a", true))).toEqual(["x", "a"]);
  });
  it("demoting puts it back at the front of the below band, above the other backdrops", () => {
    const seeded = [o("a"), o("b"), o("x", { aboveParcel: true })];
    const out = setOverlayBand(seeded, "x", false);
    expect(ids(out)).toEqual(["a", "b", "x"]);
    expect(out.find((y) => y.id === "x").aboveParcel).toBe(false);
  });
  it("it does not MUTATE the record it moves (undo keeps a truthful previous frame)", () => {
    const rec = o("b");
    const out = setOverlayBand([o("a"), rec], "b", true);
    expect(rec.aboveParcel).toBeUndefined();
    expect(out.find((x) => x.id === "b")).not.toBe(rec);
  });
  it("a no-op — already in that band, or an unknown id — returns the SAME array", () => {
    expect(setOverlayBand(l, "b", false)).toBe(l);
    expect(setOverlayBand(l, "nope", true)).toBe(l);
  });
  it("round-tripping promote → demote restores the original membership", () => {
    const out = setOverlayBand(setOverlayBand(l, "a", true), "a", false);
    expect(new Set(ids(out))).toEqual(new Set(ids(l)));
    expect(out.every((x) => overlayBand(x) === OVERLAY_BAND_BELOW)).toBe(true);
  });
});

/* B848736 — the map-captured reference (`fromMap:true`) always renders beneath every other
 * "below"-band reference, matching the retired `underlay` field's absolute-backdrop position. */
describe("isPinnedMapReference + the pin-leading sub-order it drives", () => {
  const pin = o("aerial", { fromMap: true });

  it("only a literal fromMap:true pins — a truthy-but-not-true value does not", () => {
    expect(isPinnedMapReference(pin)).toBe(true);
    for (const v of [false, 0, 1, "true", null, undefined]) {
      expect(isPinnedMapReference(o("a", { fromMap: v })), String(v)).toBe(false);
    }
    expect(isPinnedMapReference(null)).toBe(false);
  });

  it("splitOverlayBands pulls the pinned record to the FRONT of the below band regardless of array position", () => {
    const { below } = splitOverlayBands([o("a"), o("b"), pin]);
    expect(ids(below)).toEqual(["aerial", "a", "b"]);
  });
  it("overlayDrawOrder returns the SAME array reference when the pin already leads (no forced churn)", () => {
    const already = [pin, o("a"), o("b")];
    expect(overlayDrawOrder(already)).toBe(already);
  });
  it("draw order and panel order both put the pinned reference at the very bottom", () => {
    const l = [o("a"), pin, o("b")];
    expect(ids(overlayDrawOrder(l))).toEqual(["aerial", "a", "b"]);
    expect(ids(overlayPanelOrder(l))).toEqual(["b", "a", "aerial"]); // front-most first
  });
  it("a pin promoted to the above band (defensively, via a hand-edited record) still leads only its OWN band", () => {
    const l = [o("a"), { ...pin, aboveParcel: true }, o("b", { aboveParcel: true })];
    expect(ids(overlayDrawOrder(l))).toEqual(["a", "aerial", "b"]);
  });

  it("overlayOrderFlags reports the pinned record atFront AND atBack (nowhere to move to)", () => {
    const l = [o("a"), o("b"), pin];
    expect(overlayOrderFlags(l, "aerial")).toMatchObject({ found: true, atFront: true, atBack: true, pinned: true });
    expect(overlayOrderFlags(l, "a")).toMatchObject({ pinned: false });
  });

  it("reorderOverlays never moves a pinned record — front, back, or with other reordering happening around it", () => {
    const l = [o("a"), o("b"), pin];
    expect(reorderOverlays(l, "aerial", "front")).toBe(l);
    expect(reorderOverlays(l, "aerial", "back")).toBe(l);
  });
  it("setOverlayBand refuses to promote a pinned record above the parcel", () => {
    const l = [o("a"), pin];
    expect(setOverlayBand(l, "aerial", true)).toBe(l);
  });
});
