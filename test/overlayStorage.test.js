import { describe, it, expect } from "vitest";
import { overlayKey, siteUnderlayKey, uploadUnderlayDataUrl, BUCKET, fileKind, classifyStorageError, fetchOverlayBytes, fetchOverlayDataUrl } from "../src/workspaces/site-planner/lib/overlayStorage.js";

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
  it("classifies CAD files by extension — DXF/DWG back up like PDFs (B747/B748)", () => {
    expect(fileKind({ type: "", name: "plan.dxf" })).toEqual({ ext: "dxf", contentType: "application/dxf" });
    expect(fileKind({ type: "", name: "plan.dwg" })).toEqual({ ext: "dwg", contentType: "image/vnd.dwg" });
    expect(fileKind({ type: "image/vnd.dxf", name: "x" }).ext).toBe("dxf");
  });
  it("returns null for unsupported types (caller keeps it inline)", () => {
    expect(fileKind({ type: "image/tiff", name: "x.tif" })).toBe(null);
    expect(fileKind({ type: "", name: "x.zip" })).toBe(null);
  });
});

describe("overlay storage — classifyStorageError (B784/B785: missing vs network)", () => {
  it("treats a 400 as terminal-missing (Supabase's 'Object not found' status on this endpoint)", () => {
    expect(classifyStorageError({ status: 400, message: "Object not found" })).toBe("missing");
    expect(classifyStorageError({ statusCode: 400 })).toBe("missing"); // some clients use statusCode
  });
  it("treats a plain 404 as terminal-missing", () => {
    expect(classifyStorageError({ status: 404 })).toBe("missing");
  });
  it("treats any 'not found' message as terminal-missing even without a status", () => {
    expect(classifyStorageError({ message: "The resource was not found" })).toBe("missing");
    expect(classifyStorageError({ message: "NotFound" })).toBe("missing");
  });
  it("treats a timeout / 5xx / offline as transient network (retryable, NOT missing)", () => {
    expect(classifyStorageError({ status: 500, message: "Internal Server Error" })).toBe("network");
    expect(classifyStorageError({ status: 503 })).toBe("network");
    expect(classifyStorageError({ message: "Failed to fetch" })).toBe("network");
    expect(classifyStorageError(null)).toBe("network"); // unknown → retryable, never a destructive heal
  });
});

describe("overlay storage — discriminated fetch shape (B785)", () => {
  it("returns the { data, missing } shape and never throws on empty inputs", async () => {
    // No supabase client / no key in the test env → a safe non-missing null (caller keeps the placeholder as 'loading', not a false 're-add').
    expect(await fetchOverlayBytes("")).toEqual({ data: null, missing: false });
    expect(await fetchOverlayDataUrl("")).toEqual({ data: null, missing: false });
    expect(await fetchOverlayBytes(null)).toEqual({ data: null, missing: false });
  });
});
