import { describe, it, expect } from "vitest";
import { overlayKey, BUCKET } from "../src/workspaces/site-planner/lib/overlayStorage.js";

describe("overlay storage — key format (B72, RLS contract)", () => {
  it("puts the uid FIRST (the Storage RLS keys on the first folder)", () => {
    const key = overlayKey("uid-123", "siteA", "ovX");
    expect(key.split("/")[0]).toBe("uid-123");
    expect(key).toBe("uid-123/site-overlays/siteA/ovX.pdf");
  });
  it("falls back to 'unfiled' for a missing site id", () => {
    expect(overlayKey("u", null, "o")).toBe("u/site-overlays/unfiled/o.pdf");
  });
  it("reuses the existing private bucket", () => {
    expect(BUCKET).toBe("doc-review-files");
  });
});
