import { describe, it, expect } from "vitest";
import { profileCrossing, judgeCrossing, cropPng } from "../ui-audit/lib/slideCrop.mjs";
import { decodePng } from "../ui-audit/lib/pngDiff.mjs";

/* V1882768 / B2426464 ×4 — the microscope behind measure-parcel-zoom-slide --crops. A frame reading over the limit is either the outline
 * off its imagery (the bug) or the imagery disagreeing with itself (two basemap levels on screen at once). Known pictures in, known verdicts out. */
const W = 160, H = 160;
const RED = [255, 0, 0], INK = [167, 27, 166];
function canvas() { const data = Buffer.alloc(W * H * 3, 255); return { width: W, height: H, channels: 3, data, set(x, y, c) { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 3; data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; } }; }
/* a vertical band (8 px) centred at bandX(y), and a straight 2 px outline at inkX */
function scene(bandX, inkX) {
  const img = canvas();
  for (let y = 0; y < H; y++) { const c = bandX(y); for (let x = c - 4; x < c + 4; x++) img.set(x, y, RED); img.set(inkX, y, INK); img.set(inkX + 1, y, INK); }
  return img;
}
const at = { x: 80, y: 80, horizontal: true };

describe("slideCrop", () => {
  it("a straight band with the outline beside it is the outline off its imagery", () => {
    const j = judgeCrossing(profileCrossing(scene(() => 80, 84), at));
    expect(j.verdict).toBe("outline-off-imagery");
    expect(j.worstOffset).toBeGreaterThan(3);
  });
  it("a band that jumps along its length, the straight outline on it elsewhere, is imagery vs imagery", () => {
    const j = judgeCrossing(profileCrossing(scene((y) => (y < 90 ? 80 : 85), 79), at));
    expect(j.verdict).toBe("imagery-vs-imagery");
    expect(j.bandSpread).toBeGreaterThan(2);
  });
  it("an outline on a straight band reads on the band everywhere (neither failure)", () => {
    const j = judgeCrossing(profileCrossing(scene(() => 80, 79), at));
    expect(j.onBandShare).toBe(1);
    expect(j.verdict).not.toBe("outline-off-imagery");
  });
  it("the crop is a magnified PNG of the spot", () => {
    const png = decodePng(cropPng(scene(() => 80, 84), at, { half: 10, zoom: 3 }));
    expect(png.width).toBe(21 * 3);
  });
});

describe("slideCrop — overlapping copies", () => {
  it("two copies of the band overlapping, one ending part way, with the outline on one, is imagery vs imagery", () => {
    const img = canvas();
    for (let y = 0; y < H; y++) { for (let x = 76; x < 84; x++) img.set(x, y, RED); if (y < 70) for (let x = 82; x < 90; x++) img.set(x, y, RED); img.set(79, y, INK); img.set(80, y, INK); }
    const j = judgeCrossing(profileCrossing(img, at));
    expect(j.verdict).toBe("imagery-vs-imagery");
  });
});

describe("slideCrop — a tile seam", () => {
  it("a narrow piece of band running on past the outline's own band (a second imagery level at a tile seam) is imagery vs imagery", () => {
    const img = canvas();
    // this level's band 80±7 with the outline inside it, ending at y = 70; the neighbouring tile's older level adds a 5 px piece at 73..78 that runs on to y = 50
    for (let y = 70; y < H; y++) { for (let x = 73; x < 88; x++) img.set(x, y, RED); img.set(82, y, INK); img.set(83, y, INK); }
    for (let y = 50; y < H; y++) for (let x = 73; x < 78; x++) img.set(x, y, RED);
    const j = judgeCrossing(profileCrossing(img, at));
    expect(j.verdict).toBe("imagery-vs-imagery");
    expect(j.strayPieces).toBeGreaterThan(1);
  });
});
