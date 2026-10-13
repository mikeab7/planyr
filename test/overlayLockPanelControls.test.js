/* NEW-1 (owner decision 2026-10-12, supersedes B1154369's "do NOT undo" locked-rotation note):
 * Lock blocks ONLY a direct drag/resize/rotate on the map. Anything typed or clicked in a PANEL works on a
 * locked overlay. Red on the pre-change tree: the rotation field/buttons, the scale group and the ⋯ menu's
 * "Size to view" / "Align to parcel edge" were all `disabled` while locked. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import OverlaysPanel from "../src/workspaces/site-planner/components/OverlaysPanel.jsx";

const noop = () => {};
const handlers = new Proxy({}, { get: (_, k) => (k === "sliderHistory" ? () => ({}) : k === "pageReady" ? () => true : noop) });
const pdf = (o = {}) => ({ id: "pdf1", name: "Master plan.pdf", src: "data:image/png;base64,AA", sheet: { std: true, label: "ANSI D" }, imgW: 2448, imgH: 1584, ftPerPx: 200 / 72, page: 1, pageCount: 1, rotation: 33.8, opacity: 1, ...o });
const render = (overlays, selId) => renderToStaticMarkup(createElement(OverlaysPanel, { overlays, selId, showAerial: true, hasParcel: true, busy: false, loadErr: {}, basemapNote: false, calib: null, calibMsg: "", menuId: null, renamingId: null, pageFocusTick: 0, handlers }));
/* the opening tag of the element carrying a data-testid */
const tag = (html, id) => { const i = html.indexOf(`data-testid="${id}"`); expect(i, id).toBeGreaterThan(-1); return html.slice(html.lastIndexOf("<", i), html.indexOf(">", i) + 1); };

const IDS = ["overlay-rotation", "overlay-rot-minus", "overlay-rot-plus", "overlay-rot-ccw90", "overlay-rot-cw90", "overlay-scale-set", "overlay-scale-trace", "overlay-scale-match"];

describe("a LOCKED overlay's panel controls all work", () => {
  const locked = render([pdf({ locked: true })], "pdf1");
  const unlocked = render([pdf({ locked: false })], "pdf1");
  for (const id of IDS) {
    it(`${id} is not disabled when locked (and renders the same as unlocked)`, () => {
      expect(tag(locked, id)).not.toMatch(/\sdisabled(=|\s|>)/);
      expect(tag(locked, id).replace(/\s*(aria-pressed|title)="[^"]*"/g, "")).toBe(tag(unlocked, id).replace(/\s*(aria-pressed|title)="[^"]*"/g, ""));
    });
  }
  it("the rotation group is not dimmed and carries no 'unlock' reason", () => {
    expect(locked).not.toMatch(/Unlock this overlay to/);
    expect(locked).not.toMatch(/opacity:0\.55/);
  });
});

describe("the ⋯ menu and the writes no longer refuse a locked overlay", () => {
  const panel = readFileSync(new URL("../src/workspaces/site-planner/components/OverlaysPanel.jsx", import.meta.url), "utf8");
  const planner = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  it("Size to view / Align to parcel edge menu rows are not gated on lock", () => {
    const sz = panel.match(/it\("Size to view".*\n/)[0], al = panel.match(/it\("Align to parcel edge".*\n/)[0];
    expect(sz).not.toMatch(/locked/); expect(al).not.toMatch(/locked/);
  });
  it("sizeOverlayToView and alignOverlayToParcelEdge do not refuse on o.locked", () => {
    const a = planner.indexOf("const sizeOverlayToView"); expect(planner.slice(a, a + 400)).not.toMatch(/\.locked/);
    const b = planner.indexOf("const alignOverlayToParcelEdge"); expect(planner.slice(b, b + 500)).not.toMatch(/\.locked/);
  });
  it("the typed-rotation / ±90 / ±1 writes (patchOverlay) carry no lock check", () => {
    const a = planner.indexOf("const patchOverlay ="); expect(planner.slice(a, a + 260)).not.toMatch(/locked/);
  });
});

describe("a DIRECT map drag on a locked overlay still does nothing", () => {
  const planner = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  const body = (name) => { const a = planner.indexOf(`const ${name} =`); return planner.slice(a, planner.indexOf("drag.current =", a)); };
  for (const fn of ["startMoveSheetOverlay", "startScaleOverlay", "startRotateOverlay"]) {
    it(`${fn} returns before arming a drag when locked`, () => { expect(body(fn)).toMatch(/o\.locked(\s\|\|[^)]*)?\) return/); });
  }
  it("a locked overlay's image takes no pointer events and shows no resize/rotate grips", () => {
    expect(planner).toMatch(/pointerEvents=\{o\.locked \? "none" : "auto"\}/);
    expect(planner).toMatch(/\{!o\.locked && !ovCalib && !o\.fromMap && \(<>/);
  });
});

describe("Map / Comps 'Adjust site plan' panel: typed rotation works when locked", () => {
  const sec = readFileSync(new URL("../src/shared/sitePlans/components/SitePlansSection.jsx", import.meta.url), "utf8");
  it("the Rotation field has no locked branch and the old read-only copy is gone", () => {
    const a = sec.indexOf('<span style={metaText}>Rotation</span>');
    expect(sec.slice(a, a + 400)).not.toMatch(/o\.locked/);
    expect(sec).not.toMatch(/locked — unlock to rotate/);
  });
  it("the rotation write is explicit, so the placement commit's lock guard lets it through", () => {
    expect(sec).toMatch(/setRotation = \(o, rotationDeg\) => commitPlacement\(o\.id, \{ rotationDeg \}, \{ explicit: true \}\)/);
    expect(sec).toMatch(/existing\.locked && !\(opts && opts\.explicit\) && activeIdRef\.current !== id/);
  });
});
