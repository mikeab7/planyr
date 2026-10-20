/* NEW-1 (layout "A", owner-approved 2026-10-20) — the Properties panel for markups / text boxes / callouts, and the three
 * additive callout fields it brings: `strike`, `caps`, `valign` (+ the fixed height `boxH` that gives vertical alignment
 * something to align within).
 *
 * BACK-COMPAT IS THE ACCEPTANCE TEST: a callout saved before any of these existed has none of the keys, and must resolve and
 * lay out exactly as it always did. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  calloutStyle, calloutDisplayText, calloutTextDecoration, calloutVAlignOffset, CALLOUT_VALIGNS, CALLOUT_VALIGN_DEFAULT,
} from "../src/workspaces/site-planner/lib/calloutStyle.js";
import { calloutLayout } from "../src/workspaces/site-planner/lib/calloutLayout.js";
import { buildAnnotations } from "../src/workspaces/site-planner/lib/pdfAnnotations.js";
import { T, g, M0, frame } from "./fixtures/pdfAnnotationsFixture.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const SP = read("../src/workspaces/site-planner/SitePlanner.jsx");

describe("calloutStyle — the new keys default so an old callout is unchanged", () => {
  it("a callout with none of the new keys resolves strike/caps off and valign top", () => {
    const st = calloutStyle({ text: "old", size: 13 });
    expect(st.strike).toBe(false);
    expect(st.caps).toBe(false);
    expect(st.valign).toBe("top");
    expect(CALLOUT_VALIGN_DEFAULT).toBe("top");
  });
  it("an unknown valign falls back to the default, never to undefined", () => {
    expect(calloutStyle({ valign: "sideways" }).valign).toBe("top");
    for (const v of CALLOUT_VALIGNS) expect(calloutStyle({ valign: v }).valign).toBe(v);
  });
  it("strike and caps read back what was stored", () => {
    expect(calloutStyle({ strike: true, caps: true })).toMatchObject({ strike: true, caps: true });
  });
});

describe("all caps is a DISPLAY transform — the stored text is never rewritten", () => {
  it("shows uppercase only while caps is on, and leaves the input string alone", () => {
    const c = { text: "Move the Pond", caps: true };
    expect(calloutDisplayText(c.text, calloutStyle(c))).toBe("MOVE THE POND");
    expect(c.text).toBe("Move the Pond");
    expect(calloutDisplayText(c.text, calloutStyle({ ...c, caps: false }))).toBe("Move the Pond");
  });
  it("calloutLayout draws the uppercase lines but never touches c.text", () => {
    const c = { text: "line one\nLine Two", caps: true };
    const lay = calloutLayout(c, calloutStyle(c), 0.35);
    expect(lay.lines).toEqual(["LINE ONE", "LINE TWO"]);
    expect(c.text).toBe("line one\nLine Two");
    const plain = calloutLayout({ text: c.text }, calloutStyle({}), 0.35);
    expect(plain.lines).toEqual(["line one", "Line Two"]);
  });
});

describe("strikethrough composes with underline", () => {
  it("returns the combined decoration, one, or none", () => {
    expect(calloutTextDecoration(calloutStyle({}))).toBeUndefined();
    expect(calloutTextDecoration(calloutStyle({ underline: true }))).toBe("underline");
    expect(calloutTextDecoration(calloutStyle({ strike: true }))).toBe("line-through");
    expect(calloutTextDecoration(calloutStyle({ underline: true, strike: true }))).toBe("underline line-through");
  });
});

describe("vertical alignment math", () => {
  it("top → 0, middle → half the slack, bottom → all of it", () => {
    expect(calloutVAlignOffset("top", 100, 40)).toBe(0);
    expect(calloutVAlignOffset("middle", 100, 40)).toBe(30);
    expect(calloutVAlignOffset("bottom", 100, 40)).toBe(60);
  });
  it("never negative and never NaN when the box is not taller than its text", () => {
    expect(calloutVAlignOffset("bottom", 40, 40)).toBe(0);
    expect(calloutVAlignOffset("middle", 30, 40)).toBe(0);
    expect(calloutVAlignOffset("bottom", undefined, 40)).toBe(0);
  });
});

describe("calloutLayout with a fixed height (boxH)", () => {
  const base = { text: "one\ntwo" };
  it("no boxH ⇒ h equals the text's natural height and nothing is offset (every existing box)", () => {
    for (const valign of CALLOUT_VALIGNS) {
      const lay = calloutLayout(base, calloutStyle({ valign }), 0.35);
      expect(lay.h).toBe(lay.naturalH);
      expect(lay.textOffsetY).toBe(0);
      expect(lay.naturalH).toBe(lay.lines.length * lay.lineH + lay.padY * 2);
    }
  });
  it("a taller boxH grows the box (feet × ppf) and the offset follows valign", () => {
    const ppf = 0.35, nat = calloutLayout(base, calloutStyle({}), ppf).naturalH;
    const boxH = (nat / ppf) + 40;              // 40 ft of slack
    const top = calloutLayout({ ...base, boxH }, calloutStyle({ valign: "top" }), ppf);
    const mid = calloutLayout({ ...base, boxH }, calloutStyle({ valign: "middle" }), ppf);
    const bot = calloutLayout({ ...base, boxH }, calloutStyle({ valign: "bottom" }), ppf);
    expect(top.h).toBeCloseTo(boxH * ppf, 6);
    expect(top.textOffsetY).toBe(0);
    expect(mid.textOffsetY).toBeCloseTo(20 * ppf, 6);
    expect(bot.textOffsetY).toBeCloseTo(40 * ppf, 6);
  });
  it("a boxH shorter than the text never clips it — the box floors at the natural height", () => {
    const lay = calloutLayout({ ...base, boxH: 1 }, calloutStyle({ valign: "bottom" }), 0.35);
    expect(lay.h).toBe(lay.naturalH);
    expect(lay.textOffsetY).toBe(0);
  });
  it("boxH is zoom-invariant like boxW: h/ppf is constant across zoom once the box is taller than its text", () => {
    const c = { ...base, boxH: 400 };
    const a = calloutLayout(c, calloutStyle({}), 0.35), b = calloutLayout(c, calloutStyle({}), 0.7);
    expect(a.h / 0.35).toBeCloseTo(b.h / 0.7, 6);
  });
});

describe("the PDF: strikethrough is drawn in the appearance, and the FreeText limits are said out loud", () => {
  const box = (id, meta, txtAttrs = {}) => ({
    family: "callout", id, kind: "textbox", meta: { lines: ["gone"], align: "left", rot: 0, ...meta },
    tree: g({ "data-testid": `callout-${id}`, "data-feature": `callout:${id}`, "data-callout-leaders": 0 },
      g({}, T("rect", { "data-testid": `callout-box-${id}`, x: 700, y: 620, width: 120, height: 40, rx: 4, fill: "none", stroke: "#334155", "stroke-width": 1 }),
        T("text", { x: 714, y: 640, "text-anchor": "start", "dominant-baseline": "middle", "font-size": 12, fill: "#1e293b", "font-weight": 500, ...txtAttrs }, [], { str: "gone", tw: 30 }))),
  });
  const run = (d) => buildAnnotations([d], { M0, frame });
  it("a struck text box gets one extra rule in its appearance stream and a degraded note", () => {
    const plain = run(box("S0", {}));
    const struck = run(box("S1", { strike: true }, { "text-decoration": "line-through" }));
    const strokes = (r) => (r.annots[0].ap.stream.match(/^[^\n]* l S$/gm) || []).length;
    expect(strokes(struck)).toBe(strokes(plain) + 1);
    expect(struck.degraded.join(" ")).toMatch(/S1.*strikethrough/);
    expect(plain.degraded.join(" ")).not.toMatch(/strikethrough/);
  });
  it("a fixed-height box with non-top alignment says vertical alignment is appearance-only; top does not", () => {
    expect(run(box("V1", { valignFixed: true })).degraded.join(" ")).toMatch(/V1.*vertical alignment/);
    expect(run(box("V2", { valignFixed: false })).degraded.join(" ")).not.toMatch(/vertical alignment/);
  });
});

describe("the planner wiring (source guards)", () => {
  it("the new top / bottom grips forward a right-click to the box menu (CHROME-NEVER-EATS-A-PRESS) and start the height drag", () => {
    const i = SP.indexOf('data-handle="callout-height"');
    expect(i).toBeGreaterThan(-1);
    const el = SP.slice(SP.lastIndexOf("<", i), SP.indexOf("/>", i) + 2);
    expect(el).toMatch(/onContextMenu=\{.*onCalloutContext\(e, c\.id, -1\)/);
    expect(el).toMatch(/startCalloutResizeH\(e, c\.id, dir\)/);
  });
  it("both grip starters forward a double-click on the border to the box's own double-tap pairing (CHROME-NEVER-EATS-A-PRESS)", () => {
    for (const name of ["startCalloutResize", "startCalloutResizeH"]) {
      const i = SP.indexOf(`const ${name} = (e, id,`);
      expect(i, name).toBeGreaterThan(-1);
      const body = SP.slice(i, SP.indexOf("\n  };", i));
      expect(body, name).toMatch(/isDoubleTap\(e, id, true\)\) \{ calloutDblAction\(e, id\); return; \}/);
    }
  });
  it("Fit to text and Alt+Z clear the fixed height as well as the fixed width", () => {
    expect(SP).toMatch(/setCallout\(s\.id, \{ boxW: null, boxH: null \}\)/);
    expect(SP).toMatch(/setCallout\(editCallout\.id, \{ boxW: null, boxH: null \}\)/);
    expect(SP).toMatch(/setSelCallout\(\{ boxW: null, boxH: null \}\)/);
  });
  it("the callout panel's sections run Text → Appearance → Size & position, Edit text first, and no weight carries a unit", () => {
    const start = SP.indexOf('data-testid="callout-edit-text"');
    const t = SP.indexOf('section="text"', start), ap = SP.indexOf('section="appearance"', start), sz = SP.indexOf('section="size"', start);
    expect(start).toBeGreaterThan(-1);
    expect(t).toBeGreaterThan(start); expect(ap).toBeGreaterThan(t); expect(sz).toBeGreaterThan(ap);
    expect(SP).not.toMatch(/ariaLabel="Line weight"[^>]*unit="pt"|unit="pt"[^>]*ariaLabel="Line weight"/);
  });
  it("the neutral markup panel has an Appearance and a Size & position section and no opacity slider", () => {
    const start = SP.indexOf("NEUTRAL_MARKUP_KINDS.includes(selMarkup.kind) && (() => {");
    const end = SP.indexOf("selected markup shape — geometry + style", start);
    const body = SP.slice(start, end);
    expect(body).toMatch(/section="appearance"/);
    expect(body).toMatch(/section="size"/);
    expect(body).not.toMatch(/type="range"/);
    expect(body).not.toMatch(/\bunit="pt"/);
  });
  it("the line / polyline render honours strokeOpacity", () => {
    expect(SP).toMatch(/strokeDasharray=\{da\} fill="none" \{\.\.\.visibleStroke\} pointerEvents="none" \/>/);
    expect(SP).toMatch(/<polyline points=\{s\} fill="none" stroke=\{nStroke\} strokeWidth=\{vsw\} strokeDasharray=\{da\} \{\.\.\.visibleStroke\}/);
  });
});
