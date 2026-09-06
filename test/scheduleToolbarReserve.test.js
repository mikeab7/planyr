import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScheduleCenter, ScheduleActions } from "../src/workspaces/scheduler/components/ScheduleToolbar.jsx";

// B1218496 — the Scheduler's lifted toolbar (rendered inside the shared AppHeader while the
// embedded Gantt iframe reports its state over postMessage) used to MOUNT the review-count badge
// and the zoom-control block only once their real values were known — and the iframe re-posts its
// WHOLE toolbar-state payload whenever anything it tracks changes, so a badge/block that mounts a
// beat after the surrounding row first rendered widened it, sliding an already-pressable sibling
// control sideways (event:click-swallowed, "moved": true; see e2e/schedule-toolbar-settle.spec.js
// for the live behavioral proof). The fix reserves both pieces' boxes (visibility, never
// mount/unmount) instead.
const BASE = {
  ready: true, settled: true, view: "grid", section: "projects", isMobile: false,
  zoomPct: 100, zoomable: false, reviewCount: 0, reviewOpen: false, saveStatus: "saved",
  savePulse: false, fileLinked: false, offlineFallback: false, authRequired: false, activePanel: null,
};

describe("ScheduleCenter — the review-count badge is always mounted, never conditional", () => {
  it("reviewCount: 0 still renders the badge span, just visibility:hidden", () => {
    const html = renderToStaticMarkup(createElement(ScheduleCenter, { toolbar: { ...BASE, reviewCount: 0 }, post: () => {} }));
    expect(html).toMatch(/visibility:hidden/);
    expect(html).not.toMatch(/visibility:visible/); // nothing else in this component uses visibility
  });

  it("reviewCount > 0 renders the SAME badge span, now visible, with the real count", () => {
    const html = renderToStaticMarkup(createElement(ScheduleCenter, { toolbar: { ...BASE, reviewCount: 5 }, post: () => {} }));
    expect(html).toMatch(/visibility:visible/);
    expect(html).toMatch(/>5</);
  });

  it("both states mount the identical number of elements (no conditional mount/unmount)", () => {
    const htmlZero = renderToStaticMarkup(createElement(ScheduleCenter, { toolbar: { ...BASE, reviewCount: 0 }, post: () => {} }));
    const htmlFive = renderToStaticMarkup(createElement(ScheduleCenter, { toolbar: { ...BASE, reviewCount: 5 }, post: () => {} }));
    const tagCount = (html) => (html.match(/<(button|span)/g) || []).length;
    expect(tagCount(htmlZero)).toBe(tagCount(htmlFive));
  });
});

describe("ScheduleActions — the zoom block is reserved until the toolbar SETTLES, never before", () => {
  it("unsettled (fallback-only ready) + zoomable false: the zoom block still mounts, hidden", () => {
    const html = renderToStaticMarkup(createElement(ScheduleActions, { toolbar: { ...BASE, settled: false, zoomable: false }, post: () => {} }));
    expect(html).toMatch(/Zoom out/);
    expect(html).toMatch(/visibility:hidden/);
  });

  it("unsettled, then settled with zoomable:true — same element count either way (no late insert)", () => {
    const htmlUnsettled = renderToStaticMarkup(createElement(ScheduleActions, { toolbar: { ...BASE, settled: false, zoomable: false }, post: () => {} }));
    const htmlSettledOn = renderToStaticMarkup(createElement(ScheduleActions, { toolbar: { ...BASE, settled: true, zoomable: true }, post: () => {} }));
    const tagCount = (html) => (html.match(/<(button|div|span)/g) || []).length;
    expect(tagCount(htmlUnsettled)).toBe(tagCount(htmlSettledOn));
  });

  it("settled with zoomable:false — original behavior preserved (no zoom block at all)", () => {
    const html = renderToStaticMarkup(createElement(ScheduleActions, { toolbar: { ...BASE, settled: true, zoomable: false }, post: () => {} }));
    expect(html).not.toMatch(/Zoom out/);
  });
});

// Source-guard: `toolbar.settled` must come ONLY from a real planar:toolbar-state report, never
// from markToolbarReadyFallback's bare ready-only flip — that distinction is the whole fix.
describe("Scheduler.jsx — settled source shape", () => {
  const src = readFileSync(new URL("../src/workspaces/scheduler/Scheduler.jsx", import.meta.url), "utf8");

  it("the real toolbar-state handler sets settled:true", () => {
    const handlerIdx = src.indexOf('m.type === "planar:toolbar-state"');
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBody = src.slice(handlerIdx, handlerIdx + 1200);
    expect(handlerBody).toMatch(/settled:\s*true/);
  });

  it("markToolbarReadyFallback never sets settled — it only flips ready on a still-default state", () => {
    const fallbackIdx = src.indexOf("const markToolbarReadyFallback");
    expect(fallbackIdx).toBeGreaterThan(-1);
    const fallbackBody = src.slice(fallbackIdx, fallbackIdx + 300);
    expect(fallbackBody).not.toMatch(/settled/);
  });
});
