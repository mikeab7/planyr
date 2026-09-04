import { describe, it, expect } from "vitest";
import { isOverlayPrintable, printableOverlays, hasPrintableOverlay } from "../src/workspaces/site-planner/lib/overlayPrint.js";

// B131 — the "Print overlay" checkbox shows only when there's something to print, and
// prints exactly the overlays that are visible on screen.
describe("site-plan overlay print selection (B131)", () => {
  const rendered = { id: "a", src: "data:image/png;base64,AAAA", opacity: 1 };
  const placeholder = { id: "b", storageKey: "uid/r/x.pdf" }; // synced ref, raster not fetched on this device → no src
  const oversize = { id: "c", name: "huge.pdf" };             // 50 MB+ file: work layer saved, raster absent → no src
  const hidden = { id: "d", src: "data:image/png;base64,BBBB", visible: false }; // forward-compat per-overlay hide

  it("counts a rendered overlay (has a raster) as printable", () => {
    expect(isOverlayPrintable(rendered)).toBe(true);
  });

  it("excludes overlays with no raster — a plot must not show a 're-add me' prompt", () => {
    expect(isOverlayPrintable(placeholder)).toBe(false);
    expect(isOverlayPrintable(oversize)).toBe(false);
  });

  it("respects an explicit visible:false (future per-overlay show/hide toggle)", () => {
    expect(isOverlayPrintable(hidden)).toBe(false);
  });

  it("printableOverlays keeps only the renderable, visible ones — in order", () => {
    expect(printableOverlays([placeholder, rendered, hidden]).map((o) => o.id)).toEqual(["a"]);
  });

  it("hasPrintableOverlay drives the no-dead-control checkbox visibility", () => {
    expect(hasPrintableOverlay([])).toBe(false);            // nothing loaded → hide the checkbox
    expect(hasPrintableOverlay([placeholder])).toBe(false); // only an unsynced placeholder → still hide it
    expect(hasPrintableOverlay([placeholder, rendered])).toBe(true); // a real overlay present → show it
  });

  it("tolerates missing / malformed input without throwing", () => {
    expect(hasPrintableOverlay(undefined)).toBe(false);
    expect(hasPrintableOverlay(null)).toBe(false);
    expect(printableOverlays(null)).toEqual([]);
    expect(printableOverlays(undefined)).toEqual([]);
    expect(isOverlayPrintable(null)).toBe(false);
    expect(isOverlayPrintable(undefined)).toBe(false);
  });

  // B848736 — the pinned map-captured reference prints/exports under its own "Aerial imagery"
  // toggle (unchanged from when it was a separate `underlay` field), never the "Placed reference
  // overlay" one — so it must not gate or default-check that checkbox just by being present.
  it("excludes the pinned map reference even though it has a real raster and is visible", () => {
    const mapRef = { id: "aerial", src: "data:image/png;base64,AAAA", opacity: 1, fromMap: true };
    expect(isOverlayPrintable(mapRef)).toBe(false);
    expect(printableOverlays([mapRef, rendered]).map((o) => o.id)).toEqual(["a"]);
    expect(hasPrintableOverlay([mapRef])).toBe(false); // only the pinned reference present → still hide the checkbox
  });
});
