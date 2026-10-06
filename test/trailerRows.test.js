/* Trailer parking rows (owner chat block 2026-10-06, NEW-1/NEW-2/NEW-3).
 *
 *   NEW-1  every row shows its OWN count — a row too shallow for two label lines keeps the count and drops
 *          the name, instead of the reverse (which left the shallow upper row looking unlabelled).
 *   NEW-2  the label has a per-row hide flag that is NOT the `noLabel` bond role tag, and it round-trips
 *          through the model and through the element rows.
 *   NEW-3  stall depth / width / drive lane are per-row (cfg) and accept 50′; a 50′ row holds stalls.
 *
 * Red-proofs (each was run against the pre-change source and went red): the layoutLabels case (the engine
 * ignored `keepLine`), the geometry case (a 50′ row at the 53′ standard counted ZERO), and the round-trip.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fitLines, takeLines, layoutLabels } from "../src/workspaces/site-planner/lib/labelLayout.js";
import { trailerStalls, estTrailers } from "../src/workspaces/site-planner/lib/siteGeometry.js";
import {
  trailerRowLabel, elementLabelHidden, labelHiddenPatch, trailerCfgPatch, drawnTrailerCfg, TRAILER_FIELD_MIN,
} from "../src/workspaces/site-planner/lib/trailerRows.js";
import { createSiteModel } from "../src/workspaces/site-planner/lib/siteModel.js";
import { explodeModel, rowsToModel } from "../src/workspaces/site-planner/lib/elementRows.js";
import { HOST_ROLE_TAGS } from "../src/workspaces/site-planner/lib/bondRemap.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "src/workspaces/site-planner/SitePlanner.jsx"), "utf8");
const STD = { trailerW: 12, trailerL: 53, trailerAisle: 60 };

describe("NEW-1 — the count is the line a shallow row keeps", () => {
  it("trailerRowLabel authors name then count and points keepLine at the count", () => {
    const l = trailerRowLabel({ depthFt: 53, count: 119 });
    expect(l.lines).toEqual(["53′ Trailer Parking", "119 trailers"]);
    expect(l.keepLine).toBe(1);
    expect(trailerRowLabel({ depthFt: 50, count: 7, est: true }).lines[1]).toBe("7 trailers (est)");
  });

  it("fitLines / takeLines drop the NAME before the kept line, and keep authored order", () => {
    const lines = ["53′ Trailer Parking", "119 trailers"];
    expect(fitLines(lines, 10, 12, 1)).toEqual(["119 trailers"]);   // one line of room → the count
    expect(fitLines(lines, 10, 12)).toEqual(["53′ Trailer Parking"]); // no keepLine → the old behaviour
    expect(fitLines(lines, 10, 30, 1)).toEqual(lines);               // room for both → both, in order
    expect(takeLines(["a", "b", "c", "d"], 2, 2)).toEqual(["a", "c"]);
    expect(takeLines(["a", "b"], 1, 9)).toEqual(["a"]);               // a keepLine out of range is ignored
  });

  it("layoutLabels: a strip too thin for two lines still shows the count", () => {
    const row = (id, halfH, importance) => ({
      id, cx: 0, cy: id === "top" ? -200 : 0, lines: ["53′ Trailer Parking", "28 trailers"], lh: 7, charW: 4,
      halfW: 400, halfH, importance, noLeader: true, keepLine: 1,
    });
    const show = layoutLabels([row("top", 5, 10), row("bottom", 40, 20)], { pad: 0 });
    expect(show.get("bottom").lines).toEqual(["53′ Trailer Parking", "28 trailers"]);
    expect(show.get("top").lines).toEqual(["28 trailers"]); // main: ["53′ Trailer Parking"] — the count was the line lost
  });

  it("layoutLabels: without keepLine the engine behaves exactly as before (no other label changes)", () => {
    const show = layoutLabels([{ id: "a", cx: 0, cy: 0, lines: ["N", "sf", "dims"], lh: 10, charW: 6, halfW: 100, halfH: 10, importance: 1 }]);
    expect(show.get("a").lines).toEqual(["N", "sf"]);
  });

  it("two stacked rows both get a label when nothing else is near", () => {
    const rows = [["upper", -90, 12], ["lower", 0, 70]].map(([id, cy, halfH], i) => ({
      id, cx: 0, cy, lines: ["53′ Trailer Parking", "12 trailers"], lh: 7, charW: 4, halfW: 300, halfH, importance: i, noLeader: true, keepLine: 1,
    }));
    const show = layoutLabels(rows, { pad: 2 });
    for (const id of ["upper", "lower"]) expect(show.get(id)?.lines.join(" ")).toMatch(/trailers/);
  });

  it("the canvas label pass is wired to it", () => {
    expect(SRC).toMatch(/trailerRowLabel\(\{ depthFt: tc\.trailerL/);
    expect(SRC).toMatch(/noLeader, keepLine, carto/);
    expect(SRC).toMatch(/noLeader: d\.noLeader, keepLine: d\.keepLine/);
  });
});

describe("NEW-2 — per-row label hide, which is not the bond role tag", () => {
  it("elementLabelHidden reads either flag; labelHiddenPatch flips only the user's own", () => {
    expect(elementLabelHidden({})).toBe(false);
    expect(elementLabelHidden({ labelHidden: true })).toBe(true);
    expect(elementLabelHidden({ noLabel: true })).toBe(true);
    expect(labelHiddenPatch({})).toEqual({ labelHidden: true });
    expect(labelHiddenPatch({ labelHidden: true })).toEqual({ labelHidden: null });
    // a structural noLabel does not make the user's toggle read as "hidden"
    expect(labelHiddenPatch({ noLabel: true })).toEqual({ labelHidden: true });
  });

  it("labelHidden is deliberately NOT a bond role tag (those are stripped when a host is lost)", () => {
    expect(HOST_ROLE_TAGS).toContain("noLabel");
    expect(HOST_ROLE_TAGS).not.toContain("labelHidden");
  });

  it("round-trips through the site model and the element rows, per row", () => {
    const els = [
      { id: "t1", type: "trailer", cx: 0, cy: 0, w: 300, h: 50, rot: 0, labelHidden: true, cfg: { trailerL: 50 } },
      { id: "t2", type: "trailer", cx: 0, cy: 80, w: 300, h: 50, rot: 0 },
    ];
    const model = createSiteModel({ els });
    const byId = (m) => Object.fromEntries(m.els.map((e) => [e.id, e]));
    expect(byId(model).t1.labelHidden).toBe(true);
    expect(byId(model).t1.cfg).toEqual({ trailerL: 50 });
    expect(byId(model).t2.labelHidden).toBeUndefined();
    const { header, rows } = (() => { const x = explodeModel(model); return { header: x.header, rows: x.rows }; })();
    const back = rowsToModel(header, rows.map((r, i) => ({ ...r, rev: 1, updated_at: new Date().toISOString(), deleted_at: null, ord: i })));
    expect(byId(back).t1.labelHidden).toBe(true);
    expect(byId(back).t2.labelHidden).toBeUndefined();
  });

  it("the menu row, the Properties switch and the label pass all go through the one helper", () => {
    expect(SRC).toMatch(/elementLabelHidden\(el\)\) continue;/);
    expect(SRC).toMatch(/t\.type === "trailer" && miRow\(\{ icon: <LabelIcon \/>, text: t\.labelHidden \? "Show label" : "Hide label"/);
    expect(SRC).toMatch(/data-testid="trailer-label-toggle"/);
  });
});

describe("NEW-3 — stall depth is editable and a 50′ row holds stalls", () => {
  it("a 50′-deep row at the 53′ standard holds NOTHING (the reported defect), at a 50′ stall depth it holds a stall per width", () => {
    expect(trailerStalls(600, 50, STD).count).toBe(0);                       // main behaviour: why 50′ "would not draw"
    expect(trailerStalls(600, 50, { ...STD, trailerL: 50 }).count).toBe(50); // 600 / 12
    expect(trailerStalls(600, 50, { ...STD, trailerL: 50 }).bands).toHaveLength(1);
  });

  it("depth, width and lane feed the count; 45′ / 50′ / 53′ / 60′ all draw", () => {
    for (const d of [45, 50, 53, 60]) expect(trailerStalls(600, d, { ...STD, trailerL: d }).count).toBe(50);
    expect(trailerStalls(600, 106 + 60, { ...STD, trailerL: 53 }).count).toBe(100); // double-loaded still works
    expect(estTrailers(60000, { ...STD, trailerL: 50 })).toBeGreaterThan(estTrailers(60000, STD));
  });

  it("trailerCfgPatch accepts 50 and refuses only values far below any real stall", () => {
    expect(trailerCfgPatch(undefined, "trailerL", 50)).toEqual({ trailerL: 50 });
    expect(trailerCfgPatch({ trailerW: 10 }, "trailerL", "45")).toEqual({ trailerW: 10, trailerL: 45 });
    expect(trailerCfgPatch({}, "trailerL", TRAILER_FIELD_MIN.trailerL)).not.toBeNull();
    expect(trailerCfgPatch({}, "trailerL", 1)).toBeNull();
    expect(trailerCfgPatch({}, "trailerL", 0)).toBeNull();
    expect(trailerCfgPatch({}, "trailerL", "abc")).toBeNull();
    expect(trailerCfgPatch({}, "trailerAisle", 0)).toEqual({ trailerAisle: 0 });
    expect(trailerCfgPatch({}, "bogus", 5)).toBeNull();
    expect(TRAILER_FIELD_MIN.trailerL).toBeLessThan(40); // never anywhere near a real stall
  });

  it("no 53′ floor survives anywhere in the code that draws or sizes a trailer row", () => {
    const geo = readFileSync(join(ROOT, "src/workspaces/site-planner/lib/siteGeometry.js"), "utf8");
    const rows = readFileSync(join(ROOT, "src/workspaces/site-planner/lib/trailerRows.js"), "utf8");
    expect(geo.match(/Math\.max\([^)]*53|>=\s*53|<\s*53/g) || []).toEqual([]);
    expect(rows.match(/Math\.max\([^)]*53|>=\s*53|<\s*53/g) || []).toEqual([]);
  });

  it("drawnTrailerCfg: a row drawn shallower than the standard adopts the drawn depth; others stay on Standards", () => {
    expect(drawnTrailerCfg({ depthFt: 50, standardDepthFt: 53 })).toEqual({ trailerL: 50 });
    expect(drawnTrailerCfg({ depthFt: 50.126, standardDepthFt: 53 })).toEqual({ trailerL: 50.13 });
    expect(drawnTrailerCfg({ depthFt: 53, standardDepthFt: 53 })).toBeNull();
    expect(drawnTrailerCfg({ depthFt: 140, standardDepthFt: 53 })).toBeNull();
    expect(drawnTrailerCfg({ depthFt: 3, standardDepthFt: 53 })).toBeNull(); // a sliver is not a stall depth
    expect(drawnTrailerCfg({ depthFt: NaN, standardDepthFt: 53 })).toBeNull();
  });

  it("the Standards defaults still accept any value from 1 up (unchanged)", () => {
    expect(SRC).toMatch(/Trailer W \/ L"><span[^\n]*min=\{1\}[^\n]*trailerL/);
  });

  it("the draw tool stamps the cfg and the Properties fields write through setTrailerSpec", () => {
    expect(SRC).toMatch(/drawnTrailerCfg\(\{ depthFt: h, standardDepthFt: settings\.trailerL \}\)/);
    expect(SRC).toMatch(/specField\("trailerL", "Stall depth \(ft\)"\)/);
    expect(SRC).toMatch(/setTrailerSpec\(selEl\.id, key, n\)/);
  });
});
