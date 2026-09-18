import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { calloutLayout } from "../src/workspaces/site-planner/lib/calloutLayout.js";

/* NEW-1 (B1612640) — "text box border/padding uneven top vs bottom". Root cause: three padded-box
 * text renders (the callout/text-box body, the parcel acreage chip, the measurement summary chip)
 * shared one hand-tuned magic ratio (`fontPx * 0.82` / `fs * 0.82`, off the DEFAULT alphabetic SVG
 * text baseline) to place a line of text inside a box whose HEIGHT is built symmetrically
 * (`h = lines*lineH + padY*2`). That ratio was tuned to look centred on one sample string and put
 * measurably more white space on one side than the other for every other string (live-measured,
 * pre-fix: 11.37px / 7.68px / 3.61px top-vs-bottom slot asymmetry on the three sites respectively
 * — see ui-audit/verify-callout-padding-symmetry.mjs). The fix places each line at its own SLOT
 * CENTRE (`padY + lineH/2 + i*lineH`) via `dominantBaseline="middle"`, which is symmetric BY
 * CONSTRUCTION: the gap from the box top to the first slot's centre and from the last slot's
 * centre to the box bottom are both exactly `padY + lineH/2`, for any line count — and matches the
 * `dominantBaseline="middle"` convention every other centred <text> in SitePlanner.jsx already
 * uses (element name labels, dimension numbers). */

const SP = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

describe("NEW-1 (B1612640): callout/chip text is centred on its slot, not a magic baseline ratio", () => {
  it("the banned magic-ratio baseline offset is gone from every padded-box text render", () => {
    // A source-level regression guard against the exact OLD broken expressions (not just the bare
    // "* 0.82" substring, which this file's own explanatory comments also mention by name) — this
    // is what produced the reported asymmetry, copy-pasted across all three sites, so a merge that
    // resurrects any one of them regresses the whole class.
    expect(SP).not.toMatch(/padY \+ fontPx \* 0\.82 \+ i \* lineH/);
    expect(SP).not.toMatch(/boxH \/ 2 \+ padY \+ fs \* 0\.82/);
    expect(SP).not.toMatch(/chip\.padY \+ chip\.lh \* k \+ fs \* 0\.82/);
  });

  it("the callout/text-box body centres each line via dominantBaseline=\"middle\" at its own slot", () => {
    expect(SP).toMatch(/y=\{bp\.y - h \/ 2 \+ padY \+ lineH \/ 2 \+ i \* lineH\}[^>]*dominantBaseline="middle"/);
  });

  it("the parcel acreage chip centres its single line the same way", () => {
    expect(SP).toMatch(/y=\{c\.y - boxH \/ 2 \+ padY \+ fs \/ 2\}[^>]*dominantBaseline="middle"/);
  });

  it("the measurement summary chip centres every row the same way", () => {
    expect(SP).toMatch(/chip\.c\.y - chip\.boxH \/ 2 \+ chip\.padY \+ chip\.lh \* k \+ chip\.lh \/ 2/);
    expect(SP).toMatch(/y=\{y\}[^>]*dominantBaseline="middle"/);
  });

  it("calloutLayout's own box-height formula keeps the slot-symmetry invariant for any line count", () => {
    // Algebraic proof, tied to the REAL calloutLayout() output (not a re-derivation): for h =
    // n*lineH + padY*2, the first slot's centre sits padY+lineH/2 below the top and the last
    // slot's centre sits the identical distance above the bottom, for every n and every ppf.
    const st = { size: 13, bold: false, lineHeight: 1.3, padX: 14, padY: 8 };
    for (const text of ["one line", "two\nlines", "three\nlines\nhere", "four\nlines\nin\nthis box"]) {
      for (const ppf of [0.2, 0.35, 0.9]) {
        const g = calloutLayout({ text }, st, ppf);
        const n = g.lines.length;
        const topGap = g.padY + g.lineH / 2;
        const lastSlotCentre = g.padY + g.lineH / 2 + (n - 1) * g.lineH;
        const bottomGap = g.h - lastSlotCentre;
        expect(bottomGap).toBeCloseTo(topGap, 6);
      }
    }
  });
});
