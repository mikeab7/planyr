/* HOW FAR APART THE LINES ARE (NEW-7) — the pure half.
 *
 * ⛔ SPACING IS A BLOCK PROPERTY, NOT A TEXT STYLE. Half a line cannot be one-and-a-half
 * spaced; putting it on a text style would let the document express a state no layout can
 * honour. And ONE attribute writes the whole style string, because three that each wrote
 * `style` would overwrite one another — the last rendered would win and the other two would
 * silently vanish, which is the sort of bug that only appears on the third setting.
 */
import { describe, expect, it } from "vitest";

import { DENSITIES, DEFAULT_DENSITY, SINGLE, COMFORTABLE_LINE, densityFor, densityStyle, blockFontSize,
  BLOCK_SPACES, LINE_SPACINGS, spacingFromElement, spacingLabel, spacingStyle,
  SPACING_LINE_OPTIONS, SPACE_BEFORE_DEFAULT, SPACE_AFTER_DEFAULT, SPACING_PRESETS, spacingGlyphFor,
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

  it("⛔ B1203504 — Comfortable is a genuine PROSE ratio, not Word's Single any more", () => {
    /* Superseded, deliberately: the earlier version of this test pinned "Comfortable IS
     * Single" because that was the ship. The owner reported the field read like a spreadsheet
     * — measured, every note opened at 1.15 by default, the exact ratio Word calls single —
     * and asked for a lot better, naming Craft/Bear/Notion (1.5–1.7) as the bar. Comfortable now
     * sits in that band; Single keeps its own name and its own number, both unchanged. */
    expect(densityFor("comfortable").line).toBe(COMFORTABLE_LINE);
    expect(densityFor("comfortable").line).toBeGreaterThanOrEqual(1.5);
    expect(densityFor("comfortable").line).toBeLessThanOrEqual(1.7);
  });

  it("⛔ Compact IS Single now — the tight option didn't vanish, it moved under its honest name", () => {
    expect(densityFor("compact").line).toBe(SINGLE);
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
    expect(densityStyle("compact")).toEqual({ lineHeight: densityFor("compact").line, listGap: 2 });
  });
});

/* ⛔ THE NEW SPACING POPOVER'S OWN LADDER (NEW-4, toolbar redesign, 2026-09-24) — a SEPARATE,
 * simpler set of numbers from `LINE_SPACINGS` above, on purpose: the old control's "Single" means
 * 1.15 (the redesign's own history), so reusing that name for a genuine 1.0 would silently change
 * what "Single" has always meant. The two ladders coexist; this one backs only the new popover. */
describe("SPACING_LINE_OPTIONS — the new popover's 4-segment control", () => {
  it("is Word's four, in Word's order, with real numeric values", () => {
    expect(SPACING_LINE_OPTIONS.map((o) => o.name)).toEqual(["Single", "Default", "1.5", "Double"]);
    expect(SPACING_LINE_OPTIONS.map((o) => o.value)).toEqual([1, 1.15, 1.5, 2]);
  });

  it("every option carries a stable id distinct from its display name", () => {
    const ids = SPACING_LINE_OPTIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("⛔ genuinely means 1.0 for Single — NOT the old ladder's 1.15", () => {
    const single = SPACING_LINE_OPTIONS.find((o) => o.name === "Single");
    expect(single.value).toBe(1);
    expect(single.value).not.toBe(SINGLE);
  });
});

describe("SPACE_BEFORE_DEFAULT / SPACE_AFTER_DEFAULT — the steppers' starting point", () => {
  it("matches the Standard preset, so leaving the steppers alone equals picking Standard", () => {
    const standard = SPACING_PRESETS.find((p) => p.id === "standard");
    expect(SPACE_AFTER_DEFAULT).toBe(standard.spaceAfter);
  });

  it("space-before defaults to none", () => {
    expect(SPACE_BEFORE_DEFAULT).toBe(0);
  });

  it("space-after defaults to 8", () => {
    expect(SPACE_AFTER_DEFAULT).toBe(8);
  });
});

describe("SPACING_PRESETS — the three named shortcuts", () => {
  it("offers exactly Compact / Standard / Relaxed, each looser than the last", () => {
    expect(SPACING_PRESETS.map((p) => p.label)).toEqual(["Compact", "Standard", "Relaxed"]);
    for (let i = 1; i < SPACING_PRESETS.length; i++) {
      expect(SPACING_PRESETS[i].lineHeight).toBeGreaterThan(SPACING_PRESETS[i - 1].lineHeight);
    }
  });

  it("never touches space-before — a preset is about density, not indentation from above", () => {
    for (const p of SPACING_PRESETS) expect(p).not.toHaveProperty("spaceBefore");
  });

  it("each preset's numbers round-trip through spacingStyle cleanly", () => {
    // Compact's spaceAfter is 0 — spacingStyle correctly omits a zero margin (its own rule:
    // "refuses a value that is not a positive number"), so only the non-zero presets emit both.
    expect(spacingStyle({ lineHeight: 1, spaceAfter: 0 })).toBe("line-height:1");
    for (const p of SPACING_PRESETS.filter((p) => p.spaceAfter > 0)) {
      expect(spacingStyle({ lineHeight: p.lineHeight, spaceAfter: p.spaceAfter }))
        .toBe(`line-height:${p.lineHeight};margin-bottom:${p.spaceAfter}px`);
    }
  });
});

describe("spacingGlyphFor — what the closed trigger shows", () => {
  it("shows the bare number for a real line height", () => {
    expect(spacingGlyphFor(1.5)).toBe("1.5");
    expect(spacingGlyphFor(2)).toBe("2");
  });

  it("accepts a numeric string, same as a value read off the DOM", () => {
    expect(spacingGlyphFor("1.5")).toBe("1.5");
  });

  it("says 'Spacing' when there is nothing to report", () => {
    expect(spacingGlyphFor(null)).toBe("Spacing");
    expect(spacingGlyphFor(undefined)).toBe("Spacing");
    expect(spacingGlyphFor(0)).toBe("Spacing");
    expect(spacingGlyphFor(-1)).toBe("Spacing");
    expect(spacingGlyphFor("wide")).toBe("Spacing");
  });
});
