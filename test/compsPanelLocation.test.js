/* B986096-HARDENING-14 — the comp list row and the comp detail view both used to ignore a comp's
 * real LOCATION (address / APN / plan name) entirely: the list fell back to the deal's RATE when
 * Title was blank ("$0.65/SF/yr NNN" as a row's own name), and the detail view had no Location
 * field at all despite the anchor carrying real, already-resolved information. Both render through
 * react-dom/server (no DOM/Leaflet needed) with a synchronous anchor kind (parcel), which exercises
 * `useCompLocationText`'s non-network branch exactly the same way a pin's SYNCHRONOUS fallback
 * (`compLocationText.pinFallbackText`, already covered by compLocationText.test.js) does.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompRow, CompDetail } from "../src/shared/comps/components/CompsPanel.jsx";

const PARCEL_COMP = {
  id: "c1", compType: "land", compDate: "2026-03-14", title: "",
  anchor: { kind: "parcel", parcelApn: "123-456-789" },
  landPrice: 850000, landSizeValue: 3.2, landSizeUnit: "ac",
};

describe("CompsPanel: a comp's LOCATION, not its rate, is the row/detail fallback identity", () => {
  it("CompRow: an untitled comp's row title is its Location (the APN), never the bare rate", () => {
    const html = renderToStaticMarkup(createElement(CompRow, { comp: PARCEL_COMP, onOpen: () => {} }));
    expect(html).toContain("123-456-789");
    expect(html).not.toContain("$0.66/SF"); // land $/SF headline never leads when a location exists
  });

  it("CompRow: a comp WITH a title still shows its title, unaffected", () => {
    const titled = { ...PARCEL_COMP, title: "West Hardy tract" };
    const html = renderToStaticMarkup(createElement(CompRow, { comp: titled, onOpen: () => {} }));
    expect(html).toContain("West Hardy tract");
  });

  it("CompDetail: a Location field renders with the comp's real identity", () => {
    const html = renderToStaticMarkup(createElement(CompDetail, {
      comp: PARCEL_COMP, canEdit: true, onEdit: () => {}, onDelete: () => {}, onBack: () => {},
    }));
    expect(html).toContain("Location");
    expect(html).toContain("123-456-789");
  });

  it("CompDetail: no anchor at all renders no Location field (never a blank row)", () => {
    const noAnchor = { ...PARCEL_COMP, anchor: null };
    const html = renderToStaticMarkup(createElement(CompDetail, {
      comp: noAnchor, canEdit: true, onEdit: () => {}, onDelete: () => {}, onBack: () => {},
    }));
    expect(html).not.toContain(">Location<");
  });
});
