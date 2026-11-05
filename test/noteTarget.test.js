/* noteTarget — the pure half of "the note composer keeps its target in view" (NEW-1, 2026-10-08). */
import { describe, it, expect } from "vitest";
import {
  noteTargetLabel, selectionLabel, siteAtAnchor, composerBox, panToFitRect, keyboardInset, geomContains, SITE_NEAR_PIN_M,
} from "../src/shared/mapNotes/lib/noteTarget.js";

const SQUARE = { type: "Polygon", coordinates: [[[-95.40, 29.70], [-95.38, 29.70], [-95.38, 29.72], [-95.40, 29.72], [-95.40, 29.70]]] };
const SITES = [
  { id: "a", site: "Goose Creek", origin: { lat: 29.71, lon: -95.39 } },
  { id: "b", site: "Far Away", origin: { lat: 30.5, lon: -96.1 } },
];

describe("noteTargetLabel — the composer names what it is attached to", () => {
  it("a parcel that holds a saved site is named by the SITE", () => {
    const l = noteTargetLabel({ kind: "parcel", lat: 29.705, lon: -95.395, parcelGeom: SQUARE, label: "123 Main St" }, SITES);
    expect(l).toEqual({ kind: "site", text: "Goose Creek" });
  });
  it("a parcel with no site falls back to its address, then its account", () => {
    expect(noteTargetLabel({ kind: "parcel", lat: 31, lon: -97, label: "123 Main St" }, SITES).text).toBe("123 Main St");
    expect(noteTargetLabel({ kind: "parcel", lat: 31, lon: -97, parcelApn: "R12345, R999" }, SITES).text).toBe("Account R12345");
  });
  it("never the bare, nameless 'On a parcel'", () => {
    const l = noteTargetLabel({ kind: "parcel", lat: 31, lon: -97 }, []);
    expect(l.text.length).toBeGreaterThan(0);
  });
  it("a pin near a saved site is that site; elsewhere it reads its coordinates", () => {
    expect(noteTargetLabel({ kind: "pin", lat: 29.7101, lon: -95.3901 }, SITES).text).toBe("Goose Creek");
    expect(noteTargetLabel({ kind: "pin", lat: 31.12346, lon: -97.5 }, SITES).text).toBe("dropped pin (31.1235, -97.5000)");
  });
  it("two adjacent sites never swap names — the nearest wins", () => {
    const two = [{ site: "North", origin: { lat: 29.7008, lon: -95.39 } }, { site: "South", origin: { lat: 29.7001, lon: -95.39 } }];
    expect(siteAtAnchor({ kind: "pin", lat: 29.7002, lon: -95.39 }, two).site).toBe("South");
  });
  it("a site beyond the pin radius does not claim the pin", () => {
    expect(SITE_NEAR_PIN_M).toBeGreaterThan(0);
    expect(siteAtAnchor({ kind: "pin", lat: 29.72, lon: -95.39 }, SITES)).toBeNull();
  });
});

describe("selectionLabel", () => {
  it("one parcel: address, else account; several: led by the first with a count", () => {
    expect(selectionLabel([{ addr: "1 A St" }])).toBe("1 A St");
    expect(selectionLabel([{ acct: "77" }])).toBe("Account 77");
    expect(selectionLabel([{ addr: "1 A St" }, {}, {}])).toBe("1 A St + 2 more");
    expect(selectionLabel([{}, {}])).toBe("2 parcels");
    expect(selectionLabel([])).toBe("");
  });
});

describe("geomContains", () => {
  it("point in polygon", () => {
    expect(geomContains(SQUARE, -95.39, 29.71)).toBe(true);
    expect(geomContains(SQUARE, -95.5, 29.71)).toBe(false);
    expect(geomContains(null, 0, 0)).toBe(false);
  });
});

describe("panToFitRect — the smallest pan that clears the card", () => {
  const size = { w: 400, h: 700 };
  const inset = { top: 76, left: 16, right: 16, bottom: 380 };   // card + gap cover the bottom
  it("a target already in the clear area does not move", () => {
    expect(panToFitRect({ left: 200, right: 200, top: 300, bottom: 300 }, size, inset)).toEqual({ dx: 0, dy: 0 });
  });
  it("a target hidden behind the card is lifted just into view", () => {
    const { dx, dy } = panToFitRect({ left: 200, right: 200, top: 600, bottom: 600 }, size, inset);
    expect(dx).toBe(0);
    expect(dy).toBe(320 - 600);                       // safe bottom is 700 - 380
  });
  it("a target off the top edge is brought down below the toolbar", () => {
    expect(panToFitRect({ left: 200, right: 200, top: 10, bottom: 10 }, size, inset).dy).toBe(66);
  });
  it("a parcel taller than the clear area is centred in it, not clipped", () => {
    const { dy } = panToFitRect({ left: 100, right: 300, top: 0, bottom: 690 }, size, inset);
    expect(dy).toBe((76 + 320) / 2 - 345);
  });
  it("a degenerate safe area asks for no pan", () => {
    expect(panToFitRect({ left: 200, right: 200, top: 0, bottom: 0 }, { w: 400, h: 300 }, { top: 76, left: 16, right: 16, bottom: 400 })).toEqual({ dx: 0, dy: 0 });
  });
});

describe("composerBox / keyboardInset", () => {
  it("rests at the old position with no keyboard", () => {
    expect(composerBox({ containerH: 700 }).bottom).toBe(44);
  });
  it("rides above the keyboard and caps its height to the room left", () => {
    const b = composerBox({ containerH: 700, kbInset: 300 });
    expect(b.bottom).toBe(308);
    expect(b.maxHeight).toBe(700 - 308 - 64);
  });
  it("never collapses below a usable height", () => {
    expect(composerBox({ containerH: 300, kbInset: 280 }).maxHeight).toBe(160);
  });
  it("a collapsing browser toolbar is not a keyboard; a real overlap is", () => {
    expect(keyboardInset({ mapBottom: 800, vvTop: 0, vvHeight: 740, innerHeight: 800 })).toBe(0);
    expect(keyboardInset({ mapBottom: 800, vvTop: 0, vvHeight: 480, innerHeight: 800 })).toBe(320);
    expect(keyboardInset({ mapBottom: 800, vvHeight: 0, innerHeight: 800 })).toBe(0);
  });
});
