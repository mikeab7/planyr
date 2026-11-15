/* notesChipPlace — B2671237: the paste-options tab covers no text when any spot near the caret is clear. */
import { describe, it, expect } from "vitest";
import { placeChip, coveredArea } from "../src/workspaces/notes/lib/notesChipPlace.js";

const chip = { w: 66, h: 26 };
const host = { w: 1400, h: 900 };
const line = (left, top, right, bottom) => ({ left, top, right, bottom });

describe("placeChip", () => {
  it("keeps the historic spot (just below the caret) when nothing is there", () => {
    const at = { x: 200, y: 300, yTop: 284 };
    expect(placeChip({ chip, at, obstacles: [line(200, 284, 420, 300)], host })).toEqual({ left: 200, top: 304, covered: 0 });
  });
  it("owner's screenshot: text of the next box sits right under the caret -> it goes beside the row, covering nothing", () => {
    const at = { x: 220, y: 330, yTop: 314 };
    const obstacles = [line(200, 314, 560, 330), line(200, 332, 480, 348) /* the next box's text */];
    const r = placeChip({ chip, at, obstacles, host });
    expect(r.covered).toBe(0);
    expect(coveredArea({ left: r.left, top: r.top, w: 66, h: 26 }, obstacles)).toBe(0);
  });
  it("falls back to the least-covering spot, never to nothing, when the page is wall to wall", () => {
    const wall = [line(0, 0, 1400, 900)];
    const r = placeChip({ chip, at: { x: 50, y: 60, yTop: 44 }, obstacles: wall, host });
    expect(r.covered).toBeGreaterThan(0);
    expect(r.left).toBeGreaterThanOrEqual(6);
  });
  it("stays inside the host", () => {
    const r = placeChip({ chip, at: { x: 1395, y: 890, yTop: 874 }, obstacles: [], host });
    expect(r.left + 66).toBeLessThanOrEqual(1394);
    expect(r.top + 26).toBeLessThanOrEqual(894);
  });
});
