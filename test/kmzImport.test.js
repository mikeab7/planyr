import { describe, it, expect } from "vitest";
import { kmzToKmlText, kmzToDraftRows } from "../src/shared/comps/lib/kmlImport.js";
import { buildKmz, pointFeature } from "../src/shared/comps/lib/kmlExport.js";

const enc = (s) => new TextEncoder().encode(s);
const u16 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
const u32 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// CRC-32 (IEEE) — a minimal local copy for building test fixtures (never imported from the app).
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  const cs = new CompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

// A general-purpose test-only ZIP writer supporting both STORE (method 0) and DEFLATE (method 8)
// entries, so the reader's DEFLATE branch (what real Google Earth exports use) is exercised
// end to end rather than only against this repo's own STORE-only writer.
async function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = enc(e.name);
    const rawData = e.bytes instanceof Uint8Array ? e.bytes : enc(String(e.bytes));
    const method = e.method || 0;
    const data = method === 8 ? await deflateRaw(rawData) : rawData;
    const crc = crc32(rawData);
    const localOffset = offset;
    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0),
      u32(crc), u32(data.length), u32(rawData.length),
      u16(nameBytes.length), u16(0), nameBytes, data,
    ]);
    locals.push(local);
    offset += local.length;
    centrals.push(concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0),
      u32(crc), u32(data.length), u32(rawData.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(localOffset), nameBytes,
    ]));
  }
  const cd = concatBytes(centrals);
  const eocd = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(cd.length), u32(offset), u16(0),
  ]);
  const bytes = concatBytes([...locals, cd, eocd]);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const SAMPLE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>FM 359 tract</name><description>3.2 AC, asking $850k</description>
    <Point><coordinates>-95.789,29.812,0</coordinates></Point>
  </Placemark>
</Document></kml>`;

describe("kmzToKmlText — reading Planyr's own STORE-only .kmz back (round trip)", () => {
  it("extracts the doc.kml entry from a KMZ built by this repo's own writer", async () => {
    const kmz = buildKmz("Katy Site", [pointFeature({ name: "Pin comp", folder: ["Comps"], coord: [-95.83, 29.79] })]);
    const text = await kmzToKmlText(kmz.buffer.slice(kmz.byteOffset, kmz.byteOffset + kmz.byteLength));
    expect(text).toContain("<Placemark>");
    expect(text).toContain("Pin comp");
    expect(text).toContain("-95.83,29.79");
  });
});

describe("kmzToKmlText — a real-world STORE .kmz (e.g. Google Earth 'compressed' off)", () => {
  it("finds doc.kml even when it isn't the only entry", async () => {
    const zip = await buildZip([
      { name: "images/icon.png", bytes: new Uint8Array([1, 2, 3]), method: 0 },
      { name: "doc.kml", bytes: SAMPLE_KML, method: 0 },
    ]);
    const text = await kmzToKmlText(zip);
    expect(text).toContain("FM 359 tract");
  });
  it("falls back to the first *.kml entry when there's no literal doc.kml", async () => {
    const zip = await buildZip([{ name: "map.kml", bytes: SAMPLE_KML, method: 0 }]);
    const text = await kmzToKmlText(zip);
    expect(text).toContain("FM 359 tract");
  });
});

describe("kmzToKmlText — a real Google Earth .kmz (DEFLATE-compressed entry)", () => {
  it("inflates a DEFLATE doc.kml entry correctly", async () => {
    const zip = await buildZip([{ name: "doc.kml", bytes: SAMPLE_KML, method: 8 }]);
    const text = await kmzToKmlText(zip);
    expect(text).toContain("FM 359 tract");
    expect(text).toContain("-95.789,29.812");
  });
});

describe("kmzToKmlText — each failure mode gets its own message", () => {
  it("a buffer that isn't a ZIP at all", async () => {
    const bad = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    await expect(kmzToKmlText(bad)).rejects.toThrow(/valid ZIP archive/i);
  });

  it("a plain .zip with no .kml entry inside (e.g. renamed from .zip)", async () => {
    const zip = await buildZip([{ name: "readme.txt", bytes: "hello", method: 0 }]);
    await expect(kmzToKmlText(zip)).rejects.toThrow(/doesn't contain a \.kml file/i);
  });

  it("a truncated entry (declared size runs past the end of the file)", async () => {
    // Patch the CENTRAL DIRECTORY record's compressed-size field to claim far more data than the
    // archive actually holds, rather than literally truncating the file — cutting real bytes off
    // the tail instead corrupts the end-of-central-directory record itself and reports as "not a
    // valid ZIP archive" (a real, different failure, exercised by the case below).
    const zip = await buildZip([{ name: "doc.kml", bytes: SAMPLE_KML, method: 0 }]);
    const bytes = new Uint8Array(zip);
    let cenAt = -1;
    for (let i = 0; i + 4 <= bytes.length; i++) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) { cenAt = i; break; }
    }
    expect(cenAt).toBeGreaterThan(-1);
    new DataView(zip).setUint32(cenAt + 20, 1_000_000, true); // compressed size, wildly oversized
    await expect(kmzToKmlText(zip)).rejects.toThrow(/couldn't read that \.kmz \(a truncated entry\)/i);
  });

  it("a corrupted end-of-central-directory record (truncated tail)", async () => {
    const zip = await buildZip([{ name: "doc.kml", bytes: SAMPLE_KML, method: 0 }]);
    const truncated = zip.slice(0, zip.byteLength - 40);
    await expect(kmzToKmlText(truncated)).rejects.toThrow(/valid ZIP archive/i);
  });

  it("an unsupported compression method", async () => {
    // Method 12 (BZIP2) isn't implemented — hand-build a single-entry zip, then flip the
    // CENTRAL DIRECTORY record's method field (what the reader actually consults) to it.
    // Found by scanning for the central-directory signature rather than computing an offset,
    // so the test doesn't depend on this fixture's exact byte layout.
    const zip = await buildZip([{ name: "doc.kml", bytes: SAMPLE_KML, method: 0 }]);
    const bytes = new Uint8Array(zip);
    let cenAt = -1;
    for (let i = 0; i + 4 <= bytes.length; i++) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) { cenAt = i; break; }
    }
    expect(cenAt).toBeGreaterThan(-1);
    new DataView(zip).setUint16(cenAt + 10, 12, true);
    await expect(kmzToKmlText(zip)).rejects.toThrow(/unsupported compression method/i);
  });
});

describe("kmzToDraftRows — same shape as kmlToDraftRows, just unzipped first", () => {
  it("converts a whole .kmz into draft rows", async () => {
    const zip = await buildZip([{ name: "doc.kml", bytes: SAMPLE_KML, method: 0 }]);
    const rows = await kmzToDraftRows(zip, { sourceFile: "jordan-comps.kmz" });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("kml");
    expect(rows[0].source_file).toBe("jordan-comps.kmz");
    expect(rows[0].raw_name).toBe("FM 359 tract");
    expect(rows[0].proposed.landPrice).toBe("850000");
  });
});
