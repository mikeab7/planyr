/* NEW-1 — the setback CHIP's ink is DECOUPLED from the setback LINE's colour.
 *
 * Owner report, 2026-07-30, minutes after the green property-line default (B1192) merged: the
 * chip on the live map came back WHITE PLATE / GREEN BORDER / GREEN TEXT. It had been black
 * since B1184–B1187 — but only accidentally so. The render site resolved
 *
 *     const sbCol = selParcel.sbStroke || PAL.chipInk;
 *
 * which reads black exactly while nobody has set a setback colour. Move the default (or let a
 * user pick any colour at all) and the chip inherits it again — the amber-chip-on-amber-band
 * unreadability the ink token was minted to end.
 *
 * So these tests pin the COUPLING, not the value. A suite that asserted "the chip is black when
 * the line is green" would pass today and rot on the next default change; every case here feeds
 * an ARBITRARY, deliberately non-black line colour and asserts the chip is unmoved.
 *
 * Two halves, because the bug lived in the wiring rather than in the library:
 *   1  the pure derivation — `setbackChipStyle` takes NO parcel, so there is nothing to couple to
 *   2  a SOURCE GUARD on the one render site in `SitePlanner.jsx`, so a future edit cannot quietly
 *      reintroduce a per-parcel colour into the chip's `stroke` / `fill`
 *
 * (The browser-level proof — an arbitrary `sbStroke` seeded on a real parcel, then the chip's
 * COMPUTED border and text read off the live canvas — is `ui-audit/verify-setback-chip-ink.mjs`.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { setbackChipStyle, setbackLineStyle, parcelDefaultStyle } from "../src/workspaces/site-planner/lib/planStyle.js";
import { PALETTES } from "../src/shared/theme/palette.js";

const INK = "#15171C";                       // the theme's chip-ink token, both themes
// Arbitrary line colours — none of them black, none of them the current default. The point is
// that the chip is indifferent to ALL of them, not that it survives one particular one.
const WILD = ["#34E802", "#EF9F27", "#4F46E5", "rgb(255,0,255)", "hsl(120 90% 40%)", "papayawhip"];

describe("setbackChipStyle — the chip's ink tracks nothing on the parcel", () => {
  it("takes no parcel at all (the decoupling is structural)", () => {
    expect(setbackChipStyle.length).toBe(1);
  });

  it("is the ink on a white plate, for border and numerals alike", () => {
    expect(setbackChipStyle(INK)).toEqual({ plate: "#fff", stroke: INK, text: INK });
  });

  it("is byte-identical whatever colour the setback LINE is", () => {
    const base = setbackChipStyle(INK);
    for (const stroke of WILD) {
      // The render site can only ever call it the one way, but assert against the full parcel
      // shape too: no future signature may smuggle the parcel back in.
      const pc = { id: "p1", points: [], sbStroke: stroke, stroke, sbWeight: 4, sbDash: "dotted" };
      expect(setbackChipStyle(INK, pc)).toEqual(base);
      expect(setbackChipStyle(INK, pc).stroke).toBe(INK);
      expect(setbackChipStyle(INK, pc).text).toBe(INK);
    }
  });

  it("the LINE still takes the override the chip refuses (B1100 is untouched)", () => {
    for (const stroke of WILD) {
      expect(setbackLineStyle({ sbStroke: stroke }, "#34E802").stroke).toBe(stroke);
    }
    // …and with no override the line falls to the theme default, which the chip still ignores.
    expect(setbackLineStyle({}, "#34E802").stroke).toBe("#34E802");
    expect(setbackChipStyle(INK).stroke).toBe(INK);
  });

  it("a parcel stamped from Standards carries the line colour and never a chip colour", () => {
    const stamped = parcelDefaultStyle({ parcelStyle: { sbStroke: "#34E802", stroke: "#34E802" } });
    expect(stamped.sbStroke).toBe("#34E802");
    expect(setbackChipStyle(INK).stroke).toBe(INK);
  });

  it("the ink token is defined, and is ink, in BOTH themes", () => {
    for (const name of ["light", "dark"]) {
      const ink = PALETTES[name].canvasChipInk;
      expect(ink).toBeTruthy();
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16));
      // Relative luminance well under a mid grey — a "black token" that drifted light would make
      // this test's whole premise (readable dark numerals on a white plate) false.
      expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeLessThan(60);
    }
  });
});

describe("source guard — the one chip render site cannot recouple", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");

  // The chip block: from the `pill` factory that draws it to the end of that factory.
  const block = (() => {
    const start = src.indexOf("const pill = (key, anchor, txt, onEdit)");
    expect(start, "the setback-chip `pill` factory moved — retarget this guard").toBeGreaterThan(0);
    // NEW-3 replaced `const roleTxt` (the old unconditional "<Role> · <n>′" builder) with the
    // `chipRoleWords` rule, so the factory now ends at the line after it.
    const end = src.indexOf("const n = selParcel.points.length;", start);
    expect(end, "could not find the end of the chip block").toBeGreaterThan(start);
    return src.slice(start, end);
  })();

  it("draws the chip from setbackChipStyle", () => {
    expect(src).toMatch(/setbackChipStyle\(PAL\.chipInk\)/);
    expect(block).toMatch(/stroke=\{chipStyle\.stroke\}/);
    expect(block).toMatch(/fill=\{chipStyle\.text\}/);
    expect(block).toMatch(/fill=\{chipStyle\.plate\}/);
  });

  it("reads no per-parcel or per-line colour inside the chip", () => {
    for (const forbidden of ["sbStroke", "sbs.stroke", "PAL.setback", "PAL.parcel", "selParcel.stroke"]) {
      expect(block, `the setback chip must not read ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("the chip ink is derived once, from the token, with no fallback chain", () => {
    // A `||` / `??` on the chip-ink line is how the coupling came back last time.
    const line = src.split("\n").find((l) => l.includes("setbackChipStyle(PAL.chipInk)"));
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/\|\||\?\?/);
  });
});
