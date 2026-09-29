/* mapNoteMarkerIcon — the map-note marker (NEW-1; re-shaped to the shared symbol circle 2026-09-29).
 *
 * The brief asks for a marker "visually distinct from a comp marker". That is the thing under test
 * here, and it is asserted against the REAL comp marker rather than described in a comment: three
 * things are drawn on this map (site pin · comp tag · note bubble) and two of them must never be
 * confusable. Colour AND shape, not colour alone — the map is read over aerial imagery, and B433's
 * colorblind reasoning applies to telling a note from a comp as much as to two deal stages.
 */
import { describe, it, expect } from "vitest";
import { mapNoteMarkerSvg, mapNoteMarkerSize, NOTE_MARKER_COLOR } from "../src/shared/mapNotes/lib/mapNoteMarkerIcon.js";
import { compMarkerSvg, compMarkerColor, compMarkerSize } from "../src/shared/comps/lib/compMarkerIcon.js";
import { PALETTES } from "../src/shared/theme/palette.js";

describe("the note marker is distinct from a comp marker", () => {
  it("uses a colour no comp type uses", () => {
    for (const t of ["land", "building_sale", "lease", "unknown"]) {
      expect(compMarkerColor(t).toLowerCase()).not.toBe(NOTE_MARKER_COLOR.toLowerCase());
    }
  });

  it("uses a different SHAPE — a circle, never the comp's rotated tag", () => {
    const note = mapNoteMarkerSvg();
    expect(note).not.toMatch(/rotate\(45/);      // the comp tag's signature
    expect(compMarkerSvg("lease")).toMatch(/rotate\(45/);
    expect(note).toMatch(/<circle /);
  });

  it("anchors at the circle CENTRE, like a comp tag (NEW-1 — was the bubble's tail tip)", () => {
    const { size, anchor } = mapNoteMarkerSize(false);
    expect(anchor).toEqual([size[0] / 2, size[1] / 2]);
    const comp = compMarkerSize(false);
    expect(comp.anchor).toEqual([comp.size[0] / 2, comp.size[0] / 2]);
  });
});

describe("the note marker follows the map-marker rules", () => {
  it("is solid-filled with a hard white keyline — never hollow over aerial imagery (B434)", () => {
    const svg = mapNoteMarkerSvg();
    expect(svg).toContain('fill="#fff"');   // white keyline + glyph
    expect(svg).toContain(`fill="${NOTE_MARKER_COLOR}"`);
    expect(svg).not.toMatch(/<circle[^>]*fill="none"/);   // no hollow ring on an unopened pin
  });

  it("carries no drop-shadow halo (B850016 — a blur is exactly the glow the owner rejected)", () => {
    expect(mapNoteMarkerSvg()).not.toMatch(/drop-shadow|filter=/);
    expect(mapNoteMarkerSvg({ selected: true })).not.toMatch(/drop-shadow|filter=/);
  });

  it("takes its colour from the shared theme mirror, not a hand-picked hex", () => {
    expect(NOTE_MARKER_COLOR).toBe(PALETTES.light.accentNotes);
  });

  it("selected adds a ring but keeps the anchor and the hit box", () => {
    expect(mapNoteMarkerSize(true)).toEqual(mapNoteMarkerSize(false));
    expect(mapNoteMarkerSvg({ selected: true })).toContain('stroke-width="3.2"');
  });
});
