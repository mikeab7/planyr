import { describe, it, expect } from "vitest";
import { overlayKey, siteUnderlayKey, uploadUnderlayDataUrl, BUCKET, fileKind } from "../src/workspaces/site-planner/lib/overlayStorage.js";

describe("overlay storage — key format (B72, RLS contract)", () => {
  it("puts the uid FIRST (the Storage RLS keys on the first folder)", () => {
    const key = overlayKey("uid-123", "siteA", "ovX");
    expect(key.split("/")[0]).toBe("uid-123");
    expect(key).toBe("uid-123/site-overlays/siteA/ovX.pdf");
  });
  it("falls back to 'unfiled' for a missing site id", () => {
    expect(overlayKey("u", null, "o")).toBe("u/site-overlays/unfiled/o.pdf");
  });
  it("carries the file extension (PDF vs image) so reload picks the right path", () => {
    expect(overlayKey("u", "s", "o", "png")).toBe("u/site-overlays/s/o.png");
    expect(overlayKey("u", "s", "o", "jpg")).toBe("u/site-overlays/s/o.jpg");
  });
  it("reuses the existing private bucket", () => {
    expect(BUCKET).toBe("doc-review-files");
  });
});

describe("underlay storage — key format + safe null paths (B474 review #5)", () => {
  it("siteUnderlayKey puts the uid FIRST (RLS) and carries the ext", () => {
    expect(siteUnderlayKey("uid-9", "siteB").split("/")[0]).toBe("uid-9");
    expect(siteUnderlayKey("uid-9", "siteB")).toBe("uid-9/site-underlay/siteB/underlay.png");
    expect(siteUnderlayKey("u", null, "jpg")).toBe("u/site-underlay/unfiled/underlay.jpg");
  });
  it("uploadUnderlayDataUrl returns null for non-image / non-data-URL input (caller keeps it inline)", async () => {
    expect(await uploadUnderlayDataUrl("s", null)).toBe(null);
    expect(await uploadUnderlayDataUrl("s", "https://example.com/x.png")).toBe(null);
    expect(await uploadUnderlayDataUrl("s", "data:application/pdf;base64,AAAA")).toBe(null); // not an image
  });
});

describe("overlay storage — fileKind (B72 polish: PDF + images, else stay inline)", () => {
  it("classifies by MIME type", () => {
    expect(fileKind({ type: "application/pdf" })).toEqual({ ext: "pdf", contentType: "application/pdf" });
    expect(fileKind({ type: "image/png" })).toEqual({ ext: "png", contentType: "image/png" });
    expect(fileKind({ type: "image/jpeg" })).toEqual({ ext: "jpg", contentType: "image/jpeg" });
  });
  it("falls back to the file extension when the MIME type is missing", () => {
    expect(fileKind({ type: "", name: "Survey.PDF" })).toEqual({ ext: "pdf", contentType: "application/pdf" });
    expect(fileKind({ type: "", name: "sheet.jpeg" })).toEqual({ ext: "jpg", contentType: "image/jpeg" });
  });
  it("returns null for unsupported types (caller keeps it inline)", () => {
    expect(fileKind({ type: "image/tiff", name: "x.tif" })).toBe(null);
    expect(fileKind({ type: "", name: "x.dwg" })).toBe(null);
  });
});
