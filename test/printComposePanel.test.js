/* NEW-1 (2026-10-30) — the Print / Compose "Exhibit settings" panel redesign (owner-approved mockup).
 * No jsdom here: the panel is rendered to static markup for the label/structure checks, and the paper
 * pick rules (the part that needs "clicking") live in pure `paperPick` / `paperChoice`, driven here the
 * same way the component drives them. */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import PrintCompose from "../src/workspaces/site-planner/components/PrintCompose.jsx";
import { PAPER_SIZES, PRIMARY_PAPERS, OTHER_PAPERS, paperChoice, paperPick, pageSize } from "../src/workspaces/site-planner/lib/printSheet.js";

const noop = () => {};
const props = (o = {}) => ({
  paper: "letter", onPaper: noop, orient: "landscape", onOrient: noop, fitToFramePage: false, onToggleFitToFramePage: noop,
  scaleFtPerIn: null, onScale: noop, fitWarning: null, previewSrc: null, previewLoading: false, pageAspect: 11 / 8.5,
  siteLabel: "Goose Creek", planLabel: "Concept A", dateStr: "Oct 30, 2026", preparedBy: "", onPreparedBy: noop,
  showDims: true, onToggleDims: noop, showAreas: true, onToggleAreas: noop,
  aerialAvailable: true, showAerial: true, onToggleAerial: noop, overlayPrintable: true, printOverlay: true, onTogglePrintOverlay: noop,
  mapLayersPrintable: true, printMapLayers: true, onToggleMapLayers: noop, showMetricsBand: true, onToggleMetricsBand: noop,
  buildingsTablePrintable: true, showBuildingsTable: true, onToggleBuildingsTable: noop, flattenMarkups: false, onToggleFlattenMarkups: noop,
  onReposition: noop, onCancel: noop, onDownload: noop, downloading: false, ...o,
});
const render = (o) => renderToStaticMarkup(createElement(PrintCompose, props(o)));
// the paper buttons are the ToggleChips (the orientation segmented control also uses aria-pressed)
const pressedPaper = (h) => (h.match(/<button[^>]*aria-pressed="true"[^>]*><span[^>]*>\d/g) || []).length;
const text = (html) => html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");

describe("(a) paper controls", () => {
  it("exactly three primary buttons, size first / name second, plus a dropdown with the four other entries", () => {
    const h = render();
    expect(PRIMARY_PAPERS.map((p) => [p.size, p.name])).toEqual([["8.5 × 11", "Letter"], ["11 × 17", "Half-size"], ["24 × 36", "Full-size"]]);
    for (const p of PRIMARY_PAPERS) expect(text(h)).toContain(`|${p.size}|${p.name}|`);
    const select = h.match(/<select aria-label="Other size"[\s\S]*?<\/select>/)[0];
    const options = [...select.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].filter((m) => !/disabled/.test(m[1])).map((m) => m[2]);
    expect(options).toEqual(["18 × 24 (ARCH C)", "17 × 22 (ANSI C)", "22 × 34 (ANSI D)", "Custom (match my frame)"]);
    // the primary buttons are the only paper buttons: none of the old chip names remain
    for (const old of ["Tabloid", ">ARCH D<", ">ANSI C<", ">ANSI D<"]) expect(h).not.toContain(old);
  });
  it("full-size is the existing ARCH D key and no paper key was removed", () => {
    expect(PRIMARY_PAPERS[2].key).toBe("archd");
    const grouped = [...PRIMARY_PAPERS, ...OTHER_PAPERS].map((p) => p.key).sort();
    expect(grouped).toEqual(PAPER_SIZES.map((p) => p.key).sort());
    for (const p of PAPER_SIZES) expect(pageSize(p.key, "landscape").wIn).toBeGreaterThan(0);
  });
  it("the selected button / dropdown value follows the setting", () => {
    expect(paperChoice("tabloid", false)).toEqual({ primary: "tabloid", other: "" });
    expect(paperChoice("archc", false)).toEqual({ primary: null, other: "archc" });
    expect(render({ paper: "tabloid" })).toMatch(/aria-pressed="true"[^>]*>(?:(?!<button)[\s\S])*?Half-size/);
  });
});

describe("(b) Custom (match my frame) is the fit-to-frame page", () => {
  it("choosing Custom turns fitToFramePage on, keeps the paper key; a stock size or button clears it", () => {
    expect(paperPick("custom", "tabloid", false)).toEqual({ paper: "tabloid", fitToFramePage: true });
    expect(paperPick("letter", "tabloid", true)).toEqual({ paper: "letter", fitToFramePage: false });
    expect(paperPick("ansic", "archd", true)).toEqual({ paper: "ansic", fitToFramePage: false });
  });
  it("while Custom is on the dropdown reads Custom, the three buttons are deselected and orientation is disabled", () => {
    const h = render({ paper: "tabloid", fitToFramePage: true });
    expect(paperChoice("tabloid", true)).toEqual({ primary: null, other: "custom" });
    expect(h).toMatch(/<option value="custom" selected/);
    expect(pressedPaper(h)).toBe(0);
    const orientation = h.match(/aria-label="Orientation"[\s\S]*?<\/div>/)[0];
    expect((orientation.match(/disabled/g) || []).length).toBe(2);
    expect(render()).not.toMatch(/aria-label="Orientation"[\s\S]*?disabled=""[\s\S]*?<\/div>/);
  });
  it("the old separate checkbox is gone", () => {
    expect(render()).not.toContain("page takes the frame");
  });
});

describe("(c) labels", () => {
  const h = render();
  it("new labels render", () => {
    for (const s of ["Site summary strip", "Scale to fit (NTS)", "Flatten markups (unrecoverable)", "Buildings table", "Square feet labels", "Map layers", "Overlay", "Aerial", "Dimensions", "Paper", "On the plan", "Markups", "Landscape", "Portrait"]) expect(h).toContain(s);
    expect(h).toContain("Goose Creek · Concept A · Oct 30, 2026");
  });
  it("old labels and tool names are gone", () => {
    for (const s of ["Stats band", "Bluebeam", "Acrobat", "Fit to frame", "Element area", "Map / GIS layers", "Placed reference overlay", "PDF markups", "Aerial imagery", ">Project<", ">North<"]) expect(h).not.toContain(s);
  });
  it("Prepared by turns autocomplete off; the Sheet cards are whole-card labels around one checkbox", () => {
    expect(h).toMatch(/<input type="text" autoComplete="off"/);
    for (const title of ["Site summary strip", "Buildings table"]) expect(h).toMatch(new RegExp(`<label[^>]*><input type="checkbox"[^>]*/><span[^>]*><span[^>]*>${title}</span>`));
  });
  it("conditional rows follow their availability", () => {
    const h2 = render({ aerialAvailable: false, overlayPrintable: false, mapLayersPrintable: false, buildingsTablePrintable: false });
    for (const s of ["Aerial", "Overlay", "Map layers", "Buildings table"]) expect(h2).not.toContain(s);
    expect(h2).toContain("Site summary strip");
  });
  it("one text size: no inline font size other than the panel's", () => {
    const scroll = h.slice(h.indexOf("Paper"), h.indexOf("Download PDF"));
    const sizes = new Set([...scroll.matchAll(/font-size:([\d.]+)px/g)].map((m) => m[1]));
    // 10.5 is the shared Section primitive's own heading label; everything the panel adds is 12.
    expect([...sizes].filter((s) => s !== "12" && s !== "10.5")).toEqual([]);
  });
});

describe("(d) saved settings still load", () => {
  it("a saved paper of 'ansid' selects the 22 × 34 dropdown entry and no primary button", () => {
    expect(paperChoice("ansid", false)).toEqual({ primary: null, other: "ansid" });
    const h = render({ paper: "ansid" });
    expect(h).toMatch(/<option value="ansid" selected/);
    expect(pressedPaper(h)).toBe(0);
  });
  it("every legacy key resolves to exactly one control", () => {
    for (const { key } of PAPER_SIZES) {
      const c = paperChoice(key, false);
      expect(!!c.primary !== !!c.other).toBe(true);
    }
  });
});
