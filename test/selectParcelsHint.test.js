/* selectParcelsHint — NEW-1: the Select-parcels bottom hint is ONE short line per stage, from ONE source (owner-approved copy 2026-10-22).
 * Red on the pre-change tree: the module did not exist and MapFinder carried the long sentences inline. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { selectParcelsHintFor, SELECT_PARCELS_HINT } from "../src/workspaces/site-planner/lib/selectParcelsHint.js";
import { ALL_SHORTCUT_ITEMS } from "../src/shared/keyboard/shortcutsData.js";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
// A source with a verified size column: every lot at 16, mid at 15, wide at 14, nothing below.
const wideSrc = [{ floor: 16, wide: true }];
const noWideSrc = [{ floor: 16, wide: false }];

describe("selectParcelsHintFor — stage → copy", () => {
  it("too far out for any outline: the zoom-in instruction, medium weight", () => {
    const h = selectParcelsHintFor({ zoom: 12, outlineSources: wideSrc, outlineFloor: 16 });
    expect(h.text).toBe("Zoom in to see lots");
    expect(h.icon).toBe("zoom-in");
    expect(h.strong).toBe(true);
  });
  it("a source with no wide stage is far as soon as it is under its cutoff", () => {
    expect(selectParcelsHintFor({ zoom: 15, outlineSources: noWideSrc, outlineFloor: 16 }).key).toBe("far");
  });
  it("the mid and wide stages say large lots only", () => {
    for (const zoom of [15, 14]) {
      const h = selectParcelsHintFor({ zoom, outlineSources: wideSrc, outlineFloor: 16 });
      expect(h.text, `zoom ${zoom}`).toBe("Large lots only. Zoom in for all.");
      expect(h.icon).toBe("zoom-in");
      expect(h.strong).toBe(false);
    }
  });
  it("every lot showing: the pointer line, no 'then Plan', no hover instructions, no symbols", () => {
    const h = selectParcelsHintFor({ zoom: 17, outlineSources: wideSrc, outlineFloor: 16 });
    expect(h.text).toBe("Click lots to add or remove");
    expect(h.icon).toBe("pointer");
    expect(h.text).not.toMatch(/Plan|hover|[＋−()]/i);
  });
  it("with no source list it falls back to the single cutoff", () => {
    expect(selectParcelsHintFor({ zoom: 14, outlineSources: [], outlineFloor: 15 }).key).toBe("far");
    expect(selectParcelsHintFor({ zoom: 15, outlineSources: [], outlineFloor: 15 }).key).toBe("all");
    expect(selectParcelsHintFor({ zoom: null, outlineSources: [], outlineFloor: 15 }).key).toBe("all");
  });
  it("the two failure states are named, only once past 'far', and never hide it", () => {
    expect(selectParcelsHintFor({ zoom: 15, outlineSources: wideSrc, outlineFloor: 16, wideBusy: true }).text).toMatch(/server is busy/i);
    expect(selectParcelsHintFor({ zoom: 17, outlineSources: wideSrc, outlineFloor: 16, slowLoading: true }).text).toMatch(/still loading/i);
    expect(selectParcelsHintFor({ zoom: 12, outlineSources: wideSrc, outlineFloor: 16, wideBusy: true, slowLoading: true }).key).toBe("far");
  });
  it("every line is one short sentence — no old long copy survives", () => {
    for (const h of Object.values(SELECT_PARCELS_HINT)) expect(h.text.length, h.key).toBeLessThanOrEqual(52);
  });
});

describe("the banner reads ONLY this module", () => {
  const src = read("src/workspaces/site-planner/MapFinder.jsx");
  it("MapFinder asks selectParcelsHintFor and carries none of the old sentences", () => {
    expect(src).toMatch(/selectParcelsHintFor\(/);
    for (const old of ["even before the purple outlines", "Zoom in a little to see the lines", "Add several, then Plan", "Hover an added lot and click to remove", "Showing larger lots."]) {
      expect(src.includes(old), old).toBe(false);
    }
  });
  it("there is no Zoom in BUTTON in the banner (the hint never moves the map)", () => {
    const i = src.indexOf('data-testid="select-parcels-tip"');
    const block = src.slice(i, src.indexOf("</FloatingNotice>", i));
    expect(block).not.toMatch(/<button|onClick|setView|flyTo|zoomIn/);
  });
});

describe("hover-to-remove is still discoverable", () => {
  it("the ? Keyboard Shortcuts page lists it", () => {
    const it = ALL_SHORTCUT_ITEMS.find((i) => i.id === "site.map-remove-lot");
    expect(it).toBeTruthy();
    expect(it.keysText).toMatch(/hover/i);
  });
});
