/* notesFakeBullets — the 2026-10-30 follow-up (NEW-1): "Enter after a pasted bullet doesn't continue the list". A note pasted
 * before the Office-list fix stores a Word outline as PARAGRAPHS whose text starts with the glyph + a wide gap; this turns them
 * into real nested lists on read. Pure JSON, so node-only. The shapes below are what the OLD paste measurably stored (probe on
 * unmodified main: text nodes ["o", "       ", "Design and engineering"]). Each describe names what it pins. */
import { describe, it, expect } from "vitest";
import { normalizeFakeBullets, readMarker } from "../src/workspaces/notes/lib/notesFakeBullets.js";

const GAP = " ".repeat(7);
const t = (text, marks) => (marks ? { type: "text", text, marks } : { type: "text", text });
const p = (...c) => ({ type: "paragraph", attrs: { fontSize: null }, content: c.filter(Boolean) });
/* the way the OLD paste stored one bullet: marker, gap, then the words */
const fake = (glyph, words, extra = []) => p(t(glyph, [{ type: "textStyle", attrs: { fontFamily: "Courier New" } }]), t(GAP), t(words), ...extra);
const box = (...c) => ({ type: "noteAnchor", attrs: { x: 40, y: 40, w: 460, h: null, aid: "b1" }, content: c });
const doc = (...c) => ({ type: "doc", content: c });
const textOf = (n) => (n.text ? n.text : (n.content || []).map(textOf).join(""));
const shape = (n) => {
  if (n.type === "bulletList" || n.type === "orderedList") return `${n.type === "orderedList" ? "ol" : "ul"}${n.attrs?.start ? n.attrs.start : ""}[${n.content.map(shape).join(" ")}]`;
  if (n.type === "listItem") return `(${n.content.map((c) => (c.type === "paragraph" ? JSON.stringify(textOf(c)) : shape(c))).join(" ")})`;
  if (n.type === "paragraph") return JSON.stringify(textOf(n));
  return `${n.type}{${(n.content || []).map(shape).join(" ")}}`;
};

describe("which paragraphs are bullet-shaped (and which typed text is left alone)", () => {
  it("reads Word's glyphs followed by a wide gap", () => {
    for (const g of ["·", "•", "", "o", "○", "§", "▪", "", "□", ""]) {
      expect(readMarker(`${g}${GAP}Words`), g).not.toBe(null);
    }
  });
  it("a typed '• item' (one space) or '- item' or '* item' is NOT a pasted bullet", () => {
    expect(readMarker("• item")).toBe(null);
    expect(readMarker("- item")).toBe(null);
    expect(readMarker("* item")).toBe(null);
    expect(readMarker("– item")).toBe(null);
    expect(readMarker("-    wide gap but a dash is never in the set")).toBe(null);
  });
  it("a bare 'o' needs a really wide gap — it is also a word", () => {
    expect(readMarker("o  then more words")).toBe(null);
    expect(readMarker(`o${GAP}Sub item`)).not.toBe(null);
  });
  it("numbered markers need the wide gap too: '1.   Item' yes, '1. Item' no", () => {
    expect(readMarker("1.   Item")).toMatchObject({ kind: "ordered", start: 1 });
    expect(readMarker("1. Item")).toBe(null);
    expect(readMarker("a.    Item")).toMatchObject({ kind: "ordered" });
  });
});

describe("a run of bullet-shaped paragraphs becomes a real nested list, losslessly", () => {
  const input = doc(box(
    fake("·", "LEED"), fake("o", "1M SF - $90K"), fake("§", "Third level"), fake("□", "Fourth level"),
    fake("o", "Back to two"), fake("·", "Back to one"),
  ), p());
  const out = normalizeFakeBullets(input);
  it("nests by the glyph's level", () => {
    expect(shape(out.content[0])).toBe('noteAnchor{ul[("LEED" ul[("1M SF - $90K" ul[("Third level" ul[("Fourth level")])]) ("Back to two")]) ("Back to one")]}');
  });
  it("drops only the glyph and its gap: the words and their marks are exactly what was there", () => {
    const first = out.content[0].content[0].content[0].content[0];
    expect(first.content).toEqual([{ type: "text", text: "LEED" }]);
  });
  it("leaves the trailing structural paragraph and everything outside the run alone", () => {
    expect(out.content[1]).toBe(input.content[1]);
  });
  it("keeps a paragraph's own attributes (font size and the rest)", () => {
    const para = (n) => n.content[0];
    expect(para(out.content[0].content[0].content[0].content[0]) ).toBeDefined();
    expect(out.content[0].content[0].content[0].content[0].attrs).toEqual({ fontSize: null });
  });
  it("is idempotent: converting the result again changes nothing (same object)", () => {
    expect(normalizeFakeBullets(out)).toBe(out);
  });
});

describe("blank lines inside the outline do not break the nesting", () => {
  it("an empty paragraph between two items rides inside the item above", () => {
    const out = normalizeFakeBullets(doc(box(fake("·", "One"), fake("o", "Two"), p(), fake("o", "Three"), fake("·", "Four"))));
    expect(shape(out.content[0])).toBe('noteAnchor{ul[("One" ul[("Two" "") ("Three")]) ("Four")]}');
  });
  it("a blank line after the LAST item stays outside the list", () => {
    const out = normalizeFakeBullets(doc(box(fake("·", "One"), p(), p(t("Closing text")))));
    expect(out.content[0].content.map((n) => n.type)).toEqual(["bulletList", "paragraph", "paragraph"]);
  });
});

describe("text the person typed is never touched", () => {
  it("a doc with typed bullets, dashes and plain text is returned as the SAME object", () => {
    const d = doc(box(p(t("• typed bullet")), p(t("- a dash")), p(t("o  two spaces only")), p(t("Plain text"))), p());
    expect(normalizeFakeBullets(d)).toBe(d);
  });
  it("a typed bullet NEXT TO a pasted one stays a paragraph", () => {
    const out = normalizeFakeBullets(doc(box(p(t("• typed")), fake("·", "Pasted"))));
    expect(out.content[0].content.map((n) => n.type)).toEqual(["paragraph", "bulletList"]);
    expect(textOf(out.content[0].content[0])).toBe("• typed");
  });
  it("tables, headings and code are never read", () => {
    const cell = { type: "tableCell", attrs: {}, content: [fake("·", "In a cell")] };
    const d = doc(box({ type: "table", content: [{ type: "tableRow", content: [cell] }] }, { type: "heading", attrs: { level: 2 }, content: [t("·"), t(GAP), t("heading")] }));
    expect(normalizeFakeBullets(d)).toBe(d);
  });
});

describe("numbered outlines", () => {
  const num = (m, words) => p(t(m), t(" ".repeat(6)), t(words));
  it("1. / a. / i. nest as numbered lists, and a start other than 1 is kept", () => {
    const out = normalizeFakeBullets(doc(box(num("1.", "Entitlements"), num("a.", "Zoning"), num("i.", "District"), num("ii.", "Overlay"), num("b.", "Platting"), num("2.", "Construction"))));
    expect(shape(out.content[0])).toBe('noteAnchor{ol[("Entitlements" ol[("Zoning" ol[("District") ("Overlay")]) ("Platting")]) ("Construction")]}');
    const four = normalizeFakeBullets(doc(box(num("4.", "Fourth"), num("5.", "Fifth"))));
    expect(four.content[0].content[0].attrs).toEqual({ start: 4 });
  });
  it("'i.' after 'h.' is the letter i, not a roman numeral", () => {
    const out = normalizeFakeBullets(doc(box(num("1.", "A"), num("g.", "G"), num("h.", "H"), num("i.", "I"))));
    // all letters stay on the same level (level 2): one nested list of three
    expect(shape(out.content[0])).toBe('noteAnchor{ol[("A" ol[("G") ("H") ("I")])]}');
  });
  it("bullets then numbers in one run are two lists", () => {
    const out = normalizeFakeBullets(doc(box(fake("·", "Bullet"), num("1.", "Number"))));
    expect(out.content[0].content.map((n) => n.type)).toEqual(["bulletList", "orderedList"]);
  });
});

describe("a level cannot be skipped", () => {
  it("a lone level-3 glyph opens at level 1; a jump from 1 to 3 nests once", () => {
    expect(shape(normalizeFakeBullets(doc(box(fake("§", "Alone")))).content[0])).toBe('noteAnchor{ul[("Alone")]}');
    expect(shape(normalizeFakeBullets(doc(box(fake("·", "One"), fake("§", "Three")))).content[0])).toBe('noteAnchor{ul[("One" ul[("Three")])]}');
  });
});

describe("inside an existing list item", () => {
  it("bullet-shaped paragraphs that follow the item's own line become its nested list", () => {
    const li = { type: "listItem", content: [p(t("LEED")), fake("o", "Child one"), fake("o", "Child two")] };
    const out = normalizeFakeBullets(doc(box({ type: "bulletList", content: [li] })));
    expect(shape(out.content[0])).toBe('noteAnchor{ul[("LEED" ul[("Child one") ("Child two")])]}');
  });
});
