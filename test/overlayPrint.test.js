import { describe, it, expect } from "vitest";
import { isOverlayPrintable, printableOverlays, hasPrintableOverlay } from "../src/workspaces/site-planner/lib/overlayPrint.js";

// B130 — the "Print overlay" checkbox shows only when there's something to print, and
// prints exactly the overlays that are visible on screen.
describe("site-plan overlay print selection (B130)", () => {
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
});
