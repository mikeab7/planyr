/* B2507062 (NEW-7, owner constraint #45) — a layer's click card is CLEAN: plain labels, no raw field names, no empty / null rows, normal dates, short labelled links,
 * and the source behind the (i). The owner's list of offenders: ZONE, CASE_NO, Shape.STArea, OBJECTID, CONVERSION_STATUS. */
import { describe, it, expect } from "vitest";
import { humanLabel, looksRawLabel, cleanRow, cleanCard, niceDate, linkLabel, isEmptyText, cardNode } from "../src/workspaces/site-planner/lib/identifyCard.js";
import { featureCard, hoverRows } from "../src/workspaces/site-planner/lib/featureHover.js";
import { DESOTO_LAYERS } from "../src/workspaces/site-planner/lib/desotoLayers.js";

describe("humanLabel", () => {
  it("turns column names into words and drops bookkeeping", () => {
    expect(humanLabel("CASE_NO")).toBe("Case no.");
    expect(humanLabel("DATE_APPROVED")).toBe("Date approved");
    expect(humanLabel("ZONE")).toBe("Zone");
    expect(humanLabel("CONVERSION_STATUS")).toBe("Conversion status");
    expect(humanLabel("Zone")).toBe("Zone");
    expect(humanLabel("Rim elev.")).toBe("Rim elev.");
    for (const raw of ["OBJECTID", "Shape.STArea", "Shape.STLength", "SHAPE_Length", "GlobalID", "FID", "created_user", "last_edited_date"]) expect(humanLabel(raw), raw).toBeNull();
  });
  it("knows a raw label when it sees one", () => {
    expect(looksRawLabel("CASE_NO")).toBe(true);
    expect(looksRawLabel("Shape.STArea")).toBe(true);
    expect(looksRawLabel("Case")).toBe(false);
    expect(looksRawLabel("Rim elev.")).toBe(false);
  });
});

describe("cleanRow / cleanCard", () => {
  it("drops empty, null and placeholder rows", () => {
    for (const t of ["", "  ", "null", "<Null>", "None", "N/A", "undefined", "0", "--"]) expect(cleanRow({ label: "Case", text: t }), JSON.stringify(t)).toBeNull();
    expect(cleanRow({ label: "Lots", text: "12" })).toEqual({ label: "Lots", text: "12" });
  });
  it("formats epoch-ms and ISO dates; leaves other text alone", () => {
    expect(niceDate("1787011200000")).toBe("Aug 18, 2026");
    expect(niceDate("2026-08-18")).toBe("Aug 18, 2026");
    expect(niceDate("2026-08-18T00:00:00Z")).toBe("Aug 18, 2026");
    expect(niceDate("C-5")).toBe("C-5");
    expect(cleanRow({ label: "Approved", text: "1787011200000" }).text).toBe("Aug 18, 2026");
  });
  it("turns a raw URL into a short labelled link, never printing the URL", () => {
    const r = cleanRow({ label: "Ordinance", text: "https://library.municode.com/ms/olive_branch/codes/x", href: null });
    expect(r).toEqual({ label: "Ordinance", text: "Ordinance", href: "https://library.municode.com/ms/olive_branch/codes/x" });
    expect(cleanRow({ label: "Plat", text: "", href: "https://example.test/plat/1.pdf" }).text).toBe("Plat");
    expect(cleanRow({ label: "Warranty deed", text: "https://example.test/d/9", href: null }).text).toBe("Deed");
    expect(linkLabel("Something", "https://x.test/a.pdf")).toBe("Document");
  });
  it("a card keeps its title, drops dead rows, dedupes, and moves the source to `about`", () => {
    const c = cleanCard({ title: "Zoning", rows: [{ label: "ZONE", text: "C-5" }, { label: "CASE_NO", text: "null" }, { label: "OBJECTID", text: "77" }, { label: "Zone", text: "C-5" }], sourceName: "DeSoto County GIS" });
    expect(c.title).toBe("Zoning");
    expect(c.rows).toEqual([{ label: "Zone", text: "C-5" }]);
    expect(c.about).toBe("DeSoto County GIS");
    expect(cleanCard({ title: "", rows: [{ label: "x_y", text: "" }] })).toBeNull();
  });
  it("isEmptyText is the single empty test", () => { expect(isEmptyText("N/A")).toBe(true); expect(isEmptyText("C-3")).toBe(false); });
});

describe("featureCard — every DeSoto / Olive Branch row's card is clean", () => {
  const sample = { ZONE: "C-2", CASE_NO: "86-01", DATE_APPROVED: 1787011200000, NAME: "Test", FLU: "Commercial", Lots: 12, Date_Approved: 1787011200000, Width_FT: 25, CLASSIFICA: "Arterial", SIZE: 8, MATERIAL: "PVC", Diameter: 6, OBJECTID: 5, "Shape.STArea": 12.3, CONVERSION_STATUS: "FIELD VERIFIED" };
  it("no card — for any row with hover fields — shows a raw column name, a null, or a bare URL", () => {
    for (const [id, cfg] of Object.entries(DESOTO_LAYERS)) {
      if (!cfg.hoverFields || typeof cfg.identifyCard === "function") continue;
      const c = cleanCard({ ...featureCard(cfg, sample), sourceName: cfg.source });
      expect(c, id).not.toBeNull();
      expect(c.title, id).not.toMatch(/[A-Z]+_[A-Z]+|OBJECTID|Shape\./);
      for (const r of c.rows) {
        expect(r.label, `${id}: ${r.label}`).not.toMatch(/[A-Z]+_[A-Z]+|OBJECTID|Shape\.|CONVERSION/);
        expect(r.text, `${id}: ${r.label}`).not.toMatch(/^(null|undefined|https?:)/i);
      }
    }
  });
  it("the zoning one-liner is now rows: Zone / Case / Approved", () => {
    const rows = hoverRows(DESOTO_LAYERS.ms_desoto_zoning, { ZONE: "C-2", CASE_NO: "86-01", DATE_APPROVED: 1787011200000 });
    expect(rows.map((r) => r.label)).toEqual(["Zone", "Case", "Approved"]);
    expect(rows[2].text).toBe("Aug 18, 2026");
  });
});

describe("cardNode (the Map view popup)", () => {
  it("renders title, rows and a labelled link; the source is behind an (i) and starts hidden", () => {
    const mk = (tag) => { const el = { tag, children: [], style: {}, attrs: {}, listeners: {}, textContent: "", append(...k) { this.children.push(...k); }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(e, f) { this.listeners[e] = f; } }; return el; };
    const doc = { createElement: mk };
    const node = cardNode({ title: "Zoning", rows: [{ label: "Zone", text: "C-5" }, { label: "Ordinance", text: "", href: "https://library.municode.com/x" }], about: "Source: DeSoto County GIS\nData: 2026" }, doc);
    const flat = JSON.stringify(node, (k, v) => (k === "listeners" ? undefined : v));
    expect(flat).toContain("Zoning");
    expect(flat).toContain("Ordinance");
    expect(flat).toContain("About this layer");
    expect(flat).toContain("display:none");
  });
});
