// pdf.js transfers the ArrayBuffer passed as `data` to its worker, detaching the caller's copy.
// Every consumer must therefore copy, or a second consumer of the same bytes throws
// "Cannot perform Construct on a detached ArrayBuffer" (site-plan overlay "Change page…").
import { describe, it, expect, vi } from "vitest";

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: ({ data }) => {
    new Uint8Array(data); // throws if already detached, like the real loader
    data.transfer(); // detach, like the worker transfer
    return { promise: Promise.resolve({ numPages: 3, destroy() {}, getPage: async () => ({}) }) };
  },
}));

describe("pdf.js consumers leave the caller's buffer usable", () => {
  it("pdfPageCount then a second consumer on the same buffer", async () => {
    const { pdfPageCount } = await import("../src/shared/files/pdfRaster.js");
    const buf = new Uint8Array([1, 2, 3, 4]).buffer;
    expect(await pdfPageCount(buf)).toBe(3);
    expect(buf.byteLength).toBe(4);
    expect(await pdfPageCount(buf)).toBe(3); // second consumer
  });
  it("loadPdf does not detach the caller's buffer", async () => {
    const { loadPdf } = await import("../src/workspaces/doc-review/lib/pdf.js");
    const buf = new Uint8Array([1, 2, 3, 4]).buffer;
    await loadPdf(buf);
    expect(buf.byteLength).toBe(4);
  });
});
