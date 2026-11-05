/* NEW-5 — after a raster upload, the write that attaches it to the overlay row reads its result:
 * a conflict is retried ONCE with the fresh version; anything else is reported, never dropped. */
import { describe, it, expect, vi } from "vitest";
import { attachOverlayRaster, attachFailureMessage } from "../src/shared/sitePlans/lib/overlayRasterAttach.js";

const overlay = { id: "o1", docTitle: "Brochure", version: 3, rasterKey: null };

describe("attachOverlayRaster", () => {
  it("writes rasterKey at the overlay's version and returns the row", async () => {
    const updateOverlay = vi.fn(async (id, o) => ({ data: { ...o, version: 4 }, error: null }));
    const r = await attachOverlayRaster({ overlay, rasterKey: "k1", updateOverlay, fetchAllOverlays: vi.fn() });
    expect(updateOverlay).toHaveBeenCalledTimes(1);
    expect(updateOverlay.mock.calls[0][1]).toMatchObject({ id: "o1", rasterKey: "k1", version: 3 });
    expect(r).toMatchObject({ error: null, retried: false, data: { rasterKey: "k1", version: 4 } });
  });
  it("retries ONCE on a conflict with the fresh version — the second write wins", async () => {
    const updateOverlay = vi.fn()
      .mockResolvedValueOnce({ data: null, conflict: true, error: new Error("changed") })
      .mockResolvedValueOnce({ data: { ...overlay, rasterKey: "k1", version: 8 }, error: null });
    const fetchAllOverlays = vi.fn(async () => ({ data: [{ id: "zz", version: 1 }, { id: "o1", version: 7 }] }));
    const r = await attachOverlayRaster({ overlay, rasterKey: "k1", updateOverlay, fetchAllOverlays });
    expect(updateOverlay).toHaveBeenCalledTimes(2);
    expect(updateOverlay.mock.calls[1][1].version).toBe(7);
    expect(r).toMatchObject({ error: null, retried: true, data: { rasterKey: "k1", version: 8 } });
  });
  it("a conflict that survives the retry is reported as a conflict, with no third attempt", async () => {
    const updateOverlay = vi.fn(async () => ({ data: null, conflict: true, error: new Error("still changing") }));
    const fetchAllOverlays = vi.fn(async () => ({ data: [{ id: "o1", version: 9 }] }));
    const r = await attachOverlayRaster({ overlay, rasterKey: "k1", updateOverlay, fetchAllOverlays });
    expect(updateOverlay).toHaveBeenCalledTimes(2);
    expect(r.conflict).toBe(true);
    expect(r.error.message).toBe("still changing");
    expect(r.data).toBeNull();
  });
  it("a conflict with no fresher version to retry at is NOT retried", async () => {
    const updateOverlay = vi.fn(async () => ({ data: null, conflict: true, error: new Error("c") }));
    const fetchAllOverlays = vi.fn(async () => ({ data: [{ id: "o1", version: 3 }] })); // same version
    const r = await attachOverlayRaster({ overlay, rasterKey: "k1", updateOverlay, fetchAllOverlays });
    expect(updateOverlay).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ conflict: true, retried: false });
  });
  it("an RLS 0-row refusal / Postgres error is returned, never swallowed", async () => {
    const updateOverlay = vi.fn(async () => ({ data: null, error: new Error("Not saved — you can only edit site plans you uploaded") }));
    const r = await attachOverlayRaster({ overlay, rasterKey: "k1", updateOverlay, fetchAllOverlays: vi.fn() });
    expect(r.data).toBeNull();
    expect(r.error.message).toMatch(/only edit site plans you uploaded/);
    expect(r.conflict).toBe(false);
  });
  it("a store answer with neither data nor error is still a failure (never a silent 'kept the old row')", async () => {
    const r = await attachOverlayRaster({ overlay, rasterKey: "k1", updateOverlay: vi.fn(async () => ({ data: null, error: null })), fetchAllOverlays: vi.fn() });
    expect(r.error).toBeTruthy();
  });
});

describe("attachFailureMessage", () => {
  it("says the image is uploaded but unattached and points at Change page…", () => {
    const m = attachFailureMessage(new Error("x"), () => "You can only edit site plans you uploaded.");
    expect(m).toBe("Uploaded the image but couldn't attach it to this site plan — You can only edit site plans you uploaded. Try “Change page…” to attach it again.");
  });
});
