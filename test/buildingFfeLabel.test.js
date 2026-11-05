// NEW-1 (2026-10-30, owner: "we should show the FFE of the building, also"): a graded plan's building label gains "FFE 790.3" under
// the dimensions; grading off → no line; a bump-out shows nothing of its own; a typed FFE wins over the suggestion and re-renders.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ffeLineText, buildingFfeFt } from "../src/workspaces/site-planner/lib/buildingFfeLabel.js";
import { buildingLabelLines } from "../src/workspaces/site-planner/lib/labelLayout.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const bldg = { id: "b1", type: "building", w: 1566, h: 650 };
const label = (el, ctx) => buildingLabelLines({ name: "Building 1", sqft: "928,850 SF", dims: "1,566′ × 650′", ffe: ffeLineText(buildingFfeFt(el, ctx)) });

describe("the building label's FFE line", () => {
  it("graded: name · sf · dimensions · FFE — the FFE under the dimensions", () => {
    expect(label(bldg, { grOn: true, autoFfe: new Map([["b1", 790.31]]) })).toEqual(["Building 1", "928,850 SF", "1,566′ × 650′", "FFE 790.3"]);
  });
  it("grading off: exactly the label it was (nothing to show)", () => {
    expect(label(bldg, { grOn: false, autoFfe: new Map([["b1", 790.3]]) })).toEqual(["Building 1", "928,850 SF", "1,566′ × 650′"]);
    expect(label({ ...bldg, padElevFt: 800 }, { grOn: false })).toEqual(["Building 1", "928,850 SF", "1,566′ × 650′"]);
    expect(label(bldg, undefined)).toHaveLength(3);
  });
  it("a TYPED finish elevation wins over the suggestion, and changing it changes the line", () => {
    const auto = new Map([["b1", 790.3]]);
    expect(label({ ...bldg, padElevFt: 792 }, { grOn: true, autoFfe: auto }).at(-1)).toBe("FFE 792.0");
    expect(label({ ...bldg, padElevFt: 793.25 }, { grOn: true, autoFfe: auto }).at(-1)).toBe("FFE 793.3");
    expect(label({ ...bldg, padElevFt: 0 }, { grOn: true, autoFfe: auto }).at(-1)).toBe("FFE 0.0"); // 0 is a number, not "absent"
  });
  it("the suggestion updating re-renders the line (a new map value → a new string)", () => {
    expect(label(bldg, { grOn: true, autoFfe: new Map([["b1", 790.3]]) }).at(-1)).toBe("FFE 790.3");
    expect(label(bldg, { grOn: true, autoFfe: new Map([["b1", 788.8]]) }).at(-1)).toBe("FFE 788.8");
  });
  it("no suggestion yet / a non-number: no line, never 'FFE NaN' or 'FFE null'", () => {
    for (const autoFfe of [new Map(), new Map([["b1", NaN]]), new Map([["b1", null]]), null, undefined, {}]) {
      expect(label(bldg, { grOn: true, autoFfe })).toHaveLength(3);
    }
    expect(ffeLineText(undefined)).toBeNull();
    expect(ffeLineText("790.3")).toBeNull();
    expect(ffeLineText(Infinity)).toBeNull();
  });
  it("a bump-out shares its host's FFE and shows nothing of its own; non-buildings show none", () => {
    const auto = new Map([["b1", 790.3], ["ear", 790.3], ["p1", 790.3]]);
    expect(buildingFfeFt({ id: "ear", type: "building", dogEar: { side: "bottom", sign: 1 }, attachedTo: "b1", padElevFt: 791 }, { grOn: true, autoFfe: auto })).toBeNull();
    expect(buildingFfeFt({ id: "p1", type: "parking" }, { grOn: true, autoFfe: auto })).toBeNull();
    expect(buildingFfeFt(null, { grOn: true, autoFfe: auto })).toBeNull();
  });
  it("an irregular (polygon) building carries it too", () => {
    expect(buildingFfeFt({ id: "b2", type: "building", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }, { grOn: true, autoFfe: new Map([["b2", 801.2]]) })).toBe(801.2);
  });
  it("it is the LOWEST-priority line: the label engine drops from the end, so on zoom-out FFE goes before the dimensions", () => {
    const lines = label(bldg, { grOn: true, autoFfe: new Map([["b1", 790.3]]) });
    expect(lines.indexOf("FFE 790.3")).toBe(lines.length - 1);
  });
});

describe("wiring: one label path carries it (and so both PDF modes)", () => {
  const src = read("../src/workspaces/site-planner/SitePlanner.jsx").replace(/\/\*[\s\S]*?\*\//g, "");
  it("SitePlanner reads the FFE from the one helper over the live grading model — never a stored copy", () => {
    expect(src).toMatch(/const ffeText = ffeLineText\(buildingFfeFt\(el, \{ grOn, autoFfe: grModel && grModel\.autoFfe \}\)\)/);
    expect(src).toMatch(/buildingLabelLines\(\{ name, sqft:[^\n]*ffe: ffeText \}\)/);
    expect(src).toMatch(/if \(ffeText\) lines\.push\(ffeText\)/);
  });
  it("the label is ONE <text> whose lines are tspans, and the PDF extractor takes the whole [data-label-for] group with its element", () => {
    expect(src).toMatch(/lines\.map\(\(t, i\) => <tspan key=\{i\}/);
    const ext = read("../src/workspaces/site-planner/lib/annotationExtract.js");
    expect(ext).toMatch(/data-label-for/);
  });
});
