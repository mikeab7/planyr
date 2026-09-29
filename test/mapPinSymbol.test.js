/* mapPinSymbol — NEW-1 one-size symbol circles for site + note pins (owner-approved mockup
 * 2026-09-29). Asserts against the real builders: every status and the note draw the identical
 * circle, Pursuit/Active carry the warehouse, the note carries the page, the open variant adds
 * a ring without changing the inner circle, and the anchor is the circle centre. */
import { describe, it, expect } from "vitest";
import { sitePinSvg, notePinSvg, pinSvgBox, pinHitBox, pinHtml, PIN_DISC_R, PIN_KEYLINE_R, PIN_CENTER } from "../src/shared/mapNotes/lib/mapPinSymbol.js";
import { mapNoteMarkerSvg, mapNoteMarkerSize } from "../src/shared/mapNotes/lib/mapNoteMarkerIcon.js";
import { STATUS_TOKENS } from "../src/shared/ui/statusTokens.js";
import { compMarkerSvg } from "../src/shared/comps/lib/compMarkerIcon.js";

const STATUSES = Object.keys(STATUS_TOKENS);
const circles = (svg) => [...svg.matchAll(/<circle cx="14" cy="14" r="([\d.]+)"([^>]*)\/>/g)].map((m) => ({ r: +m[1], attrs: m[2] }));
const solid = (svg) => circles(svg).filter((c) => !/fill="none"/.test(c.attrs)).map((c) => c.r);

describe("one size for every pin", () => {
  it("every status and the note draw the same three discs (hairline, keyline, color)", () => {
    const ref = solid(sitePinSvg("pursuit"));
    expect(ref).toEqual([11.4, PIN_KEYLINE_R, PIN_DISC_R]);
    for (const st of STATUSES) expect(solid(sitePinSvg(st))).toEqual(ref);
    expect(solid(notePinSvg())).toEqual(ref);
    for (const st of STATUSES) expect(pinSvgBox(false)).toBe(28);
  });
  it("no drop-shadow / filter anywhere (B850016)", () => {
    for (const st of STATUSES) for (const o of [false, true]) expect(sitePinSvg(st, o)).not.toMatch(/drop-shadow|filter/);
    expect(notePinSvg(true)).not.toMatch(/drop-shadow|filter/);
  });
});

describe("glyphs", () => {
  const warehouse = "M10.1,17.4 V12.9 L14,11.2 L17.9,12.9 V17.4 Z";
  it("Pursuit and Active carry the warehouse with three dock doors", () => {
    for (const st of ["pursuit", "active"]) {
      const s = sitePinSvg(st);
      expect(s).toContain(warehouse);
      expect((s.match(/width="1.6" height="2.4"/g) || []).length).toBe(3);
    }
  });
  it("On hold / Complete / Dead keep pause / check / x, and no warehouse", () => {
    expect(sitePinSvg("onhold")).not.toContain(warehouse);
    expect(sitePinSvg("onhold")).toContain('width="2.6" height="10"');
    expect(sitePinSvg("complete")).toContain("<polyline");
    expect(sitePinSvg("dead")).toContain("M10.6,10.6 L17.4,17.4");
  });
  it("the note carries the folded page in the note color, not a warehouse", () => {
    const n = notePinSvg();
    expect(n).toContain("M11,10 H15.2 L17.4,12.2 V18.2 H11 Z");
    expect(n).not.toContain(warehouse);
    expect(n).toContain(`r="${PIN_DISC_R}" fill="#`);
  });
  it("a note is not a comp diamond and not a bubble", () => {
    expect(compMarkerSvg("lease")).toMatch(/rotate\(45/);
    expect(notePinSvg()).not.toMatch(/rotate\(45/);
  });
});

describe("open variant", () => {
  it("adds a white-under-color ring OUTSIDE the circle and leaves the inner circle unchanged", () => {
    for (const st of STATUSES) {
      const closed = sitePinSvg(st, false), open = sitePinSvg(st, true);
      expect(circles(closed).some((c) => /fill="none"/.test(c.attrs))).toBe(false);
      const rings = circles(open).filter((c) => /fill="none"/.test(c.attrs));
      expect(rings.length).toBe(2);
      expect(rings.every((c) => c.r > PIN_KEYLINE_R + 1)).toBe(true);
      expect(rings[0].attrs).toContain('stroke="#fff" stroke-width="3.2"');
      expect(rings[1].attrs).toContain('stroke-width="1.8"');
      expect(solid(open)).toEqual(solid(closed));
    }
  });
  it("the svg grows at the SAME scale (1 unit = 1 px), so the circle never shrinks", () => {
    expect(pinSvgBox(true)).toBeGreaterThan(pinSvgBox(false));
    const open = sitePinSvg("active", true);
    const box = pinSvgBox(true), pad = (box - 28) / 2;
    expect(open).toContain(`width="${box}" height="${box}" viewBox="${-pad} ${-pad} ${box} ${box}"`);
  });
  it("the note's open ring is in the note color", () => {
    expect(notePinSvg(true)).toMatch(/r="13.6"[^>]*stroke="#[0-9a-fA-F]{6}" stroke-width="1.8"/);
  });
});

describe("anchor", () => {
  it("is the circle centre for site and note, in a fixed hit box that never changes", () => {
    const hb = pinHitBox();
    expect(hb.anchor).toEqual([hb.size[0] / 2, hb.size[1] / 2]);
    expect(hb.size[0]).toBeGreaterThanOrEqual(34);
    expect(hb.size[1]).toBeGreaterThanOrEqual(46);
    expect(mapNoteMarkerSize(false)).toEqual(hb);
    expect(mapNoteMarkerSize(true)).toEqual(hb);
  });
  it("the wrapper seats the circle centre exactly on the anchor, open or not", () => {
    const { anchor } = pinHitBox();
    for (const open of [false, true]) {
      const html = pinHtml(sitePinSvg("active", open), open);
      const [, left, top, w] = html.match(/left:([\d.-]+)px;top:([\d.-]+)px;display:block;width:([\d.]+)px/).map(Number);
      const pad = (w - 28) / 2;
      expect(left + pad + PIN_CENTER).toBeCloseTo(anchor[0], 1);
      expect(top + pad + PIN_CENTER).toBeCloseTo(anchor[1], 1);
    }
  });
  it("mapNoteMarkerSvg delegates to the shared circle", () => {
    expect(mapNoteMarkerSvg()).toBe(notePinSvg(false));
    expect(mapNoteMarkerSvg({ selected: true })).toBe(notePinSvg(true));
  });
});
