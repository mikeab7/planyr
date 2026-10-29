import { describe, it, expect } from "vitest";
import { kmlToDraftRows, kmzToDraftRows, parseKmlPlacemarks } from "../src/shared/comps/lib/kmlImport.js";
import { draftTitleFor, isLoneDealWord, resolveImportTitle, rowToImportDraft } from "../src/shared/comps/lib/compDrafts.js";

// NEW-1 — the placemark <name> is the comp title, always. Description words never displace it.
const kml = (...pms) => `<?xml version="1.0"?><kml><Document>${pms.map(([name, desc]) =>
  `<Placemark>${name == null ? "" : `<name>${name}</name>`}<description><![CDATA[${desc}]]></description><Point><coordinates>-95.1,29.7,0</coordinates></Point></Placemark>`).join("")}</Document></kml>`;
const titleOf = (name, desc) => kmlToDraftRows(kml([name, desc]))[0].proposed.title;

describe("KML import title = placemark <name>", () => {
  it("a lone deal-type word as the description never becomes the title (the reported 'Lease')", () => {
    expect(titleOf("Dircks Moving", "Lease")).toBe("Dircks Moving");
    expect(titleOf("Dircks Moving", "Sale")).toBe("Dircks Moving");
  });
  it("a description that LEADS with a deal word then terms does not displace the name", () => {
    expect(titleOf("FM 359 tract", "Sale, 3.2 AC, $850k")).toBe("FM 359 tract");
    expect(titleOf("Acme", "Lease, 50,000 SF at $0.65/SF/mo NNN")).toBe("Acme");
  });
  it("the reported 'Lease' title", () => {
    // The reported shape: a one-line description whose first comma-segment is the bare word "Lease"
    // gave the parser's lead-title path "Lease" (red on main).
    for (const d of ["Lease, 50,000 SF", "Lease, Houston, 50,000 SF, $0.65/SF/mo NNN", "Lease, executed 9/15/2026", "Lease, 5 yr term", "Lease, 50,000 SF, NNN"]) {
      expect(titleOf("Acme", d)).toBe("Acme");
      expect(titleOf("", d)).toBe("");
    }
  });
  it("an address-looking description does not displace the name", () => {
    expect(titleOf("Acme Yard", "123 Main St, Houston")).toBe("Acme Yard");
  });
  it("the description is still read for deal terms", () => {
    const [r] = kmlToDraftRows(kml(["Acme", "Lease 50,000 SF at $0.65/SF/mo NNN, executed 9/15/2026"]));
    expect(r.proposed.title).toBe("Acme");
    expect(r.proposed.compType).toBe("lease");
    expect(r.proposed.leaseSizeSf).toBe("50000");
  });
  it("entities in the name are decoded and the name trimmed", () => {
    expect(titleOf("  Dircks Moving &amp; Logistics  ", "Lease")).toBe("Dircks Moving & Logistics");
    expect(titleOf("A &#38; B &lt;East&gt;", "Sale")).toBe("A & B <East>");
  });
  it("the Type: Lease<br> shape keeps the name", () => {
    expect(titleOf("Acme", "Type: Lease<br>Tenant: Foo<br>Rate: $0.65/SF/mo")).toBe("Acme");
  });
  it("with no description at all the name is the title", () => {
    expect(kmlToDraftRows(kml(["Solo", ""]))[0].proposed.title).toBe("Solo");
  });
  it("empty / whitespace / missing name: derive from the property or address, never a lone deal word", () => {
    expect(titleOf("", "Lease")).toBe("");
    expect(titleOf("   ", "Sale")).toBe("");
    expect(titleOf(null, "Lease")).toBe("");
    expect(titleOf("  ", "Sale, 3.2 AC, $850k")).toBe("");
    expect(titleOf(null, "Lease at 123 Main St Houston TX, 50,000 SF")).toBe("123 Main St Houston TX");
    expect(titleOf("", "123 Main St, Houston")).toBe("123 Main St, Houston");
  });
  it("isLoneDealWord / resolveImportTitle", () => {
    for (const w of ["Lease", "lease:", "Sale", "Land Sale", "Building Sale", "Leased", "For Lease", "Sold"]) expect(isLoneDealWord(w)).toBe(true);
    for (const w of ["Lease Park Business Center", "Sale Barn Road", "123 Main St", "Airtex Building A"]) expect(isLoneDealWord(w)).toBe(false);
    expect(resolveImportTitle("Name", "Lease")).toBe("Name");
    expect(resolveImportTitle("", "Lease")).toBe("");
    expect(resolveImportTitle("", "Lease Park")).toBe("Lease Park");
  });
});

describe("title survives re-parse, review and promote", () => {
  it("draftTitleFor reads the name from rawName, healing a draft staged with title 'Lease'", () => {
    const stale = rowToImportDraft({ id: "d1", raw_name: "Dircks Moving", raw_description: "Lease", proposed: { title: "Lease" }, status: "pending" });
    expect(draftTitleFor(stale)).toBe("Dircks Moving");
  });
  it("re-parsing the same placemark (as an edit-and-reimport would) gives the same title", () => {
    const [p] = parseKmlPlacemarks(kml(["Acme", "Lease"]));
    const a = kmlToDraftRows(kml(["Acme", "Lease"]))[0];
    const b = kmlToDraftRows(kml([p.name, p.description]))[0];
    expect(b.proposed.title).toBe(a.proposed.title);
    expect(draftTitleFor({ rawName: b.raw_name, proposed: b.proposed })).toBe("Acme");
  });
  it("a draft with no name keeps a derived non-deal-word title, drops 'Lease'", () => {
    expect(draftTitleFor({ rawName: null, proposed: { title: "Lease" } })).toBe("");
    expect(draftTitleFor({ rawName: null, proposed: { title: "123 Main St" } })).toBe("123 Main St");
  });
});

describe("KMZ path", () => {
  it("a stored .kmz gives the same name-wins title", async () => {
    const xml = new TextEncoder().encode(kml(["Acme &amp; Sons", "Lease"]));
    const name = new TextEncoder().encode("doc.kml");
    const crc = (() => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let r = 0xffffffff; for (const b of xml) r = t[(r ^ b) & 0xff] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; })();
    const u16 = (n) => [n & 255, (n >> 8) & 255], u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    const local = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(xml.length), ...u32(xml.length), ...u16(name.length), ...u16(0), ...name, ...xml];
    const cen = [...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(xml.length), ...u32(xml.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...name];
    const eocd = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(1), ...u16(1), ...u32(cen.length), ...u32(local.length), ...u16(0)];
    const buf = new Uint8Array([...local, ...cen, ...eocd]).buffer;
    const rows = await kmzToDraftRows(buf, { sourceFile: "x.kmz" });
    expect(rows[0].proposed.title).toBe("Acme & Sons");
  });
});
