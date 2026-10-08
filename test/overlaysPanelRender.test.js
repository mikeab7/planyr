/* NEW-1 (Overlays panel redesign) — the panel rendered to static markup for every overlay KIND the owner's
 * spec distinguishes. No jsdom: renderToStaticMarkup is enough to prove WHICH controls each kind gets and what
 * its row says. (The portaled ⋯ menu and the live layout are covered by ui-audit/verify-overlays-panel-layout.mjs.) */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import OverlaysPanel from "../src/workspaces/site-planner/components/OverlaysPanel.jsx";

const noop = () => {};
const handlers = new Proxy({}, { get: (_, k) => (k === "sliderHistory" ? () => ({}) : k === "pageReady" ? () => true : noop) });
const pdf = (o = {}) => ({ id: "pdf1", name: "Master plan.pdf", src: "data:image/png;base64,AA", sheet: { std: true, label: "ANSI D" }, imgW: 2448, imgH: 1584, ftPerPx: 200 / 72, page: 1, pageCount: 1, rotation: 0, opacity: 1, ...o });
const img = (o = {}) => ({ id: "img1", name: "Aerial.png", src: "data:image/png;base64,AA", imgW: 800, imgH: 600, ftPerPx: 1, rotation: 0, opacity: 1, ...o });
const dxf = (o = {}) => ({ id: "dxf1", name: "Civil.dxf", kind: "dxf", src: "data:image/svg+xml,x", imgW: 800, imgH: 600, ftPerPx: 1, unitsLabel: "feet", rotation: 0, opacity: 1, ...o });
const map = (o = {}) => ({ id: "map1", name: "Aerial backdrop", fromMap: true, src: "data:image/png;base64,AA", imgW: 800, imgH: 600, ftPerPx: 1, opacity: 1, ...o });

function render(overlays, selId, extra = {}) {
  return renderToStaticMarkup(createElement(OverlaysPanel, { overlays, selId, showAerial: true, hasParcel: true, busy: false, loadErr: {}, basemapNote: false, calib: null, calibMsg: "", menuId: null, renamingId: null, pageFocusTick: 0, handlers, ...extra }));
}
const text = (html) => html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");

describe("rows", () => {
  it("PDF row shows the ratio; multi-page appends p. N; legacy overlays show NO amber", () => {
    const h = render([pdf({ pageCount: 5, page: 3 })], null);
    expect(h).toContain(`1&quot; = 200&#x27; · p. 3`);
    expect(h).not.toContain("not scaled");
  });
  it("unscaled PDF and image say 'not scaled' (amber) and never a ratio", () => {
    const h = render([pdf({ id: "p2", unscaled: true }), img({ unscaled: true })], null);
    expect((h.match(/not scaled/g) || []).length).toBe(2);
    expect(h).not.toMatch(/&quot; = /);
  });
  it("image row shows no ratio; dxf shows drawing units; assumed dxf reads not scaled", () => {
    expect(text(render([img()], null))).not.toMatch(/=/);
    expect(render([dxf()], null)).toContain("Drawing units · feet");
    expect(render([dxf({ unitsAssumed: true })], null)).toContain("not scaled");
  });
  it("the bottom row reads exactly 'Add overlay' and the panel carries no helper paragraphs or '?'", () => {
    const h = render([pdf()], null);
    expect(h).toContain(">Add overlay<");
    expect(h).not.toMatch(/PDF, image or CAD|Map overlays are managed here|Drop a site-plan|aria-label="Help"/);
  });
  it("every row has eye, padlock and ⋯", () => {
    const h = render([pdf()], null);
    expect(h).toContain('data-testid="reference-eye-pdf1"');
    expect(h).toContain('data-testid="reference-lock-pdf1"');
    expect(h).toContain('data-testid="reference-more-pdf1"');
  });
  it("lists front-most first", () => {
    const h = render([pdf({ id: "back", name: "BACK" }), pdf({ id: "front", name: "FRONT" })], null);
    expect(h.indexOf("FRONT")).toBeLessThan(h.indexOf("BACK"));
  });
  it("a row from another plan renders hidden-style 'added on <plan>' with an eye, and cannot be opened", () => {
    const h = render([pdf(), { ...img({ id: "fx", name: "Elsewhere.png" }), foreign: { planName: "Concept B" } }], "fx");
    expect(h).toContain("added on Concept B");
    expect(h).toContain('data-testid="reference-eye-fx"');
    expect(h).not.toContain('data-testid="overlay-open-fx"');
  });
});

describe("the open row's sections", () => {
  it("PDF: ratio line + three equal scale buttons + rotation + crop + appearance + knockout", () => {
    const h = render([pdf()], "pdf1");
    expect(h).toContain('data-testid="overlay-scale-ratio"');
    for (const k of ["set", "trace", "match"]) expect(h).toContain(`data-testid="overlay-scale-${k}"`);
    expect(text(h)).toMatch(/Set scale\|Trace a length\|Match 2 points/);
    expect(h).toContain('data-testid="overlay-rot-minus"'); expect(h).toContain('data-testid="overlay-rot-plus"');
    expect(h).toContain('data-testid="overlay-rot-ccw90"'); expect(h).toContain('data-testid="overlay-rot-cw90"');
    expect(h).not.toMatch(/North/);
    expect(h).toContain("Knock out white paper");
    expect(h).toContain("Behind the plan"); expect(h).toContain("In front");
  });
  it("the three scale buttons carry no primary styling (same variant for all)", () => {
    const h = render([pdf()], "pdf1");
    const btns = [...h.matchAll(/<button[^>]*data-testid="overlay-scale-(?:set|trace|match)"[^>]*>/g)].map((m) => m[0].replace(/data-testid="[^"]*"|title="[^"]*"/g, "").replace(/aria-pressed="[^"]*"/g, ""));
    expect(btns.length).toBe(3);
    expect(new Set(btns).size).toBe(1);
  });
  it("image: only Trace + Match (two buttons), no ratio, no knockout; amber box when unscaled", () => {
    const h = render([img({ unscaled: true })], "img1");
    expect(h).not.toContain('data-testid="overlay-scale-set"');
    expect(h).toContain('data-testid="overlay-scale-trace"'); expect(h).toContain('data-testid="overlay-scale-match"');
    expect(h).toContain("This overlay is not scaled");
    expect(h).not.toContain("overlay-scale-ratio"); expect(h).not.toContain("Knock out white paper");
  });
  it("unscaled does NOT dim or disable Crop or Appearance", () => {
    const h = render([img({ unscaled: true })], "img1");
    expect(h).toContain('data-testid="overlay-crop-open"');
    expect(h).not.toMatch(/data-testid="overlay-crop-open"[^>]*disabled/);
    expect(h).toContain('data-testid="overlay-opacity-pct"');
    expect(h).not.toMatch(/data-testid="overlay-opacity-pct"[^>]*disabled/);
  });
  it("a scaled image has no amber box and no ratio", () => {
    const h = render([img()], "img1");
    expect(h).not.toContain("This overlay is not scaled"); expect(h).not.toContain("overlay-scale-ratio");
  });
  it("dxf with assumed units: amber box re-points the warning at Trace a length", () => {
    const h = render([dxf({ unitsAssumed: true })], "dxf1");
    expect(h).toContain("This overlay is not scaled"); expect(h).toContain("use Trace a length to confirm");
  });
  it("map capture: no placement, no crop, no scale/amber/calibrate; opacity only; own load-error banner", () => {
    const h = render([map()], "map1", { loadErr: { map1: "remote" } });
    for (const t of ["overlay-placement", "overlay-crop-open", "overlay-scale-trace", "overlay-rotation", "This overlay is not scaled"]) expect(h).not.toContain(t);
    expect(h).toContain('data-testid="overlay-opacity-pct"');
    expect(h).not.toContain("Behind the plan");
    expect(h).toContain("Aerial image didn&#x27;t load");
  });
  it("crop line: Not cropped / Rectangle / Polygon · N points, one control (Edit + Reset)", () => {
    expect(text(render([img()], "img1"))).toContain("Not cropped");
    expect(text(render([img({ crop: { x: 0, y: 0, w: 10, h: 10 } })], "img1"))).toContain("Rectangle");
    expect(text(render([img({ crop: { kind: "poly", pts: [[0, 0], [9, 0], [9, 9], [0, 9]] } })], "img1"))).toContain("Polygon · 4 points");
    expect((render([img()], "img1").match(/overlay-crop-open"/g) || []).length).toBe(1);
  });
  it("multi-page PDF shows the page stepper; single-page does not", () => {
    expect(render([pdf({ pageCount: 4 })], "pdf1")).toContain('data-testid="overlay-page"');
    expect(render([pdf()], "pdf1")).not.toContain('data-testid="overlay-page"');
  });
  it("Draws reflects the band", () => {
    expect(render([pdf({ aboveParcel: true })], "pdf1")).toMatch(/aria-pressed="true"[^>]*>In front/);
  });
});

describe("the ⋯ menu (source order — it is a portal)", () => {
  const src = readFileSync("src/workspaces/site-planner/components/OverlaysPanel.jsx", "utf8");
  const menu = src.slice(src.indexOf("function RowMenu"), src.indexOf("function OverlayRow"));
  it("lists the owner's items in the owner's order, Remove overlay last and red", () => {
    const order = ['"Rename…"', '"Change page…"', 'Lock in place', '"Hide"', '"Zoom to"', '"Size to view"', '"Copy"', '"Duplicate"', '"Align to parcel edge"', '"Move up"', '"Move down"', '"Remove overlay"'];
    let at = -1;
    for (const t of order) { const i = menu.indexOf(t); expect(i, t).toBeGreaterThan(at); at = i; }
    expect(menu).toMatch(/danger: true/);
  });
  it("is keyboard operable: arrows, Home/End, Escape returns focus to the ⋯ button", () => {
    for (const k of ["ArrowDown", "ArrowUp", "Home", "End"]) expect(menu).toContain(`"${k}"`);
    expect(menu).toMatch(/anchorRef\.current\.focus\(\)/);
  });
});

describe("the look spec (owner, 2026-10-08) — source guards; the measured proof is verify-overlays-panel-layout", () => {
  const src = readFileSync("src/workspaces/site-planner/components/OverlaysPanel.jsx", "utf8");
  it("has no bold-700 text and no orange accent", () => {
    expect(src).not.toMatch(/fontWeight:\s*(700|650|800|"bold")/);
    expect(src).not.toMatch(/var\(--accent\)/);
    expect(src).not.toMatch(/var\(--accent,/);
  });
  it("decides the scale group from a measurement, not an auto-fit grid", () => {
    expect(src).toContain("ResizeObserver");
    expect(src).not.toMatch(/repeat\(auto-fit/);
  });
  it("shows the opacity as plain text ('85%') in one input, with no separate % span", () => {
    const html = render([pdf()], "pdf1");
    expect(html).toMatch(/data-testid="overlay-opacity-pct"[^>]*value="100%"/);
  });
});
