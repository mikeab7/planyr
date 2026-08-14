/* HOW FAR APART THE LINES ARE (NEW-7) — the pure half.
 *
 * ⛔ SPACING IS A BLOCK PROPERTY, NOT A TEXT STYLE. Half a line cannot be one-and-a-half
 * spaced; putting it on a text style would let the document express a state no layout can
 * honour. And ONE attribute writes the whole style string, because three that each wrote
 * `style` would overwrite one another — the last rendered would win and the other two would
 * silently vanish, which is the sort of bug that only appears on the third setting.
 */
import { describe, expect, it } from "vitest";

import { DENSITIES, DEFAULT_DENSITY, SINGLE, densityFor, densityStyle, blockFontSize,
  BLOCK_SPACES, LINE_SPACINGS, spacingFromElement, spacingLabel, spacingStyle,
} from "../src/workspaces/notes/lib/notesSpacing.js";

describe("spacingStyle", () => {
  it("says nothing when there is nothing to say — a paragraph starts with no spacing of its own", () => {
    expect(spacingStyle({})).toBe("");
    expect(spacingStyle({ lineHeight: null, spaceBefore: null, spaceAfter: null })).toBe("");
    expect(spacingStyle()).toBe("");
  });

  it("⛔ WRITES ALL THREE IN ONE STRING, so none of them can overwrite another", () => {
    expect(spacingStyle({ lineHeight: 1.5, spaceBefore: 6, spaceAfter: 12 }))
      .toBe("line-height:1.5;margin-top:6px;margin-bottom:12px");
  });

  it("writes only what was set", () => {
    expect(spacingStyle({ lineHeight: 2 })).toBe("line-height:2");
    expect(spacingStyle({ spaceAfter: 20 })).toBe("margin-bottom:20px");
  });

  it("refuses a value that is not a positive number, rather than emitting nonsense into the markup", () => {
    expect(spacingStyle({ lineHeight: 0 })).toBe("");
    expect(spacingStyle({ lineHeight: -1 })).toBe("");
    expect(spacingStyle({ lineHeight: "wide" })).toBe("");
    expect(spacingStyle({ spaceBefore: NaN })).toBe("");
  });

  it("rounds the pixel values — a fractional margin in the markup helps nobody", () => {
    expect(spacingStyle({ spaceBefore: 6.4, spaceAfter: 11.6 })).toBe("margin-top:6px;margin-bottom:12px");
  });
});

describe("spacingFromElement — the round trip, which is what a paste and a reload need", () => {
  const el = (style) => ({ style });

  it("reads all three back", () => {
    expect(spacingFromElement(el({ lineHeight: "1.5", marginTop: "6px", marginBottom: "12px" })))
      .toEqual({ lineHeight: 1.5, spaceBefore: 6, spaceAfter: 12, fontSize: null });
  });

  it("an absent value comes back as null, which is the attribute's default", () => {
    expect(spacingFromElement(el({}))).toEqual({ lineHeight: null, spaceBefore: null, spaceAfter: null, fontSize: null });
    expect(spacingFromElement(null)).toEqual({ lineHeight: null, spaceBefore: null, spaceAfter: null, fontSize: null });
  });

  it("⛔ SURVIVES THE ROUND TRIP — what renderHTML writes is what parseHTML reads", () => {
    /* ⛔ `fontSize` JOINS THE ROUND TRIP (NEW-SPACING-2). A block's own size is written into the
     * same style string, so it has to survive a reload and a paste like the other three — and if
     * it did not, a paragraph made smaller would come back full height on the next load. */
    const KEY = { "line-height": "lineHeight", "margin-top": "marginTop", "margin-bottom": "marginBottom", "font-size": "fontSize" };
    for (const attrs of [
      { lineHeight: 1.15, spaceBefore: null, spaceAfter: null, fontSize: null },
      { lineHeight: 2, spaceBefore: 12, spaceAfter: 20, fontSize: null },
      { lineHeight: null, spaceBefore: 6, spaceAfter: null, fontSize: null },
      { lineHeight: null, spaceBefore: null, spaceAfter: null, fontSize: 11 },
      { lineHeight: 1.15, spaceBefore: 6, spaceAfter: 6, fontSize: 24 },
    ]) {
      const style = {};
      for (const rule of spacingStyle(attrs).split(";").filter(Boolean)) {
        const [k, v] = rule.split(":");
        style[KEY[k]] = v;
      }
      expect(spacingFromElement({ style })).toEqual(attrs);
    }
  });
});

describe("the choices", () => {
  it("Single is the absence of a setting, not a number — so a note keeps its own spacing", () => {
    expect(LINE_SPACINGS[0]).toEqual({ label: "Default", value: null });
    expect(LINE_SPACINGS[1]).toEqual({ label: "Single", value: 1.15 });
    // …and every named value ABOVE Single is looser than it, so the names are honest.
    for (const s of LINE_SPACINGS.slice(2)) expect(s.value).toBeGreaterThan(1.15);
    expect(spacingStyle({ lineHeight: LINE_SPACINGS[0].value })).toBe("");
  });

  it("offers Word's four, in Word's order", () => {
    /* ⛔ REBASED (NEW-SPACING-1): "Single" is an explicit 1.15 and is the TIGHTEST option, and
       `Default` is the note's own density. It used to be the other way round — "Single" WAS the
       default and the default measured 1.65, so the loosest setting in the list was also the one
       every paragraph started on, and picking it changed nothing. */
    expect(LINE_SPACINGS.map((s) => s.label)).toEqual(["Default", "Single", "1.15", "1.5", "Double"]);
  });

  it("space before/after are coarse on purpose — a points box is a preference panel", () => {
    expect(BLOCK_SPACES.map((s) => s.label)).toEqual(["None", "Small", "Medium", "Large"]);
  });

  it("⛔ THE CONTROL NEVER CLAIMS A SETTING THE PARAGRAPH DOES NOT HAVE", () => {
    expect(spacingLabel(null)).toBe("Spacing");
    expect(spacingLabel(0)).toBe("Spacing");
    expect(spacingLabel(1.5)).toBe("1.5");
    expect(spacingLabel(2)).toBe("Double");
    expect(spacingLabel(1.37)).toBe("1.37");     // a value from elsewhere is shown, not hidden
  });
});

/* ⛔ WHICH SIZE A WHOLE BLOCK SHARES (NEW-SPACING-2) — the decision that makes a smaller
 * paragraph a shorter row. Measured cause: the size lived on an inline span while the BLOCK
 * stayed at the default, and a block's line box can never be shorter than its own font's strut,
 * so 11px words rendered in the 24.75px row a 15px paragraph uses. Bigger text grew the row;
 * smaller text could not shrink it. */
describe("blockFontSize — the size a whole block agrees on", () => {
  it("every run at one size → that size", () => {
    expect(blockFontSize([{ fontSize: "11px" }, { fontSize: "11px" }])).toBe(11);
  });

  it("⛔ two sizes on one line → null, so the TALLEST RUN wins by ordinary inline layout", () => {
    expect(blockFontSize([{ fontSize: "22px" }, { fontSize: "9px" }])).toBe(null);
  });

  it("⛔ any UNSIZED run → null — the rest of the line is still at the default size", () => {
    expect(blockFontSize([{ fontSize: "11px" }, { fontSize: null }])).toBe(null);
    expect(blockFontSize([{ fontSize: null }])).toBe(null);
  });

  it("an empty block keeps the default", () => {
    expect(blockFontSize([])).toBe(null);
    expect(blockFontSize(null)).toBe(null);
  });

  it("a size equal to the default writes nothing — no attribute for a no-op", () => {
    expect(blockFontSize([{ fontSize: "15px" }], { defaultPx: 15 })).toBe(null);
  });

  it("junk is not a size", () => {
    expect(blockFontSize([{ fontSize: "inherit" }])).toBe(null);
    expect(blockFontSize([{ fontSize: "-4px" }])).toBe(null);
  });
});

/* ⛔ ONE ACTION FOR A WHOLE NOTE (NEW-SPACING-3). His goal in his own words is *"save space and
 * see more information on screen"*, and a per-paragraph control makes him do it a line at a time.
 *
 * ⛔ THE DENSITY LIVES ON THE **DOCUMENT**, NOT ON THE TREE, and that is the decision worth
 * keeping: the module's stated principle is that anything riding the document is saved, synced,
 * printed and exported for free. A page-node field would have meant the tree schema,
 * `migratePageNode` and the cloud merge — and B342996 ×3, the same day, was exactly that: a new
 * per-node field `migratePageNode` silently destroyed on every read. */
describe("the note's density", () => {
  it("offers exactly two, and Compact is the tighter one", () => {
    expect(DENSITIES.map((d) => d.id)).toEqual(["comfortable", "compact"]);
    expect(densityFor("compact").line).toBeLessThan(densityFor("comfortable").line);
    expect(densityFor("compact").listGap).toBeLessThanOrEqual(densityFor("comfortable").listGap);
  });

  it("Comfortable IS Single — the two names must not drift apart", () => {
    expect(densityFor("comfortable").line).toBe(SINGLE);
  });

  it("⛔ an unknown id RENDERS rather than throwing — a stored document must always open", () => {
    expect(densityFor("nonsense").id).toBe("comfortable");
    expect(densityFor(undefined).id).toBe("comfortable");
    expect(densityFor(null).id).toBe("comfortable");
  });

  it("the default is a real member of the list, not a string nobody defines", () => {
    expect(DENSITIES.some((d) => d.id === DEFAULT_DENSITY)).toBe(true);
  });

  it("densityStyle hands out both numbers together, so one control moves both", () => {
    expect(densityStyle("compact")).toEqual({ lineHeight: densityFor("compact").line, listGap: 0 });
  });
});
